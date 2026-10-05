-- Dedicated private R2 bucket. Decimal GB matches the free-tier billing unit.
create table public.vivian_storage_quotas (
  category text primary key check (category in ('live2d', 'other')),
  limit_bytes bigint not null,
  used_bytes bigint not null default 0 check (used_bytes >= 0 and used_bytes <= limit_bytes),
  check ((category = 'live2d' and limit_bytes = 8000000000) or (category = 'other' and limit_bytes = 2000000000))
);
insert into public.vivian_storage_quotas(category, limit_bytes) values ('live2d', 8000000000), ('other', 2000000000);
create table public.vivian_storage_objects (
  id uuid primary key,
  -- Preserve the ledger until remote deletion, even after an Auth user is removed.
  user_id uuid references auth.users(id) on delete set null,
  category text not null references public.vivian_storage_quotas(category),
  object_key text not null unique,
  byte_size bigint not null check (byte_size between 1 and 536870912),
  state text not null default 'pending' check (state in ('pending', 'ready', 'deleting')),
  upload_id text,
  metadata jsonb not null default '{}'::jsonb check (octet_length(metadata::text) <= 32768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vivian_storage_objects_owner on public.vivian_storage_objects(user_id, category, created_at);
alter table public.vivian_storage_quotas enable row level security;
alter table public.vivian_storage_objects enable row level security;
revoke all on public.vivian_storage_quotas, public.vivian_storage_objects from public, anon, authenticated;
grant all on public.vivian_storage_quotas, public.vivian_storage_objects to service_role;
-- No browser grants: all requests pass the app's verified account allowlist.
create function public.vivian_storage_accounting() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- This conditional UPDATE locks one global category row and rechecks the
    -- balance after a concurrent transaction commits. Pending/deleting files count.
    update public.vivian_storage_quotas set used_bytes = used_bytes + new.byte_size
    where category = new.category and used_bytes + new.byte_size <= limit_bytes;
    if not found then raise exception 'Storage quota exceeded' using errcode = '23514'; end if;
    return new;
  elsif tg_op = 'DELETE' then
    update public.vivian_storage_quotas set used_bytes = used_bytes - old.byte_size where category = old.category;
    return old;
  elsif new.category <> old.category or new.byte_size <> old.byte_size or new.object_key <> old.object_key or new.id <> old.id then
    raise exception 'Storage reservation is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger vivian_storage_accounting before insert or update or delete on public.vivian_storage_objects for each row execute function public.vivian_storage_accounting();
revoke execute on function public.vivian_storage_accounting() from public, anon, authenticated;

-- Existing scenes remain readable in Supabase; new scenes can opt into R2.
alter table public.vivian_scenes add column storage_provider text not null default 'supabase' check (storage_provider in ('supabase', 'r2'));
alter table public.vivian_scene_image_gc add column storage_provider text not null default 'supabase' check (storage_provider in ('supabase', 'r2'));
create or replace function public.vivian_scene_queue_image() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' or old.image_key <> new.image_key then
    insert into public.vivian_scene_image_gc(image_key, user_id, storage_provider)
    values(old.image_key, old.user_id, old.storage_provider) on conflict do nothing;
  end if;
  return old;
end;
$$;
revoke execute on function public.vivian_scene_queue_image() from public, anon, authenticated;
