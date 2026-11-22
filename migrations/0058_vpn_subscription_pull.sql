-- Additive: existing subscription tokens, keys and dates are unchanged.
alter table vpn_passes add column if not exists last_pull_at timestamptz;
