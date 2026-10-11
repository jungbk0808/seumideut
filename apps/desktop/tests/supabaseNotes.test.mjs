import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const userA = "00000000-0000-4000-8000-000000000001";
const userB = "00000000-0000-4000-8000-000000000002";
const migration = await readFile(new URL("../../../supabase/migrations/20261008000100_create_notes.sql", import.meta.url), "utf8");

test("notes migration preserves data and enforces owner access in PostgreSQL", async (t) => {
  const db = await PGlite.create();
  t.after(() => db.close());
  // Minimal Supabase Auth fixture; roles have neither superuser nor BYPASSRLS.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await db.query("insert into auth.users values ($1), ($2)", [userA, userB]);
  await db.exec(migration);
  await db.query(`insert into public.notes
    (user_id, id, title, content, created_at, updated_at, is_pinned, schema_version)
    values ($1, 'legacy-note', '제목', E'# 한글🙂\n\t**본문**', '2026-08-25T00:00:00Z', '2026-10-08T00:00:00Z', true, 1),
           ($2, 'legacy-note', '다른 사용자', '비공개', '2026-08-25T00:00:00Z', '2026-10-08T00:00:00Z', false, 1)`, [userA, userB]);

  async function asRole(role, userId, run) {
    await db.exec("begin");
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
      await db.exec(`set local role ${role}`);
      await run();
    } finally {
      await db.exec("rollback");
    }
  }

  await t.test("owner can read every original field; identical legacy IDs are isolated", async () => {
    await asRole("authenticated", userA, async () => {
      const { rows } = await db.query("select * from public.notes");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].user_id, userA);
      assert.equal(rows[0].id, "legacy-note");
      assert.equal(rows[0].title, "제목");
      assert.equal(rows[0].content, "# 한글🙂\n\t**본문**");
      assert.equal(rows[0].created_at.toISOString(), "2026-08-25T00:00:00.000Z");
      assert.equal(rows[0].updated_at.toISOString(), "2026-10-08T00:00:00.000Z");
      assert.equal(rows[0].deleted_at, null);
      assert.equal(rows[0].is_pinned, true);
      assert.equal(rows[0].schema_version, 1);
    });
    await asRole("authenticated", userB, async () => {
      assert.deepEqual((await db.query("select title from public.notes")).rows, [{ title: "다른 사용자" }]);
    });
  });

  await t.test("anonymous users have no table privileges", async () => {
    for (const sql of ["select * from public.notes", "insert into public.notes (user_id,id) values ($1,'anon')", "update public.notes set title = 'bad'", "delete from public.notes"]) {
      await asRole("anon", null, () => assert.rejects(db.query(sql, sql.includes("$1") ? [userA] : []), { code: "42501" }));
    }
  });

  await t.test("authenticated role without a user cannot read or insert", async () => {
    await asRole("authenticated", null, async () => {
      assert.deepEqual((await db.query("select * from public.notes")).rows, []);
      await assert.rejects(db.query("insert into public.notes (user_id,id) values ($1,'no-user')", [userA]), { code: "42501" });
    });
  });

  await t.test("owner can create, update and soft delete; tombstones remain visible", async () => {
    await asRole("authenticated", userA, async () => {
      const { rows } = await db.query("insert into public.notes (user_id,id) values ($1,'new-note') returning *", [userA]);
      assert.equal(rows[0].content, "");
      assert.equal(rows[0].schema_version, 1);
      assert.equal(rows[0].is_pinned, false);
      const edited = await db.query(`update public.notes set title = '수정', content = '**내용**',
        updated_at = '2026-10-09T00:00:00Z', is_pinned = false, schema_version = 2,
        deleted_at = '2026-10-09T00:00:00Z' where id = 'legacy-note' returning *`);
      assert.equal(edited.rows.length, 1);
      assert.equal(edited.rows[0].content, "**내용**");
      assert.equal(edited.rows[0].schema_version, 2);
      assert.equal(edited.rows[0].deleted_at.toISOString(), "2026-10-09T00:00:00.000Z");
      assert.equal((await db.query("select * from public.notes where deleted_at is not null")).rows.length, 1);
    });
  });

  await t.test("forged owner inserts fail", async () => {
    await asRole("authenticated", userA, () => assert.rejects(
      db.query("insert into public.notes (user_id,id) values ($1,'forged')", [userB]), { code: "42501" }));
  });

  await t.test("duplicate imports fail instead of overwriting existing notes", async () => {
    await asRole("authenticated", userA, () => assert.rejects(
      db.query("insert into public.notes (user_id,id,content) values ($1,'legacy-note','덮어쓰기')", [userA]), { code: "23505" }));
    assert.equal((await db.query("select content from public.notes where user_id = $1", [userA])).rows[0].content, "# 한글🙂\n\t**본문**");
  });

  await t.test("another user's note cannot be updated or soft deleted", async () => {
    await asRole("authenticated", userA, async () => {
      const result = await db.query("update public.notes set content = 'bad', deleted_at = now() where user_id = $1 returning *", [userB]);
      assert.deepEqual(result.rows, []);
    });
  });

  await t.test("ownership, ID and creation time cannot be reassigned", async () => {
    for (const [field, value] of [["user_id", userB], ["id", "renamed"], ["created_at", "2026-10-01T00:00:00Z"]]) {
      await asRole("authenticated", userA, () => assert.rejects(
        db.query(`update public.notes set ${field} = $1 where id = 'legacy-note'`, [value]), { code: "42501" }));
    }
  });

  await t.test("physical deletion is denied even to the owner", async () => {
    await asRole("authenticated", userA, () => assert.rejects(db.query("delete from public.notes where id = 'legacy-note'"), { code: "42501" }));
  });

  await t.test("invalid IDs and schema versions fail without storing rows", async () => {
    for (const [id, version] of [[" ", 1], ["invalid-version", 0]]) {
      await asRole("authenticated", userA, () => assert.rejects(
        db.query("insert into public.notes (user_id,id,schema_version) values ($1,$2,$3)", [userA, id, version]), { code: "23514" }));
    }
  });
});
