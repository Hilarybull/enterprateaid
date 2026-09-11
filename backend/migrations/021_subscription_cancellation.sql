-- Lets a user self-serve cancel (at period end) / resume their subscription.
-- Safe to run multiple times.

ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;
