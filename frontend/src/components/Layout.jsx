import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState, useRef } from "react";
import { useAuthStore } from "../store/auth";
import { apiRequest, getApiBaseUrl } from "../api/client";
import logoUrl from "../enterprate-logo.png";
import { useWorkspaceStore } from "../store/workspace";
import BusinessAssistant from "./BusinessAssistant";
import InviteModal from "./InviteModal";
import { getAcceptedServiceValidationEntry } from "../lib/acceptedValidation";
import { hasModuleAccess, isPlatformModuleGranted, isPlatformModuleRestricted } from "../lib/permissions";
import { planHasModuleAccess, planLabel } from "../lib/plans";

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === "true";

const NAV = [
  { to: "/dashboard", label: "Dashboard", subtitle: "Overview & analytics", icon: "grid", moduleKey: "dashboard" },
  { to: "/validation", label: "Idea Validation", subtitle: "Validate your concept", icon: "bulb", moduleKey: "validation", public: true },
  { to: "/simulation", label: "Simulation", subtitle: "Run what-if scenarios", icon: "beaker", moduleKey: "simulation", public: true },
  { to: "/registration", label: "Business Registration", subtitle: "Legal & compliance", icon: "doc", moduleKey: "registration" },
  { to: "/blueprint", label: "Business Blueprints", subtitle: "Plans & documents", icon: "book", moduleKey: "blueprint" },
  { to: "/catalogue", label: "Catalogue", subtitle: "Products & offers", icon: "box", moduleKey: "catalogue" },
  { to: "/financials", label: "Financials", subtitle: "Invoicing & tracking", icon: "cash", moduleKey: "financials" },
  { to: "/marketplace", label: "Marketplace", subtitle: "Discover businesses", icon: "store", moduleKey: null, public: true },
];


function initialsFromEmail(email) {
  const e = String(email || "").trim();
  if (!e) return "U";
  const name = e.split("@")[0] || "U";
  const parts = name.split(/[.\-_]+/).filter(Boolean);
  const first = (parts[0] || name)[0] || "U";
  const second = (parts[1] || "")[0] || "";
  return (first + second).toUpperCase();
}

