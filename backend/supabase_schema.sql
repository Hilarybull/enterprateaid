-- Supabase schema for EnterprateAI (Postgres)

create table if not exists users (
  id text primary key,
  email text unique not null,
  password_hash text,
  auth_provider text,
  google_sub text,
  name text,
  picture text,
  -- Reconstructed from code (register/login/verify-email/forgot-password) —
  -- this table was never fully captured in a migration, so a live database
  -- created before these columns existed is missing them: PGRST204 "Could
  -- not find the 'company' column of 'users'" is exactly that gap surfacing.
  phone text,
  company text,
  email_verified boolean not null default false,
  email_verification_token text,
  is_blocked boolean not null default false,
  reset_token text,
  reset_token_expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists workspaces (
  id text primary key,
  user_id text references users(id) on delete cascade,
  name text,
  data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Atomic top-level merge into workspaces.data, replacing the old app-level
-- read-modify-write in update_workspace() (Python: read ws.data, merge keys in
-- memory, write the whole blob back). That pattern races: two concurrent PATCH
-- requests each read data before either write commits, so whichever commits
-- second overwrites the other's change to a key it never even touched (e.g. a
-- Catalogue "add customer" PATCH and a Financials "save invoice" PATCH landing
-- close together — one silently reverts the other's top-level key). Doing the
-- merge as a single UPDATE ... SET data = data || patch inside Postgres closes
-- that window: the read and the write happen atomically in one statement.
-- financials keeps the one-level-deeper merge the app code already special-cased
-- (so a patch that only touches financials.invoices doesn't wipe
-- financials.expenses written by another endpoint).
create or replace function merge_workspace_data(
  p_workspace_id text,
  p_user_id text,
  p_patch jsonb,
  p_name text default null
) returns workspaces
language plpgsql
as $$
declare
  result workspaces;
begin
  update workspaces
  set
    data = coalesce(data, '{}'::jsonb)
      || (p_patch - 'financials')
      || case
           when p_patch ? 'financials' then
             jsonb_build_object(
               'financials',
               coalesce(data->'financials', '{}'::jsonb) || (p_patch->'financials')
             )
           else '{}'::jsonb
         end,
    name = coalesce(nullif(trim(p_name), ''), name),
    updated_at = now()
  where id = p_workspace_id and user_id = p_user_id
  returning * into result;

  return result;
end;
$$;

-- Reconstructed: referenced throughout the backend (credits, plans, auth,
-- integrations, idea_validation) but was never captured in a migration file —
-- it was created ad hoc in the Supabase dashboard on the existing projects.
-- Included here so a fresh project has it too.
create table if not exists user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique references users(id) on delete cascade,
  plan_key text not null default 'explorer',
  billing_period text not null default 'monthly',
  status text not null default 'trial',
  stripe_subscription_id text,
  stripe_customer_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_started_at timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists user_subscriptions_user_idx on user_subscriptions(user_id);
create index if not exists user_subscriptions_stripe_sub_idx on user_subscriptions(stripe_subscription_id);
create index if not exists user_subscriptions_stripe_cust_idx on user_subscriptions(stripe_customer_id);

create table if not exists workspace_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id text references workspaces(id) on delete cascade,
  company_name text not null,
  legal_name text,
  registration_number text,
  business_type text not null,
  primary_industry text not null,
  secondary_industries text[],
  about_company text not null,
  tagline text,
  year_established int,
  company_size text,
  vision text,
  mission text,
  core_values text[],
  country text not null,
  city text not null,
  state_or_region text,
  postcode text,
  address_line_1 text,
  address_line_2 text,
  email text not null,
  phone_number text,
  website text,
  linkedin_url text,
  twitter_url text,
  instagram_url text,
  facebook_url text,
  monthly_revenue_range text,
  employee_count int,
  operating_stage text not null,
  delivery_model text not null,
  target_customer_type text,
  primary_revenue_model text,
  key_offering_focus text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  workspace_id text references workspaces(id) on delete cascade,
  service_name text not null,
  service_category text not null,
  service_description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists blueprint_documents (
  id text primary key,
  user_id text references users(id) on delete cascade,
  type text not null,
  title text,
  company_name text,
  industry text,
  pricing_model text,
  workspace_id text,
  document_markdown text,
  document_html text,
  provider text,
  model text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- Financial documents (invoice_template, sales_quotation) create one record per
-- document, so the (user_id, type) uniqueness constraint must not exist.
alter table blueprint_documents drop constraint if exists blueprint_documents_user_id_type_key;

create table if not exists blueprint_document_shares (
  id uuid primary key default gen_random_uuid(),
  user_id text references users(id) on delete cascade,
  document_id text references blueprint_documents(id) on delete cascade,
  token text unique not null,
  email text,
  revoked boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz,
  accepted_at timestamptz,
  expires_at timestamptz
);

alter table blueprint_document_shares add column if not exists email text;
alter table blueprint_document_shares add column if not exists accepted_at timestamptz;
alter table blueprint_document_shares add column if not exists expires_at timestamptz;

create index if not exists blueprint_document_shares_token_idx on blueprint_document_shares(token);
create index if not exists blueprint_document_shares_document_idx on blueprint_document_shares(document_id);

create table if not exists ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id text references users(id) on delete set null,
  feature text not null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 8),
  request_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz default now()
);

create index if not exists ai_usage_events_created_at_idx on ai_usage_events(created_at desc);
create index if not exists ai_usage_events_user_id_idx on ai_usage_events(user_id);
create index if not exists ai_usage_events_feature_idx on ai_usage_events(feature);

-- Workspace invitations: pending/accepted/revoked invites with granular permissions
create table if not exists workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text references workspaces(id) on delete cascade,
  invited_by_user_id text references users(id) on delete cascade,
  email text,
  token text unique not null,
  permission_type text not null,
  permissions jsonb not null default '{}',
  status text not null default 'pending',
  created_at timestamptz default now(),
  expires_at timestamptz,
  accepted_at timestamptz,
  accepted_by_user_id text references users(id)
);

