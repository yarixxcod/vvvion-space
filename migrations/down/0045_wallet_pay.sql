-- Manual rollback for 0045_wallet_pay.sql. Not applied by the migrator.
drop table if exists shop_orders;
drop table if exists payment_webhook_log;
drop table if exists vubli_topups;
drop table if exists wallet_ledger;
alter table wallets drop column if exists held;
alter table wallets drop column if exists earned;
alter table wallets drop column if exists purchased;
