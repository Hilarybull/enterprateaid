import { useEffect, useRef, useState } from "react";

function CheckIcon({ className = "h-3 w-3" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

export default function DocumentShareModal({
  onClose,
  onGenerate,
  onSendEmail,
  getMailtoHref,
  defaultEmail = "",
  defaultAccessMode = "link",
  allowEmailLock = true,
  title = "Share document",
  subtitle = "Choose who can use this link before generating it.",
}) {
  const backdropRef = useRef(null);
  const [accessMode, setAccessMode] = useState(allowEmailLock ? defaultAccessMode : "link");
  const [email, setEmail] = useState(defaultEmail);
  const [mailRecipient, setMailRecipient] = useState(defaultEmail);
  const [expiryDays, setExpiryDays] = useState(allowEmailLock ? 7 : 0);
  const [shareLink, setShareLink] = useState("");
  const [shareToken, setShareToken] = useState("");
  const [emailStatus, setEmailStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mailPromptOpen, setMailPromptOpen] = useState(false);
  const [mailSending, setMailSending] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setShareLink("");
    setShareToken("");
    setEmailStatus(null);
    setCopied(false);
    setError("");
    setMailPromptOpen(false);
  }, [accessMode, email, expiryDays]);

  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
  }

  // When the email lock is disabled, the email field is an optional delivery
  // target ("email a copy to") rather than an access restriction.
  const emailIsDelivery = !allowEmailLock;

  async function handleGenerate() {
    const emailRequired = accessMode === "email";
    if (emailRequired && !email.trim()) {
      setEmailInvalid(true);
      setError("Enter the email address for this share link.");
      return;
    }
    if ((emailRequired || (emailIsDelivery && email.trim())) && !isValidEmail(email)) {
      setEmailInvalid(true);
      setError("Enter a valid email address (e.g. name@company.com).");
      return;
    }
    setLoading(true);
    setEmailInvalid(false);
    setError("");
    try {
      const result = await onGenerate({
        access_mode: accessMode,
        email: (emailRequired || emailIsDelivery) && email.trim() ? email.trim() : null,
        expires_in_days: expiryDays,
      });
      const normalized = typeof result === "string" ? { url: result } : result;
      if (!normalized?.url) throw new Error("Share link could not be created.");
      setShareLink(normalized.url);
      setShareToken(normalized.token || "");
      setEmailStatus({
        sent: Boolean(normalized.emailSent),
        error: normalized.emailError || "",
      });
    } catch (e) {
      const raw = (e instanceof Error ? e.message : "") || "";
      if (e?.code === "NETWORK_ERROR" || raw === "NETWORK_ERROR") {
        setError("Unable to reach the server. Please check your connection and try again.");
      } else {
        const clean = raw.replace(/^HTTP \d+:\s*/i, "");
        const isEmailErr = /email|@-sign|valid.*address/i.test(clean);
        setError(isEmailErr ? "Enter a valid email address (e.g. name@company.com)." : clean || "Failed to create share link.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  async function handleSendViaEmail() {
    if (!shareLink) return;
    if (accessMode === "link" && !mailPromptOpen) {
      setMailPromptOpen(true);
      setMailRecipient(defaultEmail);
      return;
    }
    const recipient = accessMode === "email" ? email.trim() : mailRecipient.trim();
    if (!recipient) {
      setError("Enter a recipient email.");
      return;
    }
    setError("");
    if (onSendEmail && shareToken) {
      setMailSending(true);
      try {
        const result = await onSendEmail({
          token: shareToken,
          email: recipient,
          url: shareLink,
          accessMode,
          expiryDays,
        });
        setEmailStatus({
          sent: Boolean(result?.sent),
          error: result?.error || "",
        });
      } catch (e) {
        setEmailStatus({
          sent: false,
          error: e instanceof Error ? e.message : "Email could not be sent.",
        });
      } finally {
        setMailSending(false);
      }
      return;
    }
    if (getMailtoHref) {
      window.location.href = getMailtoHref({
        url: shareLink,
        accessMode,
        email: recipient,
        expiryDays,
      });
    }
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div
        className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl max-h-[90svh] sm:max-h-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-slate-200" />
        </div>

        <div className="relative border-b border-slate-100 px-4 py-4 text-center sm:px-5 sm:py-5">
          <div className="mx-auto max-w-sm">
            <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 sm:right-5 sm:top-4"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 space-y-4 overflow-y-auto px-4 py-4 pb-8 sm:px-5 sm:pb-5">
          <div className={allowEmailLock ? "" : "hidden"}>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">
              Who can use this link?
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                {
                  value: "link",
                  title: "Anyone with link",
                  desc: "Multiple users can join with this same link until it expires or is revoked.",
                },
                {
                  value: "email",
                  title: "Specific email only",
                  desc: "Only the entered email can use this link, and only once.",
                },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setAccessMode(opt.value);
                    if (opt.value === "link") setEmail("");
                    setError("");
                  }}
                  className={
                    "rounded-xl border p-3 text-left transition " +
                    (accessMode === opt.value
                      ? "border-brand-300 bg-brand-50"
                      : "border-slate-200 bg-white hover:bg-slate-50")
                  }
                >
                  <div className="text-[12px] font-semibold text-slate-800">{opt.title}</div>
                  <div className="mt-1 text-[11px] text-slate-500">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {(accessMode === "email" || emailIsDelivery) && (
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">
                {emailIsDelivery ? "Email a copy to" : "Email address"}
                <span className="ml-1 font-normal text-slate-400">
                  {emailIsDelivery ? "(optional)" : "(required)"}
                </span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setEmailInvalid(false); }}
                placeholder="recipient@company.com"
                className={
                  "w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:ring-2 " +
                  (emailInvalid
                    ? "border-rose-400 focus:border-rose-400 focus:ring-rose-100"
                    : "border-slate-200 focus:border-brand-300 focus:ring-brand-100")
                }
              />
              {emailIsDelivery ? (
                <div className="mt-1.5 text-[11px] text-slate-500">
                  We'll email the link here. Anyone with the link can still open it.
                </div>
              ) : null}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">
              Link expires in
            </label>
            <select
              value={expiryDays}
              onChange={(e) => setExpiryDays(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
            >
              {!allowEmailLock ? <option value={0}>Never</option> : null}
              <option value={1}>1 day</option>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>

          {error ? (
            <div className="rounded-xl bg-rose-50 px-3 py-2.5 text-[12px] font-medium text-rose-600">
              {error}
            </div>
          ) : null}

          {shareLink ? (
            <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <CheckIcon className="h-3 w-3" />
                </span>
                <span className="text-[12px] font-semibold text-emerald-700">
                  {emailStatus?.sent
                    ? `Email sent to ${(email || mailRecipient).trim()}`
                    : `Share link ready - ${accessMode === "email" ? "email-only" : "multi-use"} - ${expiryDays > 0 ? `expires in ${expiryDays} day${expiryDays !== 1 ? "s" : ""}` : "no expiry"}`}
                </span>
              </div>
              {emailStatus && !emailStatus.sent ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  {emailStatus.error || "The secure link was created, but the email was not sent."}
                </div>
              ) : null}
              <div className="flex items-center gap-2 rounded-lg bg-white py-1 pl-2.5 pr-1 ring-1 ring-slate-200">
                <span className="min-w-0 flex-1 truncate text-[11px] font-mono text-slate-600">
                  {shareLink}
                </span>
                <button
                  type="button"
                  onClick={copyLink}
                  className={
                    "shrink-0 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition " +
                    (copied ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")
                  }
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              {(onSendEmail || getMailtoHref) && accessMode === "link" && mailPromptOpen ? (
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">
                    Recipient email
                    <span className="ml-1 font-normal text-slate-400">(required)</span>
                  </label>
                  <input
                    type="email"
                    value={mailRecipient}
                    onChange={(e) => setMailRecipient(e.target.value)}
                    placeholder="recipient@company.com"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
                  />
                  <div className="mt-2 text-[11px] text-slate-500">
                    This does not lock the link to this address. It only chooses where the app should send the open link.
                  </div>
                </div>
              ) : null}
              {(onSendEmail || getMailtoHref) ? (
                <button
                  type="button"
                  onClick={handleSendViaEmail}
                  disabled={mailSending}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white py-2 text-[13px] font-semibold text-slate-700 transition hover:bg-emerald-50"
                >
                  <MailIcon />
                  {mailSending ? "Sending..." : emailStatus?.sent ? "Sent" : "Send via email"}
                </button>
              ) : null}
              {accessMode === "email" ? (
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={loading}
                  className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                >
                  {loading ? "Sending..." : emailStatus?.sent ? "Send again" : "Try sending again"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-5">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 sm:w-auto"
          >
            {shareLink ? "Close" : "Cancel"}
          </button>
          {!shareLink ? (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="w-full rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50 sm:w-auto"
            >
              {loading
                ? "Creating..."
                : accessMode === "email" || (emailIsDelivery && email.trim())
                ? "Generate and send"
                : "Generate share link"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
