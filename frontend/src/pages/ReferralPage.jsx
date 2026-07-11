import { useEffect, useState, useCallback } from "react";
import { apiRequest } from "../api/client";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";

const fmt = (minor) => `£${((minor || 0) / 100).toFixed(2)}`;

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={copy}
      className="ml-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function StatTile({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function ProgressBar({ value, max }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div
        className="h-full rounded-full bg-brand-600 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function ReferralPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [tab, setTab] = useState("overview"); // overview | transactions | payout
  const [transactions, setTransactions] = useState(null);
  const [txPage, setTxPage] = useState(1);
  const [payoutProfile, setPayoutProfile] = useState({ method: "bank_transfer", account_name: "", account_number: "", sort_code: "", paypal_email: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [optingOut, setOptingOut] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest("/referrals/me", "GET");
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleEnrol() {
    if (!termsAccepted) return;
    setEnrolling(true);
    setError("");
    try {
      await apiRequest("/referrals/enrol", "POST", { terms_version: data?.terms?.version || "1.0" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnrolling(false);
    }
  }

  async function loadTransactions(page = 1) {
    try {
      const res = await apiRequest(`/referrals/transactions?page=${page}&page_size=25`, "GET");
      setTransactions(res);
      setTxPage(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (tab === "transactions" && !transactions) loadTransactions(1);
  }, [tab]);

  async function saveProfile() {
    setSavingProfile(true);
    setActionMsg("");
    setError("");
    try {
      await apiRequest("/referrals/payout-profile", "PUT", payoutProfile);
      setActionMsg("Payout details saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingProfile(false);
    }
  }

  async function requestPayout() {
    setRequestingPayout(true);
    setActionMsg("");
    setError("");
    try {
      const res = await apiRequest("/referrals/payouts", "POST", {});
      setActionMsg(`Payout of ${res.amount_display} requested. We'll review and process it shortly.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRequestingPayout(false);
    }
  }

  async function optOut() {
    if (!window.confirm("Are you sure you want to leave the referral programme? Your existing balances will be preserved.")) return;
    setOptingOut(true);
    try {
      await apiRequest("/referrals/opt-out", "POST", {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOptingOut(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  // ── Not enrolled ────────────────────────────────────────────────────────────
  if (!data?.enrolled) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        <PageHeader title="Referral Programme" subtitle="Earn 5% on every subscription payment from referred customers." />
        {error && <InlineAlert type="error" message={error} />}
        <SectionCard title="Join the programme" subtitle="Earn rewards when people you refer become paying customers.">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  icon: (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6 text-brand-600">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  ),
                  label: "Share your link",
                  desc: "Get a unique referral link to share",
                },
                {
                  icon: (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6 text-brand-600">
                      <rect x="2" y="5" width="20" height="14" rx="2" />
                      <path d="M2 10h20" />
                      <path d="M6 15h4" />
                    </svg>
                  ),
                  label: "They subscribe",
                  desc: "Earn 5% when they pay for a plan",
                },
                {
                  icon: (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6 text-brand-600">
                      <rect x="2" y="7" width="20" height="13" rx="2" />
                      <path d="M16 7V5a2 2 0 0 0-4 0v2" />
                      <path d="M12 12v3" />
                      <path d="M10 14h4" />
                    </svg>
                  ),
                  label: "Get paid",
                  desc: "Request payout once you reach £50",
                },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-center dark:border-slate-800 dark:bg-slate-900/50">
                  <div className="flex justify-center">{s.icon}</div>
                  <p className="mt-2 text-xs font-semibold text-slate-800 dark:text-slate-200">{s.label}</p>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{s.desc}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <p className="font-semibold text-slate-800 dark:text-slate-100">Programme terms summary</p>
              <ul className="mt-2 space-y-1 list-disc list-inside">
                <li>5% of eligible net subscription revenue per referred customer</li>
                <li>Rewards become payable after a 30 day validation hold</li>
                <li>Minimum payout threshold: £50 approved balance</li>
                <li>One referrer per customer. Last valid click before sign up wins</li>
                <li>Self referrals and existing users do not qualify</li>
                <li>You must clearly disclose that you may earn a reward when sharing your link</li>
              </ul>
              {data?.terms?.content && (
                <p className="mt-3 text-[11px] text-slate-400">{data.terms.content}</p>
              )}
            </div>

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-xs text-slate-600 dark:text-slate-300">
                I have read and agree to the EnterprateAI Referral Programme Terms. I understand the reward is 5% of eligible net subscription revenue, rewards may remain pending during validation, the minimum approved payable balance for a payout request is £50, and I must clearly disclose that I may earn a reward when sharing my link.
              </span>
            </label>

            <Button onClick={handleEnrol} disabled={!termsAccepted || enrolling} className="w-full">
              {enrolling ? "Joining…" : "Join Referral Programme"}
            </Button>
          </div>
        </SectionCard>
      </div>
    );
  }

  // ── Enrolled ─────────────────────────────────────────────────────────────────
  const { referral_link, referral_code, balances, funnel, threshold_minor, status: pStatus, payout_profile } = data;
  const payable = balances?.payable_minor || 0;
  const threshold = threshold_minor || 5000;
  const canRequestPayout = payable >= threshold;

  // Pre-fill form from saved profile
  const savedProfile = payout_profile || {};

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <PageHeader
        title="Referral Programme"
        subtitle="Track your referrals, rewards and payouts."
        action={
          pStatus === "active" && (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Active
            </span>
          )
        }
      />

      {error && <InlineAlert type="error" message={error} />}
      {actionMsg && <InlineAlert type="success" message={actionMsg} />}

      {pStatus === "suspended" && (
        <InlineAlert type="warning" message="Your referral account is currently suspended. Contact support for details." />
      )}

      {/* Referral link */}
      <SectionCard title="Your referral link" subtitle="Share this link — earn 5% when someone subscribes.">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-700 dark:text-slate-300">{referral_link}</span>
          <CopyButton value={referral_link} />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Code: <span className="font-mono font-semibold">{referral_code}</span>
          <span className="ml-3">Remember to disclose that you may earn a reward when sharing</span>
        </p>
      </SectionCard>

      {/* Tabs */}
      <div className="flex gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
        {[["overview", "Overview"], ["transactions", "Transactions"], ["payout", "Payout"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition ${
              tab === key
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Clicks" value={funnel?.clicks ?? 0} />
            <StatTile label="Sign-ups" value={funnel?.attributed_signups ?? 0} />
            <StatTile label="Paying referrals" value={funnel?.paying_referrals ?? 0} />
            <StatTile label="Lifetime earned" value={fmt(balances?.lifetime_earned_minor)} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile label="Pending" value={fmt(balances?.pending_minor)} sub="Awaiting 30 day hold" />
            <StatTile label="Approved" value={fmt(balances?.payable_minor)} sub="Available for payout" />
            <StatTile label="Total paid out" value={fmt(balances?.paid_minor)} />
          </div>

          <SectionCard title="Payout progress" subtitle={`${fmt(payable)} of ${fmt(threshold)} minimum`}>
            <ProgressBar value={payable} max={threshold} />
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {canRequestPayout
                ? "You've reached the payout threshold — go to the Payout tab to request payment."
                : `${fmt(threshold - payable)} more needed to unlock payout.`}
            </p>
          </SectionCard>
        </div>
      )}

      {/* Transactions tab */}
      {tab === "transactions" && (
        <SectionCard title="Reward history" subtitle="All reward entries from your referrals.">
          {!transactions ? (
            <div className="py-8 text-center text-sm text-slate-400">Loading…</div>
          ) : transactions.items.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">No transactions yet. Rewards appear here once a referred customer pays.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      {["Date", "Type", "Amount", "Status", "Available from"].map((h) => (
                        <th key={h} className="pb-2 pr-4 text-xs font-semibold text-slate-500 dark:text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.items.map((e) => (
                      <tr key={e.id} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="py-2 pr-4 text-xs text-slate-500">{e.created_at ? new Date(e.created_at).toLocaleDateString("en-GB") : "—"}</td>
                        <td className="py-2 pr-4 text-xs capitalize text-slate-700 dark:text-slate-300">{e.type}</td>
                        <td className={`py-2 pr-4 text-xs font-semibold ${e.amount_minor < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {e.amount_minor < 0 ? "(" : ""}{fmt(Math.abs(e.amount_minor))}{e.amount_minor < 0 ? ")" : ""}
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            e.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                            e.status === "pending" ? "bg-amber-100 text-amber-700" :
                            "bg-slate-100 text-slate-600"
                          }`}>{e.status}</span>
                        </td>
                        <td className="py-2 text-xs text-slate-400">
                          {e.available_at ? new Date(e.available_at).toLocaleDateString("en-GB") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {transactions.total > 25 && (
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-slate-400">{transactions.total} total</span>
                  <div className="flex gap-2">
                    <button disabled={txPage <= 1} onClick={() => loadTransactions(txPage - 1)}
                      className="rounded-lg border px-3 py-1 text-xs disabled:opacity-40">Prev</button>
                    <span className="px-2 py-1 text-xs text-slate-500">Page {txPage}</span>
                    <button disabled={txPage * 25 >= transactions.total} onClick={() => loadTransactions(txPage + 1)}
                      className="rounded-lg border px-3 py-1 text-xs disabled:opacity-40">Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </SectionCard>
      )}

      {/* Payout tab */}
      {tab === "payout" && (
        <div className="space-y-4">
          <SectionCard title="Payout details" subtitle="Where we'll send your reward payment.">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Payment method</label>
                <select
                  value={payoutProfile.method}
                  onChange={(e) => setPayoutProfile((p) => ({ ...p, method: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="bank_transfer">Bank Transfer (UK)</option>
                  <option value="paypal">PayPal</option>
                </select>
              </div>

              {payoutProfile.method === "bank_transfer" && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Account name</label>
                    <input
                      type="text"
                      placeholder={savedProfile.account_name || "Full name on account"}
                      value={payoutProfile.account_name}
                      onChange={(e) => setPayoutProfile((p) => ({ ...p, account_name: e.target.value }))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Account number {savedProfile.account_number_masked && <span className="text-slate-400">({savedProfile.account_number_masked})</span>}
                      </label>
                      <input
                        type="text"
                        placeholder="8 digits"
                        value={payoutProfile.account_number}
                        onChange={(e) => setPayoutProfile((p) => ({ ...p, account_number: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Sort code {savedProfile.sort_code_masked && <span className="text-slate-400">({savedProfile.sort_code_masked})</span>}
                      </label>
                      <input
                        type="text"
                        placeholder="00-00-00"
                        value={payoutProfile.sort_code}
                        onChange={(e) => setPayoutProfile((p) => ({ ...p, sort_code: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                  </div>
                </>
              )}

              {payoutProfile.method === "paypal" && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    PayPal email {savedProfile.paypal_email_masked && <span className="text-slate-400">({savedProfile.paypal_email_masked})</span>}
                  </label>
                  <input
                    type="email"
                    placeholder="your@paypal.com"
                    value={payoutProfile.paypal_email}
                    onChange={(e) => setPayoutProfile((p) => ({ ...p, paypal_email: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              )}

              <Button onClick={saveProfile} disabled={savingProfile} variant="secondary" className="w-full">
                {savingProfile ? "Saving…" : "Save payout details"}
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="Request payout" subtitle="Available once your approved balance reaches £50.">
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                <span className="text-sm text-slate-600 dark:text-slate-400">Payable balance</span>
                <span className="text-lg font-bold text-slate-900 dark:text-slate-100">{fmt(payable)}</span>
              </div>
              <ProgressBar value={payable} max={threshold} />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Minimum: {fmt(threshold)}.{" "}
                {!canRequestPayout && `${fmt(threshold - payable)} more needed.`}
              </p>
              {!savedProfile.method && (
                <p className="text-xs text-amber-600 dark:text-amber-400">Add your payout details above before requesting a payment.</p>
              )}
              <Button
                onClick={requestPayout}
                disabled={!canRequestPayout || requestingPayout || !savedProfile.method}
                className="w-full"
              >
                {requestingPayout ? "Requesting…" : `Request payout of ${fmt(payable)}`}
              </Button>
            </div>
          </SectionCard>

          {pStatus === "active" && (
            <div className="pt-2 text-center">
              <button
                onClick={optOut}
                disabled={optingOut}
                className="text-xs text-slate-400 underline hover:text-slate-600 dark:hover:text-slate-200"
              >
                {optingOut ? "Leaving…" : "Leave the referral programme"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
