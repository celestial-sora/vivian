-- Read-only aggregate; no file keys or user records reach the Status panel.
create function public.vivian_supabase_storage_bytes() returns bigint
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(case when metadata->>'size' ~ '^[0-9]{1,15}$'
    then (metadata->>'size')::bigint else 0 end), 0)::bigint
  from storage.objects;
$$;
revoke execute on function public.vivian_supabase_storage_bytes() from public, anon, authenticated;
grant execute on function public.vivian_supabase_storage_bytes() to service_role;
grant usage on schema storage to service_role;
grant select on storage.objects to service_role;
