-- Usage baselines and the shared-key cutover flag. Existing passes and tokens stay.

alter table vpn_passes add column if not exists quota_reset_at timestamptz;

alter table vpn_counters add column if not exists baseline_upload bigint not null default 0;
alter table vpn_counters add column if not exists baseline_download bigint not null default 0;

alter table vpn_nodes add column if not exists ping_ms integer;
alter table vpn_nodes add column if not exists client_count integer;
alter table vpn_nodes add column if not exists shared_cut boolean not null default false;
