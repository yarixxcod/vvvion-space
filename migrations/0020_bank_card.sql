-- Stable toy-card details. Empty means "not issued yet".

alter table wallets add column if not exists card_pan text not null default '';
alter table wallets add column if not exists card_exp text not null default '';
alter table wallets add column if not exists card_cvv text not null default '';
