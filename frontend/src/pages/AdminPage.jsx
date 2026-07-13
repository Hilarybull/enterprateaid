import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { apiRequest } from "../api/client";
import { MODULES, FEATURES } from "../lib/permissions";
import { getPlan, normalisePlanKey } from "../lib/plans";
import logoUrl from "../enterprate-logo.png";
import ConfirmDialog from "../components/ConfirmDialog";

function fmtAdminDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const ADMIN_EMAIL = "tech.support@enterprateai.com";

// ── Icons ─────────────────────────────────────────────────────────────────────

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
      <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
    </svg>
  );
}

function XIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
    </svg>
  );
}

function BanIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
      <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function downloadCSV(rows, columns, filename) {
  const header = columns.map((c) => `"${c.label}"`).join(",");
  const body = rows.map((row) =>
    columns.map((c) => {
      const val = row[c.key] ?? "";
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(",")
  );
  const csv = [header, ...body].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadUserAIReport(userEmail, events) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const row = (...cells) => cells.map(q).join(",");

  // summary
  const totalCalls = events.length;
  const totalIn = events.reduce((s, r) => s + (r.input_tokens || 0), 0);
  const totalOut = events.reduce((s, r) => s + (r.output_tokens || 0), 0);
  const totalTokens = events.reduce((s, r) => s + (r.total_tokens || 0), 0);
  const totalCost = events.reduce((s, r) => s + parseFloat(r.estimated_cost_usd || 0), 0);

  // by feature
  const featureMap = {};
  for (const r of events) {
    const f = r.feature || "unknown";
    if (!featureMap[f]) featureMap[f] = { calls: 0, in: 0, out: 0, tokens: 0, cost: 0 };
    featureMap[f].calls += 1;
    featureMap[f].in += r.input_tokens || 0;
    featureMap[f].out += r.output_tokens || 0;
    featureMap[f].tokens += r.total_tokens || 0;
    featureMap[f].cost += parseFloat(r.estimated_cost_usd || 0);
  }
  const featureRows = Object.entries(featureMap)
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([f, d]) => row(f, d.calls, d.in, d.out, d.tokens, d.cost.toFixed(6)));

  // event log
  const eventRows = [...events]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((r) => row(
      formatDateTime(r.created_at),
      r.feature || "unknown",
      r.provider,
      r.model,
      r.input_tokens || 0,
      r.output_tokens || 0,
      r.total_tokens || 0,
      Number(r.estimated_cost_usd || 0).toFixed(6),
    ));

  const lines = [
    row("AI Usage Report", userEmail),
    row("Generated", new Date().toLocaleString()),
    "",
    row("SUMMARY"),
    row("Total Calls", "Input Tokens", "Output Tokens", "Total Tokens", "Est. Cost (USD)"),
    row(totalCalls, totalIn, totalOut, totalTokens, totalCost.toFixed(6)),
    "",
    row("BY FEATURE"),
    row("Feature", "Calls", "Input Tokens", "Output Tokens", "Total Tokens", "Est. Cost (USD)"),
    ...featureRows,
    "",
    row("EVENT LOG"),
    row("Time", "Feature", "Provider", "Model", "Input Tokens", "Output Tokens", "Total Tokens", "Cost (USD)"),
    ...eventRows,
  ];

  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = userEmail.replace(/[^a-z0-9]/gi, "_");
  a.download = `ai-report-${safe}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Small components ──────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cls =
    status === "accepted" ? "bg-emerald-100 text-emerald-700"
    : status === "pending" ? "bg-amber-100 text-amber-700"
    : status === "revoked" ? "bg-slate-100 text-slate-500 line-through"
    : "bg-slate-100 text-slate-500";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {status || "—"}
    </span>
  );
}

function PermBadge({ type }) {
  const cls = type === "module" ? "bg-brand-100 text-brand-700"
    : type === "feature" ? "bg-violet-100 text-violet-700"
    : "bg-slate-100 text-slate-500";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {type || "—"}
    </span>
  );
}

function ActionBtn({ onClick, title, variant = "danger", disabled = false }) {
  const cls = variant === "danger"
    ? "text-rose-400 hover:text-rose-600 hover:bg-rose-50"
    : variant === "warn"
    ? "text-amber-400 hover:text-amber-600 hover:bg-amber-50"
    : "text-slate-400 hover:text-slate-600 hover:bg-slate-100";
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-lg transition disabled:opacity-30 ${cls}`}
    >
      {variant === "danger" ? <TrashIcon /> : variant === "warn" ? <BanIcon /> : <EyeIcon />}
    </button>
  );
}

