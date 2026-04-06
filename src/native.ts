import { promises as fs, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const execFile = promisify(execFileCb);

/**
 * Get a free TCP port by binding to port 0 and reading the assigned port.
 */
export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/**
 * Get the PG major version from the installed embedded-postgres package.
 * The npm package version mirrors the PG version (e.g., 18.3.0-beta.16 = PG 18).
 */
export function getPgMajorVersion(): string {
  // Resolve the main entry of embedded-postgres, then walk up to find package.json
  const req = createRequire(import.meta.url);
  const mainEntry = req.resolve("embedded-postgres");
  let dir = path.dirname(mainEntry);

  // Walk up until we find a package.json with name "embedded-postgres"
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, "package.json");
    try {
      const content = readFileSync(candidate, "utf8");
      const pkg = JSON.parse(content) as { name?: string; version?: string };
      if (pkg.name === "embedded-postgres" && pkg.version) {
        const major = pkg.version.split(".")[0];
        if (major) return major;
      }
    } catch {
      // continue walking up
    }
    dir = path.dirname(dir);
  }

  throw new Error(
    "Could not determine embedded-postgres version. Ensure embedded-postgres is installed.",
  );
}

/**
 * Get the native directory of the installed embedded-postgres platform package.
 * This directory contains bin/, lib/, and share/ subdirectories.
 */
export function getNativeDir(): string {
  const platform = os.platform();
  const arch = os.arch();

  const platformPkgNames: Record<string, Record<string, string>> = {
    darwin: {
      arm64: "@embedded-postgres/darwin-arm64",
      x64: "@embedded-postgres/darwin-x64",
    },
    linux: {
      x64: "@embedded-postgres/linux-x64",
      arm64: "@embedded-postgres/linux-arm64",
    },
    win32: {
      x64: "@embedded-postgres/windows-x64",
    },
  };

  const pkgName = platformPkgNames[platform]?.[arch];
  if (!pkgName) {
    throw new Error(`Unsupported platform: ${platform}-${arch}`);
  }

  const req = createRequire(import.meta.url);
  // Resolve the package's main entry, then find the native/ dir relative to it
  const mainEntry = req.resolve(pkgName);
  let dir = path.dirname(mainEntry);

  // Walk up to find the package root (containing native/)
  while (dir !== path.dirname(dir)) {
    const nativeDir = path.join(dir, "native");
    if (existsSync(nativeDir)) {
      return nativeDir;
    }
    dir = path.dirname(dir);
  }

  throw new Error(
    `Could not find native directory for ${pkgName}. Ensure embedded-postgres is installed correctly.`,
  );
}

/**
 * Get the cache directory for downloaded extension binaries.
 */
export function getCacheDir(): string {
  const xdgCache = process.env.XDG_CACHE_HOME;
  const base = xdgCache || path.join(os.homedir(), ".cache");
  return path.join(base, "postgres-memory-server");
}

/**
 * Install the ParadeDB pg_search extension into the embedded-postgres native directory.
 * Downloads from GitHub releases if not already cached.
 */
