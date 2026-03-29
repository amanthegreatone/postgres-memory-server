import { promises as fs } from "node:fs";
import path from "node:path";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Client, type QueryResultRow } from "pg";

import { ServerStoppedError, SnapshotUnsupportedError } from "./errors.js";
import { buildInitStatements, normalizeOptions } from "./presets.js";
import type {
  PostgresConnectionOptions,
  PostgresMemoryServerOptions,
  QueryParams,
  QueryResponse,
  QueryText,
} from "./types.js";

export type StartedPostgreSqlContainer = Awaited<
  ReturnType<PostgreSqlContainer["start"]>
>;

export class PostgresMemoryServer {
  private stopped = false;
  private readonly snapshotSupported: boolean;

  private constructor(
    private readonly container: StartedPostgreSqlContainer,
    private readonly options: ReturnType<typeof normalizeOptions>,
  ) {
    this.snapshotSupported = options.database !== "postgres";
  }

  static async create(
    options: PostgresMemoryServerOptions = {},
  ): Promise<PostgresMemoryServer> {
    const normalized = normalizeOptions(options);

    const container = await new PostgreSqlContainer(normalized.image)
      .withDatabase(normalized.database)
      .withUsername(normalized.username)
      .withPassword(normalized.password)
      .start();

    const server = new PostgresMemoryServer(container, normalized);

    const initStatements = buildInitStatements(normalized);
    if (initStatements.length > 0) {
      await server.runSql(initStatements);
    }

    return server;
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
    return this.container.getConnectionUri();
  }

  getHost(): string {
    this.ensureRunning();
    return this.container.getHost();
  }

  getPort(): number {
    this.ensureRunning();
    return this.container.getPort();
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

  async snapshot(): Promise<void> {
    this.ensureRunning();
    this.ensureSnapshotSupported();
    await this.container.snapshot();
  }

  async restore(): Promise<void> {
    this.ensureRunning();
    this.ensureSnapshotSupported();
    await this.container.restoreSnapshot();
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    await this.container.stop();
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