function SearchBar({ value, onChange, placeholder = "Search…" }) {
  return (
    <div className="relative w-full sm:w-auto sm:min-w-[180px] sm:max-w-xs">
      <svg viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400">
        <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-[13px] text-slate-800 placeholder-slate-400 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100 transition"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
          <XIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Toast notification ────────────────────────────────────────────────────────

function Toast({ toast, onDismiss }) {
  if (!toast) return null;
  return (
    <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-lg transition-all ${
      toast.kind === "error"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700"
    }`}>
      <span className="text-sm font-medium">{toast.msg}</span>
      <button type="button" onClick={onDismiss} className="ml-1 opacity-60 hover:opacity-100">
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Confirm modal ─────────────────────────────────────────────────────────────

function ConfirmModal({ confirm, onCancel, onConfirm, loading }) {
  if (!confirm) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 text-rose-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h3 className="mt-3 text-base font-semibold text-slate-900">{confirm.title}</h3>
        <p className="mt-1 text-sm text-slate-500">{confirm.description}</p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            {loading ? "Working…" : confirm.label}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Workspace detail panel ────────────────────────────────────────────────────

function WorkspaceDetailPanel({ detail, onClose, onDeleteMember, onRevokeInvitation, actionLoading, onRestore, onRename }) {
  const backdropRef = useRef(null);
  const [snapshots, setSnapshots] = useState(null);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [nameSaving, setNameSaving] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!detail?.id) return;
    setSnapshots(null);
    setSnapshotsLoading(true);
    apiRequest(`/admin/workspaces/${detail.id}/snapshots`, "GET")
      .then(setSnapshots)
      .catch(() => setSnapshots([]))
      .finally(() => setSnapshotsLoading(false));
  }, [detail?.id]);

  function handleRestore(snap) {
    const snapTime = snap.saved_at ? new Date(snap.saved_at).toLocaleString() : "unknown time";
    setConfirmDialog({
      message: `Restore to snapshot from ${snapTime} ("${snap.ws_name}")? The current state will be saved as a new snapshot first so you can undo.`,
      confirmLabel: "Restore",
      onConfirm: async () => {
        setConfirmDialog(null);
        setRestoring(true);
        try {
          const res = await apiRequest(`/admin/workspaces/${detail.id}/restore`, "POST", { snapshot_id: snap.snapshot_id });
          onRestore && onRestore(res);
        } catch (e) {
          alert(e.message || "Restore failed.");
        } finally {
          setRestoring(false);
        }
      },
      onCancel: () => setConfirmDialog(null),
    });
  }

  async function handleRenameSave() {
    if (!nameValue.trim()) return;
    setNameSaving(true);
    try {
      await apiRequest(`/admin/workspaces/${detail.id}`, "PATCH", { name: nameValue.trim() });
      onRename && onRename(detail.id, nameValue.trim());
      setEditingName(false);
    } catch (e) {
      alert(e.message || "Rename failed.");
    } finally {
      setNameSaving(false);
    }
  }

  if (!detail) return null;

  return (
    <>
    <div
      ref={backdropRef}
      className="fixed inset-0 z-40 flex justify-end bg-slate-900/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div className="flex h-full w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl sm:max-w-md">
        <div className="flex shrink-0 items-start justify-between border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1 pr-3">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm font-semibold text-slate-900 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-200"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRenameSave(); if (e.key === "Escape") setEditingName(false); }}
                />
                <button onClick={handleRenameSave} disabled={nameSaving} className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                  {nameSaving ? "…" : "Save"}
                </button>
                <button onClick={() => setEditingName(false)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold text-slate-900">{detail.name}</h2>
                <button onClick={() => { setNameValue(detail.name || ""); setEditingName(true); }} className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-600">Edit</button>
              </div>
            )}
            <p className="mt-0.5 font-mono text-[11px] text-slate-400">{detail.id}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition">
            <XIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Owner", value: detail.owner_email || "—" },
              { label: "Created", value: formatDate(detail.created_at) },
              { label: "Members", value: detail.member_count ?? 0 },
              { label: "Invitations", value: detail.invitation_count ?? 0 },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-slate-800">{String(value)}</div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            {detail.has_validation && (
              <span className="rounded-full bg-teal-100 px-2.5 py-1 text-[11px] font-semibold text-teal-700">✓ Validated</span>
            )}
            {detail.has_simulation && (
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold text-sky-700">✓ Simulated</span>
            )}
            {!detail.has_validation && !detail.has_simulation && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">No activity</span>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Members ({detail.members?.length ?? 0})
            </h3>
            {detail.members?.length > 0 ? (
              <div className="divide-y divide-slate-50 overflow-hidden rounded-xl border border-slate-200">
                {detail.members.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-slate-800">{m.email}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400">{formatDate(m.created_at)}</div>
                    </div>
                    <PermBadge type={m.permission_type} />
                    <ActionBtn title="Remove member" disabled={actionLoading} onClick={() => onDeleteMember(m.id)} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">No members.</p>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Invitations ({detail.invitations?.length ?? 0})
            </h3>
            {detail.invitations?.length > 0 ? (
              <div className="divide-y divide-slate-50 overflow-hidden rounded-xl border border-slate-200">
                {detail.invitations.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-slate-800">{inv.email || "Link-only"}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400">{formatDate(inv.created_at)}</div>
                    </div>
                    <StatusBadge status={inv.status} />
                    {inv.status === "pending" && (
                      <ActionBtn title="Revoke invitation" variant="warn" disabled={actionLoading} onClick={() => onRevokeInvitation(inv.id)} />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">No invitations.</p>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Snapshots (restore points)
            </h3>
            {snapshotsLoading ? (
              <p className="text-xs text-slate-400">Loading…</p>
            ) : !snapshots || snapshots.length === 0 ? (
              <p className="text-xs text-slate-400">No snapshots yet. Snapshots are created automatically on each workspace save.</p>
            ) : (
              <div className="divide-y divide-slate-50 overflow-hidden rounded-xl border border-slate-200">
                {snapshots.map((snap) => (
                  <div key={snap.snapshot_id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-slate-800">{snap.ws_name}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400">{snap.saved_at ? new Date(snap.saved_at).toLocaleString() : "Unknown time"}</div>
                    </div>
                    <button
                      onClick={() => handleRestore(snap)}
                      disabled={restoring}
                      className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition"
                    >
                      {restoring ? "…" : "Restore"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    {confirmDialog ? (
      <ConfirmDialog
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel || "Confirm"}
        onConfirm={confirmDialog.onConfirm}
        onCancel={confirmDialog.onCancel}
      />
    ) : null}
    </>
  );
}

// ── User detail panel ─────────────────────────────────────────────────────────

const PANEL_TABS = [
  { key: "profile", label: "Profile" },
  { key: "access", label: "Access Controls" },
  { key: "activity", label: "Activity & Data" },
];

function UserDetailPanel({ user, stats, upgrades, onClose, onDeleteUser, onDeleteWorkspace, onUserUpdated, showToast, actionLoading }) {
  const backdropRef = useRef(null);
  const [panelTab, setPanelTab] = useState("profile");

  // Access tab state
  const [restrictions, setRestrictions] = useState([]);
  const [restrictionsLoading, setRestrictionsLoading] = useState(false);
  const [addModule, setAddModule] = useState("");
  const [addFeature, setAddFeature] = useState("");
  const [addingRestriction, setAddingRestriction] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [grants, setGrants] = useState([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [grantModule, setGrantModule] = useState("");
  const [addingGrant, setAddingGrant] = useState(false);
  const [removingGrantId, setRemovingGrantId] = useState(null);
  const [blockLoading, setBlockLoading] = useState(false);
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockReasonInput, setBlockReasonInput] = useState("");
  const [subscription, setSubscription] = useState(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [trialLoading, setTrialLoading] = useState(false);
  const [showPlanOverride, setShowPlanOverride] = useState(false);
  const [planOverrideKey, setPlanOverrideKey] = useState("starter_insight");
  const [planOverridePeriod, setPlanOverridePeriod] = useState("monthly");
  const [planOverrideStatus, setPlanOverrideStatus] = useState("active");
  const [planOverrideLoading, setPlanOverrideLoading] = useState(false);

  // Credits state
  const [creditWallet, setCreditWallet] = useState(null);
  const [creditWalletLoading, setCreditWalletLoading] = useState(false);
  const [creditAction, setCreditAction] = useState("grant");
  const [grantAmount, setGrantAmount] = useState("50");
  const [grantReason, setGrantReason] = useState("");
  const [grantLoading, setGrantLoading] = useState(false);

  // Activity tab state
  const [fullData, setFullData] = useState(null);
  const [fullDataLoading, setFullDataLoading] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!user) return;
    setPanelTab("access");
    setRestrictions([]);
    setFullData(null);
    setSubscription(null);
    setSubscriptionLoading(true);
    setGrants([]);
    setShowBlockForm(false);
    setBlockReasonInput("");
    setShowPlanOverride(false);
    loadRestrictions(user.id);
    loadSubscription(user.id);
    loadGrants(user.id);
    loadCreditWallet(user.id);
  }, [user?.id]);

  useEffect(() => {
    if (panelTab === "activity" && !fullData && !fullDataLoading && user) {
      loadFullData(user.id);
    }
  }, [panelTab]);

  async function loadRestrictions(userId) {
    setRestrictionsLoading(true);
    try {
      const data = await apiRequest(`/admin/users/${userId}/restrictions`, "GET");
      setRestrictions(data || []);
    } catch {
      setRestrictions([]);
    } finally {
      setRestrictionsLoading(false);
    }
  }

  async function loadGrants(userId) {
    setGrantsLoading(true);
    try {
      const data = await apiRequest(`/admin/users/${userId}/grants`, "GET");
      setGrants(data || []);
    } catch {
      setGrants([]);
    } finally {
      setGrantsLoading(false);
    }
  }

  async function handleAddGrant() {
    if (!grantModule || addingGrant) return;
    setAddingGrant(true);
    try {
      const g = await apiRequest(`/admin/users/${user.id}/grants`, "POST", { module_key: grantModule, feature_key: "" });
      setGrants((prev) => [...prev, g]);
      setGrantModule("");
      showToast("success", `Access granted to ${grantModule}.`);
    } catch (e) {
      showToast("error", e.message || "Failed to add grant.");
    } finally {
      setAddingGrant(false);
    }
  }

  async function handleRemoveGrant(id) {
    setRemovingGrantId(id);
    try {
      await apiRequest(`/admin/users/${user.id}/grants/${id}`, "DELETE");
      setGrants((prev) => prev.filter((g) => g.id !== id));
      showToast("success", "Grant removed.");
    } catch (e) {
      showToast("error", e.message || "Failed to remove grant.");
    } finally {
      setRemovingGrantId(null);
    }
  }

  async function loadSubscription(userId) {
    setSubscriptionLoading(true);
    try {
      const data = await apiRequest(`/admin/users/${userId}/subscription`, "GET");
      setSubscription(data);
    } catch {
      setSubscription(false);
    } finally {
      setSubscriptionLoading(false);
    }
  }

  async function handleRenewTrial() {
    if (!user || trialLoading) return;
    setTrialLoading(true);
    try {
      const res = await apiRequest(`/admin/users/${user.id}/renew-trial`, "POST");
      setSubscription((s) => ({ ...s, status: "trial", current_period_end: res.trial_end }));
      showToast("success", `Free trial renewed — expires ${new Date(res.trial_end).toLocaleDateString()}`);
    } catch (e) {
      showToast("error", e.message || "Failed to renew trial.");
    } finally {
      setTrialLoading(false);
    }
  }

  async function handleSetPlan() {
    if (!user || planOverrideLoading) return;
    setPlanOverrideLoading(true);
    try {
      const updated = await apiRequest(`/admin/users/${user.id}/plan`, "PATCH", {
        plan_key: planOverrideKey,
        billing_period: planOverridePeriod,
        status: planOverrideStatus,
      });
      setSubscription(updated);
      setShowPlanOverride(false);
      showToast("success", `Plan updated to ${planOverrideKey} (${planOverrideStatus}).`);
    } catch (e) {
      showToast("error", e.message || "Failed to update plan.");
    } finally {
      setPlanOverrideLoading(false);
    }
  }

  async function loadFullData(userId) {
    setFullDataLoading(true);
    try {
      const data = await apiRequest(`/admin/users/${userId}/full-data`, "GET");
      setFullData(data);
    } catch (e) {
      showToast("error", e.message || "Failed to load user data.");
    } finally {
      setFullDataLoading(false);
    }
  }

  async function loadCreditWallet(userId) {
    setCreditWalletLoading(true);
    try {
      const data = await apiRequest(`/credits/admin/wallet/${userId}`, "GET");
      setCreditWallet(data);
    } catch {
      setCreditWallet(null);
    } finally {
      setCreditWalletLoading(false);
    }
  }

  async function handleCreditAction() {
    const amount = parseInt(grantAmount, 10);
    if (!amount || amount <= 0 || grantLoading) return;
    setGrantLoading(true);
    try {
      if (creditAction === "grant") {
        await apiRequest("/credits/admin/grant", "POST", {
          user_id: user.id,
          amount,
          reason: grantReason.trim() || "Admin grant",
          grant_type: "admin_adjustment",
        });
        showToast("success", `⚡ ${amount} credits granted to ${user.email}.`);
      } else {
        const res = await apiRequest("/credits/admin/deduct", "POST", {
          user_id: user.id,
          amount,
          reason: grantReason.trim() || "Admin deduction",
        });
        showToast("success", `⚡ ${res.deducted ?? amount} credits deducted from ${user.email}.`);
      }
      setGrantAmount("50");
      setGrantReason("");
      loadCreditWallet(user.id);
    } catch (e) {
      showToast("error", e.message || "Failed to adjust credits.");
    } finally {
      setGrantLoading(false);
    }
  }

  async function handleBlock() {
    if (!user || blockLoading) return;
    setBlockLoading(true);
    try {
      const updated = await apiRequest(`/admin/users/${user.id}/block`, "PATCH", { reason: blockReasonInput || "Blocked by administrator" });
      onUserUpdated(updated);
      showToast("success", `${user.email} has been blocked.`);
      setShowBlockForm(false);
      setBlockReasonInput("");
    } catch (e) {
      showToast("error", e.message || "Failed to block user.");
    } finally {
      setBlockLoading(false);
    }
  }

  async function handleUnblock() {
    if (!user || blockLoading) return;
    setBlockLoading(true);
    try {
      const updated = await apiRequest(`/admin/users/${user.id}/unblock`, "PATCH");
      onUserUpdated(updated);
      showToast("success", `${user.email} has been unblocked.`);
    } catch (e) {
      showToast("error", e.message || "Failed to unblock user.");
    } finally {
      setBlockLoading(false);
    }
  }

  async function handleAddRestriction() {
    if (!addModule || addingRestriction) return;
    setAddingRestriction(true);
    try {
      const r = await apiRequest(`/admin/users/${user.id}/restrictions`, "POST", {
        module_key: addModule,
        feature_key: addFeature || null,
      });
      setRestrictions((prev) => [...prev.filter((x) => x.id !== r.id), r]);
      setAddModule("");
      setAddFeature("");
      showToast("success", "Restriction added.");
    } catch (e) {
      showToast("error", e.message || "Failed to add restriction.");
    } finally {
      setAddingRestriction(false);
    }
  }

  async function handleRemoveRestriction(id) {
    setRemovingId(id);
    try {
      await apiRequest(`/admin/users/${user.id}/restrictions/${id}`, "DELETE");
      setRestrictions((prev) => prev.filter((r) => r.id !== id));
      showToast("success", "Restriction removed.");
    } catch (e) {
      showToast("error", e.message || "Failed to remove restriction.");
    } finally {
      setRemovingId(null);
    }
  }

  const ownedWorkspaces = useMemo(() =>
    (stats?.workspaces || []).filter((w) => w.owner_email === user?.email),
    [stats, user]
  );
  const memberships = useMemo(() =>
    (stats?.members || []).filter((m) => m.user_email === user?.email),
    [stats, user]
  );
  const userUpgrades = useMemo(() =>
    (upgrades || []).filter((u) => u.email === user?.email),
    [upgrades, user]
  );

  if (!user) return null;

  const availableFeatures = addModule ? (FEATURES[addModule] || []) : [];
  const moduleLabel = (key) => MODULES.find((m) => m.key === key)?.label || key;
  const featureLabel = (modKey, featKey) => (FEATURES[modKey] || []).find((f) => f.key === featKey)?.label || featKey;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-40 flex justify-end bg-slate-900/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div className="flex h-full w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl sm:max-w-lg">

        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${user.is_blocked ? "bg-rose-100 text-rose-700" : "bg-brand-100 text-brand-700"}`}>
              {user.email?.[0]?.toUpperCase() || "?"}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900 truncate max-w-[200px]">{user.email}</h2>
                {user.is_blocked && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-600">Blocked</span>
                )}
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-slate-400">{user.id?.slice(0, 16)}…</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition">
            <XIcon />
          </button>
        </div>

        {/* Tab nav */}
        <div className="shrink-0 flex gap-1 border-b border-slate-100 bg-slate-50/80 px-4 py-2">
          {PANEL_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setPanelTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${panelTab === t.key ? "bg-white text-slate-900 shadow-sm border border-slate-200" : "text-slate-500 hover:text-slate-700"}`}
            >
              {t.label}
              {t.key === "access" && restrictions.length > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{restrictions.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Profile tab ── */}
        {panelTab === "profile" && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Joined", value: formatDate(user.created_at) },
                { label: "Workspaces", value: ownedWorkspaces.length },
                { label: "Memberships", value: memberships.length },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
                  <div className="mt-0.5 text-sm font-bold text-slate-800">{String(value)}</div>
                </div>
              ))}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Owned workspaces ({ownedWorkspaces.length})</h3>
              {ownedWorkspaces.length > 0 ? (
                <div className="divide-y divide-slate-50 overflow-hidden rounded-xl border border-slate-200">
                  {ownedWorkspaces.map((w) => (
                    <div key={w.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-slate-800">{w.name || "Unnamed"}</div>
                        <div className="mt-0.5 flex gap-2 text-[10px] text-slate-400">
                          <span>{w.member_count ?? 0} members</span>
                          <span>·</span>
                          <span>{formatDate(w.created_at)}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {w.has_validation && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold text-teal-700">V</span>}
                        {w.has_simulation && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">S</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-slate-400">No owned workspaces.</p>}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Team memberships ({memberships.length})</h3>
              {memberships.length > 0 ? (
                <div className="divide-y divide-slate-50 overflow-hidden rounded-xl border border-slate-200">
                  {memberships.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-slate-800">{m.workspace_name || m.workspace_id?.slice(0, 12) + "…"}</div>
                        <div className="mt-0.5 text-[10px] text-slate-400">{formatDate(m.created_at)}</div>
                      </div>
                      <PermBadge type={m.permission_type} />
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-slate-400">No team memberships.</p>}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Upgrade intent {upgrades !== null ? `(${userUpgrades.length})` : ""}
              </h3>
              {upgrades === null ? (
                <p className="text-xs text-slate-400">Visit the Upgrade Clicks tab first to load intent data.</p>
              ) : userUpgrades.length > 0 ? (
                <div className="divide-y divide-slate-50 overflow-hidden rounded-xl border border-slate-200">
                  {userUpgrades.map((u, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-slate-800">{u.feature || "—"}</div>
                        <div className="mt-0.5 text-[10px] text-slate-400">{formatDateTime(u.clicked_at)}</div>
                      </div>
                      <span className="text-[11px] text-slate-400">{u.source || "—"}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-slate-400">No upgrade clicks recorded.</p>}
            </div>
          </div>
        )}

        {/* ── Access Controls tab ── */}
        {panelTab === "access" && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

            {/* Account status */}
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Account status</h3>
              {user.is_blocked ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-rose-500" />
                        <span className="text-sm font-semibold text-rose-700">Account blocked</span>
                      </div>
                      {user.block_reason && (
                        <p className="mt-1 text-xs text-rose-600">Reason: {user.block_reason}</p>
                      )}
                      <p className="mt-1 text-[11px] text-rose-500">This user cannot log in or make any API requests.</p>
                    </div>
                    <button
                      type="button"
                      disabled={blockLoading}
                      onClick={handleUnblock}
                      className="shrink-0 rounded-xl bg-white border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-40"
                    >
                      {blockLoading ? "Working…" : "Unblock"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        <span className="text-sm font-semibold text-emerald-700">Active</span>
                      </div>
                      <p className="mt-1 text-[11px] text-emerald-600">User can log in and access their account normally.</p>
                    </div>
                    {user.email !== ADMIN_EMAIL && !showBlockForm && (
                      <button
                        type="button"
                        onClick={() => setShowBlockForm(true)}
                        className="shrink-0 rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
                      >
                        Block account
                      </button>
                    )}
                  </div>
                  {showBlockForm && (
                    <div className="mt-3 border-t border-emerald-100 pt-3">
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">Reason (shown to support, not user)</label>
                      <input
                        type="text"
                        value={blockReasonInput}
                        onChange={(e) => setBlockReasonInput(e.target.value)}
                        placeholder="Spam, policy violation, fraud…"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
                      />
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={() => setShowBlockForm(false)} className="flex-1 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={blockLoading}
                          onClick={handleBlock}
                          className="flex-1 rounded-xl bg-rose-600 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-40"
                        >
                          {blockLoading ? "Blocking…" : "Confirm block"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Subscription & Trial */}
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Subscription & trial</h3>
              {subscriptionLoading ? (
                <div className="flex items-center gap-2 text-[12px] text-slate-400">
                  <div className="h-3 w-3 animate-spin rounded-full border border-slate-300 border-t-slate-500" />
                  Loading…
                </div>
              ) : subscription === false ? (
                <p className="text-[12px] text-slate-400 italic">Could not load subscription data.</p>
              ) : subscription ? (() => {
                const isExpired = subscription.status === "expired";
                const isTrial = subscription.status === "trial";
                const isActive = subscription.status === "active";
                const isGrandfathered = subscription.status === "grandfathered";
                const isFreePlanKey = ["free_trial", "explorer"].includes(subscription.plan_key);
                const isPaidActive = isActive && !isFreePlanKey;
                const isFreeActive = isActive && isFreePlanKey;
                const startDate = fmtAdminDate(subscription.current_period_start);
                const endDate = fmtAdminDate(subscription.current_period_end);
                const statusColor = isExpired
                  ? "border-rose-200 bg-rose-50"
                  : isPaidActive
                  ? "border-emerald-100 bg-emerald-50"
                  : "border-brand-100 bg-brand-50";
                const dotColor = isExpired ? "bg-rose-500" : isPaidActive ? "bg-emerald-500" : "bg-brand-500";
                const statusLabel = isExpired ? "Trial expired" : isTrial ? "Free trial" : isFreeActive ? "Free plan" : isPaidActive ? "Paid plan" : "Grandfathered";
                const plan = getPlan(normalisePlanKey(subscription.plan_key ?? "explorer"));
                const planName = plan?.label ?? subscription.plan_key ?? "Explorer";
                const billingPeriod = subscription.billing_period === "annual" ? "Annual" : "Monthly";
                return (
                  <div className={`rounded-xl border p-4 ${statusColor}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
                          <span className="text-sm font-semibold text-slate-800">{statusLabel}</span>
                          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{planName}</span>
                          {isPaidActive && (
                            <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{billingPeriod}</span>
                          )}
                        </div>
                        {isPaidActive && startDate && endDate && (
                          <p className="mt-1 text-[11px] text-slate-600">
                            Paid: {startDate} → {endDate}
                          </p>
                        )}
                        {!isActive && endDate && (
                          <p className="mt-1 text-[11px] text-slate-500">
                            {isExpired ? "Expired" : "Expires"}: {endDate}
                          </p>
                        )}
                        {isPaidActive && subscription.stripe_subscription_id && (
                          <p className="mt-1 text-[11px] text-slate-400">Stripe: {subscription.stripe_subscription_id}</p>
                        )}
                        {isActive && plan?.features?.length > 0 && (
                          <ul className="mt-2.5 space-y-1">
                            {plan.features.map(f => (
                              <li key={f} className="flex items-start gap-1.5 text-[11px] text-slate-600">
                                <svg className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <path d="M20 6L9 17l-5-5" />
                                </svg>
                                {f}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {!isActive && !isGrandfathered && (
                        <button
                          type="button"
                          disabled={trialLoading}
                          onClick={handleRenewTrial}
                          className="shrink-0 rounded-xl border border-brand-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-50 disabled:opacity-40"
                        >
                          {trialLoading ? "Renewing…" : "Renew trial"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })() : null}

              {/* Plan override */}
              <div className="mt-3">
                {!showPlanOverride ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPlanOverrideKey(subscription?.plan_key ?? "starter_insight");
                      setPlanOverridePeriod(subscription?.billing_period ?? "monthly");
                      setPlanOverrideStatus(subscription?.status === "active" ? "active" : "active");
                      setShowPlanOverride(true);
                    }}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                    Change plan
                  </button>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Override plan</p>
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="mb-1 block text-[11px] text-slate-500">Plan</label>
                          <select
                            value={planOverrideKey}
                            onChange={(e) => setPlanOverrideKey(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-400"
                          >
                            <option value="explorer">Explorer (Free)</option>
                            <option value="starter_insight">Starter Insight</option>
                            <option value="decision_engine">Decision Engine</option>
                            <option value="growth_navigator">Growth Navigator</option>
                            <option value="strategic_business_os">Strategic Business OS</option>
                          </select>
                        </div>
                        <div className="w-28">
                          <label className="mb-1 block text-[11px] text-slate-500">Billing</label>
                          <select
                            value={planOverridePeriod}
                            onChange={(e) => setPlanOverridePeriod(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-400"
                          >
                            <option value="monthly">Monthly</option>
                            <option value="annual">Annual</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-slate-500">Status</label>
                        <select
                          value={planOverrideStatus}
                          onChange={(e) => setPlanOverrideStatus(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-400"
                        >
                          <option value="active">Active</option>
                          <option value="trial">Trial</option>
                          <option value="grandfathered">Grandfathered</option>
                          <option value="expired">Expired</option>
                        </select>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setShowPlanOverride(false)}
                          className="flex-1 rounded-xl border border-slate-200 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={planOverrideLoading}
                          onClick={handleSetPlan}
                          className="flex-1 rounded-xl bg-brand-600 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-40"
                        >
                          {planOverrideLoading ? "Saving…" : "Set plan"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Platform restrictions */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Module & feature restrictions</h3>
                {restrictionsLoading && <div className="h-3.5 w-3.5 animate-spin rounded-full border border-slate-300 border-t-slate-600" />}
              </div>
              <p className="mb-3 text-[11px] text-slate-500 leading-relaxed">
                Restrictions block access to specific modules or features across all this user's workspaces, overriding workspace-level permissions.
              </p>

              {/* Current restrictions */}
              {restrictions.length > 0 ? (
                <div className="mb-3 divide-y divide-slate-50 overflow-hidden rounded-xl border border-slate-200">
                  {restrictions.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                            {moduleLabel(r.module_key)}
                          </span>
                          {r.feature_key ? (
                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                              {featureLabel(r.module_key, r.feature_key)}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">entire module</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={removingId === r.id}
                        onClick={() => handleRemoveRestriction(r.id)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition disabled:opacity-30"
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mb-3 text-xs text-slate-400">No restrictions — full access based on workspace permissions.</p>
              )}

              {/* Add restriction form */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Add restriction</div>
                <select
                  value={addModule}
                  onChange={(e) => { setAddModule(e.target.value); setAddFeature(""); }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
                >
                  <option value="">Select module…</option>
                  {MODULES.filter((m) => m.key !== "dashboard").map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
                {addModule && (
                  <select
                    value={addFeature}
                    onChange={(e) => setAddFeature(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
                  >
                    <option value="">Entire module</option>
                    {availableFeatures.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  disabled={!addModule || addingRestriction}
                  onClick={handleAddRestriction}
                  className="w-full rounded-xl bg-brand-600 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-40"
                >
                  {addingRestriction ? "Adding…" : "Add restriction"}
                </button>
              </div>
            </div>

            {/* Module access grants */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Module access grants</h3>
                {grantsLoading && <div className="h-3.5 w-3.5 animate-spin rounded-full border border-slate-300 border-t-slate-600" />}
              </div>
              <p className="mb-3 text-[11px] text-slate-500 leading-relaxed">
                Grants unlock plan-locked modules for this user, overriding their current subscription limits.
              </p>

              {/* Current grants */}
              {grants.length > 0 ? (
                <div className="mb-3 divide-y divide-slate-50 overflow-hidden rounded-xl border border-slate-200">
                  {grants.map((g) => (
                    <div key={g.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            {moduleLabel(g.module_key)}
                          </span>
                          {g.feature_key ? (
                            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-700">
                              {featureLabel(g.module_key, g.feature_key)}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">entire module</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={removingGrantId === g.id}
                        onClick={() => handleRemoveGrant(g.id)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition disabled:opacity-30"
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mb-3 text-xs text-slate-400">No grants — access follows the user's plan.</p>
              )}

              {/* Add grant form */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                <div className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wide">Grant module access</div>
                <select
                  value={grantModule}
                  onChange={(e) => setGrantModule(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                >
                  <option value="">Select module…</option>
                  {MODULES.filter((m) => m.key !== "dashboard").map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!grantModule || addingGrant}
                  onClick={handleAddGrant}
                  className="w-full rounded-xl bg-emerald-600 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
                >
                  {addingGrant ? "Granting…" : "Grant access"}
                </button>
              </div>
            </div>

            {/* ── Credit wallet ── */}
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">AI Credits</h3>
              {creditWalletLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <div className="h-3 w-3 animate-spin rounded-full border border-slate-300 border-t-slate-600" />
                  Loading wallet…
                </div>
              ) : creditWallet ? (
                <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: "Available", value: creditWallet.available_credits ?? 0, color: "text-emerald-600" },
                    { label: "Held", value: creditWallet.held_credits ?? 0, color: "text-amber-600" },
                    { label: "Lifetime issued", value: creditWallet.lifetime_credits_issued ?? 0, color: "text-slate-700" },
                    { label: "Lifetime used", value: creditWallet.lifetime_credits_used ?? 0, color: "text-violet-700" },
                  ].map((m) => (
                    <div key={m.label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                      <div className={`text-lg font-bold tabular-nums ${m.color}`}>{m.value.toLocaleString()}</div>
                      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{m.label}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mb-3 text-xs text-slate-400">No wallet provisioned yet for this user.</p>
              )}
              <div className={`rounded-xl border p-4 ${creditAction === "grant" ? "border-violet-100 bg-violet-50" : "border-rose-100 bg-rose-50"}`}>
                {/* Toggle */}
                <div className="mb-3 flex items-center gap-1 rounded-lg bg-white/60 p-1 w-fit border border-slate-200">
                  {[{ k: "grant", label: "Grant" }, { k: "deduct", label: "Deduct" }].map(({ k, label }) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setCreditAction(k)}
                      className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                        creditAction === k
                          ? k === "grant" ? "bg-violet-600 text-white" : "bg-rose-600 text-white"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="10000"
                      value={grantAmount}
                      onChange={(e) => setGrantAmount(e.target.value)}
                      placeholder="Amount"
                      className={`w-24 rounded-lg border bg-white px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 outline-none focus:ring-1 ${creditAction === "grant" ? "border-violet-200 focus:ring-violet-400" : "border-rose-200 focus:ring-rose-400"}`}
                    />
                    <input
                      type="text"
                      value={grantReason}
                      onChange={(e) => setGrantReason(e.target.value)}
                      placeholder="Reason (optional)"
                      className={`flex-1 rounded-lg border bg-white px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 outline-none focus:ring-1 ${creditAction === "grant" ? "border-violet-200 focus:ring-violet-400" : "border-rose-200 focus:ring-rose-400"}`}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={!grantAmount || parseInt(grantAmount) <= 0 || grantLoading}
                    onClick={handleCreditAction}
                    className={`rounded-xl py-2 text-xs font-semibold text-white transition disabled:opacity-40 ${creditAction === "grant" ? "bg-violet-600 hover:bg-violet-700" : "bg-rose-600 hover:bg-rose-700"}`}
                  >
                    {grantLoading
                      ? (creditAction === "grant" ? "Granting…" : "Deducting…")
                      : creditAction === "grant"
                        ? `Grant ⚡ ${grantAmount || 0} credits`
                        : `Deduct ⚡ ${grantAmount || 0} credits`}
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ── Activity & Data tab ── */}
        {panelTab === "activity" && (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {fullDataLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
                <p className="text-xs text-slate-400">Loading user data…</p>
              </div>
            ) : !fullData ? (
              <div className="flex flex-col items-center justify-center py-16">
                <p className="text-xs text-slate-400">Failed to load data.</p>
                <button type="button" onClick={() => loadFullData(user.id)} className="mt-3 text-xs text-brand-600 hover:text-brand-700 font-medium">Retry</button>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Summary metrics */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Workspaces owned", value: fullData.owned_workspaces.length },
                    { label: "Team memberships", value: fullData.memberships.length },
                    { label: "Blueprint docs", value: fullData.blueprint_documents.length },
                    { label: "Upgrade clicks", value: fullData.upgrade_clicks.length },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
                      <div className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">{value}</div>
                    </div>
                  ))}
                </div>

                {/* Workspaces with data breakdown */}
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Workspaces ({fullData.owned_workspaces.length})</h3>
                  {fullData.owned_workspaces.length > 0 ? (
                    <div className="space-y-2">
                      {fullData.owned_workspaces.map((ws) => (
                        <div key={ws.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                          <div className="flex items-center justify-between gap-3 px-3 py-3">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-semibold text-slate-800">{ws.name}</div>
                              <div className="mt-1 flex flex-wrap gap-2">
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{ws.sim_count} simulations</span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{ws.blueprint_count} blueprints</span>
                                {ws.has_validation && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold text-teal-700">Validated</span>}
                                {ws.has_service_validation && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">Service validated</span>}
                              </div>
                              <div className="mt-1 text-[10px] text-slate-400">Updated {formatDate(ws.updated_at)} · Created {formatDate(ws.created_at)}</div>
                            </div>
                            <ActionBtn
                              variant="danger"
                              title="Delete workspace"
                              disabled={actionLoading}
                              onClick={() => onDeleteWorkspace(ws.id, ws.name)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-xs text-slate-400">No owned workspaces.</p>}
                </div>

                {/* Blueprint documents */}
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Blueprint documents ({fullData.blueprint_documents.length})</h3>
                  {fullData.blueprint_documents.length > 0 ? (
                    <div className="divide-y divide-slate-50 overflow-hidden rounded-xl border border-slate-200">
                      {fullData.blueprint_documents.map((doc) => (
                        <div key={doc.id} className="flex items-center gap-3 px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium text-slate-800">{doc.title || "Untitled"}</div>
                            <div className="mt-0.5 flex gap-2 text-[10px] text-slate-400">
                              <span className="capitalize">{doc.type?.replace(/_/g, " ") || "—"}</span>
                              {doc.company_name && <><span>·</span><span>{doc.company_name}</span></>}
                            </div>
                          </div>
                          <span className="text-[11px] text-slate-400">{formatDate(doc.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-xs text-slate-400">No blueprint documents.</p>}
                </div>

                {/* Upgrade clicks */}
                {fullData.upgrade_clicks.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Upgrade intent ({fullData.upgrade_clicks.length})</h3>
                    <div className="divide-y divide-slate-50 overflow-hidden rounded-xl border border-slate-200">
                      {fullData.upgrade_clicks.slice(0, 10).map((u, i) => (
                        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium text-slate-800">{u.feature || "—"}</div>
                            <div className="mt-0.5 text-[10px] text-slate-400">{u.source || "—"}</div>
                          </div>
                          <span className="text-[11px] text-slate-400">{formatDateTime(u.clicked_at)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {user.email !== ADMIN_EMAIL && (
          <div className="shrink-0 border-t border-slate-100 px-5 py-3">
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => onDeleteUser(user.id, user.email)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-100 disabled:opacity-40"
            >
              <TrashIcon />
              Delete account permanently
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Insight card ──────────────────────────────────────────────────────────────

const INSIGHT_COLORS = {
  amber: { bg: "bg-amber-50", border: "border-amber-100", count: "text-amber-700", label: "text-amber-600", btn: "bg-amber-600 hover:bg-amber-700", dot: "bg-amber-400" },
  sky:   { bg: "bg-sky-50",   border: "border-sky-100",   count: "text-sky-700",   label: "text-sky-600",   btn: "bg-sky-600 hover:bg-sky-700",   dot: "bg-sky-400" },
  violet:{ bg: "bg-violet-50",border: "border-violet-100",count: "text-violet-700",label: "text-violet-600",btn: "bg-violet-600 hover:bg-violet-700",dot: "bg-violet-400" },
  emerald:{bg:"bg-emerald-50",border:"border-emerald-100",count:"text-emerald-700",label:"text-emerald-600",btn:"bg-emerald-600 hover:bg-emerald-700",dot:"bg-emerald-400"},
};

function InsightCard({ label, count, description, color = "amber", onAction, actionLabel }) {
  const c = INSIGHT_COLORS[color] || INSIGHT_COLORS.amber;
  return (
    <div className={`flex flex-col justify-between rounded-2xl border p-4 ${c.bg} ${c.border}`}>
      <div>
        <div className={`text-3xl font-bold tabular-nums ${c.count}`}>{count}</div>
        <div className={`mt-1 text-xs font-semibold ${c.label}`}>{label}</div>
        <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">{description}</p>
      </div>
      {onAction && (
        <button
          type="button"
          onClick={onAction}
          className={`mt-4 rounded-xl px-3 py-2 text-[12px] font-semibold text-white transition ${c.btn}`}
        >
          {actionLabel || "View →"}
        </button>
      )}
    </div>
  );
}

// ── Data table ────────────────────────────────────────────────────────────────

function DataTable({ columns, rows, emptyText = "No data" }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-6 w-6 text-slate-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </div>
        <p className="mt-3 text-sm text-slate-400">{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/80">
            {columns.map((col) => (
              <th key={col.key} className={`px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 ${col.className || ""}`}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map((row, i) => (
            <tr key={row.id || i} className="hover:bg-slate-50/60 transition-colors">
              {columns.map((col) => (
                <td key={col.key} className={`px-4 py-3 text-slate-700 ${col.tdClass || ""}`}>
                  {col.render ? col.render(row) : (row[col.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Stat tiles ────────────────────────────────────────────────────────────────

const STAT_CONFIG = [
  { key: "total_workspaces", label: "Workspaces", targetTab: "workspaces", color: "bg-brand-50 text-brand-700 border-brand-100", iconBg: "bg-brand-100", iconColor: "text-brand-600", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg> },
  { key: "total_users", label: "Total Users", targetTab: "users", color: "bg-emerald-50 text-emerald-700 border-emerald-100", iconBg: "bg-emerald-100", iconColor: "text-emerald-600", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg> },
  { key: "total_members", label: "Members", targetTab: "members", color: "bg-violet-50 text-violet-700 border-violet-100", iconBg: "bg-violet-100", iconColor: "text-violet-600", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" /></svg> },
  { key: "total_invitations", label: "Invitations", targetTab: "invitations", color: "bg-amber-50 text-amber-700 border-amber-100", iconBg: "bg-amber-100", iconColor: "text-amber-600", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg> },
  { key: "total_simulations", label: "Simulations", targetTab: null, color: "bg-sky-50 text-sky-700 border-sky-100", iconBg: "bg-sky-100", iconColor: "text-sky-600", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg> },
  { key: "total_blueprints", label: "Blueprints", targetTab: null, color: "bg-indigo-50 text-indigo-700 border-indigo-100", iconBg: "bg-indigo-100", iconColor: "text-indigo-600", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg> },
  { key: "total_validated_workspaces", label: "Validated", targetTab: null, color: "bg-teal-50 text-teal-700 border-teal-100", iconBg: "bg-teal-100", iconColor: "text-teal-600", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
];

function StatTile({ config, value, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition ${config.color} ${onClick ? "cursor-pointer hover:shadow-md hover:scale-[1.02]" : ""}`}
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${config.iconBg} ${config.iconColor}`}>
        {config.icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold tabular-nums leading-none">{value ?? "—"}</div>
        <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide opacity-70 truncate">{config.label}</div>
      </div>
    </Tag>
  );
}

// ── Tab config ────────────────────────────────────────────────────────────────

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "ai-usage", label: "AI Usage" },
  { key: "credits", label: "Credits" },
  { key: "workspaces", label: "Workspaces" },
  { key: "users", label: "Users" },
  { key: "members", label: "Members" },
  { key: "invitations", label: "Invitations" },
  { key: "upgrades", label: "Upgrade Clicks" },
  { key: "module-interest", label: "Module Interest" },
  { key: "mailing-list", label: "Mailing List" },
  { key: "support", label: "Support Messages" },
  { key: "referrals", label: "Referrals" },
];

const INV_FILTERS = ["all", "pending", "accepted", "revoked"];

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const navigate = useNavigate();
  const email = useAuthStore((s) => s.email);

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [invitationFilter, setInvitationFilter] = useState("all");
  const [aiModelFilter, setAiModelFilter] = useState("");
  const [aiDateFilter, setAiDateFilter] = useState("all");
  const [aiUserFilter, setAiUserFilter] = useState("");
  const [aiFeatureFilter, setAiFeatureFilter] = useState("");
  const [aiPage, setAiPage] = useState(1);

  const [confirm, setConfirm] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [userDetail, setUserDetail] = useState(null);

  const [upgrades, setUpgrades] = useState(null);
  const [upgradesLoaded, setUpgradesLoaded] = useState(false);

  const [toast, setToast] = useState(null);

  const isAdmin = email === ADMIN_EMAIL;

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadStats = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const data = await apiRequest("/admin/stats", "GET");
      setStats(data);
    } catch (e) {
      setError(e.message || "Failed to load admin stats.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    loadStats();
  }, [isAdmin, loadStats]);

  const loadUpgrades = useCallback(() => {
    if (upgradesLoaded) return;
    apiRequest("/admin/upgrade-clicks", "GET")
      .then((data) => { setUpgrades(data); setUpgradesLoaded(true); })
      .catch(() => { setUpgrades([]); setUpgradesLoaded(true); });
  }, [upgradesLoaded]);

  useEffect(() => {
    if (tab === "upgrades") loadUpgrades();
  }, [tab, loadUpgrades]);

  const [moduleInterest, setModuleInterest] = useState(null);
  const [moduleInterestLoaded, setModuleInterestLoaded] = useState(false);

  const loadModuleInterest = useCallback(() => {
    if (moduleInterestLoaded) return;
    apiRequest("/admin/module-interest", "GET")
      .then((data) => { setModuleInterest(data); setModuleInterestLoaded(true); })
      .catch(() => { setModuleInterest([]); setModuleInterestLoaded(true); });
  }, [moduleInterestLoaded]);

  useEffect(() => {
    if (tab === "module-interest") loadModuleInterest();
  }, [tab, loadModuleInterest]);

  const [supportMessages, setSupportMessages] = useState(null);
  const [supportLoaded, setSupportLoaded] = useState(false);

  const loadSupportMessages = useCallback(() => {
    if (supportLoaded) return;
    apiRequest("/admin/support-messages", "GET")
      .then((data) => { setSupportMessages(data); setSupportLoaded(true); })
      .catch(() => { setSupportMessages([]); setSupportLoaded(true); });
  }, [supportLoaded]);

  useEffect(() => {
    if (tab === "support") loadSupportMessages();
  }, [tab, loadSupportMessages]);

  const [referralStats, setReferralStats] = useState(null);
  const [referralParticipants, setReferralParticipants] = useState(null);
  const [referralPayouts, setReferralPayouts] = useState(null);
  const [referralLoaded, setReferralLoaded] = useState(false);
  const [referralPayoutAction, setReferralPayoutAction] = useState({}); // {[id]: loading}
  const [referralPayoutReason, setReferralPayoutReason] = useState({}); // {[id]: string}

  const loadReferrals = useCallback(() => {
    if (referralLoaded) return;
    Promise.all([
      apiRequest("/referrals/admin/stats", "GET").catch(() => null),
      apiRequest("/referrals/admin/participants", "GET").catch(() => ({ items: [] })),
      apiRequest("/referrals/admin/payouts", "GET").catch(() => ({ items: [] })),
    ]).then(([stats, parts, payouts]) => {
      setReferralStats(stats);
      setReferralParticipants(parts?.items || []);
      setReferralPayouts(payouts?.items || []);
      setReferralLoaded(true);
    });
  }, [referralLoaded]);

  useEffect(() => {
    if (tab === "referrals") loadReferrals();
  }, [tab, loadReferrals]);

  async function handlePayoutDecision(payoutId, action) {
    const reason = referralPayoutReason[payoutId] || "";
    if (!reason.trim()) { alert("Please enter a reason before deciding."); return; }
    setReferralPayoutAction((p) => ({ ...p, [payoutId]: true }));
    try {
      await apiRequest(`/referrals/admin/payouts/${payoutId}`, "PATCH", { action, reason });
      const updated = await apiRequest("/referrals/admin/payouts", "GET");
      setReferralPayouts(updated?.items || []);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setReferralPayoutAction((p) => ({ ...p, [payoutId]: false }));
    }
  }

  const [mailingList, setMailingList] = useState(null);
  const [mailingListLoaded, setMailingListLoaded] = useState(false);

  const loadMailingList = useCallback(() => {
    if (mailingListLoaded) return;
    apiRequest("/admin/mailing-list", "GET")
      .then((data) => { setMailingList(data); setMailingListLoaded(true); })
      .catch(() => { setMailingList([]); setMailingListLoaded(true); });
  }, [mailingListLoaded]);

  useEffect(() => {
    if (tab === "mailing-list") loadMailingList();
  }, [tab, loadMailingList]);

  // ── Toast helpers ─────────────────────────────────────────────────────────

  const showToast = useCallback((kind, msg) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Workspace detail panel ────────────────────────────────────────────────

  async function openDetail(workspaceId) {
    setDetailLoading(true);
    try {
      const data = await apiRequest(`/admin/workspaces/${workspaceId}`, "GET");
      setDetail(data);
    } catch (e) {
      showToast("error", e.message || "Failed to load workspace detail.");
    } finally {
      setDetailLoading(false);
    }
  }

  function refreshDetail() {
    if (detail?.id) openDetail(detail.id);
  }

  // ── Confirm + action execution ────────────────────────────────────────────

  function askConfirm(payload) {
    setConfirm(payload);
  }

  async function executeConfirm() {
    if (!confirm) return;
    setActionLoading(true);
    try {
      await confirm.action();
      showToast("success", confirm.successMsg || "Done.");
      setConfirm(null);
      loadStats(true);
      if (detail) refreshDetail();
      if (confirm.afterAction) confirm.afterAction();
    } catch (e) {
      showToast("error", e.message || "Action failed.");
      setConfirm(null);
    } finally {
      setActionLoading(false);
    }
  }

  // ── Per-entity actions ────────────────────────────────────────────────────

  function deleteUser(userId, userEmail) {
    askConfirm({
      title: "Delete user account?",
      description: `This permanently deletes "${userEmail}" and all their workspace data. This cannot be undone.`,
      label: "Delete user",
      successMsg: `User "${userEmail}" deleted.`,
      afterAction: () => setUserDetail(null),
      action: () => apiRequest(`/admin/users/${userId}`, "DELETE"),
    });
  }

  function deleteWorkspace(workspaceId, workspaceName) {
    askConfirm({
      title: "Delete workspace?",
      description: `This permanently deletes "${workspaceName}" including all members, invitations, and workspace data.`,
      label: "Delete workspace",
      successMsg: `Workspace "${workspaceName}" deleted.`,
      action: async () => {
        await apiRequest(`/admin/workspaces/${workspaceId}`, "DELETE");
        if (detail?.id === workspaceId) setDetail(null);
      },
    });
  }

  function removeMember(memberId, memberEmail) {
    askConfirm({
      title: "Remove workspace member?",
      description: `Remove "${memberEmail || memberId}" from this workspace. They will lose access immediately.`,
      label: "Remove member",
      successMsg: "Member removed.",
      action: () => apiRequest(`/admin/members/${memberId}`, "DELETE"),
    });
  }

  function revokeInvitation(invitationId, invEmail) {
    askConfirm({
      title: "Revoke invitation?",
      description: `Revoke the pending invitation${invEmail ? ` for "${invEmail}"` : ""}. The link will stop working immediately.`,
      label: "Revoke",
      successMsg: "Invitation revoked.",
      action: () => apiRequest(`/admin/invitations/${invitationId}/revoke`, "PATCH"),
    });
  }

  function bulkRevokePending() {
    const pending = (stats?.invitations || []).filter((i) => i.status === "pending");
    if (!pending.length) return;
    askConfirm({
      title: `Revoke all ${pending.length} pending invitation${pending.length > 1 ? "s" : ""}?`,
      description: "All pending invitation links will stop working immediately. Members who haven't accepted yet will lose their links.",
      label: `Revoke all ${pending.length}`,
      successMsg: `Revoked ${pending.length} pending invitation${pending.length > 1 ? "s" : ""}.`,
      action: async () => {
        await Promise.all(pending.map((i) => apiRequest(`/admin/invitations/${i.id}/revoke`, "PATCH")));
      },
    });
  }

  // ── Navigation helper ─────────────────────────────────────────────────────

  function goToTab(tabKey) {
    setTab(tabKey);
    setSearch("");
  }

  // ── Derived / filtered data ───────────────────────────────────────────────

  const q = search.trim().toLowerCase();

  const filteredWorkspaces = useMemo(() =>
    (stats?.workspaces || []).filter((w) =>
      !q || w.name?.toLowerCase().includes(q) || w.id?.toLowerCase().includes(q) || w.owner_email?.toLowerCase().includes(q)
    ), [stats?.workspaces, q]);

  const filteredUsers = useMemo(() =>
    (stats?.users || []).filter((u) =>
      !q || u.email?.toLowerCase().includes(q) || u.id?.toLowerCase().includes(q)
    ), [stats?.users, q]);

  const filteredMembers = useMemo(() =>
    (stats?.members || []).filter((m) =>
      !q || m.user_email?.toLowerCase().includes(q) || m.workspace_name?.toLowerCase().includes(q)
    ), [stats?.members, q]);

  const filteredInvitations = useMemo(() => {
    const statusMatch = (i) => invitationFilter === "all" || i.status === invitationFilter;
    return (stats?.invitations || []).filter((i) =>
      statusMatch(i) &&
      (!q || i.invited_email?.toLowerCase().includes(q) || i.workspace_name?.toLowerCase().includes(q) || i.status?.includes(q))
    );
  }, [stats?.invitations, q, invitationFilter]);

  const filteredUpgrades = useMemo(() =>
    (upgrades || []).filter((u) =>
      !q || u.email?.toLowerCase().includes(q) || u.feature?.toLowerCase().includes(q) || u.source?.toLowerCase().includes(q)
    ), [upgrades, q]);

  const filteredModuleInterest = useMemo(() =>
    (moduleInterest || []).filter((m) =>
      !q || m.email?.toLowerCase().includes(q) || m.feature?.toLowerCase().includes(q)
    ), [moduleInterest, q]);

  const filteredSupport = useMemo(() =>
    (supportMessages || []).filter((m) =>
      !q || m.name?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q) || m.message?.toLowerCase().includes(q) || m.type?.toLowerCase().includes(q)
    ), [supportMessages, q]);

  const filteredMailingList = useMemo(() =>
    (mailingList || []).filter((m) =>
      !q || m.email?.toLowerCase().includes(q) || m.source?.toLowerCase().includes(q)
    ), [mailingList, q]);

  const tabCounts = {
    workspaces: stats?.total_workspaces ?? 0,
    users: stats?.total_users ?? 0,
    members: stats?.total_members ?? 0,
    invitations: stats?.total_invitations ?? 0,
  };

  const invStatusCounts = useMemo(() => {
    const all = stats?.invitations || [];
    return {
      all: all.length,
      pending: all.filter((i) => i.status === "pending").length,
      accepted: all.filter((i) => i.status === "accepted").length,
      revoked: all.filter((i) => i.status === "revoked").length,
    };
  }, [stats?.invitations]);

  const insights = useMemo(() => {
    if (!stats) return [];
    const ownedEmails = new Set((stats.workspaces || []).map((w) => w.owner_email));
    const memberEmails = new Set((stats.members || []).map((m) => m.user_email));
    const orphaned = (stats.users || []).filter((u) => !ownedEmails.has(u.email) && !memberEmails.has(u.email));
    const pendingInv = (stats.invitations || []).filter((i) => i.status === "pending");
    const soloWs = (stats.workspaces || []).filter((w) => (w.member_count ?? 0) === 0);
    return [
      {
        id: "orphaned", color: "amber", label: "Users without a workspace", count: orphaned.length,
        description: "Accounts with no owned workspace and no memberships. These users may have dropped off during onboarding.",
        onAction: () => goToTab("users"), actionLabel: "View users →",
      },
      {
        id: "pending", color: "sky", label: "Pending invitations", count: pendingInv.length,
        description: "Open invitation links still waiting to be claimed. Consider following up or revoking stale links.",
        onAction: () => { goToTab("invitations"); setInvitationFilter("pending"); }, actionLabel: "View pending →",
      },
      {
        id: "solo", color: "violet", label: "Solo workspaces", count: soloWs.length,
        description: "Workspaces with no team members yet. These owners may benefit from guided activation.",
        onAction: () => goToTab("workspaces"), actionLabel: "View workspaces →",
      },
      {
        id: "upgrades", color: "emerald", label: "Upgrade intent clicks", count: stats.total_upgrade_clicks ?? 0,
        description: "Users who clicked an upgrade prompt — warm leads for outreach or product feedback.",
        onAction: () => goToTab("upgrades"), actionLabel: "View upgrade clicks →",
      },
    ];
  }, [stats]);

  const platformMetrics = useMemo(() => {
    if (!stats) return [];
    const ws = stats.workspaces || [];
    const inv = stats.invitations || [];
    const accepted = inv.filter((i) => i.status === "accepted").length;
    const wsWithMembers = ws.filter((w) => (w.member_count ?? 0) > 0).length;
    const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
    return [
      { label: "Invitation acceptance rate", value: pct(accepted, inv.length), sub: `${accepted} of ${inv.length} invitations accepted` },
      { label: "Team adoption rate", value: pct(wsWithMembers, ws.length), sub: `${wsWithMembers} of ${ws.length} workspaces have team members` },
      { label: "Avg. members / workspace", value: ws.length > 0 ? (stats.total_members / ws.length).toFixed(1) : "—", sub: `${stats.total_members} members across ${ws.length} workspaces` },
      { label: "Validation completion rate", value: pct(stats.total_validated_workspaces, ws.length), sub: `${stats.total_validated_workspaces} of ${ws.length} workspaces validated` },
      { label: "Simulation usage rate", value: pct(stats.total_simulations, ws.length), sub: `${stats.total_simulations} simulation runs total` },
      { label: "Blueprint generation rate", value: pct(stats.total_blueprints, ws.length), sub: `${stats.total_blueprints} blueprints generated` },
    ];
  }, [stats]);

  // ── Guard states ──────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-8 w-8 text-slate-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-semibold text-slate-900">Access restricted</h2>
        <p className="mt-2 max-w-xs text-sm text-slate-500">This page is restricted to system administrators only.</p>
        <button type="button" onClick={() => navigate("/dashboard")}
          className="mt-6 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700">
          Back to dashboard
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50">
        <img src={logoUrl} alt="EnterprateAI" className="h-8 w-auto opacity-60" />
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        <p className="text-xs text-slate-400">Loading system data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
        <p className="text-sm font-medium text-slate-700">Failed to load data</p>
        <p className="text-xs text-slate-400">{error}</p>
        <button type="button" onClick={() => loadStats()}
          className="mt-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700">
          Retry
        </button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">

      <ConfirmModal confirm={confirm} onCancel={() => setConfirm(null)} onConfirm={executeConfirm} loading={actionLoading} />

      {(detail || detailLoading) && (
        <WorkspaceDetailPanel
          detail={detail}
          onClose={() => setDetail(null)}
          onDeleteMember={(id) => removeMember(id, detail?.members?.find((m) => m.id === id)?.email)}
          onRevokeInvitation={(id) => revokeInvitation(id, detail?.invitations?.find((i) => i.id === id)?.email)}
          actionLoading={actionLoading}
          onRestore={() => { loadStats(true); refreshDetail(); }}
          onRename={(wsId, newName) => {
            setDetail((d) => d ? { ...d, name: newName } : d);
            loadStats(true);
          }}
        />
      )}

      {userDetail && (
        <UserDetailPanel
          user={userDetail}
          stats={stats}
          upgrades={upgrades}
          onClose={() => setUserDetail(null)}
          onDeleteUser={deleteUser}
          onDeleteWorkspace={deleteWorkspace}
          onUserUpdated={(updatedUser) => {
            setUserDetail((prev) => prev ? { ...prev, ...updatedUser } : prev);
            loadStats(true);
          }}
          showToast={showToast}
          actionLoading={actionLoading}
        />
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto sm:h-8" />
          <div className="h-5 w-px bg-slate-200" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">System Admin</span>
            <span className="hidden rounded-full bg-brand-100 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700 sm:inline">
              Control Panel
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={() => loadStats(true)}
              disabled={refreshing}
              title="Refresh data"
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 disabled:opacity-40"
            >
              <span className={refreshing ? "animate-spin" : ""}><RefreshIcon /></span>
            </button>
            <span className="hidden text-xs text-slate-400 sm:block">{email}</span>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">Admin</span>
          </div>
        </div>
      </header>

      <div className="ea-scroll flex-1 overflow-y-auto overflow-x-hidden">
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 pb-10 sm:px-6 lg:px-8">

        {/* Stat tiles — clickable where a target tab exists */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {STAT_CONFIG.map((cfg) => (
            <StatTile
              key={cfg.key}
              config={cfg}
              value={stats[cfg.key]}
              onClick={cfg.targetTab ? () => goToTab(cfg.targetTab) : undefined}
            />
          ))}
        </div>

        {/* Tab nav */}
        <div className="overflow-x-auto">
          <div className="flex min-w-max gap-1 rounded-2xl border border-slate-200 bg-white p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => { goToTab(t.key); }}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition whitespace-nowrap ${
                  tab === t.key ? "bg-brand-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                {t.label}
                {tabCounts[t.key] !== undefined ? (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                    tab === t.key ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                  }`}>
                    {tabCounts[t.key]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {/* ── Overview ── */}
        {tab === "overview" && (
          <div className="space-y-5">

            {/* 1 — Actionable insights */}
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Actionable insights</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {insights.map((ins) => (
                  <InsightCard
                    key={ins.id}
                    label={ins.label}
                    count={ins.count}
                    description={ins.description}
                    color={ins.color}
                    onAction={ins.onAction}
                    actionLabel={ins.actionLabel}
                  />
                ))}
              </div>
            </section>

            {/* 2 — Platform health metrics */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 text-sm font-semibold text-slate-800">Platform health metrics</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {platformMetrics.map((m) => (
                  <div key={m.label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                    <div className="text-xl font-bold tabular-nums text-slate-900">{m.value}</div>
                    <div className="mt-0.5 text-[11px] font-semibold text-slate-700 leading-tight">{m.label}</div>
                    <div className="mt-1 text-[10px] text-slate-400 leading-tight">{m.sub}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* 3 — AI usage snapshot */}
            {stats?.ai_usage && (
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-800">AI usage snapshot</h2>
                  <button type="button" onClick={() => goToTab("ai-usage")} className="text-xs font-medium text-brand-600 hover:text-brand-700">Full report →</button>
                </div>
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Total calls", value: (stats.ai_usage.total_calls ?? 0).toLocaleString() },
                    { label: "Total tokens", value: (stats.ai_usage.total_tokens ?? 0).toLocaleString() },
                    { label: "Input tokens", value: (stats.ai_usage.input_tokens ?? 0).toLocaleString() },
                    { label: "Est. cost (USD)", value: stats.ai_usage.estimated_cost_usd != null ? `$${Number(stats.ai_usage.estimated_cost_usd).toFixed(4)}` : "—" },
                  ].map((m) => (
                    <div key={m.label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                      <div className="text-xl font-bold tabular-nums text-slate-900">{m.value}</div>
                      <div className="mt-0.5 text-[11px] font-semibold text-slate-500">{m.label}</div>
                    </div>
                  ))}
                </div>
                {(stats.ai_usage.by_feature || []).length > 0 && (
                  <div className="divide-y divide-slate-50">
                    <div className="flex items-center justify-between pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      <span>Feature</span>
                      <span className="flex gap-6">
                        <span>Calls</span>
                        <span>Tokens</span>
                        <span>Cost (USD)</span>
                      </span>
                    </div>
                    {(stats.ai_usage.by_feature || []).slice(0, 8).map((row) => (
                      <div key={row.label} className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
                        <span className="truncate text-slate-700">{row.label}</span>
                        <span className="flex shrink-0 gap-6 tabular-nums text-slate-500">
                          <span className="w-10 text-right">{row.calls}</span>
                          <span className="w-16 text-right">{(row.tokens || 0).toLocaleString()}</span>
                          <span className="w-20 text-right">${Number(row.estimated_cost_usd || 0).toFixed(5)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {!(stats.ai_usage.by_feature || []).length && (
                  <p className="text-xs text-slate-400">No AI usage recorded yet. Create the <code className="font-mono text-[11px]">ai_usage_events</code> table to start tracking.</p>
                )}
              </section>
            )}

            {/* 4 — Credits snapshot */}
            {stats?.credit_stats && (
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-800">Credits snapshot</h2>
                  <button type="button" onClick={() => goToTab("credits")} className="text-xs font-medium text-brand-600 hover:text-brand-700">Full report →</button>
                </div>
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Total issued", value: (stats.credit_stats.total_issued ?? 0).toLocaleString() },
                    { label: "Total consumed", value: (stats.credit_stats.total_consumed ?? 0).toLocaleString() },
                    { label: "Total available", value: (stats.credit_stats.total_available ?? 0).toLocaleString() },
                    { label: "Active wallets", value: (stats.credit_stats.wallet_count ?? 0).toLocaleString() },
                  ].map((m) => (
                    <div key={m.label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                      <div className="text-xl font-bold tabular-nums text-slate-900">{m.value}</div>
                      <div className="mt-0.5 text-[11px] font-semibold text-slate-500">{m.label}</div>
                    </div>
                  ))}
                </div>
                {(stats.credit_stats.by_feature || []).length > 0 && (
                  <div className="divide-y divide-slate-50">
                    <div className="flex items-center justify-between pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      <span>Feature</span>
                      <span className="flex gap-8">
                        <span>Uses</span>
                        <span>Credits</span>
                      </span>
                    </div>
                    {(stats.credit_stats.by_feature || []).slice(0, 6).map((row) => (
                      <div key={row.feature_code} className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
                        <span className="truncate font-mono text-slate-700">{row.feature_code}</span>
                        <span className="flex shrink-0 gap-8 tabular-nums text-slate-500">
                          <span className="w-10 text-right">{row.uses}</span>
                          <span className="w-14 text-right font-semibold text-violet-700">⚡{row.credits}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {!(stats.credit_stats.by_feature || []).length && (
                  <p className="text-xs text-slate-400">No credit transactions recorded yet.</p>
                )}
              </section>
            )}

            {/* 6 — Recent workspaces + users (compact reference) */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-800">Recent workspaces</h2>
                  <button type="button" onClick={() => goToTab("workspaces")} className="text-xs font-medium text-brand-600 hover:text-brand-700">View all →</button>
                </div>
                <div className="divide-y divide-slate-50">
                  {(stats.workspaces || []).slice(0, 5).map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-slate-800">{r.name || "Unnamed"}</div>
                        <div className="truncate text-[11px] text-slate-400">{r.owner_email || "—"}</div>
                      </div>
                      <span className="shrink-0 text-[11px] text-slate-400 whitespace-nowrap">{formatDate(r.created_at)}</span>
                    </div>
                  ))}
                  {!(stats.workspaces || []).length && <p className="py-3 text-xs text-slate-400">No workspaces yet</p>}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-800">Recent users</h2>
                  <button type="button" onClick={() => goToTab("users")} className="text-xs font-medium text-brand-600 hover:text-brand-700">View all →</button>
                </div>
                <div className="divide-y divide-slate-50">
                  {(stats.users || []).slice(0, 5).map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0 flex-1 flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-slate-800">{r.email}</span>
                        {r.is_blocked && <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">Blocked</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => setUserDetail(r)}
                        className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 transition hover:bg-brand-100"
                      >
                        Manage
                      </button>
                    </div>
                  ))}
                  {!(stats.users || []).length && <p className="py-3 text-xs text-slate-400">No users yet</p>}
                </div>
              </section>
            </div>

            {/* 5 — Data exports + Bulk ops */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="mb-1 text-sm font-semibold text-slate-800">Data exports</h2>
                <p className="mb-4 text-[12px] text-slate-400">Download platform data as CSV for analytics or offline reporting.</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    {
                      label: "All users", sub: `${stats?.total_users ?? 0} records`,
                      onClick: () => downloadCSV(stats?.users || [], [
                        { key: "id", label: "ID" }, { key: "email", label: "Email" }, { key: "created_at", label: "Joined" },
                      ], "users.csv"),
                    },
                    {
                      label: "All workspaces", sub: `${stats?.total_workspaces ?? 0} records`,
                      onClick: () => downloadCSV(stats?.workspaces || [], [
                        { key: "id", label: "ID" }, { key: "name", label: "Name" }, { key: "owner_email", label: "Owner" },
                        { key: "member_count", label: "Members" }, { key: "created_at", label: "Created" },
                      ], "workspaces.csv"),
                    },
                    {
                      label: "All members", sub: `${stats?.total_members ?? 0} records`,
                      onClick: () => downloadCSV(stats?.members || [], [
                        { key: "id", label: "ID" }, { key: "user_email", label: "User Email" }, { key: "workspace_name", label: "Workspace" },
                        { key: "permission_type", label: "Permission" }, { key: "created_at", label: "Added" },
                      ], "members.csv"),
                    },
                    {
                      label: "All invitations", sub: `${stats?.total_invitations ?? 0} records`,
                      onClick: () => downloadCSV(stats?.invitations || [], [
                        { key: "id", label: "ID" }, { key: "workspace_name", label: "Workspace" }, { key: "invited_email", label: "Email" },
                        { key: "status", label: "Status" }, { key: "created_at", label: "Sent" },
                      ], "invitations.csv"),
                    },
                    {
                      label: "Upgrade clicks", sub: upgradesLoaded ? `${upgrades?.length ?? 0} records` : "Load required",
                      onClick: upgradesLoaded
                        ? () => downloadCSV(upgrades || [], [
                            { key: "email", label: "Email" }, { key: "feature", label: "Feature" },
                            { key: "source", label: "Source" }, { key: "clicked_at", label: "Clicked At" },
                          ], "upgrade-clicks.csv")
                        : () => { loadUpgrades(); showToast("success", "Upgrade data loading — try again in a moment."); },
                    },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={item.onClick}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition hover:border-brand-200 hover:bg-brand-50 group"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-500 group-hover:border-brand-200 group-hover:text-brand-600 transition">
                        <DownloadIcon />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-slate-800">{item.label}</div>
                        <div className="text-[11px] text-slate-400">{item.sub}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="mb-1 text-sm font-semibold text-slate-800">Bulk operations</h2>
                <p className="mb-4 text-[12px] text-slate-400">Platform-wide actions that affect multiple records at once. Use with care.</p>
                <div className="flex items-start gap-4 rounded-xl border border-amber-100 bg-amber-50 p-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                    <BanIcon />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-slate-800">Revoke all pending invitations</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      Immediately invalidates all {invStatusCounts.pending} pending invitation link{invStatusCounts.pending !== 1 ? "s" : ""} across the platform.
                    </div>
                    <button
                      type="button"
                      disabled={invStatusCounts.pending === 0}
                      onClick={bulkRevokePending}
                      className="mt-3 rounded-xl bg-amber-600 px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-amber-700 disabled:opacity-40"
                    >
                      Revoke {invStatusCounts.pending} pending
                    </button>
                  </div>
                </div>
              </section>
            </div>

          </div>
        )}

        {/* ── AI Usage ── */}
        {tab === "ai-usage" && (() => {
          const AI_PAGE_SIZE = 15;
          const allEvents = stats?.ai_usage?.recent || [];
          const now = new Date();

          const modelOptions = [...new Set(allEvents.map((r) => `${r.provider} / ${r.model}`).filter(Boolean))].sort();
          const userOptions = [...new Set(allEvents.map((r) => r.user_email || r.user_id).filter(Boolean))].sort();
          const featureOptions = [...new Set(allEvents.map((r) => r.feature).filter(Boolean))].sort();

          const filtered = allEvents.filter((r) => {
            if (aiModelFilter && `${r.provider} / ${r.model}` !== aiModelFilter) return false;
            if (aiUserFilter && (r.user_email || r.user_id) !== aiUserFilter) return false;
            if (aiFeatureFilter && r.feature !== aiFeatureFilter) return false;
            if (aiDateFilter !== "all") {
              const created = new Date(r.created_at);
              if (aiDateFilter === "today") {
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                if (created < today) return false;
              } else if (aiDateFilter === "7d") {
                if (created < new Date(now - 7 * 24 * 60 * 60 * 1000)) return false;
              } else if (aiDateFilter === "30d") {
                if (created < new Date(now - 30 * 24 * 60 * 60 * 1000)) return false;
              }
            }
            return true;
          });

          // Aggregate from filtered events
          const totalCalls = filtered.length;
          const totalIn = filtered.reduce((s, r) => s + (r.input_tokens || 0), 0);
          const totalOut = filtered.reduce((s, r) => s + (r.output_tokens || 0), 0);
          const totalTokens = filtered.reduce((s, r) => s + (r.total_tokens || 0), 0);
          const totalCost = filtered.reduce((s, r) => s + parseFloat(r.estimated_cost_usd || 0), 0);

          // Credit equivalents — cross-reference credit_stats
          const creditByFeature = Object.fromEntries(
            (stats?.credit_stats?.by_feature || []).map((f) => [f.feature_code, f.total_credits])
          );
          const creditByUser = Object.fromEntries(
            (stats?.credit_stats?.top_users || []).map((u) => [u.user_id, u.total_credits])
          );
          const featureCreditCost = Object.fromEntries(
            (stats?.credit_stats?.by_feature || []).map((f) => [f.feature_code, f.total_credits && f.transaction_count ? Math.round(f.total_credits / f.transaction_count) : null])
          );

          const byFeatureMap = {};
          const byModelMap = {};
          const byUserMap = {};
          for (const r of filtered) {
            const fk = r.feature || "unknown";
            byFeatureMap[fk] = byFeatureMap[fk] || { label: fk, calls: 0, tokens: 0, cost: 0 };
            byFeatureMap[fk].calls++; byFeatureMap[fk].tokens += r.total_tokens || 0; byFeatureMap[fk].cost += parseFloat(r.estimated_cost_usd || 0);
            const mk = `${r.provider} / ${r.model}`;
            byModelMap[mk] = byModelMap[mk] || { label: mk, calls: 0, tokens: 0, cost: 0 };
            byModelMap[mk].calls++; byModelMap[mk].tokens += r.total_tokens || 0; byModelMap[mk].cost += parseFloat(r.estimated_cost_usd || 0);
            const uk = r.user_email || r.user_id || "unknown";
            byUserMap[uk] = byUserMap[uk] || { email: uk, calls: 0, tokens: 0, cost: 0 };
            byUserMap[uk].calls++; byUserMap[uk].tokens += r.total_tokens || 0; byUserMap[uk].cost += parseFloat(r.estimated_cost_usd || 0);
          }
          const byFeature = Object.values(byFeatureMap).sort((a, b) => b.cost - a.cost);
          const byModel = Object.values(byModelMap).sort((a, b) => b.cost - a.cost);
          const byUser = Object.values(byUserMap).sort((a, b) => b.cost - a.cost).slice(0, 10);

          const totalPages = Math.max(1, Math.ceil(filtered.length / AI_PAGE_SIZE));
          const safePage = Math.min(aiPage, totalPages);
          const pagedRecent = filtered.slice((safePage - 1) * AI_PAGE_SIZE, safePage * AI_PAGE_SIZE);
          const hasFilters = aiModelFilter || aiUserFilter || aiFeatureFilter || aiDateFilter !== "all";

          function clearFilters() {
            setAiModelFilter(""); setAiUserFilter(""); setAiFeatureFilter(""); setAiDateFilter("all"); setAiPage(1);
          }

          const selCls = "rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[12px] text-slate-700 outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-100";

          return (
          <div className="space-y-5">

            {/* ── Row 1: Filters ── */}
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Filters</span>
              <select value={aiDateFilter} onChange={(e) => { setAiDateFilter(e.target.value); setAiPage(1); }} className={selCls}>
                <option value="all">All time</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
              {userOptions.length > 0 && (
                <select value={aiUserFilter} onChange={(e) => { setAiUserFilter(e.target.value); setAiPage(1); }} className={selCls}>
                  <option value="">All users</option>
                  {userOptions.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              )}
              {featureOptions.length > 0 && (
                <select value={aiFeatureFilter} onChange={(e) => { setAiFeatureFilter(e.target.value); setAiPage(1); }} className={selCls}>
                  <option value="">All features</option>
                  {featureOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              )}
              {modelOptions.length > 0 && (
                <select value={aiModelFilter} onChange={(e) => { setAiModelFilter(e.target.value); setAiPage(1); }} className={selCls}>
                  <option value="">All models</option>
                  {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
              {hasFilters && <button type="button" onClick={clearFilters} className="text-[12px] font-medium text-brand-600 hover:text-brand-700">Clear</button>}
              <span className="ml-auto text-[11px] text-slate-400">{filtered.length}{hasFilters ? ` of ${allEvents.length}` : ""} events</span>
              {aiUserFilter && (
                <button
                  type="button"
                  onClick={() => downloadUserAIReport(aiUserFilter, filtered)}
                  className="flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-[12px] font-medium text-brand-700 transition hover:bg-brand-100"
                >
                  <DownloadIcon /> Export user report
                </button>
              )}
            </div>

            {/* ── Row 2: 6 KPI tiles ── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: "Total calls",    value: totalCalls.toLocaleString(),   wrap: "border-slate-100 bg-white",   val: "text-slate-900", lbl: "text-slate-500" },
                { label: "Input tokens",   value: totalIn.toLocaleString(),       wrap: "border-slate-100 bg-white",   val: "text-slate-900", lbl: "text-slate-500" },
                { label: "Output tokens",  value: totalOut.toLocaleString(),      wrap: "border-slate-100 bg-white",   val: "text-slate-900", lbl: "text-slate-500" },
                { label: "Total tokens",   value: totalTokens.toLocaleString(),   wrap: "border-slate-100 bg-white",   val: "text-slate-900", lbl: "text-slate-500" },
                { label: "Est. cost (USD)",value: `$${totalCost.toFixed(4)}`,     wrap: "border-emerald-100 bg-emerald-50", val: "text-emerald-800", lbl: "text-emerald-600" },
                { label: "Credits used ⚡",value: (stats?.credit_stats?.total_consumed ?? 0).toLocaleString(), wrap: "border-violet-100 bg-violet-50", val: "text-violet-800", lbl: "text-violet-600" },
              ].map((m) => (
                <div key={m.label} className={`rounded-2xl border px-4 py-4 ${m.wrap}`}>
                  <div className={`text-2xl font-bold tabular-nums ${m.val}`}>{m.value}</div>
                  <div className={`mt-1 text-[11px] font-semibold ${m.lbl}`}>{m.label}</div>
                </div>
              ))}
            </div>

            {/* ── Row 3: By feature (full width) ── */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">By feature</h2>
              {byFeature.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        <th className="pb-2 pr-4">Feature</th>
                        <th className="pb-2 pr-4 text-right">Calls</th>
                        <th className="pb-2 pr-4 text-right">In tokens</th>
                        <th className="pb-2 pr-4 text-right">Out tokens</th>
                        <th className="pb-2 pr-4 text-right">Total tokens</th>
                        <th className="pb-2 pr-4 text-right">Est. cost (USD)</th>
                        <th className="pb-2 text-right text-violet-500">Credits ⚡</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {byFeature.map((row) => (
                        <tr key={row.label}>
                          <td className="py-1.5 pr-4 font-mono text-[11px] text-slate-700">{row.label}</td>
                          <td className="py-1.5 pr-4 text-right tabular-nums text-slate-500">{row.calls}</td>
                          <td className="py-1.5 pr-4 text-right tabular-nums text-slate-500">{filtered.filter(r=>(r.feature||"unknown")===row.label).reduce((s,r)=>s+(r.input_tokens||0),0).toLocaleString()}</td>
                          <td className="py-1.5 pr-4 text-right tabular-nums text-slate-500">{filtered.filter(r=>(r.feature||"unknown")===row.label).reduce((s,r)=>s+(r.output_tokens||0),0).toLocaleString()}</td>
                          <td className="py-1.5 pr-4 text-right tabular-nums text-slate-500">{row.tokens.toLocaleString()}</td>
                          <td className="py-1.5 pr-4 text-right tabular-nums font-semibold text-slate-800">${row.cost.toFixed(4)}</td>
                          <td className="py-1.5 text-right tabular-nums font-semibold text-violet-700">{creditByFeature[row.label] != null ? creditByFeature[row.label].toLocaleString() : "—"}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-slate-200 font-semibold text-[12px]">
                        <td className="pt-2 pr-4 text-slate-800">Total</td>
                        <td className="pt-2 pr-4 text-right tabular-nums text-slate-700">{totalCalls}</td>
                        <td className="pt-2 pr-4 text-right tabular-nums text-slate-700">{totalIn.toLocaleString()}</td>
                        <td className="pt-2 pr-4 text-right tabular-nums text-slate-700">{totalOut.toLocaleString()}</td>
                        <td className="pt-2 pr-4 text-right tabular-nums text-slate-700">{totalTokens.toLocaleString()}</td>
                        <td className="pt-2 pr-4 text-right tabular-nums text-emerald-700">${totalCost.toFixed(4)}</td>
                        <td className="pt-2 text-right tabular-nums text-violet-700">{(stats?.credit_stats?.total_consumed ?? 0).toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-xs text-slate-400">No data yet.</p>}
            </section>

            {/* ── Row 4: By model + Top users side by side ── */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold text-slate-800">By provider / model</h2>
                {byModel.length ? (
                  <div className="divide-y divide-slate-50">
                    <div className="flex items-center justify-between pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      <span>Provider / Model</span>
                      <span className="flex gap-5 pr-1"><span>Calls</span><span>Tokens</span><span>Cost</span></span>
                    </div>
                    {byModel.map((row) => (
                      <div key={row.label} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
                        <span className="truncate font-mono text-[11px] text-slate-700">{row.label}</span>
                        <span className="flex shrink-0 gap-5 tabular-nums text-slate-500">
                          <span className="w-8 text-right">{row.calls}</span>
                          <span className="w-16 text-right">{row.tokens.toLocaleString()}</span>
                          <span className="w-16 text-right font-semibold text-slate-700">${row.cost.toFixed(4)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-slate-400">No data yet.</p>}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold text-slate-800">Top users by cost</h2>
                {byUser.length ? (
                  <div className="divide-y divide-slate-50">
                    <div className="flex items-center justify-between pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      <span>User</span>
                      <span className="flex gap-5 pr-1"><span>Calls</span><span>Tokens</span><span>Cost</span><span className="w-14 text-right text-violet-500">Credits ⚡</span><span className="w-6"></span></span>
                    </div>
                    {byUser.map((row) => {
                      const userEvents = filtered.filter((r) => (r.user_email || r.user_id) === row.email);
                      const userCredits = creditByUser[row.email];
                      return (
                        <div key={row.email} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
                          <span className="truncate font-mono text-[11px] text-slate-700">{row.email}</span>
                          <span className="flex shrink-0 items-center gap-5 tabular-nums text-slate-500">
                            <span className="w-8 text-right">{row.calls}</span>
                            <span className="w-16 text-right">{row.tokens.toLocaleString()}</span>
                            <span className="w-16 text-right font-semibold text-slate-700">${row.cost.toFixed(4)}</span>
                            <span className="w-14 text-right font-semibold text-violet-700">{userCredits != null ? userCredits.toLocaleString() : "—"}</span>
                            <button
                              type="button"
                              title={`Export report for ${row.email}`}
                              onClick={() => downloadUserAIReport(row.email, userEvents)}
                              className="text-slate-400 hover:text-brand-600 transition"
                            ><DownloadIcon /></button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="text-xs text-slate-400">No data yet.</p>}
              </section>
            </div>

            {/* ── Row 5: Recent AI calls ── */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-800">Recent AI calls</h2>
                  <span className="text-[11px] text-slate-400">{filtered.length} events · page {safePage}/{totalPages}</span>
                </div>
                <button
                  type="button"
                  onClick={() => downloadCSV(filtered.map((r) => ({ ...r, credits_used: featureCreditCost[r.feature] ?? "" })), [
                    { key: "created_at", label: "Time" },
                    { key: "user_email", label: "User" },
                    { key: "feature", label: "Feature" },
                    { key: "provider", label: "Provider" },
                    { key: "model", label: "Model" },
                    { key: "input_tokens", label: "Input Tokens" },
                    { key: "output_tokens", label: "Output Tokens" },
                    { key: "total_tokens", label: "Total Tokens" },
                    { key: "estimated_cost_usd", label: "Cost (USD)" },
                    { key: "credits_used", label: "Credits Used" },
                  ], "ai-usage.csv")}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  <DownloadIcon />
                  Export{hasFilters ? " (filtered)" : ""}
                </button>
              </div>

                    {pagedRecent.length ? (
                      <>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-max text-[12px]">
                            <thead>
                              <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                <th className="pb-2 pr-3">Time</th>
                                <th className="pb-2 pr-3">User</th>
                                <th className="pb-2 pr-3">Feature</th>
                                <th className="pb-2 pr-3">Provider</th>
                                <th className="pb-2 pr-3 text-right">In</th>
                                <th className="pb-2 pr-3 text-right">Out</th>
                                <th className="pb-2 pr-3 text-right">Cost</th>
                                <th className="pb-2 text-right text-violet-500">Credits ⚡</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {pagedRecent.map((row) => {
                                const perCallCredits = featureCreditCost[row.feature];
                                return (
                                <tr key={row.id}>
                                  <td className="py-1.5 pr-3 whitespace-nowrap text-slate-400">{formatDateTime(row.created_at)}</td>
                                  <td className="py-1.5 pr-3 max-w-[160px] truncate font-mono text-slate-600">{row.user_email || row.user_id || "—"}</td>
                                  <td className="py-1.5 pr-3 font-mono text-slate-700">{row.feature}</td>
                                  <td className="py-1.5 pr-3 text-slate-500">{row.provider} / {row.model}</td>
                                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">{(row.input_tokens || 0).toLocaleString()}</td>
                                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">{(row.output_tokens || 0).toLocaleString()}</td>
                                  <td className="py-1.5 pr-3 text-right tabular-nums font-semibold text-slate-700">${Number(row.estimated_cost_usd || 0).toFixed(5)}</td>
                                  <td className="py-1.5 text-right tabular-nums text-violet-600">{perCallCredits != null ? perCallCredits : "—"}</td>
                                </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                          <span className="text-[11px] text-slate-400">
                            {(safePage - 1) * AI_PAGE_SIZE + 1}–{Math.min(safePage * AI_PAGE_SIZE, filtered.length)} of {filtered.length}
                          </span>
                          <div className="flex items-center gap-1">
                            <button type="button" disabled={safePage <= 1} onClick={() => setAiPage((p) => Math.max(1, p - 1))}
                              className="rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">←</button>
                            <span className="px-2 text-[12px] text-slate-500">{safePage} / {totalPages}</span>
                            <button type="button" disabled={safePage >= totalPages} onClick={() => setAiPage((p) => Math.min(totalPages, p + 1))}
                              className="rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">→</button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-slate-400">
                        {allEvents.length ? "No calls match the current filters." : "No AI calls recorded yet. Run any AI feature to see events here."}
                      </p>
                    )}
            </section>

          </div>
          );
        })()}

        {/* ── Credits ── */}
        {tab === "credits" && (() => {
          const cs = stats?.credit_stats;
          return (
          <div className="space-y-5">

            {/* Summary metrics */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: "Credits issued", value: (cs?.total_issued ?? 0).toLocaleString(), color: "text-violet-700" },
                { label: "Credits consumed", value: (cs?.total_consumed ?? 0).toLocaleString(), color: "text-rose-600" },
                { label: "Credits available", value: (cs?.total_available ?? 0).toLocaleString(), color: "text-emerald-600" },
                { label: "Credits held", value: (cs?.total_held ?? 0).toLocaleString(), color: "text-amber-600" },
              ].map((m) => (
                <div key={m.label} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className={`text-2xl font-bold tabular-nums ${m.color}`}>{m.value}</div>
                  <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{m.label}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* By feature */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="mb-4 text-sm font-semibold text-slate-800">Credits consumed by feature</h2>
                {(cs?.by_feature || []).length > 0 ? (
                  <div className="divide-y divide-slate-50">
                    <div className="flex items-center justify-between pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      <span>Feature</span>
                      <span className="flex gap-8">
                        <span>Uses</span>
                        <span>Credits</span>
                      </span>
                    </div>
                    {(cs.by_feature || []).map((row) => (
                      <div key={row.feature_code} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                        <span className="truncate font-mono text-slate-700">{row.feature_code}</span>
                        <span className="flex shrink-0 gap-8 tabular-nums">
                          <span className="w-10 text-right text-slate-500">{row.uses}</span>
                          <span className="w-16 text-right font-semibold text-violet-700">⚡ {row.credits}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No deductions recorded yet.</p>
                )}
              </section>

              {/* Top users */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="mb-4 text-sm font-semibold text-slate-800">Top users by credits spent</h2>
                {(cs?.top_users || []).length > 0 ? (
                  <div className="divide-y divide-slate-50">
                    <div className="flex items-center justify-between pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      <span>User</span>
                      <span className="flex gap-8">
                        <span>Uses</span>
                        <span>Credits</span>
                      </span>
                    </div>
                    {(cs.top_users || []).map((row) => (
                      <div key={row.user_id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                        <span className="min-w-0 truncate text-slate-700">{row.email}</span>
                        <span className="flex shrink-0 gap-8 tabular-nums">
                          <span className="w-10 text-right text-slate-500">{row.uses}</span>
                          <span className="w-16 text-right font-semibold text-violet-700">⚡ {row.credits}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No credit usage recorded yet.</p>
                )}
              </section>
            </div>

            {/* All wallets */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 text-sm font-semibold text-slate-800">
                User wallets <span className="ml-1 font-normal text-slate-400">({cs?.wallet_count ?? 0})</span>
              </h2>
              {(cs?.wallets || []).length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        <th className="pb-2 pr-4">User</th>
                        <th className="pb-2 pr-4 text-right">Available</th>
                        <th className="pb-2 pr-4 text-right">Held</th>
                        <th className="pb-2 pr-4 text-right">Lifetime Issued</th>
                        <th className="pb-2 text-right">Lifetime Used</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {(cs.wallets || []).map((w) => (
                        <tr key={w.user_id}>
                          <td className="py-2 pr-4 max-w-[200px] truncate text-slate-700">{w.email}</td>
                          <td className="py-2 pr-4 text-right tabular-nums font-semibold text-emerald-600">{w.available}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-amber-600">{w.held}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-slate-500">{w.lifetime_issued}</td>
                          <td className="py-2 text-right tabular-nums font-semibold text-violet-700">{w.lifetime_used}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-slate-400">No wallets provisioned yet.</p>
              )}
            </section>

          </div>
          );
        })()}

        {/* ── Workspaces ── */}
        {tab === "workspaces" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-800">
                All workspaces <span className="ml-1 text-slate-400 font-normal">({filteredWorkspaces.length})</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadCSV(stats?.workspaces || [], [
                    { key: "id", label: "ID" },
                    { key: "name", label: "Name" },
                    { key: "owner_email", label: "Owner" },
                    { key: "member_count", label: "Members" },
                    { key: "invitation_count", label: "Invitations" },
                    { key: "created_at", label: "Created" },
                  ], "workspaces.csv")}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  <DownloadIcon /> <span className="hidden sm:inline">Export CSV</span>
                </button>
                <SearchBar value={search} onChange={setSearch} placeholder="Search by name, owner…" />
              </div>
            </div>
            <DataTable
              columns={[
                { key: "name", label: "Workspace", render: (r) => (
                  <div>
                    <div className="font-medium text-slate-800">{r.name || "Unnamed"}</div>
                    <div className="text-[11px] text-slate-400">{r.owner_email || "—"}</div>
                  </div>
                )},
                { key: "id", label: "ID", render: (r) => <span className="font-mono text-[11px] text-slate-400">{r.id.slice(0, 12)}…</span> },
                { key: "member_count", label: "Members", render: (r) => <span className="text-xs tabular-nums">{r.member_count ?? 0}</span> },
                { key: "created_at", label: "Created", render: (r) => <span className="text-xs">{formatDate(r.created_at)}</span> },
                { key: "actions", label: "", tdClass: "w-20", render: (r) => (
                  <div className="flex items-center gap-1">
                    <ActionBtn variant="view" title="View details" onClick={() => openDetail(r.id)} disabled={detailLoading} />
                    <ActionBtn variant="danger" title="Delete workspace" onClick={() => deleteWorkspace(r.id, r.name || "Unnamed")} />
                  </div>
                )},
              ]}
              rows={filteredWorkspaces}
              emptyText={search ? "No workspaces match your search" : "No workspaces"}
            />
          </div>
        )}

        {/* ── Users ── */}
        {tab === "users" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-800">
                All users <span className="ml-1 text-slate-400 font-normal">({filteredUsers.length})</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadCSV(stats?.users || [], [
                    { key: "id", label: "ID" },
                    { key: "email", label: "Email" },
                    { key: "created_at", label: "Joined" },
                  ], "users.csv")}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  <DownloadIcon /> <span className="hidden sm:inline">Export CSV</span>
                </button>
                <SearchBar value={search} onChange={setSearch} placeholder="Search by email or ID…" />
              </div>
            </div>
            <DataTable
              columns={[
                { key: "email", label: "Email", render: (r) => (
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${r.email === ADMIN_EMAIL ? "text-rose-600" : "text-slate-800"}`}>{r.email}</span>
                    {r.email === ADMIN_EMAIL && <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">admin</span>}
                    {r.is_blocked && <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">Blocked</span>}
                  </div>
                )},
                { key: "id", label: "ID", render: (r) => <span className="font-mono text-[11px] text-slate-400">{r.id.slice(0, 12)}…</span> },
                { key: "created_at", label: "Joined", render: (r) => <span className="text-xs">{formatDate(r.created_at)}</span> },
                { key: "actions", label: "", tdClass: "w-40", render: (r) => (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setUserDetail(r)}
                      className="rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 transition hover:bg-brand-100 whitespace-nowrap"
                    >
                      Manage
                    </button>
                    {r.email !== ADMIN_EMAIL && (
                      <ActionBtn variant="danger" title="Delete user" onClick={() => deleteUser(r.id, r.email)} />
                    )}
                  </div>
                )},
              ]}
              rows={filteredUsers}
              emptyText={search ? "No users match your search" : "No users"}
            />
          </div>
        )}

        {/* ── Members ── */}
        {tab === "members" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-800">
                Workspace members <span className="ml-1 text-slate-400 font-normal">({filteredMembers.length})</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadCSV(stats?.members || [], [
                    { key: "id", label: "ID" },
                    { key: "user_email", label: "User Email" },
                    { key: "workspace_name", label: "Workspace" },
                    { key: "permission_type", label: "Permission Type" },
                    { key: "created_at", label: "Added" },
                  ], "members.csv")}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  <DownloadIcon /> <span className="hidden sm:inline">Export CSV</span>
                </button>
                <SearchBar value={search} onChange={setSearch} placeholder="Search by email or workspace…" />
              </div>
            </div>
            <DataTable
              columns={[
                { key: "user_email", label: "User", render: (r) => <span className="font-medium text-slate-800">{r.user_email || r.user_id?.slice(0, 10) + "…"}</span> },
                { key: "workspace_name", label: "Workspace", render: (r) => <span className="text-slate-600">{r.workspace_name || r.workspace_id?.slice(0, 10) + "…"}</span> },
                { key: "permission_type", label: "Permission", render: (r) => <PermBadge type={r.permission_type} /> },
                { key: "created_at", label: "Added", render: (r) => <span className="text-xs">{formatDate(r.created_at)}</span> },
                { key: "actions", label: "", tdClass: "w-16", render: (r) => (
                  <ActionBtn variant="danger" title="Remove member" onClick={() => removeMember(r.id, r.user_email)} />
                )},
              ]}
              rows={filteredMembers}
              emptyText={search ? "No members match your search" : "No members"}
            />
          </div>
        )}

        {/* ── Invitations ── */}
        {tab === "invitations" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">
                  Workspace invitations <span className="ml-1 text-slate-400 font-normal">({filteredInvitations.length})</span>
                </h2>
                {/* Status filter pills */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {INV_FILTERS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setInvitationFilter(f)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize transition ${
                        invitationFilter === f
                          ? f === "pending" ? "bg-amber-500 text-white"
                            : f === "accepted" ? "bg-emerald-500 text-white"
                            : f === "revoked" ? "bg-slate-500 text-white"
                            : "bg-brand-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {f} <span className="opacity-70">({invStatusCounts[f]})</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {invStatusCounts.pending > 0 && (
                  <button
                    type="button"
                    onClick={bulkRevokePending}
                    className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-700 transition hover:bg-amber-100"
                  >
                    <BanIcon /> Revoke all pending ({invStatusCounts.pending})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => downloadCSV(stats?.invitations || [], [
                    { key: "id", label: "ID" },
                    { key: "workspace_name", label: "Workspace" },
                    { key: "invited_email", label: "Email" },
                    { key: "status", label: "Status" },
                    { key: "created_at", label: "Sent" },
                  ], "invitations.csv")}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  <DownloadIcon /> <span className="hidden sm:inline">Export CSV</span>
                </button>
                <SearchBar value={search} onChange={setSearch} placeholder="Search by email or workspace…" />
              </div>
            </div>
            <DataTable
              columns={[
                { key: "workspace_name", label: "Workspace", render: (r) => <span className="font-medium text-slate-800">{r.workspace_name || r.workspace_id?.slice(0, 10) + "…"}</span> },
                { key: "invited_email", label: "Email", render: (r) => <span className="text-slate-700">{r.invited_email || <span className="text-slate-400 italic">Link-only</span>}</span> },
                { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
                { key: "created_at", label: "Sent", render: (r) => <span className="text-xs">{formatDate(r.created_at)}</span> },
                { key: "actions", label: "", tdClass: "w-16", render: (r) => (
                  r.status === "pending" ? (
                    <ActionBtn variant="warn" title="Revoke invitation" onClick={() => revokeInvitation(r.id, r.invited_email)} />
                  ) : null
                )},
              ]}
              rows={filteredInvitations}
              emptyText={search || invitationFilter !== "all" ? "No invitations match your filter" : "No invitations"}
            />
          </div>
        )}

        {/* ── Upgrade Clicks ── */}
        {tab === "upgrades" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">
                  Upgrade intent clicks <span className="ml-1 text-slate-400 font-normal">({filteredUpgrades.length})</span>
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-400">Users who clicked an upgrade prompt — potential leads for outreach.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {upgradesLoaded && (
                  <button
                    type="button"
                    onClick={() => downloadCSV(upgrades || [], [
                      { key: "email", label: "Email" },
                      { key: "feature", label: "Feature" },
                      { key: "source", label: "Source" },
                      { key: "clicked_at", label: "Clicked At" },
                    ], "upgrade-clicks.csv")}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    <DownloadIcon /> Export CSV
                  </button>
                )}
                <SearchBar value={search} onChange={setSearch} placeholder="Search by email or feature…" />
              </div>
            </div>
            {!upgradesLoaded ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
              </div>
            ) : (
              <DataTable
                columns={[
                  { key: "email", label: "Email", render: (r) => <span className="font-medium text-slate-800">{r.email || r.user_id?.slice(0, 12) + "…" || "—"}</span> },
                  { key: "feature", label: "Feature", render: (r) => (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">{r.feature || "—"}</span>
                  )},
                  { key: "source", label: "Source", render: (r) => <span className="text-xs text-slate-500">{r.source || "—"}</span> },
                  { key: "clicked_at", label: "When", render: (r) => <span className="text-xs">{formatDateTime(r.clicked_at)}</span> },
                  { key: "actions", label: "", tdClass: "w-12", render: (r) => (
                    <ActionBtn variant="danger" title="Delete record" onClick={() => askConfirm({
                      title: "Delete upgrade click?",
                      description: `Remove this record for "${r.email || "unknown"}" clicking "${r.feature || "—"}".`,
                      label: "Delete",
                      successMsg: "Record deleted.",
                      action: () => apiRequest(`/admin/upgrade-clicks/${r.id}`, "DELETE"),
                      afterAction: () => setUpgrades((prev) => (prev || []).filter((x) => x.id !== r.id)),
                    })} />
                  )},
                ]}
                rows={filteredUpgrades}
                emptyText="No upgrade clicks recorded"
              />
            )}
          </div>
        )}

        {tab === "module-interest" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">
                  Module interest <span className="ml-1 text-slate-400 font-normal">({filteredModuleInterest.length})</span>
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-400">Users who clicked "Coming Soon" features — one row per email per feature.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {moduleInterestLoaded && (
                  <button
                    type="button"
                    onClick={() => downloadCSV(moduleInterest || [], [
                      { key: "email", label: "Email" },
                      { key: "feature", label: "Feature" },
                      { key: "clicked_at", label: "Last Clicked" },
                    ], "module-interest.csv")}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    <DownloadIcon /> Export CSV
                  </button>
                )}
                <SearchBar value={search} onChange={setSearch} placeholder="Search by email or feature…" />
              </div>
            </div>
            {!moduleInterestLoaded ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
              </div>
            ) : (
              <DataTable
                columns={[
                  { key: "email", label: "Email", render: (r) => <span className="font-medium text-slate-800">{r.email}</span> },
                  { key: "feature", label: "Feature", render: (r) => (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{r.feature}</span>
                  )},
                  { key: "clicked_at", label: "Last Clicked", render: (r) => <span className="text-xs">{formatDateTime(r.clicked_at)}</span> },
                  { key: "actions", label: "", tdClass: "w-12", render: (r) => (
                    <ActionBtn variant="danger" title="Delete record" onClick={() => askConfirm({
                      title: "Delete module interest record?",
                      description: `Remove the interest record for "${r.email}" on "${r.feature}".`,
                      label: "Delete",
                      successMsg: "Record deleted.",
                      action: () => apiRequest(`/admin/module-interest/${r.id}`, "DELETE"),
                      afterAction: () => setModuleInterest((prev) => (prev || []).filter((x) => x.id !== r.id)),
                    })} />
                  )},
                ]}
                rows={filteredModuleInterest}
                emptyText="No module interest clicks yet"
              />
            )}
          </div>
        )}

        {tab === "mailing-list" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">
                  Mailing list <span className="ml-1 text-slate-400 font-normal">({filteredMailingList.length})</span>
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-400">Emails collected from marketplace reviews and other sources.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {mailingListLoaded && (
                  <button
                    type="button"
                    onClick={() => downloadCSV(mailingList || [], [
                      { key: "email", label: "Email" },
                      { key: "source", label: "Source" },
                      { key: "subscribed_at", label: "Subscribed At" },
                    ], "mailing-list.csv")}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    <DownloadIcon /> Export CSV
                  </button>
                )}
                <SearchBar value={search} onChange={setSearch} placeholder="Search by email or source…" />
              </div>
            </div>
            {!mailingListLoaded ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
              </div>
            ) : (
              <DataTable
                columns={[
                  { key: "email", label: "Email", render: (r) => <span className="font-medium text-slate-800">{r.email}</span> },
                  { key: "source", label: "Source", render: (r) => (
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">{r.source || "—"}</span>
                  )},
                  { key: "subscribed_at", label: "Subscribed", render: (r) => <span className="text-xs">{formatDateTime(r.subscribed_at)}</span> },
                  { key: "actions", label: "", tdClass: "w-12", render: (r) => (
                    <ActionBtn variant="danger" title="Remove from mailing list" onClick={() => askConfirm({
                      title: "Remove from mailing list?",
                      description: `Remove "${r.email}" from the mailing list. This cannot be undone.`,
                      label: "Remove",
                      successMsg: `"${r.email}" removed from mailing list.`,
                      action: () => apiRequest(`/admin/mailing-list/${r.id}`, "DELETE"),
                      afterAction: () => setMailingList((prev) => (prev || []).filter((x) => x.id !== r.id)),
                    })} />
                  )},
                ]}
                rows={filteredMailingList}
                emptyText="No subscribers yet"
              />
            )}
          </div>
        )}

        {tab === "support" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">
                  Support &amp; Feedback <span className="ml-1 text-slate-400 font-normal">({filteredSupport.length})</span>
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-400">Messages submitted via the Feedback and Help &amp; Support forms.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {supportLoaded && (
                  <button
                    type="button"
                    onClick={() => downloadCSV(supportMessages || [], [
                      { key: "type", label: "Type" },
                      { key: "name", label: "Name" },
                      { key: "email", label: "Email" },
                      { key: "message", label: "Message" },
                      { key: "created_at", label: "Submitted At" },
                    ], "support-feedback-messages.csv")}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    <DownloadIcon /> Export CSV
                  </button>
                )}
                <SearchBar value={search} onChange={setSearch} placeholder="Search by name, email or message…" />
              </div>
            </div>
            {!supportLoaded ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
              </div>
            ) : (
              <DataTable
                columns={[
                  { key: "type", label: "Type", render: (r) => (
                    <span className={
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                      (r.type === "feedback"
                        ? "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400"
                        : "bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400")
                    }>
                      {r.type === "feedback" ? "Feedback" : "Support"}
                    </span>
                  )},
                  { key: "name", label: "Name", render: (r) => <span className="font-medium text-slate-800">{r.name || "—"}</span> },
                  { key: "email", label: "Email", render: (r) => <span className="text-xs text-slate-600">{r.email || "—"}</span> },
                  { key: "message", label: "Message", render: (r) => (
                    <span className="block max-w-xs truncate text-xs text-slate-700" title={r.message}>{r.message}</span>
                  )},
                  { key: "created_at", label: "Submitted", render: (r) => <span className="text-xs">{formatDateTime(r.created_at)}</span> },
                  { key: "actions", label: "", tdClass: "w-12", render: (r) => (
                    <ActionBtn variant="danger" title="Delete message" onClick={() => askConfirm({
                      title: "Delete message?",
                      description: `Permanently delete this ${r.type || "support"} message from "${r.name || r.email || "unknown"}".`,
                      label: "Delete",
                      successMsg: "Message deleted.",
                      action: () => apiRequest(`/admin/support-messages/${r.id}`, "DELETE"),
                      afterAction: () => setSupportMessages((prev) => (prev || []).filter((x) => x.id !== r.id)),
                    })} />
                  )},
                ]}
                rows={filteredSupport}
                emptyText="No support or feedback messages yet"
              />
            )}
          </div>
        )}

        {/* ── Referrals ── */}
        {tab === "referrals" && (
          <div className="space-y-5">
            {!referralLoaded ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
              </div>
            ) : (
              <>
                {/* KPIs */}
                {referralStats && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: "Participants", value: referralStats.participants?.total ?? 0 },
                      { label: "Active", value: referralStats.participants?.active ?? 0 },
                      { label: "Pending rewards", value: `£${((referralStats.rewards?.pending_minor || 0) / 100).toFixed(2)}` },
                      { label: "Approved liability", value: `£${((referralStats.rewards?.outstanding_liability_minor || 0) / 100).toFixed(2)}` },
                      { label: "Total paid out", value: `£${((referralStats.payouts?.paid_minor || 0) / 100).toFixed(2)}` },
                      { label: "Payout requests", value: referralStats.payouts?.requested ?? 0 },
                      { label: "Reward entries", value: referralStats.rewards?.total_entries ?? 0 },
                      { label: "Paid payouts", value: referralStats.payouts?.paid ?? 0 },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                        <p className="text-xs text-slate-500">{label}</p>
                        <p className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Payout queue */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Payout queue</h2>
                  {!referralPayouts?.length ? (
                    <p className="text-xs text-slate-400">No payout requests yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {referralPayouts.map((p) => (
                        <div key={p.id} className="rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{p.participant_user_id}</p>
                              <p className="mt-0.5 text-xs text-slate-500">
                                £{((p.amount_minor || 0) / 100).toFixed(2)} · {p.status} · {p.requested_at ? new Date(p.requested_at).toLocaleDateString("en-GB") : ""}
                              </p>
                              {p.payout_profile_snapshot && (() => {
                                try {
                                  const snap = typeof p.payout_profile_snapshot === "string" ? JSON.parse(p.payout_profile_snapshot) : p.payout_profile_snapshot;
                                  return <p className="mt-0.5 text-[11px] text-slate-400">{snap.method === "paypal" ? `PayPal: ${snap.paypal_email_masked}` : `Bank: ${snap.account_name} ${snap.sort_code_masked} ${snap.account_number_masked}`}</p>;
                                } catch { return null; }
                              })()}
                            </div>
                            {["requested", "under_review", "action_required", "approved"].includes(p.status) && (
                              <div className="flex flex-col gap-2 min-w-[200px]">
                                <input
                                  type="text"
                                  placeholder="Reason (required)"
                                  value={referralPayoutReason[p.id] || ""}
                                  onChange={(e) => setReferralPayoutReason((prev) => ({ ...prev, [p.id]: e.target.value }))}
                                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-700 dark:text-slate-100"
                                />
                                <div className="flex gap-2">
                                  {p.status !== "approved" && (
                                    <button
                                      disabled={referralPayoutAction[p.id]}
                                      onClick={() => handlePayoutDecision(p.id, "approve")}
                                      className="flex-1 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                    >Approve</button>
                                  )}
                                  {p.status === "approved" && (
                                    <button
                                      disabled={referralPayoutAction[p.id]}
                                      onClick={() => handlePayoutDecision(p.id, "mark_paid")}
                                      className="flex-1 rounded-lg bg-brand-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                                    >Mark Paid</button>
                                  )}
                                  <button
                                    disabled={referralPayoutAction[p.id]}
                                    onClick={() => handlePayoutDecision(p.id, "reject")}
                                    className="flex-1 rounded-lg border border-rose-200 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                  >Reject</button>
                                </div>
                              </div>
                            )}
                            {["paid", "rejected", "failed", "cancelled"].includes(p.status) && (
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                p.status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                              }`}>{p.status}</span>
                            )}
                          </div>
                          {p.review_reason && (
                            <p className="mt-2 text-[11px] text-slate-400">Reason: {p.review_reason}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Participants table */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    Participants <span className="font-normal text-slate-400">({referralParticipants?.length || 0})</span>
                  </h2>
                  {!referralParticipants?.length ? (
                    <p className="text-xs text-slate-400">No participants yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 dark:border-slate-800">
                            {["User", "Code", "Status", "Joined"].map((h) => (
                              <th key={h} className="pb-2 pr-4 font-semibold text-slate-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {referralParticipants.map((p) => (
                            <tr key={p.id} className="border-b border-slate-50 dark:border-slate-800/50">
                              <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{p.user_id}</td>
                              <td className="py-2 pr-4 font-mono text-slate-600 dark:text-slate-400">{p.referral_code}</td>
                              <td className="py-2 pr-4">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  p.status === "active" ? "bg-emerald-100 text-emerald-700" :
                                  p.status === "suspended" ? "bg-rose-100 text-rose-700" :
                                  "bg-slate-100 text-slate-600"
                                }`}>{p.status}</span>
                              </td>
                              <td className="py-2 text-slate-400">{p.joined_at ? new Date(p.joined_at).toLocaleDateString("en-GB") : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

      </main>
      </div>
    </div>
  );
}
