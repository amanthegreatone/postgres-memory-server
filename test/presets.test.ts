import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARADEDB_IMAGE,
  DEFAULT_PARADEDB_VERSION,
  DEFAULT_POSTGRES_IMAGE,
  DEFAULT_POSTGRES_VERSION,
  getImageForVersion,
  normalizeOptions,
} from "../src/index.js";

describe("version-based image resolution", () => {
  it("uses the default version constants to build the default images", () => {
    expect(DEFAULT_POSTGRES_IMAGE).toBe(`postgres:${DEFAULT_POSTGRES_VERSION}`);
    expect(DEFAULT_PARADEDB_IMAGE).toBe(
      `paradedb/paradedb:${DEFAULT_PARADEDB_VERSION}`,
    );
  });

  it("resolves a postgres image from the version option", () => {
    expect(normalizeOptions({ version: "16" }).image).toBe("postgres:16");
  });

  it("resolves a ParadeDB image from the version option", () => {
    expect(
      normalizeOptions({
        preset: "paradedb",
        version: "0.22.3-pg16",
      }).image,
    ).toBe("paradedb/paradedb:0.22.3-pg16");
  });

  it("keeps image as the exact override when image and version are both provided", () => {
    expect(
      normalizeOptions({
        preset: "paradedb",
        version: "0.22.3-pg16",
        image: "ghcr.io/acme/paradedb:test-tag",
      }).image,
    ).toBe("ghcr.io/acme/paradedb:test-tag");
  });

  it("exposes a helper for version-to-image conversion", () => {
    expect(getImageForVersion("postgres", "15")).toBe("postgres:15");
    expect(getImageForVersion("paradedb", "0.22.3-pg17")).toBe(
      "paradedb/paradedb:0.22.3-pg17",
    );
  });
});
