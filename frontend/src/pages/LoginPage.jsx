import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Button from "../components/Button";
import Input from "../components/Input";
import InlineAlert from "../components/InlineAlert";
import { useAuthStore } from "../store/auth";
import Spinner from "../components/Spinner";
import GoogleSignInButton from "../components/GoogleSignInButton";
import logoUrl from "../enterprate-logo.png";
import { apiRequest } from "../api/client";

const FEATURE_STEPS = [
  {
    n: "1",
    title: "Create your business workspace",
    body: "Tell us briefly about your business or idea.",
  },
  {
    n: "2",
    title: "Choose what you want to achieve",
    body: "Validate an idea, create a business plan, get funding-ready, or grow an existing business.",
  },
  {
    n: "3",
    title: "Let EnterprateAI guide you",
    body: "Get structured insights, recommendations, and next actions.",
  },
];

const TRUST_POINTS = ["Start free", "No credit card required", "Private & secure"];

const QUICK_STARTS = [
  { label: "Validate\nMy Idea", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  { label: "Create My\nBusiness Plan", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2" },
  { label: "Get\nFunding-Ready", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" },
  { label: "Launch My\nProduct or Service", icon: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17" },
  { label: "Improve My\nExisting Business", icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" },
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5 text-brand-700">
      <path d="M16.5 5.75 8.25 14l-4.75-4.75" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 text-slate-400">
      <path d="M6.5 8V6.75a3.5 3.5 0 0 1 7 0V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="4.75" y="8" width="10.5" height="7.5" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function EyeIcon({ open = false }) {
  return open ? (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 text-slate-400">
      <path d="M2.5 10s2.5-5 7.5-5 7.5 5 7.5 5-2.5 5-7.5 5-7.5-5-7.5-5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 12.5A2.5 2.5 0 1 0 10 7a2.5 2.5 0 0 0 0 5.5Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 text-slate-400">
      <path d="M3 3l14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7.4 7.4A4.9 4.9 0 0 0 2.5 10s2.5 5 7.5 5c.93 0 1.8-.12 2.6-.34" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12.05 12.05A2.5 2.5 0 0 1 7.95 7.95" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const googleLogin = useAuthStore((s) => s.googleLogin);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const verificationPending = useAuthStore((s) => s.verificationPending);
  const verificationEmail = useAuthStore((s) => s.verificationEmail);
  const clearVerificationPending = useAuthStore((s) => s.clearVerificationPending);

  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState(searchParams.get("signup") ? "signup" : "signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgotNotice, setForgotNotice] = useState(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState(null);

  useEffect(() => {
    const refClickId = searchParams.get("ref_click");
    const refCode = searchParams.get("ref_code");
    const refExpiresAt = searchParams.get("ref_expires_at");
    if (!refClickId && !refCode) return;

    try {
      const existingRaw = localStorage.getItem("ea_referral");
      if (existingRaw) return;
      localStorage.setItem(
        "ea_referral",
        JSON.stringify({
          click_id: refClickId || null,
          code: refCode || null,
          expires_at: refExpiresAt || null,
          stored_at: new Date().toISOString(),
        })
      );
    } catch {
      // Referral capture should never block login/signup.
    }
  }, [searchParams]);

  async function tryDemo() {
    setDemoLoading(true);
    setDemoError(null);
    try {
      const data = await apiRequest("/auth/demo", "POST");
      const token = data?.access_token ?? data?.token;
      if (!token) throw new Error("no_token");
      localStorage.setItem("ea_token", token);
      localStorage.setItem("ea_email", "demo");
      sessionStorage.setItem("ea_tour_active", "1");
      sessionStorage.setItem("ea_tour_step", "0");
      sessionStorage.removeItem("ea_tour_done");
      await useAuthStore.getState().hydrate();
    } catch {
      setDemoError("Demo account is not available right now.");
    } finally {
      setDemoLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    const pendingJoin = sessionStorage.getItem("ea_pending_join");
    if (pendingJoin) {
      sessionStorage.removeItem("ea_pending_join");
      navigate(`/join/${pendingJoin}`, { replace: true });
      return;
    }
    // Honour ?next= for deep-link flows (e.g. "sign in to submit a proposal").
    // Only same-origin relative paths are accepted.
    const next = searchParams.get("next");
    if (next && /^\/(?!\/)/.test(next)) {
      navigate(next, { replace: true });
      return;
    }
    navigate("/dashboard", { replace: true });
  }, [token, navigate, searchParams]);

  async function onSubmit(e) {
    e.preventDefault();
    setForgotNotice(null);
    if (mode === "signup") {
      const name = fullName.trim();
      if (name) sessionStorage.setItem("ea_signup_name", name);
      return register(email, password, name ? { full_name: name } : {});
    }
    return login(email, password);
  }

  if (verificationPending) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl">
          <img src={logoUrl} alt="EnterprateAI" className="mx-auto mb-6 h-7 w-auto object-contain" />
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-100">
            <svg className="h-7 w-7 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="mt-4 text-lg font-bold text-slate-900">Check your inbox</h1>
          <p className="mt-2 text-sm text-slate-500">
            We sent a verification link to <strong className="text-slate-700">{verificationEmail}</strong>. Click the link to activate your account.
          </p>
          <p className="mt-3 text-xs text-slate-400">Didn't receive it? Check spam or junk folders.</p>
          <button
            type="button"
            onClick={() => { clearVerificationPending(); setMode("signin"); }}
            className="mt-6 w-full rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition"
          >
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(98,121,255,0.14),_transparent_32%),linear-gradient(135deg,_#f7f8ff_0%,_#ffffff_55%,_#fff2f5_100%)]">
      <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-1/3 bg-[radial-gradient(circle_at_left_center,_rgba(77,106,255,0.10),_transparent_58%)] lg:block" />
      <div className="pointer-events-none absolute -left-32 top-24 hidden h-96 w-96 rounded-full bg-brand-200/20 blur-3xl lg:block" />
      <div className="pointer-events-none absolute bottom-0 right-0 hidden h-72 w-72 rounded-full bg-rose-200/24 blur-3xl lg:block" />

      <div className="relative mx-auto grid min-h-[100dvh] w-full max-w-none gap-5 px-3 py-3 sm:px-4 sm:py-4 lg:grid-cols-[minmax(0,1.14fr)_minmax(0,0.86fr)] lg:items-stretch lg:gap-5 lg:px-5 lg:py-4 xl:px-8 2xl:px-12 max-[900px]:gap-4 max-[900px]:py-2.5">
        <section className="relative flex flex-col justify-between overflow-hidden rounded-[2rem] border border-white/70 bg-white/40 p-5 shadow-[0_24px_80px_rgba(77,106,255,0.10)] backdrop-blur sm:p-7 lg:p-9">
          <div className="pointer-events-none absolute -left-24 top-40 hidden h-80 w-80 rounded-full border border-brand-100/80 bg-brand-100/40 lg:block" />
          <div className="pointer-events-none absolute -bottom-24 right-4 hidden h-64 w-64 rounded-full bg-rose-100/55 lg:block" />

          <div className="relative">
            <div className="inline-flex items-center gap-2">
              <img src={logoUrl} alt="EnterprateAI" className="h-8 w-auto object-contain lg:h-11" />
            </div>

            <h1 className="mt-4 max-w-xl text-[2rem] font-black leading-[0.95] tracking-[-0.04em] text-[#0b1026] sm:text-[2.6rem] lg:mt-7 lg:text-[3.35rem] lg:leading-[0.92] lg:tracking-[-0.05em] xl:text-[4.05rem] 2xl:text-[4.45rem]">
              Build a More
              <br />
              Resilient Business
              <br />
              with <span className="text-rose-500">Intelligence.</span>
            </h1>

            <p className="mt-3 max-w-xl text-[0.82rem] leading-5 text-slate-600 sm:text-[0.88rem] lg:mt-4 lg:text-[0.92rem] lg:leading-6 xl:text-[1.02rem]">
              Validate your idea, build your business plan, understand your risks, and simulate decisions before you act, all from one business workspace.
            </p>

            <p className="mt-3 text-[0.82rem] font-semibold text-[#0f172a] sm:text-[0.9rem] lg:mt-4 lg:text-[1rem] xl:text-[1.06rem]">
              Get your first business insight in less than 20 minutes.
            </p>

            <div className="mt-4 space-y-3 lg:mt-5 lg:space-y-4 xl:space-y-5">
              {FEATURE_STEPS.map((step) => (
                <div key={step.n} className="flex gap-3 lg:gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1f3fd3] text-[0.7rem] font-bold text-white shadow-lg shadow-[#1f3fd3]/18 lg:h-10 lg:w-10 lg:text-sm xl:h-11 xl:w-11 xl:text-base">
                    {step.n}
                  </div>
                  <div>
                    <div className="text-[0.78rem] font-bold text-[#111827] sm:text-[0.82rem] lg:text-sm xl:text-[0.98rem]">{step.title}</div>
                    <div className="mt-0.5 max-w-lg text-[0.74rem] leading-4 text-slate-600 sm:text-[0.78rem] sm:leading-5 lg:text-[0.82rem] xl:text-sm xl:leading-6">{step.body}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.75rem] font-medium text-slate-700 sm:text-[0.8rem] lg:mt-5 lg:gap-x-4 lg:gap-y-2 lg:text-[0.82rem] xl:mt-7 xl:gap-x-5 xl:text-[0.85rem]">
              {TRUST_POINTS.map((point) => (
                <div key={point} className="flex items-center gap-1.5 lg:gap-2">
                  <CheckIcon />
                  <span>{point}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative mt-4 hidden text-[0.98rem] font-semibold leading-tight text-[#0f172a] lg:mt-5 lg:block xl:mt-7 xl:text-[1.45rem]">
            <span className="whitespace-nowrap">Small Businesses Need Intelligence.</span>
            <br />
            <span className="text-brand-700">EnterprateAI</span> Delivers It.
          </div>
        </section>

        <section className="flex items-center justify-center lg:justify-end">
          <div className="flex h-full w-full max-w-[740px] flex-col overflow-hidden rounded-[2rem] border border-[#dbe3f2] bg-white/95 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-5 lg:h-[calc(100dvh-4rem)] lg:p-5 xl:p-7 max-[900px]:p-4 max-h-[calc(100svh-1.5rem)] lg:max-h-none">
            <div className="text-center">
              <h2 className="text-[1.9rem] font-black tracking-tight text-[#0b1026] sm:text-[2.1rem] max-[900px]:text-[1.6rem]">Welcome to EnterprateAI</h2>
              <p className="mt-1.5 text-[0.86rem] text-slate-500 sm:text-[0.92rem] max-[900px]:text-[0.8rem]">Create your workspace and get guided business intelligence.</p>
            </div>

            <div className="mt-3 rounded-2xl bg-[#eef2f8] p-1 ring-1 ring-[#dbe3f2]">
              <div className="grid grid-cols-2 gap-1">
                {[
                  { value: "signup", label: "Create Account" },
                  { value: "signin", label: "Sign In" },
                ].map((opt) => {
                  const selected = mode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setMode(opt.value);
                        setForgotNotice(null);
                      }}
                      className={
                        "rounded-xl px-4 py-2.5 text-[0.95rem] font-semibold transition " +
                        (selected
                          ? "bg-white text-[#1f3fd3] shadow-sm ring-1 ring-[#dbe3f2]"
                          : "text-slate-500 hover:text-slate-800")
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 flex-1 space-y-3 overflow-y-auto px-1 pb-3 pt-4">
              <div className="relative z-10 mx-auto w-full max-w-[460px] overflow-visible pt-3">
                <GoogleSignInButton disabled={isLoading} onCredential={(cred) => googleLogin(cred)} />
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200" />
                <div className="text-[0.82rem] text-slate-500">or continue with email</div>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              <form className="space-y-3" onSubmit={onSubmit}>
                {mode === "signup" ? (
                  <div>
                    <div className="ea-label text-[0.8rem] text-[#5b6474]">Full name</div>
                    <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" placeholder="Enter your full name" />
                  </div>
                ) : null}

                <div>
                  <div className="ea-label text-[0.8rem] text-[#5b6474]">Email address</div>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="Enter your email address" />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <div className="ea-label mb-0 text-[0.8rem] text-[#5b6474]">Password</div>
                    <Link
                      to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`}
                      className="text-[0.78rem] font-semibold text-[#1f3fd3] hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      placeholder="Create a strong password"
                      className="pr-11"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
                    >
                      <EyeIcon open={showPassword} />
                    </button>
                  </div>
                </div>

                {forgotNotice ? <InlineAlert kind="warn" message={forgotNotice} /> : null}

                {error ? (
                  <div className="space-y-2">
                    <InlineAlert kind="error" message={error} />
                    {String(error).includes("Account already exists") ? (
                      <button type="button" className="text-sm font-semibold text-brand-700 hover:underline" onClick={() => setMode("signin")}>
                        Switch to sign in
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <Button
                  disabled={isLoading}
                  type="submit"
                  className="w-full py-3 text-[0.95rem] sm:text-[1rem] !bg-none !bg-[#1f3fd3] hover:!bg-[#1535a7] !shadow-[0_10px_24px_rgba(31,63,211,0.18)]"
                >
                  {isLoading ? <Spinner size={16} /> : null}
                  {mode === "signup" ? "Create My Free Workspace" : "Sign In"}
                  <span aria-hidden="true">→</span>
                </Button>
              </form>

              <div className="flex items-center justify-center gap-2 text-[0.8rem] text-slate-500">
                <LockIcon />
                <span>No credit card required</span>
              </div>

              <div className="text-center text-[0.82rem] text-slate-600">
                {mode === "signup" ? (
                  <>
                    Already have an account?{" "}
                    <button type="button" className="font-semibold text-[#1f3fd3] hover:underline" onClick={() => setMode("signin")}>
                      Sign in
                    </button>
                  </>
                ) : (
                  <>
                    New here?{" "}
                    <button type="button" className="font-semibold text-[#1f3fd3] hover:underline" onClick={() => setMode("signup")}>
                      Create an account
                    </button>
                  </>
                )}
              </div>

              <div className="text-center">
                <button
                  type="button"
                  onClick={tryDemo}
                  disabled={demoLoading}
                  className="text-[0.82rem] font-semibold text-[#1f3fd3] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {demoLoading ? "Loading demo..." : "Explore EnterprateAI Demo →"}
                </button>
                {demoError && <p className="mt-1 text-xs text-rose-500">{demoError}</p>}
              </div>
            </div>

            <div className="mt-3 border-t border-slate-100 pt-3 [@media(max-height:950px)]:hidden max-[900px]:mt-2.5 max-[900px]:pt-2.5">
              <div className="text-[0.85rem] font-semibold text-slate-800">What do you want help with first?</div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                {QUICK_STARTS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-[#dbe3f2] bg-white px-3 py-2 text-center text-[11px] font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#bfd1ff] hover:shadow-md max-[900px]:min-h-[76px]"
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6 text-[#4f46e5]">
                      <path d={item.icon} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="whitespace-pre-line leading-4">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
