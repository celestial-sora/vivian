create table if not exists public.vivian_voice_preferences (
  id text primary key check (id = 'global'),
  speaking_speed double precision not null default 0.98 check (speaking_speed between 0.8 and 1.2),
  updated_at timestamptz not null default now()
);
alter table public.vivian_voice_preferences enable row level security;
revoke all on public.vivian_voice_preferences from public, anon, authenticated;
grant select, insert, update on public.vivian_voice_preferences to service_role;
insert into public.vivian_voice_preferences (id) values ('global') on conflict (id) do nothing;
