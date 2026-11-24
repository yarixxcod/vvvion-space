-- Four chat roles are free for everyone. Prices in this table are display
-- and admin data; the app also refuses to charge for these ids.

insert into shop_prices (sku, title, note, section, price) values
  ('persona:marketer', 'Маркетолог', 'Персонаж', 'look', 0),
  ('persona:programmer', 'Программист', 'Персонаж', 'look', 0)
on conflict (sku) do update
  set title = excluded.title, price = 0, note = excluded.note;

update shop_prices set price = 0 where sku = 'persona:psych';
update shop_prices set price = 0, title = 'Повар' where sku = 'persona:chef';
