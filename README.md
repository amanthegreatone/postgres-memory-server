# postgres-memory-server

Spin up a disposable **real** PostgreSQL or ParadeDB instance in tests with a tiny API inspired by `mongodb-memory-server` and `redisjson-memory-server`.

This package does **not** emulate Postgres. It starts an actual database container and gives you a normal Postgres connection string.

## Why this exists

For Postgres extension-heavy workloads, especially ParadeDB + `pgvector`, a real database is usually what you want in tests:

- no shared local database contamination
- deterministic integration tests
- realistic extension behavior
- straightforward CI/CD setup
- one API for plain Postgres and ParadeDB

## Features

- Start a disposable Postgres container with `create()`
- Get a ready-to-use connection string with `getUri()`
- Use the same API for plain Postgres or ParadeDB presets
- Run SQL strings, SQL files, or a migrations directory
- Snapshot and restore database state between tests
- CLI for local scripts and debugging

## Requirements

- Node.js 20+
- Docker available to the current user

## Install

```bash
npm install -D postgres-memory-server pg
```

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

By default, the ParadeDB preset uses the official ParadeDB image and runs:

```sql
CREATE EXTENSION IF NOT EXISTS pg_search;
CREATE EXTENSION IF NOT EXISTS vector;
```

The default image is pinned to `paradedb/paradedb:0.22.3-pg17` so local runs and CI stay reproducible.

If you want to test against a different Postgres or ParadeDB version, pass `version`. The package resolves the correct image repository for the selected preset.

```ts
const postgres16 = await PostgresMemoryServer.createPostgres({
  version: "16",
});

const paradeDbPg16 = await PostgresMemoryServer.createParadeDb({
  version: "0.22.3-pg16",
});
```

Use `image` when you want an exact override, such as a private registry, a custom build, or a nonstandard tag. When both `version` and `image` are provided, `image` wins.

## API

### `PostgresMemoryServer.create(options?)`

Create a disposable Postgres instance.

```ts
const db = await PostgresMemoryServer.create({
  version: "17",
  database: "testdb",
  username: "testuser",
  password: "testpassword",
});
```

### `PostgresMemoryServer.createPostgres(options?)`

Convenience alias for the plain Postgres preset.

```ts
const db = await PostgresMemoryServer.createPostgres({
  version: "15",
});
```

### `PostgresMemoryServer.createParadeDb(options?)`

Starts a ParadeDB container and creates the default extensions.

```ts
const db = await PostgresMemoryServer.createParadeDb({
  version: "0.22.3-pg17",
});
```

The preset still controls the default extensions. Overriding `version` or `image` only changes which container tag is started.

### `createJestGlobalSetup(options?)`

Starts one disposable database process for a Jest run and injects its URI into `DATABASE_URL` by default.

### `createJestGlobalTeardown(options?)`

Stops the process started by `createJestGlobalSetup()`.

### Instance methods

- `getUri()`
- `getHost()`
- `getPort()`
- `getDatabase()`
- `getUsername()`
- `getPassword()`
- `getConnectionOptions()`
- `query(text, params?)`
- `runSql(sql)`
- `runSqlFile(filePath)`
- `runMigrationsDir(dirPath)`
- `snapshot()`
- `restore()`
- `stop()`

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

Use a non-system database name when you plan to use snapshots. The package defaults to `testdb` for that reason.

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

To test a specific version from the CLI, pass `--version`:

```bash
npx postgres-memory-server --preset postgres --version 16
npx postgres-memory-server --preset paradedb --version 0.22.3-pg16
```

If you need an exact image reference instead, `--image` still works and takes precedence over `--version`.

Example output:

```bash
POSTGRES_MEMORY_SERVER_URI=postgres://testuser:testpassword@127.0.0.1:54329/testdb
POSTGRES_MEMORY_SERVER_HOST=127.0.0.1
POSTGRES_MEMORY_SERVER_PORT=54329
POSTGRES_MEMORY_SERVER_DATABASE=testdb
POSTGRES_MEMORY_SERVER_USERNAME=testuser
POSTGRES_MEMORY_SERVER_PASSWORD=testpassword
```

The CLI keeps the container alive until you exit with `Ctrl+C`.

### CLI flags

```bash
--preset postgres|paradedb
--version <tag>
--image <image>
--database <name>
--username <name>
--password <password>
--extension <name>      # repeatable
--init-file <path>      # repeatable
--json
```

## Test scripts

```bash
npm run test:postgres
npm run test:paradedb
```

These scripts are useful locally and are also what the GitHub Actions workflow uses.

## Jest global setup

```ts
// jest.global-setup.ts
import { createJestGlobalSetup } from "postgres-memory-server";

export default createJestGlobalSetup({
  preset: "paradedb",
  version: "0.22.3-pg16",
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

## Caveats

- This package depends on Docker. It is intentionally built around a real database, not an emulator.
- Snapshot and restore require no active client connections during those operations.
- The ParadeDB preset creates extensions in the target database, but you are still responsible for your schema, indexes, and test data.
- The package is ESM-only in this starter repo. If you need CJS, add a second build target.

## Publishing checklist

Before publishing:

1. update the package name in `package.json` if you plan to publish under a scope
2. update repository URLs in `package.json`
3. run `npm install`
4. run `npm test`
5. publish with `npm publish --access public`

## Roadmap

- reusable container mode
- worker-isolated databases
- Docker Compose / Podman engine adapters
- optional non-Docker backend

## License

MIT
