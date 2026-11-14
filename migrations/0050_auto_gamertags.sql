-- Assign a unique Xbox-style gamertag at account creation, including existing accounts.
-- Generated locally so registration never depends on an AI provider or its availability.
-- Users can change their handle later in Profile.
create or replace function vvvion_assign_handle()
returns trigger language plpgsql as $$
declare
  adjective text;
  noun text;
  candidate text;
  attempt integer;
begin
  if exists (select 1 from user_handles where user_id = new.id) then
    return new;
  end if;
  for attempt in 1..12 loop
    adjective := (array['nova','cosmic','neon','lunar','pixel','stellar','rapid','shadow','bright','silent','frost','ember'])[1 + floor(random() * 12)::integer];
    noun := (array['fox','wolf','raven','panda','orbit','tiger','comet','falcon','lynx','otter','dragon','pilot'])[1 + floor(random() * 12)::integer];
    candidate := adjective || '_' || noun || substr(md5(new.id || random()::text || clock_timestamp()::text), 1, 4);
    begin
      insert into user_handles (user_id, handle) values (new.id, candidate)
      on conflict (user_id) do nothing;
      return new;
    exception when unique_violation then
      -- Retry when another user has claimed the same gamertag.
    end;
  end loop;
  raise exception 'Could not allocate unique username';
end;
$$;

drop trigger if exists vvvion_user_handle_signup on "user";
create trigger vvvion_user_handle_signup
after insert on "user"
for each row execute function vvvion_assign_handle();

do $backfill$
declare
  u record;
  candidate text;
  attempt integer;
begin
  for u in select id from "user" where id not in (select user_id from user_handles) loop
    for attempt in 1..12 loop
      candidate := 'nova_' || substr(md5(u.id || random()::text || clock_timestamp()::text), 1, 10);
      begin
        insert into user_handles (user_id, handle) values (u.id, candidate)
        on conflict (user_id) do nothing;
        exit;
      exception when unique_violation then
        -- Retry a rare handle collision.
      end;
    end loop;
  end loop;
end;
$backfill$;
