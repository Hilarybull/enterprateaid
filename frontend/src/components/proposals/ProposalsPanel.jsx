import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import SectionCard from "../SectionCard";
import SegmentedTabs from "../SegmentedTabs";
import Button from "../Button";
import Input from "../Input";
import Badge from "../Badge";
import Spinner from "../Spinner";
import InlineAlert from "../InlineAlert";
import ConfirmDialog from "../ConfirmDialog";
import { useProposalStore, PROPOSAL_ACTIVE_STATUSES } from "../../store/proposals";
import { useWorkspaceStore } from "../../store/workspace";
import { useAuthStore } from "../../store/auth";
import { apiRequest, getApiBaseUrl } from "../../api/client";

// ── Status presentation ────────────────────────────────────────────────────
const STATUS_TONE = {
  SUBMITTED: "brand", VIEWED: "brand", UNDER_REVIEW: "brand",
  CLARIFICATION_REQUESTED: "warn", REVISION_REQUESTED: "warn",
  SHORTLISTED: "brand", PREFERRED: "brand", NEGOTIATION: "brand",
  AWARDED: "success", CONTRACT_DRAFTED: "success", CONTRACTED: "success",
  DECLINED: "danger", WITHDRAWN: "slate", EXPIRED: "slate", ARCHIVED: "slate",
};
const label = (s) => String(s || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

// Recipient-driven transitions → button labels
const RECIPIENT_ACTIONS = {
  SUBMITTED: [["UNDER_REVIEW", "Start review"], ["DECLINED", "Decline"]],
  VIEWED: [["UNDER_REVIEW", "Start review"], ["DECLINED", "Decline"]],
  UNDER_REVIEW: [["SHORTLISTED", "Shortlist"], ["CLARIFICATION_REQUESTED", "Request clarification"], ["DECLINED", "Decline"]],
  CLARIFICATION_REQUESTED: [["UNDER_REVIEW", "Back to review"]],
  REVISION_REQUESTED: [["UNDER_REVIEW", "Back to review"], ["DECLINED", "Decline"]],
  SHORTLISTED: [["PREFERRED", "Mark preferred"], ["DECLINED", "Decline"]],
  PREFERRED: [["NEGOTIATION", "Move to negotiation"], ["DECLINED", "Decline"]],
  NEGOTIATION: [["AWARDED", "Award"], ["DECLINED", "Decline"]],
  AWARDED: [["CONTRACT_DRAFTED", "Draft contract"]],
  CONTRACT_DRAFTED: [["CONTRACTED", "Mark contracted"]],
};

function StatusBadge({ status }) {
  return <Badge tone={STATUS_TONE[status] || "slate"}>{label(status)}</Badge>;
}

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function errText(e) {
  const raw = (e instanceof Error ? e.message : String(e || "")).replace(/^HTTP \d+:\s*/i, "");
  if (/network_error|failed to fetch|networkerror|load failed/i.test(raw)) return "Couldn't reach the server. Check your connection and try again.";
  if (/bearer token|not authenticated|401|unauthor/i.test(raw)) return "Your session has expired — please sign in again.";
  if (/greater than or equal to 1/i.test(raw)) return "Max submissions must be at least 1.";
  if (/greater than or equal to|less than or equal to|should be a valid|value_error/i.test(raw)) return "Some values are out of range — please check the form.";
  if (/^\s*(5\d\d|internal server)/i.test(raw) || /schema cache|does not exist|timed out/i.test(raw)) return "Something went wrong on our side. Please try again in a moment.";
  return raw || "Something went wrong.";
}

// ── Kebab (3-dot) row menu ────────────────────────────────────────────────
function RowMenu({ items, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const visible = (items || []).filter(Boolean);
  if (!visible.length) return null;
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {visible.map((it, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setOpen(false); it.onClick(); }}
              className={
                "block w-full px-3 py-2 text-left text-[13px] transition hover:bg-slate-50 dark:hover:bg-slate-800 " +
                (it.danger ? "text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-slate-200")
              }
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Message attachment uploader ──────────────────────────────────────────
function useUploader() {
  const token = useAuthStore((s) => s.token);
  const [uploading, setUploading] = useState(false);
  async function upload(files) {
    setUploading(true);
    const out = [];
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`${getApiBaseUrl()}/proposals/upload-attachment`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || "Upload failed");
        out.push(await res.json());
      }
    } finally {
      setUploading(false);
    }
    return out;
  }
  return { upload, uploading };
}

function FileChips({ files, onRemove }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {files.map((f, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {f.filename || `File ${i + 1}`}
          <button type="button" className="text-slate-400 hover:text-rose-500" onClick={() => onRemove(i)}>
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </span>
      ))}
    </div>
  );
}

