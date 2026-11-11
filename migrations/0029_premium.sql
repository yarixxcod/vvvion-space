-- VVVION PREMIUM. Active while until_at is in the future.

create table if not exists premium_grants (
  user_id text primary key references "user" (id) on delete cascade,
  until_at timestamptz not null,
  source text not null default 'admin',
  granted_by text,
  updated_at timestamptz not null default now()
);

create index if not exists premium_grants_until_idx on premium_grants (until_at);
