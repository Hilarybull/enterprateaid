import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Button from "../components/Button";
import Badge from "../components/Badge";
import Spinner from "../components/Spinner";
import ApplyModal from "../components/proposals/ApplyModal";
import { apiRequest } from "../api/client";
import { useAuthStore } from "../store/auth";
import { readProposalContext } from "../lib/proposalContext";
import { getVisitorId } from "../lib/visitorId";
import enterprateLogo from "../logo.png";

function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function label(v) {
  return String(v || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Company profile shown as an inline popup — not a separate navigation. */
function CompanyProfilePopup({ company, onClose }) {
  if (!company) return null;
  const initials = (company.company_name || "B").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            {company.logo_data_url ? (
              <img src={company.logo_data_url} alt="" className="h-11 w-11 rounded-xl object-cover" />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-sm font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{initials}</div>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">{company.company_name}</h2>
              {company.location ? <p className="truncate text-xs text-slate-500">{company.location}</p> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <div className="flex flex-wrap gap-1.5">
            {company.primary_industry ? <Badge tone="slate">{label(company.primary_industry)}</Badge> : null}
            {company.business_type ? <Badge tone="slate">{label(company.business_type)}</Badge> : null}
            {company.is_open_to_proposals ? <Badge tone="success">Open to proposals</Badge> : null}
          </div>
          {company.tagline ? <p className="font-medium text-slate-700 dark:text-slate-200">{company.tagline}</p> : null}
          {company.about_company ? (
            <p className="whitespace-pre-wrap leading-relaxed text-slate-600 dark:text-slate-300">{company.about_company}</p>
          ) : (
            <p className="text-slate-400">This business hasn't added a full profile yet.</p>
          )}
          {(company.website || company.linkedin_url) ? (
            <div className="flex flex-wrap gap-3 pt-1 text-[13px]">
              {company.website ? (
                <a href={company.website.startsWith("http") ? company.website : `https://${company.website}`} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline dark:text-brand-400">Website ↗</a>
              ) : null}
              {company.linkedin_url ? (
                <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline dark:text-brand-400">LinkedIn ↗</a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ProposalRequestDetailPage() {
  const { requestId } = useParams();
  const token = useAuthStore((s) => s.token);
  const [request, setRequest] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applyOpen, setApplyOpen] = useState(() => {
    // Returning from the "Use EnterprateAI" round-trip — reopen the modal.
    const ctx = readProposalContext();
    return Boolean((ctx?.blueprintReturn?.attachment || ctx?.draft) && ctx.requestId === requestId);
  });
  const [profileOpen, setProfileOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Watchdog — never leave the page spinning if the request hangs or a
    // backend error slips past apiRequest's own timeout.
    const watchdog = setTimeout(() => {
      if (!cancelled) { setError("This request is taking too long to load. Please try again shortly."); setLoading(false); }
    }, 15000);
    apiRequest(`/proposals/public/requests/${requestId}`, "GET", undefined, {
      headers: { "X-Visitor-Id": getVisitorId() },
    })
      .then((d) => { if (!cancelled) { setRequest(d); setError(null); } })
      .catch((e) => {
        if (cancelled) return;
        const m = (e instanceof Error ? e.message : "").replace(/^HTTP \d+:\s*/i, "");
        setError(
          /404|not found/i.test(m) ? "This request isn't available — it may have been closed or removed."
          : /network_error|failed to fetch/i.test(m) ? "Couldn't reach the server. Check your connection and try again."
          : m || "This request isn't available right now.",
        );
      })
      .finally(() => { if (!cancelled) { clearTimeout(watchdog); setLoading(false); } });
    return () => { cancelled = true; clearTimeout(watchdog); };
  }, [requestId]);

  function share() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (navigator.share) {
      navigator.share({ title: request?.title || "Proposal request", url }).catch(() => {});
      return;
    }
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const deadline = fmtDate(request?.deadline);
  const deadlinePassed = (() => {
    if (!request?.deadline) return false;
    const d = new Date(request.deadline); const t = new Date(); t.setHours(0, 0, 0, 0);
    return !Number.isNaN(d.getTime()) && d < t;
  })();
  const closed = request && (request.status !== "PUBLISHED" || deadlinePassed);
  const company = request?.company;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f8fafc_45%,#f8fafc_100%)] dark:bg-slate-950">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/marketplace" className="flex items-center gap-2">
            <img src={enterprateLogo} alt="EnterprateAI" className="h-6 w-auto max-w-[130px] object-contain sm:h-7" />
          </Link>
          <Link to="/marketplace?tab=requests" className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400">Browse marketplace</Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 pb-16 pt-8 sm:px-6">
        <Link
          to="/marketplace?tab=requests"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
          All proposal requests
        </Link>
        {loading ? (
          <div className="flex justify-center py-20"><Spinner size={24} /></div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-white px-5 py-6 text-center dark:border-rose-900/50 dark:bg-slate-900">
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">This request isn't available</div>
            <p className="mt-2 text-sm text-slate-500">{error}</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">{String(request.type || "general").replace(/^\w/, (c) => c.toUpperCase())}</Badge>
                {closed ? <Badge tone="slate">Closed</Badge> : <Badge tone="success">Accepting proposals</Badge>}
              </div>
              <button
                type="button"
                onClick={share}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:text-slate-300"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
                {copied ? "Link copied ✓" : "Share"}
              </button>
            </div>

            <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{request.title}</h1>
            {request.company_name ? (
              <p className="mt-1 text-sm text-slate-500">
                Posted by{" "}
                {company ? (
                  <button type="button" onClick={() => setProfileOpen(true)} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                    {request.company_name}
                  </button>
                ) : (
                  <span className="font-medium text-slate-600 dark:text-slate-300">{request.company_name}</span>
                )}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600 dark:text-slate-300">
              {deadline ? <span>Deadline: <strong>{deadline}</strong></span> : null}
              {request.budget_visible && request.budget_range ? (
                <span>Budget: <strong>{request.budget_currency ? `${request.budget_currency} ` : ""}{request.budget_range}</strong></span>
              ) : null}
              {request.submission_cap ? <span>Submissions accepted: {request.submission_count}/{request.submission_cap}</span> : null}
              {request.is_owner ? (
                <span>{request.view_count || 0} view{request.view_count === 1 ? "" : "s"}</span>
              ) : null}
            </div>

            {request.description ? (
              <div className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {request.description}
              </div>
            ) : null}

            {(request.requirements || []).length ? (
              <div className="mt-6">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Requirements</div>
                <ul className="mt-2 space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
                  {request.requirements.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-brand-500">•</span>
                      <span>{r.text}{r.mandatory ? <span className="ml-1 text-xs text-rose-500">(required)</span> : null}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-5 dark:border-slate-800">
              {request.is_owner ? (
                <p className="text-sm text-slate-500">This is your request. Manage submissions in <Link className="text-brand-600 hover:underline" to="/financials?tab=proposals">Proposals</Link>.</p>
              ) : closed ? (
                <p className="text-sm text-slate-500">This request is no longer accepting proposals.</p>
              ) : (
                <Button onClick={() => setApplyOpen(true)}>
                  {token ? "Submit a proposal" : "Sign in to submit a proposal"}
                </Button>
              )}
              {company && !request.is_owner ? (
                <Button variant="secondary" onClick={() => setProfileOpen(true)}>View company profile</Button>
              ) : null}
            </div>
          </div>
        )}
      </main>

      {profileOpen && company ? (
        <CompanyProfilePopup company={company} onClose={() => setProfileOpen(false)} />
      ) : null}

      {applyOpen && request ? (
        <ApplyModal
          recipientWorkspaceId={request.workspace_id}
          recipientName={request.company_name}
          request={{
            id: request.id,
            title: request.title,
            description: request.description,
            requirements: request.requirements || [],
          }}
          onClose={() => setApplyOpen(false)}
          onSubmitted={() => {}}
        />
      ) : null}
    </div>
  );
}
