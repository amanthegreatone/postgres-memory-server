import type {
  NormalizedPostgresMemoryServerOptions,
  PostgresMemoryServerOptions,
  PostgresMemoryServerPreset,
} from "./types.js";

export const POSTGRES_IMAGE_REPOSITORY = "postgres";
export const PARADEDB_IMAGE_REPOSITORY = "paradedb/paradedb";
export const DEFAULT_POSTGRES_VERSION = "17";
export const DEFAULT_PARADEDB_VERSION = "0.22.3-pg17";
export const DEFAULT_POSTGRES_IMAGE = getImageForVersion(
  "postgres",
  DEFAULT_POSTGRES_VERSION,
);
export const DEFAULT_PARADEDB_IMAGE = getImageForVersion(
  "paradedb",
  DEFAULT_PARADEDB_VERSION,
);

const DEFAULT_DATABASE = "testdb";
const DEFAULT_USERNAME = "testuser";
const DEFAULT_PASSWORD = "testpassword";

const PARADEDB_DEFAULT_EXTENSIONS = ["pg_search", "vector"];

export function normalizeOptions(
  options: PostgresMemoryServerOptions = {},
): NormalizedPostgresMemoryServerOptions {
  const preset = options.preset ?? "postgres";
  const version = options.version;
  const image = options.image ?? getImage(preset, version);
  const database = options.database ?? DEFAULT_DATABASE;
  const username = options.username ?? DEFAULT_USERNAME;
  const password = options.password ?? DEFAULT_PASSWORD;
  const extensions = options.extensions ?? getDefaultExtensions(preset);
  const initSql = options.initSql ?? [];

  return {
    preset,
    version,
    image,
    database,
    username,
    password,
    extensions,
    initSql,
  };
}

export function getImageForVersion(
  preset: PostgresMemoryServerPreset,
  version: string,
): string {
  const repository =
    preset === "paradedb"
      ? PARADEDB_IMAGE_REPOSITORY
      : POSTGRES_IMAGE_REPOSITORY;

  return `${repository}:${version}`;
}

export function getDefaultImage(preset: PostgresMemoryServerPreset): string {
  return preset === "paradedb"
    ? DEFAULT_PARADEDB_IMAGE
    : DEFAULT_POSTGRES_IMAGE;
}

function getImage(
  preset: PostgresMemoryServerPreset,
  version?: string,
): string {
  return version
    ? getImageForVersion(preset, version)
    : getDefaultImage(preset);
}

export function getDefaultExtensions(
  preset: PostgresMemoryServerPreset,
): string[] {
  return preset === "paradedb" ? [...PARADEDB_DEFAULT_EXTENSIONS] : [];
}

export function buildInitStatements(
  options: NormalizedPostgresMemoryServerOptions,
): string[] {
  const extensionStatements = options.extensions.map(
    (extension) =>
      `CREATE EXTENSION IF NOT EXISTS ${quoteIdentifier(extension)};`,
  );

  return [...extensionStatements, ...options.initSql];
}

function quoteIdentifier(name: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return name;
  }

  return `"${name.replaceAll('"', '""')}"`;
}
