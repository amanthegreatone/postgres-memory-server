import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";

import {
  createJestGlobalSetup,
  createJestGlobalTeardown,
} from "../src/index.js";

const TEMP_ENV_VAR = "TEST_DATABASE_URL";
const TEMP_STATE_FILE = path.join(
  tmpdir(),
  `postgres-memory-server-vitest-jest-${process.pid}.json`,
);

afterEach(async () => {
  delete process.env[TEMP_ENV_VAR];
  delete process.env.POSTGRES_MEMORY_SERVER_URI;
  delete process.env.POSTGRES_MEMORY_SERVER_HOST;
  delete process.env.POSTGRES_MEMORY_SERVER_PORT;
  delete process.env.POSTGRES_MEMORY_SERVER_DATABASE;
  delete process.env.POSTGRES_MEMORY_SERVER_USERNAME;
  delete process.env.POSTGRES_MEMORY_SERVER_PASSWORD;
  delete process.env.POSTGRES_MEMORY_SERVER_IMAGE;
  await fs.rm(TEMP_STATE_FILE, { force: true });
});

describe("Jest helpers", () => {
  it("starts and stops a database process through setup and teardown hooks", async () => {
    const setup = createJestGlobalSetup({
      envVarName: TEMP_ENV_VAR,
      stateFilePath: TEMP_STATE_FILE,
    });
    const teardown = createJestGlobalTeardown({
      stateFilePath: TEMP_STATE_FILE,
    });

    await setup();

    try {
      expect(process.env[TEMP_ENV_VAR]).toContain("postgres://");

      const state = JSON.parse(await fs.readFile(TEMP_STATE_FILE, "utf8")) as {
        pid: number;
        envVarName: string;
      };

      expect(state.pid).toBeGreaterThan(0);
      expect(state.envVarName).toBe(TEMP_ENV_VAR);

      const client = new Client({
        connectionString: process.env[TEMP_ENV_VAR],
      });
      await client.connect();

      const result = await client.query<{ value: number }>("SELECT 1 AS value");
      expect(result.rows[0]?.value).toBe(1);

      await client.end();
    } finally {
      await teardown();
    }

    await expect(fs.readFile(TEMP_STATE_FILE, "utf8")).rejects.toThrow();
  });
});
