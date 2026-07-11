-- ============================================================
-- Migration 003: AI Credit System
-- ============================================================

-- 1. Credit wallets (one per user)
CREATE TABLE IF NOT EXISTS credit_wallets (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 TEXT NOT NULL UNIQUE,
    available_credits       INTEGER NOT NULL DEFAULT 0 CHECK (available_credits >= 0),
    held_credits            INTEGER NOT NULL DEFAULT 0 CHECK (held_credits >= 0),
    lifetime_credits_issued INTEGER NOT NULL DEFAULT 0,
    lifetime_credits_used   INTEGER NOT NULL DEFAULT 0,
    next_reset_at           TIMESTAMPTZ,
    last_reset_at           TIMESTAMPTZ,
    free_allocation_issued  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_wallets_user_id ON credit_wallets(user_id);

-- 2. Credit transactions (full ledger)
CREATE TABLE IF NOT EXISTS credit_transactions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id        UUID NOT NULL REFERENCES credit_wallets(id),
    user_id          TEXT NOT NULL,
    feature_code     TEXT,
    generation_id    UUID,
    transaction_type TEXT NOT NULL,  -- allocation | deduction | hold | hold_release | refund | expiry | top_up | admin_adjustment | promotion
    credits          INTEGER NOT NULL,
    balance_before   INTEGER NOT NULL,
    balance_after    INTEGER NOT NULL,
    status           TEXT NOT NULL DEFAULT 'completed',  -- pending | completed | failed | reversed
    idempotency_key  TEXT UNIQUE,
    description      TEXT,
    expires_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id    ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_wallet_id  ON credit_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_gen_id     ON credit_transactions(generation_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_idem_key   ON credit_transactions(idempotency_key);

-- 3. Feature credit configuration (editable by admin)
CREATE TABLE IF NOT EXISTS credit_feature_config (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_code           TEXT NOT NULL UNIQUE,
    feature_name           TEXT NOT NULL,
    credit_cost            INTEGER NOT NULL CHECK (credit_cost >= 0),
    enabled                BOOLEAN NOT NULL DEFAULT TRUE,
    minimum_plan           TEXT NOT NULL DEFAULT 'explorer',
    refundable_on_failure  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Plan credit configuration
CREATE TABLE IF NOT EXISTS plan_credit_config (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_code         TEXT NOT NULL UNIQUE,
    allocation_type   TEXT NOT NULL,   -- one_time | monthly | promotional | top_up
    credits_per_period INTEGER NOT NULL,
    reset_frequency   TEXT,            -- monthly | annual | never
    rollover_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
    expiry_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Initial feature credit costs
-- ============================================================
INSERT INTO credit_feature_config (feature_code, feature_name, credit_cost, enabled, minimum_plan, refundable_on_failure)
VALUES
    ('idea_validation',          'Idea Validation',                      5,   TRUE, 'explorer',        TRUE),
    ('market_data_refresh',      'Market Data Refresh',                  4,   TRUE, 'explorer',        TRUE),
    ('business_plan_full',       'Complete Business Plan',               40,  TRUE, 'explorer',        TRUE),
    ('business_plan_section',    'Regenerate Business Plan Section',     3,   TRUE, 'explorer',        TRUE),
    ('proposal_full',            'Complete Business Proposal',           25,  TRUE, 'starter_insight', TRUE),
    ('proposal_section',         'Regenerate Proposal Section',          2,   TRUE, 'starter_insight', TRUE),
    ('sales_letter_full',        'Complete Sales Letter',                10,  TRUE, 'starter_insight', TRUE),
    ('sales_letter_section',     'Regenerate Sales Letter Section',      1,   TRUE, 'starter_insight', TRUE),
    ('scenario_simulation',      'Scenario Simulation',                  10,  TRUE, 'starter_insight', TRUE),
    ('fragility_ai_interpretation', 'AI Fragility Index Interpretation', 3,   TRUE, 'starter_insight', TRUE),
    ('suggest_field',            'AI Field Suggestion',                  1,   TRUE, 'explorer',        FALSE)
ON CONFLICT (feature_code) DO NOTHING;

-- ============================================================
-- Initial plan credit configuration
-- ============================================================
INSERT INTO plan_credit_config (plan_code, allocation_type, credits_per_period, reset_frequency, rollover_enabled, expiry_enabled)
VALUES
    ('explorer',             'one_time', 50,  'never',   FALSE, FALSE),
    ('starter_insight',      'monthly',  500, 'monthly', FALSE, TRUE),
    ('decision_engine',      'monthly',  1500,'monthly', FALSE, TRUE),
    ('growth_navigator',     'monthly',  3000,'monthly', FALSE, TRUE),
    ('strategic_business_os','monthly',  6000,'monthly', FALSE, TRUE)
ON CONFLICT (plan_code) DO NOTHING;

-- ============================================================
-- Atomic credit reserve / commit / release functions
-- ============================================================

-- Reserve: atomically move credits from available to held
CREATE OR REPLACE FUNCTION reserve_credits(
    p_user_id        TEXT,
    p_feature_code   TEXT,
    p_credit_cost    INTEGER,
    p_generation_id  UUID,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_wallet        credit_wallets%ROWTYPE;
    v_transaction   credit_transactions%ROWTYPE;
    v_result        JSONB;
BEGIN
    -- Idempotency check
    SELECT * INTO v_transaction FROM credit_transactions WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
        RETURN jsonb_build_object('ok', TRUE, 'idempotent', TRUE, 'transaction_id', v_transaction.id);
    END IF;

    -- Lock and fetch wallet
    SELECT * INTO v_wallet FROM credit_wallets WHERE user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'error', 'WALLET_NOT_FOUND');
    END IF;

    IF v_wallet.available_credits < p_credit_cost THEN
        RETURN jsonb_build_object(
            'ok', FALSE,
            'error', 'INSUFFICIENT_CREDITS',
            'available', v_wallet.available_credits,
            'required', p_credit_cost
        );
    END IF;

    -- Move credits to held
    UPDATE credit_wallets
    SET available_credits = available_credits - p_credit_cost,
        held_credits      = held_credits + p_credit_cost,
        updated_at        = NOW()
    WHERE user_id = p_user_id;

    -- Record hold transaction
    INSERT INTO credit_transactions (
        wallet_id, user_id, feature_code, generation_id,
        transaction_type, credits, balance_before, balance_after,
        status, idempotency_key, description
    ) VALUES (
        v_wallet.id, p_user_id, p_feature_code, p_generation_id,
        'hold', -p_credit_cost, v_wallet.available_credits, v_wallet.available_credits - p_credit_cost,
        'completed', p_idempotency_key,
        'Credits held for ' || p_feature_code
    ) RETURNING * INTO v_transaction;

    RETURN jsonb_build_object('ok', TRUE, 'transaction_id', v_transaction.id);
END;
$$;

-- Commit: confirm the hold, add to lifetime_used
CREATE OR REPLACE FUNCTION commit_credits(
    p_generation_id   UUID,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_hold      credit_transactions%ROWTYPE;
    v_wallet    credit_wallets%ROWTYPE;
    v_commit_key TEXT;
BEGIN
    v_commit_key := p_idempotency_key || '_commit';

    -- Idempotency
    IF EXISTS (SELECT 1 FROM credit_transactions WHERE idempotency_key = v_commit_key) THEN
        RETURN jsonb_build_object('ok', TRUE, 'idempotent', TRUE);
    END IF;

    -- Find the hold
    SELECT * INTO v_hold FROM credit_transactions
    WHERE generation_id = p_generation_id AND transaction_type = 'hold' AND status = 'completed'
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'error', 'HOLD_NOT_FOUND');
    END IF;

    SELECT * INTO v_wallet FROM credit_wallets WHERE id = v_hold.wallet_id FOR UPDATE;

    -- Reduce held (credits are already out of available — just decrement held)
    UPDATE credit_wallets
    SET held_credits          = held_credits - ABS(v_hold.credits),
        lifetime_credits_used = lifetime_credits_used + ABS(v_hold.credits),
        updated_at            = NOW()
    WHERE id = v_hold.wallet_id;

    -- Record deduction
    INSERT INTO credit_transactions (
        wallet_id, user_id, feature_code, generation_id,
        transaction_type, credits, balance_before, balance_after,
        status, idempotency_key, description
    ) VALUES (
        v_hold.wallet_id, v_hold.user_id, v_hold.feature_code, p_generation_id,
        'deduction', v_hold.credits, v_wallet.available_credits, v_wallet.available_credits,
        'completed', v_commit_key,
        'Credits committed for ' || COALESCE(v_hold.feature_code, 'unknown')
    );

    RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- Release: return held credits to available (on failure)
CREATE OR REPLACE FUNCTION release_credits(
    p_generation_id   UUID,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_hold       credit_transactions%ROWTYPE;
    v_wallet     credit_wallets%ROWTYPE;
    v_release_key TEXT;
BEGIN
    v_release_key := p_idempotency_key || '_release';

    -- Idempotency
    IF EXISTS (SELECT 1 FROM credit_transactions WHERE idempotency_key = v_release_key) THEN
        RETURN jsonb_build_object('ok', TRUE, 'idempotent', TRUE);
    END IF;

    SELECT * INTO v_hold FROM credit_transactions
    WHERE generation_id = p_generation_id AND transaction_type = 'hold' AND status = 'completed'
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'error', 'HOLD_NOT_FOUND');
    END IF;

    SELECT * INTO v_wallet FROM credit_wallets WHERE id = v_hold.wallet_id FOR UPDATE;

    UPDATE credit_wallets
    SET available_credits = available_credits + ABS(v_hold.credits),
        held_credits      = GREATEST(0, held_credits - ABS(v_hold.credits)),
        updated_at        = NOW()
    WHERE id = v_hold.wallet_id;

    INSERT INTO credit_transactions (
        wallet_id, user_id, feature_code, generation_id,
        transaction_type, credits, balance_before, balance_after,
        status, idempotency_key, description
    ) VALUES (
        v_hold.wallet_id, v_hold.user_id, v_hold.feature_code, p_generation_id,
        'hold_release', ABS(v_hold.credits),
        v_wallet.available_credits, v_wallet.available_credits + ABS(v_hold.credits),
        'completed', v_release_key,
        'Credits released (generation failed) for ' || COALESCE(v_hold.feature_code, 'unknown')
    );

    RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- Grant credits (initial allocation / admin / top-up)
CREATE OR REPLACE FUNCTION grant_credits(
    p_user_id       TEXT,
    p_amount        INTEGER,
    p_type          TEXT,   -- allocation | promotion | top_up | admin_adjustment
    p_reason        TEXT,
    p_next_reset_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_wallet credit_wallets%ROWTYPE;
BEGIN
    -- Create wallet if missing
    INSERT INTO credit_wallets (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT * INTO v_wallet FROM credit_wallets WHERE user_id = p_user_id FOR UPDATE;

    UPDATE credit_wallets
    SET available_credits       = available_credits + p_amount,
        lifetime_credits_issued = lifetime_credits_issued + p_amount,
        next_reset_at           = COALESCE(p_next_reset_at, next_reset_at),
        last_reset_at           = CASE WHEN p_type IN ('allocation','monthly') THEN NOW() ELSE last_reset_at END,
        free_allocation_issued  = CASE WHEN p_type = 'allocation' THEN TRUE ELSE free_allocation_issued END,
        updated_at              = NOW()
    WHERE user_id = p_user_id;

    INSERT INTO credit_transactions (
        wallet_id, user_id, transaction_type, credits,
        balance_before, balance_after, status, description
    ) VALUES (
        v_wallet.id, p_user_id, p_type, p_amount,
        v_wallet.available_credits, v_wallet.available_credits + p_amount,
        'completed', p_reason
    );

    RETURN jsonb_build_object('ok', TRUE, 'new_balance', v_wallet.available_credits + p_amount);
END;
$$;

-- ============================================================
-- Migrate existing users
-- ============================================================

-- Explorer users: issue 50 one-time credits if not already done
INSERT INTO credit_wallets (user_id, available_credits, lifetime_credits_issued, free_allocation_issued)
SELECT u.id::text, 50, 50, TRUE
FROM auth.users u
LEFT JOIN user_subscriptions s ON s.user_id = u.id::text
WHERE COALESCE(s.plan_key, 'explorer') = 'explorer'
  AND NOT EXISTS (SELECT 1 FROM credit_wallets w WHERE w.user_id = u.id::text)
ON CONFLICT (user_id) DO NOTHING;

-- Starter users: issue 500 credits, reset monthly
INSERT INTO credit_wallets (user_id, available_credits, lifetime_credits_issued, next_reset_at)
SELECT s.user_id, 500, 500,
       date_trunc('month', NOW()) + INTERVAL '1 month'
FROM user_subscriptions s
WHERE s.plan_key = 'starter_insight' AND s.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM credit_wallets w WHERE w.user_id = s.user_id)
ON CONFLICT (user_id) DO NOTHING;
