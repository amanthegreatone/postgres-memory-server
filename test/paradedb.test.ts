import { describe, expect, it } from "vitest";

import { PostgresMemoryServer } from "../src/index.js";

describe("ParadeDB preset", () => {
  it("creates the pg_search and vector extensions", async () => {
    const db = await PostgresMemoryServer.createParadeDb();

    try {
      const result = await db.query<{ extname: string }>(`
        SELECT extname
        FROM pg_extension
        WHERE extname IN ('pg_search', 'vector')
        ORDER BY extname
      `);

      expect(result.rows).toEqual([{ extname: "pg_search" }, { extname: "vector" }]);
    } finally {
      await db.stop();
    }
  });
});
