# postgres-memory-server

Spin up a disposable **real** PostgreSQL or ParadeDB instance in tests with a tiny API inspired by `mongodb-memory-server` and `redisjson-memory-server`.

This package does **not** emulate Postgres. It starts an actual PostgreSQL process using native binaries — **no Docker required**.

## Why this exists

For Postgres extension-heavy workloads, especially ParadeDB + `pgvector`, a real database is usually what you want in tests:

- no shared local database contamination
- deterministic integration tests
- realistic extension behavior
- straightforward CI/CD setup — no Docker daemon needed
- one API for plain Postgres and ParadeDB

## Features

- Start a disposable Postgres instance with `create()` — no Docker
- PostgreSQL binaries bundled via [`embedded-postgres`](https://github.com/leinelissen/embedded-postgres)
- ParadeDB `pg_search` and `pgvector` extensions auto-downloaded from official releases
- Get a ready-to-use connection string with `getUri()`
- Run SQL strings, SQL files, or a migrations directory
- Snapshot and restore database state between tests
- Extension binaries cached in `~/.cache/postgres-memory-server/`
- CLI for local scripts and debugging

## Requirements

- Node.js 20+

That's it. No Docker, no system Postgres installation needed.

## Install

```bash
npm install -D postgres-memory-server
```

The `pg` client library is included as a dependency.

## Quick start

```ts
import { PostgresMemoryServer } from "postgres-memory-server";
import { Client } from "pg";

const db = await PostgresMemoryServer.create();

const client = new Client({ connectionString: db.getUri() });
await client.connect();
await client.query("select 1");
await client.end();

await db.stop();
```

## ParadeDB quick start

```ts
import { PostgresMemoryServer } from "postgres-memory-server";

const db = await PostgresMemoryServer.createParadeDb();

await db.runSql(`
  CREATE TABLE documents (
    id bigserial primary key,
    title text not null,
    content text not null,
    embedding vector(3)
  );
`);

await db.stop();
```

By default, the ParadeDB preset automatically downloads and installs the extensions, then runs:

```sql
CREATE EXTENSION IF NOT EXISTS pg_search;
CREATE EXTENSION IF NOT EXISTS vector;
```

Extension binaries are downloaded once and cached in `~/.cache/postgres-memory-server/`.

- `pg_search` is downloaded from [ParadeDB GitHub releases](https://github.com/paradedb/paradedb/releases)
- `pgvector` is downloaded from [Homebrew bottles](https://formulae.brew.sh/formula/pgvector) (covers macOS + Linux)

## How it works

Instead of Docker containers, this package uses:

1. **[embedded-postgres](https://github.com/leinelissen/embedded-postgres)** — bundles PostgreSQL binaries as npm packages (~10MB). The PostgreSQL version is determined by the installed `embedded-postgres` npm package version (e.g., `embedded-postgres@18.x` = PostgreSQL 18).

2. **Native extension installation** — for the ParadeDB preset, `pg_search` and `pgvector` extension binaries are downloaded from their official release channels, extracted, and installed into the embedded PostgreSQL directory.

3. **Template database snapshots** — `snapshot()` and `restore()` use PostgreSQL's native `CREATE DATABASE ... TEMPLATE` for fast, zero-copy test isolation.

### PostgreSQL version

The PostgreSQL version is tied to the `embedded-postgres` npm package version. To use a specific PG version:

```bash
# PG 18 (default with latest embedded-postgres)
npm install -D embedded-postgres

# PG 17
npm install -D embedded-postgres@17.9.0-beta.16

# PG 16
npm install -D embedded-postgres@16.8.0-beta.16
```

### Platform support

| Platform | Postgres | ParadeDB pg_search | pgvector |
|----------|----------|--------------------|----------|
| macOS arm64 (Apple Silicon) | Yes | Yes | Yes |
| macOS x64 (Intel) | Yes | No | Yes |
| Linux x64 | Yes | Yes | Yes |
| Linux arm64 | Yes | Yes | Yes |
| Windows x64 | Yes | No | No |

## API

### `PostgresMemoryServer.create(options?)`

Create a disposable Postgres instance.

```ts
const db = await PostgresMemoryServer.create({
  database: "testdb",
  username: "testuser",
  password: "testpassword",
});
```

### `PostgresMemoryServer.createPostgres(options?)`

Convenience alias for the plain Postgres preset.

```ts
const db = await PostgresMemoryServer.createPostgres();
```

### `PostgresMemoryServer.createParadeDb(options?)`

Starts a Postgres instance with ParadeDB extensions (pg_search + pgvector).

```ts
const db = await PostgresMemoryServer.createParadeDb();
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `preset` | `"postgres" \| "paradedb"` | `"postgres"` | Controls default extensions |
| `version` | `string` | — | ParadeDB extension version (e.g., `"0.22.5"`) |
| `database` | `string` | `"testdb"` | Database name |
| `username` | `string` | `"testuser"` | Username |
| `password` | `string` | `"testpassword"` | Password |
| `extensions` | `string[]` | preset default | Extensions to create |
| `initSql` | `string[]` | `[]` | SQL statements to run after setup |

### `createJestGlobalSetup(options?)`

Starts one disposable database process for a Jest run and injects its URI into `DATABASE_URL` by default.

### `createJestGlobalTeardown(options?)`

Stops the process started by `createJestGlobalSetup()`.

### Instance methods

- `getUri()` — connection string (`postgres://...`)
- `getHost()` — always `localhost`
- `getPort()` — randomly assigned free port
- `getDatabase()`
- `getUsername()`
- `getPassword()`
- `getConnectionOptions()` — `{ host, port, database, user, password }`
- `getImage()` — descriptive label (e.g., `"postgres:18"`)
- `query(text, params?)` — execute a query and return rows
- `withClient(callback)` — direct access to a `pg.Client`
- `runSql(sql)` — execute one or more SQL statements
- `runSqlFile(filePath)` — execute SQL from a file
- `runMigrationsDir(dirPath)` — run `.sql` files in lexicographic order
- `snapshot()` — create a restore point
- `restore()` — restore to last snapshot
- `stop()` — shut down the PostgreSQL process

## Snapshots

```ts
const db = await PostgresMemoryServer.create();

await db.runSql([
  "create table users (id serial primary key, email text not null)",
  "insert into users (email) values ('first@example.com')",
]);

await db.snapshot();

await db.runSql("insert into users (email) values ('second@example.com')");

await db.restore();

const result = await db.query<{ count: string }>(
  "select count(*)::text as count from users",
);
console.log(result.rows[0]?.count); // 1
```

Snapshots use PostgreSQL template databases under the hood. Use a non-system database name (the default `testdb` works).

## Running SQL files or migrations

```ts
await db.runSqlFile("./sql/001_init.sql");
await db.runMigrationsDir("./sql/migrations");
```

Migration files are run in lexicographic order.

## CLI

```bash
npx postgres-memory-server --preset paradedb
```

Example output:

```bash
POSTGRES_MEMORY_SERVER_URI=postgres://testuser:testpassword@localhost:54329/testdb
POSTGRES_MEMORY_SERVER_HOST=localhost
POSTGRES_MEMORY_SERVER_PORT=54329
POSTGRES_MEMORY_SERVER_DATABASE=testdb
POSTGRES_MEMORY_SERVER_USERNAME=testuser
POSTGRES_MEMORY_SERVER_PASSWORD=testpassword

Press Ctrl+C to stop the server.
```

### CLI flags

```bash
--preset postgres|paradedb
--version <tag>
--database <name>
--username <name>
--password <password>
--extension <name>      # repeatable
--init-file <path>      # repeatable
--json
```

## Jest global setup

```ts
// jest.global-setup.ts
import { createJestGlobalSetup } from "postgres-memory-server";

export default createJestGlobalSetup({
  preset: "paradedb",
});
```

```ts
// jest.global-teardown.ts
import { createJestGlobalTeardown } from "postgres-memory-server";

export default createJestGlobalTeardown();
```

```ts
// jest.config.ts
import type { Config } from "jest";

const config: Config = {
  globalSetup: "./jest.global-setup.ts",
  globalTeardown: "./jest.global-teardown.ts",
  testEnvironment: "node",
};

export default config;
```

After setup runs, your tests can connect through `process.env.DATABASE_URL`.

## Vitest example

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresMemoryServer } from "postgres-memory-server";

describe("db", () => {
  let db: PostgresMemoryServer;

  beforeAll(async () => {
    db = await PostgresMemoryServer.create();
    await db.runSql(`
      create table notes (
        id serial primary key,
        body text not null
      );
    `);
    await db.snapshot();
  });

  beforeEach(async () => {
    await db.restore();
  });

  afterAll(async () => {
    await db.stop();
  });

  it("starts from a clean snapshot", async () => {
    await db.runSql("insert into notes (body) values ('hello')");
    const result = await db.query<{ count: string }>(
      "select count(*)::text as count from notes",
    );
    expect(result.rows[0]?.count).toBe("1");
  });
});
```

## Migrating from v0.1.0 (Docker-based)

v0.2.0 replaces Docker containers with native binaries. Key changes:

| v0.1.0 | v0.2.0 |
|--------|--------|
| Requires Docker daemon | No Docker needed |
| `@testcontainers/postgresql` | `embedded-postgres` |
| PG version via `version` option | PG version via `embedded-postgres` npm version |
| `image` option for Docker images | `image` option deprecated (ignored) |
| Container snapshots | Template database snapshots |

**Breaking changes:**
- The `image` option is deprecated and ignored. Remove it from your code.
- The `version` option for the `postgres` preset is ignored — install the desired `embedded-postgres@<version>` package instead.
- The `version` option for the `paradedb` preset now refers to the ParadeDB extension version (e.g., `"0.22.5"`), not the Docker image tag.

**No changes needed if** you only used `create()`, `createPostgres()`, or `createParadeDb()` with just `database`, `username`, `password`, or `extensions` options.

## Caveats

- The PostgreSQL version is determined by the installed `embedded-postgres` npm package, not by a runtime option.
- ParadeDB `pg_search` requires macOS arm64 or Linux. Intel Macs and Windows are not supported for ParadeDB.
- Snapshot and restore terminate other connections to the database during the operation.
- The package is ESM-only.

## Test scripts

```bash
npm run test:postgres
npm run test:paradedb
```

## License

MIT
