import { useEffect, useState, useCallback } from "react";
import { apiRequest } from "../api/client";

const IMPORT_SUPPORTED = new Set(["quickbooks"]);

const PROVIDER_INFO = {
  quickbooks: {
    label: "QuickBooks",
    description: "Import customers, vendors, invoices and expenses from QuickBooks Online.",
    logo: (
      <svg viewBox="0 0 40 40" className="h-8 w-8">
        <rect width="40" height="40" rx="8" fill="#2CA01C" />
        <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" fontFamily="sans-serif">QB</text>
      </svg>
    ),
  },
  xero: {
    label: "Xero",
    description: "Sync invoices, bills, customers and suppliers to Xero.",
    logo: (
      <svg viewBox="0 0 40 40" className="h-8 w-8">
        <rect width="40" height="40" rx="8" fill="#13B5EA" />
        <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" fontFamily="sans-serif">X</text>
      </svg>
    ),
  },
  zoho_crm: {
    label: "Zoho CRM",
    description: "Sync products, customers and vendors to Zoho CRM.",
    logo: (
      <svg viewBox="0 0 40 40" className="h-8 w-8">
        <rect width="40" height="40" rx="8" fill="#E42527" />
        <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold" fontFamily="sans-serif">ZOHO</text>
      </svg>
    ),
  },
};

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ProviderCard({ provider, info, status, onConnect, onDisconnect, onSync, onImport, actionLoading }) {
  const connected = status?.connected;
  const isSyncing = actionLoading === `sync_${provider}`;
  const isImporting = actionLoading === `import_${provider}`;
  const loading = actionLoading === provider || isSyncing || isImporting;
  const supportsImport = IMPORT_SUPPORTED.has(provider);

  return (
    <div className={`rounded-2xl border p-5 transition ${connected ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/10" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}>
      <div className="flex items-start gap-4">
        <div className="shrink-0">{info.logo}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{info.label}</span>
            {connected && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Connected
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">{info.description}</p>
          {connected && status?.last_sync_at && (
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Last synced: {fmtDate(status.last_sync_at)}</p>
          )}
          {connected && !status?.last_sync_at && (
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Connected — click Import to pull your data.</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          {connected ? (
            <>
              {supportsImport && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onImport(provider)}
                  className="rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                >
                  {isImporting ? "Importing…" : "Import"}
                </button>
              )}
              <button
                type="button"
                disabled={loading}
                onClick={() => onSync(provider)}
                className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-100 disabled:opacity-50"
              >
                {isSyncing ? "Syncing…" : "Push to QB"}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => onDisconnect(provider)}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={() => onConnect(provider)}
              className="rounded-xl bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {loading ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function IntegrationPanel({ providers }) {
  const [statuses, setStatuses] = useState({});
  const [actionLoading, setActionLoading] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [error, setError] = useState("");

  const loadStatuses = useCallback(async () => {
    try {
      const data = await apiRequest("/integrations/status", "GET");
      setStatuses(data);
    } catch (e) {
      // silently fail — integrations are optional
    }
  }, []);

  useEffect(() => {
    loadStatuses();
    // Re-fetch when the user returns to this tab (after OAuth redirect)
    const handler = () => loadStatuses();
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }, [loadStatuses]);

  async function handleConnect(provider) {
    setActionLoading(provider);
    setError("");
    try {
      const res = await apiRequest(`/integrations/${provider}/connect`, "GET");
      if (res?.auth_url) {
        window.location.href = res.auth_url;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setActionLoading(null);
    }
  }

  async function handleDisconnect(provider) {
    setActionLoading(provider);
    setError("");
    try {
      await apiRequest(`/integrations/${provider}`, "DELETE");
      await loadStatuses();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSync(provider) {
    setActionLoading(`sync_${provider}`);
    setSyncResult(null);
    setError("");
    try {
      const res = await apiRequest(`/integrations/${provider}/sync`, "POST", undefined, { timeoutMs: 120000 });
      setSyncResult({ ...res, mode: "sync" });
      await loadStatuses();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleImport(provider) {
    setActionLoading(`import_${provider}`);
    setSyncResult(null);
    setError("");
    try {
      const res = await apiRequest(`/integrations/${provider}/import`, "POST", undefined, { timeoutMs: 120000 });
      setSyncResult({ ...res, mode: "import" });
      await loadStatuses();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400">
          {error.replace(/^HTTP \d+:\s*/, "")}
        </div>
      )}
      {syncResult && (
        <div className={`rounded-xl border px-4 py-3 text-xs ${syncResult.errors?.length ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400" : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400"}`}>
          {syncResult.mode === "import" ? (() => {
            const imp = syncResult.imported || {};
            const total = Object.values(imp).reduce((s, n) => s + (n || 0), 0);
            return (
              <>
                <strong>{total} records imported</strong> from {PROVIDER_INFO[syncResult.provider]?.label}.
                {total > 0 && (
                  <span className="ml-1 text-[11px]">
                    ({Object.entries(imp).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(", ")})
                  </span>
                )}
                {total === 0 && !syncResult.errors?.length && (
                  <span className="ml-1 text-[11px]">No new data found in {PROVIDER_INFO[syncResult.provider]?.label}.</span>
                )}
              </>
            );
          })() : (
            <strong>{syncResult.synced} records synced</strong>
          )}
          {syncResult.errors?.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[11px]">
              {syncResult.errors.map((e, i) => <li key={i}>⚠ {e}</li>)}
            </ul>
          )}
        </div>
      )}
      {providers.map((provider) => {
        const info = PROVIDER_INFO[provider];
        if (!info) return null;
        return (
          <ProviderCard
            key={provider}
            provider={provider}
            info={info}
            status={statuses[provider]}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onSync={handleSync}
            onImport={handleImport}
            actionLoading={actionLoading}
          />
        );
      })}
    </div>
  );
}
