-- Per-model builtin settings (endpoint, key, prompt) and thread replies.

alter table catalog_models add column if not exists display_name text;
alter table catalog_models add column if not exists base_url text not null default 'https://api.x.ai/v1';
alter table catalog_models add column if not exists api_key text not null default '';
alter table catalog_models add column if not exists system_prompt text not null default '';

update catalog_models
set display_name = name
where display_name is null or display_name = '';

alter table posts add column if not exists parent_id text references posts (id) on delete cascade;

create index if not exists posts_parent_idx on posts (parent_id, created_at);
