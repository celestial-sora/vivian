-- Reuse existing shared conversations/messages; retain all previously saved rows.
alter table public.messages add column client_message_id uuid not null default gen_random_uuid();
create unique index messages_conversation_client_idx on public.messages(conversation_id, client_message_id);
create index conversations_user_updated_idx on public.conversations(user_key, updated_at desc, id);
create index messages_conversation_id_idx on public.messages(conversation_id, id);
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
revoke all on public.conversations, public.messages from anon, authenticated;
grant select, insert, update, delete on public.conversations, public.messages to service_role;
grant usage, select on sequence public.messages_id_seq to service_role;

-- One transaction for thread + messages. Repeated batches and concurrent devices
-- append by immutable client message ID instead of replacing another device's data.
create or replace function public.vivian_save_conversation(p_id uuid, p_title text, p_messages jsonb, p_create boolean default true)
returns void language plpgsql security invoker set search_path = '' as $$
declare entry jsonb; owner_key text;
begin
  if p_id is null or p_title is null or length(trim(p_title)) not between 1 and 80
    or jsonb_typeof(p_messages) is distinct from 'array' or jsonb_array_length(p_messages) not between 1 and 100 then
    raise exception 'Invalid conversation data' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  if p_create then
    insert into public.conversations(id,user_key,title) values(p_id,'default',trim(p_title)) on conflict(id) do nothing;
  end if;
  select user_key into owner_key from public.conversations where id=p_id for update;
  if not found then raise exception 'Conversation no longer exists' using errcode='P0002'; end if;
  if owner_key <> 'default' then raise exception 'Conversation identity mismatch' using errcode='42501'; end if;
  for entry in select value from jsonb_array_elements(p_messages) loop
    if entry->>'role' not in ('user','assistant') or entry->>'role' is null
      or entry->>'id' is null or entry->>'created_at' is null
      or entry->>'content' is null or length(trim(entry->>'content')) not between 1 and 16000 then
      raise exception 'Invalid message' using errcode='22023';
    end if;
    insert into public.messages(conversation_id,client_message_id,role,content,created_at)
      values(p_id,(entry->>'id')::uuid,entry->>'role',entry->>'content',(entry->>'created_at')::timestamptz)
      on conflict(conversation_id,client_message_id) do nothing;
  end loop;
  update public.conversations set
    title = case when title in ('Daily Talk','Vivian conversation') then trim(p_title) else title end,
    updated_at = greatest(updated_at,(select max(created_at) from public.messages where conversation_id=p_id))
    where id=p_id;
end $$;
revoke all on function public.vivian_save_conversation(uuid,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.vivian_save_conversation(uuid,text,jsonb,boolean) to service_role;
