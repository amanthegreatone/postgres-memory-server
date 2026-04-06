import { promises as fs, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import EmbeddedPostgres from "embedded-postgres";
import { Client, type QueryResultRow } from "pg";

import {
  ExtensionInstallError,
  ServerStoppedError,
  SnapshotUnsupportedError,
} from "./errors.js";
import {
  buildInitStatements,
  normalizeOptions,
  resolveParadeDBVersion,
  DEFAULT_POSTGRES_VERSION,
} from "./presets.js";
import {
  getFreePort,
  getNativeDir,
  installParadeDBExtension,
  installPgVectorExtension,
  sweepOrphanedDataDirs,
} from "./native.js";
import type {
  PostgresConnectionOptions,
  PostgresMemoryServerOptions,
  QueryParams,
  QueryResponse,
  QueryText,
} from "./types.js";

// Track all live instances so we can clean up their dataDirs on process exit.
const liveInstances = new Set<PostgresMemoryServer>();
let exitHandlersRegistered = false;
let orphanSweepDone = false;

function registerExitHandlers(): void {
  if (exitHandlersRegistered) return;
  exitHandlersRegistered = true;

  const cleanup = () => {
    for (const instance of liveInstances) {
      try {
        instance._cleanupSync();
      } catch {
        // best-effort
      }
    }
  };

  process.once("exit", cleanup);

  // For SIGINT/SIGTERM/uncaughtException we run cleanup then re-raise so
  // we don't override existing handlers' decisions about whether to exit.
  const signalCleanup = (signal: NodeJS.Signals) => {
    cleanup();
    // Remove our handler so a re-raise of the signal terminates normally.
    process.removeListener(signal, signalCleanup);
    process.kill(process.pid, signal);
  };
  process.on("SIGINT", signalCleanup);
  process.on("SIGTERM", signalCleanup);
  process.on("SIGHUP", signalCleanup);
}

export class PostgresMemoryServer {
  private stopped = false;
  private readonly snapshotSupported: boolean;
  private hasSnapshot = false;

  private constructor(
    private readonly pg: EmbeddedPostgres,
    private readonly port: number,
    private readonly dataDir: string,
    private readonly options: ReturnType<typeof normalizeOptions>,
  ) {
    this.snapshotSupported = options.database !== "postgres";
  }

  static async create(
    options: PostgresMemoryServerOptions = {},
  ): Promise<PostgresMemoryServer> {
    // One-time sweep of orphaned data dirs from prior crashed runs.
    if (!orphanSweepDone) {
      orphanSweepDone = true;
      await sweepOrphanedDataDirs().catch(() => {
        // best-effort cleanup
      });
    }

    const normalized = normalizeOptions(options);
    const port = await getFreePort();
    const dataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "postgres-memory-server-"),
    );

    let pg: EmbeddedPostgres | undefined;

    try {
      const postgresFlags: string[] = [];

      // Install ParadeDB extension if needed
      if (normalized.preset === "paradedb") {
        const nativeDir = getNativeDir();
        const extVersion = resolveParadeDBVersion(normalized.version);
        const pgMajor = DEFAULT_POSTGRES_VERSION;

        try {
          await installParadeDBExtension(nativeDir, extVersion, pgMajor);
        } catch (error) {
          throw new ExtensionInstallError(
            "pg_search",
            error instanceof Error ? error : new Error(String(error)),
          );
        }

        if (normalized.extensions.includes("vector")) {
          try {
            await installPgVectorExtension(nativeDir, pgMajor);
          } catch (error) {
            throw new ExtensionInstallError(
              "vector",
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        }

        if (
          normalized.extensions.includes("pg_search") ||
          normalized.extensions.length === 0
        ) {
          postgresFlags.push("-c", "shared_preload_libraries=pg_search");
        }
      }

      pg = new EmbeddedPostgres({
        databaseDir: dataDir,
        port,
        user: normalized.username,
        password: normalized.password,
        persistent: false,
        postgresFlags,
        onLog: () => {},
        onError: () => {},
      });

      await pg.initialise();
      await pg.start();

      if (normalized.database !== "postgres") {
        await pg.createDatabase(normalized.database);
      }

      const server = new PostgresMemoryServer(pg, port, dataDir, normalized);
      liveInstances.add(server);
      registerExitHandlers();

      const initStatements = buildInitStatements(normalized);
      if (initStatements.length > 0) {
        await server.runSql(initStatements);
      }

      return server;
    } catch (error) {
      // Cleanup on failure: stop any partial postgres process and rm dataDir.
      if (pg) {
        try {
          await pg.stop();
        } catch {
          // best-effort
        }
      }
      await fs
        .rm(dataDir, { recursive: true, force: true })
        .catch(() => {});
      throw error;
    }
  }

  static createPostgres(
    options: Omit<PostgresMemoryServerOptions, "preset"> = {},
  ): Promise<PostgresMemoryServer> {
    return PostgresMemoryServer.create({ ...options, preset: "postgres" });
  }

  static createParadeDb(
    options: Omit<PostgresMemoryServerOptions, "preset"> = {},
  ): Promise<PostgresMemoryServer> {
    return PostgresMemoryServer.create({ ...options, preset: "paradedb" });
  }

  getUri(): string {
    this.ensureRunning();
    return `postgres://${this.options.username}:${this.options.password}@localhost:${this.port}/${this.options.database}`;
  }

  getHost(): string {
    this.ensureRunning();
    return "localhost";
  }

  getPort(): number {
    this.ensureRunning();
    return this.port;
  }

  getDatabase(): string {
    return this.options.database;
  }

  getUsername(): string {
    return this.options.username;
  }

  getPassword(): string {
    return this.options.password;
  }

  getImage(): string {
    return this.options.image;
  }

  getConnectionOptions(): PostgresConnectionOptions {
    return {
      host: this.getHost(),
      port: this.getPort(),
      database: this.getDatabase(),
      user: this.getUsername(),
      password: this.getPassword(),
    };
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: QueryText<Row>,
    params?: QueryParams,
  ): Promise<QueryResponse<Row>> {
    return this.withClient((client) => {
      if (typeof text === "string") {
        if (params === undefined) {
          return client.query<Row>(text);
        }

        return client.query<Row>(text, params);
      }

      return client.query<Row>(text);
    });
  }

  async withClient<T>(callback: (client: Client) => Promise<T>): Promise<T> {
    this.ensureRunning();

    const client = new Client({
      connectionString: this.getUri(),
    });

    await client.connect();
    try {
      return await callback(client);
    } finally {
      await client.end();
    }
  }

  async runSql(sql: string | string[]): Promise<void> {
    const statements = Array.isArray(sql) ? sql : [sql];

    await this.withClient(async (client) => {
      for (const statement of statements) {
        await client.query(statement);
      }
    });
  }

  async runSqlFile(filePath: string): Promise<void> {
    const sql = await fs.readFile(filePath, "utf8");
    await this.runSql(sql);
  }

  async runMigrationsDir(dirPath: string): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries
      .filter(
        (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".sql"),
      )
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    for (const file of files) {
      await this.runSqlFile(path.join(dirPath, file));
    }

    return files;
  }

  /**
   * Create a snapshot of the current database state.
   * Uses PostgreSQL template databases for fast, native snapshots.
   */
  async snapshot(): Promise<void> {
    this.ensureRunning();
    this.ensureSnapshotSupported();

    const snapshotDb = `${this.options.database}_snapshot`;

    await this.withAdminClient(async (client) => {
      // Terminate other connections to the database
      await client.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid != pg_backend_pid()`,
        [this.options.database],
      );

      // Drop existing snapshot if any
      if (this.hasSnapshot) {
        await client.query(`DROP DATABASE IF EXISTS "${snapshotDb}"`);
      }

      // Create snapshot as a template copy
      await client.query(
        `CREATE DATABASE "${snapshotDb}" TEMPLATE "${this.options.database}"`,
      );
    });

    this.hasSnapshot = true;
  }

  /**
   * Restore the database to the last snapshot.
   * Drops and recreates the database from the snapshot template.
   */
  async restore(): Promise<void> {
    this.ensureRunning();
    this.ensureSnapshotSupported();

    if (!this.hasSnapshot) {
      throw new Error(
        "No snapshot exists. Call snapshot() before calling restore().",
      );
    }

    const snapshotDb = `${this.options.database}_snapshot`;

    await this.withAdminClient(async (client) => {
      // Terminate all connections to the target database
      await client.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid != pg_backend_pid()`,
        [this.options.database],
      );

      // Drop and recreate from snapshot
      await client.query(`DROP DATABASE "${this.options.database}"`);
      await client.query(
        `CREATE DATABASE "${this.options.database}" TEMPLATE "${snapshotDb}"`,
      );
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    liveInstances.delete(this);

    try {
      await this.pg.stop();
    } catch {
      // Even if pg.stop() fails (e.g., process never started, already dead),
      // we still want to remove the data directory below.
    }

    // Defensive cleanup. embedded-postgres only deletes the data dir when
    // its `process` field is set; if start() failed before that, the dir
    // would be leaked. force: true makes this a no-op if already gone.
    await fs
      .rm(this.dataDir, { recursive: true, force: true })
      .catch(() => {});
  }

  /**
   * Synchronous cleanup for use in process exit handlers. Cannot await,
   * so we just remove the data directory and let the OS reap the postgres
   * child process. embedded-postgres registers its own exit hook to kill
   * the process; this method is a backup for the data directory only.
   *
   * @internal
   */
  _cleanupSync(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    liveInstances.delete(this);
    try {
      rmSync(this.dataDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  /**
   * Connect to the "postgres" system database for admin operations
   * (snapshot, restore, etc.).
   */
  private async withAdminClient<T>(
    callback: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = new Client({
      host: "localhost",
      port: this.port,
      database: "postgres",
      user: this.options.username,
      password: this.options.password,
    });

    await client.connect();
    try {
      return await callback(client);
    } finally {
      await client.end();
    }
  }

  private ensureRunning(): void {
    if (this.stopped) {
      throw new ServerStoppedError();
    }
  }

  private ensureSnapshotSupported(): void {
    if (!this.snapshotSupported) {
      throw new SnapshotUnsupportedError(this.options.database);
    }
  }
}
