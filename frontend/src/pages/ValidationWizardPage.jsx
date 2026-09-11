import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import { ToastContainer } from "../components/Toast";
import Input from "../components/Input";
import SectionCard from "../components/SectionCard";
import Spinner from "../components/Spinner";
import SegmentedTabs from "../components/SegmentedTabs";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import { hasFeatureAccess, isPlatformFeatureRestricted, isPlatformModuleGranted } from "../lib/permissions";
import { useAuthStore } from "../store/auth";
import InfoTip from "../components/InfoTip";
import NumberInput, { parseIntSafe, parseNumber } from "../components/NumberInput";
import { CURRENCY_CODES, currencyLabel, getCurrencySymbol } from "../lib/currencies";
import { imageFileToDataUrl } from "../lib/files";
import ConfirmDialog from "../components/ConfirmDialog";
import { generateValidationInsightPdf } from "../lib/reports/index";
import ValidationLoadingOverlay from "../components/ValidationLoadingOverlay";
import { useDemoTour } from "../context/DemoTourContext";
import CreditConfirmModal from "../components/CreditConfirmModal";

function humanizeValidationError(e) {
  const msg = e instanceof Error ? e.message : String(e || "");
  if (e?.code === "NETWORK_ERROR" || msg === "NETWORK_ERROR") {
    // Same dev-facing-copy-shown-to-real-users issue fixed in store/auth.js —
    // the API base URL and "check the backend" phrasing only make sense to
    // a developer running this locally.
    if (import.meta.env.DEV) {
      const base = import.meta.env.VITE_API_URL ?? import.meta.env.REACT_APP_BACKEND_URL ?? "http://localhost:8000";
      return `Can't reach the server at ${base}. Start the backend and check your API URL.`;
    }
    return "We couldn't reach the server. Please check your connection and try again in a moment.";
  }
  if (msg === "TIMEOUT") return "The server is taking too long to respond. Please try again in a moment.";
  if (msg.startsWith("HTTP 401:")) return "Please sign in to continue.";
  if (msg.startsWith("HTTP 403:")) {
    const detail = msg.replace(/^HTTP 403:\s*/i, "").trim();
    return detail || "You have reached the limit for your current plan. Upgrade to continue.";
  }
  if (msg.startsWith("HTTP 422:")) {
    const detail = msg.replace(/^HTTP 422:\s*/i, "").trim();
    return detail ? `Validation error: ${detail}` : "Please check the required fields and try again.";
  }
  return msg;
}

