import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { PostgresMemoryServer } from "../src/index.js";
import { sweepOrphanedDataDirs } from "../src/native.js";

const TMPDIR = os.tmpdir();
const PREFIX = "postgres-memory-server-";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("data directory cleanup", () => {
  describe("graceful stop()", () => {
    it("removes the data directory after stop()", async () => {
      const db = await PostgresMemoryServer.create();
      const dataDir = db.getDataDir();

      // Sanity: the data directory exists while the server is running.
      expect(await exists(dataDir)).toBe(true);

      await db.stop();

      // The data directory should be gone.
      expect(await exists(dataDir)).toBe(false);
    });

    it("is idempotent: calling stop() twice does not throw", async () => {
      const db = await PostgresMemoryServer.create();
      const dataDir = db.getDataDir();

      await db.stop();
      await db.stop();

      expect(await exists(dataDir)).toBe(false);
    });
  });

  describe("create() failure", () => {
    it("removes the data directory when initialization throws", async () => {
      // Snapshot the set of dirs before so we can identify what was leaked.
      const before = new Set(
        (await fs.readdir(TMPDIR)).filter((n) => n.startsWith(PREFIX)),
      );

      // Force a synchronous failure inside create()'s try block by passing
      // a ParadeDB version with a PG suffix that does not match the
      // installed embedded-postgres version.
      await expect(
        PostgresMemoryServer.create({
          preset: "paradedb",
          version: "0.22.5-pg99",
        }),
      ).rejects.toThrow(/PostgreSQL/);

      // Whatever new dirs (if any) were added during this call must have
      // been cleaned up. Filter against `before` so we don't pick up dirs
      // created by parallel test forks.
      const after = (await fs.readdir(TMPDIR)).filter(
        (n) => n.startsWith(PREFIX) && !before.has(n),
      );

      // Each new entry must NOT exist on disk by the time we check (the
      // create() failure path should have rm'd it).
      const stillExists: string[] = [];
      for (const name of after) {
        if (await exists(path.join(TMPDIR, name))) {
          stillExists.push(name);
        }
      }
      expect(stillExists).toEqual([]);
    });
  });

  describe("orphan sweep", () => {
    const created: string[] = [];

    afterEach(async () => {
      // Best-effort cleanup of any test artefacts left behind.
      while (created.length > 0) {
        const p = created.pop()!;
        await fs.rm(p, { recursive: true, force: true }).catch(() => {});
      }
    });

    it("removes a stale dir whose postmaster.pid points to a dead process", async () => {
      const orphan = await fs.mkdtemp(path.join(TMPDIR, `${PREFIX}stale-`));
      created.push(orphan);
      // Pick a PID that is overwhelmingly unlikely to exist.
      await fs.writeFile(
        path.join(orphan, "postmaster.pid"),
        `999999\n/some/path\n12345\n`,
        "utf8",
      );

      // Pass minAgeMs: 0 so the age check doesn't keep the dir alive.
      await sweepOrphanedDataDirs(0);

      expect(await exists(orphan)).toBe(false);
    });

    it("removes an old dir with no postmaster.pid", async () => {
      const orphan = await fs.mkdtemp(path.join(TMPDIR, `${PREFIX}partial-`));
      created.push(orphan);
      // Backdate mtime so the age check considers it eligible.
      const old = new Date(Date.now() - 5 * 60_000);
      await fs.utimes(orphan, old, old);

      await sweepOrphanedDataDirs();

      expect(await exists(orphan)).toBe(false);
    });

    it("preserves a fresh dir with no postmaster.pid (race protection)", async () => {
      const orphan = await fs.mkdtemp(path.join(TMPDIR, `${PREFIX}fresh-`));
      created.push(orphan);
      // Fresh mtime — represents a concurrent test mid-init.

      await sweepOrphanedDataDirs();

      expect(await exists(orphan)).toBe(true);
    });

    it("preserves a dir whose postmaster.pid points to a live process", async () => {
      const orphan = await fs.mkdtemp(path.join(TMPDIR, `${PREFIX}live-`));
      created.push(orphan);
      // Use the current node process PID — guaranteed alive.
      await fs.writeFile(
        path.join(orphan, "postmaster.pid"),
        `${process.pid}\n/some/path\n12345\n`,
        "utf8",
      );

      // Use minAgeMs: 0 to make sure the live-pid branch is what's
      // protecting it (not the age check).
      await sweepOrphanedDataDirs(0);

      expect(await exists(orphan)).toBe(true);
    });
  });

  describe("signal handler", () => {
    it(
      "removes the data directory when the process exits via SIGINT",
      async () => {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const distEntry = path.resolve(here, "../dist/index.js");

        const script = `
import { PostgresMemoryServer } from ${JSON.stringify(distEntry)};
const db = await PostgresMemoryServer.create();
process.stdout.write("DATADIR=" + db.getDataDir() + "\\n");
await new Promise(() => {});
`;

        const child = spawn(
          process.execPath,
          ["--input-type=module", "--eval", script],
          { stdio: ["ignore", "pipe", "pipe"] },
        );

        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });

        // Wait for the child to print the dataDir path.
        const dataDir = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(
            () =>
              reject(
                new Error(
                  `child timed out before reporting dataDir. stderr: ${stderr}`,
                ),
              ),
            120_000,
          );
          const onData = () => {
            const match = stdout.match(/DATADIR=(.+)/);
            if (match && match[1]) {
              clearTimeout(timeout);
              child.stdout.off("data", onData);
              resolve(match[1].trim());
            }
          };
          child.stdout.on("data", onData);
        });

        // Confirm the dir exists right now.
        expect(await exists(dataDir)).toBe(true);

        // Send SIGINT and wait for the child to exit.
        await new Promise<void>((resolve) => {
          child.once("exit", () => resolve());
          child.kill("SIGINT");
        });

        // The exit handler should have removed the data directory.
        expect(await exists(dataDir)).toBe(false);
      },
      180_000,
    );
  });
});
