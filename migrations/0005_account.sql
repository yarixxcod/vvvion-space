-- Account chat history and the anonymous question counter.

create table if not exists saved_chats (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  title text not null,
  messages jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists saved_chats_owner on saved_chats (user_id, updated_at desc);

create table if not exists guest_quota (
  guest_id text primary key,
  used integer not null default 0,
  updated_at timestamptz not null default now()
);
