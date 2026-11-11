-- Wallet journal, CryptoBot top-ups, shop idempotency.
-- Rollback lives in migrations/down/0045_wallet_pay.sql (not applied: the migrator does not descend).

create table if not exists wallet_ledger (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  kind text not null check (kind in (
    'topup_cryptobot','topup_bonus','faucet','referral','achievement','game','transfer_in','transfer_out',
    'shop_premium','shop_vpn','shop_mega','shop_boost','shop_disk','shop_persona','shop_other',
    'ai_hold','ai_settle','ai_release','ai_refund','loan','loan_repay','adjust'
  )),
  bucket text not null check (bucket in ('purchased','earned','held','balance')),
  amount bigint not null,
  balance_after bigint,
  ref_type text,
  ref_id text,
  idem_key text not null,
  rate_version text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, kind, idem_key)
);

create index if not exists wallet_ledger_user on wallet_ledger (user_id, created_at desc);

alter table wallets add column if not exists purchased integer not null default 0;
alter table wallets add column if not exists earned integer not null default 0;
alter table wallets add column if not exists held integer not null default 0;

create table if not exists vubli_topups (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  provider text not null default 'cryptobot',
  network text not null check (network in ('mainnet','testnet')),
  provider_invoice_id bigint,
  provider_hash text,
  status text not null default 'pending' check (status in ('pending','paid','expired','failed','manual_review','canceled')),
  fiat text not null default 'RUB',
  fiat_amount numeric(14,2) not null check (fiat_amount > 0),
  tier_id text not null,
  rate_x1000 integer not null,
  rate_version text not null,
  vubli_total bigint not null check (vubli_total > 0),
  vubli_purchased bigint not null check (vubli_purchased >= 0),
  vubli_bonus bigint not null check (vubli_bonus >= 0),
  check (vubli_purchased + vubli_bonus = vubli_total),
  return_to text not null default 'shop' check (return_to in ('shop','bank')),
  invoice_url text,
  mini_app_url text,
  web_app_url text,
  expires_at timestamptz not null,
  paid_at timestamptz,
  paid_asset text,
  paid_amount text,
  paid_usd_rate text,
  fee_asset text,
  fee_amount text,
  idem_key text not null,
  ip_hash text,
  last_checked_at timestamptz,
  provider_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idem_key)
);

create unique index if not exists vubli_topups_invoice_uidx
  on vubli_topups (provider, network, provider_invoice_id)
  where provider_invoice_id is not null;

create index if not exists vubli_topups_user on vubli_topups (user_id, created_at desc);
create index if not exists vubli_topups_pending on vubli_topups (expires_at) where status = 'pending';

create table if not exists payment_webhook_log (
  id bigserial primary key,
  provider text not null,
  network text not null,
  provider_invoice_id bigint,
  update_id bigint,
  update_type text,
  signature_ok boolean not null,
  outcome text not null,
  created_at timestamptz not null default now()
);

create table if not exists shop_orders (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  sku text not null,
  idem_key text not null,
  status text not null default 'pending' check (status in ('pending','done','failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, idem_key)
);
