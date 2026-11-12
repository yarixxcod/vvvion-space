-- A file remembers its server. A one-time ticket lets a machine register itself.

alter table mega_entries add column if not exists node_id text references mega_nodes (id) on delete restrict;

update mega_entries e
set node_id = g.node_id
from mega_grants g
where e.user_id = g.user_id
  and e.kind = 'file'
  and e.node_id is null
  and g.node_id is not null;

create index if not exists mega_entries_node_idx on mega_entries (node_id);

create table if not exists mega_enrolls (
  id text primary key,
  token_hash text not null unique,
  agent_token text not null default '',
  disk_name text not null default '',
  agent_port integer not null default 8742,
  expires_at timestamptz not null,
  used_at timestamptz
);
