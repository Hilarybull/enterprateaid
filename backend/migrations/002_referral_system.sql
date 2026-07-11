-- Referral & Reward System — Migration 002
-- Run in Supabase SQL Editor

-- ── Programme configuration (versioned) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS programme_config_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_bps         integer      NOT NULL DEFAULT 500,       -- 5% = 500 bps
  threshold_minor  integer      NOT NULL DEFAULT 5000,      -- £50 = 5000 pence
  hold_days        integer      NOT NULL DEFAULT 30,
  attribution_days integer      NOT NULL DEFAULT 30,
  recurring        boolean      NOT NULL DEFAULT true,
  is_active        boolean      NOT NULL DEFAULT true,
  effective_at     timestamptz  NOT NULL DEFAULT now(),
  created_by       text         REFERENCES users(id),
  created_at       timestamptz  NOT NULL DEFAULT now()
);

-- ── Referral programme terms versions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_terms_versions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version              text         NOT NULL UNIQUE,
  content              text         NOT NULL,
  effective_at         timestamptz  NOT NULL DEFAULT now(),
  requires_reacceptance boolean     NOT NULL DEFAULT false,
  created_at           timestamptz  NOT NULL DEFAULT now()
);

-- ── Programme participants ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_participants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text         NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  referral_code    text         NOT NULL UNIQUE,
  status           text         NOT NULL DEFAULT 'active',  -- active, suspended, opted_out, closed
  terms_version_id uuid         REFERENCES referral_terms_versions(id),
  terms_accepted_at timestamptz,
  joined_at        timestamptz  NOT NULL DEFAULT now(),
  opted_out_at     timestamptz,
  suspended_at     timestamptz,
  suspension_reason text,
  created_at       timestamptz  NOT NULL DEFAULT now()
);

-- ── Click events ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_clicks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code        text         NOT NULL,
  participant_user_id  text         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  clicked_at           timestamptz  NOT NULL DEFAULT now(),
  expires_at           timestamptz  NOT NULL,
  landing_path         text,
  ip_hash              text,
  converted            boolean      NOT NULL DEFAULT false,
  created_at           timestamptz  NOT NULL DEFAULT now()
);

-- ── Attribution — one per referred user ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_attributions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referred_user_id  text         NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  referrer_user_id  text         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  click_id          uuid         REFERENCES referral_clicks(id),
  method            text         NOT NULL DEFAULT 'click', -- click, manual_code
  attributed_at     timestamptz  NOT NULL DEFAULT now(),
  locked_at         timestamptz  NOT NULL DEFAULT now(),
  correction_note   text,
  corrected_by      text         REFERENCES users(id),
  corrected_at      timestamptz
);

-- ── Conversions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_conversions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attribution_id         uuid         NOT NULL REFERENCES referral_attributions(id),
  referred_user_id       text         NOT NULL REFERENCES users(id),
  stripe_subscription_id text,
  stripe_customer_id     text,
  first_paid_at          timestamptz  NOT NULL DEFAULT now(),
  status                 text         NOT NULL DEFAULT 'active',
  created_at             timestamptz  NOT NULL DEFAULT now()
);

-- ── Append-only reward ledger ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_reward_entries (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_user_id      text         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attribution_id           uuid         NOT NULL REFERENCES referral_attributions(id),
  type                     text         NOT NULL, -- reward, reversal, adjustment
  amount_minor             integer      NOT NULL, -- pence; negative for reversals
  currency                 text         NOT NULL DEFAULT 'GBP',
  status                   text         NOT NULL DEFAULT 'pending', -- pending, approved, voided
  stripe_payment_intent_id text,
  stripe_invoice_id        text,
  stripe_subscription_id   text,
  idempotency_key          text         NOT NULL UNIQUE,
  calc_snapshot            jsonb,
  source_entry_id          uuid         REFERENCES referral_reward_entries(id),
  config_version_id        uuid         REFERENCES programme_config_versions(id),
  available_at             timestamptz,
  approved_at              timestamptz,
  created_at               timestamptz  NOT NULL DEFAULT now()
);

-- ── Payout profiles ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payout_profiles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              text         NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  method               text         NOT NULL DEFAULT 'bank_transfer', -- bank_transfer, paypal
  account_name         text,
  account_number_masked text,
  sort_code_masked     text,
  paypal_email_masked  text,
  provider_token       text,        -- stores full details (encrypt at rest in prod)
  verified             boolean      NOT NULL DEFAULT false,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now()
);

-- ── Payout requests ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payout_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_user_id     text         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_minor            integer      NOT NULL,
  currency                text         NOT NULL DEFAULT 'GBP',
  status                  text         NOT NULL DEFAULT 'requested',
  -- requested, under_review, approved, processing, paid,
  -- action_required, rejected, failed, cancelled
  payout_profile_snapshot jsonb,
  reviewer_user_id        text         REFERENCES users(id),
  review_reason           text,
  provider_reference      text,
  idempotency_key         text         NOT NULL UNIQUE,
  requested_at            timestamptz  NOT NULL DEFAULT now(),
  reviewed_at             timestamptz,
  paid_at                 timestamptz,
  failed_at               timestamptz,
  created_at              timestamptz  NOT NULL DEFAULT now()
);

-- ── Payout allocations (prevent double spend) ────────────────────────────────
CREATE TABLE IF NOT EXISTS payout_allocations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_request_id  uuid    NOT NULL REFERENCES payout_requests(id),
  reward_entry_id    uuid    NOT NULL REFERENCES referral_reward_entries(id),
  allocated_minor    integer NOT NULL,
  UNIQUE(payout_request_id, reward_entry_id)
);

-- ── Fraud flags ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_fraud_flags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     text         NOT NULL, -- user, click, payout_request
  entity_id       text         NOT NULL,
  rule            text         NOT NULL,
  severity        text         NOT NULL DEFAULT 'medium', -- low, medium, high, critical
  evidence        jsonb,
  status          text         NOT NULL DEFAULT 'open', -- open, investigating, resolved, dismissed
  resolved_by     text         REFERENCES users(id),
  resolution_note text,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

-- ── Referral audit logs (immutable) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id text         NOT NULL REFERENCES users(id),
  actor_role    text         NOT NULL,
  action        text         NOT NULL,
  entity_type   text         NOT NULL,
  entity_id     text         NOT NULL,
  before_state  jsonb,
  after_state   jsonb,
  reason        text,
  created_at    timestamptz  NOT NULL DEFAULT now()
);

-- ── Seed: initial programme configuration ───────────────────────────────────
INSERT INTO programme_config_versions
  (rate_bps, threshold_minor, hold_days, attribution_days, recurring, is_active)
VALUES (500, 5000, 30, 30, true, true)
ON CONFLICT DO NOTHING;

-- ── Seed: initial terms version ─────────────────────────────────────────────
INSERT INTO referral_terms_versions (version, content, effective_at)
VALUES (
  '1.0',
  'EnterprateAI Referral Programme Terms v1.0 — By joining you agree to the full terms published at enterprateai.com/legal/referral-terms. Reward: 5% of eligible net subscription revenue. Minimum payout: £50 approved balance. Hold period: 30 days.',
  now()
)
ON CONFLICT (version) DO NOTHING;
