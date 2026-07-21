import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import logoUrl from "../enterprate-logo.png";


const STEPS = [
  { n: "1", title: "Input once", body: "Add your business, product, service, customer, vendor, financial, and marketplace information once." },
  { n: "2", title: "Generate everywhere", body: "Use the same data to create business plans, proposals, sales letters, invoices, quotations, contracts, marketplace listings, and reports." },
  { n: "3", title: "Simulate before acting", body: "Understand the likely impact of business decisions before making costly moves. A price change, new hire, cost increase, customer loss, product launch, supplier issue, or expansion decision can affect multiple areas of your business. EnterprateAI helps you see those connections before you act." },
  { n: "4", title: "Grow with intelligence", body: "Discover risks, uncover opportunities, and make smarter decisions using Fragility Index and Adaptive Scenario Intelligence." },
];

const EXAMPLES = [
  {
    tagLabel: "Hiring Decision",
    tagIcon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
    title: "Should you hire a new team member?",
    impacts: [
      { type: "neg", text: "Cash runway reduces: 8 → 5 months" },
      { type: "neg", text: "Break even shifts by +2 months" },
      { type: "warn", text: "Risk increases under low revenue scenarios" },
      { type: "neg", text: "Monthly burn rate increases by £3,500" },
    ],
    rec: "Delay hiring by 2 months or use a contractor to preserve cashflow stability. Safe to hire from Month 3.",
  },
  {
    tagLabel: "Pricing Decision",
    tagIcon: "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z",
    title: "Planning to raise your prices?",
    impacts: [
      { type: "pos", text: "Revenue increases by +12%" },
      { type: "pos", text: "Profit margin improves by +18%" },
      { type: "pos", text: "Remains profitable with up to 8% churn" },
      { type: "pos", text: "Break even improves by 1.5 months" },
    ],
    rec: "Increase pricing by 15%. Revenue remains positive even under moderate churn. Implement with a 30 day notice period.",
  },
  {
    tagLabel: "Cost Reduction",
    tagIcon: "M13 17h8m0 0v-8m0 8l-8-8-4 4-6-6",
    title: "Thinking of cutting marketing spend?",
    impacts: [
      { type: "pos", text: "Immediate cashflow improves by £2,100/mo" },
      { type: "warn", text: "Pipeline impact: −22% leads by Month 3" },
      { type: "neg", text: "Revenue dip: −£6,400 by Month 5" },
      { type: "warn", text: "Net effect negative beyond Month 4" },
    ],
    rec: "Do not cut marketing budget. Short term saving creates a revenue hole in Month 4 to 6. Instead, reallocate £800/mo from offline to digital for better ROI.",
  },
];

const TESTIMONIALS = [
  {
    quote: "I was about to hire a second developer. EnterprateAI ran the simulation and showed me my cash runway would drop to 4 months under two realistic revenue scenarios. I hired a contractor instead. Six months later, that decision saved my business.",
    name: "Victor",
    role: "Rhema Concept, London",
    init: "V",
    color: "bg-brand-500",
  },
  {
    quote: "We were debating a price increase for months. EnterprateAI modelled three scenarios in minutes and showed us we could raise by 18% and still retain 94% of customers. We raised prices within a week. Best decision we made this year.",
    name: "Irene A.",
    role: "Sombeauty London Ltd, UK",
    init: "I",
    color: "bg-accent-500",
  },
  {
    quote: "As a solo founder I was making £40k decisions based on spreadsheets and gut feel. EnterprateAI gave me the confidence of a CFO without the cost of one. I now run every major decision through it before acting.",
    name: "Gilbert C.",
    role: "OIC3 Auto Services Ltd, UK",
    init: "G",
    color: "bg-emerald-500",
  },
];

const PLANS = [
  {
    name: "Explorer",
    monthly: 0,
    annual: 0,
    annualSaving: 0,
    free: true,
    desc: "",
    features: [
      "50 AI credits",
      "Basic Idea Validation",
      "Business Plan",
      "Unlimited products, customers & vendors",
      "Unlimited invoices & quotations",
      "Business Registration Guide",
      "1 marketplace listing",
    ],
    highlight: false,
  },
  {
    name: "Starter",
    tier: "Insight",
    monthly: 19,
    annual: 15.83,
    annualTotal: 190,
    annualSaving: 38,
    free: false,
    desc: "Solo founders & new service businesses.",
    features: [
      "500 AI credits",
      "Basic & Comprehensive Idea Validation",
      "Business Blueprints & Proposals",
      "Scenario Simulation",
      "Fragility Index",
      "Adaptive Scenario Intelligence",
      "Unlimited products, customers & vendors",
      "Unlimited invoices & quotations",
      "1 marketplace listing",
      "1 user",
    ],
    highlight: true,
    badge: "Best Value",
  },
];

