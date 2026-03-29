import { describe, expect, it } from "vitest";

import { PostgresMemoryServer } from "../src/index.js";

describe("PostgresMemoryServer", () => {
  it("starts a default Postgres container and runs SQL", async () => {
    const db = await PostgresMemoryServer.create();

    try {
      expect(db.getDatabase()).toBe("testdb");
      expect(db.getUri()).toContain("postgres://");

      await db.runSql([
        "CREATE TABLE users (id serial primary key, email text not null)",
        "INSERT INTO users (email) VALUES ('alice@example.com')",
      ]);

      const result = await db.query<{ email: string }>("SELECT email FROM users");
      expect(result.rows).toEqual([{ email: "alice@example.com" }]);
    } finally {
      await db.stop();
    }
  });
});
