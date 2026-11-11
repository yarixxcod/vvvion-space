-- Device push tokens, per-user notification switches, and reminder dedup.
-- user_id always comes from the server session, never from the client.

create table if not exists push_tokens (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  token text not null unique,
  platform text not null default 'android',
  app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_tokens_user on push_tokens (user_id);

create table if not exists push_settings (
  user_id text primary key references "user" (id) on delete cascade,
  messages boolean not null default true,
  ai boolean not null default true,
  subs boolean not null default true,
  preview boolean not null default false
);

create table if not exists push_log (
  user_id text not null,
  kind text not null,
  ref_id text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref_id)
);

create table if not exists user_presence (
  user_id text primary key references "user" (id) on delete cascade,
  last_seen_at timestamptz not null
);

create table if not exists push_dialog_gate (
  user_id text not null,
  dialog_id text not null,
  sent_at timestamptz not null,
  primary key (user_id, dialog_id)
);