create index if not exists workspace_invitations_token_idx on workspace_invitations(token);
create index if not exists workspace_invitations_workspace_idx on workspace_invitations(workspace_id);

-- Workspace members: users who have accepted an invitation and their access permissions
create table if not exists workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id text references workspaces(id) on delete cascade,
  user_id text references users(id) on delete cascade,
  invited_by_user_id text references users(id),
  permission_type text not null,
  permissions jsonb not null default '{}',
  role text not null default 'member',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(workspace_id, user_id)
);

create index if not exists workspace_members_workspace_idx on workspace_members(workspace_id);
create index if not exists workspace_members_user_idx on workspace_members(user_id);

create table if not exists upgrade_clicks (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  email text,
  feature text,
  source text,
  clicked_at timestamptz default now()
);

create table if not exists scenario_runs (
  scenario_run_id text primary key,
  tenant_id text,
  business_id text,
  state_version text,
  scenario_template_id text,
  scenario_mode text,
  scenario_name text,
  scenario_type text,
  parameters jsonb,
  baseline_snapshot jsonb,
  scenario_snapshot jsonb,
  engine_version text,
  status text,
  timeline_months int,
  created_by_user_id text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now(),
  baseline_metrics jsonb,
  scenario_metrics jsonb,
  deltas jsonb,
  state_result text
);

create table if not exists scenario_timelines (
  id uuid primary key default gen_random_uuid(),
  scenario_run_id text,
  created_at timestamptz default now(),
  month_index int,
  revenue numeric,
  costs numeric,
  profit numeric,
  cash_balance numeric,
  stability_score numeric,
  state_label text,
  runway_months numeric
);

create table if not exists scenario_recommendations (
  recommendation_id text primary key,
  scenario_run_id text,
  action_type text,
  title text,
  description text,
  priority int,
  created_at timestamptz default now()
);

