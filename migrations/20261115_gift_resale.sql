-- Additive inventory state. No existing gift receipts are deleted.
alter table gift_receipts add column if not exists sold_at timestamptz;
alter table gift_receipts add column if not exists resale_amount integer;
create index if not exists gift_receipts_owner_unsold_idx on gift_receipts(to_id, created_at desc) where sold_at is null;
