-- Chat models can carry an icon and up to four provider endpoints.
-- Slot 0 is mirrored onto catalog_models so older readers keep working.

alter table catalog_models add column if not exists icon text not null default '';

create table if not exists catalog_providers (
  model_name text not null references catalog_models (name) on update cascade on delete cascade,
  slot smallint not null check (slot >= 0 and slot < 4),
  base_url text not null,
  api_key text not null default '',
  primary key (model_name, slot)
);

insert into catalog_providers (model_name, slot, base_url, api_key)
select name, 0, coalesce(nullif(base_url, ''), 'https://api.x.ai/v1'), coalesce(api_key, '')
from catalog_models
on conflict (model_name, slot) do nothing;