function Icon({ name, className = "h-4 w-4" }) {
  const base = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2" };
  if (name === "menu")
    return (
      <svg {...base}>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    );
  if (name === "x")
    return (
      <svg {...base}>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    );
  if (name === "grid")
    return (
      <svg {...base}>
        <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
      </svg>
    );
  if (name === "bulb")
    return (
      <svg {...base}>
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M12 2a7 7 0 0 0-4 12c.6.5 1 1.2 1.1 2h5.8c.1-.8.5-1.5 1.1-2A7 7 0 0 0 12 2Z" />
      </svg>
    );
  if (name === "doc")
    return (
      <svg {...base}>
        <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
        <path d="M14 2v5h5" />
      </svg>
    );
  if (name === "book")
    return (
      <svg {...base}>
        <path d="M4 19a2 2 0 0 0 2 2h14" />
        <path d="M6 2h14v17H6a2 2 0 0 0-2 2V4a2 2 0 0 1 2-2Z" />
      </svg>
    );
  if (name === "beaker")
    return (
      <svg {...base}>
        <path d="M6 2h12" />
        <path d="M10 2v6l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V2" />
        <path d="M8 14h8" />
      </svg>
    );
  if (name === "box")
    return (
      <svg {...base}>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="M3.3 7.3 12 12l8.7-4.7" />
        <path d="M12 22V12" />
      </svg>
    );
  if (name === "cash")
    return (
      <svg {...base}>
        <path d="M3 7h18v10H3z" />
        <path d="M7 7v10" />
        <path d="M17 7v10" />
        <path d="M12 10a2 2 0 1 0 0 4a2 2 0 0 0 0-4Z" />
      </svg>
    );
  if (name === "store")
    return (
      <svg {...base}>
        <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" />
        <path d="M3 9l2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9" />
        <path d="M12 3v6" />
        <path d="M9 14h6" />
      </svg>
    );
  if (name === "settings")
    return (
      <svg {...base}>
        <path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Z" />
        <path d="M19.4 15a7.8 7.8 0 0 0 .1-1 7.8 7.8 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7.7 7.7 0 0 0-1.7-1L15 3h-6l-.3 2.5a7.7 7.7 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.8 7.8 0 0 0-.1 1 7.8 7.8 0 0 0 .1 1l-2 1.5 2 3.5 2.4-1a7.7 7.7 0 0 0 1.7 1L9 21h6l.3-2.5a7.7 7.7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5Z" />
      </svg>
    );
  if (name === "feedback")
    return (
      <svg {...base}>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M8 10h8" />
        <path d="M8 14h5" />
      </svg>
    );
  if (name === "help")
    return (
      <svg {...base}>
        <path d="M12 18h.01" />
        <path d="M9.1 9a3 3 0 1 1 4.6 2.6c-.9.6-1.7 1.2-1.7 2.4v.5" />
        <path d="M22 12A10 10 0 1 1 12 2a10 10 0 0 1 10 10Z" />
      </svg>
    );
  if (name === "bell")
    return (
      <svg {...base}>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
    );
  if (name === "chev")
    return (
      <svg {...base}>
        <path d="M9 6l6 6-6 6" />
      </svg>
    );
  if (name === "users")
    return (
      <svg {...base}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  if (name === "user-plus")
    return (
      <svg {...base}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <line x1="19" y1="8" x2="19" y2="14" />
        <line x1="22" y1="11" x2="16" y2="11" />
      </svg>
    );
  if (name === "lock")
    return (
      <svg {...base}>
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    );
  if (name === "report")
    return (
      <svg {...base}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
        <path d="M10 9H8" />
      </svg>
    );
  if (name === "gift")
    return (
      <svg {...base}>
        <path d="M20 12v10H4V12" />
        <path d="M22 7H2v5h20V7Z" />
        <path d="M12 22V7" />
        <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7Z" />
        <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7Z" />
      </svg>
    );

  return null;
}

function SidebarLink({ item, onClick, forceInactive, locked }) {
  if (item.comingSoon) {
    return (
      <div className="mx-1 flex cursor-default select-none items-center gap-3 rounded-2xl px-3 py-2.5 opacity-50">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-400 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <Icon name={item.icon} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-slate-500 dark:text-slate-500">{item.label}</div>
          <div className="truncate text-[11px] text-slate-400 [@media(max-height:780px)]:hidden">{item.subtitle}</div>
        </div>
        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">Soon</span>
      </div>
    );
  }
  if (locked) {
    return (
      <div
        className="group mx-1 flex cursor-not-allowed items-center gap-3 rounded-2xl px-3 py-2.5 opacity-35 select-none"
        title="You don't have access to this module"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-400 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <Icon name={item.icon} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-slate-500 dark:text-slate-500">{item.label}</div>
          <div className="truncate text-[11px] text-slate-400 [@media(max-height:780px)]:hidden">{item.subtitle}</div>
        </div>
        <Icon name="lock" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      onClick={onClick}
      className={({ isActive }) =>
        "group mx-1 flex items-center gap-3 rounded-2xl px-3 py-2.5 transition " +
        (isActive && !forceInactive
          ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-800"
          : "text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-900")
      }
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-slate-700 ring-1 ring-slate-200 group-hover:bg-slate-50 group-[.active]:bg-gradient-to-br group-[.active]:from-brand-50 group-[.active]:to-accent-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-800 dark:group-hover:bg-slate-800 dark:group-[.active]:from-slate-800 dark:group-[.active]:to-slate-700">
        <Icon name={item.icon} className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold">{item.label}</div>
        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400 [@media(max-height:780px)]:hidden">{item.subtitle}</div>
      </div>
    </NavLink>
  );
}

export default function Layout() {
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [apiStatus, setApiStatus] = useState("unknown"); // unknown | ok | down
  const [search, setSearch] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("ea_theme") || "system");
  const profileRef = useRef(null);
  const notifRef = useRef(null);
  const helpRef = useRef(null);
  const feedbackRef = useRef(null);
  const [notifications, setNotifications] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [helpName, setHelpName] = useState("");
  const [helpEmail, setHelpEmail] = useState("");
  const [helpMessage, setHelpMessage] = useState("");
  const [helpSending, setHelpSending] = useState(false);
  const [helpSent, setHelpSent] = useState(false);
  const [helpError, setHelpError] = useState(null);
  const [feedbackName, setFeedbackName] = useState("");
  const [feedbackEmail, setFeedbackEmail] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackError, setFeedbackError] = useState(null);
  const [showInviteUpgrade, setShowInviteUpgrade] = useState(false);
  const creditBalance = useAuthStore((s) => s.creditBalance);
  const refreshCreditBalance = useAuthStore((s) => s.refreshCreditBalance);

  const workspaceName = useWorkspaceStore((s) => s.workspaceName);
  const workspaceLogo = useWorkspaceStore((s) => s.workspaceLogo);
  const decisionStatus = useWorkspaceStore((s) => s.decisionStatus);
  const serviceDecisionStatus = useWorkspaceStore((s) => s.serviceDecisionStatus);
  const isMemberMode = useWorkspaceStore((s) => s.isMemberMode);
  const memberPermissionType = useWorkspaceStore((s) => s.memberPermissionType);
  const memberPermissions = useWorkspaceStore((s) => s.memberPermissions);
  const memberWorkspaceName = useWorkspaceStore((s) => s.memberWorkspaceName);

  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);
  const setWorkspaceLogo = useWorkspaceStore((s) => s.setWorkspaceLogo);
  const setWorkspaceCompanyName = useWorkspaceStore((s) => s.setWorkspaceCompanyName);
  const workspaceCompanyName = useWorkspaceStore((s) => s.workspaceCompanyName);
  const setDecisionStatus = useWorkspaceStore((s) => s.setDecisionStatus);
  const setServiceDecisionStatus = useWorkspaceStore((s) => s.setServiceDecisionStatus);
  const setWorkspaceLoadedAt = useWorkspaceStore((s) => s.setWorkspaceLoadedAt);
  const setIdeaValidation = useWorkspaceStore((s) => s.setIdeaValidation);
  const setDraftIdeaValidation = useWorkspaceStore((s) => s.setDraftIdeaValidation);
  const setDraftServiceIdea = useWorkspaceStore((s) => s.setDraftServiceIdea);
  const setInputs = useWorkspaceStore((s) => s.setInputs);
  const setCurrency = useWorkspaceStore((s) => s.setCurrency);
  const setValidation = useWorkspaceStore((s) => s.setValidation);
  const setMemberMode = useWorkspaceStore((s) => s.setMemberMode);
  const clearMemberMode = useWorkspaceStore((s) => s.clearMemberMode);

  const enableHealthCheck = String(import.meta.env.ENABLE_HEALTH_CHECK ?? "false").toLowerCase() === "true";
  const acceptedAny = decisionStatus === "accepted" || serviceDecisionStatus === "accepted";
  const rejectedAny = decisionStatus === "rejected" || serviceDecisionStatus === "rejected";
  const workspaceDisplayName = isMemberMode
    ? (memberWorkspaceName || "Shared workspace")
    : (workspaceCompanyName || workspaceName || "My workspace");
  const email = useAuthStore((s) => s.email);
  const userName = useAuthStore((s) => s.name);
  const userPicture = useAuthStore((s) => s.picture);
  const platformRestrictions = useAuthStore((s) => s.platformRestrictions);
  const platformGrants = useAuthStore((s) => s.platformGrants);
  const subscription = useAuthStore((s) => s.subscription);
  const profileInitials = userName
    ? (userName.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || initialsFromEmail(email))
    : initialsFromEmail(email);

  useEffect(() => {
    if (theme === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    if (theme === "system") {
      localStorage.removeItem("ea_theme");
    } else {
      localStorage.setItem("ea_theme", theme);
    }
  }, [theme]);

  useEffect(() => {
    if (!profileOpen) return;
    function handleClick(e) {
      if (!profileRef.current || profileRef.current.contains(e.target)) return;
      setProfileOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [profileOpen]);

  useEffect(() => {
    if (!notifOpen) return;
    function handleClick(e) {
      if (!notifRef.current || notifRef.current.contains(e.target)) return;
      setNotifOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [notifOpen]);

  useEffect(() => {
    if (!helpOpen && !feedbackOpen) return;
    function handleClick(e) {
      if ((helpRef.current && helpRef.current.contains(e.target)) || (feedbackRef.current && feedbackRef.current.contains(e.target))) return;
      setHelpOpen(false);
      setFeedbackOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [helpOpen, feedbackOpen]);

  async function submitHelpForm(e) {
    e.preventDefault();
    if (!helpMessage.trim()) return;
    setHelpSending(true);
    setHelpError(null);
    try {
      await apiRequest("/support/message", "POST", {
        name: helpName.trim(),
        email: helpEmail.trim(),
        message: helpMessage.trim(),
        type: "support",
      });
      setHelpSent(true);
      setHelpName(""); setHelpEmail(""); setHelpMessage("");
    } catch (err) {
      setHelpError(err instanceof Error ? err.message : "Failed to send message. Please try again.");
    } finally {
      setHelpSending(false);
    }
  }

  async function submitFeedbackForm(e) {
    e.preventDefault();
    if (!feedbackMessage.trim()) return;
    setFeedbackSending(true);
    setFeedbackError(null);
    try {
      await apiRequest("/support/message", "POST", {
        name: feedbackName.trim(),
        email: feedbackEmail.trim(),
        message: feedbackMessage.trim(),
        type: "feedback",
      });
      setFeedbackSent(true);
      setFeedbackName(""); setFeedbackEmail(""); setFeedbackMessage("");
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : "Failed to send feedback. Please try again.");
    } finally {
      setFeedbackSending(false);
    }
  }

  useEffect(() => {
    if (!enableHealthCheck) return;
    let cancelled = false;

    async function ping() {
      try {
        const res = await fetch(`${getApiBaseUrl()}/health`, { method: "GET" });
        if (cancelled) return;
        setApiStatus(res.ok ? "ok" : "down");
      } catch {
        if (cancelled) return;
        setApiStatus("down");
      }
    }

    ping();
    const id = setInterval(ping, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enableHealthCheck]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function validateSession() {
      try {
        await apiRequest("/auth/me", "GET");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e || "");
        if (!cancelled && msg.startsWith("HTTP 401:")) {
          logout();
          navigate("/login", { replace: true });
        }
      }
    }

    validateSession();
    return () => {
      cancelled = true;
    };
  }, [token, logout, navigate]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function loadWorkspace() {
      // If already in member mode (persisted), reload the owner's workspace first
      const persisted = useWorkspaceStore.getState();
      if (persisted.isMemberMode && persisted.membershipId) {
        try {
          const memberships = await apiRequest("/workspace/me/memberships", "GET");
          if (cancelled) return;
          const membership = Array.isArray(memberships) && memberships.length > 0
            ? memberships.find((entry) => entry.id === persisted.membershipId) || memberships[0]
            : null;
          if (membership) {
            setWorkspaceId(membership.workspace_id);
            setWorkspaceName(membership.workspace_name || null);
            setWorkspaceLogo(null);
            setWorkspaceLoadedAt(new Date().toISOString());
            setMemberMode(membership.id, membership.permission_type, membership.permissions, membership.workspace_name || "Shared workspace");
            setDecisionStatus(null);
            setServiceDecisionStatus(null);
            return; // Done — member mode successfully reloaded
          }
        } catch {
          // Membership no longer valid — fall through to own workspace
        }
      }

      try {
        const ws = await apiRequest("/validation/me", "GET");
        if (cancelled || !ws) return;

        // User has their own workspace — owner mode
        clearMemberMode();
        setWorkspaceId(ws.id || null);
        setWorkspaceName(ws.name || null);
        setWorkspaceLogo(ws?.data?.workspace_profile?.logo_data_url || null);
        setWorkspaceCompanyName(ws?.data?.workspace_profile?.company_name || null);
        setWorkspaceLoadedAt(new Date().toISOString());
        const rfqList = ws?.data?.financials?.rfq_requests;
        if (Array.isArray(rfqList)) setNotifications(rfqList.filter((r) => r.status === "pending"));
        const status = ws?.data?.decision?.status;
        if (status === "accepted" || status === "rejected") setDecisionStatus(status);
        else setDecisionStatus(null);
        const acceptedServiceEntry = getAcceptedServiceValidationEntry(ws?.data);
        if (acceptedServiceEntry?.decision_status === "accepted") {
          setServiceDecisionStatus("accepted");
          if (acceptedServiceEntry?.result) setValidation(acceptedServiceEntry.result);
          if (acceptedServiceEntry?.payload) setDraftServiceIdea(acceptedServiceEntry.payload);
        } else {
          setServiceDecisionStatus(null);
        }
        setIdeaValidation(ws?.data?.idea_validation ?? null);
        setDraftIdeaValidation(ws?.data?.draft_idea_validation ?? null);
        if (!acceptedServiceEntry?.payload) setDraftServiceIdea(ws?.data?.draft_service_idea ?? null);
        if (ws?.data?.inputs || ws?.data?.assumptions) setInputs(ws.data.inputs || ws.data.assumptions);
        const currency =
          ws?.data?.idea_validation?.context?.currency ||
          ws?.data?.business_profile?.currency ||
          ws?.data?.business_context?.currency;
        if (currency) setCurrency(currency);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e || "");
        if (msg.startsWith("HTTP 404:")) {
          // No own workspace — check if user is a member of another workspace
          if (cancelled) return;
          try {
            const memberships = await apiRequest("/workspace/me/memberships", "GET");
            if (cancelled) return;
            if (Array.isArray(memberships) && memberships.length > 0) {
              const membership = memberships[0]; // use the first (most recent) membership
              setWorkspaceId(membership.workspace_id);
              setWorkspaceName(membership.workspace_name || null);
              setWorkspaceLogo(null);
              setWorkspaceLoadedAt(new Date().toISOString());
              setMemberMode(
                membership.id,
                membership.permission_type,
                membership.permissions,
                membership.workspace_name || "Shared workspace"
              );
              setDecisionStatus(null);
              setServiceDecisionStatus(null);
            } else {
              // No memberships either
              setWorkspaceId(null);
              setWorkspaceName(null);
              setWorkspaceLogo(null);
              setDecisionStatus(null);
              setServiceDecisionStatus(null);
              clearMemberMode();
            }
          } catch {
            setWorkspaceId(null);
            setWorkspaceName(null);
            setWorkspaceLogo(null);
            setDecisionStatus(null);
            setServiceDecisionStatus(null);
            clearMemberMode();
          }
        }
      }
    }

    loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [token, setCurrency, setDecisionStatus, setDraftIdeaValidation, setDraftServiceIdea, setIdeaValidation, setInputs, setServiceDecisionStatus, setValidation, setWorkspaceId, setWorkspaceLogo, setWorkspaceName, setWorkspaceLoadedAt, setMemberMode, clearMemberMode]);

  useEffect(() => {
    if (!token) return;
    refreshCreditBalance();

    // Poll every 30s so balance stays current after AI actions
    const id = setInterval(refreshCreditBalance, 30_000);

    // Also refresh when the user returns to the tab
    function onFocus() { refreshCreditBalance(); }
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [token]);

  const filteredNav = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    const base = !q ? NAV : NAV.filter((i) => `${i.label} ${i.subtitle}`.toLowerCase().includes(q));
    return base.map((item) => {
      if (item.public) return { ...item, locked: false, planLocked: false };
      const planLocked = !planHasModuleAccess(
        subscription?.plan_key ?? "free_trial",
        item.moduleKey,
        subscription?.status ?? "trial",
      ) && !isPlatformModuleGranted(item.moduleKey, platformGrants);
      const adminLocked = isPlatformModuleRestricted(item.moduleKey, platformRestrictions);
      const memberLocked = isMemberMode && !hasModuleAccess(item.moduleKey, memberPermissionType, memberPermissions);
      return {
        ...item,
        locked: adminLocked || memberLocked || planLocked,
        planLocked,
      };
    });
  }, [search, isMemberMode, memberPermissionType, memberPermissions, platformRestrictions, platformGrants, subscription]);

  // Determine if the current route is locked for this member
  const currentRouteModuleKey = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith("/dashboard")) return "dashboard";
    if (path.startsWith("/validation") || path.startsWith("/results")) return "validation";
    if (path.startsWith("/blueprint")) return "blueprint";
    if (path.startsWith("/simulation")) return "simulation";
    if (path.startsWith("/catalogue")) return "catalogue";
    if (path.startsWith("/financials")) return "financials";
    if (path.startsWith("/registration")) return "registration";
    if (path.startsWith("/reports")) return "reports";
    return null;
  }, [location.pathname]);

  const isCurrentRoutePlanLocked = currentRouteModuleKey
    ? !planHasModuleAccess(subscription?.plan_key ?? "free_trial", currentRouteModuleKey, subscription?.status ?? "trial")
    && !isPlatformModuleGranted(currentRouteModuleKey, platformGrants)
    : false;

  const isCurrentRouteLocked =
    (currentRouteModuleKey && isPlatformModuleRestricted(currentRouteModuleKey, platformRestrictions)) ||
    (isMemberMode && currentRouteModuleKey && !hasModuleAccess(currentRouteModuleKey, memberPermissionType, memberPermissions)) ||
    isCurrentRoutePlanLocked;

  const isCreateWorkspaceRoute =
    location.pathname === "/validation" &&
    new URLSearchParams(location.search).get("from") === "module";

  const Sidebar = (
    <aside className="flex h-full w-[260px] flex-col border-r border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-950 lg:w-[280px] lg:px-5">
      <div className="mx-1 flex items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <a href="/" className="cursor-pointer">
              <img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto object-contain sm:h-8" />
            </a>
            <span className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">Beta</span>
          </div>
        </div>
        <button className="md:hidden rounded-xl p-2 text-slate-600 hover:bg-slate-100" onClick={() => setMobileOpen(false)}>
          <Icon name="x" />
        </button>
      </div>

      {/* Member mode badge */}
      {isMemberMode && (
        <div className="mx-1 mt-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600">
              <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">Guest access</div>
              <div className="truncate text-[11px] font-medium text-slate-700 dark:text-slate-300">{memberWorkspaceName || "Shared workspace"}</div>
            </div>
          </div>
        </div>
      )}

      <nav className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {filteredNav.map((item) => (
          <SidebarLink
            key={item.to}
            item={item}
            onClick={() => setMobileOpen(false)}
            forceInactive={item.to === "/validation" && isCreateWorkspaceRoute}
            locked={item.locked}
          />
        ))}
      </nav>

      <div className="mt-3 shrink-0 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {isMemberMode ? "Shared workspace" : "Workspace"}
          </div>
          {enableHealthCheck ? (
            <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
              <span
                className={
                  "inline-flex h-2 w-2 rounded-full " +
                  (apiStatus === "ok" ? "bg-emerald-500" : apiStatus === "down" ? "bg-rose-500" : "bg-slate-300")
                }
                title={apiStatus}
              />
              <span className="dark:text-slate-400">{apiStatus === "ok" ? "Online" : apiStatus === "down" ? "Offline" : "Checking..."}</span>
            </div>
          ) : null}
        </div>
        <div className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">{workspaceDisplayName}</div>
        {isMemberMode ? (
          <>
            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2 py-1 text-[11px] font-semibold text-brand-700 dark:bg-slate-800 dark:text-brand-400">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Guest member
            </div>
          </>
        ) : (
          <>
            {/* Row: plan badge + credits pill */}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => navigate("/pricing")}
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold transition " +
                  (subscription?.plan_key && !["free_trial", "explorer"].includes(subscription.plan_key)
                    ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
                    : "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-slate-800 dark:text-brand-400 dark:hover:bg-slate-700")
                }
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2Z" />
                </svg>
                {planLabel(subscription?.plan_key, subscription?.status)}
              </button>
              {creditBalance !== null && (
                <div className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700 dark:bg-violet-900/20 dark:text-violet-400">
                  <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                  {creditBalance}
                </div>
              )}
              {(!subscription?.plan_key || ["free_trial", "explorer"].includes(subscription.plan_key)) && (
                <button
                  type="button"
                  onClick={() => navigate("/pricing")}
                  className="text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  Upgrade →
                </button>
              )}
            </div>
            {/* Status line — only show when there's a meaningful status */}
            {(acceptedAny || rejectedAny) && (
              <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                {acceptedAny ? "Workspace verified" : "Needs review"}
              </div>
            )}
            {showInviteUpgrade ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/40 dark:bg-amber-900/20">
                <p className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">Upgrade to invite members</p>
                <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">Team invitations are available on paid plans.</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => navigate("/pricing")}
                    className="flex-1 rounded-lg bg-amber-600 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-700 transition"
                  >
                    Upgrade plan
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowInviteUpgrade(false)}
                    className="rounded-lg border border-amber-200 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 transition dark:border-amber-700 dark:text-amber-400"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const isFreePlan = !subscription?.plan_key || ["free_trial", "explorer"].includes(subscription.plan_key);
                  if (isFreePlan) { setShowInviteUpgrade(true); return; }
                  setInviteOpen(true);
                }}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-brand-700 transition"
              >
                <Icon name="user-plus" className="h-3.5 w-3.5" />
                Invite member
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );

  return (
    <div className="relative h-[100dvh] bg-slate-50 dark:bg-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-purple-50 via-blue-50 to-purple-50 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900" />
      <div className="pointer-events-none absolute -top-24 left-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-purple-200/35 blur-3xl dark:bg-purple-900/30" />
      <div className="pointer-events-none absolute -bottom-24 left-2/3 h-72 w-72 -translate-x-1/2 rounded-full bg-blue-200/30 blur-3xl dark:bg-blue-900/20" />

      <div className="relative flex h-full w-full overflow-hidden">
        <div className="hidden md:block">{Sidebar}</div>

        {mobileOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
            <div className="absolute inset-y-0 left-0">{Sidebar}</div>
          </div>
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
            {/* Member mode top banner */}
            {isMemberMode && (
              <div className="flex items-center gap-2 border-b border-brand-100 bg-brand-50 px-4 py-1.5 text-[12px] font-medium text-brand-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-brand-300">
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>You're viewing <strong>{memberWorkspaceName || "a shared workspace"}</strong> as a guest. Only your granted modules are accessible.</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6">
              <div className="flex items-center gap-2 md:hidden">
                <button
                  className="rounded-xl p-2 text-slate-700 hover:bg-slate-100"
                  onClick={() => setMobileOpen(true)}
                  aria-label="Open menu"
                >
                  <Icon name="menu" />
                </button>
              </div>

              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="w-full max-w-[220px] md:max-w-xs">
                  <input
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none ring-brand-200 focus:ring dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="Search modules..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              {/* Feedback */}
              <div className="relative shrink-0" ref={feedbackRef}>
                <button
                  type="button"
                  onClick={() => {
                    setFeedbackOpen((v) => !v);
                    setHelpOpen(false);
                    setFeedbackSent(false);
                    setFeedbackError(null);
                  }}
                  className="relative flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Feedback
                </button>
                {feedbackOpen && (
                  <div className="absolute right-0 top-11 z-30 w-80 max-w-[calc(100vw-1rem)] rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                      <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">Feedback</span>
                      <button type="button" onClick={() => setFeedbackOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </div>
                    {feedbackSent ? (
                      <div className="px-4 py-8 text-center">
                        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-900/20">
                          <svg className="h-5 w-5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                        </div>
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Thanks for your feedback!</p>
                        <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">We appreciate your input and will review it shortly.</p>
                        <button type="button" onClick={() => { setFeedbackSent(false); setFeedbackOpen(false); }} className="mt-4 rounded-xl bg-brand-600 px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-700">Close</button>
                      </div>
                    ) : (
                      <form onSubmit={submitFeedbackForm} className="px-4 py-4 space-y-3">
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-400">Your name</label>
                          <input
                            type="text"
                            value={feedbackName}
                            onChange={(e) => setFeedbackName(e.target.value)}
                            placeholder="Jane Doe"
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-800 placeholder-slate-400 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-400">Email address</label>
                          <input
                            type="email"
                            value={feedbackEmail}
                            onChange={(e) => setFeedbackEmail(e.target.value)}
                            placeholder="jane@example.com"
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-800 placeholder-slate-400 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-400">Message <span className="text-rose-500">*</span></label>
                          <textarea
                            value={feedbackMessage}
                            onChange={(e) => setFeedbackMessage(e.target.value)}
                            placeholder="Share feedback, ideas, or things we can improve..."
                            rows={4}
                            required
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-800 placeholder-slate-400 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 resize-none"
                          />
                        </div>
                        {feedbackError && <p className="text-[11px] text-rose-600 dark:text-rose-400">{feedbackError}</p>}
                        <button
                          type="submit"
                          disabled={feedbackSending || !feedbackMessage.trim()}
                          className="w-full rounded-xl bg-brand-600 py-2 text-[12px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {feedbackSending ? "Sending…" : "Send feedback"}
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>

              {/* Help & Support */}
              <div className="relative shrink-0" ref={helpRef}>
                <button
                  type="button"
                  onClick={() => {
                    setHelpOpen((v) => !v);
                    setFeedbackOpen(false);
                    setHelpSent(false);
                    setHelpError(null);
                    setFeedbackSent(false);
                    setFeedbackError(null);
                  }}
                  className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  aria-label="Help & Support"
                >
                  <Icon name="help" className="h-4 w-4" />
                </button>
                {helpOpen && (
                  <div className="absolute right-0 top-11 z-30 w-80 max-w-[calc(100vw-1rem)] rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                      <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">Help & Support</span>
                      <button type="button" onClick={() => setHelpOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </div>
                    {helpSent ? (
                      <div className="px-4 py-8 text-center">
                        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-900/20">
                          <svg className="h-5 w-5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                        </div>
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Message sent!</p>
                        <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">We'll get back to you as soon as possible.</p>
                        <button type="button" onClick={() => { setHelpSent(false); setHelpOpen(false); }} className="mt-4 rounded-xl bg-brand-600 px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-700">Close</button>
                      </div>
                    ) : (
                      <form onSubmit={submitHelpForm} className="px-4 py-4 space-y-3">
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-400">Your name</label>
                          <input
                            type="text"
                            value={helpName}
                            onChange={(e) => setHelpName(e.target.value)}
                            placeholder="Jane Doe"
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-800 placeholder-slate-400 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-400">Email address</label>
                          <input
                            type="email"
                            value={helpEmail}
                            onChange={(e) => setHelpEmail(e.target.value)}
                            placeholder="jane@example.com"
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-800 placeholder-slate-400 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-400">Message <span className="text-rose-500">*</span></label>
                          <textarea
                            value={helpMessage}
                            onChange={(e) => setHelpMessage(e.target.value)}
                            placeholder="Describe your issue or question..."
                            rows={4}
                            required
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-800 placeholder-slate-400 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 resize-none"
                          />
                        </div>
                        {helpError && <p className="text-[11px] text-rose-600 dark:text-rose-400">{helpError}</p>}
                        <button
                          type="submit"
                          disabled={helpSending || !helpMessage.trim()}
                          className="w-full rounded-xl bg-brand-600 py-2 text-[12px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {helpSending ? "Sending…" : "Send message"}
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>

              {/* Notification bell */}
              <div className="relative shrink-0" ref={notifRef}>
                <button
                  type="button"
                  onClick={() => setNotifOpen((v) => !v)}
                  className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  aria-label="Notifications"
                >
                  <Icon name="bell" className="h-4 w-4" />
                  {notifications.length > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white">
                      {notifications.length > 9 ? "9+" : notifications.length}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <div className="absolute right-0 top-11 z-30 w-72 rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                      <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">Notifications</span>
                      {notifications.length > 0 && (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
                          {notifications.length} pending
                        </span>
                      )}
                    </div>
                    <div className="max-h-80 overflow-auto">
                      {notifications.length ? (
                        notifications.map((rfq) => (
                          <button
                            key={rfq.id}
                            type="button"
                            className="flex w-full flex-col items-start gap-0.5 border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                            onClick={() => { setNotifOpen(false); navigate("/financials"); }}
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <span className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">{rfq.customer_name}</span>
                              <span className="shrink-0 rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:bg-sky-900/30 dark:text-sky-400">RFQ</span>
                            </div>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">{rfq.customer_email}</span>
                            {rfq.items?.length > 0 && (
                              <span className="text-[10px] text-slate-400">{rfq.items.map((i) => i.name).join(", ")}</span>
                            )}
                            <span className="text-[10px] text-slate-400">{rfq.created_at ? new Date(rfq.created_at).toLocaleDateString() : ""}</span>
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-6 text-center text-[12px] text-slate-500 dark:text-slate-400">No new notifications</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="relative flex items-center gap-2" ref={profileRef}>
                <button
                  type="button"
                  onClick={() => setProfileOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                >
                  {workspaceLogo ? (
                    <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white">
                      <img
                        src={workspaceLogo}
                        alt={workspaceDisplayName || "Workspace logo"}
                        className="h-full w-full object-contain"
                        onError={(e) => { e.currentTarget.style.display = "none"; e.currentTarget.parentElement.innerHTML = `<span class="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white text-xs font-semibold">${profileInitials}</span>`; }}
                      />
                    </span>
                  ) : userPicture ? (
                    <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white">
                      <img src={userPicture} alt={userName || email} className="h-full w-full object-cover" />
                    </span>
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white">
                      {profileInitials}
                    </span>
                  )}
                </button>
                {profileOpen ? (
                  <div className="absolute right-0 top-12 z-30 w-56 rounded-2xl border border-slate-200 bg-white p-2 text-xs shadow-xl dark:border-slate-800 dark:bg-slate-900">
                    <div className="px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Account</div>
                      {(userName || email) && (
                        <div className="mt-0.5 truncate text-[12px] font-medium text-slate-700 dark:text-slate-200">{userName || email}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                      onClick={() => { setProfileOpen(false); navigate("/account"); }}
                    >
                      Account settings
                    </button>
                    {email === "tech.support@enterprateai.com" && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                        onClick={() => { setProfileOpen(false); navigate("/ent-admin"); }}
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0"><path fillRule="evenodd" d="M9.661 2.237a.531.531 0 01.678 0 11.947 11.947 0 007.078 2.749.5.5 0 01.479.425c.069.52.104 1.05.104 1.589 0 5.162-3.26 9.563-7.834 11.256a.48.48 0 01-.332 0C5.26 16.563 2 12.162 2 7c0-.538.035-1.069.104-1.589a.5.5 0 01.48-.425 11.947 11.947 0 007.077-2.749z" clipRule="evenodd" /></svg>
                        Admin dashboard
                      </button>
                    )}
                    {!isMemberMode && (
                      <>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                          onClick={() => {
                            setProfileOpen(false);
                            const returnTo = encodeURIComponent(location.pathname + location.search);
                            navigate(`/validation?from=module&return=${returnTo}`);
                          }}
                        >
                          Edit workspace
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                          onClick={() => {
                            setProfileOpen(false);
                            navigate("/team");
                          }}
                        >
                          Team & access
                        </button>
                      </>
                    )}
                    <div className="mt-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Appearance</div>
                    {[
                      { value: "system", label: "System" },
                      { value: "light", label: "Light" },
                      { value: "dark", label: "Dark" }
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                        onClick={() => setTheme(opt.value)}
                      >
                        <span>{opt.label}</span>
                        <span
                          className={
                            "h-2 w-2 rounded-full " +
                            (theme === opt.value ? "bg-brand-600" : "bg-slate-200")
                          }
                        />
                      </button>
                    ))}
                    <div className="my-2 h-px bg-slate-200 dark:bg-slate-800" />
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      onClick={() => {
                        setProfileOpen(false);
                        logout();
                        navigate("/login");
                      }}
                    >
                      Log out
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <div className="ea-scroll flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-7xl p-4 pb-24 md:p-6 md:pb-24">
              {isCurrentRouteLocked ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <div className={
                    "flex h-16 w-16 items-center justify-center rounded-full " +
                    (isCurrentRoutePlanLocked ? "bg-brand-50 dark:bg-brand-900/20" : "bg-slate-100 dark:bg-slate-800")
                  }>
                    {isCurrentRoutePlanLocked ? (
                      <svg className="h-7 w-7 text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2Z" />
                      </svg>
                    ) : (
                      <Icon name="lock" className="h-7 w-7 text-slate-400" />
                    )}
                  </div>
                  {isCurrentRoutePlanLocked ? (
                    <>
                      <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Upgrade to unlock this module</h2>
                      <p className="mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                        This feature isn't included in your current plan (<strong>{planLabel(subscription?.plan_key, subscription?.status)}</strong>).
                        Upgrade to access it.
                      </p>
                      <div className="mt-6 flex gap-3">
                        <button
                          type="button"
                          onClick={() => navigate("/pricing")}
                          className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition"
                        >
                          View plans & upgrade
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate("/dashboard")}
                          className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          Back to dashboard
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Access restricted</h2>
                      <p className="mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                        You don't have permission to view this module. Contact the workspace owner to request access.
                      </p>
                      <button
                        type="button"
                        onClick={() => navigate("/dashboard")}
                        className="mt-6 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition"
                      >
                        Back to dashboard
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <Outlet />
              )}
            </div>
          </div>
          <BusinessAssistant />
        </main>
      </div>
      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} />}
    </div>
  );
}
