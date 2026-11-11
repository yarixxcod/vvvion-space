-- Telegram bot for the same site accounts. Token stays server-side.

create table if not exists telegram_bot (
  id smallint primary key default 1 check (id = 1),
  token text not null,
  username text not null default '',
  secret text not null,
  updated_at timestamptz not null default now()
);

create table if not exists telegram_links (
  user_id text primary key references "user" (id) on delete cascade,
  chat_id text not null unique,
  username text not null default '',
  linked_at timestamptz not null default now()
);

create table if not exists telegram_codes (
  code text primary key,
  user_id text not null references "user" (id) on delete cascade,
  expires_at timestamptz not null
);

create index if not exists telegram_codes_user_idx on telegram_codes (user_id);
