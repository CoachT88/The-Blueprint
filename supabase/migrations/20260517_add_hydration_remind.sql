-- Add hydration_remind column to push_subscriptions
-- Run this in the Supabase SQL editor before deploying the send-notifications function update.
ALTER TABLE push_subscriptions
    ADD COLUMN IF NOT EXISTS hydration_remind boolean NOT NULL DEFAULT false;
