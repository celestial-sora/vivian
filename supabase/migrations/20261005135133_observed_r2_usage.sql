-- Fresh R2 inventory can reveal bytes outside app reservations.
-- Preserve app reservations; count additional observed bytes under the same lock.
alter table public.vivian_storage_quotas add column external_bytes bigint not null default 0 check (external_bytes >= 0);
create function public.vivian_storage_observe(live2d_bytes bigint, other_bytes bigint) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if live2d_bytes is null or other_bytes is null or live2d_bytes < 0 or other_bytes < 0 then
    raise exception 'Invalid observed usage' using errcode = '22023';
  end if;
  -- Consistent lock order across observations; upload inserts lock these rows too.
  update public.vivian_storage_quotas set external_bytes = live2d_bytes where category = 'live2d';
  update public.vivian_storage_quotas set external_bytes = other_bytes where category = 'other';
end;
$$;
revoke execute on function public.vivian_storage_observe(bigint, bigint) from public, anon, authenticated;
grant execute on function public.vivian_storage_observe(bigint, bigint) to service_role;

create or replace function public.vivian_storage_accounting() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- This conditional UPDATE locks one global category row and rechecks the
    -- balance after a concurrent transaction commits. Pending/deleting files count.
    update public.vivian_storage_quotas set used_bytes = used_bytes + new.byte_size
    where category = new.category and used_bytes + external_bytes + new.byte_size <= limit_bytes;
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
