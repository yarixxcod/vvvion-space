-- One admin-owned Whisper endpoint. The key never leaves the server.

create table if not exists whisper_settings (
  id integer primary key,
  base_url text not null default 'https://api.openai.com/v1',
  model text not null default 'whisper-1',
  language text not null default '',
  api_key text not null default ''
);

insert into whisper_settings (id) values (1) on conflict do nothing;
