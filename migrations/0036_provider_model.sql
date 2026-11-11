-- Each spare provider can name the model id it actually calls.
alter table catalog_providers add column if not exists model_id text not null default '';
