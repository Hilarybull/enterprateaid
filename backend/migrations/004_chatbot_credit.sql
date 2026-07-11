-- Migration 004: Add chatbot (business assistant) credit feature config
INSERT INTO credit_feature_config (feature_code, feature_name, credit_cost, enabled, minimum_plan, refundable_on_failure)
VALUES ('chat_message', 'Business Assistant Chat', 2, TRUE, 'explorer', FALSE)
ON CONFLICT (feature_code) DO NOTHING;
