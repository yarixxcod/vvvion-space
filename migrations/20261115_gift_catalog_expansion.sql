-- Additive catalog expansion. Never overwrite administrator-adjusted prices or visibility.
insert into shop_prices (sku, title, note, section, price, enabled, updated_at)
values
('gift:rose', 'Лиловая роза', 'Знак внимания', 'gifts', 15, true, now()),
('gift:coffee', 'Кофе', 'Для бодрого дня', 'gifts', 25, true, now()),
('gift:chocolate', 'Шоколад', 'Сладкий сюрприз', 'gifts', 35, true, now()),
('gift:star', 'Звёздочка', 'Ты сияешь', 'gifts', 50, true, now()),
('gift:heart', 'Сердце', 'С теплом', 'gifts', 75, true, now()),
('gift:teddy', 'Мишка', 'Мягкие объятия', 'gifts', 100, true, now()),
('gift:bouquet', 'Букет', 'Цветы без повода', 'gifts', 150, true, now()),
('gift:butterfly', 'Бабочка', 'Немного волшебства', 'gifts', 180, true, now()),
('gift:moon', 'Луна', 'Ночной свет', 'gifts', 220, true, now()),
('gift:crystal', 'Кристалл', 'Магия в деталях', 'gifts', 300, true, now()),
('gift:planet', 'Планета', 'Целый мир для тебя', 'gifts', 450, true, now()),
('gift:rocket', 'Ракета', 'К новым высотам', 'gifts', 600, true, now()),
('gift:ring', 'Кольцо', 'Особенный момент', 'gifts', 800, true, now()),
('gift:cat', 'Космический кот', 'Звёздный мур', 'gifts', 900, true, now()),
('gift:music', 'Шкатулка', 'Мелодия на память', 'gifts', 1200, true, now()),
('gift:trophy', 'Кубок', 'Ты лучший', 'gifts', 1500, true, now()),
('gift:crown', 'Корона', 'Для особенной персоны', 'gifts', 2000, true, now()),
('gift:diamond', 'Бриллиант', 'Сияй ярче', 'gifts', 3500, true, now()),
('gift:phoenix', 'Феникс', 'Новая глава', 'gifts', 5000, true, now()),
('gift:galaxy', 'Галактика', 'Бесконечность', 'gifts', 7500, true, now()),
('gift:comet', 'Комета', 'Желание исполнится', 'gifts', 9500, true, now()),
('gift:castle', 'Замок', 'Твоя сказка', 'gifts', 12000, true, now()),
('gift:dragon', 'Дракон', 'Легендарный подарок', 'gifts', 20000, true, now()),
('gift:universe', 'Вселенная', 'Всё для тебя', 'gifts', 50000, true, now())
on conflict (sku) do nothing;
