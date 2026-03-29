import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresMemoryServer } from "../../src/index.js";

describe("ParadeDB hybrid search", () => {
  let db: PostgresMemoryServer;

  beforeAll(async () => {
    db = await PostgresMemoryServer.createParadeDb();

    await db.runSql(`
      CREATE TABLE documents (
        id bigserial PRIMARY KEY,
        title text NOT NULL,
        content text NOT NULL,
        embedding vector(3) NOT NULL
      );

      CREATE INDEX documents_bm25_idx
      ON documents
      USING bm25 (id, title, content)
      WITH (key_field = 'id');

      INSERT INTO documents (title, content, embedding)
      VALUES
        ('Running shoes', 'Lightweight running shoes for daily running and training', '[1,0,0]'),
        ('Metal keyboard', 'Ergonomic keyboard for programmers', '[0,1,0]'),
        ('Trail shoes', 'Durable trail shoes for hiking and rough terrain', '[0.9,0.1,0]');
    `);
  });

  afterAll(async () => {
    await db.stop();
  });

  it("returns lexical results ordered by BM25 score", async () => {
    const result = await db.query<{ title: string }>(`
      SELECT title
      FROM documents
      WHERE content ||| 'running shoes'
      ORDER BY pdb.score(id) DESC, id ASC
      LIMIT 2
    `);

    expect(result.rows[0]?.title).toBe("Running shoes");
  });
});
