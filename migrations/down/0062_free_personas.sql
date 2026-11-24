delete from shop_prices where sku = 'persona:marketer';
update shop_prices set price = 900 where sku = 'persona:psych';
update shop_prices set price = 600, title = 'Шеф' where sku = 'persona:chef';
update shop_prices set price = 900, title = 'Программист' where sku = 'persona:programmer';