function CheckboxDropdown({ options, selected, onChange, placeholder = "Select..." }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);
  const label = selected.length === 0 ? placeholder : selected.join(", ");
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ea-input flex w-full items-center justify-between gap-2 text-left"
      >
        <span className={"flex-1 truncate text-sm " + (selected.length === 0 ? "text-slate-400" : "text-slate-800")}>{label}</span>
        <svg className={"h-4 w-4 shrink-0 text-slate-400 transition-transform " + (open ? "rotate-180" : "")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full min-w-[220px] rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="max-h-56 overflow-y-auto p-2 space-y-0.5">
            {options.map((opt) => {
              const checked = selected.includes(opt);
              return (
                <label key={opt} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onChange(checked ? selected.filter((o) => o !== opt) : [...selected, opt])}
                    className="accent-brand-600 h-3.5 w-3.5"
                  />
                  <span className="text-sm text-slate-700">{opt}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children, info }) {
  return (
    <div className="ea-label flex items-center gap-1">
      <div>{children}</div>
      {info ? <InfoTip text={info} /> : null}
    </div>
  );
}

function WorkspaceAiFill({ field, profile, onFill }) {
  const [busy, setBusy] = useState(false);
  async function fill() {
    setBusy(true);
    try {
      const res = await apiRequest("/blueprint/suggest-field", "POST", {
        field,
        company_name: profile?.company_name || "",
        industry: profile?.primary_industry || "",
        target_market: "",
        problem: "",
        solution: "",
        value_proposition: profile?.about_company || "",
        selected_services: (profile?.services || []).map((s) => s.service_name).filter(Boolean),
      });
      if (res?.value) onFill(res.value);
    } catch {
      // silent fail
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={fill}
      disabled={busy}
      className="ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50 transition-colors"
    >
      {busy ? "..." : "✦ AI Fill"}
    </button>
  );
}

function FormSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={"overflow-hidden rounded-2xl border bg-white transition-colors " + (open ? "border-brand-200 shadow-sm" : "border-slate-200")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <svg
          className={"h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 " + (open ? "rotate-180" : "")}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? <div className="px-5 pb-5">{children}</div> : null}
    </div>
  );
}

const UPPER_ABBREVIATIONS = new Set(["llp", "sme", "smes", "b2b", "b2c", "b2g", "it", "hr", "uk", "usa"]);
const VALIDATION_DEFAULTS_KEY = "ea_validation_stage_defaults";
const V4_DRAFT_KEY = "ea_v4_draft";
const FREQUENCY_OPTIONS = ["daily", "weekly", "monthly", "yearly", "custom"];

function loadV4Draft() {
  try {
    const raw = window.localStorage.getItem(V4_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function saveV4Draft(form, step, journey) {
  try { window.localStorage.setItem(V4_DRAFT_KEY, JSON.stringify({ form, step, journey })); } catch {}
}
function clearV4Draft() {
  try { window.localStorage.removeItem(V4_DRAFT_KEY); } catch {}
}

function loadValidationStageDefaults() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(VALIDATION_DEFAULTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function deriveFrequencyFields(value) {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase();
  if (!raw) {
    return { frequency: "", frequency_category: "", frequency_custom: "" };
  }
  if (["daily", "weekly", "monthly", "yearly"].includes(normalized)) {
    return { frequency: normalized, frequency_category: normalized, frequency_custom: "" };
  }
  return { frequency: raw, frequency_category: "custom", frequency_custom: raw };
}

function buildInitialBusinessForm() {
  const defaults = loadValidationStageDefaults();
  const frequencyFields = deriveFrequencyFields(defaults.frequency || "");
  return {
    pathway: "",
    context: {
      business_name: defaults.business_name || "",
      business_type_category: defaults.business_type_category || "Technology",
      business_type_other: defaults.business_type_other || "",
      primary_industry_category: defaults.primary_industry_category || "IT",
      primary_industry_other: defaults.primary_industry_other || "",
      location: defaults.location || "",
      currency: defaults.currency || "GBP",
      industry_category: defaults.industry_category || "",
      industry_other: defaults.industry_other || "",
      sector_category: defaults.sector_category || "",
      sector_other: defaults.sector_other || "",
      country: defaults.country || "",
      country_other: defaults.country_other || "",
      founder_hours_per_week: "40",
      stage: "idea",
      description: "" // NEW: for the large textarea idea
    },
    problem: {
      customer_segment_category: defaults.customer_segment_category || "SMEs",
      customer_segment_other: defaults.customer_segment_other || "",
      problem_type: defaults.problem_type || "", // Map to "What problem?"
      proposed_solution: "",
      severity: "Moderate", // NEW
      frequency: frequencyFields.frequency,
      frequency_category: frequencyFields.frequency_category,
      frequency_custom: frequencyFields.frequency_custom,
      alternatives: defaults.alternatives || ""
    },
    offer: {
      service_type: defaults.service_type || "", // Map to "How solve better?"
      pricing_model: "fixed_job",
      price_per_unit: "",
      deliverable_unit_category: "unit",
      deliverable_unit_other: ""
    },
    validation: {
      spoken_count: "No", // NEW
      demand_proof: [] // NEW: Checkboxes
    },
    demand: { expected_units_per_month: "", expected_customers: "", sales_cycle_days: "", payment_terms_days: "14" },
    costs: { variable_cost_per_unit: "", fixed_costs_monthly: "", founder_draw_monthly: "", contractor_costs_monthly: "" },
    capacity: { team_size: "1", capacity_units_per_person_per_month: "" },
    cash: { starting_cash: "", upfront_costs: "" },
    go_to_market: { target_market: "B2C", customer_budget_level: "Unknown", sub_industry: "", channels: [] }
  };
}

function mergeStageDefaultsIntoBusinessForm(source) {
  const defaults = loadValidationStageDefaults();
  const next = structuredClone(source || buildInitialBusinessForm());
  next.context ||= {};
  next.problem ||= {};
  next.offer ||= {};
  next.validation ||= {};

  next.context.business_name ||= defaults.business_name || "";
  next.context.business_type_category ||= defaults.business_type_category || "Technology";
  next.context.business_type_other ||= defaults.business_type_other || "";
  next.context.primary_industry_category ||= defaults.primary_industry_category || "IT";
  next.context.primary_industry_other ||= defaults.primary_industry_other || "";
  next.context.location ||= defaults.location || "";
  next.context.currency ||= defaults.currency || "GBP";
  next.context.industry_category ||= defaults.industry_category || "";
  next.context.industry_other ||= defaults.industry_other || "";
  next.context.sector_category ||= defaults.sector_category || "";
  next.context.sector_other ||= defaults.sector_other || "";
  next.context.country ||= defaults.country || "";
  next.context.country_other ||= defaults.country_other || "";

  next.problem.customer_segment_category ||= defaults.customer_segment_category || "SMEs";
  next.problem.customer_segment_other ||= defaults.customer_segment_other || "";
  next.problem.problem_type ||= defaults.problem_type || "";
  next.problem.alternatives ||= defaults.alternatives || "";

  if (!String(next.problem.frequency || "").trim()) {
    next.problem.frequency = defaults.frequency || "";
  }

  next.offer.service_type ||= defaults.service_type || "";
  return next;
}

function formatEnumLabel(value) {
  const raw = String(value || "");
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (UPPER_ABBREVIATIONS.has(lower)) return raw.toUpperCase();
  if (/^\d/.test(raw)) return raw;
  return raw
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function AISuggest({ onAccept, context }) {
  const [suggestion, setSuggestion] = useState(null);
  const [loading, setLoading] = useState(false);

  async function fetchSuggestion() {
    setLoading(true);
    setSuggestion(null);
    try {
      const res = await apiRequest("/validation/suggest-field", "POST", context);
      if (res?.suggestion) {
        setSuggestion(res.suggestion);
        window.dispatchEvent(new CustomEvent("ea:credits:refresh"));
      }
    } catch (_) {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      <button
        type="button"
        onClick={fetchSuggestion}
        disabled={loading}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 transition hover:bg-brand-100 disabled:opacity-50 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-300"
      >
        {loading ? (
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83"/>
          </svg>
        ) : (
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
          </svg>
        )}
        {loading ? "Thinking…" : "AI Suggest"}
      </button>

      {suggestion && (
        <div className="flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50/60 px-3 py-2 dark:border-brand-800 dark:bg-brand-950/30">
          <p className="flex-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">{suggestion}</p>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={() => { onAccept(suggestion); setSuggestion(null); }}
              className="rounded-lg bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-brand-700"
            >
              Use
            </button>
            <button
              type="button"
              onClick={() => setSuggestion(null)}
              className="rounded-lg border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ResumeButton({ entry, onEdit }) {
  const [loading, setLoading] = useState(false);
  const label = entry.status === "accepted" || entry.status === "rejected" ? "View" : "Resume";

  async function handleClick(e) {
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    try {
      await onEdit(entry);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button size="sm" variant="secondary" disabled={loading} onClick={handleClick}>
      {loading ? <><Spinner size={12} /> Loading…</> : label}
    </Button>
  );
}

export default function ValidationWizardPage() {
  const navigate = useNavigate();
  const { triggerDemoGate } = useDemoTour() || {};
  const [searchParams] = useSearchParams();
  const editingWorkspaceId = searchParams.get("workspace_id");
  const fromOtherModule = searchParams.get("from") === "module";
  const isCreateWorkspace = fromOtherModule;
  const returnTo = searchParams.get("return");
  const requestedHistoryId = searchParams.get("history_id");
  const requestedHistoryType = searchParams.get("history_type");
  const requestedEditMode = searchParams.get("edit") === "1";
  const storedWorkspaceId = useWorkspaceStore((s) => s.workspaceId);
  const isMemberMode = useWorkspaceStore((s) => s.isMemberMode);
  const memberPermissionType = useWorkspaceStore((s) => s.memberPermissionType);
  const memberPermissions = useWorkspaceStore((s) => s.memberPermissions);
  const platformRestrictions = useAuthStore((s) => s.platformRestrictions);
  const platformGrants = useAuthStore((s) => s.platformGrants);
  const refreshGrants = useAuthStore((s) => s.refreshGrants);
  const subscription = useAuthStore((s) => s.subscription);
  const hasValidationGrant = isPlatformModuleGranted("validation", platformGrants);
  const canAccessComprehensive = hasValidationGrant || (subscription &&
    !["free_trial", "explorer", "expired", ""].includes(subscription.plan_key ?? "") &&
    !["trial", "expired"].includes(subscription.status ?? ""));

  const canEvaluateIdea =
    !isPlatformFeatureRestricted("validation", "evaluate_idea", platformRestrictions) &&
    (!isMemberMode || hasFeatureAccess("validation", "evaluate_idea", memberPermissionType, memberPermissions));
  const canServiceValidation =
    !isPlatformFeatureRestricted("validation", "service_validation", platformRestrictions) &&
    (!isMemberMode || hasFeatureAccess("validation", "service_validation", memberPermissionType, memberPermissions));

  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const setWorkspaceNameStore = useWorkspaceStore((s) => s.setWorkspaceName);
  const setWorkspaceLogoStore = useWorkspaceStore((s) => s.setWorkspaceLogo);
  const setDecisionStatus = useWorkspaceStore((s) => s.setDecisionStatus);
  const setServiceDecisionStatus = useWorkspaceStore((s) => s.setServiceDecisionStatus);
  const setInputs = useWorkspaceStore((s) => s.setInputs);
  const setIdeaValidation = useWorkspaceStore((s) => s.setIdeaValidation);
  const draftIdeaValidation = useWorkspaceStore((s) => s.draftIdeaValidation);
  const draftServiceIdea = useWorkspaceStore((s) => s.draftServiceIdea);
  const setDraftIdeaValidation = useWorkspaceStore((s) => s.setDraftIdeaValidation);
  const setDraftServiceIdea = useWorkspaceStore((s) => s.setDraftServiceIdea);
  const setValidation = useWorkspaceStore((s) => s.setValidation);
  const setValidationEntryId = useWorkspaceStore((s) => s.setValidationEntryId);
  const setCurrency = useWorkspaceStore((s) => s.setCurrency);
  const authEmail = useAuthStore((s) => s.email);

  const [mode, setMode] = useState(fromOtherModule ? "fill" : "v4"); // v4 | fill
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState(null);
  const [creditModal, setCreditModal] = useState(null);
  const [isPrefilling, setIsPrefilling] = useState(false);
  const [savedNotice, setSavedNotice] = useState(null);
  const [toasts, setToasts] = useState([]);

  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const addToast = useCallback((message, kind = "info") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((t) => [...t, { id, message, kind }]);
  }, []);

  useEffect(() => { refreshGrants(); }, []);

  // Bridge: convert error / savedNotice state to branded toasts
  useEffect(() => {
    if (!error) return;
    addToast(error, "error");
    setError(null);
  }, [error, addToast]);

  useEffect(() => {
    if (!savedNotice) return;
    addToast(savedNotice, "success");
    setSavedNotice(null);
  }, [savedNotice, addToast]);
  const [existingCatalogue, setExistingCatalogue] = useState({ products: [], customers: [], vendors: [] });
  const [savedServiceIdeas, setSavedServiceIdeas] = useState([]);
  const [validationHistory, setValidationHistory] = useState([]);
  const [editingHistoryEntry, setEditingHistoryEntry] = useState(null);
  const [isRejectedReedit, setIsRejectedReedit] = useState(false);
  const [serviceSelection, setServiceSelection] = useState("");
  const [hasAppliedDrafts, setHasAppliedDrafts] = useState(false);
  const [serviceFormDirty, setServiceFormDirty] = useState(false);
  const [contentTab, setContentTab] = useState("builder");
  const [lastEvaluationId, setLastEvaluationId] = useState(null);
  const [showBuilderMarketInsight, setShowBuilderMarketInsight] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [addToMarketplaceModal, setAddToMarketplaceModal] = useState(null); // { title, description }
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historyTypeFilter, setHistoryTypeFilter] = useState("all");
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const HISTORY_PAGE_SIZE = 10;
  const [historyRequestHandled, setHistoryRequestHandled] = useState(false);
  const [businessMarketResearch, setBusinessMarketResearch] = useState(null);
  const [businessResearchHash, setBusinessResearchHash] = useState(null);
  const [serviceMarketResearch, setServiceMarketResearch] = useState(null);
  const [serviceResearchHash, setServiceResearchHash] = useState(null);
  const [mrResearchTab, setMrResearchTab] = useState("business");
  const [mrLoading, setMrLoading] = useState(false);
  const [mrError, setMrError] = useState(null);
  const [insightPdfLoading, setInsightPdfLoading] = useState(false);
  const [lastResearchHash, setLastResearchHash] = useState(null);
  const [showAdvancedOffer, setShowAdvancedOffer] = useState(false);
  const initialStageDefaults = useMemo(() => loadValidationStageDefaults(), []);

  // ---- V4 Universal Wizard state ----
  const _v4Draft = loadV4Draft();
  const [v4Journey, setV4Journey] = useState(null); // always start at selection screen
  const [v4Step, setV4Step] = useState(0); // always start at step 0
  const [v4Form, setV4Form] = useState(_v4Draft?.form ?? {});
  const [v4Error, setV4Error] = useState(null);
  const v4ErrorRef = useRef(null);
  const [v4Saving, setV4Saving] = useState(false);
  const [v4Suggesting, setV4Suggesting] = useState(null); // "${step}_${field}" when loading

  const V4_IDEA_TYPES = [
    "Professional service", "Local service", "Digital service", "SaaS", "Software product",
    "Mobile application", "Marketplace", "Platform business", "Physical product", "E-commerce",
    "Subscription business", "Training or education", "Event or conference", "Community or membership",
    "Property or real estate", "Manufacturing", "Franchise", "Social enterprise", "Nonprofit",
    "Internal enterprise solution", "Existing-business product extension", "Existing-business service extension",
    "Hybrid", "Other",
  ];
  const V4_BUSINESS_STAGES = [
    "Idea only", "Customer discovery", "Prototype", "MVP", "Pilot",
    "Pre-revenue", "Early revenue", "Existing customers", "Scaling", "Existing business extension",
  ];
  const V4_CUSTOMER_MODELS = ["B2C", "B2B", "B2B2C", "B2G", "C2C", "Nonprofit beneficiary", "Internal organisational users", "Hybrid"];
  const V4_PAIN_SEVERITIES = ["mild", "moderate", "severe", "critical"];
  const V4_FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "rarely", "unknown"];
  const V4_URGENCIES = ["urgent", "moderate", "deferrable", "unknown"];
  const V4_TRENDS = ["growing", "stable", "declining", "unknown"];
  const V4_SPECIFICITIES = ["broad", "moderate", "narrow", "niche"];
  const V4_CHANNELS = ["Paid ads", "Organic/SEO", "Social media", "Email", "Referrals", "Partnerships", "Direct sales", "Events", "Marketplace", "Cold outreach", "PR/Media", "In-store", "Other"];
  const V4_IP_MOATS = ["none", "IP", "network_effects", "data", "process", "expertise"];
  const V4_MARKET_SCOPES = ["local", "regional", "national", "global"];
  const V4_PURCHASE_FREQUENCIES = ["one-off", "daily", "weekly", "monthly", "quarterly", "annually", "irregular", "unknown"];
  const V4_DELIVERY_METHODS = ["Web app (SaaS)", "Mobile app", "Desktop software", "API / integration", "In-person service", "Remote service", "Physical product delivery", "Marketplace", "Hybrid digital and physical", "Other"];
  const V4_PROBLEM_AFFECTS = ["Buyer only", "End user only", "Both buyer and user", "Unknown"];
  const V4_MARKET_GROWTHS = ["yes", "no", "unknown"];
  const V4_REVENUE_MODELS = ["One-off sale", "Subscription", "Usage-based", "Freemium", "Marketplace commission", "Service fee", "Licensing", "Advertising", "Donation/Grant", "Hybrid", "Other"];
  const V4_FOUNDER_EXPERIENCE = ["none", "some", "relevant", "deep"];
  const V4_REG_RISKS = ["none", "low", "medium", "high", "unknown"];
  const V4_EVIDENCE_TYPES = [
    { id: "no_evidence", label: "No evidence yet" },
    { id: "personal_experience", label: "Personal experience" },
    { id: "informal_conversations", label: "Informal conversations" },
    { id: "customer_interviews", label: "Customer interviews" },
    { id: "survey_responses", label: "Survey responses" },
    { id: "social_media_engagement", label: "Social media engagement" },
    { id: "search_demand", label: "Search demand data" },
    { id: "landing_page_visits", label: "Landing page visits" },
    { id: "email_sign_ups", label: "Email sign-ups" },
    { id: "waiting_list", label: "Waiting list" },
    { id: "letters_of_intent", label: "Letters of intent" },
    { id: "requests_for_quotation", label: "Requests for quotation" },
    { id: "pre_orders", label: "Pre-orders" },
    { id: "deposits", label: "Deposits received" },
    { id: "paid_pilots", label: "Paid pilots" },
    { id: "existing_customers", label: "Existing paying customers" },
    { id: "repeat_customers", label: "Repeat customers" },
    { id: "revenue", label: "Revenue generated" },
    { id: "retention_data", label: "Retention data" },
    { id: "usage_data", label: "Usage data" },
  ];

  const BASIC_STEPS = [1, 2];
  const COMP_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const V4_STEP_TITLES = {
    1: "Idea Identity",
    2: "Problem",
    3: "Customer",
    4: "Current Alternatives",
    5: "Proposed Solution",
    6: "Market",
    7: "Revenue & Pricing",
    8: "Costs & Economics",
    9: "Capacity & Operations",
    10: "Traction & Evidence",
    11: "Founder Readiness",
    12: "Regulatory Risk",
  };

  function getV4Steps() {
    return v4Journey === "basic" ? BASIC_STEPS : COMP_STEPS;
  }

  function setV4Field(step, field, value) {
    setV4Form((prev) => ({
      ...prev,
      [`step${step}`]: { ...(prev[`step${step}`] || {}), [field]: value },
    }));
  }

  function getV4(step, field, fallback = "") {
    return (v4Form[`step${step}`] || {})[field] ?? fallback;
  }

  function toggleV4ArrayField(step, field, item) {
    const current = getV4(step, field, []);
    const arr = Array.isArray(current) ? current : [];
    const next = arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
    setV4Field(step, field, next);
  }

  function markV4StepComplete(stepNum) {
    setV4Form((prev) => {
      const done = Array.isArray(prev.steps_completed) ? prev.steps_completed : [];
      if (done.includes(stepNum)) return prev;
      return { ...prev, steps_completed: [...done, stepNum] };
    });
  }

  async function handleV4AISuggest(step, field, contextOverride = {}) {
    const key = `${step}_${field}`;
    setV4Suggesting(key);
    const step1 = v4Form.step1 || {};
    const step2 = v4Form.step2 || {};
    const step3 = v4Form.step3 || {};
    const step4 = v4Form.step4 || {};
    const step5 = v4Form.step5 || {};
    const step6 = v4Form.step6 || {};
    const context = {
      // Core identity
      description: [step1.idea_name, step1.idea_tagline, step1.idea_description].filter(Boolean).join(" — "),
      industry: step1.idea_type || "",
      sector: step1.idea_sector || "",
      business_stage: step1.business_stage || "",
      customer_model: step1.customer_model || "",
      location: step1.launch_geography || "",
      country: step1.operating_country || "",
      // Problem
      problem: step2.problem_description || "",
      who_affected: step2.who_affected || "",
      pain_severity: step2.pain_severity || "",
      frequency: step2.problem_frequency || "",
      // Customer
      segment: step3.primary_segment || "",
      beachhead: step3.beachhead_segment || "",
      economic_buyer: step3.economic_buyer || "",
      // Competition
      alternatives: step4.how_solve_currently || "",
      competitors: (step4.direct_competitors || []).join(", "),
      substitutes: (step4.substitutes || []).join(", "),
      // Solution
      solution: step5.solution_description || "",
      core_outcome: step5.core_outcome || "",
      why_better: step5.why_better || "",
      // Market
      market_category: step6.market_category || "",
      ...contextOverride,
    };
    try {
      const res = await apiRequest("/validation/suggest-field", "POST", { field, ...context });
      if (res?.suggestion) {
        const raw = res.suggestion.replace(/^[\s\-–—•·*]+/gm, "").trim();
        // Array fields: split suggestion into items
        if (["direct_competitors", "substitutes", "main_features", "main_benefits"].includes(field)) {
          const items = raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
          setV4Field(step, field, items);
        } else {
          setV4Field(step, field, raw.replace(/\n+/g, " ").trim());
        }
        window.dispatchEvent(new CustomEvent("ea:credits:refresh"));
      }
    } catch { /* silent */ } finally {
      setV4Suggesting(null);
    }
  }

  function v4SuggestBtn(step, field, override) {
    const key = `${step}_${field}`;
    const busy = v4Suggesting === key;
    return (
      <button
        type="button"
        disabled={busy || Boolean(v4Suggesting)}
        className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        onClick={() => handleV4AISuggest(step, field, override)}
      >
        {busy ? (
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
          </svg>
        ) : (
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
          </svg>
        )}
        {busy ? "Thinking..." : "AI Suggest"}
      </button>
    );
  }

  async function handleV4Evaluate() {
    setV4Error(null);
    setV4Saving(true);
    setIsValidating(true);
    try {
      const steps = getV4Steps();
      const stepsCompleted = Array.isArray(v4Form.steps_completed) ? v4Form.steps_completed : steps;
      const payload = {
        ...v4Form,
        validation_mode: v4Journey,
        currency: getV4(1, "currency", "GBP") || "GBP",
        steps_completed: stepsCompleted,
        workspace_id: editingWorkspaceId || storedWorkspaceId || null,
      };
      const result = await apiRequest("/validation/evaluate-v4", "POST", payload, { timeoutMs: 300000 });
      if (!result || !result.scores) {
        setV4Error("Validation did not return a result. Please try again. If the problem persists, try simplifying your inputs.");
        setIsValidating(false);
        return;
      }
      setValidation(result);

      // Persist to workspace history
      const wsId = editingWorkspaceId || storedWorkspaceId;
      if (wsId) {
        const validationId = crypto.randomUUID();
        setValidationEntryId(validationId);
        const { research_data: _rd, ...resultForHistory } = result || {};
        const entry = {
          id: validationId,
          type: "v4_validation",
          title: getV4(1, "idea_name", "Idea Validation"),
          created_at: new Date().toISOString(),
          status: "pending",
          score: result?.scores?.potential_score ?? null,
          confidence: result?.scores?.evidence_confidence_score ?? null,
          verdict: result?.verdict?.category ?? null,
          journey: v4Journey,
          payload,
          result: resultForHistory,
        };
        try {
          const ws = await apiRequest(`/validation/${wsId}`, "GET");
          const existing = Array.isArray(ws?.data?.validation_history) ? ws.data.validation_history : [];
          await apiRequest(`/validation/${wsId}`, "PATCH", {
            data: {
              validation_history: [entry, ...existing.filter((i) => i?.id !== validationId)],
              active_validation_id: validationId,
            },
          }, { timeoutMs: 60000 });
          setValidationHistory([entry, ...validationHistory]);
        } catch { /* silent */ }
      }

      clearV4Draft();
      setSavedNotice("Validation complete. Redirecting to report...");
      window.dispatchEvent(new CustomEvent("ea:credits:refresh"));
      setTimeout(() => navigate("/results"), 800);
    } catch (e) {
      setV4Error(humanizeValidationError(e));
      setIsValidating(false);
    } finally {
      setV4Saving(false);
    }
  }

  const [workspaceName, setWorkspaceName] = useState(() => String(loadValidationStageDefaults().workspace_name || "").trim());
  const [workspaceNameTouched, setWorkspaceNameTouched] = useState(false);

  const BUSINESS_TYPE_OPTIONS = useMemo(() => ["SaaS", "Service / Consulting", "E-commerce", "Agency", "Marketplace", "Physical Product", "Other"], []);
  const PRIMARY_INDUSTRY_OPTIONS = useMemo(() => ["IT", "Marketing", "Consulting", "Accounting", "Legal", "HR", "Design", "Sales", "Operations", "Customer Support", "Healthcare", "Education", "Construction", "Other"], []);
  const INDUSTRY_OPTIONS = useMemo(() => ["Technology", "Healthcare", "Finance & Banking", "Education", "Retail & E-commerce", "Manufacturing", "Real Estate", "Food & Beverage", "Media & Entertainment", "Transportation & Logistics", "Agriculture", "Energy & Utilities", "Construction", "Professional Services", "Legal & Compliance", "Non-Profit", "Government & Public Sector", "Other"], []);
  const SECTOR_OPTIONS = useMemo(() => ["Public Sector", "Private Sector", "Fintech", "EdTech", "HealthTech", "PropTech", "AgriTech", "CleanTech", "LegalTech", "InsurTech", "MarTech", "SaaS", "E-commerce", "Consulting & Advisory", "Media & Publishing", "Logistics & Supply Chain", "Creative & Design", "Other"], []);
  const COUNTRY_CURRENCY_MAP = {
    "United Kingdom": "GBP", "Ireland": "EUR", "Germany": "EUR", "France": "EUR", "Spain": "EUR",
    "Italy": "EUR", "Netherlands": "EUR", "Sweden": "SEK", "Norway": "NOK", "Denmark": "DKK",
    "Finland": "EUR", "Switzerland": "CHF", "Belgium": "EUR", "Austria": "EUR", "Portugal": "EUR",
    "Poland": "PLN", "Greece": "EUR", "Luxembourg": "EUR", "Iceland": "ISK", "Malta": "EUR", "Cyprus": "EUR",
    "United States": "USD", "Canada": "CAD", "Brazil": "BRL", "Mexico": "MXN", "Argentina": "ARS",
    "Australia": "AUD", "New Zealand": "NZD", "Japan": "JPY", "China": "CNY", "India": "INR",
    "South Korea": "KRW", "Singapore": "SGD", "Hong Kong": "HKD",
    "Nigeria": "NGN", "Ghana": "GHS", "Kenya": "KES", "South Africa": "ZAR",
    "Egypt": "EGP", "Morocco": "MAD",
    "UAE": "AED", "Saudi Arabia": "SAR", "Qatar": "QAR", "Israel": "ILS", "Turkey": "TRY",
    "Kuwait": "KWD", "Bahrain": "BHD", "Oman": "OMR",
  };

  const COUNTRY_OPTIONS = useMemo(() => [
    // Europe
    "United Kingdom", "Ireland", "Germany", "France", "Spain", "Italy", "Netherlands", "Sweden", "Norway", "Denmark", "Finland", "Switzerland", "Belgium", "Austria", "Portugal", "Poland", "Greece", "Czech Republic", "Hungary", "Romania", "Ukraine", "Slovakia", "Croatia", "Serbia", "Bulgaria", "Lithuania", "Latvia", "Estonia", "Slovenia", "Luxembourg", "Iceland", "Malta", "Cyprus",
    // Americas
    "United States", "Canada", "Brazil", "Mexico", "Argentina", "Colombia", "Chile", "Peru", "Venezuela", "Ecuador", "Bolivia", "Paraguay", "Uruguay", "Guatemala", "Costa Rica", "Panama", "Dominican Republic", "Jamaica", "Trinidad and Tobago",
    // Africa
    "Nigeria", "Ghana", "Kenya", "South Africa", "Ethiopia", "Egypt", "Tanzania", "Uganda", "Cameroon", "Ivory Coast", "Senegal", "Rwanda", "Morocco", "Algeria", "Tunisia", "Libya", "Sudan", "Zimbabwe", "Zambia", "Mozambique", "Angola",
    // Middle East
    "UAE", "Saudi Arabia", "Qatar", "Israel", "Turkey", "Jordan", "Lebanon", "Kuwait", "Bahrain", "Oman", "Iraq",
    // Asia-Pacific
    "India", "China", "Japan", "South Korea", "Pakistan", "Bangladesh", "Singapore", "Malaysia", "Indonesia", "Philippines", "Thailand", "Vietnam", "Hong Kong", "Taiwan", "Australia", "New Zealand", "Sri Lanka", "Nepal", "Myanmar", "Cambodia", "Kazakhstan", "Uzbekistan",
    "Other",
  ], []);
  const CITIES_BY_COUNTRY = useMemo(() => ({
    "United Kingdom": ["London", "Manchester", "Birmingham", "Glasgow", "Leeds", "Liverpool", "Edinburgh", "Bristol", "Sheffield", "Newcastle", "Nottingham", "Cardiff", "Leicester", "Coventry", "Bradford", "Belfast", "Brighton", "Southampton", "Oxford", "Cambridge"],
    "United States": ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose", "Austin", "Jacksonville", "San Francisco", "Columbus", "Indianapolis", "Seattle", "Denver", "Nashville", "Oklahoma City", "Miami"],
    "Canada": ["Toronto", "Montreal", "Vancouver", "Calgary", "Edmonton", "Ottawa", "Winnipeg", "Quebec City", "Hamilton", "Kitchener", "London", "Victoria", "Halifax", "Oshawa", "Windsor", "Saskatoon", "Regina", "Markham", "Brampton", "Richmond Hill"],
    "Australia": ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast", "Canberra", "Newcastle", "Wollongong", "Logan City", "Geelong", "Hobart", "Townsville", "Cairns", "Darwin", "Toowoomba", "Ballarat", "Bendigo", "Launceston", "Mackay"],
    "Ireland": ["Dublin", "Cork", "Limerick", "Galway", "Waterford", "Drogheda", "Dundalk", "Swords", "Bray", "Navan", "Kilkenny", "Ennis", "Carlow", "Tralee", "Newbridge", "Portlaoise", "Balbriggan", "Naas", "Athlone", "Mullingar"],
    "Germany": ["Berlin", "Hamburg", "Munich", "Cologne", "Frankfurt", "Stuttgart", "Düsseldorf", "Leipzig", "Dortmund", "Essen", "Bremen", "Dresden", "Hanover", "Nuremberg", "Duisburg", "Bochum", "Wuppertal", "Bonn", "Bielefeld", "Mannheim"],
    "France": ["Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Strasbourg", "Montpellier", "Bordeaux", "Lille", "Rennes", "Reims", "Saint-Étienne", "Le Havre", "Toulon", "Grenoble", "Dijon", "Angers", "Nîmes", "Villeurbanne"],
    "Spain": ["Madrid", "Barcelona", "Valencia", "Seville", "Zaragoza", "Málaga", "Murcia", "Palma", "Las Palmas", "Bilbao", "Alicante", "Córdoba", "Valladolid", "Vigo", "Gijón", "Granada", "Elche", "Oviedo", "Badalona", "Cartagena"],
    "Italy": ["Rome", "Milan", "Naples", "Turin", "Palermo", "Genoa", "Bologna", "Florence", "Bari", "Catania", "Venice", "Verona", "Messina", "Padua", "Trieste", "Taranto", "Brescia", "Prato", "Reggio Calabria", "Modena"],
    "Netherlands": ["Amsterdam", "Rotterdam", "The Hague", "Utrecht", "Eindhoven", "Tilburg", "Groningen", "Almere", "Breda", "Nijmegen", "Apeldoorn", "Haarlem", "Arnhem", "Zaanstad", "Amersfoort", "Haarlemmermeer", "'s-Hertogenbosch", "Zwolle", "Maastricht", "Leiden"],
    "Sweden": ["Stockholm", "Gothenburg", "Malmö", "Uppsala", "Linköping", "Västerås", "Örebro", "Helsingborg", "Norrköping", "Jönköping", "Lund", "Umeå", "Gävle", "Borås", "Södertälje", "Eskilstuna", "Halmstad", "Växjö", "Karlstad", "Sundsvall"],
    "Norway": ["Oslo", "Bergen", "Stavanger", "Trondheim", "Drammen", "Fredrikstad", "Kristiansand", "Sandnes", "Tromsø", "Sarpsborg", "Bodø", "Ålesund", "Sandefjord", "Skien", "Moss", "Arendal", "Haugesund", "Tønsberg", "Porsgrunn", "Molde"],
    "Denmark": ["Copenhagen", "Aarhus", "Odense", "Aalborg", "Frederiksberg", "Esbjerg", "Randers", "Kolding", "Horsens", "Vejle", "Roskilde", "Herning", "Silkeborg", "Næstved", "Fredericia", "Viborg", "Køge", "Holstebro", "Slagelse", "Helsingør"],
    "Finland": ["Helsinki", "Espoo", "Tampere", "Vantaa", "Oulu", "Turku", "Jyväskylä", "Kuopio", "Lahti", "Kouvola", "Pori", "Joensuu", "Lappeenranta", "Hämeenlinna", "Vaasa", "Rovaniemi", "Seinäjoki", "Mikkeli", "Kotka", "Salo"],
    "Switzerland": ["Zürich", "Geneva", "Basel", "Lausanne", "Bern", "Winterthur", "Lucerne", "St. Gallen", "Lugano", "Biel/Bienne", "Thun", "Köniz", "La Chaux-de-Fonds", "Schaffhausen", "Fribourg", "Chur", "Vernier", "Neuchâtel", "Uster", "Sion"],
    "Belgium": ["Brussels", "Antwerp", "Ghent", "Charleroi", "Liège", "Bruges", "Namur", "Leuven", "Mons", "Aalst", "Mechelen", "La Louvière", "Kortrijk", "Hasselt", "Sint-Niklaas", "Ostend", "Tournai", "Genk", "Seraing", "Roeselare"],
    "Austria": ["Vienna", "Graz", "Linz", "Salzburg", "Innsbruck", "Klagenfurt", "Villach", "Wels", "Sankt Pölten", "Dornbirn", "Steyr", "Wiener Neustadt", "Feldkirch", "Bregenz", "Leonding", "Klosterneuburg", "Baden", "Wolfsberg", "Leoben", "Krems"],
    "Portugal": ["Lisbon", "Porto", "Vila Nova de Gaia", "Amadora", "Braga", "Funchal", "Setúbal", "Coimbra", "Almada", "Agualva-Cacém", "Queluz", "Aveiro", "Évora", "Faro", "Guimarães", "Barreiro", "Maia", "Matosinhos", "Vila Franca de Xira", "Loures"],
    "Poland": ["Warsaw", "Kraków", "Łódź", "Wrocław", "Poznań", "Gdańsk", "Szczecin", "Bydgoszcz", "Lublin", "Białystok", "Katowice", "Gdynia", "Częstochowa", "Radom", "Sosnowiec", "Toruń", "Kielce", "Rzeszów", "Gliwice", "Zabrze"],
    "Nigeria": ["Lagos", "Kano", "Ibadan", "Abuja", "Port Harcourt", "Benin City", "Maiduguri", "Zaria", "Aba", "Jos", "Ilorin", "Oyo", "Enugu", "Abeokuta", "Onitsha", "Warri", "Sokoto", "Ogbomosho", "Kaduna", "Owerri"],
    "Ghana": ["Accra", "Kumasi", "Tamale", "Sekondi-Takoradi", "Cape Coast", "Obuasi", "Tema", "Sunyani", "Koforidua", "Ho", "Wa", "Bolgatanga", "Techiman", "Teshie", "Madina", "Ashaiman", "Nungua", "Kasoa", "Berekum", "Nkawkaw"],
    "Kenya": ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Thika", "Malindi", "Kitale", "Garissa", "Kakamega", "Kisii", "Nyeri", "Machakos", "Meru", "Kericho", "Ruiru", "Kikuyu", "Athi River", "Kilifi", "Lamu"],
    "South Africa": ["Johannesburg", "Cape Town", "Durban", "Pretoria", "Port Elizabeth", "Bloemfontein", "Nelspruit", "Kimberley", "Polokwane", "East London", "Rustenburg", "George", "Pietermaritzburg", "Vanderbijlpark", "Boksburg", "Soweto", "Benoni", "Tembisa", "Sandton", "Randburg"],
    "Egypt": ["Cairo", "Alexandria", "Giza", "Shubra El-Kheima", "Port Said", "Suez", "Luxor", "Mansoura", "El-Mahalla El-Kubra", "Tanta", "Asyut", "Ismailia", "Fayyum", "Zagazig", "Aswan", "Damietta", "Damanhur", "Minya", "Beni Suef", "Hurghada"],
    "India": ["Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad", "Surat", "Jaipur", "Lucknow", "Kanpur", "Nagpur", "Patna", "Indore", "Bhopal", "Thane", "Vadodara", "Coimbatore", "Visakhapatnam"],
    "Pakistan": ["Karachi", "Lahore", "Faisalabad", "Rawalpindi", "Gujranwala", "Peshawar", "Multan", "Hyderabad", "Islamabad", "Quetta", "Bahawalpur", "Sargodha", "Sialkot", "Sukkur", "Larkana", "Rahim Yar Khan", "Sheikhupura", "Jhang", "Gujrat", "Chiniot"],
    "Bangladesh": ["Dhaka", "Chittagong", "Sylhet", "Rajshahi", "Khulna", "Barisal", "Comilla", "Mymensingh", "Rangpur", "Narayanganj", "Tongi", "Gazipur", "Jessore", "Bogra", "Dinajpur", "Nawabganj", "Pabna", "Brahmanbaria", "Tangail", "Faridpur"],
    "Singapore": ["Singapore"],
    "Malaysia": ["Kuala Lumpur", "George Town", "Johor Bahru", "Ipoh", "Petaling Jaya", "Shah Alam", "Subang Jaya", "Klang", "Kota Kinabalu", "Kuching", "Seremban", "Kota Bharu", "Malacca City", "Alor Setar", "Miri", "Kuantan", "Sandakan", "Batu Pahat", "Sibu", "Taiping"],
    "Indonesia": ["Jakarta", "Surabaya", "Bandung", "Medan", "Bekasi", "Tangerang", "Depok", "Semarang", "Palembang", "Makassar", "South Tangerang", "Batam", "Bogor", "Pekanbaru", "Bandar Lampung", "Malang", "Padang", "Denpasar", "Samarinda", "Tasikmalaya"],
    "Philippines": ["Manila", "Quezon City", "Caloocan", "Davao City", "Cebu City", "Zamboanga City", "Antipolo", "Taguig", "Pasig", "Cagayan de Oro", "Parañaque", "Valenzuela", "Las Piñas", "Makati", "Bacoor", "General Santos", "Muntinlupa", "San Jose del Monte", "Cabanatuan", "Bacolod"],
    "Thailand": ["Bangkok", "Chiang Mai", "Nonthaburi", "Pak Kret", "Hat Yai", "Khon Kaen", "Udon Thani", "Nakhon Ratchasima", "Surat Thani", "Ubon Ratchathani", "Nakhon Si Thammarat", "Chiang Rai", "Rayong", "Chonburi", "Lampang", "Phuket", "Nakhon Pathom", "Phitsanulok", "Mueang Nakhon Sawan", "Ayutthaya"],
    "Vietnam": ["Ho Chi Minh City", "Hanoi", "Da Nang", "Haiphong", "Can Tho", "Bien Hoa", "Nha Trang", "Hue", "Vung Tau", "Buon Ma Thuot", "Quy Nhon", "Da Lat", "Long Xuyen", "Rach Gia", "My Tho", "Thai Nguyen", "Hai Duong", "Nam Dinh", "Vinh", "Bac Ninh"],
    "Hong Kong": ["Hong Kong Island", "Kowloon", "Tsuen Wan", "Sha Tin", "Tuen Mun", "Yuen Long", "Tung Chung", "Tai Po", "Sai Kung", "Fanling", "Sheung Shui", "Tin Shui Wai"],
    "Japan": ["Tokyo", "Osaka", "Nagoya", "Sapporo", "Fukuoka", "Kobe", "Kyoto", "Kawasaki", "Saitama", "Hiroshima", "Sendai", "Kitakyushu", "Chiba", "Sakai", "Niigata", "Hamamatsu", "Kumamoto", "Sagamihara", "Okayama", "Shizuoka"],
    "South Korea": ["Seoul", "Busan", "Incheon", "Daegu", "Daejeon", "Gwangju", "Suwon", "Ulsan", "Changwon", "Seongnam", "Goyang", "Yongin", "Bucheon", "Cheongju", "Ansan", "Jeonju", "Anyang", "Cheonan", "Namyangju", "Hwaseong"],
    "China": ["Shanghai", "Beijing", "Chongqing", "Guangzhou", "Shenzhen", "Wuhan", "Tianjin", "Chengdu", "Nanjing", "Xi'an", "Hangzhou", "Shenyang", "Harbin", "Jinan", "Qingdao", "Zhengzhou", "Changsha", "Kunming", "Dalian", "Suzhou"],
    "Taiwan": ["Taipei", "New Taipei", "Kaohsiung", "Taichung", "Tainan", "Hsinchu", "Keelung", "Taoyuan", "Chiayi", "Changhua", "Pingtung", "Yilan", "Taitung", "Hualien", "Miaoli", "Nantou", "Yunlin", "Penghu"],
    "UAE": ["Dubai", "Abu Dhabi", "Sharjah", "Al Ain", "Ajman", "Ras Al Khaimah", "Fujairah", "Umm Al Quwain", "Khor Fakkan", "Kalba"],
    "Saudi Arabia": ["Riyadh", "Jeddah", "Mecca", "Medina", "Dammam", "Khobar", "Tabuk", "Buraidah", "Khamis Mushait", "Taif", "Abha", "Najran", "Jubail", "Yanbu", "Hofuf", "Hail", "Sakaka", "Arar", "Jizan", "Dhahran"],
    "Qatar": ["Doha", "Al Rayyan", "Al Wakrah", "Al Khor", "Al Daayen", "Madinat ash Shamal", "Umm Salal", "Lusail"],
    "Brazil": ["São Paulo", "Rio de Janeiro", "Brasília", "Salvador", "Fortaleza", "Belo Horizonte", "Manaus", "Curitiba", "Recife", "Porto Alegre", "Belém", "Goiânia", "Guarulhos", "Campinas", "São Luís", "São Gonçalo", "Maceió", "Duque de Caxias", "Natal", "Teresina"],
    "Mexico": ["Mexico City", "Guadalajara", "Monterrey", "Puebla", "Tijuana", "Juárez", "León", "Zapopan", "Nezahualcóyotl", "Chihuahua", "Naucalpan", "Mérida", "San Luis Potosí", "Aguascalientes", "Guadalupe", "Acapulco", "Tlalnepantla", "Cancún", "Querétaro", "Culiacán"],
    "Argentina": ["Buenos Aires", "Córdoba", "Rosario", "Mendoza", "Tucumán", "La Plata", "Mar del Plata", "Salta", "Santa Fe", "San Juan", "Resistencia", "Santiago del Estero", "Corrientes", "Posadas", "Neuquén", "Bahía Blanca", "Paraná", "Formosa", "San Luis", "Río Cuarto"],
    "Colombia": ["Bogotá", "Medellín", "Cali", "Barranquilla", "Cartagena", "Cúcuta", "Soledad", "Bucaramanga", "Ibagué", "Soacha", "Santa Marta", "Manizales", "Bello", "Pereira", "Villavicencio", "Montería", "Valledupar", "Pasto", "Armenia", "Neiva"],
    "New Zealand": ["Auckland", "Wellington", "Christchurch", "Hamilton", "Tauranga", "Napier-Hastings", "Dunedin", "Palmerston North", "Nelson", "Rotorua", "New Plymouth", "Whangarei", "Invercargill", "Whanganui", "Gisborne", "Blenheim", "Porirua", "Upper Hutt", "Lower Hutt", "Timaru"],
    // Additional Europe
    "Greece": ["Athens", "Thessaloniki", "Patras", "Piraeus", "Larissa", "Heraklion", "Peristeri", "Kallithea", "Acharnes", "Kalamaria", "Nikaia", "Glyfada", "Volos", "Ilioupoli", "Keratsini", "Evosmos", "Chalandri", "Nea Ionia", "Ioannina", "Kavala"],
    "Czech Republic": ["Prague", "Brno", "Ostrava", "Plzeň", "Liberec", "Olomouc", "Ústí nad Labem", "České Budějovice", "Hradec Králové", "Pardubice", "Zlín", "Havířov", "Kladno", "Most", "Opava", "Frýdek-Místek", "Karviná", "Jihlava", "Teplice", "Děčín"],
    "Hungary": ["Budapest", "Debrecen", "Miskolc", "Szeged", "Pécs", "Győr", "Nyíregyháza", "Kecskemét", "Székesfehérvár", "Szombathely", "Szolnok", "Tatabánya", "Kaposvár", "Érd", "Veszprém", "Zalaegerszeg", "Sopron", "Eger", "Nagykanizsa", "Dunakeszi"],
    "Romania": ["Bucharest", "Cluj-Napoca", "Timișoara", "Iași", "Craiova", "Constanța", "Galați", "Brașov", "Ploiești", "Brăila", "Oradea", "Bacău", "Arad", "Pitești", "Sibiu", "Târgu Mureș", "Baia Mare", "Buzău", "Satu Mare", "Râmnicu Vâlcea"],
    "Ukraine": ["Kyiv", "Kharkiv", "Odessa", "Dnipro", "Zaporizhzhia", "Lviv", "Kryvyi Rih", "Mykolaiv", "Mariupol", "Vinnytsia", "Makiivka", "Kherson", "Poltava", "Chernihiv", "Cherkasy", "Sumy", "Zhytomyr", "Rivne", "Ivano-Frankivsk", "Ternopil"],
    "Slovakia": ["Bratislava", "Košice", "Prešov", "Žilina", "Banská Bystrica", "Nitra", "Trnava", "Martin", "Trenčín", "Poprad", "Prievidza", "Zvolen", "Považská Bystrica", "Michalovce", "Nové Zámky", "Spišská Nová Ves", "Komárno", "Levice", "Dunajská Streda", "Humenné"],
    "Croatia": ["Zagreb", "Split", "Rijeka", "Osijek", "Zadar", "Slavonski Brod", "Pula", "Karlovac", "Sisak", "Varaždin", "Šibenik", "Dubrovnik", "Bjelovar", "Vinkovci", "Požega", "Koprivnica", "Čakovec", "Đakovo", "Vukovar", "Petrinja"],
    "Serbia": ["Belgrade", "Novi Sad", "Niš", "Kragujevac", "Subotica", "Zrenjanin", "Pančevo", "Čačak", "Novi Pazar", "Kruševac", "Smederevo", "Leskovac", "Valjevo", "Vranje", "Šabac", "Požarevac", "Zaječar", "Sombor", "Pirot", "Jagodina"],
    "Bulgaria": ["Sofia", "Plovdiv", "Varna", "Burgas", "Ruse", "Stara Zagora", "Pleven", "Sliven", "Dobrich", "Shumen", "Pernik", "Haskovo", "Yambol", "Pazardzhik", "Blagoevgrad", "Veliko Tarnovo", "Vratsa", "Gabrovo", "Vidin", "Montana"],
    "Lithuania": ["Vilnius", "Kaunas", "Klaipėda", "Šiauliai", "Panevėžys", "Alytus", "Marijampolė", "Mažeikiai", "Jonava", "Utena", "Kėdainiai", "Telšiai", "Visaginas", "Tauragė", "Ukmergė", "Plungė", "Kretinga", "Palanga", "Radviliškis", "Gargždai"],
    "Latvia": ["Riga", "Daugavpils", "Liepāja", "Jelgava", "Jūrmala", "Ventspils", "Rēzekne", "Valmiera", "Jēkabpils", "Ogre", "Tukums", "Salaspils", "Cēsis", "Kuldīga", "Bauska", "Sigulda", "Dobele", "Krāslava", "Saldus", "Talsi"],
    "Estonia": ["Tallinn", "Tartu", "Narva", "Pärnu", "Kohtla-Järve", "Viljandi", "Rakvere", "Maardu", "Sillamäe", "Võru", "Kuressaare", "Valga", "Haapsalu", "Jõhvi", "Keila", "Paide", "Põlva", "Türi", "Elva", "Rapla"],
    "Slovenia": ["Ljubljana", "Maribor", "Celje", "Kranj", "Velenje", "Koper", "Novo Mesto", "Ptuj", "Trbovlje", "Kamnik", "Jesenice", "Nova Gorica", "Domžale", "Škofja Loka", "Murska Sobota", "Slovenj Gradec", "Ajdovščina", "Kočevje", "Sežana", "Postojna"],
    "Luxembourg": ["Luxembourg City", "Esch-sur-Alzette", "Differdange", "Dudelange", "Ettelbruck", "Diekirch", "Wiltz", "Echternach", "Rumelange", "Grevenmacher"],
    "Iceland": ["Reykjavík", "Kópavogur", "Hafnarfjörður", "Akureyri", "Reykjanesbær", "Garðabær", "Mosfellsbær", "Árborg", "Akranes", "Fjarðabyggð"],
    "Malta": ["Valletta", "Birkirkara", "Mosta", "Qormi", "Żabbar", "San Ġwann", "Naxxar", "Żejtun", "Marsaskala", "Paola", "Sliema", "St. Julian's", "Rabat", "Mdina", "Mellieħa"],
    "Cyprus": ["Nicosia", "Limassol", "Larnaca", "Paphos", "Famagusta", "Kyrenia", "Strovolos", "Aglantzia", "Paralimni", "Protaras"],
    // Additional Americas
    "Chile": ["Santiago", "Puente Alto", "Antofagasta", "Viña del Mar", "Valparaíso", "San Bernardo", "Temuco", "Iquique", "Concepción", "Rancagua", "Talca", "Arica", "Chillán", "Calama", "Puerto Montt", "Coquimbo", "La Serena", "Osorno", "Quilpué", "Valdivia"],
    "Peru": ["Lima", "Arequipa", "Trujillo", "Chiclayo", "Piura", "Iquitos", "Cusco", "Chimbote", "Huancayo", "Tacna", "Juliaca", "Ica", "Sullana", "Ayacucho", "Pucallpa", "Huánuco", "Tarapoto", "Cajamarca", "Puno", "Tumbes"],
    "Venezuela": ["Caracas", "Maracaibo", "Valencia", "Barquisimeto", "Maracay", "Ciudad Guayana", "Barcelona", "Maturín", "Cumaná", "Mérida", "Petare", "Turmero", "Barinas", "Ciudad Bolívar", "Cabimas", "Coro", "Los Teques", "Punto Fijo", "Acarigua", "Guatire"],
    "Ecuador": ["Quito", "Guayaquil", "Cuenca", "Santo Domingo", "Machala", "Durán", "Manta", "Portoviejo", "Loja", "Ambato", "Esmeraldas", "Quevedo", "Riobamba", "Ibarra", "Milagro", "Latacunga", "Babahoyo", "Sangolquí", "Tulcán", "Azogues"],
    "Bolivia": ["Santa Cruz de la Sierra", "El Alto", "La Paz", "Cochabamba", "Oruro", "Sucre", "Potosí", "Tarija", "Sacaba", "Montero", "Trinidad", "Riberalta", "Warnes", "Yacuiba", "Cobija", "Guayaramerín"],
    "Paraguay": ["Asunción", "Ciudad del Este", "San Lorenzo", "Luque", "Capiatá", "Lambaré", "Fernando de la Mora", "Limpio", "Ñemby", "Mariano Roque Alonso", "Encarnación", "Pedro Juan Caballero", "Caaguazú", "Coronel Oviedo", "Concepción"],
    "Uruguay": ["Montevideo", "Salto", "Ciudad de la Costa", "Paysandú", "Las Piedras", "Rivera", "Maldonado", "Tacuarembó", "Melo", "Mercedes", "Artigas", "Minas", "San José de Mayo", "Durazno", "Florida", "Treinta y Tres"],
    "Guatemala": ["Guatemala City", "Mixco", "Villa Nueva", "Quetzaltenango", "San Juan Sacatepéquez", "Villa Canales", "Escuintla", "Cobán", "Jalapa", "Santa Lucía Cotzumalguapa", "Huehuetenango", "San Pedro Ayampuc", "Chiquimula", "Mazatenango", "Zacapa"],
    "Costa Rica": ["San José", "Alajuela", "Desamparados", "Pérez Zeledón", "San Carlos", "Liberia", "Puntarenas", "Heredia", "Paraíso", "Cartago", "Grecia", "Nicoya", "La Unión", "Limón", "Esparza"],
    "Panama": ["Panama City", "San Miguelito", "Tocumen", "David", "Arraijan", "La Chorrera", "Colón", "Santiago", "Chitré", "Las Tablas", "Aguadulce", "Penonomé", "La Palma", "Bocas del Toro"],
    "Dominican Republic": ["Santo Domingo", "Santiago de los Caballeros", "San Pedro de Macorís", "La Romana", "San Francisco de Macorís", "Puerto Plata", "La Vega", "San Cristóbal", "Moca", "Higüey", "Barahona", "San Juan de la Maguana", "Azua", "Bani", "Bonao"],
    "Jamaica": ["Kingston", "Portmore", "Spanish Town", "Montego Bay", "May Pen", "Mandeville", "Old Harbour", "Linstead", "Half Way Tree", "Savanna-la-Mar", "Port Antonio", "Ocho Rios", "St. Ann's Bay"],
    "Trinidad and Tobago": ["Port of Spain", "San Fernando", "Chaguanas", "Arima", "Point Fortin", "Scarborough", "Princes Town", "Tunapuna", "Sangre Grande", "Couva"],
    // Additional Africa
    "Ethiopia": ["Addis Ababa", "Dire Dawa", "Mek'ele", "Adama", "Gondar", "Hawassa", "Bahir Dar", "Dessie", "Jimma", "Jijiga", "Shashamane", "Bishoftu", "Arba Minch", "Harar", "Dilla", "Nekemte", "Debre Birhan", "Asella", "Debre Markos", "Kombolcha"],
    "Tanzania": ["Dar es Salaam", "Mwanza", "Arusha", "Dodoma", "Zanzibar City", "Mbeya", "Morogoro", "Tanga", "Kahama", "Tabora", "Kigoma", "Sumbawanga", "Kasulu", "Shinyanga", "Songea", "Musoma", "Bukoba", "Iringa", "Moshi", "Singida"],
    "Uganda": ["Kampala", "Gulu", "Lira", "Mbarara", "Jinja", "Bwizibwera", "Mbale", "Mukono", "Kasese", "Masaka", "Entebbe", "Njeru", "Tororo", "Kabale", "Soroti", "Hoima", "Arua", "Moroto", "Fort Portal", "Iganga"],
    "Cameroon": ["Douala", "Yaoundé", "Bamenda", "Bafoussam", "Garoua", "Maroua", "Ngaoundéré", "Bertoua", "Kumba", "Nkongsamba", "Edéa", "Loum", "Kousséri", "Foumban", "Dschang", "Limbe", "Ebolowa", "Kribi"],
    "Ivory Coast": ["Abidjan", "Bouaké", "Daloa", "Yamoussoukro", "Korhogo", "Man", "Divo", "Gagnoa", "San Pédro", "Abengourou", "Bondoukou", "Agboville", "Oumé", "Soubré", "Duekoué", "Touba", "Odienné", "Sinfra"],
    "Senegal": ["Dakar", "Pikine", "Touba", "Thiès", "Rufisque", "Saint-Louis", "Kaolack", "Mbour", "Ziguinchor", "Diourbel", "Louga", "Tambacounda", "Kolda", "Matam", "Fatick", "Kaffrine", "Sédhiou", "Kédougou"],
    "Rwanda": ["Kigali", "Butare", "Gitarama", "Musanze", "Gisenyi", "Byumba", "Cyangugu", "Kibuye", "Rwamagana", "Nyamata", "Kayonza", "Kibungo", "Ruhengeri", "Gikongoro"],
    "Morocco": ["Casablanca", "Rabat", "Fez", "Marrakech", "Tangier", "Agadir", "Meknès", "Oujda", "Kenitra", "Tetouan", "Safi", "El Jadida", "Béni Mellal", "Nador", "Khemisset", "Témara", "Settat", "Berrechid", "Khénifra", "Larache"],
    "Algeria": ["Algiers", "Oran", "Constantine", "Annaba", "Blida", "Batna", "Djelfa", "Sétif", "Sidi Bel Abbès", "Biskra", "Tébessa", "El Oued", "Skikda", "Tiaret", "Béjaïa", "Tlemcen", "Bouira", "Médéa", "Tizi Ouzou", "Mostaganem"],
    "Tunisia": ["Tunis", "Sfax", "Sousse", "Kairouan", "Bizerte", "Gabès", "Ariana", "Gafsa", "Monastir", "Ben Arous", "La Marsa", "Kasserine", "Médenine", "Nabeul", "Tataouine", "Beja", "Jendouba", "Siliana", "Tozeur", "Mahdia"],
    "Libya": ["Tripoli", "Benghazi", "Misrata", "Tarhuna", "Al Khums", "Zawiya", "Zintan", "Sabha", "Sirte", "Ajdabiya", "Derna", "Zliten", "Al Bayda", "Tobruk", "Murzuq"],
    "Sudan": ["Khartoum", "Omdurman", "Khartoum North", "Port Sudan", "Kassala", "Gedaref", "El Obeid", "Wad Madani", "El Fasher", "Atbara", "Nyala", "Kosti", "Rabak", "Singa", "Dongola"],
    "Zimbabwe": ["Harare", "Bulawayo", "Chitungwiza", "Mutare", "Gweru", "Kwekwe", "Kadoma", "Masvingo", "Chinhoyi", "Norton", "Marondera", "Ruwa", "Chegutu", "Zvishavane", "Bindura", "Beitbridge", "Redcliff", "Victoria Falls", "Hwange", "Rusape"],
    "Zambia": ["Lusaka", "Kitwe", "Ndola", "Kabwe", "Chingola", "Mufulira", "Livingstone", "Luanshya", "Kasama", "Chipata", "Mazabuka", "Mongu", "Solwezi", "Kafue", "Chililabombwe", "Nakonde", "Mpika"],
    "Mozambique": ["Maputo", "Matola", "Beira", "Nampula", "Chimoio", "Nacala", "Quelimane", "Tete", "Xai-Xai", "Pemba", "Lichinga", "Dondo", "Inhambane", "Cuamba", "Mocuba"],
    "Angola": ["Luanda", "Huambo", "Lobito", "Benguela", "Kuito", "Lubango", "Malanje", "Namibe", "Saurimo", "Cabinda", "Soyo", "Menongue", "Uíge", "N'dalatando", "Sumbe"],
    // Additional Middle East
    "Israel": ["Jerusalem", "Tel Aviv", "Haifa", "Rishon LeZion", "Petah Tikva", "Ashdod", "Netanya", "Be'er Sheva", "Bnei Brak", "Holon", "Bat Yam", "Rehovot", "Ashkelon", "Beit Shemesh", "Nazareth", "Lod", "Ramat Gan", "Hadera", "Modi'in", "Eilat"],
    "Turkey": ["Istanbul", "Ankara", "İzmir", "Bursa", "Adana", "Gaziantep", "Konya", "Antalya", "Kayseri", "Mersin", "Eskişehir", "Diyarbakır", "Samsun", "Denizli", "Şanlıurfa", "Adapazarı", "Malatya", "Kahramanmaraş", "Erzurum", "Van"],
    "Jordan": ["Amman", "Zarqa", "Irbid", "Russeifa", "Wadi as-Seer", "Aqaba", "Madaba", "As-Salt", "At-Tafilah", "Ma'an", "Jerash", "Ajloun", "Karak", "Mafraq", "Ramtha"],
    "Lebanon": ["Beirut", "Tripoli", "Sidon", "Tyre", "Nabatieh", "Zahle", "Jounieh", "Baalbek", "Byblos", "Aley", "Bint Jbeil", "Hermel", "Jdeideh", "Antelias"],
    "Kuwait": ["Kuwait City", "Al Ahmadi", "Hawalli", "As Salimiyah", "Sabah as-Salim", "Al Farwaniyah", "Fahaheel", "Ar Riqqah", "Al Manqaf", "Salwa", "Ar Rabiyah", "Jalib ash-Shuyukh"],
    "Bahrain": ["Manama", "Riffa", "Muharraq", "Hamad Town", "A'ali", "Isa Town", "Sitra", "Budaiya", "Jidhafs", "Madinat Hamad"],
    "Oman": ["Muscat", "Seeb", "Salalah", "Bawshar", "Sohar", "As Suwayq", "Ibri", "Saham", "Barka", "Rustaq", "Al Buraymi", "Nizwa", "Sur", "Bahla", "Shinas", "Khasab", "Ibra", "Al Khaboura"],
    "Iraq": ["Baghdad", "Basra", "Mosul", "Erbil", "Sulaymaniyah", "Najaf", "Karbala", "Kirkuk", "Nasiriyah", "Al-Amarah", "Diwaniyah", "Samarra", "Ramadi", "Fallujah", "Dohuk", "Tikrit", "Baqubah", "Al Hillah", "Al Kut", "Diyala"],
    // Additional Asia-Pacific
    "Sri Lanka": ["Colombo", "Moratuwa", "Jaffna", "Kandy", "Negombo", "Kotte", "Gampaha", "Dehiwala", "Batticaloa", "Ratnapura", "Matara", "Anuradhapura", "Galle", "Kurunegala", "Trincomalee", "Badulla", "Kalutara", "Puttalam", "Polonnaruwa", "Ampara"],
    "Nepal": ["Kathmandu", "Pokhara", "Lalitpur", "Bharatpur", "Biratnagar", "Birgunj", "Dharan", "Butwal", "Hetauda", "Bhairahawa", "Janakpur", "Itahari", "Dhangadhi", "Nepalgunj", "Tulsipur"],
    "Myanmar": ["Naypyidaw", "Yangon", "Mandalay", "Mawlamyine", "Bago", "Pathein", "Monywa", "Sittwe", "Meiktila", "Myingyan", "Lashio", "Pyay", "Hpa-an", "Dawei", "Myeik", "Pakokku", "Magway", "Sagaing", "Taunggyi", "Shwebo"],
    "Cambodia": ["Phnom Penh", "Siem Reap", "Preah Sihanouk", "Battambang", "Kampong Cham", "Kampong Chhnang", "Kampong Speu", "Kampong Thom", "Takéo", "Kandal", "Kratie", "Pursat", "Svay Rieng", "Prey Veng", "Kep"],
    "Kazakhstan": ["Almaty", "Nur-Sultan", "Shymkent", "Karaganda", "Aktobe", "Taraz", "Pavlodar", "Ust-Kamenogorsk", "Semey", "Uralsk", "Kostanay", "Petropavl", "Atyrau", "Temirtau", "Turkestan", "Kokshetau", "Taldykorgan", "Ekibastuz", "Rudny", "Zhanaozen"],
    "Uzbekistan": ["Tashkent", "Namangan", "Samarkand", "Andijan", "Nukus", "Fergana", "Qarshi", "Bukhara", "Margilan", "Navoiy", "Gulistan", "Chirchiq", "Kokand", "Ürganch", "Angren", "Jizzax", "Termez", "Beruniy", "Oltiariq", "Muborak"],
  }), []);
  const CUSTOMER_SEGMENT_OPTIONS = useMemo(() => ["SMEs", "Freelancers", "Households", "Other"], []);
  const DELIVERABLE_UNIT_OPTIONS = useMemo(() => ["unit", "job", "session", "project", "month", "hour", "subscription", "Other"], []);
  const PRICING_MODEL_OPTIONS = useMemo(() => [{ value: "hourly", label: "Hourly" }, { value: "fixed_job", label: "Fixed job" }, { value: "retainer", label: "Retainer" }], []);
  const GTM_CHANNEL_OPTIONS = useMemo(
    () => ["Referrals", "Ads", "Partnerships", "Marketplace", "Outbound", "SEO", "Social", "Events", "Communities", "Affiliates"],
    []
  );

  const PROFILE_BUSINESS_TYPES = useMemo(
    () => ["sole_trader", "partnership", "limited_company", "llp", "non_profit", "startup"],
    []
  );
  const PROFILE_INDUSTRIES = useMemo(
    () => [
      "consulting",
      "technology",
      "finance",
      "healthcare",
      "education",
      "retail",
      "ecommerce",
      "logistics",
      "manufacturing",
      "real_estate",
      "marketing",
      "other"
    ],
    []
  );
  const PROFILE_COMPANY_SIZES = useMemo(() => ["solo", "2-5", "6-10", "11-50", "51-200", "200+"], []);
  const PROFILE_MONTHLY_REVENUE = useMemo(
    () => ["0-1k", "1k-5k", "5k-10k", "10k-50k", "50k-100k", "100k+"],
    []
  );
  const PROFILE_OPERATING_STAGE = useMemo(
    () => ["idea", "pre_revenue", "early_revenue", "growing", "established"],
    []
  );
  const PROFILE_DELIVERY_MODEL = useMemo(() => ["manual", "hybrid", "automated"], []);
  const PROFILE_TARGET_CUSTOMER = useMemo(() => ["individual", "startup", "SME", "corporate"], []);
  const PROFILE_REVENUE_MODEL = useMemo(() => ["one_off", "subscription", "retainer", "project_based", "mixed"], []);

  const SERVICE_CATEGORY_OPTIONS = useMemo(
    () => ["consulting", "training", "agency", "freelance", "technical_service", "other"],
    []
  );
  const TARGET_CUSTOMER_OPTIONS = useMemo(
    () => ["individual", "startup", "SME", "corporate"],
    []
  );
  const TARGET_MARKET_SCOPE_OPTIONS = useMemo(
    () => ["local", "regional", "national", "global"],
    []
  );
  const DEMAND_EVIDENCE_OPTIONS = useMemo(
    () => [
      "assumption_only",
      "market_research",
      "enquiries",
      "LOIs",
      "paid_pilot",
      "paying_customers",
      "repeat_paying_customers"
    ],
    []
  );
  const DIFFERENTIATION_OPTIONS = useMemo(() => ["low", "medium", "high"], []);

  const [form, setForm] = useState(() => buildInitialBusinessForm());
  const [serviceForm, setServiceForm] = useState(() => ({
    service_name: "",
    service_category: "consulting",
    service_description: "",
    target_customer_type: ["SME"],
    target_market_scope: "local",
    price_per_sale: "",
    expected_sales_per_month: "",
    direct_labour_cost_per_sale: "",
    contractor_cost_per_sale: "",
    materials_cost_per_sale: "",
    travel_cost_per_sale: "",
    other_direct_cost_per_sale: "",
    monthly_software_cost: "",
    monthly_marketing_cost: "",
    monthly_admin_cost: "",
    monthly_rent_cost: "",
    monthly_other_fixed_cost: "",
    hours_required_per_sale: "",
    available_delivery_hours_per_month: "",
    demand_evidence_type: "assumption_only",
    customer_need_frequency: "Monthly",
    problem_to_solve: "",
    competitors_alternatives: "",
    differentiator: "",
    demand_validation_proof: [],
    differentiation_level: "medium",
    estimated_price: "",
    assumed_cost_per_unit: "",
    required_capacity: "",
  }));
  const [serviceCurrency, setServiceCurrency] = useState("GBP");
  const serviceCurrencySymbol = useMemo(() => getCurrencySymbol(serviceCurrency), [serviceCurrency]);
  const savedProfileSnap = useRef(null);
  const profileSnapPending = useRef(false);
  // Set as soon as the user edits any workspace-profile field. Guards against the
  // slow /validation/{id} prefill fetch (timeoutMs up to 90s) resolving *after* the
  // user has already started filling the form and unconditionally merging server
  // data back over it — which is what made fields like City silently "revert":
  // the user's click registered fine, but a few hundred ms later the in-flight
  // prefill response landed and overwrote it with the (blank) server value, with
  // no error or visible cause.
  const userEditedProfileRef = useRef(false);
  const [profile, setProfile] = useState(() => ({
    company_name: "",
    logo_data_url: "",
    legal_name: "",
    registration_number: "",
    business_type: "limited_company",
    primary_industry: "consulting",
    secondary_industries: [],
    about_company: "",
    tagline: "",
    year_established: "",
    company_size: "solo",
    services: [{ service_name: "", service_category: "consulting", service_description: "" }],
    vision: "",
    mission: "",
    core_values: "",
    country: "",
    city: "",
    state_or_region: "",
    postcode: "",
    address_line_1: "",
    address_line_2: "",
    email: "",
    phone_number: "",
    website: "",
    linkedin_url: "",
    twitter_url: "",
    instagram_url: "",
    facebook_url: "",
    monthly_revenue_range: "",
    employee_count: "",
    operating_stage: "idea",
    delivery_model: "manual",
    target_customer_type: "",
    primary_revenue_model: "",
    key_offering_focus: ""
  }));
  const workspaceServices = useMemo(
    () =>
      Array.isArray(profile.services)
        ? profile.services.filter((s) => String(s?.service_name || "").trim())
        : [],
    [profile.services]
  );

  const savedServiceIdeaOptions = useMemo(() => {
    const names = new Set();
    const history = Array.isArray(savedServiceIdeas) ? savedServiceIdeas : [];
    history.forEach((entry) => {
      const name = String(entry?.service_name || entry?.payload?.service_name || "").trim();
      if (name) names.add(name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [savedServiceIdeas]);

  const combinedServiceOptions = useMemo(() => {
    const names = new Set();
    workspaceServices.forEach((s) => {
      const name = String(s?.service_name || "").trim();
      if (name) names.add(name);
    });
    savedServiceIdeaOptions.forEach((name) => names.add(name));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [savedServiceIdeaOptions, workspaceServices]);
  const historyCounts = useMemo(() => {
    const seen = new Set();
    const deduped = validationHistory.filter((entry) => {
      const key = `${String(entry.title || "").toLowerCase().trim()}__${entry.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      all: deduped.length,
      pending: deduped.filter((e) => e.status === "pending").length,
      accepted: deduped.filter((e) => e.status === "accepted").length,
      rejected: deduped.filter((e) => e.status === "rejected").length,
    };
  }, [validationHistory]);
  const filteredValidationHistory = useMemo(() => {
    setHistoryPage(1);
    const q = historySearch.trim().toLowerCase();
    const seen = new Set();
    return validationHistory.filter((entry) => {
      if (historyFilter !== "all" && entry.status !== historyFilter) return false;
      if (historyTypeFilter === "business" && entry.type !== "business_validation") return false;
      if (historyTypeFilter === "service" && entry.type !== "service_validation") return false;
      if (q && !String(entry.title || "").toLowerCase().includes(q)) return false;
      const dedupeKey = `${String(entry.title || "").toLowerCase().trim()}__${entry.type}`;
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    });
  }, [historyFilter, historyTypeFilter, historySearch, validationHistory]);
  const historyTotalPages = Math.max(1, Math.ceil(filteredValidationHistory.length / HISTORY_PAGE_SIZE));
  const pagedHistory = filteredValidationHistory.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE);
  const activeWorkspaceId = editingWorkspaceId || storedWorkspaceId;

  const isProductPath = form.pathway === "product_service_idea";
  const marketResearch = isProductPath ? serviceMarketResearch : businessMarketResearch;
  const tabMarketResearch = mrResearchTab === "service" ? serviceMarketResearch : businessMarketResearch;
  const formBlocks = useMemo(() => {
    if (isCreateWorkspace) {
      return [
        {
          key: "workspace_profile",
          label: "Workspace profile",
          desc: "Identity, services, operations, and contact details."
        }
      ];
    }
    if (isProductPath) {
      return [
        { key: "service_basics", label: "Service basics", desc: "Idea, category, and market scope." },
        { key: "revenue_inputs", label: "Revenue inputs", desc: "Price and expected sales volume." },
        { key: "direct_costs", label: "Direct delivery costs", desc: "Labour, materials, travel, and other direct costs." },
        { key: "fixed_costs", label: "Fixed monthly costs", desc: "Software, marketing, admin, and rent." },
        { key: "capacity_inputs", label: "Capacity inputs", desc: "Hours required and delivery capacity." },
        { key: "demand_inputs", label: "Demand evidence", desc: "Proof of demand and lead/customer counts." },
        { key: "competition", label: "Competitive positioning", desc: "Price range and differentiation." }
      ];
    }
    return [
      {
        key: "business",
        label: "Business details",
        desc: "Name, industry, currency, and context."
      },
      { key: "offer_demand", label: "Offer & demand", desc: "Offer, pricing, volume assumptions, and sales cycle." },
      { key: "costs", label: "Costs", desc: "Fixed and variable costs behind the model." },
      { key: "capacity_cash", label: "Capacity & cash", desc: "Capacity assumptions and starting cash/runway inputs." },
      { key: "go_to_market", label: "Go to market", desc: "Target market and acquisition channels." }
    ];
  }, [isCreateWorkspace, isProductPath]);

  const [enabledForms, setEnabledForms] = useState(() =>
    isCreateWorkspace
      ? { workspace_profile: true }
      : isProductPath
        ? { workspace_profile: false } // Disabled redundant sections for product path
        : { business: true } // Removed redundant sections for business path
  );
  const selectedCount = useMemo(() => Object.values(enabledForms).filter(Boolean).length, [enabledForms]);
  const isBusinessStageFlow = mode === "fill" && !isCreateWorkspace && form.pathway === "business_idea";
  const isServiceStageFlow = mode === "fill" && !isCreateWorkspace && isProductPath;
  const isLastBusinessStage = true;
  const isLastServiceStage = true;
  const insightVisibility = useMemo(() => ({
    showSummary: true,
    showValidationResult: true,
    showMarketOpportunity: true,
    showTargetCustomer: true,
    showProblemValidation: true,
    showDemandSignals: true,
    showAlternativeSolutions: true,
    showCompetitorMatrix: true,
    showCompetitorPricing: true,
    showPricingStrategy: true,
    showRecommendedPriceRange: true,
    showViabilityScore: true,
    showPositioning: true,
    showGoToMarket: true,
    showRisks: true,
    showNextActions: true,
  }), []);

  const derivedWorkspaceName = useMemo(() => {
    if (isCreateWorkspace) {
      const pn = String(profile?.company_name || "").trim();
      return pn || "Workspace";
    }
    // For business idea / service paths, workspace name is set independently — do not derive from idea fields.
    return "";
  }, [isCreateWorkspace, profile?.company_name]);

  // Auto-derive B2B/B2C/B2G from the customer segment so we don't ask twice
  const derivedTargetMarket = useMemo(() => {
    const seg = String(form?.problem?.customer_segment_category || "").trim().toLowerCase();
    if (["freelancers", "households", "consumers"].includes(seg)) return "B2C";
    if (["smes", "startups", "enterprises", "smbs", "corporate"].includes(seg)) return "B2B";
    if (["government", "public sector"].includes(seg)) return "B2G";
    return null;
  }, [form?.problem?.customer_segment_category]);

  const recommendedCapacityPerPerson = useMemo(() => {
    const target = parseNumber(form?.demand?.expected_units_per_month, 0);
    const team = Math.max(1, parseIntSafe(form?.capacity?.team_size, 1));
    if (!target) return null;
    return Math.round(target / team);
  }, [form?.capacity?.team_size, form?.demand?.expected_units_per_month]);

  const capacityRecommendation = useMemo(() => {
    const target = parseNumber(form?.demand?.expected_units_per_month, 0);
    const team = Math.max(1, parseIntSafe(form?.capacity?.team_size, 1));
    const capacityPerPerson = parseNumber(form?.capacity?.capacity_units_per_person_per_month, 0);
    if (!target || !team) return null;
    if (!capacityPerPerson) return null;
    const requiredTeam = Math.max(1, Math.ceil(target / capacityPerPerson));
    if (requiredTeam > team) return "Hire more staff.";
    if (requiredTeam < team) return "Overstaffed / Increase Targets.";
    return "Team size matches the target at this capacity.";
  }, [
    form?.capacity?.capacity_units_per_person_per_month,
    form?.capacity?.team_size,
    form?.demand?.expected_units_per_month
  ]);

  const suggestedDeliveryHours = useMemo(() => {
    if (!isProductPath) return null;
    const expectedSales = parseNumber(serviceForm.expected_sales_per_month, 0);
    const hoursRequired = parseNumber(serviceForm.hours_required_per_sale, 0);
    if (!expectedSales || !hoursRequired) return null;
    const raw = expectedSales * hoursRequired;
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.round(raw * 100) / 100;
  }, [isProductPath, serviceForm.expected_sales_per_month, serviceForm.hours_required_per_sale]);

  const workforceStatus = useMemo(() => {
    if (!isProductPath) return null;
    if (!suggestedDeliveryHours) return null;
    const available = parseNumber(serviceForm.available_delivery_hours_per_month, 0);
    if (!available) return null;
    const diff = Math.round((available - suggestedDeliveryHours) * 100) / 100;
    if (diff === 0) return { kind: "ok", message: "Enough workforce for your expected demand.", diff };
    if (diff > 0) return { kind: "more", message: "More than enough workforce for your expected demand.", diff };
    return { kind: "need", message: "Need more workforce to meet your expected demand.", diff };
  }, [isProductPath, suggestedDeliveryHours, serviceForm.available_delivery_hours_per_month]);

  useEffect(() => {
    if (!isProductPath) return;
    if (!suggestedDeliveryHours) return;
    const current = String(serviceForm.available_delivery_hours_per_month || "").trim();
    if (current) return;
    updateService("available_delivery_hours_per_month", String(suggestedDeliveryHours));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProductPath, suggestedDeliveryHours]);

  useEffect(() => {
    const target = parseNumber(form?.demand?.expected_units_per_month, 0);
    const team = Math.max(1, parseIntSafe(form?.capacity?.team_size, 1));
    if (!target || !team) return;
    const current = String(form?.capacity?.capacity_units_per_person_per_month || "").trim();
    if (current) return;
    update("capacity.capacity_units_per_person_per_month", String(Math.round(target / team)));
  }, [form?.capacity?.capacity_units_per_person_per_month, form?.capacity?.team_size, form?.demand?.expected_units_per_month]);

  // Silently sync the derived target market whenever customer segment changes
  useEffect(() => {
    if (!derivedTargetMarket) return;
    if (form?.go_to_market?.target_market === derivedTargetMarket) return;
    update("go_to_market.target_market", derivedTargetMarket);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedTargetMarket]);

  useEffect(() => {
    if (workspaceNameTouched) return;
    setWorkspaceName(derivedWorkspaceName);
  }, [derivedWorkspaceName, workspaceNameTouched]);

  useEffect(() => {
    if (!requestedHistoryType) return;
    if (!activeWorkspaceId || historyRequestHandled || isPrefilling) return;
    setHistoryRequestHandled(true);
    setContentTab("builder");
    if (requestedHistoryType === "service_validation") setMode("fill");
    if (requestedHistoryId) {
      editHistoryEntry({ id: requestedHistoryId, type: requestedHistoryType, status: "pending" }, true, requestedEditMode);
    } else if (requestedHistoryType === "service_validation") {
      // history_type present but no specific history_id — find the active service entry
      (async () => {
        try {
          const ws = await apiRequest(`/validation/${activeWorkspaceId}`, "GET");
          const data = ws?.data || {};
          const sHistory = Array.isArray(data.service_validation_history) ? data.service_validation_history : [];
          const activeId = data.active_service_validation_id;
          const entry = sHistory.find((e) => e?.id === activeId) || sHistory[0] || null;
          if (entry) {
            editHistoryEntry({ id: entry.id, type: "service_validation", status: entry.decision_status || "pending", payload: entry.payload }, true);
          } else {
            // No history yet — just open the service form blank
            setForm((prev) => ({ ...prev, pathway: "product_service_idea" }));
          }
        } catch {
          setForm((prev) => ({ ...prev, pathway: "product_service_idea" }));
        }
      })();
    }
  }, [
    activeWorkspaceId,
    historyRequestHandled,
    isPrefilling,
    requestedHistoryId,
    requestedHistoryType,
    requestedEditMode,
  ]);

  // When Modify is clicked from ResultsPage (edit=1 URL param), auto-advance to
  // the form step once editHistoryEntry has loaded the journey and form data.
  useEffect(() => {
    if (requestedEditMode && v4Journey && mode === "v4" && v4Step === 0) {
      setV4Step(1);
    }
  }, [requestedEditMode, v4Journey, mode, v4Step]);

  // Reactively clear the v4 error banner as soon as the user fills the required field
  useEffect(() => {
    if (!v4Error) return;
    const s1 = v4Form["step1"] || {};
    const s2 = v4Form["step2"] || {};
    const s3 = v4Form["step3"] || {};
    const s5 = v4Form["step5"] || {};
    if (v4Step === 1 && String(s1.idea_name || "").trim() && String(s1.idea_type || "").trim()) { setV4Error(null); return; }
    if (v4Step === 2 && String(s2.problem_description || "").trim() && (v4Journey !== "basic" || String(s2.proposed_solution || "").trim())) { setV4Error(null); return; }
    if (v4Step === 3 && String(s3.primary_segment || "").trim()) { setV4Error(null); return; }
    if (v4Step === 5 && String(s5.solution_description || "").trim()) { setV4Error(null); return; }
  }, [v4Error, v4Form, v4Step, v4Journey]);

  useEffect(() => {
    if (v4Error && v4ErrorRef.current) {
      v4ErrorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [v4Error]);

  // Persist in-progress v4 draft so navigation away doesn't wipe the form
  useEffect(() => {
    if (v4Journey && v4Step > 0) {
      saveV4Draft(v4Form, v4Step, v4Journey);
    }
  }, [v4Form, v4Step, v4Journey]);

  useEffect(() => {
    if (!isCreateWorkspace) return;
    if (String(profile.email || "").trim()) return;
    if (!authEmail) return;
    updateProfile("email", authEmail);
  }, [authEmail, isCreateWorkspace, profile.email]);

  useEffect(() => {
    if (isCreateWorkspace || isPrefilling || hasAppliedDrafts) return;
    try {
      const draft = isProductPath ? draftServiceIdea : draftIdeaValidation;
      if (!draft || typeof draft !== "object") return;
      if (isProductPath) {
        const safeServiceDraft = {
          service_name: draft.service_name ?? "",
          service_category: draft.service_category ?? "consulting",
          service_description: draft.service_description ?? "",
          target_customer_type: Array.isArray(draft.target_customer_type) ? draft.target_customer_type : draft.target_customer_type ? String(draft.target_customer_type).split(",").map(s => s.trim()).filter(Boolean) : ["SME"],
          target_market_scope: draft.target_market_scope ?? "local",
          price_per_sale: draft.price_per_sale ?? "",
          expected_sales_per_month: draft.expected_sales_per_month ?? "",
          direct_labour_cost_per_sale: draft.direct_labour_cost_per_sale ?? "",
          contractor_cost_per_sale: draft.contractor_cost_per_sale ?? "",
          materials_cost_per_sale: draft.materials_cost_per_sale ?? "",
          travel_cost_per_sale: draft.travel_cost_per_sale ?? "",
          other_direct_cost_per_sale: draft.other_direct_cost_per_sale ?? "",
          monthly_software_cost: draft.monthly_software_cost ?? "",
          monthly_marketing_cost: draft.monthly_marketing_cost ?? "",
          monthly_admin_cost: draft.monthly_admin_cost ?? "",
          monthly_rent_cost: draft.monthly_rent_cost ?? "",
          monthly_other_fixed_cost: draft.monthly_other_fixed_cost ?? "",
          hours_required_per_sale: draft.hours_required_per_sale ?? "",
          available_delivery_hours_per_month: draft.available_delivery_hours_per_month ?? "",
          demand_evidence_type: draft.demand_evidence_type ?? "assumption_only",
          number_of_interested_leads: draft.number_of_interested_leads ?? "",
          number_of_paying_customers: draft.number_of_paying_customers ?? "",
          competitor_price_low: draft.competitor_price_low ?? "",
          competitor_price_high: draft.competitor_price_high ?? "",
          differentiation_level: draft.differentiation_level ?? "medium",
          country: draft.country ?? "",
          assumed_cost_per_unit: draft.assumed_cost_per_unit ?? "",
          required_capacity: draft.required_capacity ?? "",
        };
        setServiceForm((prev) => ({ ...prev, ...safeServiceDraft }));
      } else {
        const safeDraft = mergeStageDefaultsIntoBusinessForm({
          ...draft,
          context: { ...draft.context ?? {} },
          problem: { ...draft.problem ?? {} },
          offer: { ...draft.offer ?? {} },
          demand: { ...draft.demand ?? {} },
          costs: { ...draft.costs ?? {} },
          capacity: { ...draft.capacity ?? {} },
          cash: { ...draft.cash ?? {} },
          go_to_market: { ...draft.go_to_market ?? {} }
        });
        setForm((prev) => ({
          ...prev,
          ...safeDraft,
          pathway: safeDraft.pathway ?? prev.pathway,
          context: { ...prev.context, ...safeDraft.context },
          problem: { ...prev.problem, ...safeDraft.problem },
          offer: { ...prev.offer, ...safeDraft.offer },
          demand: { ...prev.demand, ...safeDraft.demand },
          costs: { ...prev.costs, ...safeDraft.costs },
          capacity: { ...prev.capacity, ...safeDraft.capacity },
          cash: { ...prev.cash, ...safeDraft.cash },
          go_to_market: { ...prev.go_to_market, ...safeDraft.go_to_market }
        }));
      }
      setHasAppliedDrafts(true);
    } catch (err) {
      console.error("Error applying draft:", err);
    }
  }, [draftIdeaValidation, draftServiceIdea, hasAppliedDrafts, isCreateWorkspace, isPrefilling]);

  useEffect(() => {
    if (isCreateWorkspace || isProductPath) return;
    const payload = {
      workspace_name: String(workspaceName || "").trim(),
      business_name: String(form?.context?.business_name || "").trim(),
      service_type: String(form?.offer?.service_type || "").trim(),
      business_type_category: String(form?.context?.business_type_category || "").trim(),
      business_type_other: String(form?.context?.business_type_other || "").trim(),
      primary_industry_category: String(form?.context?.primary_industry_category || "").trim(),
      primary_industry_other: String(form?.context?.primary_industry_other || "").trim(),
      location: String(form?.context?.location || "").trim(),
      currency: String(form?.context?.currency || "GBP").trim(),
      customer_segment_category: String(form?.problem?.customer_segment_category || "").trim(),
      customer_segment_other: String(form?.problem?.customer_segment_other || "").trim(),
      problem_type: String(form?.problem?.problem_type || "").trim(),
      frequency: String(form?.problem?.frequency || "").trim(),
      alternatives: String(form?.problem?.alternatives || "").trim(),
    };
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VALIDATION_DEFAULTS_KEY, JSON.stringify(payload));
    }
  }, [
    form?.context?.business_name,
    workspaceName,
    form?.offer?.service_type,
    form?.context?.business_type_category,
    form?.context?.business_type_other,
    form?.context?.primary_industry_category,
    form?.context?.primary_industry_other,
    form?.context?.location,
    form?.context?.currency,
    form?.problem?.customer_segment_category,
    form?.problem?.customer_segment_other,
    form?.problem?.problem_type,
    form?.problem?.frequency,
    form?.problem?.alternatives,
    isCreateWorkspace,
    isProductPath,
  ]);

  useEffect(() => {
    if (!isProductPath) return;
    if (!serviceForm.service_name || serviceSelection) return;
    const match = combinedServiceOptions.includes(serviceForm.service_name);
    setServiceSelection(match ? serviceForm.service_name : "__other__");
  }, [combinedServiceOptions, isProductPath, serviceForm.service_name, serviceSelection]);

  useEffect(() => {
    const next = form?.context?.currency || "GBP";
    setCurrency(next);
    if (isProductPath) setServiceCurrency(next);
  }, [form?.context?.currency, isProductPath, setCurrency]);

  useEffect(() => {
    if (isCreateWorkspace) return;
    if (isProductPath) {
      setDraftServiceIdea(serviceForm);
    } else {
      setDraftIdeaValidation(form);
    }
  }, [form, isCreateWorkspace, isProductPath, serviceForm, setDraftIdeaValidation, setDraftServiceIdea]);

  useEffect(() => {
    if (isCreateWorkspace || isPrefilling || !activeWorkspaceId) return;
    const handle = setTimeout(async () => {
      try {
        await apiRequest(
          `/validation/${activeWorkspaceId}`,
          "PATCH",
          {
            data: {
              draft_idea_validation: isProductPath ? null : form,
              draft_service_idea: isProductPath ? {
                ...serviceForm,
                // Persist context fields alongside serviceForm so they survive page reloads
                industry: (form?.context?.industry_category === "Other" ? (form?.context?.industry_other || "") : (form?.context?.industry_category || "")) || serviceForm.industry || "",
                sector: (form?.context?.sector_category === "Other" ? (form?.context?.sector_other || "") : (form?.context?.sector_category || "")) || serviceForm.sector || "",
                country: (form?.context?.country === "Other" ? (form?.context?.country_other || "") : (form?.context?.country || "")) || serviceForm.country || "",
              } : null
            }
          },
          { timeoutMs: 120000 }
        );
      } catch (e) {
        console.warn("Draft autosave failed:", e);
      }
    }, 800);
    return () => clearTimeout(handle);
  }, [activeWorkspaceId, form, isCreateWorkspace, isPrefilling, isProductPath, serviceForm]);

  useEffect(() => {
    if (isCreateWorkspace) {
      setEnabledForms({ workspace_profile: true });
      setMode("fill");
      return;
    }
    if (isProductPath) {
      setEnabledForms({ workspace_profile: false });
      return;
    }
    setEnabledForms({ business: true });
  }, [isCreateWorkspace, isProductPath]);

  // Capture the full merged profile snapshot after server data is applied
  useEffect(() => {
    if (profileSnapPending.current) {
      savedProfileSnap.current = JSON.stringify(profile);
      profileSnapPending.current = false;
    }
  }, [profile]);

  useEffect(() => {
    async function prefill() {
      let wsId = editingWorkspaceId || storedWorkspaceId;
      if (!wsId) {
        try {
          const meWs = await apiRequest("/validation/me", "GET", undefined, { timeoutMs: 15000 });
          if (meWs?.id) {
            wsId = meWs.id;
            setWorkspaceId(meWs.id);
            setWorkspaceNameStore(meWs.name || "");
          }
        } catch {}
        if (!wsId) return;
      }
      setIsPrefilling(true);
      setError(null);
      try {
        const defaults = loadValidationStageDefaults();
        const ws = await apiRequest(`/validation/${wsId}`, "GET", undefined, { timeoutMs: 90000 });
        const iv = ws?.data?.idea_validation || ws?.data?.draft_idea_validation;
        setExistingCatalogue(ws?.data?.catalogue || { products: [], customers: [], vendors: [] });
        setSavedServiceIdeas(Array.isArray(ws?.data?.service_validation_history) ? ws.data.service_validation_history : []);
        setValidationHistory(buildUnifiedValidationHistory(ws?.data || {}));
        if (ws?.data?.currency) setServiceCurrency(ws.data.currency);
        if (!iv || typeof iv !== "object") {
          const profile = ws?.data?.business_profile;
          if (profile && typeof profile === "object") {
            if (profile.business_name) update("context.business_name", profile.business_name);
            if (profile.business_type) update("context.business_type_category", profile.business_type);
            if (profile.primary_industry) update("context.primary_industry_category", profile.primary_industry);
            if (profile.location) update("context.location", profile.location);
            if (profile.currency) update("context.currency", profile.currency);
          }
          const wp = ws?.data?.workspace_profile;
          if (wp && typeof wp === "object") {
            setWorkspaceLogoStore(wp.logo_data_url || null);
            const wpNormalized = {
              ...wp,
              core_values: Array.isArray(wp.core_values) ? wp.core_values.join(", ") : (wp.core_values || ""),
            };
            profileSnapPending.current = true;
            setProfile((prev) =>
              userEditedProfileRef.current
                ? prev
                : {
                    ...prev,
                    ...wpNormalized,
                    services: Array.isArray(wp.services) && wp.services.length
                      ? wp.services
                      : prev.services,
                  }
            );
            if (wp.company_name && !form?.context?.business_name) {
              update("context.business_name", wp.company_name);
            }
            if (wp.primary_industry && !form?.context?.primary_industry_category) {
              update("context.primary_industry_category", wp.primary_industry);
            }
            if (Array.isArray(wp.services) && wp.services.length) {
              const primary = wp.services[0];
              if (primary?.service_name) updateService("service_name", primary.service_name);
              if (primary?.service_description) updateService("service_description", primary.service_description);
              if (primary?.service_category) updateService("service_category", primary.service_category);
            }
          }
          const serviceDraft = ws?.data?.draft_service_idea || ws?.data?.service_idea_validation;
          if (serviceDraft && typeof serviceDraft === "object") {
            setServiceForm((prev) => ({ ...prev, ...serviceDraft }));
            if (serviceDraft.industry || serviceDraft.sector || serviceDraft.country) {
              setForm((prev) => ({
                ...prev,
                context: {
                  ...prev.context,
                  ...(serviceDraft.industry ? { industry_category: serviceDraft.industry, industry: serviceDraft.industry } : {}),
                  ...(serviceDraft.sector ? { sector_category: serviceDraft.sector, sector: serviceDraft.sector } : {}),
                  ...(serviceDraft.country ? { country: serviceDraft.country } : {}),
                },
              }));
            }
          }
          if (ws?.data?.market_research && typeof ws.data.market_research === "object") {
            setBusinessMarketResearch(ws.data.market_research);
          }
          if (ws?.data?.service_market_research && typeof ws.data.service_market_research === "object") {
            setServiceMarketResearch(ws.data.service_market_research);
          }
          setWorkspaceId(wsId);
          setWorkspaceNameStore(ws?.name || null);
          if (!isProductPath) setDecisionStatus(ws?.data?.decision?.status || null);
          setWorkspaceName(ws?.name || String(defaults.workspace_name || "").trim() || "");
          setWorkspaceNameTouched(true);
          return;
        }
        setWorkspaceId(wsId);
        setWorkspaceNameStore(ws?.name || null);
        if (!isProductPath) setDecisionStatus(ws?.data?.decision?.status || null);
        setIdeaValidation(iv);
        setWorkspaceName(ws?.name || String(defaults.workspace_name || "").trim() || "");
        setWorkspaceNameTouched(true);
        const wp = ws?.data?.workspace_profile;
        const next = mergeStageDefaultsIntoBusinessForm(structuredClone(iv));
        // If navigating from a service Modify/Resume URL, don't force business pathway
        next.pathway = requestedHistoryType === "service_validation" ? "product_service_idea" : (form.pathway || next.pathway || "business_idea");
        if (wp && typeof wp === "object") {
          setWorkspaceLogoStore(wp.logo_data_url || null);
          const wpNormalized2 = {
            ...wp,
            core_values: Array.isArray(wp.core_values) ? wp.core_values.join(", ") : (wp.core_values || ""),
          };
          profileSnapPending.current = true;
          setProfile((prev) =>
            userEditedProfileRef.current
              ? prev
              : {
                  ...prev,
                  ...wpNormalized2,
                  services: Array.isArray(wp.services) && wp.services.length
                    ? wp.services
                    : prev.services,
                }
          );
          if (wp.company_name && !next.context.business_name) {
            next.context.business_name = wp.company_name;
          }
          if (wp.primary_industry && !next.context.primary_industry) {
            next.context.primary_industry = wp.primary_industry;
          }
        }
        // Restore previously generated insights
        if (ws?.data?.market_research && typeof ws.data.market_research === "object") {
          setBusinessMarketResearch(ws.data.market_research);
        }
        if (ws?.data?.service_market_research && typeof ws.data.service_market_research === "object") {
          setServiceMarketResearch(ws.data.service_market_research);
        }
        const serviceDraft = ws?.data?.draft_service_idea || ws?.data?.service_idea_validation;
        if (serviceDraft && typeof serviceDraft === "object") {
          setServiceForm((prev) => ({ ...prev, ...serviceDraft }));
          if (serviceDraft.industry || serviceDraft.sector || serviceDraft.country) {
            next.context = {
              ...next.context,
              ...(serviceDraft.industry ? { industry_category: serviceDraft.industry, industry: serviceDraft.industry } : {}),
              ...(serviceDraft.sector ? { sector_category: serviceDraft.sector, sector: serviceDraft.sector } : {}),
              ...(serviceDraft.country ? { country: serviceDraft.country } : {}),
            };
          }
        } else if (wp && Array.isArray(wp.services) && wp.services.length) {
          const primary = wp.services[0];
          if (primary?.service_name) updateService("service_name", primary.service_name);
          if (primary?.service_description) updateService("service_description", primary.service_description);
          if (primary?.service_category) updateService("service_category", primary.service_category);
        }
        const bt = String(next?.context?.business_type ?? "").trim();
        next.context.business_type_category = BUSINESS_TYPE_OPTIONS.includes(bt) ? bt : "Other";
        next.context.business_type_other = BUSINESS_TYPE_OPTIONS.includes(bt) ? "" : bt;
        const pi = String(next?.context?.primary_industry ?? "").trim();
        next.context.primary_industry_category = PRIMARY_INDUSTRY_OPTIONS.includes(pi) ? pi : pi ? "Other" : "IT";
        next.context.primary_industry_other = PRIMARY_INDUSTRY_OPTIONS.includes(pi) ? "" : pi;
        const cs = String(next?.problem?.customer_segment ?? "").trim();
        next.problem.customer_segment_category = CUSTOMER_SEGMENT_OPTIONS.includes(cs) ? cs : cs ? "Other" : "SMEs";
        next.problem.customer_segment_other = CUSTOMER_SEGMENT_OPTIONS.includes(cs) ? "" : cs;
        const frequencyFields = deriveFrequencyFields(next?.problem?.frequency ?? "");
        next.problem.frequency = frequencyFields.frequency;
        next.problem.frequency_category = frequencyFields.frequency_category;
        next.problem.frequency_custom = frequencyFields.frequency_custom;
        const du = String(next?.offer?.deliverable_unit ?? "").trim();
        next.offer.deliverable_unit_category = DELIVERABLE_UNIT_OPTIONS.includes(du) ? du : du ? "Other" : "unit";
        next.offer.deliverable_unit_other = DELIVERABLE_UNIT_OPTIONS.includes(du) ? "" : du;
        next.context.founder_hours_per_week = String(next.context?.founder_hours_per_week ?? "40");
        next.offer.price_per_unit = String(next.offer?.price_per_unit ?? "");
        if (!next.demand) next.demand = { expected_units_per_month: "", expected_customers: "", sales_cycle_days: "", payment_terms_days: "14" };
        if (!next.costs) next.costs = { variable_cost_per_unit: "", fixed_costs_monthly: "", founder_draw_monthly: "", contractor_costs_monthly: "" };
        if (!next.capacity) next.capacity = { team_size: "1", capacity_units_per_person_per_month: "" };
        if (!next.cash) next.cash = { starting_cash: "", upfront_costs: "" };
        next.demand.expected_units_per_month = String(next.demand?.expected_units_per_month ?? "");
        next.demand.expected_customers = String(next.demand?.expected_customers ?? "");
        next.demand.sales_cycle_days = String(next.demand?.sales_cycle_days ?? "");
        next.demand.payment_terms_days = String(next.demand?.payment_terms_days ?? "14");
        next.costs.variable_cost_per_unit = String(next.costs?.variable_cost_per_unit ?? "");
        next.costs.fixed_costs_monthly = String(next.costs?.fixed_costs_monthly ?? "");
        next.costs.founder_draw_monthly = String(next.costs?.founder_draw_monthly ?? "");
        next.costs.contractor_costs_monthly = String(next.costs?.contractor_costs_monthly ?? "");
        next.capacity.team_size = String(next.capacity?.team_size ?? "1");
        next.capacity.capacity_units_per_person_per_month = String(next.capacity?.capacity_units_per_person_per_month ?? "");
        next.cash.starting_cash = String(next.cash?.starting_cash ?? "");
        next.cash.upfront_costs = String(next.cash?.upfront_costs ?? "");
        setForm(next);
      } catch (e) {
        setError(humanizeValidationError(e));
      } finally {
        setIsPrefilling(false);
      }
    }
    prefill();
  }, [BUSINESS_TYPE_OPTIONS, CUSTOMER_SEGMENT_OPTIONS, DELIVERABLE_UNIT_OPTIONS, PRIMARY_INDUSTRY_OPTIONS, editingWorkspaceId, setDecisionStatus, setIdeaValidation, setWorkspaceId, setWorkspaceNameStore, storedWorkspaceId]);

  function selectPathway(value) {
    setBusinessMarketResearch(null);
    setBusinessResearchHash(null);
    setServiceMarketResearch(null);
    setServiceResearchHash(null);
    setMrError(null);
    setForm((prev) => ({
      ...prev,
      pathway: value
    }));
  }

  function update(path, value) {
    setMrError(null);
    setError(null);
    if (isProductPath) setServiceFormDirty(true);
    setForm((prev) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  }

  function updateService(path, value) {
    setMrError(null);
    setError(null);
    setServiceFormDirty(true);
    setServiceForm((prev) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  }

  function updateProfile(path, value) {
    userEditedProfileRef.current = true;
    setProfile((prev) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  }

  async function handleProfileLogoChange(file) {
    if (!file) return;
    try {
      const dataUrl = await imageFileToDataUrl(file);
      updateProfile("logo_data_url", dataUrl);
      setWorkspaceLogoStore(dataUrl);
      setSavedNotice("Logo ready to save.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load logo.");
    }
  }

  function clearProfileLogo() {
    updateProfile("logo_data_url", "");
    setWorkspaceLogoStore(null);
  }

  function normaliseValidationHistoryEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const id = String(entry.id || "").trim();
    if (!id) return null;

    const payload = entry.payload || {};
    const result = entry.result || {};
    let title;

    const isService =
      entry.type === "service_validation" ||
      Boolean(entry.service_name || payload.service_name || payload.context?.service_name);

    if (isService) {
      // Service validation: prefer the explicit service name from every possible location
      title =
        String(entry.service_name || "").trim() ||
        String(payload.service_name || "").trim() ||
        String(payload.context?.service_name || "").trim() ||
        String(result?.service_name || "").trim() ||
        String(entry.title || "").trim() ||
        "Service Validation";
    } else {
      // Business idea validation.
      // Priority mirrors the backend naming logic (service.py):
      //   business_offering → description → service_type → business_name
      //
      // business_name is LAST because buildInitialBusinessForm() pre-fills it from
      // workspace defaults (loadValidationStageDefaults → defaults.business_name),
      // meaning it matches the workspace name for most users and is therefore the
      // least specific identifier of the actual idea being validated.
      const bo = String(payload.context?.business_offering || result?.business_offering || "").trim();
      const desc = String(payload.context?.description || "").trim();
      const st = String(payload.offer?.service_type || result?.service_type || "").trim();
      const bn = String(payload.context?.business_name || result?.business_name || entry.business_name || "").trim();

      if (bo) {
        title = bo;
      } else if (desc) {
        title = desc.length > 60 ? desc.substring(0, 57) + "..." : desc;
      } else if (st) {
        title = st;
      } else if (bn) {
        title = bn;
      } else {
        // Very last resort — entry.title may be the workspace name for legacy entries
        title = String(entry.title || "").trim() || "Business Validation";
      }
    }

    return {
      id,
      type: String(entry.type || "validation"),
      title: String(title).trim(),
      created_at: entry.created_at || new Date().toISOString(),
      status: entry.status || entry.decision_status || "pending",
      summary: String(entry.summary || entry.outcome || "").trim(),
      score: typeof entry.score === "number" ? entry.score : null,
      payload: entry.payload || null,
      result: entry.result || null,
      journey: entry.journey || null,
    };
  }

  function buildUnifiedValidationHistory(data) {
    const validationHistory = Array.isArray(data?.validation_history) ? data.validation_history : [];
    const serviceHistory = Array.isArray(data?.service_validation_history) ? data.service_validation_history : [];
    const merged = new Map();

    validationHistory.forEach((entry) => {
      const normalized = normaliseValidationHistoryEntry(entry);
      if (normalized) merged.set(normalized.id, normalized);
    });

    serviceHistory.forEach((entry) => {
      const normalized = normaliseValidationHistoryEntry({
        ...entry,
        type: "service_validation",
        title: entry?.service_name || entry?.payload?.service_name || entry?.title || "Service validation",
      });
      if (!normalized) return;
      if (!merged.has(normalized.id)) {
        merged.set(normalized.id, normalized);
        return;
      }
      const existing = merged.get(normalized.id);
      merged.set(normalized.id, {
        ...normalized,
        ...existing,
        type: existing?.type || normalized.type,
        title: existing?.title || normalized.title,
        status: existing?.status || normalized.status || "pending",
        payload: existing?.payload || normalized.payload || null,
        result: existing?.result || normalized.result || null,
      });
    });

    return Array.from(merged.values()).sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );
  }

  function hydrateBusinessFormForEditor(source) {
    const next = structuredClone(source || form);
    next.pathway = "business_idea";
    next.context ||= {};
    next.problem ||= {};
    next.offer ||= {};
    next.demand ||= {};
    next.costs ||= {};
    next.capacity ||= {};
    next.cash ||= {};
    next.go_to_market ||= {};
    next.validation ||= { spoken_count: "No", demand_proof: [] };

    const bt = String(next?.context?.business_type ?? "").trim();
    next.context.business_type_category = BUSINESS_TYPE_OPTIONS.includes(bt) ? bt : bt ? "Other" : "Technology";
    next.context.business_type_other = BUSINESS_TYPE_OPTIONS.includes(bt) ? "" : bt;

    const pi = String(next?.context?.primary_industry ?? "").trim();
    next.context.primary_industry_category = PRIMARY_INDUSTRY_OPTIONS.includes(pi) ? pi : pi ? "Other" : "IT";
    next.context.primary_industry_other = PRIMARY_INDUSTRY_OPTIONS.includes(pi) ? "" : pi;

    const cs = String(next?.problem?.customer_segment ?? "").trim();
    next.problem.customer_segment_category = CUSTOMER_SEGMENT_OPTIONS.includes(cs) ? cs : cs ? "Other" : "SMEs";
    next.problem.customer_segment_other = CUSTOMER_SEGMENT_OPTIONS.includes(cs) ? "" : cs;
    const frequencyFields = deriveFrequencyFields(next?.problem?.frequency ?? "");
    next.problem.frequency = frequencyFields.frequency;
    next.problem.frequency_category = frequencyFields.frequency_category;
    next.problem.frequency_custom = frequencyFields.frequency_custom;

    const du = String(next?.offer?.deliverable_unit ?? "").trim();
    next.offer.deliverable_unit_category = DELIVERABLE_UNIT_OPTIONS.includes(du) ? du : du ? "Other" : "unit";
    next.offer.deliverable_unit_other = DELIVERABLE_UNIT_OPTIONS.includes(du) ? "" : du;

    next.context.founder_hours_per_week = String(next.context?.founder_hours_per_week ?? "40");
    next.offer.price_per_unit = String(next.offer?.price_per_unit ?? "");
    if (!next.demand) next.demand = { expected_units_per_month: "", expected_customers: "", sales_cycle_days: "", payment_terms_days: "14" };
    if (!next.costs) next.costs = { variable_cost_per_unit: "", fixed_costs_monthly: "", founder_draw_monthly: "", contractor_costs_monthly: "" };
    if (!next.capacity) next.capacity = { team_size: "1", capacity_units_per_person_per_month: "" };
    if (!next.cash) next.cash = { starting_cash: "", upfront_costs: "" };
    next.demand.expected_units_per_month = String(next.demand?.expected_units_per_month ?? "");
    next.demand.expected_customers = String(next.demand?.expected_customers ?? "");
    next.demand.sales_cycle_days = String(next.demand?.sales_cycle_days ?? "");
    next.demand.payment_terms_days = String(next.demand?.payment_terms_days ?? "14");
    next.costs.variable_cost_per_unit = String(next.costs?.variable_cost_per_unit ?? "");
    next.costs.fixed_costs_monthly = String(next.costs?.fixed_costs_monthly ?? "");
    next.costs.founder_draw_monthly = String(next.costs?.founder_draw_monthly ?? "");
    next.costs.contractor_costs_monthly = String(next.costs?.contractor_costs_monthly ?? "");
    next.capacity.team_size = String(next.capacity?.team_size ?? "1");
    next.capacity.capacity_units_per_person_per_month = String(next.capacity?.capacity_units_per_person_per_month ?? "");
    next.cash.starting_cash = String(next.cash?.starting_cash ?? "");
    next.cash.upfront_costs = String(next.cash?.upfront_costs ?? "");

    // Reconstruct Section 5 category fields from resolved values when blank
    // (older payloads or payloads that didn't set these fields)
    if (!next.context.industry_category) {
      const ind = String(next.context.industry || "").trim();
      if (ind) {
        next.context.industry_category = INDUSTRY_OPTIONS.includes(ind) ? ind : "Other";
        if (!INDUSTRY_OPTIONS.includes(ind)) next.context.industry_other = ind;
      }
    }
    if (!next.context.sector_category) {
      const sec = String(next.context.sector || "").trim();
      if (sec) {
        next.context.sector_category = SECTOR_OPTIONS.includes(sec) ? sec : "Other";
        if (!SECTOR_OPTIONS.includes(sec)) next.context.sector_other = sec;
      }
    }
    if (!next.context.country) {
      const co = String(next.context.resolved_country || "").trim();
      if (co) {
        next.context.country = COUNTRY_OPTIONS.includes(co) ? co : "Other";
        if (!COUNTRY_OPTIONS.includes(co)) next.context.country_other = co;
      }
    }

    return next;
  }

  async function editHistoryEntry(entry, skipNavigation = false, goToForm = false) {
    if (!activeWorkspaceId) return;
    setError(null);
    setIsPrefilling(true);
    try {
      const ws = await apiRequest(`/validation/${activeWorkspaceId}`, "GET", undefined, { timeoutMs: 90000 });
      const data = ws?.data || {};
      setWorkspaceId(activeWorkspaceId);
      setWorkspaceNameStore(ws?.name || null);
      setWorkspaceName(ws?.name || "");
      setWorkspaceNameTouched(true);

      const isViewing = entry.status === "accepted";
      const isRejected = entry.status === "rejected";

      if (entry.type === "service_validation") {
        const serviceHistory = Array.isArray(data.service_validation_history) ? data.service_validation_history : [];
        const serviceEntry = serviceHistory.find((item) => item?.id === entry.id);
        const hasResult = Boolean(serviceEntry?.result || entry.result);
        const payload = serviceEntry?.payload || entry.payload || data.draft_service_idea;
        if (!payload || typeof payload !== "object") {
          setError("We could not find the saved service inputs for this history item.");
          return;
        }
        setForm((prev) => ({
          ...prev,
          pathway: "product_service_idea",
          context: {
            ...prev.context,
            ...(payload.industry ? { industry_category: payload.industry, industry: payload.industry } : {}),
            ...(payload.sector ? { sector_category: payload.sector, sector: payload.sector } : {}),
            ...(payload.country ? { country: payload.country } : {}),
          },
        }));
        setServiceForm((prev) => ({
          ...prev,
          ...payload,
          // Guard newer fields that may be absent in older saved payloads
          target_customer_type: Array.isArray(payload?.target_customer_type) ? payload.target_customer_type : payload?.target_customer_type ? String(payload.target_customer_type).split(",").map(s => s.trim()).filter(Boolean) : (prev.target_customer_type || []),
          problem_to_solve: String(payload?.problem_to_solve ?? prev.problem_to_solve ?? ""),
          competitors_alternatives: String(payload?.competitors_alternatives ?? prev.competitors_alternatives ?? ""),
          differentiator: String(payload?.differentiator ?? prev.differentiator ?? ""),
          demand_validation_proof: Array.isArray(payload?.demand_validation_proof) ? payload.demand_validation_proof : (prev.demand_validation_proof || []),
          customer_need_frequency: String(payload?.customer_need_frequency ?? prev.customer_need_frequency ?? "Monthly"),
          estimated_price: String(payload?.estimated_price ?? prev.estimated_price ?? ""),
          assumed_cost_per_unit: String(payload?.assumed_cost_per_unit ?? prev.assumed_cost_per_unit ?? ""),
          required_capacity: String(payload?.required_capacity ?? prev.required_capacity ?? ""),
        }));
        setServiceCurrency(serviceEntry?.currency || data.currency || serviceCurrency || "GBP");
        setDraftServiceIdea(payload);
        setValidation(serviceEntry?.result || entry.result || null);
        // For rejected entries, clear decision status so the form is editable
        setServiceDecisionStatus(isRejected ? null : (entry.status || null));
        setDecisionStatus(null);
        setIsRejectedReedit(isRejected);
        setEditingHistoryEntry({
          id: entry.id,
          type: "service_validation",
          created_at: serviceEntry?.created_at || entry.created_at || new Date().toISOString(),
        });
        // Load the stored insight so the report can show it immediately if available
        const mr = serviceEntry?.market_research || data.service_market_research || null;
        if (mr && typeof mr === "object") {
          setServiceMarketResearch(mr);
        }

        // Enrich draft with context fields so results page gets correct industry even for old entries
        const ctxIndustry = String(form?.context?.industry_category === "Other" ? (form?.context?.industry_other || "") : (form?.context?.industry_category || "")).trim();
        const ctxSector = String(form?.context?.sector_category === "Other" ? (form?.context?.sector_other || "") : (form?.context?.sector_category || "")).trim();
        const ctxCountry = String(form?.context?.country === "Other" ? (form?.context?.country_other || "") : (form?.context?.country || "")).trim();
        const enrichedPayload = {
          ...payload,
          ...(ctxIndustry && !payload.industry ? { industry: ctxIndustry } : {}),
          ...(ctxSector && !payload.sector ? { sector: ctxSector } : {}),
          ...(ctxCountry && !payload.country ? { country: ctxCountry } : {}),
        };
        await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", {
          data: {
            active_service_validation_id: entry.id,
            draft_service_idea: enrichedPayload,
          }
        });

        if (!skipNavigation && (isViewing || hasResult)) {
          navigate("/results");
          return;
        }
      } else {
        // Look up the history entry first so its payload/journey take precedence
        // over the current draft (entry from URL params has no payload or journey).
        const vHistory = Array.isArray(data.validation_history) ? data.validation_history : [];
        const apiHistEntry = vHistory.find((e) => String(e?.id) === String(entry.id));
        const payload = entry.payload || apiHistEntry?.payload || data.draft_idea_validation || data.idea_validation;
        if (!payload || typeof payload !== "object") {
          setError("We could not find the saved business inputs for this history item.");
          return;
        }

        // V4 entries have a `journey` field ("basic" | "comprehensive")
        const isV4Entry = Boolean(entry.journey || apiHistEntry?.journey || payload?.validation_mode || payload?.steps_completed);

        const bizResult = entry.result || apiHistEntry?.result || null;
        if (bizResult) setValidation(bizResult);

        await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", {
          data: {
            active_validation_id: entry.id,
            draft_idea_validation: payload,
          }
        });

        // All business entries (V4 or legacy) — if there's a result show it, else go to V4 step 0
        const journey = entry.journey || apiHistEntry?.journey || payload?.validation_mode || "basic";
        setV4Journey(journey);
        setV4Form(payload);
        setV4Error(null);
        setEditingHistoryEntry({
          id: entry.id,
          type: "business_validation",
          created_at: entry.created_at || new Date().toISOString(),
        });
        setValidationEntryId(entry.id || null);
        setMrError(null);
        setContentTab("builder");

        if (!skipNavigation && (isViewing || Boolean(bizResult))) {
          navigate("/results");
          return;
        }

        setMode("v4");
        setV4Step(goToForm ? 1 : 0);
        return;
      }

      setMrError(null);
      setContentTab("builder");
      setServiceFormDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this validation history item.");
    } finally {
      setIsPrefilling(false);
    }
  }

  async function updateHistoryEntryStatus(entryId, status) {
    if (!activeWorkspaceId) return;
    setError(null);
    try {
      const ws = await apiRequest(`/validation/${activeWorkspaceId}`, "GET", undefined, { timeoutMs: 90000 });
      const data = ws?.data || {};
      const vHistory = Array.isArray(data.validation_history) ? data.validation_history : [];
      const sHistory = Array.isArray(data.service_validation_history) ? data.service_validation_history : [];
      const now = new Date().toISOString();

      const nextVHistory = vHistory.map((e) =>
        e?.id === entryId ? { ...e, status, decided_at: now } : e
      );
      const nextSHistory = sHistory.map((e) =>
        e?.id === entryId ? { ...e, decision_status: status, decided_at: now } : e
      );

      // Sync catalogue when accepting or rejecting a service validation
      let cataloguePatch = {};
      const targetSEntry = sHistory.find(e => e?.id === entryId);
      const targetVEntry = vHistory.find(e => e?.id === entryId && e?.type === "service_validation");
      const targetEntry = targetSEntry || targetVEntry;
      const serviceName = String(targetEntry?.service_name || targetEntry?.payload?.service_name || targetEntry?.title || "").trim();

      if (serviceName) {
        const existingCat = data.catalogue || { products: [], customers: [], vendors: [] };
        const existingProducts = Array.isArray(existingCat.products) ? existingCat.products : [];

        if (status === "accepted") {
          // Add to catalogue if not already present
          const alreadyIn = existingProducts.some(
            p => String(p?.name || "").trim().toLowerCase() === serviceName.toLowerCase()
          );
          if (!alreadyIn) {
            const payload = targetEntry?.payload || {};
            const newProduct = {
              id: crypto.randomUUID(),
              name: serviceName,
              description: String(payload.service_description || "").trim() || null,
              type: "service",
              base_price: Number(payload.price_per_sale ?? payload.estimated_price ?? 0) || 0,
              cost_of_sales: Number(payload.direct_labour_cost_per_sale ?? payload.assumed_cost_per_unit ?? 0) || 0,
              discount: 0,
              freight_cost: 0,
              archived: false,
              created_at: now,
              updated_at: now,
              source: "validation",
            };
            cataloguePatch = { catalogue: { ...existingCat, products: [newProduct, ...existingProducts] } };
          }
        } else if (status === "rejected") {
          // Remove from catalogue if present
          const updatedProducts = existingProducts.filter(
            p => String(p?.name || "").trim().toLowerCase() !== serviceName.toLowerCase()
          );
          if (updatedProducts.length !== existingProducts.length) {
            cataloguePatch = { catalogue: { ...existingCat, products: updatedProducts } };
          }
        }
      }

      // On acceptance, promote the idea payload so modules can use it —
      // workspace_profile (master data) is a separate key and is never touched here.
      const acceptedVEntry = status === "accepted" ? vHistory.find((e) => e?.id === entryId) : null;
      const acceptedPayload = acceptedVEntry?.payload || null;

      await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", {
        data: {
          validation_history: nextVHistory,
          service_validation_history: nextSHistory,
          ...(status === "accepted" ? { active_validation_id: entryId } : {}),
          ...(status === "accepted" && acceptedPayload ? { idea_validation: acceptedPayload } : {}),
          ...cataloguePatch,
        }
      });

      if (status === "accepted" && acceptedPayload) setIdeaValidation(acceptedPayload);

      setValidationHistory((prev) =>
        prev.map((e) => e.id === entryId ? { ...e, status } : e)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update validation status.");
    }
  }

  function deleteHistoryEntry(entryId) {
    if (!activeWorkspaceId) return;
    setConfirmDialog({
      message: "Delete this validation history item? This cannot be undone.",
      onConfirm: async () => {
        setConfirmDialog(null);
        setError(null);
        try {
          const ws = await apiRequest(`/validation/${activeWorkspaceId}`, "GET");
          const existing = Array.isArray(ws?.data?.validation_history) ? ws.data.validation_history : [];
          const serviceExisting = Array.isArray(ws?.data?.service_validation_history) ? ws.data.service_validation_history : [];
          const nextHistory = existing.filter((item) => item?.id !== entryId);
          const nextServiceHistory = serviceExisting.filter((item) => item?.id !== entryId);
          await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", {
            data: {
              validation_history: nextHistory,
              service_validation_history: nextServiceHistory,
            }
          });
          setValidationHistory(
            buildUnifiedValidationHistory({
              validation_history: nextHistory,
              service_validation_history: nextServiceHistory,
            })
          );
          setSavedServiceIdeas(nextServiceHistory);
          setSavedNotice("Validation history deleted.");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not delete validation history item.");
        }
      },
      onCancel: () => setConfirmDialog(null),
    });
  }

  function bulkDeleteEntries(ids) {
    if (!activeWorkspaceId || !ids.size) return;
    setConfirmDialog({
      message: `Delete ${ids.size} selected validation${ids.size > 1 ? "s" : ""}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        setError(null);
        try {
          const ws = await apiRequest(`/validation/${activeWorkspaceId}`, "GET");
          const existing = Array.isArray(ws?.data?.validation_history) ? ws.data.validation_history : [];
          const serviceExisting = Array.isArray(ws?.data?.service_validation_history) ? ws.data.service_validation_history : [];
          const nextHistory = existing.filter((item) => !ids.has(item?.id));
          const nextServiceHistory = serviceExisting.filter((item) => !ids.has(item?.id));
          await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", {
            data: { validation_history: nextHistory, service_validation_history: nextServiceHistory },
          });
          setValidationHistory(buildUnifiedValidationHistory({ validation_history: nextHistory, service_validation_history: nextServiceHistory }));
          setSavedServiceIdeas(nextServiceHistory);
          setBulkSelected(new Set());
          setSavedNotice(`${ids.size} validation${ids.size > 1 ? "s" : ""} deleted.`);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not delete selected items.");
        }
      },
      onCancel: () => setConfirmDialog(null),
    });
  }

  function validateProfileDraft() {
    if (!enabledForms.workspace_profile) return null;
    if (!String(profile.company_name || "").trim()) return "Company name is required in the workspace profile.";
    if (!String(profile.business_type || "").trim()) return "Business type is required in the workspace profile.";
    if (!String(profile.primary_industry || "").trim()) return "Primary industry is required in the workspace profile.";
    if (!String(profile.about_company || "").trim()) return "About company is required in the workspace profile.";
    if (!String(profile.country || "").trim()) return "Country is required in the workspace profile.";
    if (!String(profile.city || "").trim()) return "City is required in the workspace profile.";
    if (!String(profile.email || "").trim()) return "Email is required in the workspace profile.";
    if (!String(profile.operating_stage || "").trim()) return "Operating stage is required in the workspace profile.";
    if (!String(profile.delivery_model || "").trim()) return "Delivery model is required in the workspace profile.";
    const svc = (Array.isArray(profile.services) ? profile.services : [])
      .filter((s) => String(s.service_name || "").trim());
    if (svc.some((s) => !String(s.service_category || "").trim())) {
      return "Each service entry must have a category selected.";
    }
    return null;
  }

  const canRun = useMemo(() => {
    if (isCreateWorkspace) {
      const existingWsId = editingWorkspaceId || storedWorkspaceId;
      if (existingWsId && savedProfileSnap.current !== null) {
        // Existing workspace: enable whenever something changed (validation errors shown on click)
        return JSON.stringify(profile) !== savedProfileSnap.current;
      }
      // New workspace: enable when all required fields are filled
      return !validateProfileDraft();
    }
    if (isProductPath) {
      const required = [
        String(serviceForm.service_name || "").trim().length >= 2,
        String(serviceForm.service_description || "").trim().length >= 5,
        (Array.isArray(serviceForm.target_customer_type) ? serviceForm.target_customer_type : []).length > 0,
        String(serviceForm.target_market_scope || "").trim(),
        // Use estimated_price and demand_validation_proof which are what's actually in the form
        parseNumber(serviceForm.estimated_price, 0) >= 0,
        parseNumber(serviceForm.expected_sales_per_month, 0) >= 0,
        // Remove hidden capacity requirements that are not in the form
        (serviceForm.demand_validation_proof || []).length > 0,
        String(serviceForm.differentiator || "").trim().length >= 5
      ];
      return required.every(Boolean);
    }
    const bn = String(form.context.business_name || "").trim();
    const sn = String(form.offer?.service_type || "").trim();
    return bn.length >= 2 || sn.length >= 2;
  }, [
    form.context.business_name,
    form.offer?.service_type,
    isCreateWorkspace,
    isProductPath,
    profile,
    serviceForm,
    editingWorkspaceId,
    storedWorkspaceId,
  ]);
  const canEdit = !isLoading && !isPrefilling;

  function startFilling() {
    if (!selectedCount) return setError("Select at least one section to continue.");
    setError(null);
    setMode("fill");
  }

  function updateFrequency(value) {
    const nextValue = String(value || "").trim().toLowerCase();
    setError(null);
    setMrError(null);
    setForm((prev) => {
      const next = structuredClone(prev);
      next.problem.frequency_category = nextValue;
      if (nextValue === "custom") {
        next.problem.frequency = String(next.problem.frequency_custom || "").trim();
      } else {
        next.problem.frequency_custom = "";
        next.problem.frequency = nextValue;
      }
      return next;
    });
  }

  function updateCustomFrequency(value) {
    setError(null);
    setMrError(null);
    setForm((prev) => {
      const next = structuredClone(prev);
      next.problem.frequency_custom = value;
      next.problem.frequency = value;
      next.problem.frequency_category = "custom";
      return next;
    });
  }

  function buildBusinessIdeaPayloadForResearch() {
    const payload = structuredClone(form);
    payload.existing_business = null;
    payload.context ||= {};
    payload.problem ||= {};
    payload.offer ||= {};
    payload.demand ||= {};
    payload.costs ||= {};
    payload.capacity ||= {};
    payload.cash ||= {};
    payload.validation ||= {};

    // Map simplified fields for backend/AI consumption
    payload.context.business_offering = payload.context.description || payload.context.business_offering;
    payload.context.what_building = payload.context.description || payload.context.business_offering || payload.context.business_name || "";

    // Resolve "Other" custom values for industry/sector/country/currency
    const _ic = payload.context.industry_category;
    payload.context.industry = _ic === "Other" ? (payload.context.industry_other || "") : (_ic || "");
    const _sc = payload.context.sector_category;
    payload.context.sector = _sc === "Other" ? (payload.context.sector_other || "") : (_sc || "");
    const _co = payload.context.country;
    payload.context.resolved_country = _co === "Other" ? (payload.context.country_other || "") : (_co || "");
    const _cu = payload.context.currency;
    payload.context.resolved_currency = _cu === "Other" ? (payload.context.currency_other || "GBP") : (_cu || "GBP");
    if (!payload.problem.problem_type && payload.problem.description) {
      payload.problem.problem_type = payload.problem.description;
    }
    // Append severity to problem context for better AI understanding
    if (payload.problem.severity) {
      payload.problem.problem_type = `${payload.problem.problem_type} [Severity: ${payload.problem.severity}]`;
    }
    // Map spoken_count and proof into a summary field if needed, or just send
    payload.demand_evidence = (payload.validation.demand_proof || []).join(", ");
    if (payload.validation.spoken_count && payload.validation.spoken_count !== "No") {
      payload.demand_evidence += ` (Spoken to ${payload.validation.spoken_count} users)`;
    }

    const bt = String(payload.context.business_type_category || "").trim();
    const btOther = String(payload.context.business_type_other || "").trim();
    payload.context.business_type = bt === "Other" ? btOther || "Other" : bt || "Other";

    const pi = String(payload.context.primary_industry_category || "").trim();
    const piOther = String(payload.context.primary_industry_other || "").trim();
    payload.context.primary_industry = pi === "Other" ? piOther || "Other" : pi || "Other";

    const cs = String(payload.problem.customer_segment_category || "").trim();
    const csOther = String(payload.problem.customer_segment_other || "").trim();
    payload.problem.customer_segment = cs === "Other" ? csOther || "Other" : cs || "Other";

    const duCat = String(payload.offer.deliverable_unit_category || "").trim();
    const duOther = String(payload.offer.deliverable_unit_other || "").trim();
    payload.offer.deliverable_unit = duCat === "Other" ? duOther || "unit" : duCat || "unit";

    payload.context.founder_hours_per_week = parseNumber(payload.context.founder_hours_per_week, 40);
    payload.offer.price_per_unit = parseNumber(payload.offer.price_per_unit, 0);
    payload.demand.expected_units_per_month = parseNumber(payload.demand.expected_units_per_month, 0);
    payload.demand.expected_customers = parseIntSafe(payload.demand.expected_customers, 0);
    payload.demand.sales_cycle_days = parseIntSafe(payload.demand.sales_cycle_days, 0);
    payload.demand.payment_terms_days = parseIntSafe(payload.demand.payment_terms_days, 14);
    payload.costs.variable_cost_per_unit = parseNumber(payload.costs.variable_cost_per_unit, 0);
    payload.costs.fixed_costs_monthly = parseNumber(payload.costs.fixed_costs_monthly, 0);
    payload.costs.founder_draw_monthly = parseNumber(payload.costs.founder_draw_monthly, 0);
    payload.costs.contractor_costs_monthly = parseNumber(payload.costs.contractor_costs_monthly, 0);
    payload.capacity.team_size = Math.max(1, parseIntSafe(payload.capacity.team_size, 1));
    payload.capacity.capacity_units_per_person_per_month = parseNumber(payload.capacity.capacity_units_per_person_per_month, 0);
    payload.cash.starting_cash = parseNumber(payload.cash.starting_cash, 0);
    payload.cash.upfront_costs = parseNumber(payload.cash.upfront_costs, 0);

    delete payload.context.business_type_category;
    delete payload.context.business_type_other;
    delete payload.context.primary_industry_category;
    delete payload.context.primary_industry_other;
    delete payload.problem.customer_segment_category;
    delete payload.problem.customer_segment_other;
    delete payload.offer.deliverable_unit_category;
    delete payload.offer.deliverable_unit_other;
    return payload;
  }

  function buildServiceIdeaPayloadForResearch() {
    const DEMAND_EVIDENCE_LABELS = {
      assumption_only: "assumption only — no validated evidence yet",
      market_research: "secondary market research conducted",
      enquiries: "initial interest or enquiries received",
      LOIs: "letters of intent or signed commitments",
      paid_pilot: "paying customers or paid pilot completed",
    };
    const DIFFERENTIATION_LABELS = {
      low: "low — similar to existing alternatives",
      medium: "medium — some differentiation from competitors",
      high: "high — clearly differentiated from alternatives",
    };
    const raw = structuredClone(serviceForm);
    // Resolve industry/sector/country from form.context (shared across both flows)
    const ctx = form?.context || {};
    const industryVal = ctx.industry_category === "Other" ? (ctx.industry_other || "") : (ctx.industry_category || "");
    const sectorVal = ctx.sector_category === "Other" ? (ctx.sector_other || "") : (ctx.sector_category || "");
    const countryVal = ctx.country === "Other" ? (ctx.country_other || "") : (ctx.country || "");
    const currencyVal = ctx.currency === "Other" ? (ctx.currency_other || serviceCurrency || "GBP") : (ctx.currency || serviceCurrency || "GBP");
    return {
      ...raw,
      currency: currencyVal,
      industry: industryVal,
      sector: sectorVal,
      country: countryVal,
      location: countryVal || ctx.location || "United Kingdom",
      demand_evidence_type:
        DEMAND_EVIDENCE_LABELS[raw.demand_evidence_type] || raw.demand_evidence_type || "",
      differentiation_level:
        DIFFERENTIATION_LABELS[raw.differentiation_level] || raw.differentiation_level || "",
    };
  }

  function validateBusinessStage(_stageKey) {
    // Business idea stages are optional — the user can proceed at any point.
    return null;
  }

  function validateServiceStage(stageKey) {
    if (!isServiceStageFlow) return null;
    if (stageKey === "service_basics") {
      if (!String(serviceForm.service_name || "").trim()) return "Service name is required.";
      if (String(serviceForm.service_name || "").trim().length < 3) return "Service name should be at least 3 characters.";
      if (!String(serviceForm.service_description || "").trim()) return "Service description is required.";
      if (String(serviceForm.service_description || "").trim().length < 10) return "Service description should be at least 10 characters.";
      if (!String(serviceForm.service_category || "").trim()) return "Service category is required.";
      if (!(Array.isArray(serviceForm.target_customer_type) ? serviceForm.target_customer_type : []).length) return "Target customer type is required.";
      if (!String(serviceForm.target_market_scope || "").trim()) return "Target market scope is required.";
      return null;
    }
    if (stageKey === "revenue_inputs") {
      if (parseNumber(serviceForm.price_per_sale, 0) <= 0) return "Price per sale must be greater than 0.";
      if (parseNumber(serviceForm.expected_sales_per_month, -1) < 0) return "Expected sales per month cannot be negative.";
      return null;
    }
    if (stageKey === "direct_costs") {
      if (String(serviceForm.direct_labour_cost_per_sale || "").trim() === "") return "Direct labour cost per sale is required.";
      return null;
    }
    if (stageKey === "fixed_costs") {
      if (String(serviceForm.monthly_software_cost || "").trim() === "") return "Monthly software cost is required.";
      if (String(serviceForm.monthly_marketing_cost || "").trim() === "") return "Monthly marketing cost is required.";
      if (String(serviceForm.monthly_admin_cost || "").trim() === "") return "Monthly admin cost is required.";
      return null;
    }
    if (stageKey === "capacity_inputs") {
      if (parseNumber(serviceForm.hours_required_per_sale, 0) <= 0) return "Hours required must be greater than 0.";
      if (parseNumber(serviceForm.available_delivery_hours_per_month, 0) <= 0) return "Available delivery hours per month must be greater than 0.";
      return null;
    }
    if (stageKey === "demand_inputs") {
      if (!String(serviceForm.demand_evidence_type || "").trim()) return "Demand evidence type is required.";
      return null;
    }
    if (stageKey === "competition") {
      if (!String(serviceForm.differentiation_level || "").trim()) return "Differentiation level is required.";
      return null;
    }
    return null;
  }


  async function saveWorkspace(shouldEvaluate = false) {
    setIsLoading(true);
    if (shouldEvaluate) setIsValidating(true);
    setError(null);
    setSavedNotice(null);
    try {
      const profileError = validateProfileDraft();
      if (profileError) {
        setError(profileError);
        setIsLoading(false);
        return;
      }
      // For idea validation, always keep the existing workspace name — never overwrite it with business idea name.
      // workspaceName is the idea label only; the actual workspace name comes from the store.
      const wsName = isCreateWorkspace
        ? String(profile.company_name || "").trim() || derivedWorkspaceName
        : String(useWorkspaceStore.getState().workspaceName || workspaceName || "").trim() || "My workspace";

      let wsId = editingWorkspaceId || storedWorkspaceId;
      if (isCreateWorkspace) {
        const profilePayload = {
          ...profile,
          company_name: String(profile.company_name || "").trim(),
          logo_data_url: String(profile.logo_data_url || "").trim() || null,
          legal_name: String(profile.legal_name || "").trim() || null,
          registration_number: String(profile.registration_number || "").trim() || null,
          about_company: String(profile.about_company || "").trim(),
          tagline: String(profile.tagline || "").trim() || null,
          year_established: profile.year_established ? Number(profile.year_established) : null,
          company_size: profile.company_size || null,
          core_values: String(profile.core_values || "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          secondary_industries: Array.isArray(profile.secondary_industries)
            ? profile.secondary_industries.filter(Boolean)
            : [],
          services: (profile.services || [])
            .filter((s) => String(s.service_name || "").trim())
            .map((s) => ({
              service_name: String(s.service_name || "").trim(),
              service_category: s.service_category,
              service_description: String(s.service_description || "").trim() || null
            })),
          country: String(profile.country || "").trim(),
          city: String(profile.city || "").trim(),
          state_or_region: String(profile.state_or_region || "").trim() || null,
          postcode: String(profile.postcode || "").trim() || null,
          address_line_1: String(profile.address_line_1 || "").trim() || null,
          address_line_2: String(profile.address_line_2 || "").trim() || null,
          email: String(profile.email || "").trim(),
          phone_number: String(profile.phone_number || "").trim() || null,
          website: String(profile.website || "").trim() || null,
          linkedin_url: String(profile.linkedin_url || "").trim() || null,
          twitter_url: String(profile.twitter_url || "").trim() || null,
          instagram_url: String(profile.instagram_url || "").trim() || null,
          facebook_url: String(profile.facebook_url || "").trim() || null,
          monthly_revenue_range: profile.monthly_revenue_range || null,
          employee_count: profile.employee_count ? Number(profile.employee_count) : null,
          operating_stage: profile.operating_stage,
          delivery_model: profile.delivery_model,
          target_customer_type: profile.target_customer_type || null,
          primary_revenue_model: profile.primary_revenue_model || null,
          key_offering_focus: String(profile.key_offering_focus || "").trim() || null
        };

        const existingProducts = Array.isArray(existingCatalogue?.products) ? existingCatalogue.products : [];
        const serviceProducts = (profilePayload.services || [])
          .filter((s) => s?.service_name)
          .map((s) => ({
            id: crypto.randomUUID(),
            name: s.service_name,
            description: String(s.service_description || "").trim() || null,
            type: "service",
            base_price: 0,
            discount: 0,
            freight_cost: 0,
            archived: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }));
        const nextProducts = serviceProducts.reduce((acc, svc) => {
          const exists = acc.some((p) => String(p?.name || "").trim().toLowerCase() === svc.name.toLowerCase());
          return exists ? acc : [svc, ...acc];
        }, existingProducts);
        const nextCatalogue = {
          products: nextProducts,
          customers: Array.isArray(existingCatalogue?.customers) ? existingCatalogue.customers : [],
          vendors: Array.isArray(existingCatalogue?.vendors) ? existingCatalogue.vendors : []
        };

        if (wsId) {
          await apiRequest(
            `/validation/${wsId}`,
            "PATCH",
            { data: { catalogue: nextCatalogue } },
            { timeoutMs: 120000 }
          );
        } else {
          const ws = await apiRequest(
            "/validation/me",
            "PATCH",
            { name: wsName, data: { catalogue: nextCatalogue } },
            { timeoutMs: 120000 }
          );
          wsId = ws.id;
        }

        setWorkspaceId(wsId);
        setWorkspaceNameStore(wsName);
        setWorkspaceLogoStore(profilePayload.logo_data_url || null);
        setDecisionStatus(null);
        setIdeaValidation(null);

        await apiRequest(
          "/workspace/profile",
          "POST",
          { workspace_id: wsId, profile: profilePayload },
          { timeoutMs: 120000 }
        );

        setSavedNotice("Workspace saved.");
        if (returnTo) {
          navigate(returnTo, { replace: true });
        } else {
          navigate("/dashboard", { replace: true });
        }
        return;
      }

      const payload = structuredClone(form);
      payload.existing_business = null;
      const bt = String(payload.context.business_type_category || "").trim();
      const btOther = String(payload.context.business_type_other || "").trim();
      payload.context.business_type = bt === "Other" ? btOther || "Other" : bt || "Other";
      delete payload.context.business_type_category;
      delete payload.context.business_type_other;
      const pi = String(payload.context.primary_industry_category || "").trim();
      const piOther = String(payload.context.primary_industry_other || "").trim();
      payload.context.primary_industry = pi === "Other" ? piOther || "Other" : pi || "Other";
      delete payload.context.primary_industry_category;
      delete payload.context.primary_industry_other;
      const cs = String(payload.problem.customer_segment_category || "").trim();
      const csOther = String(payload.problem.customer_segment_other || "").trim();
      payload.problem.customer_segment = cs === "Other" ? csOther || "Other" : cs || "Other";
      delete payload.problem.customer_segment_category;
      delete payload.problem.customer_segment_other;
      payload.context.founder_hours_per_week = parseNumber(payload.context.founder_hours_per_week, 40);
      if (!String(payload.context.business_name || "").trim() && String(payload.offer?.service_type || "").trim()) {
        payload.context.business_name = String(payload.offer.service_type).trim();
      }
      payload.offer.price_per_unit = parseNumber(payload.offer.price_per_unit, 0);
      const duCat = String(payload.offer.deliverable_unit_category || "").trim();
      const duOther = String(payload.offer.deliverable_unit_other || "").trim();
      payload.offer.deliverable_unit = duCat === "Other" ? duOther || "unit" : duCat || "unit";
      delete payload.offer.deliverable_unit_category;
      delete payload.offer.deliverable_unit_other;
      payload.demand.expected_units_per_month = parseNumber(payload.demand.expected_units_per_month, 0);
      payload.demand.expected_customers = parseIntSafe(payload.demand.expected_customers, 0);
      payload.demand.sales_cycle_days = parseIntSafe(payload.demand.sales_cycle_days, 0);
      payload.demand.payment_terms_days = parseIntSafe(payload.demand.payment_terms_days, 14);
      payload.costs.variable_cost_per_unit = parseNumber(payload.costs.variable_cost_per_unit, 0);
      payload.costs.fixed_costs_monthly = parseNumber(payload.costs.fixed_costs_monthly, 0);
      payload.costs.founder_draw_monthly = parseNumber(payload.costs.founder_draw_monthly, 0);
      payload.costs.contractor_costs_monthly = parseNumber(payload.costs.contractor_costs_monthly, 0);
      payload.capacity.team_size = Math.max(1, parseIntSafe(payload.capacity.team_size, 1));
      payload.capacity.capacity_units_per_person_per_month = parseNumber(payload.capacity.capacity_units_per_person_per_month, 0);
      payload.cash.starting_cash = parseNumber(payload.cash.starting_cash, 0);
      payload.cash.upfront_costs = parseNumber(payload.cash.upfront_costs, 0);
      setCurrency(payload.context.currency || "GBP");
      // idea_validation is only written on explicit "Accept" — not on run.
      // Draft stays in draft_idea_validation so other modules never see unaccepted data.
      const workspacePatch = {
        draft_idea_validation: isProductPath ? null : payload,
        draft_service_idea: isProductPath ? serviceForm : null,
      };
      if (wsId) {
        await apiRequest(
          `/validation/${wsId}`,
          "PATCH",
          { data: workspacePatch },
          { timeoutMs: 120000 }
        );
        setWorkspaceId(wsId);
        // Don't touch the workspace name — validation is separate from workspace identity
        if (!isProductPath) setDecisionStatus(null);
        setDraftIdeaValidation(payload);
      } else {
        const ws = await apiRequest(
          "/validation/me",
          "PATCH",
          { name: wsName, data: workspacePatch },
          { timeoutMs: 120000 }
        );
        wsId = ws.id;
        setWorkspaceId(wsId);
        setWorkspaceNameStore(ws.name || wsName);
        if (!isProductPath) setDecisionStatus(null);
        setDraftIdeaValidation(payload);
      }

      if (enabledForms.workspace_profile) {
        const profilePayload = {
          ...profile,
          company_name: String(profile.company_name || "").trim(),
          logo_data_url: String(profile.logo_data_url || "").trim() || null,
          legal_name: String(profile.legal_name || "").trim() || null,
          registration_number: String(profile.registration_number || "").trim() || null,
          about_company: String(profile.about_company || "").trim(),
          tagline: String(profile.tagline || "").trim() || null,
          year_established: profile.year_established ? Number(profile.year_established) : null,
          company_size: profile.company_size || null,
          core_values: String(profile.core_values || "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          secondary_industries: Array.isArray(profile.secondary_industries)
            ? profile.secondary_industries.filter(Boolean)
            : [],
          services: (profile.services || [])
            .filter((s) => String(s.service_name || "").trim())
            .map((s) => ({
              service_name: String(s.service_name || "").trim(),
              service_category: s.service_category,
              service_description: String(s.service_description || "").trim() || null
            })),
          country: String(profile.country || "").trim(),
          city: String(profile.city || "").trim(),
          state_or_region: String(profile.state_or_region || "").trim() || null,
          postcode: String(profile.postcode || "").trim() || null,
          address_line_1: String(profile.address_line_1 || "").trim() || null,
          address_line_2: String(profile.address_line_2 || "").trim() || null,
          email: String(profile.email || "").trim(),
          phone_number: String(profile.phone_number || "").trim() || null,
          website: String(profile.website || "").trim() || null,
          linkedin_url: String(profile.linkedin_url || "").trim() || null,
          twitter_url: String(profile.twitter_url || "").trim() || null,
          instagram_url: String(profile.instagram_url || "").trim() || null,
          facebook_url: String(profile.facebook_url || "").trim() || null,
          monthly_revenue_range: profile.monthly_revenue_range || null,
          employee_count: profile.employee_count ? Number(profile.employee_count) : null,
          operating_stage: profile.operating_stage,
          delivery_model: profile.delivery_model,
          target_customer_type: profile.target_customer_type || null,
          primary_revenue_model: profile.primary_revenue_model || null,
          key_offering_focus: String(profile.key_offering_focus || "").trim() || null
        };
        await apiRequest(
          "/workspace/profile",
          "POST",
          { workspace_id: wsId, profile: profilePayload },
          { timeoutMs: 120000 }
        );
        setWorkspaceLogoStore(profilePayload.logo_data_url || null);
      }
      if (shouldEvaluate) {
        if (isProductPath) {
          // If nothing changed and we already have a result, just go show it
          const _activeEntry = editingHistoryEntry?.id
            ? savedServiceIdeas.find((e) => e.id === editingHistoryEntry.id)
            : savedServiceIdeas[0];
          if (!serviceFormDirty && _activeEntry?.result) {
            navigate("/results");
            setIsLoading(false);
            return;
          }
          const serviceName = String(serviceForm?.service_name || "").trim();
          const serviceDescription = String(serviceForm?.service_description || "").trim();
          if (!serviceName) {
            setError("Please enter a product / service name to continue.");
            setIsLoading(false);
            return;
          }
          if (serviceDescription.length < 10) {
            setError("Service description should be at least 10 characters.");
            setIsLoading(false);
            return;
          }
          try {
            const payloadService = {
              service_name: serviceName,
              service_category: String(serviceForm?.service_category || "").trim().toLowerCase() || "consulting",
              service_description: serviceDescription,
              industry: String(form?.context?.industry_category === "Other" ? (form?.context?.industry_other || "") : (form?.context?.industry_category || "")).trim(),
              sector: String(form?.context?.sector_category === "Other" ? (form?.context?.sector_other || "") : (form?.context?.sector_category || "")).trim(),
              country: String(form?.context?.country === "Other" ? (form?.context?.country_other || "") : (form?.context?.country || "")).trim() || null,
              target_customer_type: Array.isArray(serviceForm?.target_customer_type) ? serviceForm.target_customer_type.join(", ") : String(serviceForm?.target_customer_type || "").trim(),
              target_market_scope: String(serviceForm?.target_market_scope || "").trim().toLowerCase(),
              price_per_sale: parseNumber(serviceForm?.price_per_sale, 0),
              expected_sales_per_month: parseNumber(serviceForm?.expected_sales_per_month, 0),
              direct_labour_cost_per_sale: parseNumber(serviceForm?.direct_labour_cost_per_sale, 0),
              contractor_cost_per_sale: parseNumber(serviceForm?.contractor_cost_per_sale, 0),
              materials_cost_per_sale: parseNumber(serviceForm?.materials_cost_per_sale, 0),
              travel_cost_per_sale: parseNumber(serviceForm?.travel_cost_per_sale, 0),
              other_direct_cost_per_sale: parseNumber(serviceForm?.other_direct_cost_per_sale, 0),
              monthly_software_cost: parseNumber(serviceForm?.monthly_software_cost, 0),
              monthly_marketing_cost: parseNumber(serviceForm?.monthly_marketing_cost, 0),
              monthly_admin_cost: parseNumber(serviceForm?.monthly_admin_cost, 0),
              monthly_rent_cost: parseNumber(serviceForm?.monthly_rent_cost, 0),
              monthly_other_fixed_cost: parseNumber(serviceForm?.monthly_other_fixed_cost, 0),
              hours_required_per_sale: parseNumber(serviceForm?.hours_required_per_sale, 0),
              available_delivery_hours_per_month: parseNumber(serviceForm?.available_delivery_hours_per_month, 0),
              demand_evidence_type: String(serviceForm?.demand_evidence_type || "").trim().toLowerCase(),
              number_of_interested_leads: parseIntSafe(serviceForm?.number_of_interested_leads, 0),
              number_of_paying_customers: parseIntSafe(serviceForm?.number_of_paying_customers, 0),
              competitor_price_low: parseNumber(serviceForm?.competitor_price_low, 0),
              competitor_price_high: parseNumber(serviceForm?.competitor_price_high, 0),
              differentiation_level: String(serviceForm?.differentiation_level || "").trim().toLowerCase(),
              problem_to_solve: String(serviceForm?.problem_to_solve || "").trim(),
              competitors_alternatives: String(serviceForm?.competitors_alternatives || "").trim(),
              differentiator: String(serviceForm?.differentiator || "").trim(),
              demand_validation_proof: Array.isArray(serviceForm?.demand_validation_proof) ? serviceForm.demand_validation_proof : [],
              customer_need_frequency: String(serviceForm?.customer_need_frequency || "Monthly").trim(),
              estimated_price: String(serviceForm?.estimated_price || "").trim(),
              assumed_cost_per_unit: parseNumber(serviceForm?.assumed_cost_per_unit, 0),
              required_capacity: parseNumber(serviceForm?.required_capacity, 0),
            };
            const result = await apiRequest(
              "/service-ideas/validate",
              "POST",
              payloadService,
              { timeoutMs: 240000 }
            );
            setValidation(result);
            setServiceDecisionStatus(null);

            let validationId = null;
            if (wsId) {
              const isEditingServiceHistory = editingHistoryEntry?.type === "service_validation";
              validationId = isEditingServiceHistory ? editingHistoryEntry.id : crypto.randomUUID();
              const createdAt = isEditingServiceHistory
                ? editingHistoryEntry.created_at || new Date().toISOString()
                : new Date().toISOString();
              try {
                const ws = await apiRequest(`/validation/${wsId}`, "GET", undefined, { timeoutMs: 90000 });
                const history = Array.isArray(ws?.data?.service_validation_history) ? ws.data.service_validation_history : [];
                const validationHistoryExisting = Array.isArray(ws?.data?.validation_history) ? ws.data.validation_history : [];
                const nextServiceHistoryBase = history.filter((item) => item?.id !== validationId);
                const nextValidationHistoryBase = validationHistoryExisting.filter((item) => item?.id !== validationId);
                const { research_data: _srd, ...svcResultForHistory } = result || {};
                const entry = {
                  id: validationId,
                  created_at: createdAt,
                  service_name: payloadService.service_name,
                  payload: payloadService,
                  result: svcResultForHistory,
                  decision_status: null,
                  currency: serviceCurrency || "GBP"
                };
                await apiRequest(
                  `/validation/${wsId}`,
                  "PATCH",
                  {
                    data: {
                      validation_history: [
                        {
                          id: validationId,
                          type: "service_validation",
                          title: payloadService.service_name,
                          created_at: createdAt,
                          status: "pending",
                          score: typeof result?.scores?.viability_score === "number" ? result.scores.viability_score : null,
                          summary: String(result?.outcome || "").trim() || "Service validation completed",
                          payload: payloadService,
                          result: svcResultForHistory,
                        },
                        ...nextValidationHistoryBase
                      ],
                      service_validation_history: [entry, ...nextServiceHistoryBase],
                      active_service_validation_id: validationId,
                      draft_service_idea: { ...serviceForm, ...payloadService },
                      service_market_research: (result?.market_research && Object.keys(result.market_research).length > 0) ? result.market_research : null
                    }
                  },
                  { timeoutMs: 120000 }
                );
                setSavedServiceIdeas([entry, ...nextServiceHistoryBase]);
                setValidationHistory(
                  buildUnifiedValidationHistory({
                    validation_history: [
                      {
                        id: validationId,
                        type: "service_validation",
                        title: payloadService.service_name,
                        created_at: createdAt,
                        status: "pending",
                        score: typeof result?.scores?.viability_score === "number" ? result.scores.viability_score : null,
                        summary: String(result?.outcome || "").trim() || "Service validation completed",
                        payload: payloadService,
                        result,
                      },
                      ...nextValidationHistoryBase
                    ],
                    service_validation_history: [entry, ...nextServiceHistoryBase],
                  })
                );
                setEditingHistoryEntry(null);
              } catch (e) {
                console.warn("Failed to persist service validation history:", e);
              }
            }
            setLastEvaluationId(validationId);
            setSavedNotice("Validation complete. Redirecting to report...");
            if (marketResearch) setShowBuilderMarketInsight(true);

            // Redirect to results page after a short delay for the "Complete" feeling
            setTimeout(() => {
              navigate("/results");
            }, 800);
          } catch (payloadErr) {
            const msg = humanizeValidationError(payloadErr);
            console.error("Service validation payload error:", payloadErr);
            setError(msg);
            setIsLoading(false);
            return;
          }
        } else {
          const result = await apiRequest(
            "/validation/evaluate",
            "POST",
            { idea_validation: payload },
            { timeoutMs: 300000 }
          );
          setValidation(result);
          let validationId = null;
          if (wsId) {
            const isEditingBusinessHistory = editingHistoryEntry?.type === "business_validation";
            validationId = isEditingBusinessHistory ? editingHistoryEntry.id : crypto.randomUUID();
            const createdAt = isEditingBusinessHistory
              ? editingHistoryEntry.created_at || new Date().toISOString()
              : new Date().toISOString();
            try {
              const ws = await apiRequest(`/validation/${wsId}`, "GET", undefined, { timeoutMs: 90000 });
              const existing = Array.isArray(ws?.data?.validation_history) ? ws.data.validation_history : [];
              const nextHistoryBase = existing.filter((item) => item?.id !== validationId);
              const businessTitle = String(
                payload?.context?.business_offering ||
                payload?.context?.description ||
                payload?.context?.business_name ||
                "Business validation"
              );
              const { research_data: _brd, ...bizResultForHistory } = result || {};
              const nextEntry = {
                id: validationId,
                type: "business_validation",
                title: businessTitle.length > 100 ? businessTitle.substring(0, 97) + "..." : businessTitle,
                created_at: createdAt,
                status: "pending",
                score: typeof result?.score === "number" ? result.score : null,
                summary: String(result?.classification || result?.outcome || "Business validation completed"),
                payload,
                result: bizResultForHistory,
              };
              await apiRequest(`/validation/${wsId}`, "PATCH", {
                data: {
                  validation_history: [nextEntry, ...nextHistoryBase],
                  active_validation_id: validationId,
                }
              }, { timeoutMs: 120000 });
              setValidationHistory(
                buildUnifiedValidationHistory({
                  validation_history: [nextEntry, ...nextHistoryBase],
                  service_validation_history: Array.isArray(ws?.data?.service_validation_history) ? ws.data.service_validation_history : [],
                })
              );
              setEditingHistoryEntry(null);
            } catch (historyErr) {
              console.warn("Failed to persist validation history:", historyErr);
            }
          }
          setLastEvaluationId(validationId);
          setSavedNotice("Validation complete. Redirecting to report...");
          if (marketResearch) setShowBuilderMarketInsight(true);

          // Redirect to results page after a short delay for the "Complete" feeling
          setTimeout(() => {
            navigate("/results");
          }, 800);
        }
      } else {
        setValidation(null);
        setSavedNotice("Workspace saved.");
        if (fromOtherModule) {
          if (returnTo) {
            navigate(returnTo, { replace: true });
          } else {
            navigate("/dashboard", { replace: true });
          }
        }
      }
    } catch (e) {
      const msg = humanizeValidationError(e);
      console.error("Validation run failed:", e);
      setError(msg);
    } finally {
      setIsLoading(false);
      setIsValidating(false);
      if (shouldEvaluate) window.dispatchEvent(new CustomEvent("ea:credits:refresh"));
    }
  }

  async function runMarketResearch(options = {}) {
    const {
      useCurrentForm = false,
      markStageOneReady = false,
      showInBuilder = false,
      researchSource = isProductPath ? "service" : "business",
      forceRefresh = false,
    } = options;
    if (showInBuilder) {
      setShowBuilderMarketInsight(true);
      setContentTab("builder");
    }

    const payload = researchSource === "service" ? buildServiceIdeaPayloadForResearch() : buildBusinessIdeaPayloadForResearch();
    const currentHash = JSON.stringify(payload);
    const storedHash = researchSource === "service" ? serviceResearchHash : businessResearchHash;
    const cachedResearch = researchSource === "service" ? serviceMarketResearch : businessMarketResearch;

    // Return cached insights if form hasn't changed since last generation
    if (!forceRefresh && cachedResearch && storedHash === currentHash) {
      if (markStageOneReady) setStageOneResearchReady(true);
      return;
    }

    setMrLoading(true);
    setMrError(null);
    setError(null);
    try {
      const wsId = editingWorkspaceId || storedWorkspaceId;
      const body = wsId
        ? { workspace_id: wsId, idea_validation: payload }
        : { idea_validation: payload };
      const result = await apiRequest("/validation/market-research", "POST", body, { timeoutMs: 210000 });
      if (researchSource === "service") {
        setServiceMarketResearch(result);
        setServiceResearchHash(currentHash);
      } else {
        setBusinessMarketResearch(result);
        setBusinessResearchHash(currentHash);
      }
      if (markStageOneReady) setStageOneResearchReady(true);
      // Persist insights to workspace so they survive page refreshes
      try {
        const dataKey = researchSource === "service" ? "service_market_research" : "market_research";
        await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", { data: { [dataKey]: result } });
      } catch {
        // non-critical — insights are already in state
      }
    } catch (e) {
      setMrError(e instanceof Error ? e.message : "Market research failed. Please try again.");
      if (markStageOneReady) setStageOneResearchReady(false);
    } finally {
      setMrLoading(false);
    }
  }

  return (
    <div className=" EA_Wizard_Root min-h-screen bg-slate-50 dark:bg-slate-950 font-inter">
      <ValidationLoadingOverlay isVisible={isValidating} />
      <div className="EA_Wizard_Container max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18h6" />
                <path d="M10 22h4" />
                <path d="M12 2a7 7 0 0 0-4 12c.6.5 1 1.2 1.1 2h5.8c.1-.8.5-1.5 1.1-2A7 7 0 0 0 12 2Z" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-semibold tracking-tight text-slate-900">
                {fromOtherModule ? ((storedWorkspaceId || editingWorkspaceId) ? "Edit workspace" : "Create Workspace") : "Idea Validation"}
              </div>
              <div className="mt-1 text-sm text-slate-600 [@media(max-height:820px)]:hidden">
                {fromOtherModule
                  ? ((storedWorkspaceId || editingWorkspaceId) ? "Update your workspace profile and settings." : "Tell us about your workspace so we can set things up.")
                  : "Choose what to fill first, then generate a deterministic report."}
              </div>
            </div>
          </div>

          {!isCreateWorkspace ? (
            <div className="flex items-center gap-2">
              {mode === "fill" ? (
                <button
                  type="button"
                  onClick={() => { clearV4Draft(); setV4Form({}); setMode("v4"); setV4Step(0); setV4Journey(null); }}
                  className="group flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 transition-all hover:bg-slate-50 hover:text-brand-600"
                >
                  <svg className="h-4 w-4 transition-transform group-hover:-translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M19 12H5m7 7l-7-7 7-7" />
                  </svg>
                  Back to pathways
                </button>
              ) : (
                <div className="w-[240px] max-w-full">
                  <SegmentedTabs
                    ariaLabel="Validation content tabs"
                    value={contentTab}
                    onChange={setContentTab}
                    size="sm"
                    options={[
                      { value: "builder", label: "Builder" },
                      { value: "history", label: "History" }
                    ]}
                  />
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="mt-6">
          {isPrefilling ? (
            <SectionCard title="Loading workspace">
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <Spinner size={16} /> Loading your saved inputs...
              </div>
            </SectionCard>
          ) : null}

          {isRejectedReedit ? (
            <div className="mb-4 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
              This validation was previously rejected. Modify the inputs and run again.
            </div>
          ) : null}

          {false && !isCreateWorkspace ? (
            <div className="space-y-4">
              <SectionCard
                title="Market research"
                subtitle="Full research report accumulated from your validation inputs."
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {(businessMarketResearch || serviceMarketResearch) ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setMrResearchTab("business")}
                        className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${mrResearchTab === "business" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                      >
                        Business idea
                      </button>
                      <button
                        onClick={() => setMrResearchTab("service")}
                        className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${mrResearchTab === "service" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                      >
                        Service / product
                      </button>
                    </div>
                  ) : <div />}
                  {tabMarketResearch ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={insightPdfLoading}
                      onClick={async () => {
                        setInsightPdfLoading(true);
                        try {
                          await generateValidationInsightPdf({
                            data: tabMarketResearch,
                            title: `${mrResearchTab === "service" ? "Service / Product" : "Business Idea"} Market Research Report`,
                            businessName: workspaceName || form?.context?.business_name || serviceForm?.service_name || "Business",
                            type: mrResearchTab,
                          });
                        } catch {
                          // silent
                        } finally {
                          setInsightPdfLoading(false);
                        }
                      }}
                    >
                      {insightPdfLoading ? <Spinner size={14} /> : (
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                        </svg>
                      )}
                      {insightPdfLoading ? "Generating..." : "Download report"}
                    </Button>
                  ) : null}
                </div>
                {mrError ? <InlineAlert kind="error" message={mrError} /> : null}
              </SectionCard>

              {mrLoading ? (
                <SectionCard title="Updating Market Research">
                  <div className="flex items-center gap-3 text-sm text-slate-600">
                    <Spinner size={20} />
                    Updating the accumulated market research... This may take up to 30 seconds.
                  </div>
                </SectionCard>
              ) : tabMarketResearch ? (
                <>
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                    <span>
                      These results are based on the information you provided and are intended to support your thinking. They should not be treated as financial, legal or professional advice. Always conduct your own research before making business decisions.
                    </span>
                  </div>

                  {tabMarketResearch.idea_validation_result || tabMarketResearch.executive_summary ? (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                      {tabMarketResearch.executive_summary ? (
                        <SectionCard title="Executive Summary" subtitle="Plain-English verdict on whether this idea is worth pursuing.">
                          <div className="text-sm leading-6 text-slate-700">{tabMarketResearch.executive_summary}</div>
                        </SectionCard>
                      ) : null}

                      {tabMarketResearch.idea_validation_result ? (
                        <SectionCard title="Idea Validation Result" subtitle="The latest combined recommendation from the research gathered so far.">
                          <div className="space-y-3 text-sm">
                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded-xl bg-slate-50 p-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overall Score</div>
                                <div className="mt-1 text-base font-semibold text-slate-900">{tabMarketResearch.idea_validation_result.overall_score || "Fair"}</div>
                              </div>
                              <div className="rounded-xl bg-slate-50 p-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended Action</div>
                                <div className="mt-1 text-base font-semibold text-slate-900">{tabMarketResearch.idea_validation_result.recommended_action || "Research more"}</div>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs">
                              {tabMarketResearch.idea_validation_result.market_demand ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Market demand: {tabMarketResearch.idea_validation_result.market_demand}</span> : null}
                              {tabMarketResearch.idea_validation_result.competition_level ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Competition: {tabMarketResearch.idea_validation_result.competition_level}</span> : null}
                              {tabMarketResearch.idea_validation_result.pricing_opportunity ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Pricing: {tabMarketResearch.idea_validation_result.pricing_opportunity}</span> : null}
                              {tabMarketResearch.idea_validation_result.execution_risk ? <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">Execution risk: {tabMarketResearch.idea_validation_result.execution_risk}</span> : null}
                            </div>
                          </div>
                        </SectionCard>
                      ) : null}
                    </div>
                  ) : null}

                  {tabMarketResearch.viability_score ? (() => {
                    const vs = tabMarketResearch.viability_score;
                    const scoreColors = {
                      "Very Strong": "bg-emerald-50 border-emerald-200 text-emerald-900",
                      "Strong": "bg-green-50 border-green-200 text-green-900",
                      "Fair": "bg-amber-50 border-amber-200 text-amber-900",
                      "Weak": "bg-rose-50 border-rose-200 text-rose-900",
                    };
                    const barColors = {
                      "Very Strong": "bg-emerald-500",
                      "Strong": "bg-green-500",
                      "Fair": "bg-amber-500",
                      "Weak": "bg-rose-500",
                    };
                    const colorClass = scoreColors[vs.label] || scoreColors["Fair"];
                    const barClass = barColors[vs.label] || barColors["Fair"];
                    return (
                      <div className={`rounded-2xl border p-5 ${colorClass}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide opacity-60">Viability Score</div>
                            <div className="mt-1 text-3xl font-bold">{vs.score ?? "-"}<span className="text-base font-semibold opacity-60">/100</span></div>
                            <div className="mt-1 text-lg font-semibold">{vs.label}</div>
                          </div>
                          <div className="max-w-sm flex-1 text-sm opacity-80">{vs.summary}</div>
                        </div>
                        <div className="mt-3 h-2 w-full rounded-full bg-black/10">
                          <div className={`h-2 rounded-full ${barClass}`} style={{ width: `${Math.min(100, vs.score ?? 0)}%` }} />
                        </div>
                      </div>
                    );
                  })() : null}

                  {tabMarketResearch.market_opportunity ? (
                    <SectionCard title="Market Opportunity">
                      <div className="mb-3 text-sm text-slate-700">{tabMarketResearch.market_opportunity.summary}</div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Market Size</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">{tabMarketResearch.market_opportunity.market_size || "-"}</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Growth Rate</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">{tabMarketResearch.market_opportunity.growth_rate || "-"}</div>
                        </div>
                        {Array.isArray(tabMarketResearch.market_opportunity.key_trends) && tabMarketResearch.market_opportunity.key_trends.length ? (
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Key Trends</div>
                            <ul className="list-disc list-inside space-y-0.5 text-xs text-slate-700">
                              {tabMarketResearch.market_opportunity.key_trends.map((t, i) => <li key={i}>{t}</li>)}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </SectionCard>
                  ) : null}

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {tabMarketResearch.target_customer ? (
                      <SectionCard title="Target Customer">
                        <div className="space-y-2 text-sm">
                          {tabMarketResearch.target_customer.profile ? <div><span className="font-semibold text-slate-700">Profile: </span>{tabMarketResearch.target_customer.profile}</div> : null}
                          {Array.isArray(tabMarketResearch.target_customer.pain_points) && tabMarketResearch.target_customer.pain_points.length ? (
                            <div>
                              <div className="font-semibold text-slate-700 mb-1">Pain Points</div>
                              <ul className="list-disc list-inside space-y-0.5 text-slate-600">
                                {tabMarketResearch.target_customer.pain_points.map((p, i) => <li key={i}>{p}</li>)}
                              </ul>
                            </div>
                          ) : null}
                          {tabMarketResearch.target_customer.buying_behaviour ? <div><span className="font-semibold text-slate-700">Buying behaviour: </span>{tabMarketResearch.target_customer.buying_behaviour}</div> : null}
                          {tabMarketResearch.target_customer.urgency ? <div><span className="font-semibold text-slate-700">Urgency: </span>{tabMarketResearch.target_customer.urgency}</div> : null}
                          {tabMarketResearch.target_customer.willingness_to_pay ? <div><span className="font-semibold text-slate-700">Willingness to pay: </span>{tabMarketResearch.target_customer.willingness_to_pay}</div> : null}
                        </div>
                      </SectionCard>
                    ) : null}

                    {tabMarketResearch.problem_validation ? (
                      <SectionCard title="Problem Validation">
                        <div className="space-y-2 text-sm">
                          {tabMarketResearch.problem_validation.frequency_assessment ? <div className="text-slate-600">{tabMarketResearch.problem_validation.frequency_assessment}</div> : null}
                          {tabMarketResearch.problem_validation.severity ? <div><span className="font-semibold text-slate-700">Severity: </span>{tabMarketResearch.problem_validation.severity}</div> : null}
                          {Array.isArray(tabMarketResearch.problem_validation.evidence) && tabMarketResearch.problem_validation.evidence.length ? (
                            <ul className="list-disc list-inside space-y-0.5 text-slate-600">
                              {tabMarketResearch.problem_validation.evidence.map((e, i) => <li key={i}>{e}</li>)}
                            </ul>
                          ) : null}
                        </div>
                      </SectionCard>
                    ) : null}
                  </div>

                  {tabMarketResearch.demand_signals ? (
                    <SectionCard title="Demand Signals">
                      {Array.isArray(tabMarketResearch.demand_signals.signals) && tabMarketResearch.demand_signals.signals.length ? (
                        <ul className="list-disc list-inside space-y-1 text-sm text-slate-600">
                          {tabMarketResearch.demand_signals.signals.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      ) : null}
                      {tabMarketResearch.demand_signals.online_discussion ? (
                        <div className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{tabMarketResearch.demand_signals.online_discussion}</div>
                      ) : null}
                    </SectionCard>
                  ) : null}

                  {Array.isArray(tabMarketResearch.competitor_matrix) && tabMarketResearch.competitor_matrix.length ? (
                    <SectionCard title="Competitor Matrix">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                              <th className="pb-2 pr-4">Competitor</th>
                              <th className="pb-2 pr-4">Positioning</th>
                              <th className="pb-2 pr-4">Strengths</th>
                              <th className="pb-2 pr-4">Weaknesses</th>
                              <th className="pb-2">Est. Price</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {tabMarketResearch.competitor_matrix.map((comp, i) => (
                              <tr key={i}>
                                <td className="py-2 pr-4 font-medium text-slate-900 align-top">{comp.name}</td>
                                <td className="py-2 pr-4 text-slate-600 align-top">{comp.positioning || "-"}</td>
                                <td className="py-2 pr-4 text-slate-600 align-top">{Array.isArray(comp.strengths) ? comp.strengths.join(", ") : comp.strengths || "-"}</td>
                                <td className="py-2 pr-4 text-slate-600 align-top">{Array.isArray(comp.weaknesses) ? comp.weaknesses.join(", ") : comp.weaknesses || "-"}</td>
                                <td className="py-2 text-slate-600 align-top">{comp.est_price || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </SectionCard>
                  ) : null}

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {tabMarketResearch.pricing_strategy ? (
                      <SectionCard title="Pricing Strategy">
                        <div className="space-y-2 text-sm">
                          {tabMarketResearch.pricing_strategy.recommended_model ? <div><span className="font-semibold text-slate-700">Recommended model: </span>{tabMarketResearch.pricing_strategy.recommended_model}</div> : null}
                          {tabMarketResearch.pricing_strategy.rationale ? <div className="text-slate-600">{tabMarketResearch.pricing_strategy.rationale}</div> : null}
                          {tabMarketResearch.pricing_strategy.launch_offer ? <div className="rounded-xl bg-brand-50 p-3 text-brand-900 text-xs font-medium">Launch offer: {tabMarketResearch.pricing_strategy.launch_offer}</div> : null}
                        </div>
                      </SectionCard>
                    ) : null}

                    {tabMarketResearch.recommended_price_range ? (
                      <SectionCard title="Recommended Price Range">
                        <div className="grid grid-cols-3 gap-2 text-center">
                          {[["low", "Entry"], ["mid", "Mid"], ["premium", "Premium"]].map(([key, label]) => (
                            <div key={key} className="rounded-xl bg-slate-50 p-3">
                              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
                              <div className="mt-1 text-sm font-bold text-slate-900">{tabMarketResearch.recommended_price_range[key] ?? "-"}</div>
                            </div>
                          ))}
                        </div>
                      </SectionCard>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {tabMarketResearch.positioning ? (
                      <SectionCard title="Positioning Recommendation">
                        <div className="space-y-2 text-sm">
                          {tabMarketResearch.positioning.headline_message ? <div className="rounded-xl bg-brand-50 p-3 text-sm font-semibold text-brand-900">&ldquo;{tabMarketResearch.positioning.headline_message}&rdquo;</div> : null}
                          {tabMarketResearch.positioning.value_proposition ? <div><span className="font-semibold text-slate-700">Value prop: </span>{tabMarketResearch.positioning.value_proposition}</div> : null}
                          {tabMarketResearch.positioning.differentiation ? <div><span className="font-semibold text-slate-700">Differentiation: </span>{tabMarketResearch.positioning.differentiation}</div> : null}
                        </div>
                      </SectionCard>
                    ) : null}

                    {tabMarketResearch.go_to_market ? (
                      <SectionCard title="Go to Market Recommendation">
                        <div className="space-y-2 text-sm">
                          {Array.isArray(tabMarketResearch.go_to_market.primary_channels) && tabMarketResearch.go_to_market.primary_channels.length ? (
                            <div><span className="font-semibold text-slate-700">Primary channels: </span>{tabMarketResearch.go_to_market.primary_channels.join(", ")}</div>
                          ) : null}
                          {tabMarketResearch.go_to_market.timeline ? <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{tabMarketResearch.go_to_market.timeline}</div> : null}
                        </div>
                      </SectionCard>
                    ) : null}
                  </div>

                  {Array.isArray(tabMarketResearch.risks) && tabMarketResearch.risks.length ? (
                    <SectionCard title="Risks &amp; Barriers">
                      <div className="space-y-2">
                        {tabMarketResearch.risks.map((r, i) => (
                          <div key={i} className="rounded-xl border border-slate-100 bg-white p-3 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-slate-900">{r.risk}</span>
                              {r.severity ? <span className="rounded-full px-2 py-0.5 text-xs font-semibold ring-1 bg-slate-100 text-slate-600 ring-slate-200">{r.severity}</span> : null}
                            </div>
                            {r.mitigation ? <div className="mt-1 text-slate-600">{r.mitigation}</div> : null}
                          </div>
                        ))}
                      </div>
                    </SectionCard>
                  ) : null}

                  {Array.isArray(tabMarketResearch.next_actions) && tabMarketResearch.next_actions.length ? (
                    <SectionCard title="Next Best Actions">
                      <div className="space-y-3">
                        {tabMarketResearch.next_actions.map((action, i) => (
                          <div key={i} className="flex gap-3">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                              {action.step ?? i + 1}
                            </div>
                            <div className="flex-1 text-sm">
                              <div className="font-semibold text-slate-900">{action.action}</div>
                              {action.why ? <div className="mt-0.5 text-slate-600">{action.why}</div> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </SectionCard>
                  ) : null}
                </>
              ) : (
                <SectionCard title="No Research Yet">
                  <div className="text-sm text-slate-600">
                    {mrResearchTab === "service"
                      ? "Complete a stage in the product/service builder to generate research here."
                      : "Complete a stage in the business idea builder to generate research here."}
                  </div>
                </SectionCard>
              )}
            </div>
          ) : contentTab === "history" && !isCreateWorkspace ? (
            <SectionCard
              title="Validation history"
              subtitle="Track previous validations and their current status."
            >
              <div className="space-y-4">
                {/* Stat filter cards */}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    { key: "all", label: "All" },
                    { key: "pending", label: "Pending" },
                    { key: "accepted", label: "Accepted" },
                    { key: "rejected", label: "Rejected" },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => { setHistoryFilter(item.key); setBulkSelected(new Set()); }}
                      className={
                        "rounded-2xl border p-4 text-left transition " +
                        (historyFilter === item.key
                          ? "border-brand-300 bg-brand-50 text-brand-900"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")
                      }
                    >
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</div>
                      <div className="mt-2 text-2xl font-semibold">{historyCounts[item.key]}</div>
                    </button>
                  ))}
                </div>

                {/* Search + type filter */}
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="Search by name..."
                    value={historySearch}
                    onChange={(e) => { setHistorySearch(e.target.value); setBulkSelected(new Set()); }}
                    className="flex-1 min-w-[160px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                  <select
                    value={historyTypeFilter}
                    onChange={(e) => { setHistoryTypeFilter(e.target.value); setBulkSelected(new Set()); }}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  >
                    <option value="all">All types</option>
                    <option value="business">Business</option>
                    <option value="service">Service</option>
                  </select>
                </div>

                {/* Bulk action bar */}
                {bulkSelected.size > 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={bulkSelected.size === filteredValidationHistory.length && filteredValidationHistory.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setBulkSelected(new Set(filteredValidationHistory.map((h) => h.id)));
                          } else {
                            setBulkSelected(new Set());
                          }
                        }}
                        className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                      />
                      <span className="text-sm font-semibold text-brand-800">
                        {bulkSelected.size} selected
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setBulkSelected(new Set())}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="border-rose-300 text-rose-600 hover:bg-rose-50"
                        onClick={() => bulkDeleteEntries(bulkSelected)}
                      >
                        Delete selected
                      </Button>
                    </div>
                  </div>
                ) : filteredValidationHistory.length > 0 ? (
                  <div className="flex items-center gap-2 px-1">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={(e) => {
                        if (e.target.checked) setBulkSelected(new Set(filteredValidationHistory.map((h) => h.id)));
                      }}
                      className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                    />
                    <span className="text-xs text-slate-400">Select all</span>
                  </div>
                ) : null}

                {/* History list */}
                <div className="space-y-3">
                  {filteredValidationHistory.length ? (
                    pagedHistory.map((entry) => {
                      const badgeClass =
                        entry.status === "accepted"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : entry.status === "rejected"
                            ? "bg-rose-50 text-rose-700 ring-rose-200"
                            : "bg-amber-50 text-amber-700 ring-amber-200";
                      const isChecked = bulkSelected.has(entry.id);
                      const hasOutput = Boolean(entry.result);
                      return (
                        <div
                          key={entry.id}
                          onClick={() => editHistoryEntry(entry)}
                          className={`flex w-full cursor-pointer flex-wrap items-start justify-between gap-3 rounded-2xl border bg-white p-4 shadow-sm text-left transition hover:border-brand-300 hover:shadow-md ${isChecked ? "border-brand-300 bg-brand-50/40" : "border-slate-200"}`}
                        >
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <div onClick={(e) => e.stopPropagation()} className="mt-0.5 shrink-0">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  const next = new Set(bulkSelected);
                                  if (e.target.checked) next.add(entry.id); else next.delete(entry.id);
                                  setBulkSelected(next);
                                }}
                                className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-semibold text-slate-900">{entry.title}</div>
                                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ${badgeClass}`}>
                                  {String(entry.status || "pending").toUpperCase()}
                                </span>
                                {entry.type === "v4_validation" ? (
                                  <>
                                    <span className="rounded-full bg-violet-100 px-2 py-1 text-[11px] font-semibold text-violet-700">V4</span>
                                    {entry.journey && (
                                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500 capitalize">{entry.journey}</span>
                                    )}
                                  </>
                                ) : (
                                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">
                                    {entry.type === "service_validation" ? "Service" : "Business"}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {new Date(entry.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <ResumeButton entry={entry} onEdit={editHistoryEntry} />
                            <Button variant="ghost" onClick={() => deleteHistoryEntry(entry.id)}>
                              Delete
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                      {validationHistory.length
                        ? "No items match this filter."
                        : "No validation history yet. Run a validation and it will appear here."}
                    </div>
                  )}
                </div>

                {/* Pagination */}
                {historyTotalPages > 1 ? (
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <span className="text-xs text-slate-500">
                      Page {historyPage} of {historyTotalPages} · {filteredValidationHistory.length} items
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={historyPage === 1}
                        onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>
                      {Array.from({ length: historyTotalPages }, (_, i) => i + 1).filter((p) => p === 1 || p === historyTotalPages || Math.abs(p - historyPage) <= 1).reduce((acc, p, idx, arr) => {
                        if (idx > 0 && p - arr[idx - 1] > 1) acc.push("…");
                        acc.push(p);
                        return acc;
                      }, []).map((p, i) =>
                        p === "…" ? (
                          <span key={`ellipsis-${i}`} className="px-1 text-xs text-slate-400">…</span>
                        ) : (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setHistoryPage(p)}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${p === historyPage ? "border-brand-500 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                          >
                            {p}
                          </button>
                        )
                      )}
                      <button
                        type="button"
                        disabled={historyPage === historyTotalPages}
                        onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}

              </div>
            </SectionCard>
          ) : mode === "v4" ? (
            <div className="space-y-6">
              <ValidationLoadingOverlay isVisible={isValidating} />

              {v4Error && <div ref={v4ErrorRef} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{v4Error}</div>}
              {savedNotice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{savedNotice}</div>}

              {/* V4 wizard body */}
              {v4Step === 0 ? (
                (isPrefilling || Boolean(requestedHistoryId)) ? (
                  /* Show a spinner instead of the journey chooser while a saved
                     validation is being loaded. requestedHistoryId comes from
                     useSearchParams() so it's reactive to URL changes even when
                     the component doesn't remount (same-route navigation). */
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
                    <p className="text-sm text-slate-500">Loading your saved validation...</p>
                  </div>
                ) : (
                /* Journey selection */
                <>
                <div className="space-y-4">
                  {_v4Draft?.step > 0 && _v4Draft?.journey && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <svg className="h-4 w-4 shrink-0 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>
                        <span className="text-sm font-medium text-brand-800">
                          You have a <span className="font-bold capitalize">{_v4Draft.journey}</span> draft in progress · Step {_v4Draft.step}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 transition"
                        onClick={() => { setV4Journey(_v4Draft.journey); setV4Step(_v4Draft.step); }}
                      >
                        Resume
                      </button>
                    </div>
                  )}
                  <div className="rounded-2xl border border-slate-200 bg-white p-6">
                    <h2 className="text-xl font-bold text-slate-900">How deeply would you like to validate your idea?</h2>
                    <p className="mt-1 text-sm text-slate-500">Choose a journey. You can upgrade from Basic to Comprehensive at any time without re-entering data.</p>
                    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => { setV4Journey("basic"); setV4Step(1); }}
                        className="flex flex-col gap-3 rounded-2xl border-2 border-slate-200 bg-white p-6 text-left transition-all hover:border-brand-400 hover:shadow-md"
                      >
                        <div className="flex items-center gap-2">
                          <svg className="h-6 w-6 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" /></svg>
                          <span className="text-lg font-bold text-slate-900">Basic Validation</span>
                          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-600">2–3 min</span>
                        </div>
                        <p className="text-sm text-slate-600">A quick preliminary snapshot covering your idea and the core problem it solves. Ideal for early-stage ideas.</p>
                        <ul className="mt-1 space-y-1">
                          {["Idea & Concept", "Problem Definition & Impact"].map((l) => (
                            <li key={l} className="flex items-center gap-2 text-xs text-slate-500">
                              <svg className="h-3.5 w-3.5 text-brand-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                              {l}
                            </li>
                          ))}
                        </ul>
                      </button>
                      <button
                        type="button"
                        onClick={() => canAccessComprehensive ? (setV4Journey("comprehensive"), setV4Step(1)) : navigate("/pricing")}
                        className="flex flex-col gap-3 rounded-2xl border-2 border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50 p-6 text-left transition-all hover:border-violet-500 hover:shadow-md relative"
                      >
                        {!canAccessComprehensive && (
                          <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                            Paid plan
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <svg className="h-6 w-6 text-violet-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" /></svg>
                          <span className="text-lg font-bold text-violet-900">Comprehensive</span>
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">3–5 min</span>
                        </div>
                        <p className="text-sm text-violet-800">A full assessment covering all dimensions: customer, solution, market, competition, pricing, unit economics, operations, founder readiness and regulatory risk.</p>
                        <ul className="mt-1 space-y-1">
                          {["Everything in Basic", "Customer & Solution", "Market & Competition", "Pricing & Revenue Model", "Unit Economics", "Founder & Operational Readiness", "Regulatory Risk"].map((l) => (
                            <li key={l} className="flex items-center gap-2 text-xs text-violet-700">
                              <svg className="h-3.5 w-3.5 text-violet-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                              {l}
                            </li>
                          ))}
                        </ul>
                      </button>
                    </div>
                  </div>
                </div>

                {!fromOtherModule && (
                  <div className="mt-8">
                    <SectionCard
                      title="Validation history"
                      subtitle="Resume or view your previous analysis items."
                      badge={validationHistory.length ? String(validationHistory.length) : null}
                      headerRight={validationHistory.length > 5 ? (
                        <button
                          type="button"
                          onClick={() => setContentTab("history")}
                          className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                        >
                          View all
                        </button>
                      ) : null}
                    >
                      <div className="space-y-3">
                        {filteredValidationHistory.length ? (
                          filteredValidationHistory.slice(0, 5).map((entry) => {
                            const badgeClass =
                              entry.status === "accepted"
                                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                : entry.status === "rejected"
                                  ? "bg-rose-50 text-rose-700 ring-rose-200"
                                  : "bg-amber-50 text-amber-700 ring-amber-200";
                            return (
                              <div
                                key={entry.id}
                                onClick={() => editHistoryEntry(entry)}
                                className="flex w-full cursor-pointer flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-left transition hover:border-brand-300 hover:shadow-md"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-semibold text-slate-900">{entry.title}</div>
                                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ${badgeClass}`}>
                                      {String(entry.status || "pending").toUpperCase()}
                                    </span>
                                    {entry.type === "v4_validation" ? (
                                      <>
                                        <span className="rounded-full bg-violet-100 px-2 py-1 text-[11px] font-semibold text-violet-700">V4</span>
                                        {entry.journey && (
                                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500 capitalize">{entry.journey}</span>
                                        )}
                                      </>
                                    ) : (
                                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">
                                        {entry.type === "service_validation" ? "Service" : "Business"}
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    {new Date(entry.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  <Button size="sm" variant="secondary" onClick={() => editHistoryEntry(entry)}>
                                    {entry.status === "accepted" || entry.status === "rejected" ? "View" : "Resume"}
                                  </Button>
                                  <Button variant="ghost" onClick={() => deleteHistoryEntry(entry.id)}>
                                    Delete
                                  </Button>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                            {validationHistory.length
                              ? "No items match this filter."
                              : "No validation history yet. Run a validation and it will appear here."}
                          </div>
                        )}
                      </div>
                    </SectionCard>
                  </div>
                )}
                </>
              )
              ) : (() => {
                const steps = getV4Steps();
                const stepIdx = steps.indexOf(v4Step);
                const totalSteps = steps.length;
                const isLast = stepIdx === totalSteps - 1;
                const isFirst = stepIdx === 0;
                const progressPct = totalSteps > 1 ? Math.round((stepIdx / (totalSteps - 1)) * 100) : 0;

                function validateStep(step) {
                  if (step === 1) {
                    if (!String(getV4(1, "idea_name")).trim()) return "Please enter an Idea name before continuing.";
                    if (!String(getV4(1, "idea_type")).trim()) return "Please select an Idea type before continuing.";
                  }
                  if (step === 2) {
                    if (!String(getV4(2, "problem_description")).trim()) return "Please describe the problem being solved before continuing.";
                    if (v4Journey === "basic" && !String(getV4(2, "proposed_solution")).trim()) return "Please describe your proposed solution before continuing.";
                  }
                  if (step === 3 && !String(getV4(3, "primary_segment")).trim()) return "Please enter your primary customer segment before continuing.";
                  if (step === 5 && !String(getV4(5, "solution_description")).trim()) return "Please enter a solution description before continuing.";
                  return null;
                }
                function goNext() {
                  const err = validateStep(v4Step);
                  if (err) { setV4Error(err); return; }
                  setV4Error(null);
                  markV4StepComplete(v4Step);
                  if (!isLast) setV4Step(steps[stepIdx + 1]);
                }
                function goBack() {
                  setV4Error(null);
                  if (!isFirst) setV4Step(steps[stepIdx - 1]);
                  else { setV4Step(0); }
                }

                const v4IdeaNameError = v4Step === 1 && v4Error && /idea name/i.test(v4Error) ? v4Error : "";
                const v4IdeaTypeError = v4Step === 1 && v4Error && /idea type/i.test(v4Error) ? v4Error : "";

                return (
                  <div className="space-y-4">
                    {/* Progress bar */}
                    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-500">Step {stepIdx + 1} of {totalSteps}</span>
                        <span className="text-xs font-semibold text-brand-600">{V4_STEP_TITLES[v4Step]}</span>
                        {v4Journey === "basic" ? (
                          <button type="button" onClick={() => canAccessComprehensive ? (setV4Journey("comprehensive"), setV4Step(v4Step)) : navigate("/pricing")} className="text-xs font-semibold text-violet-600 hover:text-violet-700">
                            {canAccessComprehensive ? "Switch to Comprehensive" : "🔒 Comprehensive (Paid)"}
                          </button>
                        ) : <span className="text-xs font-semibold text-violet-600">Comprehensive</span>}
                      </div>
                      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-brand-600 transition-all duration-300" style={{ width: `${progressPct}%` }} />
                      </div>
                      <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
                        {steps.map((s, i) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => {
                              setV4Error(null);
                              if (s > v4Step) {
                                // Validate every step between current and target; stop at first failure
                                const targetIdx = steps.indexOf(s);
                                for (let si = stepIdx; si < targetIdx; si++) {
                                  const err = validateStep(steps[si]);
                                  if (err) { setV4Step(steps[si]); setV4Error(err); return; }
                                  markV4StepComplete(steps[si]);
                                }
                              }
                              setV4Step(s);
                            }}
                            title={V4_STEP_TITLES[s]}
                            className={`flex-shrink-0 h-2 rounded-full transition-all ${s === v4Step ? "w-6 bg-brand-600" : i < stepIdx ? "w-2 bg-brand-300" : "w-2 bg-slate-200"}`}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Step content card */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-6">
                      <div className="mb-6">
                        <h3 className="text-xl font-bold text-slate-900">Step {stepIdx + 1}: {V4_STEP_TITLES[v4Step]}</h3>
                      </div>

                      {/* ---- STEP 1: IDEA IDENTITY ---- */}
                      {v4Step === 1 && (
                        <div className="space-y-5">
                          <div>
                            <FieldLabel>Idea name <span className="text-rose-500">*</span></FieldLabel>
                            <Input
                              value={getV4(1,"idea_name")}
                              onChange={(e) => setV4Field(1,"idea_name",e.target.value)}
                              placeholder="e.g. Real-Time Local Social Connection Platform"
                              aria-invalid={Boolean(v4IdeaNameError)}
                              className={v4IdeaNameError ? "border-rose-300 focus:border-rose-400 focus:ring-rose-200" : ""}
                            />
                            {v4IdeaNameError ? <div className="mt-1 text-xs font-medium text-rose-600">{v4IdeaNameError}</div> : null}
                          </div>
                          <div>
                            <FieldLabel info="One sentence only — summarise the idea as if explaining it to a stranger.">One-sentence description</FieldLabel>
                            <Input value={getV4(1,"idea_tagline")} onChange={(e) => setV4Field(1,"idea_tagline",e.target.value)} placeholder="e.g. A platform connecting local freelancers with SMEs needing short-term help" />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel info="A full description of what you're building and why.">Full idea description</FieldLabel>
                              {v4SuggestBtn(1,"idea_description",{field:"v4_idea_description"})}
                            </div>
                            <textarea rows={3} className="ea-input w-full resize-none" value={getV4(1,"idea_description")} onChange={(e) => setV4Field(1,"idea_description",e.target.value)} placeholder="Describe your idea in detail..." />
                          </div>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <FieldLabel>Idea type <span className="text-rose-500">*</span></FieldLabel>
                              <select
                                className={"ea-input w-full " + (v4IdeaTypeError ? "border-rose-300 focus:border-rose-400 focus:ring-rose-200" : "")}
                                value={getV4(1,"idea_type")}
                                onChange={(e) => setV4Field(1,"idea_type",e.target.value)}
                                aria-invalid={Boolean(v4IdeaTypeError)}
                              >
                                <option value="">Select type...</option>
                                {V4_IDEA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                              {v4IdeaTypeError ? <div className="mt-1 text-xs font-medium text-rose-600">{v4IdeaTypeError}</div> : null}
                            </div>
                            <div>
                              <FieldLabel>Sector</FieldLabel>
                              {(() => {
                                const sectorVal = getV4(1,"idea_sector") || "";
                                const isCustom = sectorVal !== "" && !SECTOR_OPTIONS.includes(sectorVal);
                                const dropdownVal = isCustom ? "Other" : sectorVal;
                                return (
                                  <>
                                    <select className="ea-input w-full" value={dropdownVal} onChange={(e) => setV4Field(1,"idea_sector", e.target.value === "Other" ? "__other__" : e.target.value)}>
                                      <option value="">Select sector...</option>
                                      {SECTOR_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                    {(isCustom || sectorVal === "__other__") && (
                                      <div className="mt-2 flex items-center gap-2 rounded-xl border border-brand-300 bg-brand-50/40 px-3 py-2.5 ring-1 ring-brand-200 focus-within:border-brand-400 focus-within:ring-brand-300 transition-all">
                                        <svg className="h-3.5 w-3.5 shrink-0 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                        </svg>
                                        <input
                                          autoFocus
                                          className="flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 outline-none"
                                          value={sectorVal === "__other__" ? "" : sectorVal}
                                          onChange={(e) => setV4Field(1,"idea_sector",e.target.value)}
                                          placeholder="e.g. AgriFintech, Sports Nutrition, Urban Mobility…"
                                        />
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                            <div>
                              <FieldLabel>Business stage</FieldLabel>
                              <select className="ea-input w-full" value={getV4(1,"business_stage")} onChange={(e) => setV4Field(1,"business_stage",e.target.value)}>
                                <option value="">Select stage...</option>
                                {V4_BUSINESS_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            <div>
                              <FieldLabel>Customer model</FieldLabel>
                              <select className="ea-input w-full" value={getV4(1,"customer_model")} onChange={(e) => setV4Field(1,"customer_model",e.target.value)}>
                                <option value="">Select model...</option>
                                {V4_CUSTOMER_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </div>
                            <div>
                              <FieldLabel>Currency</FieldLabel>
                              <select className="ea-input w-full" value={getV4(1,"currency","GBP")} onChange={(e) => setV4Field(1,"currency",e.target.value)}>
                                {["GBP","USD","EUR","NGN","GHS","KES","ZAR","CAD","AUD","INR"].map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </div>
                            <div>
                              <FieldLabel>Operating country</FieldLabel>
                              <select className="ea-input w-full" value={getV4(1,"operating_country")} onChange={(e) => { const c = e.target.value; setV4Field(1,"operating_country",c); setV4Field(1,"launch_geography",""); setV4Field(1,"future_geography",""); if (COUNTRY_CURRENCY_MAP[c]) setV4Field(1,"currency",COUNTRY_CURRENCY_MAP[c]); }}>
                                <option value="">Select country...</option>
                                {COUNTRY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </div>
                            <div>
                              <FieldLabel>Launch geography</FieldLabel>
                              {(() => {
                                const country = getV4(1,"operating_country");
                                if (!country || !CITIES_BY_COUNTRY[country]) {
                                  return <Input value={getV4(1,"launch_geography")} onChange={(e) => setV4Field(1,"launch_geography",e.target.value)} placeholder={country ? "Enter city..." : "Select country first..."} disabled={!country} />;
                                }
                                return (
                                  <select className="ea-input w-full" value={getV4(1,"launch_geography")} onChange={(e) => setV4Field(1,"launch_geography",e.target.value)}>
                                    <option value="">Select city...</option>
                                    {CITIES_BY_COUNTRY[country].map((c) => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                );
                              })()}
                            </div>
                            <div>
                              <FieldLabel>Future target geography</FieldLabel>
                              {(() => {
                                const country = getV4(1,"operating_country");
                                if (!country || !CITIES_BY_COUNTRY[country]) {
                                  return <Input value={getV4(1,"future_geography")} onChange={(e) => setV4Field(1,"future_geography",e.target.value)} placeholder={country ? "Enter city or region..." : "Select country first..."} disabled={!country} />;
                                }
                                return (
                                  <select className="ea-input w-full" value={getV4(1,"future_geography")} onChange={(e) => setV4Field(1,"future_geography",e.target.value)}>
                                    <option value="">Select city...</option>
                                    {CITIES_BY_COUNTRY[country].map((c) => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ---- STEP 2: PROBLEM ---- */}
                      {v4Step === 2 && (
                        <div className="space-y-5">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel>What problem is being solved? <span className="text-rose-500">*</span></FieldLabel>
                              {v4SuggestBtn(2,"problem_description",{field:"problem"})}
                            </div>
                            <textarea rows={3} className="ea-input w-full resize-none" value={getV4(2,"problem_description")} onChange={(e) => setV4Field(2,"problem_description",e.target.value)} placeholder="Describe the problem clearly..." />
                          </div>
                          {v4Journey === "basic" && (
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <FieldLabel info="Briefly describe your proposed approach or product/service idea that addresses this problem.">What is your proposed solution? <span className="text-rose-500">*</span></FieldLabel>
                                {v4SuggestBtn(2,"proposed_solution",{field:"solution", problem: getV4(2,"problem_description")})}
                              </div>
                              <textarea rows={3} className="ea-input w-full resize-none" value={getV4(2,"proposed_solution")} onChange={(e) => { setV4Field(2,"proposed_solution",e.target.value); setV4Field(5,"solution_description",e.target.value); }} placeholder="Describe your proposed solution or product idea..." />
                            </div>
                          )}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel>What triggers the problem?</FieldLabel>
                              {v4SuggestBtn(2,"problem_trigger",{field:"v4_problem_trigger", problem: getV4(2,"problem_description"), who_affected: getV4(2,"who_affected")})}
                            </div>
                            <Input value={getV4(2,"problem_trigger")} onChange={(e) => setV4Field(2,"problem_trigger",e.target.value)} placeholder="e.g. Month-end reporting, hiring a new employee, a compliance deadline..." />
                          </div>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <FieldLabel>Pain severity</FieldLabel>
                              <select className="ea-input w-full" value={getV4(2,"pain_severity")} onChange={(e) => setV4Field(2,"pain_severity",e.target.value)}>
                                <option value="">Select...</option>
                                {V4_PAIN_SEVERITIES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                              </select>
                            </div>
                            <div>
                              <FieldLabel>Problem frequency</FieldLabel>
                              <select className="ea-input w-full" value={getV4(2,"problem_frequency")} onChange={(e) => setV4Field(2,"problem_frequency",e.target.value)}>
                                <option value="">Select...</option>
                                {V4_FREQUENCIES.map((f) => <option key={f} value={f}>{f.charAt(0).toUpperCase()+f.slice(1)}</option>)}
                              </select>
                            </div>
                            <div>
                              <FieldLabel>Urgency</FieldLabel>
                              <select className="ea-input w-full" value={getV4(2,"urgency")} onChange={(e) => setV4Field(2,"urgency",e.target.value)}>
                                <option value="">Select...</option>
                                {V4_URGENCIES.map((u) => <option key={u} value={u}>{u.charAt(0).toUpperCase()+u.slice(1)}</option>)}
                              </select>
                            </div>
                            <div>
                              <FieldLabel>Is the problem growing?</FieldLabel>
                              <select className="ea-input w-full" value={getV4(2,"problem_trend")} onChange={(e) => setV4Field(2,"problem_trend",e.target.value)}>
                                <option value="">Select...</option>
                                {V4_TRENDS.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
                              </select>
                            </div>
                            <div>
                              <FieldLabel info="Does the buyer (who pays) or the end user (who uses it) experience this problem?">Problem experienced by</FieldLabel>
                              <select className="ea-input w-full" value={getV4(2,"problem_affects")} onChange={(e) => setV4Field(2,"problem_affects",e.target.value)}>
                                <option value="">Select...</option>
                                {V4_PROBLEM_AFFECTS.map((o) => <option key={o} value={o}>{o}</option>)}
                              </select>
                            </div>
                            <div>
                              <FieldLabel>Does the problem have a financial impact?</FieldLabel>
                              <label className="mt-2 flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                                <input type="checkbox" checked={getV4(2,"financial_impact_known",false)} onChange={(e) => setV4Field(2,"financial_impact_known",e.target.checked)} className="accent-brand-600 h-4 w-4 rounded" />
                                Yes, financial cost is known
                              </label>
                            </div>
                          </div>
                          {getV4(2,"financial_impact_known",false) && (
                            <Input value={getV4(2,"financial_impact_description")} onChange={(e) => setV4Field(2,"financial_impact_description",e.target.value)} placeholder="e.g. £2,000/month in lost productivity..." />
                          )}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel>What happens if the customer does nothing?</FieldLabel>
                              {v4SuggestBtn(2,"if_nothing",{field:"v4_if_nothing", problem: getV4(2,"problem_description"), who_affected: getV4(2,"who_affected"), pain_severity: getV4(2,"pain_severity")})}
                            </div>
                            <Input value={getV4(2,"if_nothing")} onChange={(e) => setV4Field(2,"if_nothing",e.target.value)} placeholder="e.g. Continued lost revenue, regulatory fine, employee churn..." />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel>Evidence the problem exists</FieldLabel>
                              {v4SuggestBtn(2,"evidence_problem_exists",{field:"v4_evidence_problem"})}
                            </div>
                            <textarea rows={2} className="ea-input w-full resize-none" value={getV4(2,"evidence_problem_exists")} onChange={(e) => setV4Field(2,"evidence_problem_exists",e.target.value)} placeholder="e.g. 15 customer interviews, industry report, personal experience..." />
                          </div>
                        </div>
                      )}

                      {/* ---- STEP 3: CUSTOMER ---- */}
                      {v4Step === 3 && (
                        <div className="space-y-5">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel>Primary customer segment <span className="text-rose-500">*</span></FieldLabel>
                              {v4SuggestBtn(3,"primary_segment",{field:"v4_primary_segment"})}
                            </div>
                            <Input value={getV4(3,"primary_segment")} onChange={(e) => setV4Field(3,"primary_segment",e.target.value)} placeholder="e.g. Solo founder aged 25–40 in UK tech" />
                          </div>
                          <div>
                            <FieldLabel info="A second distinct group you could serve — beyond your primary segment.">Secondary customer segment</FieldLabel>
                            <Input value={getV4(3,"secondary_segment")} onChange={(e) => setV4Field(3,"secondary_segment",e.target.value)} placeholder="e.g. Scale-up operations teams..." />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel info="The narrowest initial niche you will target first.">Beachhead / initial niche segment</FieldLabel>
                              {v4SuggestBtn(3,"beachhead_segment",{field:"v4_beachhead"})}
                            </div>
                            <Input value={getV4(3,"beachhead_segment")} onChange={(e) => setV4Field(3,"beachhead_segment",e.target.value)} placeholder="e.g. B2B SaaS founders in London with 1–5 employees" />
                          </div>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <FieldLabel>Customer specificity</FieldLabel>
                              <select className="ea-input w-full" value={getV4(3,"customer_specificity")} onChange={(e) => setV4Field(3,"customer_specificity",e.target.value)}>
                                <option value="">Select...</option>
                                {V4_SPECIFICITIES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                              </select>
                            </div>
                            <div>
                              <FieldLabel>Economic buyer (who pays?)</FieldLabel>
                              <Input value={getV4(3,"economic_buyer")} onChange={(e) => setV4Field(3,"economic_buyer",e.target.value)} placeholder="e.g. HR Manager, CEO..." />
                            </div>
                            <div>
                              <FieldLabel>End user (who uses it?)</FieldLabel>
                              <Input value={getV4(3,"end_user")} onChange={(e) => setV4Field(3,"end_user",e.target.value)} placeholder="e.g. Sales team, employees..." />
                            </div>
                            <div>
                              <FieldLabel info="The person who formally approves or influences the purchase decision.">Decision maker</FieldLabel>
                              <Input value={getV4(3,"decision_maker")} onChange={(e) => setV4Field(3,"decision_maker",e.target.value)} placeholder="e.g. CFO, IT Director, Team lead..." />
                            </div>
                            <div>
                              <FieldLabel>Purchase frequency</FieldLabel>
                              <select className="ea-input w-full" value={getV4(3,"purchase_frequency")} onChange={(e) => setV4Field(3,"purchase_frequency",e.target.value)}>
                                <option value="">Select...</option>
                                {V4_PURCHASE_FREQUENCIES.map((f) => <option key={f} value={f}>{f.charAt(0).toUpperCase()+f.slice(1)}</option>)}
                              </select>
                            </div>
                          </div>
                          <div>
                            <FieldLabel info="What event or situation causes this customer to start looking for a solution?">Buying triggers</FieldLabel>
                            <Input value={getV4(3,"buying_triggers")} onChange={(e) => setV4Field(3,"buying_triggers",e.target.value)} placeholder="e.g. Reaching 10 employees, losing a key client, new regulation..." />
                          </div>
                          <div>
                            <FieldLabel>Channels to reach customer</FieldLabel>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {V4_CHANNELS.map((ch) => {
                                const selected = (getV4(3,"channels",[]) || []).includes(ch);
                                return (
                                  <button key={ch} type="button" onClick={() => toggleV4ArrayField(3,"channels",ch)} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${selected ? "border-brand-500 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-brand-300"}`}>{ch}</button>
                                );
                              })}
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel>Main customer objections</FieldLabel>
                              {v4SuggestBtn(3,"main_objections",{field:"v4_objections"})}
                            </div>
                            <textarea rows={2} className="ea-input w-full resize-none" value={getV4(3,"main_objections")} onChange={(e) => setV4Field(3,"main_objections",e.target.value)} placeholder="e.g. Price, existing contract, switching effort..." />
                          </div>
                        </div>
                      )}

                      {/* ---- STEP 4: CURRENT ALTERNATIVES ---- */}
                      {v4Step === 4 && (
                        <div className="space-y-5">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel>How do customers currently solve this problem?</FieldLabel>
                              {v4SuggestBtn(4,"how_solve_currently",{field:"alternatives"})}
                            </div>
                            <textarea rows={2} className="ea-input w-full resize-none" value={getV4(4,"how_solve_currently")} onChange={(e) => setV4Field(4,"how_solve_currently",e.target.value)} placeholder="e.g. Spreadsheets, hiring consultants, doing nothing..." />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel info="Include direct competitors (same problem, same customer), substitutes (related alternatives), and manual workarounds — one per line.">Competitors & alternatives (one per line)</FieldLabel>
                              {v4SuggestBtn(4,"direct_competitors",{field:"v4_direct_competitors"})}
                            </div>
                            <textarea rows={4} className="ea-input w-full resize-none" value={Array.isArray(getV4(4,"direct_competitors")) ? getV4(4,"direct_competitors",[]).join("\n") : (getV4(4,"direct_competitors") || "")} onChange={(e) => setV4Field(4,"direct_competitors",e.target.value.split("\n"))} placeholder="e.g. Salesforce&#10;HubSpot&#10;Generic spreadsheets&#10;In-house team" />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel>Main customer frustrations with current alternatives</FieldLabel>
                              {v4SuggestBtn(4,"alternative_frustrations",{field:"v4_alternative_frustrations"})}
                            </div>
                            <textarea rows={2} className="ea-input w-full resize-none" value={getV4(4,"alternative_frustrations")} onChange={(e) => setV4Field(4,"alternative_frustrations",e.target.value)} placeholder="e.g. Too expensive, too complex, not built for SMEs..." />
                          </div>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <FieldLabel>Existing customer spending on alternatives</FieldLabel>
                                {v4SuggestBtn(4,"existing_spending",{field:"v4_existing_spending"})}
                              </div>
                              <Input value={getV4(4,"existing_spending")} onChange={(e) => setV4Field(4,"existing_spending",e.target.value)} placeholder="e.g. £200/month on Salesforce..." />
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <FieldLabel>Main switching barriers</FieldLabel>
                                {v4SuggestBtn(4,"switching_barriers",{field:"v4_switching_barriers"})}
                              </div>
                              <Input value={getV4(4,"switching_barriers")} onChange={(e) => setV4Field(4,"switching_barriers",e.target.value)} placeholder="e.g. Data migration, long contracts..." />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ---- STEP 5: PROPOSED SOLUTION ---- */}
                      {v4Step === 5 && (
                        <div className="space-y-5">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel>Solution description <span className="text-rose-500">*</span></FieldLabel>
                              {v4SuggestBtn(5,"solution_description",{field:"solution"})}
                            </div>
                            <textarea rows={3} className="ea-input w-full resize-none" value={getV4(5,"solution_description")} onChange={(e) => setV4Field(5,"solution_description",e.target.value)} placeholder="Describe your solution..." />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel>Core customer outcome</FieldLabel>
                              {v4SuggestBtn(5,"core_outcome",{field:"v4_core_outcome"})}
                            </div>
                            <Input value={getV4(5,"core_outcome")} onChange={(e) => setV4Field(5,"core_outcome",e.target.value)} placeholder="e.g. Save 5 hours/week on reporting..." />
                          </div>
                          <div>
                            <FieldLabel>Delivery method</FieldLabel>
                            <select className="ea-input w-full" value={getV4(5,"delivery_method")} onChange={(e) => setV4Field(5,"delivery_method",e.target.value)}>
                              <option value="">Select...</option>
                              {V4_DELIVERY_METHODS.map((d) => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel>Why is this better than alternatives?</FieldLabel>
                              {v4SuggestBtn(5,"why_better",{field:"service_differentiator"})}
                            </div>
                            <textarea rows={2} className="ea-input w-full resize-none" value={getV4(5,"why_better")} onChange={(e) => setV4Field(5,"why_better",e.target.value)} placeholder="e.g. 10x faster, no data migration, simpler pricing..." />
                          </div>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <FieldLabel info="New habit, workflow, or skill the customer must adopt to get value.">Required customer behaviour change</FieldLabel>
                              <Input value={getV4(5,"behaviour_change")} onChange={(e) => setV4Field(5,"behaviour_change",e.target.value)} placeholder="e.g. Must upload invoices daily instead of monthly..." />
                            </div>
                            <div>
                              <FieldLabel>Time to value for customer</FieldLabel>
                              <Input value={getV4(5,"time_to_value")} onChange={(e) => setV4Field(5,"time_to_value",e.target.value)} placeholder="e.g. Value seen within 30 minutes of setup" />
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel info="Describe your competitive moat — e.g. proprietary data, network effects, switching costs, brand, IP.">Defensibility / moat</FieldLabel>
                              {v4SuggestBtn(5,"defensibility",{field:"v4_defensibility"})}
                            </div>
                            <Input value={getV4(5,"defensibility")} onChange={(e) => setV4Field(5,"defensibility",e.target.value)} placeholder="e.g. Proprietary data moat, switching cost after onboarding..." />
                          </div>
                        </div>
                      )}

                      {/* ---- STEP 6: MARKET ---- */}
                      {v4Step === 6 && (
                        <div className="space-y-5">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <FieldLabel>Market category</FieldLabel>
                              {v4SuggestBtn(6,"market_category",{field:"v4_market_category"})}
                            </div>
                            <Input value={getV4(6,"market_category")} onChange={(e) => setV4Field(6,"market_category",e.target.value)} placeholder="e.g. SME HR Software, Local Food Delivery..." />
                          </div>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <FieldLabel>Estimated number of potential customers</FieldLabel>
                                {v4SuggestBtn(6,"estimated_customers",{field:"v4_estimated_customers"})}
                              </div>
                              <textarea rows={2} className="ea-input w-full resize-none" value={getV4(6,"estimated_customers")} onChange={(e) => setV4Field(6,"estimated_customers",e.target.value)} placeholder="e.g. 50,000 businesses in UK" />
                            </div>
                            <div>
                              <FieldLabel>Market scope</FieldLabel>
                              <select className="ea-input w-full" value={getV4(6,"market_scope")} onChange={(e) => setV4Field(6,"market_scope",e.target.value)}>
                                <option value="">Select...</option>
                                {V4_MARKET_SCOPES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                              </select>
                            </div>
                          </div>
                          <div>
                            <FieldLabel>Is the market growing?</FieldLabel>
                            <div className="flex gap-3 mt-1">
                              {V4_MARKET_GROWTHS.map((g) => (
                                <label key={g} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition ${getV4(6,"market_growing") === g ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:border-brand-300"}`}>
                                  <input type="radio" name="market_growing" checked={getV4(6,"market_growing") === g} onChange={() => setV4Field(6,"market_growing",g)} className="sr-only" />
                                  {g.charAt(0).toUpperCase()+g.slice(1)}
                                </label>
                              ))}
                            </div>
                          </div>
                          <div>
                            <FieldLabel>Market sources / reports (one per line)</FieldLabel>
                            <textarea rows={2} className="ea-input w-full resize-none" value={Array.isArray(getV4(6,"market_sources")) ? getV4(6,"market_sources",[]).join("\n") : (getV4(6,"market_sources") || "")} onChange={(e) => setV4Field(6,"market_sources",e.target.value.split("\n"))} placeholder="e.g. Statista report URL, IBISWorld, ONS data..." />
                          </div>
                        </div>
                      )}

                      {/* ---- STEP 7: REVENUE & PRICING (Comprehensive) ---- */}
                      {v4Step === 7 && (
                        <div className="space-y-5">
                          <div>
                            <FieldLabel>Primary revenue model</FieldLabel>
                            <select className="ea-input w-full" value={getV4(7,"revenue_model")} onChange={(e) => setV4Field(7,"revenue_model",e.target.value)}>
                              <option value="">Select model...</option>
                              {V4_REVENUE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <FieldLabel>Proposed price</FieldLabel>
                              <Input value={getV4(7,"proposed_price")} onChange={(e) => setV4Field(7,"proposed_price",e.target.value)} placeholder="e.g. £49/month, £500/project..." />
                            </div>
                            <div>
                              <FieldLabel>Payment frequency</FieldLabel>
                              <Input value={getV4(7,"payment_frequency")} onChange={(e) => setV4Field(7,"payment_frequency",e.target.value)} placeholder="e.g. Monthly, Annual, One-off..." />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={getV4(7,"willingness_to_pay_evidence",false)} onChange={(e) => setV4Field(7,"willingness_to_pay_evidence",e.target.checked)} className="accent-brand-600" />I have evidence customers will pay this price</label>
                            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={getV4(7,"recurring_model",false)} onChange={(e) => setV4Field(7,"recurring_model",e.target.checked)} className="accent-brand-600" />This is a recurring/subscription model</label>
                          </div>
                        </div>
                      )}

                      {/* ---- STEP 8: COSTS & UNIT ECONOMICS (Comprehensive) ---- */}
                      {v4Step === 8 && (
                        <div className="space-y-5">
                          <p className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">All cost inputs are indicative. Confirm with suppliers before making investment decisions.</p>
                          <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={getV4(8,"variable_cost_known",false)} onChange={(e) => setV4Field(8,"variable_cost_known",e.target.checked)} className="accent-brand-600" />I know the variable / delivery cost per unit</label>
                            {getV4(8,"variable_cost_known",false) && (
                              <Input value={getV4(8,"variable_cost_per_unit")} onChange={(e) => setV4Field(8,"variable_cost_per_unit",e.target.value)} placeholder="e.g. £12 per delivery..." />
                            )}
                          </div>
                          <div>
                            <FieldLabel>Estimated monthly fixed costs</FieldLabel>
                            <Input value={getV4(8,"fixed_costs_monthly")} onChange={(e) => setV4Field(8,"fixed_costs_monthly",e.target.value)} placeholder="e.g. £3,500/month (salaries, rent, software)" />
                          </div>
                          <div>
                            <FieldLabel>Estimated gross margin</FieldLabel>
                            <Input value={getV4(8,"gross_margin_estimate")} onChange={(e) => setV4Field(8,"gross_margin_estimate",e.target.value)} placeholder="e.g. 60% — not confirmed" />
                          </div>
                        </div>
                      )}

                      {/* ---- STEP 9: CAPACITY & OPERATIONS (Comprehensive) ---- */}
                      {v4Step === 9 && (
                        <div className="space-y-5">
                          <div>
                            <FieldLabel>Delivery unit</FieldLabel>
                            <Input value={getV4(9,"delivery_unit")} onChange={(e) => setV4Field(9,"delivery_unit",e.target.value)} placeholder="e.g. Per project, per subscription seat, per delivery..." />
                          </div>
                          <div>
                            <FieldLabel>Maximum capacity per month</FieldLabel>
                            <Input value={getV4(9,"capacity_per_month")} onChange={(e) => setV4Field(9,"capacity_per_month",e.target.value)} placeholder="e.g. 50 clients, 200 orders..." />
                          </div>
                          <div>
                            <FieldLabel>Key operational bottleneck</FieldLabel>
                            <Input value={getV4(9,"key_bottleneck")} onChange={(e) => setV4Field(9,"key_bottleneck",e.target.value)} placeholder="e.g. Founder time, equipment capacity, supplier lead time..." />
                          </div>
                          <div>
                            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={getV4(9,"delivery_model_defined",false)} onChange={(e) => setV4Field(9,"delivery_model_defined",e.target.checked)} className="accent-brand-600" />I have a defined delivery model / process</label>
                          </div>
                        </div>
                      )}

                      {/* ---- STEP 10: TRACTION & EVIDENCE ---- */}
                      {v4Step === 10 && (
                        <div className="space-y-5">
                          <p className="text-sm text-slate-600">Select all types of evidence you currently have. Be honest, this directly affects your Evidence Confidence Score.</p>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {V4_EVIDENCE_TYPES.map(({ id, label }) => {
                              const selected = (getV4(10,"evidence_types",[]) || []).includes(id);
                              return (
                                <label key={id} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition ${selected ? "border-brand-400 bg-brand-50 text-brand-800 font-medium" : "border-slate-200 bg-white text-slate-700 hover:border-brand-200"}`}>
                                  <input type="checkbox" checked={selected} onChange={() => toggleV4ArrayField(10,"evidence_types",id)} className="accent-brand-600 shrink-0" />
                                  {label}
                                </label>
                              );
                            })}
                          </div>
                          <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={getV4(10,"has_paying_customers",false)} onChange={(e) => setV4Field(10,"has_paying_customers",e.target.checked)} className="accent-brand-600" />I have at least one paying customer</label>
                            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={getV4(10,"has_repeat_customers",false)} onChange={(e) => setV4Field(10,"has_repeat_customers",e.target.checked)} className="accent-brand-600" />I have repeat / returning customers</label>
                          </div>
                        </div>
                      )}

                      {/* ---- STEP 11: FOUNDER READINESS (Comprehensive) ---- */}
                      {v4Step === 11 && (
                        <div className="space-y-5">
                          <div>
                            <FieldLabel>Industry experience</FieldLabel>
                            <select className="ea-input w-full" value={getV4(11,"founder_industry_experience")} onChange={(e) => setV4Field(11,"founder_industry_experience",e.target.value)}>
                              <option value="">Select...</option>
                              {V4_FOUNDER_EXPERIENCE.map((e) => <option key={e} value={e}>{e.charAt(0).toUpperCase()+e.slice(1)}</option>)}
                            </select>
                          </div>
                          <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={getV4(11,"founder_capital_available",false)} onChange={(e) => setV4Field(11,"founder_capital_available",e.target.checked)} className="accent-brand-600" />I have capital available to launch</label>
                            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={getV4(11,"founder_time_available",false)} onChange={(e) => setV4Field(11,"founder_time_available",e.target.checked)} className="accent-brand-600" />I have sufficient time to dedicate to this</label>
                          </div>
                        </div>
                      )}

                      {/* ---- STEP 12: REGULATORY RISK (Comprehensive) ---- */}
                      {v4Step === 12 && (
                        <div className="space-y-5">
                          <div>
                            <FieldLabel>Regulatory risk level</FieldLabel>
                            <select className="ea-input w-full" value={getV4(12,"regulatory_risk_level")} onChange={(e) => setV4Field(12,"regulatory_risk_level",e.target.value)}>
                              <option value="">Select...</option>
                              {V4_REG_RISKS.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>)}
                            </select>
                          </div>
                          <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={getV4(12,"regulatory_requirements_known",false)} onChange={(e) => setV4Field(12,"regulatory_requirements_known",e.target.checked)} className="accent-brand-600" />I have identified the regulatory requirements</label>
                            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={getV4(12,"regulatory_mitigation_planned",false)} onChange={(e) => setV4Field(12,"regulatory_mitigation_planned",e.target.checked)} className="accent-brand-600" />I have a plan to address regulatory requirements</label>
                          </div>
                          <p className="text-xs text-slate-400 border border-slate-200 rounded-lg px-3 py-2">Potential regulatory considerations identified. Professional legal verification required before proceeding.</p>
                        </div>
                      )}
                    </div>

                    {/* Navigation */}
                    <div className="mt-6 flex items-center justify-between gap-3">
                      <button type="button" onClick={goBack} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5m7 7l-7-7 7-7" /></svg>
                        Back
                      </button>
                      {isLast ? (
                        <div className="flex items-center gap-3">
                          {v4Journey === "basic" && (
                            <button
                              type="button"
                              onClick={() => canAccessComprehensive
                                ? (markV4StepComplete(v4Step), setV4Journey("comprehensive"), setV4Step(3))
                                : navigate("/pricing")}
                              className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-100 flex items-center gap-1.5"
                            >
                              {!canAccessComprehensive && <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
                              {canAccessComprehensive ? "Switch to Comprehensive" : "Comprehensive (Paid)"}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={v4Saving}
                            onClick={() => { if (triggerDemoGate?.("validation")) return; setCreditModal({ featureName: "Idea Validation", creditCost: v4Journey === "comprehensive" ? 10 : 5, onConfirm: () => { setCreditModal(null); markV4StepComplete(v4Step); handleV4Evaluate(); } }); }}
                            className="flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
                          >
                            {v4Saving ? "Running validation..." : "Run Validation"}
                            {!v4Saving && <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14m-7-7l7 7-7 7" /></svg>}
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={goNext} className="flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700">
                          Continue
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14m-7-7l7 7-7 7" /></svg>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : mode === "select" && !isCreateWorkspace ? (
            <>
              {!fromOtherModule ? (
                <div className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white shadow-lg md:p-8">
                  <div className="relative z-10 max-w-3xl">
                    <h1 className="text-xl font-bold md:text-3xl leading-tight">Validate your vision</h1>
                    <p className="mt-2 text-xs font-medium text-brand-100 md:text-base opacity-90 whitespace-nowrap">
                      Turn your assumptions into a data-backed business case. Click below to get started.
                    </p>
                  </div>
                  <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
                  <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-brand-400/20 blur-3xl" />
                </div>
              ) : null}

              {!fromOtherModule ? (
                <div className="space-y-6">
                  {canEvaluateIdea && (
                    <button
                      type="button"
                      onClick={() => { clearV4Draft(); setV4Form({}); setMode("v4"); setV4Step(0); setV4Journey(null); }}
                      className="group relative w-full flex items-center gap-5 overflow-hidden rounded-3xl border-2 border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50 p-6 text-left transition-all duration-300 hover:border-violet-400 hover:shadow-xl"
                    >
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg transition-transform duration-300 group-hover:scale-110">
                        <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="text-lg font-black text-violet-900">Idea Validation</div>
                        </div>
                        <p className="text-sm leading-relaxed text-violet-700">
                          Evidence-aware validation with dual scores — Commercial Potential and Evidence Confidence. Choose Basic or Comprehensive depth.
                        </p>
                      </div>
                      <svg className="h-5 w-5 shrink-0 text-violet-400 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14m-7-7l7 7-7 7" /></svg>
                    </button>
                  )}
                </div>
              ) : null}

              {!fromOtherModule && (
                <div className="mt-12">
                  <SectionCard
                    title="Validation history"
                    subtitle="Resume or view your previous analysis items."
                    badge={validationHistory.length ? String(validationHistory.length) : null}
                    headerRight={validationHistory.length > 5 ? (
                      <button
                        type="button"
                        onClick={() => setContentTab("history")}
                        className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                      >
                        View all →
                      </button>
                    ) : null}
                  >
                    <div className="space-y-3">
                      {filteredValidationHistory.length ? (
                        filteredValidationHistory.slice(0, 5).map((entry) => {
                          const badgeClass =
                            entry.status === "accepted"
                              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                              : entry.status === "rejected"
                                ? "bg-rose-50 text-rose-700 ring-rose-200"
                                : "bg-amber-50 text-amber-700 ring-amber-200";
                          const isChecked = bulkSelected.has(entry.id);
                          return (
                            <div
                              key={entry.id}
                              onClick={() => editHistoryEntry(entry)}
                              className={`flex w-full cursor-pointer flex-wrap items-start justify-between gap-3 rounded-2xl border bg-white p-4 shadow-sm text-left transition hover:border-brand-300 hover:shadow-md ${isChecked ? "border-brand-300 bg-brand-50/40" : "border-slate-200"}`}
                            >
                              <div className="flex items-start gap-3 min-w-0 flex-1">
                                <div onClick={(e) => e.stopPropagation()} className="mt-0.5 shrink-0">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      const next = new Set(bulkSelected);
                                      if (e.target.checked) next.add(entry.id); else next.delete(entry.id);
                                      setBulkSelected(next);
                                    }}
                                    className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                                  />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-semibold text-slate-900">{entry.title}</div>
                                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ${badgeClass}`}>
                                      {String(entry.status || "pending").toUpperCase()}
                                    </span>
                                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">
                                      {entry.type === "service_validation" ? "Service" : "Business"}
                                    </span>
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    {new Date(entry.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                <Button size="sm" variant="secondary" onClick={() => editHistoryEntry(entry)}>
                                  {entry.status === "accepted" || entry.status === "rejected" ? "View" : "Resume"}
                                </Button>
                                <Button variant="ghost" onClick={() => deleteHistoryEntry(entry.id)}>
                                  Delete
                                </Button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                          {validationHistory.length
                            ? "No items match this filter."
                            : "No validation history yet. Run a validation and it will appear here."}
                        </div>
                      )}
                    </div>
                  </SectionCard>
                </div>
              )}
            </>
          ) : (
            <SectionCard
              title={fromOtherModule ? "Workspace inputs" : "Validation inputs"}
              subtitle="Follow the sections below to validate your concept with real market data."
            >
              <div className="space-y-6">
                {!isCreateWorkspace && (
                  <button
                    type="button"
                    onClick={() => { clearV4Draft(); setV4Form({}); setMode("v4"); setV4Step(0); setV4Journey(null); }}
                    className="group flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-brand-600 transition-colors"
                    disabled={isLoading}
                  >
                    <svg className="h-4 w-4 transition-transform group-hover:-translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M19 12H5m7 7l-7-7 7-7" />
                    </svg>
                    Back to pathway selection
                  </button>
                )}

                <div className="space-y-3">
                  {isBusinessStageFlow ? (
                    <div className="space-y-8">
                      {/* Section 1 — The Idea */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 1 — The Idea</h3>
                        </div>
                        <div className="grid grid-cols-1 gap-6">
                          <div>
                            <FieldLabel info="What is your business idea? Describe it clearly.">1. What is your business idea?</FieldLabel>
                            <textarea
                              className="ea-input min-h-[120px] py-3 text-sm leading-relaxed"
                              placeholder="e.g. AI bookkeeping assistant for UK SMEs..."
                              value={form.context.description}
                              onChange={(e) => update("context.description", e.target.value)}
                            />
                            <AISuggest
                              context={{ field: "description", description: form.context?.description, segment: form.problem?.customer_segment_category, location: form.context?.location, industry: form.context?.industry_category, country: form.context?.country }}
                              onAccept={(v) => update("context.description", v)}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Section 2 — Problem */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 2 — Problem</h3>
                        </div>
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                          <div className="md:col-span-2">
                            <FieldLabel info="The core issue you are addressing.">2. What problem are you trying to solve?</FieldLabel>
                            <textarea
                              className="ea-input min-h-[100px] py-3 text-sm"
                              placeholder="Describe the pain point..."
                              value={form.problem.problem_type}
                              onChange={(e) => update("problem.problem_type", e.target.value)}
                            />
                            <AISuggest
                              context={{ field: "problem", description: form.context?.description, segment: form.problem?.customer_segment_category, industry: form.context?.industry_category, country: form.context?.country, location: form.context?.location }}
                              onAccept={(v) => update("problem.problem_type", v)}
                            />
                          </div>
                          <div className="md:col-span-2">
                            <FieldLabel info="Briefly describe your proposed approach or product/service idea that addresses this problem.">3. What is your proposed solution?</FieldLabel>
                            <textarea
                              className="ea-input min-h-[100px] py-3 text-sm"
                              placeholder="Describe your proposed solution or product idea..."
                              value={form.problem.proposed_solution || ""}
                              onChange={(e) => update("problem.proposed_solution", e.target.value)}
                            />
                          </div>
                          <div>
                            <FieldLabel info="Who is the primary audience for this?">4. Who experiences this problem?</FieldLabel>
                            <select className="ea-input" value={form.problem.customer_segment_category} onChange={(e) => update("problem.customer_segment_category", e.target.value)}>
                              {["Individuals", "Students", "Professionals", "SMEs", "Enterprises", "Government", "Other"].map(o => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <FieldLabel info="How severe is the impact on them?">5. How painful is this problem?</FieldLabel>
                            <select className="ea-input" value={form.problem.severity} onChange={(e) => update("problem.severity", e.target.value)}>
                              {["Mild", "Moderate", "Severe", "Critical"].map(o => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Section 3 — Existing Alternatives */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 3 — Existing Alternatives</h3>
                        </div>
                        <div>
                          <FieldLabel info="How do they manage today?">6. How do people solve this problem today?</FieldLabel>
                          <textarea
                            className="ea-input min-h-[100px] py-3 text-sm"
                            placeholder="e.g. Manual spreadsheets, hiring expensive consultants..."
                            value={form.problem.alternatives}
                            onChange={(e) => update("problem.alternatives", e.target.value)}
                          />
                          <AISuggest
                            context={{ field: "alternatives", description: form.context?.description, problem: form.problem?.problem_type, segment: form.problem?.customer_segment_category, industry: form.context?.industry_category, country: form.context?.country }}
                            onAccept={(v) => update("problem.alternatives", v)}
                          />
                        </div>
                      </div>

                      {/* Section 4 — Your Solution */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 4 — Your Solution</h3>
                        </div>
                        <div>
                          <FieldLabel info="Your unique edge or primary value.">7. How does your solution solve the problem better?</FieldLabel>
                          <textarea
                            className="ea-input min-h-[100px] py-3 text-sm"
                            placeholder="Describe your unique value or edge..."
                            value={form.offer.service_type}
                            onChange={(e) => update("offer.service_type", e.target.value)}
                          />
                          <AISuggest
                            context={{ field: "solution", description: form.context?.description, problem: form.problem?.problem_type, alternatives: form.problem?.alternatives, segment: form.problem?.customer_segment_category, industry: form.context?.industry_category, country: form.context?.country }}
                            onAccept={(v) => update("offer.service_type", v)}
                          />
                        </div>
                      </div>

                      {/* Section 5 — Market */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 5 — Market</h3>
                        </div>
                        <div>
                          <FieldLabel info="Territory reach.">8. Where is your target market?</FieldLabel>
                          <select className="ea-input" value={form.context.location} onChange={(e) => update("context.location", e.target.value)}>
                            {["Local", "National", "Regional", "Global"].map(o => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div>
                            <FieldLabel info="The broad industry your business operates in.">Industry</FieldLabel>
                            <select className="ea-input" value={form.context.industry_category} onChange={(e) => update("context.industry_category", e.target.value)}>
                              <option value="">Select industry...</option>
                              {INDUSTRY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                            {form.context.industry_category === "Other" && (
                              <input className="ea-input mt-2" placeholder="Describe your industry..." value={form.context.industry_other} onChange={(e) => update("context.industry_other", e.target.value)} />
                            )}
                          </div>
                          <div>
                            <FieldLabel info="The specific sector or niche your business targets.">Sector</FieldLabel>
                            <select className="ea-input" value={form.context.sector_category} onChange={(e) => update("context.sector_category", e.target.value)}>
                              <option value="">Select sector...</option>
                              {SECTOR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                            {form.context.sector_category === "Other" && (
                              <input className="ea-input mt-2" placeholder="Describe your sector..." value={form.context.sector_other} onChange={(e) => update("context.sector_other", e.target.value)} />
                            )}
                          </div>
                          <div>
                            <FieldLabel info="The country where your business is based or primarily operates.">Country</FieldLabel>
                            <select className="ea-input" value={form.context.country} onChange={(e) => { update("context.country", e.target.value); if (COUNTRY_CURRENCY_MAP[e.target.value]) update("context.currency", COUNTRY_CURRENCY_MAP[e.target.value]); }}>
                              <option value="">Select country...</option>
                              {COUNTRY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                            {form.context.country === "Other" && (
                              <input className="ea-input mt-2" placeholder="Enter your country..." value={form.context.country_other} onChange={(e) => update("context.country_other", e.target.value)} />
                            )}
                          </div>
                          <div>
                            <FieldLabel info="The currency used for pricing and financials.">Currency</FieldLabel>
                            <select className="ea-input" value={form.context.currency} onChange={(e) => update("context.currency", e.target.value)}>
                              {CURRENCY_CODES.map(c => <option key={c} value={c}>{currencyLabel(c)}</option>)}
                              <option value="Other">Other</option>
                            </select>
                            {form.context.currency === "Other" && (
                              <input className="ea-input mt-2" placeholder="e.g. XYZ" value={form.context.currency_other || ""} onChange={(e) => update("context.currency_other", e.target.value)} />
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 6 — Confidence</h3>
                        </div>
                        <div className="space-y-6">
                          <div>
                            <FieldLabel info="Direct user feedback.">9. Have you spoken to potential users?</FieldLabel>
                            <div className="flex flex-wrap gap-2">
                              {["No", "1–5", "6–20", "20+"].map((label) => (
                                <button
                                  key={label}
                                  type="button"
                                  onClick={() => update("validation.spoken_count", label)}
                                  className={"rounded-full px-5 py-2 text-sm font-semibold transition-all " + ((form.validation?.spoken_count || "No") === label ? "bg-brand-600 text-white shadow-md border-transparent" : "bg-white border-2 border-slate-100 text-slate-600 hover:border-brand-200")}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <FieldLabel info="Evidence of demand.">10. Do you have any proof people want this?</FieldLabel>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                              {["Waiting list", "Survey responses", "Pre-orders", "Existing customers", "Social media interest", "None yet"].map((item) => {
                                const isSelected = (form.validation?.demand_proof || []).includes(item);
                                return (
                                  <button
                                    key={item}
                                    type="button"
                                    onClick={() => {
                                      const current = form.validation?.demand_proof || [];
                                      const next = item === "None yet" ? ["None yet"] : (isSelected ? current.filter(i => i !== item) : [...current.filter(i => i !== "None yet"), item]);
                                      update("validation.demand_proof", next);
                                    }}
                                    className={"flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition " + (isSelected ? "border-brand-500 bg-brand-50" : "border-slate-100 bg-white hover:border-slate-200")}
                                  >
                                    <div className={"h-5 w-5 rounded border-2 flex items-center justify-center transition " + (isSelected ? "bg-brand-600 border-brand-600 text-white" : "border-slate-300 bg-white")}>
                                      {isSelected && <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M20 6L9 17l-5-5" /></svg>}
                                    </div>
                                    <span className={"text-sm font-medium " + (isSelected ? "text-brand-900" : "text-slate-600")}>{item}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : isServiceStageFlow ? (
                    <div className="space-y-8">
                      {/* Section 1 */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 1 — The Concept</h3>
                        </div>
                        <div className="grid grid-cols-1 gap-6">
                          <div>
                            <FieldLabel info="Name of your service or product.">1. Product / Service Name</FieldLabel>
                            <Input placeholder="e.g. Premium Tech Support" value={serviceForm.service_name} onChange={(e) => updateService("service_name", e.target.value)} />
                          </div>
                          <div>
                            <FieldLabel info="What does it do and what specific problem does it solve for your target customers?">2. Describe your service and the problem it solves</FieldLabel>
                            <textarea
                              className="ea-input min-h-[110px] py-3 text-sm"
                              placeholder="e.g. On-demand tech consulting for creative agencies that struggle to find reliable technical support without hiring full-time."
                              value={serviceForm.service_description}
                              onChange={(e) => {
                                updateService("service_description", e.target.value);
                                updateService("problem_to_solve", e.target.value);
                              }}
                            />
                            <AISuggest
                              context={{ field: "service_description", description: [serviceForm.service_name, serviceForm.service_description].filter(Boolean).join(": "), segment: Array.isArray(serviceForm.target_customer_type) ? serviceForm.target_customer_type.join(", ") : serviceForm.target_customer_type, industry: form.context?.industry_category, sector: form.context?.sector_category, country: form.context?.country }}
                              onAccept={(v) => { updateService("service_description", v); updateService("problem_to_solve", v); }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Section 2 */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 2 — Problem & Audience</h3>
                        </div>
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                          <div>
                            <FieldLabel info="Select all audience types that apply.">3. Who is it for?</FieldLabel>
                            <CheckboxDropdown
                              options={["SME", "Enterprise", "Startups", "Freelancers", "Consumers (B2C)", "Non-profits", "Government / Public sector", "Students", "Healthcare professionals", "Retailers", "Other"]}
                              selected={Array.isArray(serviceForm.target_customer_type) ? serviceForm.target_customer_type : []}
                              onChange={(next) => updateService("target_customer_type", next)}
                              placeholder="Select audience types..."
                            />
                          </div>
                          <div>
                            <FieldLabel info="Geographic reach for the service.">4. What is your market scope?</FieldLabel>
                            <select
                              className="ea-input"
                              value={serviceForm.target_market_scope}
                              onChange={(e) => updateService("target_market_scope", e.target.value)}
                            >
                              <option value="">Select market scope…</option>
                              {["Local", "Regional", "National", "Global"].map((o) => (
                                <option key={o} value={o.toLowerCase()}>{o}</option>
                              ))}
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <FieldLabel info="Usage frequency.">5. How often would customers need it?</FieldLabel>
                            <div className="flex flex-wrap gap-2">
                              {["Daily", "Weekly", "Monthly", "Occasionally"].map((label) => (
                                <button
                                  key={label}
                                  type="button"
                                  onClick={() => updateService("customer_need_frequency", label)}
                                  className={"rounded-full px-5 py-2 text-sm font-semibold transition-all " + (serviceForm.customer_need_frequency === label ? "bg-brand-600 text-white shadow-md border-transparent" : "bg-white border-2 border-slate-100 text-slate-600 hover:border-brand-200")}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Section 3 */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 3 — Alternatives</h3>
                        </div>
                        <div className="grid grid-cols-1 gap-6">
                          <div>
                            <FieldLabel info="Current habits.">6. What do customers currently use instead?</FieldLabel>
                            <textarea
                              className="ea-input min-h-[80px] py-3 text-sm"
                              placeholder="e.g. Existing manual habits, competitors, spreadsheets..."
                              value={serviceForm.competitors_alternatives}
                              onChange={(e) => updateService("competitors_alternatives", e.target.value)}
                            />
                            <AISuggest
                              context={{ field: "service_alternatives", description: [serviceForm.service_name, serviceForm.service_description].filter(Boolean).join(" — "), problem: serviceForm.problem_to_solve, segment: Array.isArray(serviceForm.target_customer_type) ? serviceForm.target_customer_type.join(", ") : serviceForm.target_customer_type, industry: form.context?.industry_category, sector: form.context?.sector_category, country: form.context?.country }}
                              onAccept={(v) => updateService("competitors_alternatives", v)}
                            />
                          </div>
                          <div>
                            <FieldLabel info="Compared to the alternatives above, what gives your offering a clear edge?">7. What is your competitive advantage over existing alternatives?</FieldLabel>
                            <textarea
                              className="ea-input min-h-[80px] py-3 text-sm"
                              placeholder="e.g. Faster turnaround, lower cost, specialised expertise competitors lack..."
                              value={serviceForm.differentiator}
                              onChange={(e) => updateService("differentiator", e.target.value)}
                            />
                            <AISuggest
                              context={{ field: "service_differentiator", description: [serviceForm.service_name, serviceForm.service_description].filter(Boolean).join(" — "), alternatives: serviceForm.competitors_alternatives, segment: Array.isArray(serviceForm.target_customer_type) ? serviceForm.target_customer_type.join(", ") : serviceForm.target_customer_type, industry: form.context?.industry_category, sector: form.context?.sector_category, country: form.context?.country }}
                              onAccept={(v) => updateService("differentiator", v)}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Section 4 */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 4 — Validation</h3>
                        </div>
                        <div className="space-y-6">
                          <div>
                            <FieldLabel info="Validated demand signals.">8. Have you validated demand?</FieldLabel>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                              {["Interviews", "Surveys", "Waitlist", "Sales", "Social engagement", "None"].map((item) => {
                                const isSelected = (serviceForm.demand_validation_proof || []).includes(item);
                                return (
                                  <button
                                    key={item}
                                    type="button"
                                    onClick={() => {
                                      const current = serviceForm.demand_validation_proof || [];
                                      const next = item === "None" ? ["None"] : (isSelected ? current.filter(i => i !== item) : [...current.filter(i => i !== "None"), item]);
                                      updateService("demand_validation_proof", next);
                                    }}
                                    className={"flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition " + (isSelected ? "border-brand-500 bg-brand-50" : "border-slate-100 bg-white hover:border-slate-200")}
                                  >
                                    <div className={"h-5 w-5 rounded border-2 flex items-center justify-center transition " + (isSelected ? "bg-brand-600 border-brand-600 text-white" : "border-slate-300 bg-white")}>
                                      {isSelected && <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M20 6L9 17l-5-5" /></svg>}
                                    </div>
                                    <span className={"text-sm font-medium " + (isSelected ? "text-brand-900" : "text-slate-600")}>{item}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <div className="md:col-span-2">
                            <div className="flex flex-wrap gap-6 items-start">
                              <div className="flex-1 min-w-[160px]">
                                <FieldLabel info="Pricing strategy.">9. Estimated selling price (Optional)</FieldLabel>
                                <div className="relative">
                                  <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">{serviceCurrencySymbol}</div>
                                  <NumberInput className="pl-8 bg-white dark:bg-slate-900 border-slate-200" placeholder="0.0" value={serviceForm.estimated_price} onChange={(v) => updateService("estimated_price", v)} />
                                </div>
                              </div>
                              <div className="flex-1 min-w-[160px]">
                                <FieldLabel info="The assumed cost to deliver one unit of this service (materials, labour, etc.).">10. Assumed cost per unit (Optional)</FieldLabel>
                                <div className="relative">
                                  <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">{serviceCurrencySymbol}</div>
                                  <NumberInput className="pl-8 bg-white dark:bg-slate-900 border-slate-200" placeholder="0.0" value={serviceForm.assumed_cost_per_unit} onChange={(v) => updateService("assumed_cost_per_unit", v)} />
                                </div>
                              </div>
                              <div className="flex-1 min-w-[160px]">
                                <FieldLabel info="How many units of this service can you deliver per month (your capacity)?">11. Required delivery capacity / month (Optional)</FieldLabel>
                                <NumberInput className="bg-white dark:bg-slate-900 border-slate-200" placeholder="e.g. 20" value={serviceForm.required_capacity} onChange={(v) => updateService("required_capacity", v)} />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Section 5 — Context */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
                          <div className="h-2 w-2 rounded-full bg-brand-500" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Section 5 — Context</h3>
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div>
                            <FieldLabel info="The broad industry your business operates in.">Industry</FieldLabel>
                            <select className="ea-input" value={form.context.industry_category} onChange={(e) => update("context.industry_category", e.target.value)}>
                              <option value="">Select industry...</option>
                              {INDUSTRY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                            {form.context.industry_category === "Other" && (
                              <input className="ea-input mt-2" placeholder="Describe your industry..." value={form.context.industry_other} onChange={(e) => update("context.industry_other", e.target.value)} />
                            )}
                          </div>
                          <div>
                            <FieldLabel info="The specific sector or niche your business targets.">Sector</FieldLabel>
                            <select className="ea-input" value={form.context.sector_category} onChange={(e) => update("context.sector_category", e.target.value)}>
                              <option value="">Select sector...</option>
                              {SECTOR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                            {form.context.sector_category === "Other" && (
                              <input className="ea-input mt-2" placeholder="Describe your sector..." value={form.context.sector_other} onChange={(e) => update("context.sector_other", e.target.value)} />
                            )}
                          </div>
                          <div>
                            <FieldLabel info="The country where your business is based or primarily operates.">Country</FieldLabel>
                            <select className="ea-input" value={form.context.country} onChange={(e) => { update("context.country", e.target.value); if (COUNTRY_CURRENCY_MAP[e.target.value]) update("context.currency", COUNTRY_CURRENCY_MAP[e.target.value]); }}>
                              <option value="">Select country...</option>
                              {COUNTRY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                            {form.context.country === "Other" && (
                              <input className="ea-input mt-2" placeholder="Enter your country..." value={form.context.country_other} onChange={(e) => update("context.country_other", e.target.value)} />
                            )}
                          </div>
                          <div>
                            <FieldLabel info="The currency used for pricing and financials.">Currency</FieldLabel>
                            <select className="ea-input" value={form.context.currency} onChange={(e) => update("context.currency", e.target.value)}>
                              {CURRENCY_CODES.map(c => <option key={c} value={c}>{currencyLabel(c)}</option>)}
                              <option value="Other">Other</option>
                            </select>
                            {form.context.currency === "Other" && (
                              <input className="ea-input mt-2" placeholder="e.g. XYZ" value={form.context.currency_other || ""} onChange={(e) => update("context.currency_other", e.target.value)} />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : !isCreateWorkspace ? (
                    <div className="space-y-3">
                      <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                        <div className="text-sm font-semibold text-slate-600">Please start a new validation.</div>
                        <button onClick={() => { clearV4Draft(); setV4Form({}); setMode("v4"); setV4Step(0); setV4Journey(null); }} className="mt-2 text-xs font-bold text-brand-600 hover:underline">Start new validation</button>
                      </div>
                    </div>
                  ) : null}

                  {enabledForms.workspace_profile ? (
                    <FormSection title="Workspace profile" defaultOpen>
                      <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel info="Legal or trading name.">Company name *</FieldLabel>
                          <Input value={profile.company_name} onChange={(e) => updateProfile("company_name", e.target.value)} />
                        </div>
                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel info="This logo becomes the workspace logo and is reused in documents where needed.">
                            Workspace logo
                          </FieldLabel>
                          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
                            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                              <div className="flex items-center gap-3">
                                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                                  {profile.logo_data_url ? (
                                    <img src={profile.logo_data_url} alt="Workspace logo preview" className="h-full w-full object-contain" />
                                  ) : (
                                    <span className="text-xs font-semibold text-slate-400">No logo</span>
                                  )}
                                </div>
                                <div className="space-y-1">
                                  <div className="text-sm font-semibold text-slate-900">Brand your workspace once</div>
                                  <div className="text-sm text-slate-600">
                                    Upload a PNG, JPG, or SVG logo to use across your workspace and generated documents.
                                  </div>
                                  <div className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                                    Used in workspace profile, blueprints, and financial documents
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <label className="inline-flex cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                                  Upload logo
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      void handleProfileLogoChange(file);
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                                {profile.logo_data_url ? (
                                  <Button variant="ghost" onClick={clearProfileLogo}>
                                    Remove
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div>
                          <FieldLabel>Legal name</FieldLabel>
                          <Input value={profile.legal_name} onChange={(e) => updateProfile("legal_name", e.target.value)} />
                        </div>
                        <div>
                          <FieldLabel>Registration number</FieldLabel>
                          <Input value={profile.registration_number} onChange={(e) => updateProfile("registration_number", e.target.value)} />
                        </div>
                        <div>
                          <FieldLabel>Business type *</FieldLabel>
                          <select value={profile.business_type} onChange={(e) => updateProfile("business_type", e.target.value)} className="ea-input">
                            {PROFILE_BUSINESS_TYPES.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                          </select>
                        </div>
                        <div>
                          <FieldLabel>Primary industry *</FieldLabel>
                          <select value={profile.primary_industry} onChange={(e) => updateProfile("primary_industry", e.target.value)} className="ea-input">
                            {PROFILE_INDUSTRIES.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                          </select>
                        </div>
                        <div className="md:col-span-2 xl:col-span-3">
                          <div className="flex items-center justify-between">
                            <FieldLabel info="Short overview of what you do.">About company *</FieldLabel>
                            <WorkspaceAiFill field="about_company" profile={profile} onFill={(v) => updateProfile("about_company", v)} />
                          </div>
                          <textarea value={profile.about_company} onChange={(e) => updateProfile("about_company", e.target.value)} className="min-h-20 ea-input" />
                        </div>
                        <div className="md:col-span-2 xl:col-span-3">
                          <div className="flex items-center justify-between">
                            <FieldLabel>Tagline</FieldLabel>
                            <WorkspaceAiFill field="tagline" profile={profile} onFill={(v) => updateProfile("tagline", v)} />
                          </div>
                          <Input value={profile.tagline} onChange={(e) => updateProfile("tagline", e.target.value)} />
                        </div>
                        <div>
                          <FieldLabel>Year established</FieldLabel>
                          <Input type="number" value={profile.year_established} onChange={(e) => updateProfile("year_established", e.target.value)} />
                        </div>
                        <div>
                          <FieldLabel>Company size</FieldLabel>
                          <select value={profile.company_size} onChange={(e) => updateProfile("company_size", e.target.value)} className="ea-input">
                            {PROFILE_COMPANY_SIZES.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                          </select>
                        </div>

                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel info="Add your services. At least one is required.">Services *</FieldLabel>
                          <div className="space-y-2">
                            {profile.services.map((svc, idx) => (
                              <div key={idx} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-3">
                                <Input
                                  value={svc.service_name}
                                  onChange={(e) => {
                                    const next = structuredClone(profile.services);
                                    next[idx].service_name = e.target.value;
                                    updateProfile("services", next);
                                  }}
                                  placeholder="Service name"
                                />
                                <select
                                  value={svc.service_category}
                                  onChange={(e) => {
                                    const next = structuredClone(profile.services);
                                    next[idx].service_category = e.target.value;
                                    updateProfile("services", next);
                                  }}
                                  className="ea-input"
                                >
                                  {PROFILE_INDUSTRIES.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                                </select>
                                <Input
                                  value={svc.service_description}
                                  onChange={(e) => {
                                    const next = structuredClone(profile.services);
                                    next[idx].service_description = e.target.value;
                                    updateProfile("services", next);
                                  }}
                                  placeholder="Service description"
                                />
                                <div className="md:col-span-3 flex justify-end">
                                  <Button
                                    variant="ghost"
                                    disabled={profile.services.length <= 1}
                                    onClick={() => {
                                      const next = profile.services.filter((_, i) => i !== idx);
                                      updateProfile("services", next);
                                    }}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              </div>
                            ))}
                            <Button
                              variant="secondary"
                              onClick={() => updateProfile("services", [...profile.services, { service_name: "", service_category: "consulting", service_description: "" }])}
                            >
                              Add service
                            </Button>
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between">
                            <FieldLabel>Vision</FieldLabel>
                            <WorkspaceAiFill field="vision" profile={profile} onFill={(v) => updateProfile("vision", v)} />
                          </div>
                          <Input value={profile.vision} onChange={(e) => updateProfile("vision", e.target.value)} />
                        </div>
                        <div>
                          <div className="flex items-center justify-between">
                            <FieldLabel>Mission</FieldLabel>
                            <WorkspaceAiFill field="mission" profile={profile} onFill={(v) => updateProfile("mission", v)} />
                          </div>
                          <Input value={profile.mission} onChange={(e) => updateProfile("mission", e.target.value)} />
                        </div>
                        <div className="md:col-span-2 xl:col-span-3">
                          <div className="flex items-center justify-between">
                            <FieldLabel>Core values (comma separated)</FieldLabel>
                            <WorkspaceAiFill field="core_values" profile={profile} onFill={(v) => updateProfile("core_values", v)} />
                          </div>
                          <Input value={profile.core_values} onChange={(e) => updateProfile("core_values", e.target.value)} />
                        </div>

                        <div>
                          <FieldLabel>Country *</FieldLabel>
                          <select
                            className="ea-input"
                            value={profile.country}
                            onChange={(e) => {
                              updateProfile("country", e.target.value);
                              updateProfile("city", "");
                            }}
                          >
                            <option value="">Select country...</option>
                            {COUNTRY_OPTIONS.filter(o => o !== "Other").map(o => <option key={o} value={o}>{o}</option>)}
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        <div>
                          <FieldLabel>City *</FieldLabel>
                          {profile.country && profile.country !== "Other" && !CITIES_BY_COUNTRY[profile.country] ? (
                            <Input value={profile.city} onChange={(e) => updateProfile("city", e.target.value)} placeholder="Enter city..." />
                          ) : profile.country === "Other" ? (
                            <Input value={profile.city} onChange={(e) => updateProfile("city", e.target.value)} placeholder="Enter city..." />
                          ) : (
                            <select
                              className="ea-input"
                              value={profile.city}
                              onChange={(e) => updateProfile("city", e.target.value)}
                              disabled={!profile.country}
                            >
                              <option value="">{profile.country ? "Select city..." : "Select country first..."}</option>
                              {(CITIES_BY_COUNTRY[profile.country] || []).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          )}
                        </div>
                        <div>
                          <FieldLabel>State / Region</FieldLabel>
                          <Input value={profile.state_or_region} onChange={(e) => updateProfile("state_or_region", e.target.value)} />
                        </div>
                        <div>
                          <FieldLabel>Postcode</FieldLabel>
                          <Input value={profile.postcode} onChange={(e) => updateProfile("postcode", e.target.value)} />
                        </div>
                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel>Address line 1</FieldLabel>
                          <Input value={profile.address_line_1} onChange={(e) => updateProfile("address_line_1", e.target.value)} />
                        </div>
                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel>Address line 2</FieldLabel>
                          <Input value={profile.address_line_2} onChange={(e) => updateProfile("address_line_2", e.target.value)} />
                        </div>

                        <div>
                          <FieldLabel>Email *</FieldLabel>
                          <Input value={profile.email} onChange={(e) => updateProfile("email", e.target.value)} />
                        </div>
                        <div>
                          <FieldLabel>Phone</FieldLabel>
                          <Input value={profile.phone_number} onChange={(e) => updateProfile("phone_number", e.target.value)} />
                        </div>
                        <div>
                          <FieldLabel>Website</FieldLabel>
                          <Input value={profile.website} onChange={(e) => updateProfile("website", e.target.value)} />
                        </div>

                        <div>
                          <FieldLabel>LinkedIn</FieldLabel>
                          <Input value={profile.linkedin_url} onChange={(e) => updateProfile("linkedin_url", e.target.value)} />
                        </div>
                        <div>
                          <FieldLabel>Twitter</FieldLabel>
                          <Input value={profile.twitter_url} onChange={(e) => updateProfile("twitter_url", e.target.value)} />
                        </div>
                        <div>
                          <FieldLabel>Instagram</FieldLabel>
                          <Input value={profile.instagram_url} onChange={(e) => updateProfile("instagram_url", e.target.value)} />
                        </div>
                        <div>
                          <FieldLabel>Facebook</FieldLabel>
                          <Input value={profile.facebook_url} onChange={(e) => updateProfile("facebook_url", e.target.value)} />
                        </div>

                        <div>
                          <FieldLabel>Monthly revenue range</FieldLabel>
                          <select value={profile.monthly_revenue_range} onChange={(e) => updateProfile("monthly_revenue_range", e.target.value)} className="ea-input">
                            <option value="">Select</option>
                            {PROFILE_MONTHLY_REVENUE.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                          </select>
                        </div>
                        <div>
                          <FieldLabel>Employee count</FieldLabel>
                          <Input type="number" value={profile.employee_count} onChange={(e) => updateProfile("employee_count", e.target.value)} />
                        </div>
                        <div>
                          <FieldLabel>Operating stage *</FieldLabel>
                          <select value={profile.operating_stage} onChange={(e) => updateProfile("operating_stage", e.target.value)} className="ea-input">
                            {PROFILE_OPERATING_STAGE.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                          </select>
                        </div>
                        <div>
                          <FieldLabel>Delivery model *</FieldLabel>
                          <select value={profile.delivery_model} onChange={(e) => updateProfile("delivery_model", e.target.value)} className="ea-input">
                            {PROFILE_DELIVERY_MODEL.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                          </select>
                        </div>
                        <div>
                          <FieldLabel>Target customer type</FieldLabel>
                          <select value={profile.target_customer_type} onChange={(e) => updateProfile("target_customer_type", e.target.value)} className="ea-input">
                            <option value="">Select</option>
                            {PROFILE_TARGET_CUSTOMER.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                          </select>
                        </div>
                        <div>
                          <FieldLabel>Primary revenue model</FieldLabel>
                          <select value={profile.primary_revenue_model} onChange={(e) => updateProfile("primary_revenue_model", e.target.value)} className="ea-input">
                            <option value="">Select</option>
                            {PROFILE_REVENUE_MODEL.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                          </select>
                        </div>
                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel>Key offering focus</FieldLabel>
                          <Input value={profile.key_offering_focus} onChange={(e) => updateProfile("key_offering_focus", e.target.value)} />
                        </div>
                      </div>
                    </FormSection>
                  ) : null}

                  {isProductPath && (enabledForms.service_basics || enabledForms.revenue_inputs || enabledForms.direct_costs || enabledForms.fixed_costs || enabledForms.capacity_inputs || enabledForms.demand_inputs || enabledForms.competition) ? (
                    <>
                      {enabledForms.service_basics ? (
                        <FormSection title="Service basics" defaultOpen>
                          <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <div className="md:col-span-2 xl:col-span-4">
                              <FieldLabel info="Name of the service idea you want to validate.">Service name *</FieldLabel>
                              {combinedServiceOptions.length ? (
                                <div className="grid grid-cols-1 items-start gap-2 md:grid-cols-2">
                                  <select
                                    className="ea-input"
                                    value={serviceSelection}
                                    onChange={(e) => {
                                      const nextValue = e.target.value;
                                      setServiceSelection(nextValue);
                                      if (!nextValue) return;
                                      if (nextValue === "__other__") return;

                                      const historyEntry = savedServiceIdeas.find(
                                        (entry) =>
                                          String(entry?.service_name || entry?.payload?.service_name || "").trim() === nextValue
                                      );
                                      if (historyEntry?.payload) {
                                        setServiceForm((prev) => ({ ...prev, ...historyEntry.payload }));
                                        return;
                                      }

                                      const svc = workspaceServices.find((s) => s.service_name === nextValue);
                                      if (svc) {
                                        updateService("service_name", svc.service_name);
                                        if (!serviceForm.service_description && svc.service_description) {
                                          updateService("service_description", svc.service_description);
                                        }
                                        if (svc.service_category) updateService("service_category", svc.service_category);
                                        return;
                                      }

                                      updateService("service_name", nextValue);
                                    }}
                                  >
                                    <option value="">Select from saved services</option>
                                    {combinedServiceOptions.map((name) => (
                                      <option key={name} value={name}>
                                        {name}
                                      </option>
                                    ))}
                                    <option value="__other__">Other (type new)</option>
                                  </select>
                                  <Input
                                    value={serviceForm.service_name}
                                    onChange={(e) => {
                                      setServiceSelection("__other__");
                                      updateService("service_name", e.target.value);
                                    }}
                                    placeholder="Type service name"
                                  />
                                </div>
                              ) : (
                                <Input value={serviceForm.service_name} onChange={(e) => updateService("service_name", e.target.value)} />
                              )}
                            </div>
                            <div className="md:col-span-2 xl:col-span-4">
                              <FieldLabel info="Short description of what the service delivers.">Service description *</FieldLabel>
                              <textarea
                                className="min-h-20 ea-input"
                                value={serviceForm.service_description}
                                onChange={(e) => updateService("service_description", e.target.value)}
                              />
                            </div>
                            <div>
                              <FieldLabel info="Choose the closest category.">Service category *</FieldLabel>
                              <select value={serviceForm.service_category} onChange={(e) => updateService("service_category", e.target.value)} className="ea-input">
                                {SERVICE_CATEGORY_OPTIONS.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                              </select>
                            </div>
                            <div>
                              <FieldLabel info="Who this service is for.">Target customer type *</FieldLabel>
                              <select value={Array.isArray(serviceForm.target_customer_type) ? (serviceForm.target_customer_type[0] || "") : (serviceForm.target_customer_type || "")} onChange={(e) => updateService("target_customer_type", e.target.value ? [e.target.value] : [])} className="ea-input">
                                <option value="">Select…</option>
                                {TARGET_CUSTOMER_OPTIONS.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                              </select>
                            </div>
                            <div>
                              <FieldLabel info="Geographic reach for the service.">Target market scope *</FieldLabel>
                              <select value={serviceForm.target_market_scope} onChange={(e) => updateService("target_market_scope", e.target.value)} className="ea-input">
                                {TARGET_MARKET_SCOPE_OPTIONS.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                              </select>
                            </div>
                            <div>
                              <FieldLabel info="Country where the service will be offered. Used to tailor market insights.">Country</FieldLabel>
                              <Input
                                value={serviceForm.country}
                                onChange={(e) => updateService("country", e.target.value)}
                                placeholder="e.g. United Kingdom"
                              />
                            </div>
                          </div>
                        </FormSection>
                      ) : null}

                      {enabledForms.revenue_inputs ? (
                        <FormSection title="Revenue inputs" defaultOpen>
                          <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2">
                            <div>
                              <FieldLabel info="Price charged per sale.">Price per sale *</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.price_per_sale} onChange={(v) => updateService("price_per_sale", v)} />
                            </div>
                            <div>
                              <FieldLabel info="Expected sales volume per month.">Expected sales per month *</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.expected_sales_per_month} onChange={(v) => updateService("expected_sales_per_month", v)} />
                            </div>
                          </div>
                        </FormSection>
                      ) : null}

                      {enabledForms.direct_costs ? (
                        <FormSection title="Direct delivery costs">
                          <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                            <div>
                              <FieldLabel info="Labour cost to deliver one sale.">Direct labour cost per sale *</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.direct_labour_cost_per_sale} onChange={(v) => updateService("direct_labour_cost_per_sale", v)} />
                            </div>
                            <div>
                              <FieldLabel info="Contractor cost to deliver one sale.">Contractor cost per sale</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.contractor_cost_per_sale} onChange={(v) => updateService("contractor_cost_per_sale", v)} />
                            </div>
                            <div>
                              <FieldLabel info="Materials or tools cost per sale.">Materials/tools cost per sale</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.materials_cost_per_sale} onChange={(v) => updateService("materials_cost_per_sale", v)} />
                            </div>
                            <div>
                              <FieldLabel info="Travel cost per sale.">Travel cost per sale</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.travel_cost_per_sale} onChange={(v) => updateService("travel_cost_per_sale", v)} />
                            </div>
                            <div>
                              <FieldLabel info="Any other direct cost per sale.">Other direct cost per sale</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.other_direct_cost_per_sale} onChange={(v) => updateService("other_direct_cost_per_sale", v)} />
                            </div>
                          </div>
                        </FormSection>
                      ) : null}

                      {enabledForms.fixed_costs ? (
                        <FormSection title="Fixed monthly costs">
                          <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                            <div>
                              <FieldLabel info="Recurring software costs per month.">Monthly software cost *</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.monthly_software_cost} onChange={(v) => updateService("monthly_software_cost", v)} />
                            </div>
                            <div>
                              <FieldLabel info="Recurring marketing costs per month.">Monthly marketing cost *</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.monthly_marketing_cost} onChange={(v) => updateService("monthly_marketing_cost", v)} />
                            </div>
                            <div>
                              <FieldLabel info="Recurring admin costs per month.">Monthly admin cost *</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.monthly_admin_cost} onChange={(v) => updateService("monthly_admin_cost", v)} />
                            </div>
                            <div>
                              <FieldLabel info="Rent or workspace costs per month.">Monthly rent/workspace cost</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.monthly_rent_cost} onChange={(v) => updateService("monthly_rent_cost", v)} />
                            </div>
                            <div>
                              <FieldLabel info="Any other fixed monthly cost.">Other fixed cost</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.monthly_other_fixed_cost} onChange={(v) => updateService("monthly_other_fixed_cost", v)} />
                            </div>
                          </div>
                        </FormSection>
                      ) : null}

                      {enabledForms.capacity_inputs ? (
                        <FormSection title="Capacity inputs">
                          <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2">
                            <div>
                              <FieldLabel info="Hours required to deliver one sale.">Hours required *</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.hours_required_per_sale} onChange={(v) => updateService("hours_required_per_sale", v)} />
                            </div>
                            <div>
                              <div className="flex items-center justify-between gap-2">
                                <FieldLabel info="Total delivery hours available per month. Suggested = expected sales per month × hours required.">
                                  Available delivery hours per month *
                                </FieldLabel>
                                {suggestedDeliveryHours ? (
                                  <button
                                    type="button"
                                    onClick={() => updateService("available_delivery_hours_per_month", String(suggestedDeliveryHours))}
                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                                  >
                                    Use {suggestedDeliveryHours}
                                  </button>
                                ) : null}
                              </div>
                              <NumberInput placeholder={suggestedDeliveryHours ? String(suggestedDeliveryHours) : "0"} value={serviceForm.available_delivery_hours_per_month} onChange={(v) => updateService("available_delivery_hours_per_month", v)} />
                              {workforceStatus ? (
                                <div className="mt-1 text-[11px] text-slate-500">
                                  {workforceStatus.message} (Suggested: {suggestedDeliveryHours} hours/month.)
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </FormSection>
                      ) : null}

                      {enabledForms.demand_inputs ? (
                        <FormSection title="Demand evidence">
                          <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                            <div>
                              <FieldLabel info="Strength of demand evidence.">Demand evidence type *</FieldLabel>
                              <select value={serviceForm.demand_evidence_type} onChange={(e) => updateService("demand_evidence_type", e.target.value)} className="ea-input">
                                {DEMAND_EVIDENCE_OPTIONS.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                              </select>
                            </div>
                            <div>
                              <FieldLabel info="Number of interested leads.">Interested leads</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.number_of_interested_leads} onChange={(v) => updateService("number_of_interested_leads", v)} />
                            </div>
                            <div>
                              <FieldLabel info="Number of paying customers.">Paying customers</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.number_of_paying_customers} onChange={(v) => updateService("number_of_paying_customers", v)} />
                            </div>
                          </div>
                        </FormSection>
                      ) : null}

                      {enabledForms.competition ? (
                        <FormSection title="Competitive positioning">
                          <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                            <div>
                              <FieldLabel info="Lowest competitor price you see.">Competitor price (low)</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.competitor_price_low} onChange={(v) => updateService("competitor_price_low", v)} />
                            </div>
                            <div>
                              <FieldLabel info="Highest competitor price you see.">Competitor price (high)</FieldLabel>
                              <NumberInput placeholder="0" value={serviceForm.competitor_price_high} onChange={(v) => updateService("competitor_price_high", v)} />
                            </div>
                            <div>
                              <FieldLabel info="How differentiated your offer is.">Differentiation level *</FieldLabel>
                              <select value={serviceForm.differentiation_level} onChange={(e) => updateService("differentiation_level", e.target.value)} className="ea-input">
                                {DIFFERENTIATION_OPTIONS.map((o) => (<option key={o} value={o}>{formatEnumLabel(o)}</option>))}
                              </select>
                            </div>
                          </div>
                        </FormSection>
                      ) : null}
                    </>
                  ) : null}

                  {enabledForms.offer_demand ? (
                    <FormSection title="Offer & demand" defaultOpen>
                      <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {!isBusinessStageFlow ? (
                          <>
                            <div className="md:col-span-2 xl:col-span-3">
                              <FieldLabel info="Who you're selling to.">Customer segment</FieldLabel>
                              <select value={form.problem.customer_segment_category} onChange={(e) => update("problem.customer_segment_category", e.target.value)} className="ea-input">
                                {CUSTOMER_SEGMENT_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
                              </select>
                              {form.problem.customer_segment_category === "Other" ? <div className="mt-2"><Input value={form.problem.customer_segment_other} onChange={(e) => update("problem.customer_segment_other", e.target.value)} placeholder="Type customer segment" /></div> : null}
                            </div>

                            <div className="md:col-span-2 xl:col-span-3">
                              <FieldLabel info="Short problem statement.">Problem (short)</FieldLabel>
                              <Input value={form.problem.problem_type} onChange={(e) => update("problem.problem_type", e.target.value)} />
                            </div>

                            <div className="md:col-span-2 xl:col-span-3">
                              <FieldLabel info="How often does this problem occur?">Frequency</FieldLabel>
                              <select
                                value={form.problem.frequency_category || ""}
                                onChange={(e) => updateFrequency(e.target.value)}
                                className="ea-input"
                              >
                                <option value="">Select frequency</option>
                                {FREQUENCY_OPTIONS.map((option) => (
                                  <option key={option} value={option}>
                                    {formatEnumLabel(option)}
                                  </option>
                                ))}
                              </select>
                              {form.problem.frequency_category === "custom" ? (
                                <div className="mt-2">
                                  <Input
                                    value={form.problem.frequency_custom || ""}
                                    onChange={(e) => updateCustomFrequency(e.target.value)}
                                    placeholder="Type custom frequency"
                                  />
                                </div>
                              ) : null}
                            </div>

                            <div className="md:col-span-2 xl:col-span-3">
                              <FieldLabel info="What alternatives do customers use today?">Alternatives</FieldLabel>
                              <Input value={form.problem.alternatives} onChange={(e) => update("problem.alternatives", e.target.value)} />
                            </div>
                          </>
                        ) : null}

                        <div>
                          <FieldLabel info="How you charge customers.">Pricing model</FieldLabel>
                          <select value={form.offer.pricing_model} onChange={(e) => update("offer.pricing_model", e.target.value)} className="ea-input">
                            {PRICING_MODEL_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                          </select>
                        </div>

                        <div>
                          <FieldLabel info="The unit you deliver (for pricing and capacity).">Deliverable unit</FieldLabel>
                          <select value={form.offer.deliverable_unit_category} onChange={(e) => update("offer.deliverable_unit_category", e.target.value)} className="ea-input">
                            {DELIVERABLE_UNIT_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
                          </select>
                          {form.offer.deliverable_unit_category === "Other" ? <div className="mt-2"><Input value={form.offer.deliverable_unit_other} onChange={(e) => update("offer.deliverable_unit_other", e.target.value)} placeholder="Type deliverable unit" /></div> : null}
                        </div>

                        <div>
                          <FieldLabel info="Price per deliverable unit.">Price per unit</FieldLabel>
                          <NumberInput
                            key={!!form.offer.price_per_unit}
                            placeholder={form.offer.price_per_unit ? "" : "0"}
                            className="pl-7 bg-white dark:bg-slate-900"
                            value={form.offer.price_per_unit}
                            onChange={(v) => update("offer.price_per_unit", v)}
                          />
                        </div>

                        <div>
                          <FieldLabel info="Expected sales volume (units).">Units / month</FieldLabel>
                          <NumberInput placeholder={form.demand.expected_units_per_month ? "" : "0"} value={form.demand.expected_units_per_month} onChange={(v) => update("demand.expected_units_per_month", v)} />
                        </div>

                        {/* Advanced optional inputs — collapsed by default to reduce form friction */}
                        <div className="md:col-span-2 xl:col-span-3">
                          <button
                            type="button"
                            onClick={() => setShowAdvancedOffer((v) => !v)}
                            className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700"
                          >
                            <svg
                              className={"h-3.5 w-3.5 shrink-0 transition-transform duration-200 " + (showAdvancedOffer ? "rotate-180" : "")}
                              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                            >
                              <path d="m6 9 6 6 6-6" />
                            </svg>
                            Advanced (optional)
                            <span className="ml-0.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">3 fields</span>
                          </button>
                          {showAdvancedOffer && (
                            <div className="mt-3 grid grid-cols-1 items-start gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 md:grid-cols-3">
                              <div>
                                <FieldLabel info="Number of unique customers. Leave at 0 if each customer = 1 unit.">Customers (optional)</FieldLabel>
                                <NumberInput placeholder="0" value={form.demand.expected_customers} onChange={(v) => update("demand.expected_customers", v)} />
                              </div>
                              <div>
                                <FieldLabel info="Average days from initial contact to closed sale. Leave 0 if unknown.">Sales cycle (days)</FieldLabel>
                                <NumberInput placeholder="30" value={form.demand.sales_cycle_days} onChange={(v) => update("demand.sales_cycle_days", v)} />
                              </div>
                              <div>
                                <FieldLabel info="Days until cash arrives after invoicing. Affects cash-flow runway.">Payment terms (days)</FieldLabel>
                                <NumberInput placeholder="14" value={form.demand.payment_terms_days} onChange={(v) => update("demand.payment_terms_days", v)} />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </FormSection>
                  ) : null}

                  {enabledForms.costs ? (
                    <FormSection title="Costs">
                      <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div>
                          <FieldLabel info="Variable cost to deliver one unit.">Variable cost / unit</FieldLabel>
                          <NumberInput placeholder="0" value={form.costs.variable_cost_per_unit} onChange={(v) => update("costs.variable_cost_per_unit", v)} />
                        </div>
                        <div>
                          <FieldLabel info="Fixed monthly operating costs.">Fixed costs / month</FieldLabel>
                          <NumberInput placeholder="0" value={form.costs.fixed_costs_monthly} onChange={(v) => update("costs.fixed_costs_monthly", v)} />
                        </div>
                        <div>
                          <FieldLabel info="Optional: how much you pay yourself each month.">Founder draw / month</FieldLabel>
                          <NumberInput placeholder="0" value={form.costs.founder_draw_monthly} onChange={(v) => update("costs.founder_draw_monthly", v)} />
                        </div>
                        <div>
                          <FieldLabel info="Optional: contractor or freelancer costs per month.">Contractors / month</FieldLabel>
                          <NumberInput placeholder="0" value={form.costs.contractor_costs_monthly} onChange={(v) => update("costs.contractor_costs_monthly", v)} />
                        </div>
                        {/* Founder hours relocated here from Stage 1 in guided stage flow */}
                        {isBusinessStageFlow ? (
                          <div className="md:col-span-2 xl:col-span-3">
                            <div className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-700 mb-2">
                              How many hours per week can you personally commit? This helps calculate your maximum output capacity.
                            </div>
                            <FieldLabel info="Your weekly capacity commitment — used to calculate maximum sustainable output.">Founder hours / week</FieldLabel>
                            <NumberInput placeholder="40" value={form.context.founder_hours_per_week} onChange={(v) => update("context.founder_hours_per_week", v)} />
                          </div>
                        ) : null}
                      </div>
                    </FormSection>
                  ) : null}

                  {enabledForms.capacity_cash ? (
                    <FormSection title="Capacity & cash">
                      <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div>
                          <FieldLabel info="How many people are delivering the work.">Team size</FieldLabel>
                          <NumberInput placeholder="1" value={form.capacity.team_size} onChange={(v) => update("capacity.team_size", v)} />
                        </div>
                        <div>
                          <FieldLabel info="How many units one person can deliver per month.">
                            Capacity units per person per month
                          </FieldLabel>
                          <NumberInput
                            placeholder={recommendedCapacityPerPerson ? String(recommendedCapacityPerPerson) : "0"}
                            value={form.capacity.capacity_units_per_person_per_month}
                            onChange={(v) => update("capacity.capacity_units_per_person_per_month", v)}
                          />
                          {recommendedCapacityPerPerson || capacityRecommendation ? (
                            <div className="mt-2 text-xs text-slate-500">
                              {recommendedCapacityPerPerson ? `Recommended: ${recommendedCapacityPerPerson} units per person.` : ""}
                              {recommendedCapacityPerPerson && capacityRecommendation ? " " : ""}
                              {capacityRecommendation || ""}
                            </div>
                          ) : null}
                        </div>
                        <div>
                          <FieldLabel info="Cash available before profitability.">Starting cash</FieldLabel>
                          <NumberInput placeholder="0" value={form.cash.starting_cash} onChange={(v) => update("cash.starting_cash", v)} />
                        </div>
                        <div>
                          <FieldLabel info="One-time costs before revenue starts.">Upfront costs</FieldLabel>
                          <NumberInput placeholder="0" value={form.cash.upfront_costs} onChange={(v) => update("cash.upfront_costs", v)} />
                        </div>
                      </div>
                    </FormSection>
                  ) : null}

                  {enabledForms.go_to_market ? (
                    <FormSection title="Go to market">
                      <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div>
                          <FieldLabel info="Derived from your customer segment. Use the override if needed.">Target market</FieldLabel>
                          <div className="flex items-center gap-2">
                            {derivedTargetMarket ? (
                              <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-bold text-brand-800">
                                <svg className="h-3.5 w-3.5 text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                                {form.go_to_market.target_market || "—"}
                              </div>
                            ) : null}
                            <select
                              value={form.go_to_market.target_market}
                              onChange={(e) => update("go_to_market.target_market", e.target.value)}
                              className={"ea-input " + (derivedTargetMarket ? "text-xs text-slate-500" : "")}
                              title="Override auto-derived target market"
                            >
                              {["B2C", "B2B", "B2G", "Marketplace", "Other"].map((o) => (<option key={o} value={o}>{o}</option>))}
                            </select>
                          </div>
                          {derivedTargetMarket && (
                            <p className="mt-1 text-xs text-slate-400">
                              Auto-set from &ldquo;{form.problem.customer_segment_category}&rdquo; — override above if different
                            </p>
                          )}
                        </div>
                        <div>
                          <FieldLabel info="Typical customer spend level for your offer.">Customer budget level</FieldLabel>
                          <select value={form.go_to_market.customer_budget_level} onChange={(e) => update("go_to_market.customer_budget_level", e.target.value)} className="ea-input">
                            {["Unknown", "Low", "Mid", "High", "Enterprise"].map((o) => (<option key={o} value={o}>{o}</option>))}
                          </select>
                        </div>
                        <div>
                          <FieldLabel info="Optional: a narrower niche inside your primary industry.">Sub-industry (optional)</FieldLabel>
                          <Input value={form.go_to_market.sub_industry} onChange={(e) => update("go_to_market.sub_industry", e.target.value)} />
                        </div>
                        <div className="md:col-span-2 xl:col-span-3">
                          <FieldLabel info="Select the channels you plan to use first.">Go to market channels</FieldLabel>
                          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                            {GTM_CHANNEL_OPTIONS.map((ch) => {
                              const selected = Array.isArray(form.go_to_market.channels) && form.go_to_market.channels.includes(ch);
                              return (
                                <button
                                  key={ch}
                                  type="button"
                                  onClick={() => {
                                    const cur = Array.isArray(form.go_to_market.channels) ? form.go_to_market.channels : [];
                                    const next = selected ? cur.filter((x) => x !== ch) : [...cur, ch];
                                    update("go_to_market.channels", next);
                                  }}
                                  className={"rounded-2xl border px-3 py-2 text-sm font-semibold transition " + (selected ? "border-brand-300 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}
                                >
                                  {ch}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </FormSection>
                  ) : null}
                  {null}

                  {/* Navigation Footer — Moved from sticky position to end of scrollable area */}
                  {contentTab === "builder" && (
                    <div className="mt-12 pt-8 border-t border-slate-100 flex flex-col items-center gap-6">
                      <div className="flex w-full items-center justify-between gap-4">
                        <button
                          type="button"
                          onClick={() => { clearV4Draft(); setV4Form({}); setMode("v4"); setV4Step(0); setV4Journey(null); }}
                          className="text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors"
                          disabled={isLoading}
                        >
                          ← Go back
                        </button>

                        <div className="flex-1 max-w-md">
                          {lastEvaluationId ? (
                            <div className="flex w-full gap-2">
                              <Button
                                className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700 border-0"
                                disabled={isLoading}
                                onClick={async () => {
                                  const entry = validationHistory.find((e) => e.id === lastEvaluationId);
                                  const score = entry?.score ?? null;
                                  const verdict = String(entry?.verdict || "").toLowerCase();
                                  const isWeak = (score !== null && score < 40) || verdict === "weak" || verdict === "not recommended" || verdict === "poor";
                                  if (isWeak) {
                                    const ok = window.confirm(
                                      `This idea scored ${score !== null ? score + "/100" : "low"} and is rated "${entry?.verdict || "Weak"}". ` +
                                      "Are you sure you want to accept it and add it to your pipeline? " +
                                      "We recommend addressing the key gaps first."
                                    );
                                    if (!ok) return;
                                  }
                                  await updateHistoryEntryStatus(lastEvaluationId, "accepted");
                                  const acceptedEntry = validationHistory.find((e) => e.id === lastEvaluationId);
                                  setLastEvaluationId(null);
                                  setSavedNotice("Validation accepted.");
                                  setAddToMarketplaceModal({
                                    title: acceptedEntry?.title || "Validated Idea",
                                    description: acceptedEntry?.payload?.idea_description || acceptedEntry?.payload?.idea_tagline || "",
                                  });
                                }}
                              >
                                Accept Validation
                              </Button>
                              <Button
                                className="flex-1 border-rose-200 text-rose-600 hover:bg-rose-50"
                                variant="secondary"
                                disabled={isLoading}
                                onClick={async () => {
                                  await updateHistoryEntryStatus(lastEvaluationId, "rejected");
                                  setLastEvaluationId(null);
                                  setSavedNotice("Validation rejected.");
                                }}
                              >
                                Reject
                              </Button>
                            </div>
                          ) : (
                            <Button
                              className={`w-full border-0 h-12 text-base font-bold shadow-xl ${
                                isCreateWorkspace && canRun
                                  ? "bg-violet-600 hover:bg-violet-700 text-white shadow-violet-200"
                                  : "bg-slate-900 hover:bg-slate-800 text-white shadow-slate-200"
                              }`}
                              disabled={isLoading || isPrefilling || !canRun}
                              onClick={() => {
                                if (!isCreateWorkspace) {
                                  setCreditModal({ featureName: "Idea Validation", creditCost: 5, onConfirm: () => { setCreditModal(null); saveWorkspace(true); } });
                                } else {
                                  saveWorkspace(false);
                                }
                              }}
                            >
                              {isLoading ? null : <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 1 1-7.6-13.5 8.38 8.38 0 0 1 3.8.9" /><path d="M22 2L12 12" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>}
                              {isLoading
                                ? (isCreateWorkspace ? ((storedWorkspaceId || editingWorkspaceId) ? "Saving..." : "Creating Workspace...") : "Running Intelligence Engine...")
                                : (isCreateWorkspace ? ((storedWorkspaceId || editingWorkspaceId) ? "Save workspace" : "Create workspace") : "Run Validation Analysis")}
                            </Button>
                          )}
                        </div>
                      </div>

                    </div>
                  )}
                </div>
              </div>
            </SectionCard>
          )}

        </div >
        {creditModal && (
          <CreditConfirmModal
            featureName={creditModal.featureName}
            creditCost={creditModal.creditCost}
            onConfirm={creditModal.onConfirm}
            onCancel={() => setCreditModal(null)}
          />
        )}
        {
          confirmDialog ? (
            <ConfirmDialog
              message={confirmDialog.message}
              confirmLabel="Delete"
              danger
              onConfirm={confirmDialog.onConfirm}
              onCancel={confirmDialog.onCancel}
            />
          ) : null
        }
        {addToMarketplaceModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
              <div className="p-6">
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                  </span>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Add to Marketplace?</h3>
                </div>
                <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">
                  This validated idea can be listed on the marketplace so other businesses can find your product or service.
                </p>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="ea-label mb-1 block">Name</label>
                    <input
                      className="ea-input w-full"
                      value={addToMarketplaceModal.title}
                      onChange={(e) => setAddToMarketplaceModal((m) => ({ ...m, title: e.target.value }))}
                      maxLength={120}
                    />
                  </div>
                  <div>
                    <label className="ea-label mb-1 block">Description <span className="font-normal text-slate-400">(shown on Marketplace)</span></label>
                    <textarea
                      className="ea-input w-full resize-none"
                      rows={3}
                      maxLength={400}
                      placeholder="Brief description of this product or service"
                      value={addToMarketplaceModal.description}
                      onChange={(e) => setAddToMarketplaceModal((m) => ({ ...m, description: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="mt-5 flex gap-3">
                  <button
                    className="flex-1 rounded-xl bg-brand-600 py-2.5 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                    onClick={async () => {
                      if (!activeWorkspaceId || !addToMarketplaceModal.title?.trim()) return;
                      try {
                        const ws = await apiRequest(`/validation/${activeWorkspaceId}`, "GET");
                        const data = ws?.data || {};
                        const existingCat = data.catalogue || { products: [], customers: [], vendors: [] };
                        const existingProducts = Array.isArray(existingCat.products) ? existingCat.products : [];
                        const name = addToMarketplaceModal.title.trim();
                        const alreadyIn = existingProducts.some((p) => String(p?.name || "").trim().toLowerCase() === name.toLowerCase());
                        if (!alreadyIn) {
                          const newProduct = {
                            id: crypto.randomUUID(),
                            name,
                            description: addToMarketplaceModal.description?.trim() || "",
                            type: "service",
                            base_price: 0,
                            cost_of_sales: 0,
                            discount: 0,
                            freight_cost: 0,
                            archived: false,
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                            source: "validation",
                          };
                          await apiRequest(`/validation/${activeWorkspaceId}`, "PATCH", {
                            data: { catalogue: { ...existingCat, products: [newProduct, ...existingProducts] } },
                          });
                          setExistingCatalogue({ ...existingCat, products: [newProduct, ...existingProducts] });
                        }
                        setAddToMarketplaceModal(null);
                        setSavedNotice(alreadyIn ? "Already in catalogue." : "Added to Marketplace.");
                      } catch {
                        setAddToMarketplaceModal(null);
                      }
                    }}
                  >
                    Add to Marketplace
                  </button>
                  <button
                    className="flex-1 rounded-xl border border-slate-200 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    onClick={() => setAddToMarketplaceModal(null)}
                  >
                    Not now
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        <ToastContainer toasts={toasts} onClose={dismissToast} />
      </div>
    </div>
  );
}
