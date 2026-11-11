-- Megadisk: subscription, VPS nodes, folders and files. Bytes live on the VPS.

create table if not exists mega_nodes (
  id text primary key,
  name text not null,
  host text not null,
  ssh_port integer not null default 22,
  ssh_user text not null,
  ssh_secret text not null,
  disk_name text not null,
  agent_port integer not null,
  agent_token text not null,
  status text not null default 'new',
  detail text not null default '',
  used_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists mega_nodes_host_idx on mega_nodes (host);

create table if not exists mega_grants (
  user_id text primary key references "user" (id) on delete cascade,
  until_at timestamptz not null,
  node_id text references mega_nodes (id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table if not exists mega_entries (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  parent_id text references mega_entries (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('file', 'folder')),
  mime text not null default '',
  bytes bigint not null default 0,
  expect bigint not null default 0,
  status text not null default 'ok' check (status in ('up', 'ok')),
  created_at timestamptz not null default now()
);

create unique index if not exists mega_entries_slot
  on mega_entries (user_id, coalesce(parent_id, ''), name)
  where status = 'ok';

create index if not exists mega_entries_parent_idx on mega_entries (user_id, parent_id);
