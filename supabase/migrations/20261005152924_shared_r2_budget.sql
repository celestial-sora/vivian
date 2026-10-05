-- Models and scenes share 8 decimal GB; 2 GB of the 10 GB allowance stays unused.
-- Keep existing category/ownership rows; the categories are only a breakdown.
alter table public.vivian_storage_quotas drop constraint vivian_storage_quotas_check1;
update public.vivian_storage_quotas set limit_bytes = 8000000000;
alter table public.vivian_storage_quotas add constraint vivian_storage_shared_limit check (limit_bytes = 8000000000);

create or replace function public.vivian_storage_accounting() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'DELETE') then
    -- Lock BOTH counters in the same order for inserts, deletes and observations.
    -- A concurrent model and scene cannot each spend the last shared bytes.
    perform category from public.vivian_storage_quotas order by category for update;
    if tg_op = 'INSERT' then
      if (select count(*) from public.vivian_storage_quotas) <> 2 or
        (select sum(used_bytes + external_bytes) from public.vivian_storage_quotas) + new.byte_size > 8000000000 then
        raise exception 'Storage quota exceeded' using errcode = '23514';
      end if;
      update public.vivian_storage_quotas set used_bytes = used_bytes + new.byte_size where category = new.category;
      if not found then raise exception 'Storage quota missing' using errcode = '23514'; end if;
      return new;
    end if;
    update public.vivian_storage_quotas set used_bytes = used_bytes - old.byte_size where category = old.category;
    return old;
  elsif new.category <> old.category or new.byte_size <> old.byte_size or new.object_key <> old.object_key or new.id <> old.id then
    raise exception 'Storage reservation is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create or replace function public.vivian_storage_observe(live2d_bytes bigint, other_bytes bigint) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if live2d_bytes is null or other_bytes is null or live2d_bytes < 0 or other_bytes < 0 then
    raise exception 'Invalid observed usage' using errcode = '22023';
  end if;
  perform category from public.vivian_storage_quotas order by category for update;
  update public.vivian_storage_quotas set external_bytes = live2d_bytes where category = 'live2d';
  update public.vivian_storage_quotas set external_bytes = other_bytes where category = 'other';
end;
$$;
-- Existing service-only grants and RLS are preserved by CREATE OR REPLACE.
-- Legacy private Supabase scenes and new original-format scenes share this bucket.
update storage.buckets set allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif'] where id = 'vivian-scenes';
