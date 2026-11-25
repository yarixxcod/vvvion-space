-- Extend provider capacity without changing existing models, keys or access defaults.
alter table catalog_models add column if not exists premium_only boolean not null default false;
alter table catalog_providers add column if not exists provider_id text not null default gen_random_uuid()::text;
alter table catalog_providers drop constraint if exists catalog_providers_slot_check;
alter table catalog_providers add constraint catalog_providers_slot_check check (slot >= 0 and slot < 10);

-- Counts only: no prompts, responses, credentials or user identifiers.
create table if not exists provider_usage_hourly (
  bucket timestamptz not null,
  model_name text not null,
  provider_id text not null,
  slot smallint not null,
  provider_host text not null,
  upstream_model text not null default '',
  source text not null,
  requests bigint not null default 0,
  accepted bigint not null default 0,
  errors bigint not null default 0,
  elapsed_ms bigint not null default 0,
  primary key (bucket, model_name, provider_id, provider_host, upstream_model, source)
);
create index if not exists provider_usage_bucket_idx on provider_usage_hourly (bucket);
