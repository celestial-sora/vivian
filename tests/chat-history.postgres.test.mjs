/** Disposable PostgreSQL only; never uses production Supabase credentials. */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
const run = promisify(execFile);
const container = process.env.HISTORY_TEST_CONTAINER ?? "vivian-history-postgres";
const runtime = process.env.HISTORY_TEST_RUNTIME ?? "podman";
const database = `vivian_history_test_${process.pid}`;
const id = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000002";
async function sql(query, db = database) {
  const result = await run(runtime, ["exec", container, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", query]);
  return result.stdout.trim();
}
before(async () => {
  await sql(`create database ${database}`, "postgres");
  await sql("create role anon; create role authenticated; create role service_role bypassrls;");
  await sql(readFileSync(new URL("../supabase/migrations/20260829000000_vivian_memory.sql", import.meta.url), "utf8"));
  await sql(`insert into conversations(id,title) values('${id}','Legacy'); insert into messages(conversation_id,role,content) values('${id}','user','Preserved legacy message');`);
  await sql(readFileSync(new URL("../supabase/migrations/20261006005533_cloud_conversation_history.sql", import.meta.url), "utf8"));
});
after(async () => { await sql(`drop database if exists ${database} with (force)`, "postgres"); });
const append = (message = messageId, content = "hello", thread = id, create = true, role = "user") => `select vivian_save_conversation('${thread}','Title','${JSON.stringify([{ id: message, role, content, created_at: "2026-10-06T00:00:00Z" }])}'::jsonb,${create})`;
test("migration preserves old messages and assigns stable cloud IDs", async () => {
  assert.equal(await sql(`select content from messages where conversation_id='${id}'`), "Preserved legacy message");
  assert.equal(await sql("select count(*) from messages where client_message_id is null"), "0");
});
test("history tables and transactional append RPC are service-only", async () => {
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(sql(`set role ${role}; select * from conversations`));
    await assert.rejects(sql(`set role ${role}; select * from messages`));
    await assert.rejects(sql(`set role ${role}; ${append()}`));
  }
  await sql(`set role service_role; ${append()}`);
  assert.equal(await sql("select bool_and(relrowsecurity) from pg_class where relname in ('conversations','messages')"), "t");
});
test("retries cannot duplicate or overwrite messages; concurrent devices retain both additions", async () => {
  await sql(append()); await sql(append(messageId, "poisoned overwrite"));
  assert.equal(await sql(`select content from messages where client_message_id='${messageId}'`), "hello");
  const ids = ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004"];
  await Promise.all(ids.map((value) => sql(append(value))));
  assert.equal(await sql(`select count(*) from messages where conversation_id='${id}'`), "4");
});
test("invalid batches roll back thread creation; deleted threads cannot be resurrected by existing-thread sync", async () => {
  const thread = "00000000-0000-4000-8000-000000000005";
  await assert.rejects(sql(append(messageId, "hello", thread, true, "system")));
  assert.equal(await sql(`select count(*) from conversations where id='${thread}'`), "0");
  await sql(append(messageId, "hello", thread));
  await sql(`delete from conversations where id='${thread}'`);
  await assert.rejects(sql(append(messageId, "hello", thread, false)));
  assert.equal(await sql(`select count(*) from messages where conversation_id='${thread}'`), "0");
});
test("shared default identity cannot append to another identity", async () => {
  const other = "00000000-0000-4000-8000-000000000006";
  await sql(`insert into conversations(id,user_key) values('${other}','other')`);
  await assert.rejects(sql(append(messageId, "hello", other)));
  assert.equal(await sql(`select count(*) from messages where conversation_id='${other}'`), "0");
});
