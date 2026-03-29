import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresMemoryServer } from "../../src/index.js";

describe("notes repository", () => {
  let db: PostgresMemoryServer;

  beforeAll(async () => {
    db = await PostgresMemoryServer.create();
    await db.runSql(`
      CREATE TABLE notes (
        id serial primary key,
        body text not null
      )
    `);
    await db.snapshot();
  });

  beforeEach(async () => {
    await db.restore();
  });

  afterAll(async () => {
    await db.stop();
  });

  it("starts every test from the same snapshot", async () => {
    await db.runSql("INSERT INTO notes (body) VALUES ('hello world')");
    const result = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM notes");
    expect(result.rows[0]?.count).toBe("1");
  });
});
