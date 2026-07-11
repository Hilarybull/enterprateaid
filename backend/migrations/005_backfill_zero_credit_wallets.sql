-- Migration 005: Backfill credit wallets that were created with 0 credits
-- Safe to run multiple times — only affects wallets where free_allocation_issued = FALSE
-- (that flag is set to TRUE by grant_credits when p_type = 'allocation')

-- Explorer users with un-provisioned wallets → grant 50 credits
SELECT grant_credits(
    w.user_id,
    50,
    'allocation',
    'Explorer initial credit allocation (backfill)',
    NULL
)
FROM credit_wallets w
LEFT JOIN user_subscriptions s ON s.user_id = w.user_id
WHERE w.free_allocation_issued = FALSE
  AND COALESCE(s.plan_key, 'explorer') = 'explorer';

-- Starter users with un-provisioned wallets → grant 500 credits
SELECT grant_credits(
    w.user_id,
    500,
    'allocation',
    'Starter initial credit allocation (backfill)',
    (date_trunc('month', NOW()) + INTERVAL '1 month')::timestamptz
)
FROM credit_wallets w
JOIN user_subscriptions s ON s.user_id = w.user_id
WHERE w.free_allocation_issued = FALSE
  AND s.plan_key = 'starter_insight'
  AND s.status = 'active';
