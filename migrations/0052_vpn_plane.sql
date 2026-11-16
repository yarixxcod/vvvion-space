-- Additive VPN control plane. Existing passes, tokens and node links stay.

alter table vpn_nodes add column if not exists country text not null default '';
alter table vpn_nodes add column if not exists city text not null default '';
alter table vpn_nodes add column if not exists protocol text not null default '';
alter table vpn_nodes add column if not exists host text not null default '';
alter table vpn_nodes add column if not exists reach text not null default 'unknown';
alter table vpn_nodes add column if not exists maintenance boolean not null default false;
alter table vpn_nodes add column if not exists agent_enrolled boolean not null default false;
alter table vpn_nodes add column if not exists last_check_at timestamptz;
alter table vpn_nodes add column if not exists last_error text not null default '';
alter table vpn_nodes add column if not exists load_note text not null default '';

alter table vpn_passes add column if not exists blocked_at timestamptz;
alter table vpn_passes add column if not exists auto_renew boolean not null default false;
alter table vpn_passes add column if not exists plan_id text not null default 'base';

create table if not exists vpn_devices (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  name text not null,
  token text not null unique,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_pull_at timestamptz
);

create index if not exists vpn_devices_user_idx on vpn_devices (user_id);

create table if not exists vpn_keys (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  node_id text not null references vpn_nodes (id) on delete cascade,
  device_id text not null default '',
  protocol text not null,
  secret text not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists vpn_keys_slot_idx on vpn_keys (user_id, node_id, device_id);

create table if not exists vpn_counters (
  user_id text not null,
  node_id text not null,
  upload_bytes bigint not null,
  download_bytes bigint not null,
  reported_at timestamptz not null default now(),
  primary key (user_id, node_id)
);

create table if not exists vpn_usage_days (
  user_id text not null,
  node_id text not null,
  day date not null,
  upload_bytes bigint not null,
  download_bytes bigint not null,
  primary key (user_id, node_id, day)
);

create table if not exists vpn_sync (
  id text primary key,
  node_id text not null,
  user_id text not null,
  action text not null,
  status text not null default 'pending',
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists vpn_sync_node_idx on vpn_sync (node_id, created_at desc);

create table if not exists vpn_audit (
  id text primary key,
  actor_id text,
  user_id text,
  kind text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists vpn_audit_user_idx on vpn_audit (user_id, created_at desc);

create table if not exists vpn_miss (
  id text primary key,
  ip_hash text not null,
  at timestamptz not null default now()
);

create index if not exists vpn_miss_at_idx on vpn_miss (at);

create table if not exists vpn_plans (
  id text primary key,
  title text not null,
  days integer not null,
  price integer not null,
  traffic_bytes bigint not null,
  device_cap integer not null,
  enabled boolean not null default false
);

insert into vpn_plans (id, title, days, price, traffic_bytes, device_cap, enabled)
values
  ('trial', 'Пробный', 3, 0, 1073741824, 1, false),
  ('base', 'Базовый', 30, 2000, 107374182400, 3, true),
  ('plus', 'Расширенный', 30, 3500, 322122547200, 5, false),
  ('family', 'Семейный', 30, 5000, 536870912000, 8, false)
on conflict (id) do nothing;