create table if not exists scenario_decisions (
  decision_memory_id text primary key,
  tenant_id text,
  business_id text,
  scenario_run_id text,
  selected_recommendation_id text,
  decision_status text,
  notes text,
  outcome_status text,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists scenario_risk_signals (
  risk_signal_id text primary key,
  tenant_id text,
  business_id text,
  state_version text,
  detected_at timestamptz,
  created_at timestamptz default now(),
  risk_type text,
  severity text,
  metric_name text,
  metric_value numeric,
  threshold_value numeric,
  reason_code text
);

-- ── Admin: user blocking & platform-level restrictions ────────────────────────

alter table users add column if not exists is_blocked boolean not null default false;
alter table users add column if not exists block_reason text;

create table if not exists user_platform_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id text references users(id) on delete cascade,
  module_key text not null,
  feature_key text not null default '',
  created_by text references users(id),
  created_at timestamptz default now()
);

-- empty feature_key means the entire module is blocked
create unique index if not exists upr_user_module_feature_idx
  on user_platform_restrictions(user_id, module_key, feature_key);

create index if not exists upr_user_idx on user_platform_restrictions(user_id);

-- ── Per-user platform grants (admin can grant plan-locked modules to a user) ──
create table if not exists user_platform_grants (
  id uuid primary key default gen_random_uuid(),
  user_id text references users(id) on delete cascade,
  module_key text not null,
  feature_key text not null default '',
  created_by text references users(id),
  created_at timestamptz default now()
);

-- empty feature_key means the entire module is granted
create unique index if not exists upg_user_module_feature_idx
  on user_platform_grants(user_id, module_key, feature_key);

create index if not exists upg_user_idx on user_platform_grants(user_id);

-- ── Marketplace ratings ───────────────────────────────────────────────────────

create table if not exists marketplace_ratings (
  id uuid primary key default gen_random_uuid(),
  workspace_id text references workspaces(id) on delete cascade,
  user_id text references users(id) on delete cascade,
  rating int not null check (rating >= 1 and rating <= 5),
  review text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(workspace_id, user_id)
);

create index if not exists marketplace_ratings_workspace_idx on marketplace_ratings(workspace_id);
create index if not exists marketplace_ratings_user_idx on marketplace_ratings(user_id);

-- Mailing list (populated from marketplace reviews + other sources)
create table if not exists mailing_list (
  id text primary key,
  email text not null unique,
  source text,
  subscribed_at timestamptz default now()
);

create index if not exists mailing_list_email_idx on mailing_list(email);

-- Migration: add rater_email for guest reviews
alter table marketplace_ratings add column if not exists rater_email text;
do $$ begin
  alter table marketplace_ratings add constraint marketplace_ratings_ws_email_unique unique(workspace_id, rater_email);
exception when duplicate_object or duplicate_table then null;
end $$;

create table if not exists support_messages (
  id text primary key,
  name text,
  email text,
  message text not null,
  type text not null default 'support',
  created_at timestamptz default now()
);

create index if not exists support_messages_created_idx on support_messages(created_at desc);

-- Migration: add type column to existing deployments
alter table support_messages add column if not exists type text not null default 'support';

create table if not exists module_interest (
  id text primary key,
  email text not null,
  feature text not null,
  clicked_at timestamptz default now()
);

create index if not exists module_interest_feature_idx on module_interest(feature);
create index if not exists module_interest_clicked_idx on module_interest(clicked_at desc);
-- Migration: drop old unique constraint if it was previously created
-- alter table module_interest drop constraint if exists module_interest_email_feature_key;

-- Reconstructed (same situation as user_subscriptions above): referenced by
-- the backend but never captured in a migration file.

create table if not exists demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  company text not null,
  phone text,
  role text,
  message text,
  created_at timestamptz default now()
);

create index if not exists demo_requests_created_idx on demo_requests(created_at desc);

create table if not exists faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  "order" int not null default 0,
  created_at timestamptz default now()
);

create index if not exists faqs_order_idx on faqs("order");

create table if not exists plan_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  plan_key text not null,
  billing_period text,
  joined_at timestamptz default now()
);

create index if not exists plan_waitlist_email_plan_idx on plan_waitlist(email, plan_key);

create table if not exists research_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  type text not null default 'Research',
  content text,
  status text not null default 'draft',
  published_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists research_items_status_idx on research_items(status);
create index if not exists research_items_created_idx on research_items(created_at desc);
