create extension if not exists pgcrypto;

create table if not exists casadireta.properties (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  owner_name text not null default '',
  owner_phone text not null default '',
  type text not null,
  rooms integer not null check (rooms between 1 and 20),
  bairro text not null,
  reference_text text not null default '',
  price_mzn integer not null check (price_mzn >= 0),
  amenities text[] not null default '{}',
  advance_terms text not null default '1 mês adiantado',
  description text not null default '',
  exterior_paths text[] not null default '{}',
  interior_paths text[] not null default '{}',
  rented boolean not null default false,
  verified boolean not null default false,
  views integer not null default 0 check (views >= 0),
  contacts integer not null default 0 check (contacts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists casadireta_properties_feed_idx on casadireta.properties (rented, created_at desc);
create index if not exists casadireta_properties_owner_idx on casadireta.properties (owner_user_id, created_at desc);

create table if not exists casadireta.conversations (
  id text primary key,
  participant_a uuid not null references auth.users(id) on delete cascade,
  participant_b uuid not null references auth.users(id) on delete cascade,
  context jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (participant_a <> participant_b)
);
create index if not exists casadireta_conversations_participants_idx on casadireta.conversations (participant_a, participant_b);

create table if not exists casadireta.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null references casadireta.conversations(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  context jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists casadireta_messages_conversation_idx on casadireta.messages (conversation_id, created_at);

create table if not exists casadireta.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  property_id uuid references casadireta.properties(id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists casadireta_notifications_user_idx on casadireta.notifications (user_id, read, created_at desc);

create table if not exists casadireta.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  subscription jsonb not null,
  platform text not null default 'web',
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table casadireta.properties enable row level security;
alter table casadireta.conversations enable row level security;
alter table casadireta.messages enable row level security;
alter table casadireta.notifications enable row level security;
alter table casadireta.push_subscriptions enable row level security;

drop policy if exists casadireta_properties_read on casadireta.properties;
create policy casadireta_properties_read on casadireta.properties for select to authenticated using (true);
drop policy if exists casadireta_properties_insert on casadireta.properties;
create policy casadireta_properties_insert on casadireta.properties for insert to authenticated with check (owner_user_id = auth.uid());
drop policy if exists casadireta_properties_update on casadireta.properties;
create policy casadireta_properties_update on casadireta.properties for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
drop policy if exists casadireta_properties_delete on casadireta.properties;
create policy casadireta_properties_delete on casadireta.properties for delete to authenticated using (owner_user_id = auth.uid());

drop policy if exists casadireta_conversations_read on casadireta.conversations;
create policy casadireta_conversations_read on casadireta.conversations for select to authenticated using (participant_a = auth.uid() or participant_b = auth.uid());
drop policy if exists casadireta_conversations_insert on casadireta.conversations;
create policy casadireta_conversations_insert on casadireta.conversations for insert to authenticated with check (participant_a = auth.uid() or participant_b = auth.uid());

drop policy if exists casadireta_messages_read on casadireta.messages;
create policy casadireta_messages_read on casadireta.messages for select to authenticated using (from_user_id = auth.uid() or to_user_id = auth.uid());
drop policy if exists casadireta_messages_insert on casadireta.messages;
create policy casadireta_messages_insert on casadireta.messages for insert to authenticated with check (from_user_id = auth.uid() and exists (select 1 from casadireta.conversations c where c.id = conversation_id and (c.participant_a = auth.uid() or c.participant_b = auth.uid())));
drop policy if exists casadireta_messages_update on casadireta.messages;
create policy casadireta_messages_update on casadireta.messages for update to authenticated using (to_user_id = auth.uid()) with check (to_user_id = auth.uid());

drop policy if exists casadireta_notifications_read on casadireta.notifications;
create policy casadireta_notifications_read on casadireta.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists casadireta_notifications_update on casadireta.notifications;
create policy casadireta_notifications_update on casadireta.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists casadireta_push_read on casadireta.push_subscriptions;
create policy casadireta_push_read on casadireta.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists casadireta_push_insert on casadireta.push_subscriptions;
create policy casadireta_push_insert on casadireta.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists casadireta_push_update on casadireta.push_subscriptions;
create policy casadireta_push_update on casadireta.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists casadireta_push_delete on casadireta.push_subscriptions;
create policy casadireta_push_delete on casadireta.push_subscriptions for delete to authenticated using (user_id = auth.uid());

create or replace function casadireta.notify_new_property() returns trigger
language plpgsql security definer set search_path = public, casadireta, core as $$
begin
  insert into casadireta.notifications (user_id, type, title, body, property_id)
  select p.user_id,
    case when coalesce(p.metadata->>'zone','') <> '' and lower(p.metadata->>'zone') = lower(new.bairro) then 'nearby_property' else 'new_property' end,
    case when coalesce(p.metadata->>'zone','') <> '' and lower(p.metadata->>'zone') = lower(new.bairro) then 'Nova casa perto de si' else 'Nova casa publicada' end,
    concat(new.type, ' em ', new.bairro, ' por ', new.price_mzn, ' MT/mês'), new.id
  from core.profiles p
  where p.user_id <> new.owner_user_id and coalesce(p.metadata->>'role','inquilino') = 'inquilino';
  return new;
end;
$$;
drop trigger if exists casadireta_property_notification on casadireta.properties;
create trigger casadireta_property_notification after insert on casadireta.properties for each row execute function casadireta.notify_new_property();

grant usage on schema casadireta to authenticated;
grant select, insert, update, delete on all tables in schema casadireta to authenticated;