function MsgAttachments({ items }) {
  if (!items?.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {items.map((a, i) => (
        <a key={i} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-brand-600 hover:bg-white/60 dark:border-slate-600 dark:text-brand-400">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
          {a.filename || "Download"}
        </a>
      ))}
    </div>
  );
}

function ClarificationThread({ thread, recipientName, proposerName }) {
  if (!thread.length) {
    return <p className="py-6 text-center text-sm text-slate-500">No clarification messages yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {thread.map((e, i) => {
        const fromRecipient = e.status === "CLARIFICATION_REQUESTED";
        return (
          <li
            key={i}
            className={
              "rounded-lg border p-2.5 text-sm " +
              (fromRecipient
                ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/15 dark:text-amber-200"
                : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300")
            }
          >
            <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide opacity-70">
              {fromRecipient ? `${recipientName || "Recipient"} asked` : `${proposerName || "Proposer"} replied`}
              {" · "}{fmtDate(e.timestamp)}
            </div>
            <div className="whitespace-pre-wrap">{e.reason}</div>
            <MsgAttachments items={e.attachments} />
          </li>
        );
      })}
    </ul>
  );
}

// ── Proposal detail modal ─────────────────────────────────────────────────
function ProposalDetail({ proposal, role, onClose, onChanged }) {
  const transitionStatus = useProposalStore((s) => s.transitionStatus);
  const reviseProposal = useProposalStore((s) => s.reviseProposal);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState("");
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseText, setReviseText] = useState(proposal.summary || "");
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [clarifyText, setClarifyText] = useState("");
  const [clarifyFiles, setClarifyFiles] = useState([]);
  const [replyText, setReplyText] = useState("");
  const [replyFiles, setReplyFiles] = useState([]);
  const [clarifyViewOpen, setClarifyViewOpen] = useState(false);
  const [full, setFull] = useState(proposal);
  const { upload, uploading } = useUploader();
  const clarifyFileRef = useRef(null);
  const replyFileRef = useRef(null);

  async function pickFiles(e, setter) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    setError(null);
    try {
      const metas = await upload(files);
      setter((prev) => [...prev, ...metas]);
    } catch (err) {
      setError(errText(err));
    }
  }

  useEffect(() => {
    // Opening as recipient marks it viewed / returns latest server state.
    let cancelled = false;
    apiRequest(`/proposals/${proposal.id}`, "GET")
      .then((d) => { if (!cancelled) { setFull(d); onChanged?.(d); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [proposal.id]); // eslint-disable-line

  const p = full;
  const actions = role === "recipient" ? (RECIPIENT_ACTIONS[p.status] || []) : [];
  const canWithdraw = role === "proposer" && PROPOSAL_ACTIVE_STATUSES.includes(p.status);
  const canRevise = role === "proposer" && p.status === "CLARIFICATION_REQUESTED";

  const clarificationNote =
    p.clarification_note ||
    [...(p.events || [])].reverse().find((e) => e.status === "CLARIFICATION_REQUESTED" && (e.reason || "").trim())?.reason ||
    null;
  const clarifyThread = (p.events || []).filter(
    (e) => ["CLARIFICATION_REQUESTED", "REVISION_REQUESTED"].includes(e.status) && (e.reason || "").trim(),
  );

  async function requestClarification() {
    if (!clarifyText.trim()) { setError("Write what you'd like the proposer to clarify."); return; }
    setBusy("CLARIFICATION_REQUESTED");
    setError(null);
    try {
      const row = await transitionStatus(p.id, "CLARIFICATION_REQUESTED", clarifyText.trim(), clarifyFiles);
      setFull((prev) => ({ ...prev, ...row }));
      setClarifyOpen(false);
      setClarifyText("");
      setClarifyFiles([]);
      onChanged?.(row);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function move(target) {
    setBusy(target);
    setError(null);
    try {
      const row = await transitionStatus(p.id, target, reason.trim() || null);
      setFull((prev) => ({ ...prev, ...row }));
      setReason("");
      onChanged?.(row);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function submitRevision() {
    if (!replyText.trim()) { setError("Write a reply to the clarification request."); return; }
    setBusy("revise");
    setError(null);
    try {
      const payload = { note: replyText.trim() };
      if (replyFiles.length) payload.note_attachments = replyFiles;
      if ((reviseText || "").trim() && reviseText.trim() !== (p.summary || "").trim()) {
        payload.summary = reviseText.trim();
      }
      const row = await reviseProposal(p.id, payload);
      setFull((prev) => ({ ...prev, ...row }));
      setReviseOpen(false);
      setReplyText("");
      setReplyFiles([]);
      onChanged?.(row);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {p.title || p.request_title || "Proposal"}
              </h2>
              <StatusBadge status={p.status} />
              {clarifyThread.length ? (
                <button
                  type="button"
                  onClick={() => setClarifyViewOpen(true)}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300"
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  Clarification · {clarifyThread.length}
                </button>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {role === "recipient" ? `From ${p.proposer_name}` : `To ${p.recipient_name}`}
              {" · "}Submitted {fmtDate(p.submitted_at)}
              {p.version > 1 ? ` · v${p.version}` : ""}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {role === "recipient" && p.proposer_email ? (
            <div className="text-xs text-slate-500 dark:text-slate-400">Contact: {p.proposer_email}</div>
          ) : null}

          {p.summary ? (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Cover letter</div>
              <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{p.summary}</p>
            </div>
          ) : null}

          {(p.sections || []).map((sec, i) => (
            <div key={i}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{sec.heading || `Section ${i + 1}`}</div>
              <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{sec.content}</p>
            </div>
          ))}

          {(p.requirement_responses || []).length ? (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Requirement responses</div>
              <ul className="space-y-2">
                {p.requirement_responses.map((r, i) => (
                  <li key={i} className="rounded-lg border border-slate-200 p-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
                    {r.requirement_text ? (
                      <div className="mb-1 text-xs font-medium text-slate-500">{r.requirement_text}</div>
                    ) : null}
                    {r.attachment?.url ? (
                      <a href={r.attachment.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                        {r.attachment.filename || "Download"}
                      </a>
                    ) : (
                      <div className="whitespace-pre-wrap">{r.response}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {(p.attachments || []).length ? (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Attachments</div>
              <ul className="space-y-1">
                {p.attachments.map((a, i) => (
                  <li key={i}>
                    <a href={a.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline dark:text-brand-400">
                      {a.filename || `Attachment ${i + 1}`}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {clarifyThread.length ? (
            <button
              type="button"
              onClick={() => setClarifyViewOpen(true)}
              className="flex w-full items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-left text-sm text-amber-800 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-900/15 dark:text-amber-200"
            >
              <span className="font-medium">Clarification thread · {clarifyThread.length} message{clarifyThread.length === 1 ? "" : "s"}</span>
              <span className="text-xs opacity-70">Open ›</span>
            </button>
          ) : null}

          {(p.events || []).length ? (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">History</div>
              <ol className="space-y-1.5 border-l border-slate-200 pl-3 dark:border-slate-700">
                {p.events.map((ev, i) => (
                  <li key={i} className="text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{label(ev.status)}</span>
                    {" · "}{ev.actor}{" · "}{fmtDate(ev.timestamp)}
                    {ev.reason ? <div className="text-slate-500">{ev.reason}</div> : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>

        {(actions.length || canWithdraw || canRevise) ? (
          <div className="space-y-2 border-t border-slate-200 px-5 py-4 dark:border-slate-700">
            {error ? <InlineAlert kind="error" message={error} /> : null}

            {/* Recipient: ask for clarification */}
            {clarifyOpen ? (
              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/15">
                <div className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                  What would you like {p.proposer_name || "the proposer"} to clarify?
                </div>
                <textarea
                  rows={3}
                  autoFocus
                  className="ea-input"
                  placeholder="e.g. Please break down the pricing for phase 2, and confirm the delivery timeline."
                  value={clarifyText}
                  onChange={(e) => setClarifyText(e.target.value)}
                />
                <input ref={clarifyFileRef} type="file" multiple className="hidden" onChange={(e) => pickFiles(e, setClarifyFiles)} />
                <FileChips files={clarifyFiles} onRemove={(i) => setClarifyFiles((f) => f.filter((_, j) => j !== i))} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy != null} onClick={requestClarification}>
                    {busy === "CLARIFICATION_REQUESTED" ? <Spinner size={14} /> : "Send request"}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={uploading} onClick={() => clarifyFileRef.current?.click()}>
                    {uploading ? <Spinner size={14} /> : "Attach files"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => { setClarifyOpen(false); setClarifyText(""); setClarifyFiles([]); setError(null); }}>Cancel</Button>
                </div>
              </div>
            ) : null}

            {/* Proposer: reply to the clarification + optionally revise */}
            {reviseOpen ? (
              <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                {clarificationNote ? (
                  <div className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 dark:bg-amber-900/15 dark:text-amber-200">
                    <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide opacity-70">
                      {p.recipient_name || "Recipient"} asked
                    </div>
                    <div className="whitespace-pre-wrap">{clarificationNote}</div>
                  </div>
                ) : null}
                <div>
                  <div className="ea-label">Your reply</div>
                  <textarea
                    rows={3}
                    autoFocus
                    className="ea-input"
                    placeholder="Answer their questions here."
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                  />
                </div>
                <div>
                  <div className="ea-label">Update your cover letter (optional)</div>
                  <textarea
                    rows={4}
                    className="ea-input"
                    placeholder="Leave unchanged to keep your original cover letter."
                    value={reviseText}
                    onChange={(e) => setReviseText(e.target.value)}
                  />
                </div>
                <input ref={replyFileRef} type="file" multiple className="hidden" onChange={(e) => pickFiles(e, setReplyFiles)} />
                <FileChips files={replyFiles} onRemove={(i) => setReplyFiles((f) => f.filter((_, j) => j !== i))} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy != null} onClick={submitRevision}>
                    {busy === "revise" ? <Spinner size={14} /> : "Send reply & revision"}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={uploading} onClick={() => replyFileRef.current?.click()}>
                    {uploading ? <Spinner size={14} /> : "Attach files"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => { setReviseOpen(false); setReplyFiles([]); setError(null); }}>Cancel</Button>
                </div>
              </div>
            ) : null}

            {/* Recipient: generic optional note for the other transitions */}
            {actions.length && !clarifyOpen ? (
              <input
                className="ea-input"
                placeholder="Optional note to the other party"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            ) : null}

            {!clarifyOpen && !reviseOpen ? (
              <div className="flex flex-wrap gap-2">
                {actions.map(([target, text]) => (
                  <Button
                    key={target}
                    size="sm"
                    variant={target === "DECLINED" ? "danger" : "primary"}
                    disabled={busy != null}
                    onClick={() => (target === "CLARIFICATION_REQUESTED" ? (setError(null), setClarifyOpen(true)) : move(target))}
                  >
                    {busy === target ? <Spinner size={14} /> : text}
                  </Button>
                ))}
                {canRevise ? (
                  <Button size="sm" onClick={() => { setError(null); setReviseText(p.summary || ""); setReviseOpen(true); }}>
                    Respond & submit revision
                  </Button>
                ) : null}
                {canWithdraw ? (
                  <Button size="sm" variant="secondary" disabled={busy != null} onClick={() => move("WITHDRAWN")}>
                    {busy === "WITHDRAWN" ? <Spinner size={14} /> : "Withdraw"}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {clarifyViewOpen ? (
        <div
          className="fixed inset-0 z-[135] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setClarifyViewOpen(false); }}
        >
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-700">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Clarification</h3>
                <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {p.title || p.request_title || "Proposal"} · {role === "recipient" ? p.proposer_name : p.recipient_name}
                </p>
              </div>
              <button type="button" onClick={() => setClarifyViewOpen(false)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <ClarificationThread thread={clarifyThread} recipientName={p.recipient_name} proposerName={p.proposer_name} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Inbox tab ─────────────────────────────────────────────────────────────
function InboxTab() {
  const { inbox, inboxLoading, inboxError, fetchInbox, removeFromInbox, linkToRequest } = useProposalStore();
  const requests = useProposalStore((s) => s.requests);
  const fetchRequests = useProposalStore((s) => s.fetchRequests);
  const [open, setOpen] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [linkFor, setLinkFor] = useState(null);

  useEffect(() => { fetchInbox(); fetchRequests(); }, []); // eslint-disable-line

  // Only the first load blanks the tab. Background refetches (e.g. after
  // opening a proposal marks it viewed) must not unmount the open detail
  // modal — that caused an open→refetch→remount→refetch blink loop.
  if (inboxLoading && !inbox.length) return <div className="flex justify-center py-10"><Spinner size={22} /></div>;
  if (inboxError && !inbox.length) return <InlineAlert kind="error" message={inboxError} />;

  return (
    <div className="space-y-2">
      {inboxError ? <InlineAlert kind="error" message={inboxError} /> : null}
      {!inbox.length && !inboxLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">No proposals received yet. Publish a request to attract submissions.</p>
      ) : null}
      {inbox.map((p) => (
        <div key={p.id} className="ea-card p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <button type="button" className="min-w-0 text-left" onClick={() => setOpen(p)}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{p.proposer_name}</span>
                <StatusBadge status={p.status} />
                {p.status === "SUBMITTED" && !p.viewed_at ? <Badge tone="brand">New</Badge> : null}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {p.title || p.request_title || "Unsolicited proposal"} · {fmtDate(p.submitted_at)}
              </div>
            </button>
            <div className="flex shrink-0 gap-1.5">
              {!p.request_id ? (
                <Button size="sm" variant="ghost" onClick={() => setLinkFor(p)}>Link to request</Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(p)}>Remove</Button>
            </div>
          </div>
        </div>
      ))}

      {open ? (
        <ProposalDetail
          proposal={open}
          role="recipient"
          onClose={() => setOpen(null)}
          onChanged={() => fetchInbox()}
        />
      ) : null}

      {linkFor ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setLinkFor(null); }}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
            <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Link to a request</h3>
            <div className="space-y-1.5">
              {requests.filter((r) => r.status !== "DRAFT").map((r) => (
                <button
                  key={r.id}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                  onClick={async () => { await linkToRequest(linkFor.id, r.id); setLinkFor(null); }}
                >
                  {r.title}
                </button>
              ))}
              {!requests.filter((r) => r.status !== "DRAFT").length ? (
                <p className="text-xs text-slate-500">No published requests to link to.</p>
              ) : null}
            </div>
            <div className="mt-3 text-right">
              <Button size="sm" variant="secondary" onClick={() => setLinkFor(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmRemove ? (
        <ConfirmDialog
          message="Hide this proposal from your inbox? The proposer keeps their copy."
          confirmLabel="Remove"
          danger
          onConfirm={async () => { await removeFromInbox(confirmRemove.id); setConfirmRemove(null); }}
          onCancel={() => setConfirmRemove(null)}
        />
      ) : null}
    </div>
  );
}

// ── Activity tab ──────────────────────────────────────────────────────────
function ActivityTab() {
  const { activity, activityLoading, activityError, fetchActivity } = useProposalStore();
  const [open, setOpen] = useState(null);

  useEffect(() => { fetchActivity(); }, []); // eslint-disable-line

  // Background refetches must not unmount an open detail modal (blink loop).
  if (activityLoading && !activity.length) return <div className="flex justify-center py-10"><Spinner size={22} /></div>;
  if (activityError && !activity.length) return <InlineAlert kind="error" message={activityError} />;

  return (
    <div className="space-y-2">
      {activityError ? <InlineAlert kind="error" message={activityError} /> : null}
      {!activity.length && !activityLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">
          You haven't submitted any proposals yet.{" "}
          <Link to="/marketplace?tab=requests" className="text-brand-600 hover:underline dark:text-brand-400">Browse open requests</Link>.
        </p>
      ) : null}
      {activity.map((p) => (
        <button key={p.id} type="button" className="ea-card block w-full p-3 text-left sm:p-4" onClick={() => setOpen(p)}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{p.recipient_name}</span>
            <StatusBadge status={p.status} />
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {p.title || p.request_title || "Unsolicited proposal"} · {fmtDate(p.submitted_at)}
            {p.version > 1 ? ` · v${p.version}` : ""}
          </div>
        </button>
      ))}
      {open ? (
        <ProposalDetail proposal={open} role="proposer" onClose={() => setOpen(null)} onChanged={() => fetchActivity()} />
      ) : null}
    </div>
  );
}

// ── Request form ──────────────────────────────────────────────────────────
const EMPTY_REQUEST = {
  title: "", description: "", type: "general", budget_range: "", budget_currency: "GBP",
  budget_visible: false, deadline: "", submission_cap: "", visibility: "marketplace",
  requirements: [],
};

function RequestForm({ initial, onSaved, onCancel }) {
  const createRequest = useProposalStore((s) => s.createRequest);
  const updateRequest = useProposalStore((s) => s.updateRequest);
  const [form, setForm] = useState(() => ({ ...EMPTY_REQUEST, ...(initial || {}), requirements: (initial?.requirements || []).map((r) => ({ ...r })) }));
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState(null);
  const [error, setError] = useState(null);
  const editing = !!initial?.id;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function generateDescription() {
    if (!form.title.trim()) { setError("Add a title first."); return; }
    setAiBusy(true);
    setAiNote(null);
    try {
      const { description } = await apiRequest("/proposals/generate-description", "POST", { title: form.title.trim() });
      if (description && description.trim()) {
        set({ description });
      } else {
        setAiNote("Couldn't generate a description right now — write one below.");
      }
    } catch {
      setAiNote("Couldn't generate a description right now — write one below.");
    } finally {
      setAiBusy(false);
    }
  }

  async function save() {
    if (!form.title.trim()) { setError("Give the request a title."); return; }
    const cap = form.submission_cap ? Number(form.submission_cap) : null;
    if (cap !== null && (!Number.isFinite(cap) || cap < 1)) {
      setError("Max submissions must be a whole number of 1 or more.");
      return;
    }
    if (form.deadline) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (new Date(form.deadline) < today) {
        setError("The closing date is in the past. Pick today or a future date.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    const payload = {
      type: form.type,
      title: form.title.trim(),
      description: form.description || null,
      budget_range: form.budget_range || null,
      budget_currency: form.budget_currency || null,
      budget_visible: !!form.budget_visible,
      deadline: form.deadline || null,
      submission_cap: cap,
      visibility: form.visibility,
      requirements: (form.requirements || []).filter((r) => (r.text || "").trim()).map((r) => ({
        id: r.id, text: r.text.trim(), mandatory: !!r.mandatory, weight: Number(r.weight) || 1,
        response_type: r.response_type || "text",
      })),
    };
    try {
      const row = editing ? await updateRequest(initial.id, payload) : await createRequest(payload);
      onSaved(row);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title={editing ? "Edit request" : "New proposal request"}>
      <div className="space-y-3">
        <div>
          <div className="ea-label">Title</div>
          <Input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Brand refresh for a fintech startup" />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <div className="ea-label">Description</div>
            <button type="button" className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400" onClick={generateDescription} disabled={aiBusy}>
              {aiBusy ? "Generating…" : "Draft with AI"}
            </button>
          </div>
          <textarea rows={4} className="ea-input" value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="What you need, context, and how proposals will be judged." />
          {aiNote ? <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{aiNote}</div> : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="ea-label">Type</div>
            <select className="ea-input" value={form.type} onChange={(e) => set({ type: e.target.value })}>
              {["general", "technical", "financial", "creative", "consulting"].map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </div>
          <div>
            <div className="ea-label">Deadline</div>
            <Input type="date" min={new Date().toISOString().slice(0, 10)} value={form.deadline || ""} onChange={(e) => set({ deadline: e.target.value })} />
          </div>
          <div>
            <div className="ea-label">Budget (optional)</div>
            <div className="flex gap-2">
              <select
                className="ea-input w-[92px] shrink-0"
                value={form.budget_currency || "GBP"}
                onChange={(e) => set({ budget_currency: e.target.value })}
              >
                {["GBP", "USD", "EUR", "NGN", "CAD", "AUD"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <Input value={form.budget_range} onChange={(e) => set({ budget_range: e.target.value })} placeholder="e.g. 10k–20k" />
            </div>
          </div>
          <div>
            <div className="ea-label">Max submissions (optional)</div>
            <Input type="number" min="1" step="1" value={form.submission_cap} onChange={(e) => { const v = e.target.value; set({ submission_cap: v === "" ? "" : String(Math.max(1, Math.floor(Number(v) || 1))) }); }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.budget_visible} onChange={(e) => set({ budget_visible: e.target.checked })} />
            Show budget to proposers
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.visibility === "private"} onChange={(e) => set({ visibility: e.target.checked ? "private" : "marketplace" })} />
            Invite-only (hide from marketplace)
          </label>
        </div>

        <div>
          <div className="ea-label">Requirements</div>
          <p className="mb-2 text-[11px] text-slate-400">Set what each item asks for. Proposers can't submit until every <span className="font-medium">Required</span> item is provided in the format you choose.</p>
          <div className="space-y-2">
            {(form.requirements || []).map((r, i) => {
              const upd = (patch) => set({ requirements: form.requirements.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-start gap-2">
                    <input
                      className="ea-input flex-1"
                      value={r.text}
                      onChange={(e) => upd({ text: e.target.value })}
                      placeholder="e.g. Minimum 3 years in B2B SaaS · Portfolio of past work · Fixed quote"
                    />
                    <button type="button" className="mt-2 shrink-0 text-slate-400 hover:text-rose-500" onClick={() => set({ requirements: form.requirements.filter((_, j) => j !== i) })}>
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
                    <label className="flex items-center gap-1.5">
                      Answer as
                      <select
                        className="ea-input h-8 w-auto py-0 text-xs"
                        value={r.response_type || "text"}
                        onChange={(e) => upd({ response_type: e.target.value })}
                      >
                        <option value="text">Short text</option>
                        <option value="paragraph">Paragraph</option>
                        <option value="link">Link / URL</option>
                        <option value="number">Number</option>
                        <option value="file">File upload</option>
                        <option value="image">Image upload</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5" title="Scoring weight used when evaluating proposals">
                      Weight
                      <input
                        type="number" min="1" max="10"
                        className="ea-input h-8 w-14 px-2 py-0"
                        value={r.weight ?? 1}
                        onChange={(e) => upd({ weight: e.target.value })}
                      />
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={!!r.mandatory} onChange={(e) => upd({ mandatory: e.target.checked })} />
                      Required
                    </label>
                  </div>
                </div>
              );
            })}
            <Button size="sm" variant="secondary" onClick={() => set({ requirements: [...(form.requirements || []), { text: "", mandatory: false, weight: 1, response_type: "text" }] })}>
              Add requirement
            </Button>
          </div>
        </div>

        {error ? <InlineAlert kind="error" message={error} /> : null}
        <div className="flex gap-2 pt-1">
          <Button onClick={save} disabled={busy}>{busy ? <Spinner size={14} /> : editing ? "Save changes" : "Create request"}</Button>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </SectionCard>
  );
}

// ── Requests tab ──────────────────────────────────────────────────────────
function RequestsTab({ openNewNonce = 0 }) {
  const { requests, requestsLoading, requestsError, fetchRequests, requestAction, deleteRequest, inviteToRequest } = useProposalStore();
  const [editing, setEditing] = useState(null); // request obj or "new" or null
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [inviteFor, setInviteFor] = useState(null);
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviteResult, setInviteResult] = useState(null);
  const [rowError, setRowError] = useState(null);
  const [busyRow, setBusyRow] = useState(null); // { id, action }
  const [copiedId, setCopiedId] = useState(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => { fetchRequests(); }, []); // eslint-disable-line
  useEffect(() => { if (openNewNonce > 0) setEditing("new"); }, [openNewNonce]);

  async function act(id, action) {
    setRowError(null);
    setBusyRow({ id, action });
    try { await requestAction(id, action); }
    catch (e) { setRowError(errText(e)); }
    finally { setBusyRow(null); }
  }

  function copyLink(id) {
    navigator.clipboard?.writeText(`${origin}/marketplace/request/${id}`).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Publish a brief and receive structured proposals.</p>
      {rowError ? <InlineAlert kind="error" message={rowError} /> : null}
      {requestsError ? <InlineAlert kind="error" message={requestsError} /> : null}
      {requestsLoading ? (
        <div className="flex justify-center py-10"><Spinner size={22} /></div>
      ) : !requests.length ? (
        <p className="py-8 text-center text-sm text-slate-500">No requests yet.</p>
      ) : (
        requests.map((r) => {
          const openPublic = () => window.open(`/marketplace/request/${r.id}`, "_blank", "noopener");
          return (
            <div key={r.id} className="ea-card p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <button type="button" onClick={openPublic} className="min-w-0 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900 hover:text-brand-700 dark:text-slate-100">{r.title}</span>
                    <Badge tone={r.status === "PUBLISHED" ? "success" : r.status === "CLOSED" ? "slate" : "warn"}>{label(r.status)}</Badge>
                    {r.visibility === "private" ? <Badge tone="slate">Invite-only</Badge> : null}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {r.submission_count} submission{r.submission_count === 1 ? "" : "s"}
                    {" · "}{r.view_count || 0} view{r.view_count === 1 ? "" : "s"}
                    {r.deadline ? ` · closes ${fmtDate(r.deadline)}` : ""}
                    {r.submission_cap ? ` · cap ${r.submission_cap}` : ""}
                  </div>
                </button>
                {(() => {
                  const rowBusy = busyRow?.id === r.id;
                  const items = [
                    { label: "View public page", onClick: openPublic },
                    { label: "Edit request", onClick: () => setEditing(r) },
                    r.status === "DRAFT" && { label: "Publish", onClick: () => act(r.id, "publish") },
                    r.status === "PUBLISHED" && { label: "Copy link", onClick: () => copyLink(r.id) },
                    r.status === "PUBLISHED" && { label: "Invite proposers", onClick: () => { setInviteFor(r); setInviteEmails(""); setInviteResult(null); } },
                    r.status === "PUBLISHED" && { label: "Close request", onClick: () => act(r.id, "close") },
                    r.status === "CLOSED" && { label: "Reopen", onClick: () => act(r.id, "reopen") },
                    r.status !== "PUBLISHED" && { label: "Delete", onClick: () => setConfirmDelete(r), danger: true },
                  ];
                  return (
                    <div className="flex shrink-0 items-center gap-2">
                      {rowBusy ? <Spinner size={14} /> : null}
                      {r.status === "DRAFT" ? (
                        <Button size="sm" disabled={rowBusy} onClick={() => act(r.id, "publish")}>Publish</Button>
                      ) : null}
                      <RowMenu items={items} disabled={rowBusy} />
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })
      )}

      {copiedId ? (
        <div className="fixed bottom-5 left-1/2 z-[140] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white shadow-lg dark:bg-slate-700">
          Link copied to clipboard
        </div>
      ) : null}

      {editing ? (
        <div
          className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/50 p-0 sm:p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}
        >
          <div className="w-full max-w-2xl sm:my-6">
            <RequestForm
              initial={editing === "new" ? null : editing}
              onSaved={() => setEditing(null)}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      ) : null}

      {inviteFor ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setInviteFor(null); }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
            <h3 className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">Invite proposers</h3>
            <p className="mb-2 text-xs text-slate-500">They get an email with a link to “{inviteFor.title}”.</p>
            <textarea rows={3} className="ea-input" placeholder="name@company.com, another@company.com" value={inviteEmails} onChange={(e) => setInviteEmails(e.target.value)} />
            {inviteResult ? (
              <p className="mt-2 text-xs text-slate-500">
                Sent to {inviteResult.sent.length}. {inviteResult.failed.length ? `Failed: ${inviteResult.failed.join(", ")}` : ""}
              </p>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setInviteFor(null)}>Close</Button>
              <Button
                size="sm"
                onClick={async () => {
                  const emails = inviteEmails.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
                  if (!emails.length) return;
                  try {
                    const res = await inviteToRequest(inviteFor.id, emails);
                    setInviteResult(res);
                  } catch (e) { setInviteResult({ sent: [], failed: [errText(e)] }); }
                }}
              >
                Send invites
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          message="Permanently delete this request? Submissions already received are kept."
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            const id = confirmDelete.id;
            setConfirmDelete(null); // close immediately — deleteRequest is optimistic
            setRowError(null);
            deleteRequest(id).catch((e) => setRowError(errText(e)));
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────
function SettingsTab() {
  const { preferences, preferencesLoading, preferencesError, fetchPreferences, savePreferences } = useProposalStore();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { fetchPreferences(); }, []); // eslint-disable-line
  useEffect(() => { if (preferences) setForm(preferences); }, [preferences]);

  if (preferencesLoading || !form) return <div className="flex justify-center py-10"><Spinner size={22} /></div>;

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setSaved(false); };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await savePreferences({
        enabled: !!form.enabled,
        accepted_modes: form.accepted_modes?.length ? form.accepted_modes : ["general"],
        accepted_categories: form.accepted_categories || null,
        proposal_cap: form.proposal_cap ? Number(form.proposal_cap) : null,
        visibility: form.visibility || "marketplace",
      });
      setSaved(true);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const MODES = ["general", "technical", "financial", "creative", "consulting"];

  return (
    <SectionCard title="Proposal preferences" subtitle="Control whether other businesses can send you proposals.">
      <div className="space-y-4">
        {error ? <InlineAlert kind="error" message={error} /> : null}
        {preferencesError ? <InlineAlert kind="error" message={preferencesError} /> : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span className="font-medium">Accept proposals from other businesses</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.visibility === "private"}
            onChange={(e) => set({ visibility: e.target.checked ? "private" : "marketplace" })}
          />
          Keep my workspace off the public marketplace (link/invite only)
        </label>
        <div>
          <div className="ea-label">Proposal types I accept</div>
          <div className="flex flex-wrap gap-3 text-sm">
            {MODES.map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={(form.accepted_modes || []).includes(m)}
                  onChange={(e) => set({
                    accepted_modes: e.target.checked
                      ? [...(form.accepted_modes || []), m]
                      : (form.accepted_modes || []).filter((x) => x !== m),
                  })}
                />
                {label(m)}
              </label>
            ))}
          </div>
        </div>
        <div className="max-w-[220px]">
          <div className="ea-label">Max concurrent proposals (optional)</div>
          <Input type="number" min="1" value={form.proposal_cap || ""} onChange={(e) => set({ proposal_cap: e.target.value })} />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>{busy ? <Spinner size={14} /> : "Save preferences"}</Button>
          {saved ? <span className="text-sm text-emerald-600">Saved</span> : null}
        </div>
      </div>
    </SectionCard>
  );
}

// ── Panel (rendered as a tab inside Financials) ───────────────────────────
export default function ProposalsPanel() {
  const [tab, setTab] = useState("requests");
  const [newReqNonce, setNewReqNonce] = useState(0);
  const inboxUnread = useProposalStore((s) => s.inboxUnread);
  const fetchInbox = useProposalStore((s) => s.fetchInbox);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  useEffect(() => { fetchInbox(); }, [workspaceId]); // eslint-disable-line

  const options = useMemo(() => ([
    { value: "requests", label: "Requests" },
    { value: "inbox", label: inboxUnread ? `Inbox (${inboxUnread})` : "Inbox" },
    { value: "activity", label: "Activity" },
    { value: "settings", label: "Settings" },
  ]), [inboxUnread]);

  const startNewRequest = () => { setTab("requests"); setNewReqNonce((n) => n + 1); };

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        Receive structured proposals for your requests, and submit proposals to other businesses.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-md flex-1"><SegmentedTabs value={tab} onChange={setTab} options={options} size="sm" /></div>
        <Button size="sm" onClick={startNewRequest}>New request</Button>
      </div>
      <div className="mt-4">
        {tab === "requests" ? <RequestsTab openNewNonce={newReqNonce} /> : null}
        {tab === "inbox" ? <InboxTab /> : null}
        {tab === "activity" ? <ActivityTab /> : null}
        {tab === "settings" ? <SettingsTab /> : null}
      </div>
    </div>
  );
}
