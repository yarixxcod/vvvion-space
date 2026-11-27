import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { feedSelect, parseFeedQuery, EMPTY_FEED_QUERY } from "./feed-query.ts";

test("feed query validates dates and allowlists sort and paging", () => {
  assert.throws(() => parseFeedQuery({ after: "not a date" }));
  assert.throws(() => parseFeedQuery({ after: "2026-12-02", before: "2026-12-01" }));
  assert.equal(parseFeedQuery({ sort: "drop table posts", offset: -3 }).sort, "newest");
  assert.equal(parseFeedQuery({ minLikes: -1, offset: 1e8 }).offset, 10000);
  assert.equal(parseFeedQuery({ likedOnly: "true" }).likedOnly, false);
});
test("real PostgreSQL search, visibility, dates, likes and pagination", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create table "user"(id text primary key,name text,image text);create table posts(id text primary key,body text,user_id text,created_at timestamptz,parent_id text,hidden_at timestamptz);create table post_likes(post_id text,user_id text);insert into "user" values('me','Я',null),('other','Друг',null);`,
    );
    for (let i = 0; i < 46; i++)
      await db.query("insert into posts values($1,$2,$3,$4,null,null)", [
        String(i).padStart(3, "0"),
        i === 0 ? "<div>Старый #Музыка 100% a_b</div>" : i === 1 ? "#музыкант" : "Обычный пост",
        "other",
        new Date(Date.UTC(2026, 10, 1 + i)).toISOString(),
      ]);
    await db.exec(
      `insert into posts values('hidden','Старый #Музыка','other',now(),null,now()),('reply','Старый #Музыка','other',now(),'000',null);insert into post_likes values('000','me'),('000','other'),('001','other');`,
    );
    async function run(p = {}) {
      const q = feedSelect("me", parseFeedQuery({ ...EMPTY_FEED_QUERY, ...p }));
      return (await db.query(q.sql, q.values)).rows as Array<{
        id: string;
        likes: number;
        replies: number;
      }>;
    }
    assert.deepEqual(
      (await run({ query: "#музыка" })).map((r) => r.id),
      ["000"],
    );
    assert.deepEqual(
      (await run({ query: "старый 100% a_b" })).map((r) => r.id),
      ["000"],
    );
    assert.equal((await run({ query: "' OR 1=1 --" })).length, 0);
    assert.equal((await run({ query: "<div>" })).length, 0);
    assert.equal((await run({ query: "100_" })).length, 0);
    assert.equal((await run({ sort: "likes" }))[0].id, "000");
    assert.deepEqual(
      (await run({ minLikes: 2 })).map((r) => r.id),
      ["000"],
    );
    assert.deepEqual(
      (await run({ likedOnly: true })).map((r) => r.id),
      ["000"],
    );
    assert.deepEqual(
      (await run({ after: "2026-11-01T00:00:00Z", before: "2026-11-02T00:00:00Z" })).map(
        (r) => r.id,
      ),
      ["000"],
    );
    assert.equal((await run()).length, 41);
    assert.equal((await run({ offset: 40 })).length, 6);
    assert.equal((await run({ sort: "replies" }))[0].id, "000");
  } finally {
    await db.close();
  }
});
