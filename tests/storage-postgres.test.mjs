/** Uses only a disposable local Postgres container; never a live Supabase DB. */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const container = process.env.STORAGE_TEST_CONTAINER ?? "vivian-r2-postgres";
const database = `vivian_storage_tests_${process.pid}`;
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const dockerEnv = { ...process.env };
for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete dockerEnv[key];
async function sql(query, db = database) {
  const result = await run("docker", ["--host=unix:///var/run/docker.sock", "exec", container, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", query], { env: dockerEnv });
  return result.stdout.trim();
}
before(async () => {
  await sql(`create database ${database}`, "postgres");
  await sql(`
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
    end $$;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, metadata jsonb);
  `);
  await sql(readFileSync(new URL("../supabase/migrations/20261003032056_dynamic_scenes.sql", import.meta.url), "utf8"));
  await sql(readFileSync(new URL("../supabase/migrations/20261005131311_private_r2_storage.sql", import.meta.url), "utf8"));
  await sql(readFileSync(new URL("../supabase/migrations/20261005133532_storage_status.sql", import.meta.url), "utf8"));
}, { timeout: 30000 });
after(async () => { await sql(`drop database if exists ${database} with (force)`, "postgres"); });
const insert = (bytes, category = "live2d", user = owner) => `insert into public.vivian_storage_objects(id,user_id,category,object_key,byte_size) values(gen_random_uuid(),'${user}','${category}',gen_random_uuid()::text,${bytes});`;
const reset = () => sql("delete from public.vivian_storage_objects;");
test("Status measures real Supabase object sizes and its aggregate RPC is service-only", async () => {
  await sql(`insert into storage.objects(bucket_id,metadata) values('scenes','{"size":100}'),('other','{"size":250}'),('empty','{}'),('invalid','{"size":"unknown"}')`);
  assert.equal(await sql("set role service_role; select public.vivian_supabase_storage_bytes()"), "350");
  await assert.rejects(sql("set role anon; select public.vivian_supabase_storage_bytes()"));
  await assert.rejects(sql("set role authenticated; select public.vivian_supabase_storage_bytes()"));
});
test("real SQL enforces model size, immutable reservations, and denies browser table access", async () => {
  await assert.rejects(sql(insert(536870913)));
  assert.equal(await sql("select sum(used_bytes) from public.vivian_storage_quotas"), "0");
  await sql(insert(536870912));
  await assert.rejects(sql("update public.vivian_storage_objects set byte_size=1"));
  await assert.rejects(sql("set role anon; select * from public.vivian_storage_objects"));
  await assert.rejects(sql("set role authenticated; insert into public.vivian_storage_objects(id,category,object_key,byte_size) values(gen_random_uuid(),'live2d','forged',1)"));
  assert.equal(await sql("select relrowsecurity from pg_class where relname='vivian_storage_objects'"), "t");
  await reset();
});
test("global quotas count both accounts and pending/deleting files; exact 2 GB accepted", async () => {
  await sql(Array.from({ length: 4 }, (_, index) => insert(500000000, "other", index % 2 ? other : owner)).join("\n"));
  await sql("update public.vivian_storage_objects set state='deleting'");
  assert.equal(await sql("select used_bytes from public.vivian_storage_quotas where category='other'"), "2000000000");
  await assert.rejects(sql(insert(1, "other")));
  await sql(insert(1, "live2d"));
  await sql("delete from public.vivian_storage_objects where category='other' and id=(select id from public.vivian_storage_objects where category='other' limit 1)");
  assert.equal(await sql("select used_bytes from public.vivian_storage_quotas where category='other'"), "1500000000");
  await reset();
});
test("parallel uploads cannot oversubscribe the last 100 MB of the global Live2D quota", async () => {
  await sql(Array.from({ length: 15 }, () => insert(500000000)).join("\n") + insert(400000000));
  const first = sql(`begin; ${insert(100000000)} select pg_sleep(0.5); commit;`);
  const second = new Promise((resolve) => setTimeout(resolve, 100)).then(() => sql(insert(100000000, "live2d", other)));
  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.match(results.find((result) => result.status === "rejected").reason.stderr, /Storage quota exceeded/);
  assert.equal(await sql("select used_bytes from public.vivian_storage_quotas where category='live2d'"), "8000000000");
  await reset();
});
test("multi-row scene reservation rolls back entirely if thumbnail would cross other quota", async () => {
  await sql(Array.from({ length: 3 }, () => insert(500000000, "other")).join("\n") + insert(499999990, "other"));
  await assert.rejects(sql(`insert into public.vivian_storage_objects(id,user_id,category,object_key,byte_size) values(gen_random_uuid(),'${owner}','other','scene-image',8),(gen_random_uuid(),'${owner}','other','scene-thumbnail',8)`));
  assert.equal(await sql("select used_bytes from public.vivian_storage_quotas where category='other'"), "1999999990");
  assert.equal(await sql("select count(*) from public.vivian_storage_objects where object_key in ('scene-image','scene-thumbnail')"), "0");
  await reset();
});
test("scene deletion queues its original provider; Auth deletion keeps remote bytes reserved", async () => {
  await sql(`insert into public.vivian_scenes(id,user_id,label,image_key,source_type,storage_provider) values(gen_random_uuid(),'${owner}','Private scene','original.webp','upload','r2'); delete from public.vivian_scenes;`);
  assert.equal(await sql("select storage_provider from public.vivian_scene_image_gc where image_key='original.webp'"), "r2");
  await sql(insert(100, "live2d", other));
  await sql(`delete from auth.users where id='${other}'`);
  assert.equal(await sql("select used_bytes from public.vivian_storage_quotas where category='live2d'"), "100");
  assert.equal(await sql("select count(*) from public.vivian_storage_objects where user_id is null"), "1");
  await reset();
});
