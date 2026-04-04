import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARADEDB_IMAGE,
  DEFAULT_PARADEDB_VERSION,
  DEFAULT_PARADEDB_EXT_VERSION,
  DEFAULT_POSTGRES_IMAGE,
  DEFAULT_POSTGRES_VERSION,
  getImageForVersion,
  normalizeOptions,
} from "../src/index.js";

describe("version-based image resolution", () => {
  it("uses the default version constants to build the default image labels", () => {
    expect(DEFAULT_POSTGRES_IMAGE).toBe(`postgres:${DEFAULT_POSTGRES_VERSION}`);
    expect(DEFAULT_PARADEDB_IMAGE).toBe(
      `paradedb:${DEFAULT_PARADEDB_VERSION}`,
    );
  });

  it("derives the postgres version from embedded-postgres package", () => {
    // The PG version comes from the installed embedded-postgres npm package
    expect(Number(DEFAULT_POSTGRES_VERSION)).toBeGreaterThanOrEqual(16);
  });

  it("includes the paradedb extension version in the default paradedb version", () => {
    expect(DEFAULT_PARADEDB_VERSION).toContain(DEFAULT_PARADEDB_EXT_VERSION);
    expect(DEFAULT_PARADEDB_VERSION).toContain(
      `pg${DEFAULT_POSTGRES_VERSION}`,
    );
  });

  it("resolves a postgres image label from the version option", () => {
    expect(normalizeOptions({ version: "16" }).image).toBe("postgres:16");
  });

  it("resolves a ParadeDB image label from the version option", () => {
    expect(
      normalizeOptions({
        preset: "paradedb",
        version: "0.22.5-pg17",
      }).image,
    ).toBe("paradedb:0.22.5-pg17");
  });

  it("defaults paradedb extensions to pg_search and vector", () => {
    expect(
      normalizeOptions({ preset: "paradedb" }).extensions,
    ).toEqual(["pg_search", "vector"]);
  });

  it("exposes a helper for version-to-image conversion", () => {
    expect(getImageForVersion("postgres", "15")).toBe("postgres:15");
    expect(getImageForVersion("paradedb", "0.22.5-pg17")).toBe(
      "paradedb:0.22.5-pg17",
    );
  });
});
