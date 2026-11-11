-- VVVION VPN. Nodes are the admin's vless/hy2 links. A pass is one user's subscription token.

create table if not exists vpn_nodes (
  id text primary key,
  name text not null,
  uri text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists vpn_passes (
  user_id text primary key references "user" (id) on delete cascade,
  token text not null unique,
  until_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vpn_passes_token_idx on vpn_passes (token);

create table if not exists vpn_pulls (
  id text primary key,
  user_id text not null,
  at timestamptz not null default now()
);

create index if not exists vpn_pulls_at_idx on vpn_pulls (at);

create table if not exists vpn_plan (
  id integer primary key,
  traffic_bytes bigint not null
);

insert into vpn_plan (id, traffic_bytes)
values (1, 107374182400)
on conflict (id) do nothing;
