-- Additive; never rotates keys, tokens or existing passes.
create table if not exists vpn_trials (
 user_id text primary key references "user"(id) on delete cascade,
 claimed_at timestamptz not null default now(), ip_hash text not null default ''
);
create index if not exists vpn_trials_ip_at_idx on vpn_trials(ip_hash,claimed_at desc);
create table if not exists vpn_node_events (
 id text primary key, node_id text not null references vpn_nodes(id) on delete cascade,
 reach text not null, at timestamptz not null default now()
);
create index if not exists vpn_node_events_node_at_idx on vpn_node_events(node_id,at desc);
create table if not exists vpn_settings (id integer primary key, suspicious_gb integer not null default 30);
insert into vpn_settings(id,suspicious_gb) values(1,30) on conflict(id) do nothing;
