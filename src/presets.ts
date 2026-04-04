import { getPgMajorVersion, parseParadeDBVersion } from "./native.js";
import type {
  NormalizedPostgresMemoryServerOptions,
  PostgresMemoryServerOptions,
  PostgresMemoryServerPreset,
} from "./types.js";

export const DEFAULT_PARADEDB_EXT_VERSION = "0.22.5";
export const DEFAULT_POSTGRES_VERSION = getPgMajorVersion();
export const DEFAULT_PARADEDB_VERSION = `${DEFAULT_PARADEDB_EXT_VERSION}-pg${DEFAULT_POSTGRES_VERSION}`;

/** Descriptive label for the postgres preset. */
export const DEFAULT_POSTGRES_IMAGE = `postgres:${DEFAULT_POSTGRES_VERSION}`;

/** Descriptive label for the paradedb preset. */
export const DEFAULT_PARADEDB_IMAGE = `paradedb:${DEFAULT_PARADEDB_VERSION}`;

// Keep old constants for backward compatibility
export const POSTGRES_IMAGE_REPOSITORY = "postgres";
export const PARADEDB_IMAGE_REPOSITORY = "paradedb";

const DEFAULT_DATABASE = "testdb";
const DEFAULT_USERNAME = "testuser";
const DEFAULT_PASSWORD = "testpassword";

const PARADEDB_DEFAULT_EXTENSIONS = ["pg_search", "vector"];

export function normalizeOptions(
  options: PostgresMemoryServerOptions = {},
): NormalizedPostgresMemoryServerOptions {
  const preset = options.preset ?? "postgres";
  const version = options.version;
  const image = getImageLabel(preset, version);
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
    preset === "paradedb" ? PARADEDB_IMAGE_REPOSITORY : POSTGRES_IMAGE_REPOSITORY;

  return `${repository}:${version}`;
}

export function getDefaultImage(preset: PostgresMemoryServerPreset): string {
  return preset === "paradedb" ? DEFAULT_PARADEDB_IMAGE : DEFAULT_POSTGRES_IMAGE;
}

function getImageLabel(
  preset: PostgresMemoryServerPreset,
  version?: string,
): string {
  if (version) {
    return getImageForVersion(preset, version);
  }
  return getDefaultImage(preset);
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

/**
 * Resolve the ParadeDB extension version from the user-provided version string.
 * Validates that any PG version suffix matches the installed embedded-postgres.
 */
export function resolveParadeDBVersion(version?: string): string {
  if (!version) {
    return DEFAULT_PARADEDB_EXT_VERSION;
  }

  const parsed = parseParadeDBVersion(version);

  if (parsed.pgVersion) {
    const installedPg = DEFAULT_POSTGRES_VERSION;
    if (parsed.pgVersion !== installedPg) {
      throw new Error(
        `ParadeDB version "${version}" targets PostgreSQL ${parsed.pgVersion}, ` +
          `but embedded-postgres provides PostgreSQL ${installedPg}. ` +
          `Install embedded-postgres@${parsed.pgVersion}.x to match, ` +
          `or use version "${parsed.extVersion}" without the -pg suffix.`,
      );
    }
  }

  return parsed.extVersion;
}

function quoteIdentifier(name: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return name;
  }

  return `"${name.replaceAll('"', '""')}"`;
}
