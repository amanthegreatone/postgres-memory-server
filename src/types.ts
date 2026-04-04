import type { QueryConfig, QueryResult, QueryResultRow } from "pg";

export type PostgresMemoryServerPreset = "postgres" | "paradedb";

export interface PostgresMemoryServerOptions {
  /**
   * Preset used to choose default extensions and behavior.
   * Defaults to "postgres".
   */
  preset?: PostgresMemoryServerPreset;

  /**
   * Version string for the selected preset.
   *
   * For the "paradedb" preset, this specifies the ParadeDB extension version
   * (e.g., "0.22.5" or "0.22.5-pg17"). The PG suffix, if present, is validated
   * against the installed embedded-postgres version.
   *
   * For the "postgres" preset, this is ignored — the PostgreSQL version is
   * determined by the installed `embedded-postgres` npm package version.
   *
   * Ignored when `image` is provided (Docker fallback).
   */
  version?: string;

  /**
   * @deprecated Docker images are no longer used. This option is ignored.
   * The PostgreSQL version is determined by the `embedded-postgres` npm package.
   */
  image?: string;

  /** Database name created inside the instance. Defaults to "testdb". */
  database?: string;

  /** Username for the test database. Defaults to "testuser". */
  username?: string;

  /** Password for the test database. Defaults to "testpassword". */
  password?: string;

  /**
   * Extensions to create after the server starts.
   * Each entry becomes CREATE EXTENSION IF NOT EXISTS <name>.
   *
   * For the "paradedb" preset, defaults to ["pg_search"].
   * Note: pgvector ("vector") is not bundled — install it separately if needed.
   */
  extensions?: string[];

  /** Additional SQL statements to run after the server starts. */
  initSql?: string[];
}

export interface NormalizedPostgresMemoryServerOptions {
  preset: PostgresMemoryServerPreset;
  version?: string;
  /** Descriptive label (e.g., "postgres:18" or "paradedb:0.22.5-pg18"). */
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
