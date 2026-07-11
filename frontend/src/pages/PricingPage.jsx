import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  CardNumberElement,
  CardExpiryElement,
  CardCvcElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { PLANS, BILLING, formatPrice, planLabel, normalisePlanKey } from "../lib/plans";
import { apiRequest } from "../api/client";
import { useAuthStore } from "../store/auth";
import logoUrl from "../enterprate-logo.png";

const SUPPORT_EMAIL = "support@enterprate.ai";

// Initialise Stripe once; gracefully null if key not set
const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

// ── Card brand logos ──────────────────────────────────────────────────────────

function VisaLogo({ active }) {
  return (
    <div
      className={`flex h-7 w-[46px] shrink-0 items-center justify-center rounded border-[1.5px] transition-all ${
        active
          ? "border-[#1a1f71] bg-[#1a1f71] shadow-sm"
          : "border-slate-200 bg-white opacity-35 dark:border-slate-700 dark:bg-slate-900"
      }`}
    >
      <span
        className={`select-none text-[10px] font-black italic tracking-widest ${
          active ? "text-white" : "text-slate-400 dark:text-slate-500"
        }`}
      >
        VISA
      </span>
    </div>
  );
}

function MastercardLogo({ active }) {
  return (
    <div
      className={`flex h-7 w-[46px] shrink-0 items-center justify-center rounded border-[1.5px] transition-all ${
        active
          ? "border-slate-300 bg-white shadow-sm dark:border-slate-600"
          : "border-slate-200 bg-white opacity-35 dark:border-slate-700 dark:bg-slate-900"
      }`}
    >
      <svg viewBox="0 0 30 20" className="h-[14px] w-auto">
        <circle cx="11" cy="10" r="8" fill={active ? "#EB001B" : "#cbd5e1"} />
        <circle cx="19" cy="10" r="8" fill={active ? "#F79E1B" : "#e2e8f0"} />
        <path
          d="M15 3.5a8 8 0 0 1 0 13A8 8 0 0 1 15 3.5z"
          fill={active ? "#FF5F00" : "#d1d5db"}
        />
      </svg>
    </div>
  );
}

function VerveLogo({ active }) {
  return (
    <div
      className={`flex h-7 w-[46px] shrink-0 items-center justify-center rounded border-[1.5px] transition-all ${
        active
          ? "border-[#007B41] bg-[#007B41] shadow-sm"
          : "border-slate-200 bg-white opacity-35 dark:border-slate-700 dark:bg-slate-900"
      }`}
    >
      <span
        className={`select-none text-[9px] font-extrabold tracking-wide ${
          active ? "text-white" : "text-slate-400 dark:text-slate-500"
        }`}
      >
        verve
      </span>
    </div>
  );
}

// ── Stripe inline card form (must be inside <Elements>) ───────────────────────

const ELEM_STYLE = {
  style: {
    base: {
      fontSize: "14px",
      fontFamily:
        "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      color: "#0f172a",
      fontSmoothing: "antialiased",
      "::placeholder": { color: "#94a3b8" },
    },
    invalid: { color: "#ef4444", iconColor: "#ef4444" },
  },
};

