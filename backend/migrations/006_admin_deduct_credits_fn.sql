-- Migration 006: Admin deduct credits function
-- Reduces available_credits without touching lifetime_credits_issued (it's a deduction, not a reversal)
-- Caps at available balance so it never goes negative.

CREATE OR REPLACE FUNCTION admin_deduct_credits(
    p_user_id TEXT,
    p_amount  INTEGER,
    p_reason  TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_wallet credit_wallets%ROWTYPE;
    v_deduct INTEGER;
BEGIN
    SELECT * INTO v_wallet FROM credit_wallets WHERE user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'error', 'WALLET_NOT_FOUND');
    END IF;

    v_deduct := LEAST(p_amount, v_wallet.available_credits);

    IF v_deduct <= 0 THEN
        RETURN jsonb_build_object('ok', TRUE, 'deducted', 0, 'balance', v_wallet.available_credits);
    END IF;

    UPDATE credit_wallets
    SET available_credits = available_credits - v_deduct,
        updated_at        = NOW()
    WHERE user_id = p_user_id;

    INSERT INTO credit_transactions (
        wallet_id, user_id, transaction_type, credits,
        balance_before, balance_after, status, description
    ) VALUES (
        v_wallet.id, p_user_id, 'admin_adjustment', -v_deduct,
        v_wallet.available_credits, v_wallet.available_credits - v_deduct,
        'completed', p_reason
    );

    RETURN jsonb_build_object('ok', TRUE, 'deducted', v_deduct, 'balance', v_wallet.available_credits - v_deduct);
END;
$$;
