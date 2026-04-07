# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [0.2.2] - 2026-04-07

### Fixed

- Apple Silicon (darwin-arm64): worked around a bug in `@embedded-postgres/darwin-arm64@18.3.0-beta.16` that ships every Mach-O file (3 binaries, 112 libraries and extensions) as a universal binary containing both `x86_64` and `arm64` slices. On affected Macs the universal `postgres` binary could hang indefinitely during `pg.start()`, manifesting as test suites stuck forever.

### Added

- `scripts/postinstall.cjs` runs automatically after `npm install`. On `darwin-arm64` it walks the installed `@embedded-postgres/darwin-arm64/native` tree, detects universal binaries, and thins them to `arm64` only using `lipo -thin arm64`. The script is a no-op on every other platform, on already-thin files, and on systems without `lipo`, and it never fails the install.
- Opt-out via `POSTGRES_MEMORY_SERVER_SKIP_THIN=1` for cases where upstream ships fixed binaries and thinning becomes unnecessary.
- Verbose logging via `POSTGRES_MEMORY_SERVER_THIN_VERBOSE=1` for debugging.

## [0.2.1] - 2026-04-06

### Added

- `PostgresMemoryServer.getDataDir()` returns the absolute path to the temporary PostgreSQL data directory. Useful for debugging and for tests that want to assert cleanup behavior.
- Test coverage for all data-directory cleanup paths: graceful `stop()`, `create()` failure, orphan sweep (stale pid, partial init, fresh races, live process), and SIGINT exit handler.

### Fixed

- Data directories under `$TMPDIR/postgres-memory-server-*` were leaking on disk when:
  - the test process was hard-killed (SIGKILL, timeouts) before `stop()` could run,
  - `create()` threw partway through (extension install or `pg.start()` failure), or
  - the underlying `embedded-postgres` `stop()` early-returned because its `process` field was unset.
- `stop()` now always removes the data directory, even when `pg.stop()` fails or never started.
- `create()` now wraps initialization in a try/catch that removes the data directory and stops any partially started postgres process before rethrowing.
- Registered `SIGINT`/`SIGTERM`/`SIGHUP`/`exit` handlers that synchronously remove all live instances' data directories on process exit. After cleanup, the original signal is re-raised so existing handlers and exit codes are preserved.
- The first `create()` call in a process now sweeps `$TMPDIR` for orphaned `postgres-memory-server-*` directories from crashed prior runs, identified by missing or stale `postmaster.pid` files. Live directories whose `postmaster.pid` points to a running process are always preserved, and dirs without a `postmaster.pid` file must be at least 60 seconds old before the sweep removes them — this protects concurrent test forks that have just `mkdtemp`'d a directory but have not yet finished `initdb`.

## [0.2.0] - 2026-04-05

### Changed

- **Breaking:** Replaced Docker containers with native PostgreSQL binaries via `embedded-postgres`. Docker is no longer required.
- **Breaking:** The `image` option is deprecated and ignored. The PostgreSQL version is now determined by the installed `embedded-postgres` npm package version.
- **Breaking:** The `version` option for the `postgres` preset is ignored. Install the desired `embedded-postgres@<version>` package instead.
- **Breaking:** The `version` option for the `paradedb` preset now refers to the ParadeDB extension version (e.g., `"0.22.5"`), not the Docker image tag.
- Snapshot and restore now use PostgreSQL template databases instead of Docker container snapshots.
- Replaced `@testcontainers/postgresql` dependency with `embedded-postgres`.

### Added

- Native binary PostgreSQL server — no Docker daemon needed.
- Automatic download and caching of ParadeDB `pg_search` extension from GitHub releases.
- Automatic download and caching of `pgvector` extension from Homebrew bottles (macOS + Linux).
- Extension binary cache at `~/.cache/postgres-memory-server/` to avoid re-downloading.
- Platform support table: macOS arm64/x64, Linux x64/arm64, Windows x64 (Postgres only).
- `ExtensionInstallError` error class for extension download/install failures.
- Migration guide in README for upgrading from v0.1.0.

### Removed

- Docker dependency (`@testcontainers/postgresql`).
- Docker-specific `--image` CLI flag (kept for backward compatibility but ignored).

## [0.1.0] - 2026-03-29

### Added

- Initial public release of `postgres-memory-server`.
- Disposable real PostgreSQL containers for integration tests using Testcontainers.
- ParadeDB preset support with automatic `pg_search` and `vector` extension setup.
- Version-based image selection with preset-aware repository resolution.
- Exact image override support for custom registries and tags.
- Snapshot and restore helpers for test isolation.
- SQL helpers for inline SQL, SQL files, and migration directories.
- CLI for starting ephemeral Postgres or ParadeDB instances locally.
- Jest global setup and teardown helpers for process-safe database lifecycle management.
- Vitest and ParadeDB example coverage.
- GitHub Actions CI split between plain Postgres and ParadeDB test suites.

[0.2.2]: https://github.com/amanthegreatone/postgres-memory-server/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/amanthegreatone/postgres-memory-server/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/amanthegreatone/postgres-memory-server/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/amanthegreatone/postgres-memory-server/releases/tag/v0.1.0
