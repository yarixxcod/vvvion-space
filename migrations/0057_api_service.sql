-- Публичный API. Аддитивно: старые таблицы не переписываются.
-- Суточный перебор токенов допустим: лимит проверяется по уже записанным
-- токенам, а токены текущего ответа становятся известны только в конце.

create table if not exists api_keys (
  id text primary key,
  user_id text not null,
  name text not null,
  key_hash text not null unique,
  prefix text not null,
  last4 text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_keys_user_idx on api_keys (user_id, created_at desc);

create table if not exists api_usage (
  id bigserial primary key,
  key_id text not null,
  user_id text not null,
  endpoint text not null,
  model text not null,
  status int not null default 0,
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  images int not null default 0,
  latency_ms int not null default 0,
  estimated boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists api_usage_user_time_idx on api_usage (user_id, created_at desc);
create index if not exists api_usage_key_time_idx on api_usage (key_id, created_at desc);

create table if not exists api_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  daily_requests int,
  daily_tokens int,
  daily_images int default 20,
  per_minute int not null default 30,
  max_output_tokens int not null default 16384,
  max_keys int not null default 5
);
insert into api_settings (id) values (1) on conflict do nothing;

alter table catalog_models add column if not exists api_enabled boolean not null default true;
alter table image_models add column if not exists api_enabled boolean not null default true;
