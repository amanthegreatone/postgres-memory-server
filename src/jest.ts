import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { PostgresMemoryServerOptions } from "./types.js";

const CHILD_OPTIONS_ENV_VAR = "POSTGRES_MEMORY_SERVER_CHILD_OPTIONS_B64";
const CHILD_SETUP_TIMEOUT_MS = 120_000;
const CHILD_SHUTDOWN_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;

export const DEFAULT_JEST_ENV_VAR_NAME = "DATABASE_URL";
export const DEFAULT_JEST_STATE_FILE = path.join(
  tmpdir(),
  `postgres-memory-server-jest-${createHash("sha256")
    .update(process.cwd())
    .digest("hex")
    .slice(0, 12)}.json`,
);

type ChildPayload = {
  uri: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  image: string;
};

type JestGlobalState = {
  pid: number;
  envVarName: string;
  payload: ChildPayload;
};

export interface JestGlobalSetupOptions extends PostgresMemoryServerOptions {
  envVarName?: string;
  stateFilePath?: string;
}

export interface JestGlobalTeardownOptions {
  stateFilePath?: string;
}

function getChildScript(childModuleUrl: string): string {
  return `
import process from "node:process";
import { PostgresMemoryServer } from ${JSON.stringify(childModuleUrl)};

const encodedOptions = process.env.${CHILD_OPTIONS_ENV_VAR};
if (!encodedOptions) {
  throw new Error("Missing child setup options");
}

const options = JSON.parse(Buffer.from(encodedOptions, "base64").toString("utf8"));
const server = await PostgresMemoryServer.create(options);

const payload = {
  uri: server.getUri(),
  host: server.getHost(),
  port: server.getPort(),
  database: server.getDatabase(),
  username: server.getUsername(),
  password: server.getPassword(),
  image: server.getImage(),
};

process.stdout.write(JSON.stringify(payload) + "\\n");

const stop = async () => {
  await server.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void stop();
});

process.on("SIGTERM", () => {
  void stop();
});

await new Promise(() => {});
`;
}

export function createJestGlobalSetup(
  options: JestGlobalSetupOptions = {},
): () => Promise<void> {
  return async () => {
    const {
      envVarName = DEFAULT_JEST_ENV_VAR_NAME,
      stateFilePath,
      ...serverOptions
    } = options;
    const resolvedStateFilePath = resolveStateFilePath(stateFilePath);

    await fs.mkdir(path.dirname(resolvedStateFilePath), { recursive: true });

    const existingState = await readStateFile(resolvedStateFilePath);
    if (existingState) {
      await stopChildProcess(existingState.pid);
    }

    const { pid, payload } = await startChildProcess(serverOptions);

    applyConnectionEnvironment(envVarName, payload);

    const state: JestGlobalState = {
      pid,
      envVarName,
      payload,
    };

    await fs.writeFile(
      resolvedStateFilePath,
      JSON.stringify(state, null, 2),
      "utf8",
    );
  };
}

export function createJestGlobalTeardown(
  options: JestGlobalTeardownOptions = {},
): () => Promise<void> {
  return async () => {
    const resolvedStateFilePath = resolveStateFilePath(options.stateFilePath);
    const state = await readStateFile(resolvedStateFilePath);

    if (!state) {
      return;
    }

    await stopChildProcess(state.pid);
    await fs.rm(resolvedStateFilePath, { force: true });
  };
}

function resolveStateFilePath(stateFilePath?: string): string {
  return stateFilePath ? path.resolve(stateFilePath) : DEFAULT_JEST_STATE_FILE;
}

async function readStateFile(
  filePath: string,
): Promise<JestGlobalState | null> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as JestGlobalState;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

function applyConnectionEnvironment(
  envVarName: string,
  payload: ChildPayload,
): void {
  process.env[envVarName] = payload.uri;
  process.env.POSTGRES_MEMORY_SERVER_URI = payload.uri;
  process.env.POSTGRES_MEMORY_SERVER_HOST = payload.host;
  process.env.POSTGRES_MEMORY_SERVER_PORT = String(payload.port);
  process.env.POSTGRES_MEMORY_SERVER_DATABASE = payload.database;
  process.env.POSTGRES_MEMORY_SERVER_USERNAME = payload.username;
  process.env.POSTGRES_MEMORY_SERVER_PASSWORD = payload.password;
  process.env.POSTGRES_MEMORY_SERVER_IMAGE = payload.image;
}

async function startChildProcess(
  options: PostgresMemoryServerOptions,
): Promise<{ pid: number; payload: ChildPayload }> {
  const childModuleUrl = await resolveChildModuleUrl();

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", getChildScript(childModuleUrl)],
      {
        env: {
          ...process.env,
          [CHILD_OPTIONS_ENV_VAR]: Buffer.from(
            JSON.stringify(options),
            "utf8",
          ).toString("base64"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    if (child.pid === undefined) {
      reject(new Error("Failed to start postgres-memory-server child process"));
      return;
    }

    const childPid = child.pid;

    let settled = false;
    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      void stopChildProcess(childPid).finally(() => {
        reject(
          new Error(
            `Timed out waiting for postgres-memory-server child process to become ready. ${stderr.trim()}`.trim(),
          ),
        );
      });
    }, CHILD_SETUP_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      if (settled) {
        return;
      }

      stdout += chunk;
      const newlineIndex = stdout.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const firstLine = stdout.slice(0, newlineIndex).trim();
      if (!firstLine) {
        return;
      }

      try {
        const payload = JSON.parse(firstLine) as ChildPayload;
        settled = true;
        clearTimeout(timeout);
        resolve({ pid: childPid, payload });
      } catch {
        // Wait for more output until the first line becomes valid JSON.
      }
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(
          `postgres-memory-server child process exited before reporting readiness (code: ${code ?? "null"}, signal: ${signal ?? "null"}). ${stderr.trim()}`.trim(),
        ),
      );
    });
  });
}

async function resolveChildModuleUrl(): Promise<string> {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDirectoryPath = path.dirname(currentFilePath);
  const distEntryPath = path.resolve(currentDirectoryPath, "../dist/index.js");

  try {
    await fs.access(distEntryPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(
        `Missing built package entry at ${distEntryPath}. Run npm run build before using the Jest global setup helpers from the repository source checkout.`,
      );
    }

    throw error;
  }

  return pathToFileURL(distEntryPath).href;
}

async function stopChildProcess(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (isMissingProcessError(error)) {
      return;
    }

    throw error;
  }

  const deadline = Date.now() + CHILD_SHUTDOWN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    try {
      process.kill(pid, 0);
    } catch (error) {
      if (isMissingProcessError(error)) {
        return;
      }

      throw error;
    }
  }

  throw new Error(
    `Timed out waiting for postgres-memory-server child process ${pid} to stop`,
  );
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function isMissingFileError(error: unknown): boolean {
  return isNodeErrorWithCode(error, "ENOENT");
}

function isMissingProcessError(error: unknown): boolean {
  return isNodeErrorWithCode(error, "ESRCH");
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