const FAQS = [
  { q: "Is my business data secure?", a: "Yes. All data is encrypted in transit (TLS 1.3) and at rest (AES-256). We are ICO Registered, GDPR compliant, and never share or sell your data. You can delete your data at any time." },
  { q: "Do I need to connect my accounts?", a: "No. You can enter your data manually, upload a spreadsheet, or optionally connect Xero or QuickBooks for automatic updates. Manual entry works perfectly for most early stage businesses." },
  { q: "How is this different from my accountant's spreadsheet?", a: "Your accountant shows you what already happened. EnterprateAI models your business as a live system and simulates what will happen next, across all your interconnected costs, revenues, and decisions, before you commit." },
  { q: "What if my business is very small or early-stage?", a: "EnterprateAI is specifically designed for UK SMEs, including early stage businesses with as few as 2–3 months of trading data. The simpler your business, the faster the setup." },
  { q: "Is there a free plan?", a: "Yes. The Explorer plan is free forever with no credit card required. You get basic idea validation, a business plan, unlimited financial tools, and more — all powered by AI credits. Upgrade to a paid plan whenever you are ready for comprehensive validation, proposals, and advanced features." },
  { q: "Is EnterprateAI GDPR compliant?", a: "Yes, fully. We are ICO Registered (UK data protection authority), process all data within UK/EU jurisdictions, and provide a full Data Processing Agreement (DPA) on request for business customers." },
  { q: "How quickly can I run my first simulation?", a: "Most users run their first decision simulation within 15 minutes of signing up. Our onboarding flow guides you through connecting your data and building your first business model step by step." },
  { q: "Can I cancel anytime?", a: "Yes. No lock-in contracts, no cancellation fees. Cancel from your account settings in 30 seconds. Your data remains accessible for 30 days after cancellation." },
];

function BrandIcon({ d, d2 }) {
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50">
      <svg className="h-6 w-6 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
        {d2 && <path d={d2} />}
      </svg>
    </div>
  );
}

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-4 py-4 text-left"
      >
        <span className="text-sm font-semibold text-slate-800">{q}</span>
        <span className={`mt-0.5 shrink-0 text-brand-500 transition-transform duration-200 ${open ? "rotate-45" : ""}`}>✕</span>
      </button>
      {open && <p className="pb-4 text-sm leading-relaxed text-slate-500">{a}</p>}
    </div>
  );
}

