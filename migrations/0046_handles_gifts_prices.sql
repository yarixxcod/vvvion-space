-- Usernames, admin-editable shop prices, and gifts.
-- Rollback: migrations/down/0046_handles_gifts_prices.sql

create table if not exists user_handles (
  user_id text primary key references "user" (id) on delete cascade,
  handle text not null,
  updated_at timestamptz not null default now(),
  constraint user_handles_shape check (handle ~ '^[a-z][a-z0-9_]{2,19}$')
);

create unique index if not exists user_handles_handle_idx on user_handles (handle);

create table if not exists shop_prices (
  sku text primary key,
  title text not null,
  note text not null default '',
  section text not null,
  price integer not null check (price >= 0 and price <= 1000000),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into shop_prices (sku, title, note, section, price) values
  ('premium', 'Premium', '30 дней', 'subs', 2500),
  ('vpn', 'VPN', '30 дней', 'subs', 2000),
  ('mega', 'Мегадиск', '2 ГБ, 30 дней', 'storage', 1500),
  ('boost', 'Сутки подлиннее', '+100 запросов на 24 часа', 'ai', 1000),
  ('disk', 'Место на диске', '+100 МБ', 'storage', 1000),
  ('persona:psych', 'Психолог', 'Персонаж', 'look', 900),
  ('persona:jungkook', 'Чонгук', 'Персонаж', 'look', 1500),
  ('persona:socrates', 'Сократ', 'Персонаж', 'look', 700),
  ('persona:chef', 'Шеф', 'Персонаж', 'look', 600),
  ('persona:detective', 'Следователь', 'Персонаж', 'look', 800),
  ('persona:tutor', 'Репетитор', 'Персонаж', 'look', 700),
  ('persona:poet', 'Поэт', 'Персонаж', 'look', 500),
  ('persona:coach', 'Тренер', 'Персонаж', 'look', 800),
  ('persona:historian', 'Историк', 'Персонаж', 'look', 700),
  ('persona:editor', 'Редактор', 'Персонаж', 'look', 900),
  ('persona:navigator', 'Навигатор', 'Персонаж', 'look', 600),
  ('persona:stoic', 'Стоик', 'Персонаж', 'look', 500),
  ('persona:night', 'Ночной эфир', 'Персонаж', 'look', 750),
  ('persona:archivist', 'Архивариус', 'Персонаж', 'look', 650),
  ('persona:translator', 'Переводчик', 'Персонаж', 'look', 850),
  ('persona:lawyer', 'Юрист', 'Персонаж', 'look', 900),
  ('persona:gardener', 'Садовник', 'Персонаж', 'look', 550),
  ('gift:flower', 'Цветок', 'Короткий знак внимания', 'gifts', 100),
  ('gift:tea', 'Чай', 'Тёплое «я рядом»', 'gifts', 200),
  ('gift:star', 'Звезда', 'Чтобы человека отметили', 'gifts', 500),
  ('gift:crown', 'Корона', 'Самый заметный подарок', 'gifts', 1500)
on conflict (sku) do nothing;

create table if not exists gift_receipts (
  id text primary key,
  from_id text not null references "user" (id) on delete cascade,
  to_id text not null references "user" (id) on delete cascade,
  sku text not null,
  title text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists gift_receipts_to_idx on gift_receipts (to_id, created_at desc);
create index if not exists gift_receipts_from_idx on gift_receipts (from_id, created_at desc);