export async function installParadeDBExtension(
  nativeDir: string,
  paradedbVersion: string,
  pgMajorVersion: string,
): Promise<void> {
  // Check if already installed
  const libDir = path.join(nativeDir, "lib", "postgresql");
  const extDir = path.join(nativeDir, "share", "postgresql", "extension");

  const soName =
    os.platform() === "darwin" && parseInt(pgMajorVersion, 10) >= 16
      ? "pg_search.dylib"
      : "pg_search.so";

  try {
    await fs.access(path.join(libDir, soName));
    await fs.access(path.join(extDir, "pg_search.control"));
    return; // Already installed
  } catch {
    // Not installed, proceed
  }

  const cacheDir = getCacheDir();
  const platform = os.platform();
  const arch = os.arch();
  const cacheKey = `paradedb-${paradedbVersion}-pg${pgMajorVersion}-${platform}-${arch}`;
  const cachedDir = path.join(cacheDir, cacheKey);

  // Check cache
  let cached = false;
  try {
    await fs.access(path.join(cachedDir, "lib", soName));
    cached = true;
  } catch {
    // Not cached
  }

  if (!cached) {
    const url = buildDownloadUrl(
      paradedbVersion,
      pgMajorVersion,
      platform,
      arch,
    );
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paradedb-"));

    try {
      const filename = decodeURIComponent(url.split("/").pop()!);
      const archivePath = path.join(tmpDir, filename);

      await downloadFile(url, archivePath);

      const extractedDir = path.join(tmpDir, "extracted");
      await fs.mkdir(extractedDir, { recursive: true });

      if (platform === "darwin") {
        await extractPkg(archivePath, extractedDir);
      } else {
        await extractDeb(archivePath, extractedDir);
      }

      // Cache the extracted extension files
      const cacheLibDir = path.join(cachedDir, "lib");
      const cacheExtDir = path.join(cachedDir, "extension");
      await fs.mkdir(cacheLibDir, { recursive: true });
      await fs.mkdir(cacheExtDir, { recursive: true });

      const soFiles = await findFiles(
        extractedDir,
        /pg_search\.(so|dylib)$/,
      );
      for (const soFile of soFiles) {
        await copyFileWithPermissions(soFile, path.join(cacheLibDir, path.basename(soFile)));
      }

      const extFiles = await findFiles(
        extractedDir,
        /pg_search[^/]*(\.control|\.sql)$/,
      );
      for (const extFile of extFiles) {
        await copyFileWithPermissions(
          extFile,
          path.join(cacheExtDir, path.basename(extFile)),
        );
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  // Copy from cache to native dir
  await fs.mkdir(libDir, { recursive: true });
  await fs.mkdir(extDir, { recursive: true });

  const cacheLibDir = path.join(cachedDir, "lib");
  const cacheExtDir = path.join(cachedDir, "extension");

  for (const file of await fs.readdir(cacheLibDir)) {
    await copyFileWithPermissions(path.join(cacheLibDir, file), path.join(libDir, file));
  }

  for (const file of await fs.readdir(cacheExtDir)) {
    await copyFileWithPermissions(path.join(cacheExtDir, file), path.join(extDir, file));
  }
}

function buildDownloadUrl(
  version: string,
  pgMajorVersion: string,
  platform: string,
  arch: string,
): string {
  const base = `https://github.com/paradedb/paradedb/releases/download/v${version}`;

  if (platform === "darwin") {
    if (arch !== "arm64") {
      throw new Error(
        "ParadeDB only provides macOS binaries for arm64 (Apple Silicon). Intel Macs are not supported.",
      );
    }
    const macosName = getMacOSCodename();
    return `${base}/pg_search%40${pgMajorVersion}--${version}.arm64_${macosName}.pkg`;
  }

  if (platform === "linux") {
    const debArch = arch === "arm64" ? "arm64" : "amd64";
    return `${base}/postgresql-${pgMajorVersion}-pg-search_${version}-1PARADEDB-bookworm_${debArch}.deb`;
  }

  throw new Error(
    `ParadeDB does not provide prebuilt binaries for ${platform}. Use the Docker-based preset instead.`,
  );
}

function getMacOSCodename(): string {
  const release = os.release();
  const majorVersion = parseInt(release.split(".")[0] ?? "0", 10);

  if (majorVersion >= 24) return "sequoia";
  if (majorVersion >= 23) return "sonoma";
  throw new Error(
    `ParadeDB requires macOS 14 (Sonoma) or later. Detected Darwin ${release}.`,
  );
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });

  if (!response.ok) {
    throw new Error(
      `Failed to download ParadeDB extension from ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destPath, buffer);
}

async function extractDeb(
  debPath: string,
  extractDir: string,
): Promise<void> {
  await execFile("ar", ["x", debPath], { cwd: extractDir });

  const files = await fs.readdir(extractDir);
  const dataTar = files.find((f) => f.startsWith("data.tar"));

  if (!dataTar) {
    throw new Error(
      "No data.tar.* found in .deb archive. The ParadeDB package format may have changed.",
    );
  }

  const dataDir = path.join(extractDir, "data");
  await fs.mkdir(dataDir, { recursive: true });
  await execFile("tar", [
    "xf",
    path.join(extractDir, dataTar),
    "-C",
    dataDir,
  ]);
}

async function extractPkg(
  pkgPath: string,
  extractDir: string,
): Promise<void> {
  const pkgDir = path.join(extractDir, "pkg");
  await execFile("pkgutil", ["--expand-full", pkgPath, pkgDir]);
}

/**
 * Copy a file by reading and writing its contents, avoiding EACCES errors
 * when the source file is read-only (e.g., extracted from tar archives).
 */
async function copyFileWithPermissions(
  src: string,
  dest: string,
): Promise<void> {
  const content = await fs.readFile(src);
  await fs.writeFile(dest, content, { mode: 0o755 });
}

async function findFiles(dir: string, pattern: RegExp): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (pattern.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

/**
 * Install pgvector extension into the embedded-postgres native directory.
 * Downloads from Homebrew bottles (GHCR) which cover macOS + Linux.
 */
export async function installPgVectorExtension(
  nativeDir: string,
  pgMajorVersion: string,
): Promise<void> {
  const libDir = path.join(nativeDir, "lib", "postgresql");
  const extDir = path.join(nativeDir, "share", "postgresql", "extension");

  const soName = os.platform() === "darwin" ? "vector.dylib" : "vector.so";

  // Check if already installed
  try {
    await fs.access(path.join(libDir, soName));
    await fs.access(path.join(extDir, "vector.control"));
    return;
  } catch {
    // Not installed
  }

  const platform = os.platform();
  const arch = os.arch();
  const cacheDir = getCacheDir();
  const cacheKey = `pgvector-pg${pgMajorVersion}-${platform}-${arch}`;
  const cachedDir = path.join(cacheDir, cacheKey);

  // Check cache
  let cached = false;
  try {
    await fs.access(path.join(cachedDir, "lib", soName));
    cached = true;
  } catch {
    // Not cached
  }

  if (!cached) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pgvector-"));

    try {
      // Fetch Homebrew formula metadata to get bottle URLs
      const formulaRes = await fetch(
        "https://formulae.brew.sh/api/formula/pgvector.json",
      );
      if (!formulaRes.ok) {
        throw new Error(
          `Failed to fetch pgvector formula: ${formulaRes.status}`,
        );
      }
      const formula = (await formulaRes.json()) as HomebrewFormula;

      const bottleTag = getHomebrewBottleTag(platform, arch);
      const fileInfo = formula.bottle.stable.files[bottleTag];
      if (!fileInfo) {
        throw new Error(
          `No pgvector Homebrew bottle for ${bottleTag}. ` +
            `Available: ${Object.keys(formula.bottle.stable.files).join(", ")}`,
        );
      }

      // Get anonymous GHCR auth token
      const tokenRes = await fetch(
        "https://ghcr.io/token?scope=repository:homebrew/core/pgvector:pull",
      );
      if (!tokenRes.ok) {
        throw new Error(`Failed to get GHCR token: ${tokenRes.status}`);
      }
      const { token } = (await tokenRes.json()) as { token: string };

      // Download the bottle blob
      const blobUrl = `https://ghcr.io/v2/homebrew/core/pgvector/blobs/sha256:${fileInfo.sha256}`;
      const blobRes = await fetch(blobUrl, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "follow",
      });
      if (!blobRes.ok) {
        throw new Error(
          `Failed to download pgvector bottle: ${blobRes.status}`,
        );
      }

      const bottlePath = path.join(tmpDir, "pgvector.tar.gz");
      const buffer = Buffer.from(await blobRes.arrayBuffer());
      await fs.writeFile(bottlePath, buffer);

      // Extract the tarball
      const extractDir = path.join(tmpDir, "extracted");
      await fs.mkdir(extractDir, { recursive: true });
      await execFile("tar", ["xzf", bottlePath, "-C", extractDir]);

      // Cache extracted extension files
      const cacheLibDir = path.join(cachedDir, "lib");
      const cacheExtDir = path.join(cachedDir, "extension");
      await fs.mkdir(cacheLibDir, { recursive: true });
      await fs.mkdir(cacheExtDir, { recursive: true });

      // Find vector.so/.dylib for the matching PG version
      const pgSubdir = `postgresql@${pgMajorVersion}`;
      let soFiles = await findFiles(
        extractDir,
        new RegExp(`${pgSubdir}.*vector\\.(so|dylib)$`),
      );
      if (soFiles.length === 0) {
        soFiles = await findFiles(extractDir, /vector\.(so|dylib)$/);
      }
      for (const f of soFiles) {
        await copyFileWithPermissions(f, path.join(cacheLibDir, path.basename(f)));
      }

      // Find extension control and SQL files for matching PG version
      let extFiles = await findFiles(
        extractDir,
        new RegExp(`${pgSubdir}.*vector[^/]*(\\.control|\\.sql)$`),
      );
      if (extFiles.length === 0) {
        extFiles = await findFiles(extractDir, /vector[^/]*(\.control|\.sql)$/);
      }
      for (const f of extFiles) {
        await copyFileWithPermissions(f, path.join(cacheExtDir, path.basename(f)));
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  // Copy from cache to native dir
  await fs.mkdir(libDir, { recursive: true });
  await fs.mkdir(extDir, { recursive: true });

  const cacheLibDir = path.join(cachedDir, "lib");
  const cacheExtDir = path.join(cachedDir, "extension");

  for (const file of await fs.readdir(cacheLibDir)) {
    await copyFileWithPermissions(path.join(cacheLibDir, file), path.join(libDir, file));
  }

  for (const file of await fs.readdir(cacheExtDir)) {
    await copyFileWithPermissions(path.join(cacheExtDir, file), path.join(extDir, file));
  }
}

function getHomebrewBottleTag(platform: string, arch: string): string {
  if (platform === "darwin") {
    const release = os.release();
    const major = parseInt(release.split(".")[0] ?? "0", 10);
    const prefix = arch === "arm64" ? "arm64_" : "";
    if (major >= 25) return `${prefix}tahoe`;
    if (major >= 24) return `${prefix}sequoia`;
    if (major >= 23) return `${prefix}sonoma`;
    return `${prefix}ventura`;
  }
  if (platform === "linux") {
    return arch === "arm64" ? "aarch64_linux" : "x86_64_linux";
  }
  throw new Error(`No Homebrew bottles available for ${platform}-${arch}`);
}

interface HomebrewFormula {
  bottle: {
    stable: {
      files: Record<string, { cellar: string; sha256: string }>;
    };
  };
}

/**
 * Sweep $TMPDIR for orphaned `postgres-memory-server-*` data directories
 * left behind by previous processes that crashed or were hard-killed.
 *
 * A directory is considered orphaned if:
 *   - it has no `postmaster.pid` file (init never finished), OR
 *   - the PID inside `postmaster.pid` no longer maps to a live process.
 *
 * Live directories from concurrently running test processes are left alone.
 */
export async function sweepOrphanedDataDirs(): Promise<void> {
  const tmpDir = os.tmpdir();
  let entries: string[];
  try {
    entries = await fs.readdir(tmpDir);
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((name) => name.startsWith("postgres-memory-server-"))
      .map(async (name) => {
        const fullPath = path.join(tmpDir, name);
        try {
          const stat = await fs.stat(fullPath);
          if (!stat.isDirectory()) return;
        } catch {
          return;
        }

        const pidFile = path.join(fullPath, "postmaster.pid");
        let pid: number | null = null;
        try {
          const content = await fs.readFile(pidFile, "utf8");
          const firstLine = content.split("\n")[0]?.trim();
          const parsed = firstLine ? parseInt(firstLine, 10) : NaN;
          if (!Number.isNaN(parsed) && parsed > 0) {
            pid = parsed;
          }
        } catch {
          // No pid file — partial init that never finished. Safe to remove.
        }

        if (pid !== null) {
          try {
            // Signal 0 just checks whether the process exists.
            process.kill(pid, 0);
            // Process is alive — leave it alone.
            return;
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === "EPERM") {
              // Process exists but belongs to another user — leave it alone.
              return;
            }
            // ESRCH or anything else means the process is dead.
          }
        }

        await fs.rm(fullPath, { recursive: true, force: true }).catch(() => {});
      }),
  );
}

/**
 * Parse a ParadeDB version string like "0.22.5" or "0.22.5-pg17".
 * Returns the extension version and optional PG version suffix.
 */
export function parseParadeDBVersion(version: string): {
  extVersion: string;
  pgVersion?: string;
} {
  const match = version.match(/^(\d+\.\d+\.\d+)(?:-pg(\d+))?$/);
  if (!match || !match[1]) {
    return { extVersion: version };
  }
  return {
    extVersion: match[1],
    pgVersion: match[2],
  };
}
