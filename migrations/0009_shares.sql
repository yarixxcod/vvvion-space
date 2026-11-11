-- Public snapshots of a dialog. The id is an unguessable token, not the chat id.

create table if not exists shared_chats (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  title text not null,
  messages jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists shared_chats_owner on shared_chats (user_id, created_at desc);
