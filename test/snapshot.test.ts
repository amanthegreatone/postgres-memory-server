import { describe, expect, it } from "vitest";

import { PostgresMemoryServer } from "../src/index.js";

describe("snapshots", () => {
  it("restores a prior database state", async () => {
    const db = await PostgresMemoryServer.create();

    try {
      await db.runSql([
        "CREATE TABLE notes (id serial primary key, body text not null)",
        "INSERT INTO notes (body) VALUES ('before snapshot')",
      ]);

      await db.snapshot();
      await db.runSql("INSERT INTO notes (body) VALUES ('after snapshot')");

      let result = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM notes");
      expect(result.rows[0]?.count).toBe("2");

      await db.restore();

      result = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM notes");
      expect(result.rows[0]?.count).toBe("1");
    } finally {
      await db.stop();
    }
  });
});
