-- Byte length of each uploaded chunk, so a video can be seeked without reading the whole file.
alter table file_chunks add column if not exists bytes integer not null default 0;

-- Which game paid. The stall keeps its own daily cap.
alter table game_payouts add column if not exists game text not null default 'stall';
