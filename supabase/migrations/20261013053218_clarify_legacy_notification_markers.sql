-- The legacy marker records a day, not which selected time actually fired.
-- Preserve that known history without pretending a newly selected extra time
-- already received a notification. No training state or completed session changes.
update public.notification_deliveries
set event_key = 'legacy:' || split_part(event_key, ':', 2), sent_at = null
where kind = 'daily_reminder'
  and event_key like 'reminder:%'
  and sent_at = created_at;