function StripeCardForm({ plan, billing, onSwitchToBank, onNetworkError }) {
  const stripe = useStripe();
  const elements = useElements();
  const [brand, setBrand] = useState("unknown");
  const [isVerve, setIsVerve] = useState(false);
  const [nameOnCard, setNameOnCard] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState(null); // { pct, amt } | null
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [elemReady, setElemReady] = useState(false);

  // If the card element hasn't signalled ready within 5s, it likely has a network issue
  useEffect(() => {
    const t = setTimeout(() => {
      if (!elemReady) onNetworkError?.();
    }, 5000);
    return () => clearTimeout(t);
  }, [elemReady, onNetworkError]);

  const price = billing === BILLING.annual ? plan.annualPrice : plan.monthlyPrice;
  const priceLabel =
    billing === BILLING.annual ? `£${plan.annualTotal}/yr` : `£${price}/mo`;

  const effectiveBrand = isVerve ? "verve" : brand;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError("");

    try {
      const res = await apiRequest(
        "/plans/create-subscription",
        "POST",
        { plan_key: plan.key, billing_period: billing, promo_code: promoCode.trim() || undefined }
      );
      if (res.discount_pct || res.discount_amt) {
        setPromoApplied({ pct: res.discount_pct, amt: res.discount_amt });
      }

      const cardElement = elements.getElement(CardNumberElement);
      const { error: confirmError } = await stripe.confirmCardPayment(
        res.client_secret,
        {
          payment_method: {
            card: cardElement,
            billing_details: nameOnCard ? { name: nameOnCard } : undefined,
          },
        }
      );

      if (confirmError) {
        setError(
          confirmError.message ??
            "Payment failed. Please check your card details."
        );
      } else {
        // Eagerly activate the subscription in our DB without waiting for the webhook
        try {
          await apiRequest("/plans/activate-subscription", "POST", { subscription_id: res.subscription_id });
        } catch (_) {
          // Non-fatal — webhook will handle it if this fails
        }
        window.location.href = "/pricing/success";
      }
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).replace(
        /^HTTP \d+:\s*/,
        ""
      );
      if (msg.includes("503") || msg.includes("not configured")) {
        setError(
          "Card payments are being set up. Please use bank transfer for now."
        );
      } else {
        setError(msg || "Payment failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 pt-1">
      {/* Brand logos + Verve toggle */}
      <div className="flex items-center gap-1.5">
        <VisaLogo active={effectiveBrand === "visa"} />
        <MastercardLogo active={effectiveBrand === "mastercard"} />
        <VerveLogo active={isVerve} />
        <button
          type="button"
          onClick={() => setIsVerve((v) => !v)}
          className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            isVerve
              ? "border-[#007B41] bg-[#007B41]/10 text-[#007B41]"
              : "border-slate-200 text-slate-400 hover:border-[#007B41]/40 hover:text-[#007B41]"
          }`}
        >
          {isVerve ? "✕ Not Verve" : "Verve card?"}
        </button>
      </div>

      {isVerve ? (
        /* Verve path */
        <div className="rounded-lg border border-[#007B41]/20 bg-[#007B41]/5 p-3 space-y-2.5">
          <p className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed">
            Verve cards work via bank transfer — we'll send you payment details
            and confirm your plan instantly once received.
          </p>
          <button
            type="button"
            onClick={() => {
              setIsVerve(false);
              if (onSwitchToBank) onSwitchToBank();
            }}
            className="w-full rounded-xl border-2 border-[#007B41] py-2 text-sm font-semibold text-[#007B41] hover:bg-[#007B41] hover:text-white transition"
          >
            Switch to Bank Transfer
          </button>
        </div>
      ) : (
        <>
          {/* Card number */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Card Number
            </label>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-[10px] transition focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-200 dark:border-slate-700 dark:bg-slate-800">
              <CardNumberElement
                options={ELEM_STYLE}
                onReady={() => setElemReady(true)}
                onChange={(e) => {
                  if (e.error?.type === "network_error" || e.error?.code === "NETWORK_ERROR") {
                    onNetworkError?.();
                    return;
                  }
                  setBrand(e.brand);
                }}
              />
            </div>
          </div>

          {/* Expiry + CVV */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Expiry
              </label>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-[10px] transition focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-200 dark:border-slate-700 dark:bg-slate-800">
                <CardExpiryElement options={ELEM_STYLE} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                CVV
              </label>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-[10px] transition focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-200 dark:border-slate-700 dark:bg-slate-800">
                <CardCvcElement options={ELEM_STYLE} />
              </div>
            </div>
          </div>

          {/* Name on card */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Name on Card
            </label>
            <input
              type="text"
              placeholder="John Doe"
              value={nameOnCard}
              onChange={(e) => setNameOnCard(e.target.value)}
              className="ea-input"
            />
          </div>

          {/* Promo code */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Promo Code <span className="normal-case font-normal text-slate-400">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="Enter code"
              value={promoCode}
              onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoApplied(null); }}
              className="ea-input font-mono tracking-widest"
            />
            {promoApplied && (
              <p className="mt-1 text-[11px] font-semibold text-emerald-600">
                {promoApplied.pct ? `${promoApplied.pct}% discount applied` : promoApplied.amt ? `£${(promoApplied.amt / 100).toFixed(2)} off applied` : "Promo code applied"}
              </p>
            )}
          </div>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:bg-rose-900/20 dark:text-rose-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !stripe}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"
                  />
                </svg>
                Processing…
              </>
            ) : (
              <>
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Pay {priceLabel}
              </>
            )}
          </button>
        </>
      )}
    </form>
  );
}

// ── Checkout redirect fallback (when Stripe PK not set) ───────────────────────

function CheckoutFallback({ plan, billing }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setError("");
    setLoading(true);
    try {
      const res = await apiRequest("/plans/checkout", "POST", {
        plan_key: plan.key,
        billing_period: billing,
      });
      if (res?.checkout_url) {
        window.location.href = res.checkout_url;
      } else {
        setError("Could not start checkout. Try another payment method.");
      }
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
      setError(
        msg.includes("503") || msg.includes("not configured")
          ? "Card payments are being set up. Please use bank transfer for now."
          : (e instanceof Error ? e.message : String(e)).replace(/^HTTP \d+:\s*/, "") ||
            "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center gap-1.5">
        <VisaLogo active={false} />
        <MastercardLogo active={false} />
        <VerveLogo active={false} />
      </div>
      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:bg-rose-900/20 dark:text-rose-400">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {loading ? (
          <>
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
            </svg>
            Redirecting…
          </>
        ) : (
          <>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Pay securely with Stripe
          </>
        )}
      </button>
    </div>
  );
}

// ── Check icon ────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-emerald-500"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ── Payment options modal ─────────────────────────────────────────────────────

function PaymentModal({ plan, billing, onClose }) {
  const [method, setMethod] = useState(null); // null | 'card' | 'paypal' | 'bank'
  const [elementsAvailable, setElementsAvailable] = useState(true);
  const [bankEmail, setBankEmail] = useState("");
  const [bankSent, setBankSent] = useState(false);
  const [bankSending, setBankSending] = useState(false);

  const price = billing === BILLING.annual ? plan.annualPrice : plan.monthlyPrice;
  const billingLabel =
    billing === BILLING.annual
      ? `£${plan.annualTotal}/yr (£${price}/mo, billed annually)`
      : `£${price}/mo (billed monthly)`;

  function handlePayPal() {
    const subject = encodeURIComponent(
      `PayPal Payment – ${plan.label} (${billing})`
    );
    const body = encodeURIComponent(
      `Hi,\n\nI'd like to subscribe to the ${plan.label} plan.\n\nBilling: ${billingLabel}\n\nPlease send me your PayPal details to complete payment.\n\nMy email: `
    );
    window.open(
      `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`,
      "_blank"
    );
  }

  async function handleBankSubmit(e) {
    e.preventDefault();
    if (!bankEmail.trim()) return;
    setBankSending(true);
    try {
      await apiRequest("/plans/waitlist", "POST", {
        email: bankEmail.trim(),
        plan_key: plan.key,
        billing_period: billing,
      });
    } catch {
      // Non-fatal
    } finally {
      setBankSent(true);
      setBankSending(false);
    }
  }

  function switchToBank() {
    setMethod("bank");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Subscribe to {plan.label}
            </h3>
            <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">
              {billingLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
            Choose a payment method
          </p>

          {/* ── Card ── */}
          <div
            className={
              "rounded-xl border transition " +
              (method === "card"
                ? "border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/20"
                : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-slate-600")
            }
          >
            <button
              type="button"
              className="flex w-full items-center gap-3 p-4 text-left"
              onClick={() => setMethod(method === "card" ? null : "card")}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                <svg
                  className="h-5 w-5 text-slate-700 dark:text-slate-300"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <path d="M2 10h20" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Credit / Debit Card
                </div>
                <div className="text-[12px] text-slate-500 dark:text-slate-400">
                  Visa · Mastercard · Verve
                </div>
              </div>
              <svg
                className={
                  "h-4 w-4 shrink-0 text-slate-400 transition-transform " +
                  (method === "card" ? "rotate-180" : "")
                }
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {method === "card" && (
              <div className="border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-700">
                {stripePromise && elementsAvailable ? (
                  <Elements stripe={stripePromise}>
                    <StripeCardForm
                      plan={plan}
                      billing={billing}
                      onSwitchToBank={switchToBank}
                      onNetworkError={() => setElementsAvailable(false)}
                    />
                  </Elements>
                ) : (
                  <CheckoutFallback plan={plan} billing={billing} />
                )}
              </div>
            )}
          </div>

          {/* ── PayPal ── */}
          <div
            className={
              "rounded-xl border transition " +
              (method === "paypal"
                ? "border-[#0070BA]/40 bg-[#f0f7ff] dark:border-[#0070BA]/30 dark:bg-[#0070BA]/10"
                : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-slate-600")
            }
          >
            <button
              type="button"
              className="flex w-full items-center gap-3 p-4 text-left"
              onClick={() => setMethod(method === "paypal" ? null : "paypal")}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7 3h7.5C17 3 19 4.8 19 7.2c0 3.3-2.3 5.3-5.5 5.3H11l-1 5H7L7 3Z"
                    fill="#003087"
                  />
                  <path
                    d="M9 6h5.5C17 6 18.5 7.5 18.5 9.5c0 2.8-1.8 4.5-4.5 4.5H11l-.8 4.5H8L9 6Z"
                    fill="#009CDE"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  PayPal
                </div>
                <div className="text-[12px] text-slate-500 dark:text-slate-400">
                  Pay with your PayPal account
                </div>
              </div>
              <svg
                className={
                  "h-4 w-4 shrink-0 text-slate-400 transition-transform " +
                  (method === "paypal" ? "rotate-180" : "")
                }
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {method === "paypal" && (
              <div className="border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-700">
                <p className="mb-3 text-[13px] text-slate-500 dark:text-slate-400">
                  Click below and we'll send you a PayPal payment request for
                  the exact amount.
                </p>
                <button
                  type="button"
                  onClick={handlePayPal}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0070BA] py-2.5 text-sm font-semibold text-white transition hover:bg-[#005ea6]"
                >
                  Request PayPal invoice
                </button>
              </div>
            )}
          </div>

          {/* ── Bank Transfer ── */}
          <div
            className={
              "rounded-xl border transition " +
              (method === "bank"
                ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/10"
                : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-slate-600")
            }
          >
            <button
              type="button"
              className="flex w-full items-center gap-3 p-4 text-left"
              onClick={() => setMethod(method === "bank" ? null : "bank")}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                <svg
                  className="h-5 w-5 text-slate-700 dark:text-slate-300"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M3 9l9-6 9 6" />
                  <path d="M5 9v9M19 9v9M3 18h18" />
                  <path d="M9 9v9M15 9v9" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Bank Transfer
                </div>
                <div className="text-[12px] text-slate-500 dark:text-slate-400">
                  BACS · Faster Payments · Also for Verve
                </div>
              </div>
              <svg
                className={
                  "h-4 w-4 shrink-0 text-slate-400 transition-transform " +
                  (method === "bank" ? "rotate-180" : "")
                }
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {method === "bank" && (
              <div className="border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-700">
                {bankSent ? (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 dark:bg-emerald-900/20">
                    <svg
                      className="h-4 w-4 shrink-0 text-emerald-600"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <p className="text-[13px] font-medium text-emerald-700 dark:text-emerald-400">
                      Request received! We'll email bank details and an invoice
                      shortly.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="mb-3 text-[13px] text-slate-500 dark:text-slate-400">
                      Enter your email and we'll send bank details + an invoice
                      for{" "}
                      <strong className="text-slate-700 dark:text-slate-300">
                        {billingLabel}
                      </strong>
                      .
                    </p>
                    <form onSubmit={handleBankSubmit} className="space-y-2">
                      <input
                        type="email"
                        required
                        placeholder="your@email.com"
                        value={bankEmail}
                        onChange={(e) => setBankEmail(e.target.value)}
                        className="ea-input"
                      />
                      <button
                        type="submit"
                        disabled={bankSending}
                        className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {bankSending ? "Sending…" : "Request invoice"}
                      </button>
                    </form>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-center gap-1.5 border-t border-slate-100 px-5 py-3 text-[12px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Secure · Cancel anytime · Questions?{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {SUPPORT_EMAIL}
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Add-on card ───────────────────────────────────────────────────────────────

function AddonCard({ addon, mode, token }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleBuy() {
    if (!token) {
      navigate(`/login?return=/pricing`);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await apiRequest("/plans/addons/checkout", "POST", { addon_key: addon.key });
      if (res?.checkout_url) {
        window.location.href = res.checkout_url;
      } else {
        setError("Could not start checkout. Please try again.");
      }
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).replace(/^HTTP \d+:\s*/, "");
      setError(
        msg.includes("503") || msg.includes("not yet available")
          ? "This add-on is coming soon. Contact us to arrange manually."
          : msg || "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">
          {addon.label}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            mode === "subscription"
              ? "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400"
              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
          }`}
        >
          {mode === "subscription" ? "Monthly" : "One-time"}
        </span>
      </div>
      <p className="mb-3 flex-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
        {addon.desc}
      </p>
      <div className="mb-3 text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
        {addon.price}
      </div>
      {error && (
        <p className="mb-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700 dark:bg-rose-900/20 dark:text-rose-400">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleBuy}
        disabled={loading}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-brand-400 py-2 text-[13px] font-semibold text-brand-700 transition hover:bg-brand-600 hover:text-white disabled:opacity-60 dark:border-brand-500 dark:text-brand-400 dark:hover:bg-brand-600 dark:hover:text-white"
      >
        {loading ? (
          <>
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
            </svg>
            Redirecting…
          </>
        ) : token ? (
          "Buy Now"
        ) : (
          "Sign in to purchase"
        )}
      </button>
    </div>
  );
}


// ── Plan card ─────────────────────────────────────────────────────────────────

function PlanCard({ plan, billing, onAction, currentPlanKey }) {
  const isPopular = !!plan.badge;
  const price = billing === BILLING.annual ? plan.annualPrice : plan.monthlyPrice;
  const isFree = plan.monthlyPrice === 0;
  const isCurrent = plan.key === currentPlanKey;

  return (
    <div
      className={
        "relative flex flex-col rounded-2xl border bg-white p-5 shadow-sm transition dark:bg-slate-900 " +
        (isPopular
          ? "border-brand-400 shadow-lg ring-2 ring-brand-200 dark:border-brand-500 dark:ring-brand-800"
          : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700")
      }
    >
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center rounded-full bg-brand-600 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white shadow">
            {plan.badge}
          </span>
        </div>
      )}

      <div className="mb-5">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {plan.label}
          </h3>
          {plan.tier && (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
              {plan.tier}
            </span>
          )}
        </div>
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
          {plan.tagline}
        </p>
      </div>

      <div className="mb-6">
        <div className="flex items-end gap-1">
          <span className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
            {isFree ? "£0" : formatPrice(price)}
          </span>
          {!isFree && (
            <span className="mb-1 text-sm text-slate-400 dark:text-slate-500">
              /mo
            </span>
          )}
        </div>
        {isFree ? (
          <p className="mt-1 text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
            No payment card required
          </p>
        ) : billing === BILLING.annual && plan.annualSaving > 0 ? (
          <p className="mt-1 text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
            £{plan.annualTotal}/yr · Save £{plan.annualSaving}/yr
          </p>
        ) : (
          <p className="mt-1 text-[13px] text-slate-400 dark:text-slate-500">
            Billed monthly
          </p>
        )}
      </div>

      <ul className="mb-8 flex-1 space-y-2.5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5">
            <CheckIcon />
            <span className="text-[13px] text-slate-600 dark:text-slate-300">
              {f}
            </span>
          </li>
        ))}
      </ul>

      {isCurrent ? (
        <div className="w-full rounded-xl border border-emerald-300 bg-emerald-50 py-2.5 text-center text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400">
          Current plan
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onAction(plan)}
          className={
            "w-full rounded-xl py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-brand-300 " +
            (plan.ctaStyle === "solid"
              ? "bg-brand-600 text-white hover:bg-brand-700 shadow-sm"
              : isPopular
              ? "border-2 border-brand-400 text-brand-700 hover:bg-brand-50 dark:border-brand-500 dark:text-brand-400 dark:hover:bg-brand-900/20"
              : "border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800")
          }
        >
          {plan.cta}
        </button>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function fmtPeriodDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export default function PricingPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const subscription = useAuthStore((s) => s.subscription);
  const [billing, setBilling] = useState(BILLING.monthly);
  const [activeModal, setActiveModal] = useState(null);

  const currentPlanKey = normalisePlanKey(subscription?.plan_key ?? "explorer");

  function handleAction(plan) {
    if (plan.monthlyPrice === 0) {
      navigate(token ? "/dashboard" : "/login");
      return;
    }
    if (!token) {
      navigate(`/login?return=/pricing&plan=${plan.key}&billing=${billing}`);
      return;
    }
    setActiveModal(plan);
  }

  return (
    <div className="ea-scroll flex h-screen flex-col overflow-y-auto bg-slate-50 dark:bg-slate-950">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => navigate(token ? "/dashboard" : "/")}
            className="flex items-center gap-2"
          >
            <img
              src={logoUrl}
              alt="EnterprateAI"
              className="h-7 w-auto object-contain"
            />
          </button>
          <div className="flex items-center gap-3">
            {token && subscription?.plan_key && (
              <span className="hidden rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 sm:inline dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                {planLabel(subscription.plan_key, subscription.status)}
              </span>
            )}
            <button
              type="button"
              onClick={() => navigate(token ? "/dashboard" : "/login")}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              {token ? "Dashboard" : "Sign in"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6">
        <div className="text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 sm:text-4xl">
            Simple, transparent pricing
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base text-slate-500 dark:text-slate-400">
            Start free on the Explorer plan. No payment card required. Upgrade when
            you're ready.
          </p>

          <div className="mt-8 inline-flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {[
              { value: BILLING.monthly, label: "Monthly" },
              { value: BILLING.annual, label: "Annual" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setBilling(opt.value)}
                className={
                  "relative rounded-xl px-5 py-2 text-sm font-semibold transition " +
                  (billing === opt.value
                    ? "bg-brand-600 text-white shadow"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100")
                }
              >
                {opt.label}
                {opt.value === BILLING.annual && (
                  <span
                    className={
                      "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide " +
                      (billing === BILLING.annual
                        ? "bg-white/25 text-white"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400")
                    }
                  >
                    Save up to £498
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Active paid subscription summary */}
        {token && subscription?.status === "active" && subscription.plan_key !== "free_trial" && (() => {
          const activePlan = PLANS.find(p => p.key === normalisePlanKey(subscription.plan_key));
          if (!activePlan) return null;
          const periodStart = fmtPeriodDate(subscription.current_period_start);
          const periodEnd = fmtPeriodDate(subscription.current_period_end);
          const isAnnual = subscription.billing_period === "annual";
          return (
            <div className="mt-10 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-800 dark:bg-emerald-900/10">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Active Subscription</span>
                  </div>
                  <h3 className="mt-1 text-xl font-extrabold text-slate-900 dark:text-slate-100">
                    {activePlan.label}{activePlan.tier ? ` · ${activePlan.tier}` : ""}
                  </h3>
                  <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{activePlan.tagline}</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                    {isAnnual ? `£${activePlan.annualTotal}/yr` : `£${activePlan.monthlyPrice}/mo`}
                  </div>
                  <div className="mt-0.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">
                    {isAnnual ? "Billed annually" : "Billed monthly"}
                  </div>
                  {periodStart && periodEnd && (
                    <div className="mt-1 text-[12px] text-emerald-700 dark:text-emerald-400">
                      {periodStart} → {periodEnd}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-5 border-t border-emerald-200 pt-4 dark:border-emerald-800">
                <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Included features</p>
                <ul className="grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
                  {activePlan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-[13px] text-slate-700 dark:text-slate-300">
                      <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })()}

        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 mx-auto max-w-2xl sm:max-w-none">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.key}
              plan={plan}
              billing={billing}
              onAction={handleAction}
              currentPlanKey={currentPlanKey}
            />
          ))}
        </div>

        <div className="mt-8 flex items-center justify-center gap-2 text-[13px] text-slate-400 dark:text-slate-500">
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Visa · Mastercard · Verve · PayPal · Bank Transfer · Cancel anytime
        </div>

        <div className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            What's included in each plan
          </h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Idea Validation",
                desc: "Submit a product or service idea and get an AI-driven viability assessment covering market fit, revenue potential, and a clear accept or reject outcome to guide your next step.",
                plans: ["Explorer", "Starter"],
              },
              {
                title: "Business Blueprints",
                desc: "Turn your validated idea into professional documents: business plans, investor-ready proposals, and sales letters, all generated from your actual business profile.",
                plans: ["Explorer", "Starter"],
              },
              {
                title: "Catalogue",
                desc: "Manage products, customers, and vendors in one place. Free on Explorer with no record limits. Starter includes up to 250 products, 500 customers, and 250 vendors.",
                plans: ["Explorer", "Starter"],
              },
              {
                title: "Financials",
                desc: "Create invoices, raise quotations, log expenses, and manage contracts. Explorer includes unlimited invoices and quotations. Starter includes 50 of each per month.",
                plans: ["Explorer", "Starter"],
              },
              {
                title: "Scenario Simulation",
                desc: "Run what-if analyses to see how your business holds up under different conditions. Adjust revenue, costs, and growth assumptions to stress-test decisions before committing.",
                plans: ["Starter"],
              },
              {
                title: "Fragility Index",
                desc: "As you run simulations, the system flags variables that put your business model under stress, surfacing risk signals early so you can course-correct before they become real problems.",
                plans: ["Starter"],
              },
            ].map((item) => (
              <div key={item.title} className="space-y-1.5">
                <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                  {item.title}
                </div>
                <p className="text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                  {item.desc}
                </p>
                <div className="flex flex-wrap gap-1">
                  {item.plans.map((p) => (
                    <span
                      key={p}
                      className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-slate-800 dark:text-brand-400"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Marketplace Add-ons ── */}
        <div className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              Add-ons
            </span>
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Marketplace Add-ons
          </h2>
          <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
            Boost your marketplace presence or top up RFQ credits at any time, compatible with any plan.
          </p>

          <div className="mt-6 space-y-6">
            {/* Featured Listing Boosts */}
            <div>
              <h3 className="mb-3 text-[12px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                Featured Listing Boosts
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { key: "addon_featured_1",  label: "Extra Featured Listing",   price: "£15/mo", desc: "1 additional featured slot, billed monthly." },
                  { key: "addon_featured_5",  label: "5 Listing Boosts",         price: "£49/mo", desc: "5 featured boosts per month, billed monthly." },
                  { key: "addon_featured_20", label: "20 Listing Boosts",        price: "£149/mo", desc: "20 featured boosts per month, billed monthly." },
                ].map((addon) => (
                  <AddonCard key={addon.key} addon={addon} mode="subscription" token={token} />
                ))}
              </div>
            </div>

            {/* RFQ Credit Packs */}
            <div>
              <h3 className="mb-3 text-[12px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                RFQ Response Credit Packs
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { key: "addon_rfq_20",  label: "20 RFQ Credits",  price: "£10",  desc: "Respond to 20 buyer RFQ requests. One-time purchase." },
                  { key: "addon_rfq_50",  label: "50 RFQ Credits",  price: "£20",  desc: "Respond to 50 buyer RFQ requests. Best value." },
                  { key: "addon_rfq_100", label: "100 RFQ Credits", price: "£35",  desc: "Respond to 100 buyer requests. Maximum pack." },
                ].map((addon) => (
                  <AddonCard key={addon.key} addon={addon} mode="payment" token={token} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Questions? Email us at{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </main>

      {activeModal && (
        <PaymentModal
          plan={activeModal}
          billing={billing}
          onClose={() => setActiveModal(null)}
        />
      )}
    </div>
  );
}
