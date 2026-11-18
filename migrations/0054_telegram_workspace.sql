-- Additive bot session and delivery receipt tables. No wallet/history rewrites.
create table if not exists telegram_sessions (
  user_id text primary key references "user"(id) on delete cascade,
  model text not null default '',
  chat_id text references saved_chats(id) on delete set null,
  ai_enabled boolean not null default false,
  busy_until timestamptz not null default now()
);
create table if not exists telegram_updates (
  bot_username text not null,
  update_id bigint not null,
  chat_id text not null,
  status text not null default 'processing',
  created_at timestamptz not null default now(),
  primary key(bot_username, update_id)
);
create index if not exists telegram_updates_created on telegram_updates(created_at);
create index if not exists telegram_updates_chat on telegram_updates(bot_username,chat_id,created_at desc);
