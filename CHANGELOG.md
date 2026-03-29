# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

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

[0.1.0]: https://github.com/amanthegreatone/postgres-memory-server/releases/tag/v0.1.0
