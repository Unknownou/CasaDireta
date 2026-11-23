alter table casadireta.properties add column if not exists owner_name text not null default '';
alter table casadireta.properties add column if not exists owner_phone text not null default '';
create or replace function casadireta.snapshot_property_owner() returns trigger
language plpgsql security definer set search_path = public, casadireta, core as $$
begin
  select coalesce(p.display_name, p.full_name, ''), coalesce(p.primary_phone, '')
    into new.owner_name, new.owner_phone
  from core.profiles p where p.user_id = new.owner_user_id;
  return new;
end; $$;
drop trigger if exists casadireta_property_owner_snapshot on casadireta.properties;
create trigger casadireta_property_owner_snapshot before insert or update of owner_user_id on casadireta.properties for each row execute function casadireta.snapshot_property_owner();
