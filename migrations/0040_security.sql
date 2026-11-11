create table if not exists captcha_seen (
  hash text primary key,
  expires_at timestamptz not null
);

create table if not exists login_guard (
  key text primary key,
  fails integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists session_epoch (
  user_id text primary key,
  epoch integer not null default 1
);

create table if not exists checkin_links (
  token text primary key,
  user_id text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists checkin_links_user on checkin_links (user_id);