export default function LandingPage() {
  const [annualBilling, setAnnualBilling] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showExitPopup, setShowExitPopup] = useState(false);
  const [exitDismissed, setExitDismissed] = useState(false);
  const exitTimerRef = useRef(null);
  const navigate = useNavigate();

  // Unlock scroll — body has overflow-hidden globally for the app shell
  useEffect(() => {
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    function onMouseLeave(e) {
      if (e.clientY > 10) return;
      clearTimeout(exitTimerRef.current);
      const hasToken = !!localStorage.getItem("ea_token");
      if (!hasToken && !exitDismissed && !showExitPopup) {
        exitTimerRef.current = setTimeout(() => setShowExitPopup(true), 400);
      }
    }
    document.addEventListener("mouseleave", onMouseLeave);
    return () => {
      document.removeEventListener("mouseleave", onMouseLeave);
      clearTimeout(exitTimerRef.current);
    };
  }, [exitDismissed, showExitPopup]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-white font-sans text-slate-800 antialiased">

      {/* ── Exit-intent popup (landing page) ── */}
      {showExitPopup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 sm:p-8 shadow-2xl">
            <button
              type="button"
              onClick={() => { setShowExitPopup(false); setExitDismissed(true); }}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600"
            >✕</button>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-2xl">👋</span>
              <span className="text-xs font-semibold uppercase tracking-widest text-brand-600">Before you go</span>
            </div>
            <h3 className="mt-2 text-xl font-bold text-slate-900">Get started for free</h3>
            <p className="mt-2 text-sm text-slate-500">
              EnterprateAI gives you the business intelligence tools to validate ideas, run scenario simulations, and make smarter decisions - completely free to start.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              {[
                "Validate your business idea in minutes",
                "Run scenario simulations before committing",
                "Generate investor-ready business plans",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span>{f}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="mt-5 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 transition"
            >
              Get Started Free →
            </button>
            <button
              type="button"
              onClick={() => { setShowExitPopup(false); setExitDismissed(true); }}
              className="mt-2 w-full rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
            >
              Maybe later
            </button>
            <p className="mt-3 text-center text-xs text-slate-400">Free plan · No credit card required</p>
          </div>
        </div>
      )}

      {/* ── Sticky navbar ── */}
      <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="#hero" className="flex items-center gap-2">
            <img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto sm:h-8" />
          </a>
          <ul className="hidden items-center gap-6 md:flex">
            {[["#modules", "Features"], ["#how-it-works", "How It Works"], ["#examples", "See It Work"], ["#pricing", "Pricing"], ["#faq", "FAQ"]].map(([href, label]) => (
              <li key={href}>
                <a href={href} className="text-sm font-medium text-slate-600 transition hover:text-brand-600">{label}</a>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Link to="/login" className="text-sm font-medium text-slate-600 hover:text-slate-900">Sign in</Link>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
            >
              Start Free
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="ml-1 flex h-9 w-9 flex-col items-center justify-center gap-1.5 md:hidden"
              aria-label="Menu"
            >
              <span className={`block h-0.5 w-5 bg-slate-700 transition-all ${mobileMenuOpen ? "translate-y-2 rotate-45" : ""}`} />
              <span className={`block h-0.5 w-5 bg-slate-700 transition-all ${mobileMenuOpen ? "opacity-0" : ""}`} />
              <span className={`block h-0.5 w-5 bg-slate-700 transition-all ${mobileMenuOpen ? "-translate-y-2 -rotate-45" : ""}`} />
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="border-t border-slate-100 bg-white px-4 pb-4 md:hidden">
            <ul className="mt-3 flex flex-col gap-3">
              {[["#modules", "Features"], ["#how-it-works", "How It Works"], ["#examples", "See It Work"], ["#pricing", "Pricing"], ["#faq", "FAQ"]].map(([href, label]) => (
                <li key={href}>
                  <a href={href} onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-slate-700">{label}</a>
                </li>
              ))}
              <li><Link to="/login" className="block text-sm font-medium text-slate-700">Sign in</Link></li>
            </ul>
          </div>
        )}
      </nav>

      {/* ══════════════════════════════════════════
          HERO
      ══════════════════════════════════════════ */}
      <section id="hero" className="relative overflow-hidden bg-gradient-to-br from-brand-900 via-brand-800 to-brand-900 pb-16 pt-14 sm:pt-20">
        <div className="pointer-events-none absolute -right-32 -top-32 h-[500px] w-[500px] rounded-full bg-brand-500/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-[400px] w-[400px] rounded-full bg-accent-500/15 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-16 lg:items-center">
            <div>
              <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl xl:text-5xl drop-shadow-md">
                Input data once. Generate everywhere.{" "}
                <span className="text-white">Simulate before acting. Grow with intelligence.</span>
              </h1>

              <p className="mt-5 text-lg font-semibold leading-relaxed text-white">
                The intelligent business workspace for small businesses that want to move faster.
              </p>

              <p className="mt-3 text-base leading-relaxed text-white/90">
                EnterprateAI helps small businesses save time, reduce cost, discover risks, uncover opportunities, and move from idea to market faster.
              </p>

              <p className="mt-3 text-sm leading-relaxed text-white/70">
                Turn one set of business data into business plans, proposals, invoices, quotations, marketplace listings, simulations, risk insights, and growth opportunities - all from one connected workspace.
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => navigate("/login")}
                  className="w-full rounded-xl bg-brand-500 px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-900/60 transition hover:bg-brand-400 active:scale-95 sm:w-auto"
                >
                  Get Started Free →
                </button>
                <a
                  href="#how-it-works"
                  className="flex w-full items-center justify-center rounded-xl border border-white/20 px-7 py-3.5 text-base font-semibold text-slate-200 transition hover:border-white/40 hover:text-white sm:w-auto"
                >
                  See How It Works
                </a>
              </div>

              <div className="mt-5 flex flex-wrap gap-4 text-sm text-indigo-200">
                <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Free to start</span>
                <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> No credit card required</span>
                <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> One workspace for everything</span>
              </div>
            </div>

            {/* Hero image — visible on all screen sizes and responsive */}
            <div className="relative block">
              <div className="overflow-hidden rounded-3xl max-w-full sm:max-w-2xl md:max-w-xl mx-auto lg:mx-0">
                <img
                  src="/hero-section-a.png"
                  alt="Hero Section A"
                  className="block w-full h-56 sm:h-72 md:h-[440px] lg:h-auto object-contain rounded-2xl"
                  style={{ background: 'transparent' }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          TRUST BAR
      ══════════════════════════════════════════ */}

      {/* ══════════════════════════════════════════
          PAIN SECTION
      ══════════════════════════════════════════ */}
      <section className="bg-slate-50/50 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">Stop repeating the same business information across different tools</h2>
          <p className="mt-4 text-slate-600">Most small businesses waste valuable time entering the same information again and again.</p>
          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {[
              { text: "You describe your business in one place.", icon: "→", active: true, indent: 0 },
              { text: "Then repeat it for proposals.", icon: "↳", active: false, indent: 1 },
              { text: "Then again for invoices.", icon: "↳", active: false, indent: 2 },
              { text: "Then again for quotations.", icon: "↳", active: false, indent: 3 },
              { text: "Then again for product listings, customer records, vendor records, financial documents, and business planning.", icon: "↳", active: false, indent: 3 },
            ].map((item, i) => (
              <div key={i} className={`flex items-start gap-3 border-b border-slate-100 px-5 py-3 text-sm last:border-0 ${item.active ? "bg-brand-50/60" : ""}`} style={{ paddingLeft: `${20 + item.indent * 18}px` }}>
                <span className={`shrink-0 mt-0.5 font-bold ${item.active ? "text-brand-500" : "text-slate-300"}`}>{item.icon}</span>
                <p className={item.active ? "font-semibold text-slate-800" : "text-slate-400 leading-relaxed"}>{item.text}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-base font-bold text-slate-900">That slows you down.</p>
          <div className="mt-5 rounded-2xl border border-brand-100 bg-brand-50 p-5">
            <p className="font-semibold text-brand-700">EnterprateAI changes this.</p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">With EnterprateAI, you input your business data once and use it across multiple business activities - from planning and proposals to marketplace visibility, quotations, invoices, simulations, and decision intelligence.</p>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          MODULES
      ══════════════════════════════════════════ */}
      <section id="modules" className="bg-slate-50 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12 text-center">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">The Platform</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">One input. Multiple business outputs.</h2>
            <p className="mt-3 text-slate-500">EnterprateAI turns your business data into practical tools you can use immediately.</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: <BrandIcon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />,
                name: "Create your business plan with one click",
                tag: "Available now",
                tagColor: "bg-emerald-100 text-emerald-700",
                desc: "Generate a structured business plan using your business information, idea, target market, services, financial assumptions, and growth goals.",
              },
              {
                icon: <BrandIcon d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
                name: "Create business proposals with one click",
                tag: "Available now",
                tagColor: "bg-emerald-100 text-emerald-700",
                desc: "Turn your products, services, customer needs, and business details into professional proposals faster.",
              },
              {
                icon: <BrandIcon d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />,
                name: "Launch your products and services on the marketplace with one click",
                tag: "Available now",
                tagColor: "bg-emerald-100 text-emerald-700",
                desc: "Publish your products and services on the EnterprateAI marketplace and make your business more visible to potential buyers.",
                isMarketplace: true,
              },
              {
                icon: <BrandIcon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />,
                name: "Validate business ideas before investing",
                tag: "Available now",
                tagColor: "bg-emerald-100 text-emerald-700",
                desc: "Assess whether an idea makes commercial sense before spending time, money, and resources.",
              },
              {
                icon: <BrandIcon d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />,
                name: "Simulate business decisions before taking action",
                tag: "Available now",
                tagColor: "bg-emerald-100 text-emerald-700",
                desc: "Test how pricing, cost, demand, capacity, customer dependency, and growth decisions may affect your business before you act. See how one decision from one business activity propagates across other business areas - from revenue and cashflow to operations, customer behaviour, risk exposure, profitability, and growth readiness.",
              },
              {
                icon: <BrandIcon d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />,
                name: "Create quick invoices and quotations",
                tag: "Available now",
                tagColor: "bg-emerald-100 text-emerald-700",
                desc: "Generate invoices and quotations from your business, customer, product, and service data without repeating manual work.",
              },
            ].map((m) => (
              <div key={m.name} className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-brand-200 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  {m.icon}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.tagColor}`}>{m.tag}</span>
                </div>
                <h3 className="mt-3 font-bold text-slate-900">{m.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{m.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="rounded-xl bg-brand-600 px-7 py-3 text-sm font-semibold text-white shadow transition hover:bg-brand-700"
            >
              Try it now for free →
            </button>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FROM IDEA TO MARKET
      ══════════════════════════════════════════ */}
      <section className="py-14 sm:py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 text-center">
          <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">From idea to market - faster</h2>
          <p className="mt-4 text-slate-600">Whether you are starting a new business, launching a service, responding to an opportunity, preparing a proposal, creating a quotation, or testing a strategic decision, EnterprateAI helps you move faster.</p>
          <p className="mt-3 text-slate-600">Instead of using disconnected tools for every activity, you work from one intelligent business workspace.</p>
          <p className="mt-3 text-slate-600">You can plan, create, publish, simulate, and make better decisions using the same business data.</p>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          DIFFERENTIATOR
      ══════════════════════════════════════════ */}
      <section className="bg-slate-900 py-16 text-white sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12 text-center">
            <span className="rounded-full bg-brand-500/20 px-3 py-1 text-xs font-semibold text-brand-300">One workspace. Multiple business outputs.</span>
            <h2 className="mt-3 text-2xl font-extrabold sm:text-3xl">EnterprateAI connects your business activities into one intelligent operating flow.</h2>
            <p className="mt-3 text-slate-400">Input once. Generate everywhere. Simulate before acting. Grow with intelligence.</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: <BrandIcon d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />, title: "Input once", body: "Add your business, product, customer, vendor, financial, and marketplace information once. No more repeating the same data across disconnected tools." },
              { icon: <BrandIcon d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />, title: "Generate everywhere", body: "Use the same data to create plans, proposals, sales letters, invoices, quotations, contracts, listings, and reports without repeating manual work." },
              { icon: <BrandIcon d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />, title: "Simulate before acting", body: "Understand the likely impact of business decisions before making costly moves. A pricing change, new hire, cost increase, customer loss, product launch, or expansion decision can affect multiple areas of your business. EnterprateAI helps you see those connections before you act." },
              { icon: <BrandIcon d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />, title: "Grow with intelligence", body: "Discover risks, uncover opportunities, and make better decisions using Fragility Index and Adaptive Scenario Intelligence." },
            ].map((c) => (
              <div key={c.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="mb-3">{c.icon}</div>
                <h3 className="mb-2 font-semibold">{c.title}</h3>
                <p className="text-sm leading-relaxed text-slate-400">{c.body}</p>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* ══════════════════════════════════════════
          MORE THAN A DOCUMENT GENERATOR
      ══════════════════════════════════════════ */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="mb-8 text-center">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">Why EnterprateAI</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">More than a document generator</h2>
            <p className="mt-3 text-slate-500">Most tools help you complete one task. EnterprateAI helps you connect the full business journey.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
            <p className="mb-4 text-sm font-semibold text-slate-700">Your business data becomes the foundation for:</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {[
                "Business planning", "Proposals", "Sales letters", "Product and service listings",
                "Customer records", "Vendor records", "Invoices", "Quotations",
                "Expenses", "Contracts", "Marketplace visibility", "Decision simulations",
                "Risk discovery", "Opportunity discovery",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700">
                  <span className="shrink-0 text-brand-500">✓</span>{item}
                </div>
              ))}
            </div>
            <p className="mt-6 text-center text-sm text-slate-500">The more you use EnterprateAI, the more useful your business data becomes for better decisions.</p>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          DISCOVER RISKS
      ══════════════════════════════════════════ */}
      <section className="bg-slate-50 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">Fragility Index</span>
              <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Discover risks before they become expensive</h2>
              <p className="mt-3 text-slate-600">Small business problems rarely happen in isolation.</p>
              <div className="mt-3 space-y-1 text-sm text-slate-500">
                <p>A pricing decision can affect demand.</p>
                <p>A customer loss can affect cashflow.</p>
                <p>A supplier issue can affect delivery.</p>
                <p>A hiring decision can affect cost.</p>
                <p>A growth opportunity can affect capacity.</p>
              </div>
              <p className="mt-3 text-slate-600">EnterprateAI helps you understand what could weaken your business before it becomes expensive.</p>
              <p className="mt-3 text-sm text-slate-500">Using Fragility Index, EnterprateAI helps identify areas such as:</p>
              <ul className="mt-4 space-y-2">
                {[
                  "Weak cash position", "Customer dependency", "Unstable revenue",
                  "Operational bottlenecks", "Capacity constraints", "Low market readiness", "Poor scalability",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-slate-600">
                    <span className="shrink-0 text-rose-500">⚠</span>{item}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-slate-500">This helps you act earlier, protect your business, and make smarter decisions.</p>
            </div>
            <div className="rounded-2xl border border-rose-100 bg-white p-6 shadow-sm">
              <p className="mb-4 text-xs font-bold uppercase tracking-widest text-rose-600">Fragility Index - Example</p>
              {[
                { label: "Cash Position", level: 2, max: 5, color: "bg-rose-500" },
                { label: "Revenue Stability", level: 3, max: 5, color: "bg-amber-400" },
                { label: "Customer Dependency", level: 1, max: 5, color: "bg-rose-600" },
                { label: "Market Readiness", level: 4, max: 5, color: "bg-emerald-500" },
                { label: "Scalability", level: 3, max: 5, color: "bg-amber-400" },
              ].map((item) => (
                <div key={item.label} className="mb-3">
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium text-slate-600">{item.label}</span>
                    <span className="text-slate-400">{item.level}/{item.max}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className={`h-2 rounded-full ${item.color}`} style={{ width: `${(item.level / item.max) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          HOW IT WORKS
      ══════════════════════════════════════════ */}
      <section id="how-it-works" className="py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="mb-12 text-center">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">How It Works</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">How EnterprateAI works</h2>
            <p className="mt-3 text-slate-500">One workspace. One set of data. Multiple business outputs.</p>
          </div>
          <div className="relative">
            <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-slate-100" aria-hidden="true" />
            <div className="space-y-8">
              {STEPS.map((s) => (
                <div key={s.n} className="flex gap-5">
                  <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white shadow-md shadow-brand-200">
                    {s.n}
                  </div>
                  <div className="pb-2 pt-1.5">
                    <h3 className="font-semibold text-slate-900">{s.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          EXAMPLES
      ══════════════════════════════════════════ */}
      <section id="examples" className="bg-slate-50 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12 text-center">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">Built for small businesses</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Simulate decisions before committing resources</h2>
            <p className="mt-3 mx-auto max-w-2xl text-slate-500">Before increasing prices, hiring staff, launching a product, reducing costs, entering a new market, accepting a large order, or expanding operations, EnterprateAI helps you simulate the possible impact.</p>
            <p className="mt-2 mx-auto max-w-2xl text-slate-500">You can test decisions before committing time, money, people, and resources. See how one decision from one business activity propagates across other business areas.</p>
            <p className="mt-2 mx-auto max-w-2xl text-slate-500">For example, a pricing change may affect demand, revenue, cashflow, customer behaviour, profitability, risk exposure, operational capacity, and growth readiness. This helps you reduce guesswork, avoid avoidable mistakes, and choose a better path.</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
            {EXAMPLES.map((ex) => (
              <div key={ex.tagLabel} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-600">
                    <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={ex.tagIcon} />
                    </svg>
                    {ex.tagLabel}
                  </span>
                  <h3 className="mt-1 font-semibold text-slate-900">{ex.title}</h3>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Impact Analysis</p>
                  <ul className="space-y-1.5">
                    {ex.impacts.map((imp) => (
                      <li key={imp.text} className={`flex items-start gap-2 text-xs ${imp.type === "pos" ? "text-emerald-600" : imp.type === "warn" ? "text-amber-600" : "text-rose-500"}`}>
                        <span className="mt-0.5 shrink-0">{imp.type === "pos" ? "↑" : imp.type === "warn" ? "⚠" : "↓"}</span>
                        {imp.text}
                      </li>
                    ))}
                  </ul>
                  <div className="rounded-xl border border-brand-100 bg-brand-50 p-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-brand-600">Recommendation</p>
                    <p className="text-xs leading-relaxed text-slate-600">{ex.rec}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-slate-400">Results are generated from <em>your actual business data</em> and update dynamically as conditions change.</p>
          <div className="mt-10 rounded-2xl border border-brand-100 bg-brand-50 p-6">
            <h3 className="text-base font-extrabold text-slate-900 text-center">Built for small businesses that want clarity, speed, and growth</h3>
            <p className="mt-3 text-sm font-semibold text-slate-700">EnterprateAI is designed for:</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {["Founders", "Freelancers", "Consultants", "Service providers", "Suppliers", "Agencies", "Local businesses", "Early-stage startups", "Small teams", "Growing businesses"].map((t) => (
                <span key={t} className="rounded-full border border-brand-200 bg-white px-3 py-1 text-xs font-medium text-brand-700">{t}</span>
              ))}
            </div>
            <p className="mt-4 text-sm text-slate-600">Whether you are validating an idea, creating a business plan, preparing a proposal, responding to an RFQ, listing your services, generating invoices, or testing a business decision, EnterprateAI helps you work faster from one connected platform.</p>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          WHY CHOOSE
      ══════════════════════════════════════════ */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">Why choose EnterprateAI</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Why small businesses choose EnterprateAI</h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: <BrandIcon d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />, title: "Save time", body: "Stop repeating the same information across different tools." },
              { icon: <BrandIcon d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />, title: "Reduce cost", body: "Use one connected workspace instead of relying on multiple disconnected systems." },
              { icon: <BrandIcon d="M17 8l4 4m0 0l-4 4m4-4H3" />, title: "Move faster", body: "Create plans, proposals, quotations, invoices, and listings in less time." },
              { icon: <BrandIcon d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />, title: "Make better decisions", body: "Simulate decisions before acting and understand how one activity affects other areas of the business." },
              { icon: <BrandIcon d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />, title: "Discover risks", body: "Identify weak points before they become serious business problems." },
              { icon: <BrandIcon d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />, title: "Uncover opportunities", body: "Use your business data to spot growth potential and improve strategic direction." },
            ].map((c) => (
              <div key={c.title} className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-brand-200 hover:shadow-sm transition">
                <div className="mb-3">{c.icon}</div>
                <h3 className="font-semibold text-slate-900">{c.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          MID-PAGE CTA
      ══════════════════════════════════════════ */}
      <section className="bg-gradient-to-r from-brand-600 to-brand-700 py-14 text-white">
        <div className="mx-auto max-w-2xl px-4 text-center sm:px-6">
          <h2 className="text-2xl font-extrabold sm:text-3xl">Start free today</h2>
          <p className="mt-3 text-brand-100">Input data once. Generate everywhere. Simulate before acting. Grow with intelligence.</p>
          <p className="mt-2 text-sm text-brand-200">EnterprateAI helps you turn one set of business data into business plans, proposals, invoices, quotations, marketplace listings, simulations, risk insights, and growth opportunities.</p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-7 rounded-xl bg-white px-8 py-3.5 text-sm font-bold text-brand-700 shadow transition hover:bg-brand-50 active:scale-95"
          >
            Get Started Free →
          </button>
          <p className="mt-3 text-xs text-brand-200">No credit card required · Free to start · Cancel anytime</p>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          TESTIMONIALS
      ══════════════════════════════════════════ */}
      <section id="testimonials" className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12 text-center">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">What Users Say</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Business Owners Who Stopped Guessing</h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className={`rounded-2xl border p-6 ${i === 0 ? "border-brand-200 bg-brand-50" : "border-slate-100 bg-white"}`}>
                <div className="mb-3 flex text-amber-400 text-sm">★★★★★</div>
                <blockquote className="text-sm leading-relaxed text-slate-700 italic">"{t.quote}"</blockquote>
                <div className="mt-5 flex items-center gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${t.color}`}>{t.init}</div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                    <p className="text-xs text-slate-400">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          PRICING
      ══════════════════════════════════════════ */}
      <section id="pricing" className="bg-slate-50 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">Pricing</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Simple, Transparent Pricing</h2>
            <p className="mt-3 text-slate-500">Start free on the Explorer plan. No credit card required.</p>
            <div className="mt-5 inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
              <button type="button" onClick={() => setAnnualBilling(false)} className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${!annualBilling ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-700"}`}>Monthly</button>
              <button type="button" onClick={() => setAnnualBilling(true)} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${annualBilling ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-700"}`}>
                Annual <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${annualBilling ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700"}`}>Save 17%</span>
              </button>
            </div>
          </div>
          <div className="mx-auto grid max-w-3xl gap-5 sm:grid-cols-2">
            {PLANS.map((plan) => (
              <div key={plan.name} className={`relative overflow-hidden rounded-2xl border bg-white p-6 ${plan.highlight ? "border-brand-400 ring-2 ring-brand-200 shadow-xl shadow-brand-100" : "border-slate-200"}`}>
                {plan.badge && (
                  <div className="absolute right-5 top-5 rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-bold text-white">{plan.badge}</div>
                )}
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900">{plan.name}</h3>
                  {plan.tier && (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-600">{plan.tier}</span>
                  )}
                </div>
                <div className="mt-2 flex items-end gap-1">
                  {plan.free ? (
                    <span className="text-3xl font-extrabold text-slate-900">£0</span>
                  ) : (
                    <>
                      <span className="text-3xl font-extrabold text-slate-900">
                        £{annualBilling ? plan.annual : plan.monthly}
                      </span>
                      <span className="mb-1 text-sm text-slate-400">/mo</span>
                    </>
                  )}
                </div>
                {plan.free ? (
                  <p className="text-xs font-medium text-emerald-600">No credit card required</p>
                ) : annualBilling ? (
                  <p className="text-xs text-emerald-600">Billed annually (save £{plan.annualSaving}/yr)</p>
                ) : (
                  <p className="text-xs text-slate-400">Billed monthly</p>
                )}
                <p className="mt-2 text-xs text-slate-500">{plan.desc}</p>
                <ul className="mt-5 space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                      <span className="mt-0.5 shrink-0 text-emerald-500">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => navigate("/login")}
                  className={`mt-6 w-full rounded-xl px-4 py-3 text-sm font-semibold transition ${plan.highlight ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100"}`}
                >
                  {plan.free ? "Start Free" : "Subscribe"}
                </button>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-slate-400">All prices exclude VAT. Cancel anytime. No lock-in contracts, no cancellation fees.</p>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FAQ
      ══════════════════════════════════════════ */}
      <section id="faq" className="py-16 sm:py-20">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">FAQ</span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">Common Questions</h2>
          </div>
          <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white px-4 sm:px-6">
            {FAQS.map((f) => <FAQItem key={f.q} q={f.q} a={f.a} />)}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FINAL CTA
      ══════════════════════════════════════════ */}
      <section className="bg-gradient-to-br from-slate-900 to-brand-900 py-16 text-white sm:py-20">
        <div className="mx-auto max-w-2xl px-4 text-center sm:px-6">
          <h2 className="text-2xl font-extrabold sm:text-3xl">Turn business activity into business intelligence</h2>
          <p className="mt-4 text-slate-300">Every activity inside EnterprateAI helps build better business intelligence. Your plans, proposals, invoices, quotations, marketplace listings, customers, vendors, costs, and simulations all create useful data for better decisions.</p>
          <p className="mt-3 text-slate-400">Not just reports. Not just documents. Not just automation.<br />A connected business workspace that helps you create, manage, simulate, and grow.</p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-8 rounded-xl bg-brand-500 px-10 py-4 text-base font-bold text-white shadow-xl shadow-brand-900/50 transition hover:bg-brand-400 active:scale-95"
          >
            Try EnterprateAI now for free →
          </button>
          <div className="mt-6 flex flex-wrap justify-center gap-4 text-xs text-slate-400">
            <span>✓ Free to start</span>
            <span>✓ No credit card required</span>
            <span>✓ Cancel anytime</span>
            <span>✓ GDPR compliant</span>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════ */}
      <footer className="border-t border-slate-100 bg-white py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto" />
            <div className="flex flex-wrap justify-center gap-5 text-xs text-slate-400">
              <Link to="/login" className="hover:text-slate-600">Sign In</Link>
              <a href="mailto:support@enterprate.ai" className="hover:text-slate-600">support@enterprate.ai</a>
              <span>Enterprate Limited · Registered in England &amp; Wales</span>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-4 text-[11px] text-slate-400">
            <Link to="/legal/privacy" className="hover:text-slate-600">Privacy Policy</Link>
            <span>·</span>
            <Link to="/legal/terms" className="hover:text-slate-600">Terms of Service</Link>
            <span>·</span>
            <Link to="/legal/disclaimer" className="hover:text-slate-600">Disclaimer</Link>
          </div>
          <p className="mt-3 text-center text-[11px] text-slate-300">
            © {new Date().getFullYear()} Enterprate Limited. All rights reserved.
            ICO Registered · GDPR Compliant · SEIS Advance Assurance Approved
          </p>
        </div>
      </footer>
    </div>
  );
}
