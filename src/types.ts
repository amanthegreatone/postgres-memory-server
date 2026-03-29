import type { QueryConfig, QueryResult, QueryResultRow } from "pg";

export type PostgresMemoryServerPreset = "postgres" | "paradedb";

export interface PostgresMemoryServerOptions {
  /**
   * Preset used to choose the default image and default extensions.
   * Defaults to "postgres".
   */
  preset?: PostgresMemoryServerPreset;

  /**
   * Version or tag to use for the selected preset.
   * Examples: "16" for postgres, "0.22.3-pg17" for ParadeDB.
   * Ignored when image is provided.
   */
  version?: string;

  /**
   * Container image to start.
   * Defaults to postgres:17 for the postgres preset
   * and paradedb/paradedb:0.22.3-pg17 for the ParadeDB preset.
   * Takes precedence over version when both are provided.
   */
  image?: string;

  /** Database name created inside the container. Defaults to testdb. */
  database?: string;

  /** Username for the test database. Defaults to testuser. */
  username?: string;

  /** Password for the test database. Defaults to testpassword. */
  password?: string;

  /**
   * Extensions to create after the container starts.
   * Each entry becomes CREATE EXTENSION IF NOT EXISTS <name>.
   */
  extensions?: string[];

  /** Additional SQL statements to run after the container starts. */
  initSql?: string[];
}

export interface NormalizedPostgresMemoryServerOptions {
  preset: PostgresMemoryServerPreset;
  version?: string;
  image: string;
  database: string;
  username: string;
  password: string;
  extensions: string[];
  initSql: string[];
}

export interface PostgresConnectionOptions {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export type QueryParams = unknown[];

export type QueryText<Row extends QueryResultRow = QueryResultRow> =
  | string
  | QueryConfig<QueryParams>;

export type QueryResponse<Row extends QueryResultRow = QueryResultRow> =
  QueryResult<Row>;
