create or replace function casadireta.track_property(p_property_id uuid, p_event text)
returns jsonb language plpgsql security definer set search_path = public, casadireta as $$
declare result jsonb;
begin
  if p_event not in ('view','contact') then raise exception 'invalid_property_event'; end if;
  update casadireta.properties set views = views + case when p_event='view' then 1 else 0 end,
    contacts = contacts + case when p_event='contact' then 1 else 0 end, updated_at=now() where id=p_property_id;
  if not found then raise exception 'property_not_found'; end if;
  select jsonb_build_object('ok',true) into result; return result;
end; $$;
grant execute on function casadireta.track_property(uuid,text) to authenticated;
