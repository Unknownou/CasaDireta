-- Security boundary: CasaDireta writes go through the Central/TUPC edge
-- functions, which validate ownership, roles, payloads and audit events.
-- The publishable client must not be able to mutate marketplace data directly.
revoke insert, update, delete on casadireta.properties from authenticated;
revoke insert, update, delete on casadireta.conversations from authenticated;
revoke insert, update, delete on casadireta.messages from authenticated;
revoke insert, update, delete on casadireta.notifications from authenticated;
revoke insert, update, delete on casadireta.push_subscriptions from authenticated;

-- Defense in depth for any future direct-message grant: a message recipient
-- must be the other participant in the referenced conversation.
drop policy if exists casadireta_messages_insert on casadireta.messages;
create policy casadireta_messages_insert on casadireta.messages
for insert to authenticated
with check (
  from_user_id = auth.uid()
  and to_user_id <> auth.uid()
  and exists (
    select 1
    from casadireta.conversations c
    where c.id = conversation_id
      and (
        (c.participant_a = auth.uid() and c.participant_b = to_user_id)
        or (c.participant_b = auth.uid() and c.participant_a = to_user_id)
      )
  )
);

-- Recipients may only mark their own messages as read; arbitrary message
-- mutation is intentionally not granted to the browser role.
drop policy if exists casadireta_messages_update on casadireta.messages;
create policy casadireta_messages_update on casadireta.messages
for update to authenticated
using (to_user_id = auth.uid())
with check (to_user_id = auth.uid());
