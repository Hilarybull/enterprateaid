import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import html2pdf from "html2pdf.js";
import Button from "../components/Button";
import DocumentShareModal from "../components/DocumentShareModal";
import InlineAlert from "../components/InlineAlert";
import Input from "../components/Input";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import SegmentedTabs from "../components/SegmentedTabs";
import IntegrationPanel from "../components/IntegrationPanel";
import ReportTable, { StatusBadge } from "../components/ReportTable";
import WorkspacePrompt from "../components/WorkspacePrompt";
import { FinancialIllustration, IllustrationCard } from "../components/Illustrations";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import { hasFeatureAccess } from "../lib/permissions";
import { formatCurrency } from "../lib/format";
import { getProductCostOfSales, getProductSalesPrice } from "../lib/financialIntelligence";

const OTHER_PRODUCT_ID = "__other__";

function MultiProductDropdown({ products, selectedIds, onChange, placeholder = "Select products / services", disabled = false }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedProducts = products.filter((product) => selectedIds.includes(product.id));
  const hasOther = selectedIds.includes(OTHER_PRODUCT_ID);
  const summaryParts = selectedProducts.map((p) => p.name);
  if (hasOther) summaryParts.push("Other");
  const summary = summaryParts.length ? summaryParts.join(", ") : placeholder;

  function toggleId(id) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((sid) => sid !== id)
      : [...selectedIds, id];
    onChange(next);
  }

  if (disabled) {
    const selectedProducts = products.filter((p) => selectedIds.includes(p.id));
    const hasOther = selectedIds.includes(OTHER_PRODUCT_ID);
    const parts = selectedProducts.map((p) => p.name);
    if (hasOther) parts.push("Other / Custom");
    return (
      <div className="ea-input flex w-full items-center justify-between bg-slate-50 text-slate-500 cursor-not-allowed select-none opacity-75">
        <span className="truncate text-sm">{parts.length ? parts.join(", ") : placeholder}</span>
        <svg className="ml-2 h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className="ea-input flex w-full items-center justify-between text-left">
        <span className="truncate text-sm text-slate-700">{summary}</span>
        <svg
          className={`ml-2 h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      {open ? (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="max-h-56 space-y-1 overflow-y-auto p-2">
            {products.length ? products.map((product) => (
              <label key={product.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(product.id)}
                  onChange={() => toggleId(product.id)}
                  className="accent-brand-600"
                />
                <span>{product.name}</span>
              </label>
            )) : (
              <div className="px-3 py-2 text-xs text-slate-400">No products or services found.</div>
            )}
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border-t border-slate-100 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={hasOther}
                onChange={() => toggleId(OTHER_PRODUCT_ID)}
                className="accent-brand-600"
              />
              <span className="italic">Other / Custom</span>
            </label>
          </div>
          <div className="border-t border-slate-100 px-3 py-2 text-right">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function FinancialsPage() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const workspaceName = useWorkspaceStore((s) => s.workspaceName);
  const workspaceLogo = useWorkspaceStore((s) => s.workspaceLogo);
  const currency = useWorkspaceStore((s) => s.currency);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);
  const setWorkspaceLogo = useWorkspaceStore((s) => s.setWorkspaceLogo);
  const isMemberMode = useWorkspaceStore((s) => s.isMemberMode);
  const memberPermissionType = useWorkspaceStore((s) => s.memberPermissionType);
  const memberPermissions = useWorkspaceStore((s) => s.memberPermissions);
  const navigate = useNavigate();

  function canFinancialsFeature(featureKey) {
    return !isMemberMode || hasFeatureAccess("financials", featureKey, memberPermissionType, memberPermissions);
  }

  const canViewFinancialsOverview = canFinancialsFeature("view_financials");

  function firstAccessibleFinancialsTab() {
    if (canViewFinancialsOverview) return "overview";
    if (canFinancialsFeature("invoices")) return "invoices";
    if (canFinancialsFeature("quotations")) return "quotes";
    if (canFinancialsFeature("expenses")) return "expenses";
    if (canFinancialsFeature("contracts")) return "contracts";
    return "overview";
  }

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [shareNotice, setShareNotice] = useState(null);
  const [shareDialog, setShareDialog] = useState(null);

  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [rfqRequests, setRfqRequests] = useState([]);
  const [rfqApproveModal, setRfqApproveModal] = useState(null); // { rfq, items: [{product_name,quantity,unit_price,unit_cost_of_sales}], validityDays }
  const [integrations, setIntegrations] = useState({
    financial: { quickbooks: "not_connected", sap: "not_connected", zoho_books: "not_connected" },
    crm: { zoho_crm: "not_connected", hubspot: "not_connected", salesforce: "not_connected" }
  });

  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [invoiceFormError, setInvoiceFormError] = useState(null);
  const [invoiceSubmitAttempted, setInvoiceSubmitAttempted] = useState(false);
  const [editingQuoteId, setEditingQuoteId] = useState(null);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [editingContractId, setEditingContractId] = useState(null);
  const [activeTab, setActiveTab] = useState(() => firstAccessibleFinancialsTab());
  const [overviewDrill, setOverviewDrill] = useState(null); // { label, type, items }
  const [pendingFinancialReport, setPendingFinancialReport] = useState(null);
  const [reportFilter, setReportFilter] = useState({ kpis: true, invoices: true, quotes: true, expenses: true, contracts: true });
  const [reportPreviewHtml, setReportPreviewHtml] = useState(null);

  // Reset to overview if current tab is locked by feature permissions
  useEffect(() => {
    const locked = {
      overview: !canViewFinancialsOverview,
      invoices: !canFinancialsFeature("invoices"),
      quotes: !canFinancialsFeature("quotations"),
      expenses: !canFinancialsFeature("expenses"),
      contracts: !canFinancialsFeature("contracts"),
    };
    if (locked[activeTab]) setActiveTab(firstAccessibleFinancialsTab());
  }, [activeTab, canViewFinancialsOverview, isMemberMode, memberPermissionType, memberPermissions]); // eslint-disable-line

  const [previewInvoiceId, setPreviewInvoiceId] = useState(null);
  const [previewQuoteId, setPreviewQuoteId] = useState(null);
  const [shareMenu, setShareMenu] = useState(null);
  const ARCHIVE_WARNING_DAYS = 60;
  const ARCHIVE_EXPIRE_DAYS = 90;

  const [invoiceForm, setInvoiceForm] = useState({
    invoice_id: "",
    customer_id: "",
    contract_id: "",
    product_ids: [],
    items: [],
    issued_at: new Date().toISOString().slice(0, 10),
    due_date: "",
  });
  const [quoteForm, setQuoteForm] = useState({
    quotation_id: "",
    customer_id: "",
    product_ids: [],
    items: [],
    validity_days: "30",
    issued_at: new Date().toISOString().slice(0, 10),
    due_date: "",
  });
  const [expenseForm, setExpenseForm] = useState({
    vendor_id: "",
    item: "",
    price: "",
    cost_type: "variable",
    incurred_at: new Date().toISOString().slice(0, 10),
    due_date: ""
  });
  const [contractForm, setContractForm] = useState({
    contract_type: "sales",
    counterparty_id: "",
    product_ids: [],
    price: "",
    payment_terms: "",
    discount: "",
    freight: "",
    cost_of_sales: "",
    start_date: new Date().toISOString().slice(0, 10),
    end_date: "",
    due_date: "",
    status: "pending"
  });

  function todayInputValue() {
    return new Date().toISOString().slice(0, 10);
  }

  function CardIcon({ tone = "bg-brand-50 text-brand-600", children }) {
    return (
      <div className={`flex h-9 w-9 items-center justify-center rounded-2xl ${tone}`}>
        {children}
      </div>
    );
  }

  useEffect(() => {
    if (!shareMenu) return;
    function handleClick(event) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-financial-share-menu]")) return;
      setShareMenu(null);
    }
    function handleResize() {
      setShareMenu(null);
    }
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("resize", handleResize);
    };
  }, [shareMenu]);

  function ActionMenu({ items }) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
      if (!open) return;
      function handleClick(e) {
        if (!menuRef.current || menuRef.current.contains(e.target)) return;
        setOpen(false);
      }
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }, [open]);

    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          onClick={() => setOpen((v) => !v)}
          aria-label="More actions"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>
        {open ? (
          <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-lg">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${
                  item.tone === "danger"
                    ? "text-rose-600 hover:bg-rose-50"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function daysSince(date) {
    const ts = date ? new Date(date).getTime() : NaN;
    if (!Number.isFinite(ts)) return 0;
    return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  }

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const ws = await apiRequest("/validation/me", "GET");
        if (!alive || !ws) return;
        setWorkspaceId(ws.id || workspaceId);
        setWorkspaceName(ws.name || null);
        const cat = ws?.data?.catalogue || {};
        const fin = ws?.data?.financials || {};
        const integ = ws?.data?.integrations || {};
        setWorkspaceLogo(ws?.data?.workspace_profile?.logo_data_url || null);
        setProducts(Array.isArray(cat.products) ? cat.products : []);
        setCustomers(Array.isArray(cat.customers) ? cat.customers : []);
        setVendors(Array.isArray(cat.vendors) ? cat.vendors : []);
        setInvoices(Array.isArray(fin.invoices) ? fin.invoices : []);
        setQuotes(Array.isArray(fin.quotes) ? fin.quotes : []);
        setExpenses(Array.isArray(fin.expenses) ? fin.expenses : []);
        setContracts(Array.isArray(fin.contracts) ? fin.contracts : []);
        setRfqRequests(Array.isArray(fin.rfq_requests) ? fin.rfq_requests : []);
        setIntegrations({
          financial: {
            quickbooks: integ?.financial?.quickbooks || "not_connected",
            sap: integ?.financial?.sap || "not_connected",
            zoho_books: integ?.financial?.zoho_books || "not_connected"
          },
          crm: {
            zoho_crm: integ?.crm?.zoho_crm || "not_connected",
            hubspot: integ?.crm?.hubspot || "not_connected",
            salesforce: integ?.crm?.salesforce || "not_connected"
          }
        });
      } catch (e) {
        if (String(e?.message || "").includes("HTTP 404")) return;
        setError(e instanceof Error ? e.message : "Failed to load financials");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [workspaceId, setWorkspaceId, setWorkspaceLogo, setWorkspaceName]);

  useEffect(() => {
    if (!workspaceId) return;
    const normalizeArchivedAt = (list) =>
      list.map((item) => {
        if (!item.archived) return item;
        if (item.archived_at) return item;
        return { ...item, archived_at: item.updated_at || item.created_at || new Date().toISOString() };
      });
    const stripExpired = (list) =>
      list.filter((item) => {
        if (!item.archived) return true;
        const age = daysSince(item.archived_at || item.updated_at || item.created_at);
        return age < ARCHIVE_EXPIRE_DAYS;
      });
    const nextInvoices = stripExpired(normalizeArchivedAt(invoices));
    const nextExpenses = stripExpired(normalizeArchivedAt(expenses));
    const nextContracts = stripExpired(normalizeArchivedAt(contracts));
    const changed =
      nextInvoices.length !== invoices.length ||
      nextExpenses.length !== expenses.length ||
      nextContracts.length !== contracts.length ||
      nextInvoices.some((i, idx) => i.archived_at !== invoices[idx]?.archived_at) ||
      nextExpenses.some((e, idx) => e.archived_at !== expenses[idx]?.archived_at) ||
      nextContracts.some((c, idx) => c.archived_at !== contracts[idx]?.archived_at);
    if (changed) {
      setInvoices(nextInvoices);
      setExpenses(nextExpenses);
      setContracts(nextContracts);
      persist({ invoices: nextInvoices, quotes, expenses: nextExpenses, contracts: nextContracts });
    }
  }, [workspaceId, invoices, quotes, expenses, contracts]);

  useEffect(() => {
    if (!workspaceId) return;
    const normalizeArchivedAt = (list) =>
      list.map((item) => {
        if (!item.archived) return item;
        if (item.archived_at) return item;
        return { ...item, archived_at: item.updated_at || item.created_at || new Date().toISOString() };
      });
    const stripExpired = (list) =>
      list.filter((item) => {
        if (!item.archived) return true;
        const age = daysSince(item.archived_at || item.updated_at || item.created_at);
        return age < ARCHIVE_EXPIRE_DAYS;
      });
    const nextQuotes = stripExpired(normalizeArchivedAt(quotes));
    const changed =
      nextQuotes.length !== quotes.length ||
      nextQuotes.some((q, idx) => q.archived_at !== quotes[idx]?.archived_at);
    if (changed) {
      setQuotes(nextQuotes);
      persist({ invoices, quotes: nextQuotes, expenses, contracts });
    }
  }, [workspaceId, invoices, quotes, expenses, contracts]);

  async function persist(next) {
    await apiRequest("/validation/me", "PATCH", { data: { financials: next } });
  }
  async function persistIntegrations(next) {
    await apiRequest("/validation/me", "PATCH", { data: { integrations: next } });
  }

  const activeProducts = useMemo(() => products.filter((p) => !p.archived), [products]);
  const activeCustomers = useMemo(() => customers.filter((c) => !c.archived), [customers]);
  const activeVendors = useMemo(() => vendors.filter((v) => !v.archived), [vendors]);

  const activeInvoices = useMemo(() => invoices.filter((i) => !i.archived), [invoices]);
  const activeQuotes = useMemo(() => quotes.filter((q) => !q.archived), [quotes]);
  const activeExpenses = useMemo(() => expenses.filter((e) => !e.archived), [expenses]);
  const activeContracts = useMemo(() => contracts.filter((c) => !c.archived), [contracts]);
  const archivedInvoices = useMemo(() => invoices.filter((i) => i.archived), [invoices]);
  const archivedQuotes = useMemo(() => quotes.filter((q) => q.archived), [quotes]);
  const archivedExpenses = useMemo(() => expenses.filter((e) => e.archived), [expenses]);
  const archivedContracts = useMemo(() => contracts.filter((c) => c.archived), [contracts]);

  const invoicePendingCount = useMemo(() => activeInvoices.filter((i) => i.status === "pending").length, [activeInvoices]);
  const invoicePaidCount = useMemo(() => activeInvoices.filter((i) => i.status === "paid").length, [activeInvoices]);
  const expensePendingCount = useMemo(() => activeExpenses.filter((e) => e.status === "pending").length, [activeExpenses]);
  const expensePaidCount = useMemo(() => activeExpenses.filter((e) => e.status === "paid").length, [activeExpenses]);
  const contractPendingCount = useMemo(() => activeContracts.filter((c) => c.status === "pending").length, [activeContracts]);
  const contractSignedCount = useMemo(() => activeContracts.filter((c) => c.status === "signed").length, [activeContracts]);

  const overviewKpis = useMemo(() => {
    const paidInvs = activeInvoices.filter((i) => String(i.status || "").toLowerCase() === "paid");
    const unpaidInvs = activeInvoices.filter((i) => String(i.status || "").toLowerCase() !== "paid");
    const unpaidExps = activeExpenses.filter((e) => String(e.status || "").toLowerCase() !== "paid");
    const today = new Date();
    const overdueInvCount = unpaidInvs.filter((i) => i.due_date && new Date(i.due_date) < today).length;
    const totalPaidRev = paidInvs.reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const pendingRec = unpaidInvs.reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const pendingPay = unpaidExps.reduce((s, e) => s + Number(e.price || e.total_amount || 0), 0);
    function dmc(items) {
      const m = new Set();
      items.forEach((i) => {
        const d = new Date(i.created_at || i.updated_at || i.issued_at || "");
        if (Number.isFinite(d.getTime())) m.add(`${d.getFullYear()}-${d.getMonth()}`);
      });
      return Math.max(1, m.size);
    }
    const monthlyRev = paidInvs.length ? totalPaidRev / dmc(paidInvs) : 0;
    return { totalPaidRev, pendingRec, pendingPay, monthlyRev, overdueInvCount };
  }, [activeInvoices, activeExpenses]);

  const financialReportRows = useMemo(() => {
    const paidInvs = activeInvoices.filter(i => String(i.status || "").toLowerCase() === "paid");
    const paidExps = expenses.filter(e => String(e.status || "").toLowerCase() === "paid");
    function dmc(items) {
      const s = new Set();
      for (const item of items) {
        const raw = item?.created_at || item?.updated_at || item?.issued_at;
        if (!raw) continue;
        const d = new Date(raw);
        if (Number.isFinite(d.getTime())) s.add(`${d.getFullYear()}-${d.getMonth()}`);
      }
      return Math.max(1, s.size);
    }
    const totalPaidRev = paidInvs.reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const totalPaidCos = paidInvs.reduce((s, i) => s + Number(i.cost_of_sales || 0), 0);
    const totalPaidExp = paidExps.reduce((s, e) => s + Number(e.price || e.total_amount || 0), 0);
    const monthlyRevenue = totalPaidRev / dmc(paidInvs);
    const monthlyCos = totalPaidCos / dmc(paidInvs);
    const monthlyExp = totalPaidExp / dmc(paidExps);
    const grossMargin = monthlyRevenue > 0 ? (((monthlyRevenue - monthlyCos) / monthlyRevenue) * 100).toFixed(1) : null;
    const pendingReceivablesTotal = activeInvoices.filter(i => String(i.status || "").toLowerCase() !== "paid").reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const pendingPayablesTotal = expenses.filter(e => String(e.status || "").toLowerCase() !== "paid").reduce((s, e) => s + Number(e.price || e.total_amount || 0), 0);
    const kpiTiles = [
      { label: "Monthly run rate", value: formatMoney(monthlyRevenue) },
      { label: "Gross margin", value: grossMargin != null ? `${grossMargin}%` : "—" },
      { label: "Pending receivables", value: formatMoney(pendingReceivablesTotal) },
      { label: "Pending payables", value: formatMoney(pendingPayablesTotal) },
    ];
    const invoiceListRaw = [...activeInvoices].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,30).map(inv=>({customer:inv.customer_name||"—",items:Array.isArray(inv.product_names)&&inv.product_names.length?inv.product_names.join(", "):inv.product_name||"—",amount:formatMoney(Number(inv.total_amount||0)),due:inv.due_date?new Date(inv.due_date).toLocaleDateString():inv.issued_at?new Date(inv.issued_at).toLocaleDateString():"—",status:String(inv.status||"pending")}));
    const quoteListRaw = [...activeQuotes].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,20).map(q=>({customer:q.customer_name||"—",items:Array.isArray(q.product_names)&&q.product_names.length?q.product_names.join(", "):q.product_name||"—",amount:formatMoney(Number(q.total_amount||q.subtotal_amount||0)),validity:q.validity_days?`${q.validity_days}d`:"—",status:String(q.status||"draft")}));
    const expenseListRaw = [...expenses].sort((a,b)=>new Date(b.created_at||b.updated_at||0)-new Date(a.created_at||a.updated_at||0)).slice(0,20).map(e=>({vendor:e.vendor_name||e.counterparty_name||"—",description:e.description||e.expense_type||e.item||"—",amount:formatMoney(Number(e.price||e.total_amount||0)),due:e.due_date?new Date(e.due_date).toLocaleDateString():"—",status:String(e.status||"pending")}));
    const contractListRaw = [...activeContracts].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).map(c=>({counterparty:c.counterparty_name||"—",type:c.contract_type||"—",price:formatMoney(Number(c.price||0)),cos:formatMoney(Number(c.cost_of_sales||0)),terms:c.payment_terms||"—",status:String(c.status||"active")}));
    return { kpiTiles, invoiceListRaw, quoteListRaw, expenseListRaw, contractListRaw, monthlyExp };
  }, [activeInvoices, activeQuotes, activeContracts, expenses]); // eslint-disable-line

  const hasArchiveWarning = useMemo(() => {
    const list = [...archivedInvoices, ...archivedQuotes, ...archivedExpenses, ...archivedContracts];
    return list.some((item) => daysSince(item.archived_at || item.updated_at || item.created_at) >= ARCHIVE_WARNING_DAYS);
  }, [archivedInvoices, archivedQuotes, archivedExpenses, archivedContracts]);

  const integrationMeta = {
    quickbooks: { label: "QuickBooks", note: "Sync invoices, payments, and chart of accounts." },
    sap: { label: "SAP", note: "Connect enterprise finance workflows." },
    zoho_books: { label: "Zoho Books", note: "Bring invoice and expense data into EnterprateAI." },
    zoho_crm: { label: "Zoho CRM", note: "Sync contacts and deal pipelines." },
    hubspot: { label: "HubSpot", note: "Import CRM records and lifecycle stages." },
    salesforce: { label: "Salesforce", note: "Connect accounts, opportunities, and stages." }
  };

  function statusBadge(status) {
    if (status === "connected") return { label: "Connected", tone: "emerald" };
    if (status === "pending") return { label: "Pending", tone: "amber" };
    return { label: "Not connected", tone: "slate" };
  }

  function IntegrationLogo({ type }) {
    const icons = {
      quickbooks: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#2CA01C"/>
          <circle cx="16" cy="18" r="6" fill="none" stroke="white" strokeWidth="2.5"/>
          <path d="M22 18h6M25 15v6" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      ),
      sap: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#009EDB"/>
          <text x="18" y="23" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" fontFamily="Arial, sans-serif" letterSpacing="1">SAP</text>
        </svg>
      ),
      zoho_books: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#E05C00"/>
          <text x="18" y="25" textAnchor="middle" fill="white" fontSize="17" fontWeight="bold" fontFamily="Arial, sans-serif">Z</text>
        </svg>
      ),
      zoho_crm: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#E42527"/>
          <text x="18" y="25" textAnchor="middle" fill="white" fontSize="17" fontWeight="bold" fontFamily="Arial, sans-serif">Z</text>
        </svg>
      ),
      hubspot: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#FF7A59"/>
          <circle cx="18" cy="13" r="4" fill="white"/>
          <rect x="16.5" y="17" width="3" height="5" rx="1.5" fill="white"/>
          <circle cx="25" cy="24" r="2.5" fill="white" opacity="0.85"/>
          <circle cx="11" cy="24" r="2.5" fill="white" opacity="0.85"/>
          <line x1="18" y1="19" x2="25" y2="24" stroke="white" strokeWidth="1.5"/>
          <line x1="18" y1="19" x2="11" y2="24" stroke="white" strokeWidth="1.5"/>
        </svg>
      ),
      salesforce: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#00A1E0"/>
          <path d="M9 23c0-2.8 1.8-5 4.5-5 .4 0 .8.1 1.1.2C15.3 16 17.3 14 20 14c1.8 0 3.4.8 4.5 2.1A4 4 0 0128 20.5a3.5 3.5 0 01-3.5 3.5H11a2 2 0 01-2-1z" fill="white"/>
        </svg>
      ),
    };
    const icon = icons[type];
    if (icon) return icon;
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-xs font-semibold text-slate-600">
        {String(type || "IN").slice(0, 2).toUpperCase()}
      </div>
    );
  }

  async function updateIntegration(section, key) {
    const current = integrations?.[section]?.[key] || "not_connected";
    const nextStatus = current === "connected" ? "not_connected" : "connected";
    const next = {
      ...integrations,
      [section]: { ...integrations[section], [key]: nextStatus }
    };
    setIntegrations(next);
    await persistIntegrations(next);
  }

  function getProductPrice(product) {
    if (!product) return 0;
    const base = Number(product.base_price || 0);
    const discount = Number(product.discount || 0);
    const freight = Number(product.freight_cost || 0);
    return Math.max(0, base - discount + freight);
  }

  function getProductDefaultCost(product) {
    return getProductCostOfSales(product);
  }

  function formatMoney(value) {
    return formatCurrency(Number(value || 0), currency || "GBP");
  }

  function formatPaymentTerms(value) {
    const str = String(value || "").trim();
    const num = parseInt(str, 10);
    if (str && Number.isFinite(num) && String(num) === str) return `${num} days`;
    return str || "Payment terms";
  }

  function renderDocBranding(subtitle) {
    const logoSrc = workspaceLogo && String(workspaceLogo).trim() ? workspaceLogo : null;
    return `
      <div class="brand-block">
        ${logoSrc ? `<img src="${logoSrc}" alt="Company logo" />` : ""}
        <h2>${workspaceName || "EnterprateAI"}</h2>
        <div class="muted">${subtitle}</div>
      </div>
    `;
  }


  function matchByName(list, value) {
    const needle = String(value || "").trim().toLowerCase();
    if (!needle) return null;
    return list.find((item) => String(item?.name || "").trim().toLowerCase() === needle) || null;
  }

  function resolveCustomer(ref, fallbackName) {
    if (!ref) return null;
    return activeCustomers.find((c) => c.id === ref) || matchByName(activeCustomers, ref) || (fallbackName ? { name: fallbackName } : null);
  }

  function resolveVendor(ref, fallbackName) {
    if (!ref) return null;
    return activeVendors.find((v) => v.id === ref) || matchByName(activeVendors, ref) || (fallbackName ? { name: fallbackName } : null);
  }

  function resolveProduct(ref, fallbackName) {
    if (!ref) return null;
    return activeProducts.find((p) => p.id === ref) || matchByName(activeProducts, ref) || (fallbackName ? { name: fallbackName } : null);
  }

  function resolveProducts(refs, fallbackNames = []) {
    const ids = Array.isArray(refs) ? refs : refs ? [refs] : [];
    const resolved = ids.map((ref) => resolveProduct(ref)).filter(Boolean);
    if (resolved.length) return resolved;
    return (Array.isArray(fallbackNames) ? fallbackNames : [])
      .map((name) => resolveProduct(name, name))
      .filter(Boolean);
  }

  function buildSelectedProductItems(productIds, quantity, unitPriceOverride, unitCostOverride) {
    const selectedProducts = resolveProducts(productIds);
    return selectedProducts.map((product) => ({
      product_id: product.id,
      product_name: product.name,
      quantity,
      unit_price: unitPriceOverride !== "" ? Number(unitPriceOverride || 0) : Number(getProductPrice(product)),
      unit_cost_of_sales: unitCostOverride !== "" ? Number(unitCostOverride || 0) : Number(getProductDefaultCost(product)),
    }));
  }

  function syncProductLineItems(selectedIds, existingItems = []) {
    return selectedIds.map((id) => {
      if (id === OTHER_PRODUCT_ID) {
        const existing = existingItems.find((item) => item?.product_id === OTHER_PRODUCT_ID);
        return {
          product_id: OTHER_PRODUCT_ID,
          product_name: existing?.product_name || "",
          quantity: Number(existing?.quantity || 1),
          unit_price: existing?.unit_price != null ? Number(existing.unit_price) : 0,
          unit_cost_of_sales: existing?.unit_cost_of_sales != null ? Number(existing.unit_cost_of_sales) : 0,
        };
      }
      const product = resolveProducts([id])[0];
      if (!product) return null;
      const existing = existingItems.find((item) => item?.product_id === id);
      return {
        product_id: product.id,
        product_name: product.name,
        quantity: Number(existing?.quantity || 1),
        unit_price: existing?.unit_price != null ? Number(existing.unit_price) : Number(getProductPrice(product)),
        unit_cost_of_sales: existing?.unit_cost_of_sales != null ? Number(existing.unit_cost_of_sales) : Number(getProductDefaultCost(product)),
      };
    }).filter(Boolean);
  }

  function normalizeRecordItems(record) {
    if (Array.isArray(record?.items) && record.items.length) {
      return record.items.map((item) => ({
        product_id: item?.product_id || "",
        product_name: item?.product_name || "Product / Service",
        quantity: Number(item?.quantity || 1),
        unit_price: Number(item?.unit_price || 0),
        unit_cost_of_sales: Number(item?.unit_cost_of_sales || 0),
      }));
    }
    const productIds = Array.isArray(record?.product_ids) && record.product_ids.length
      ? record.product_ids
      : record?.product_id
        ? [record.product_id]
        : [];
    return buildSelectedProductItems(
      productIds,
      Number(record?.quantity || 1) || 1,
      record?.unit_price ?? "",
      record?.unit_cost_of_sales ?? ""
    );
  }

  function sumLineItemQuantity(items = []) {
    return items.reduce((sum, item) => sum + Math.max(0, Number(item?.quantity || 0)), 0);
  }

  function summariseProductNames(record) {
    if (Array.isArray(record?.product_names) && record.product_names.length) return record.product_names.join(", ");
    if (record?.product_name) return record.product_name;
    return "Product / Service";
  }

  function getDocumentGrandTotal(record) {
    const subtotal = Number(record?.subtotal_amount || 0);
    const costOfSales = Number(record?.cost_of_sales || 0);
    return Number((subtotal + costOfSales).toFixed(2));
  }

  function renderShareStatus(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (!normalized || normalized === "pending" || normalized === "draft") return "";
    return `
      <div class="muted" style="margin-top:8px;">Status</div>
      <div>${normalized === "paid" ? "paid" : normalized}</div>
    `;
  }

  function buildInvoiceHtml(invoice, customer, product) {
    const subtotal = Number(invoice?.subtotal_amount || 0);
    const grandTotal = getDocumentGrandTotal(invoice);
    const items = Array.isArray(invoice?.items) && invoice.items.length
      ? invoice.items
      : [{
          product_name: product?.name || invoice?.product_name || "Product / Service",
          quantity: invoice?.quantity || 0,
          unit_price: invoice?.unit_price || 0,
          subtotal_amount: subtotal,
        }];
    const invoiceDisplayId = invoice?.invoice_id || (invoice?.id ? `INV-${invoice.id.substring(0, 8).toUpperCase()}` : "");
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Invoice ${invoiceDisplayId}</title>
  <style>
    *{color:#0f172a !important;}
    body{font-family:Inter, Arial, sans-serif; background:#ffffff; padding:32px; font-size:14px; line-height:1.5; -webkit-font-smoothing:antialiased;}
    .header{display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;}
    .brand-block{text-align:left;}
    .brand-block img{display:block; max-width:180px; max-height:72px; width:auto; height:auto; object-fit:contain; object-position:left center; margin:0 0 14px 0;}
    .brand-block h2{margin:0 0 4px;}
    .muted{color:#1f2937; font-size:12px;}
    .card{border:1px solid #e2e8f0; border-radius:12px; padding:16px; margin-top:16px;}
    table{width:100%; border-collapse:collapse; margin-top:16px;}
    th,td{border-bottom:1px solid #e2e8f0; padding:10px; text-align:left; font-size:13px;}
    th{text-transform:uppercase; letter-spacing:.05em; font-size:11px; color:#64748b;}
    .right{text-align:right;}
    @media(max-width:600px){
      body{padding:16px;}
      th,td{padding:8px 6px; font-size:11px;}
      .right{text-align:left;}
    }
  </style>
</head>
<body>
  <div class="header">
    ${renderDocBranding("Invoice")}
      <div class="right">
        <div class="muted">Invoice ID</div>
        <div>${invoiceDisplayId}</div>
        ${renderShareStatus(invoice?.status)}
    </div>
  </div>
  <div class="card">
    <div class="muted">Bill to</div>
    <div><strong>${customer?.name || "Customer"}</strong></div>
    ${customer?.address ? `<div class="muted">${customer.address}</div>` : ""}
    <div class="muted" style="margin-top:6px;">Payment terms: ${formatPaymentTerms(customer?.payment_terms)}</div>
    ${invoice?.due_date ? `<div class="muted" style="margin-top:6px;">Due date: ${new Date(invoice.due_date).toLocaleDateString()}</div>` : ""}
  </div>
  <table>
    <thead>
      <tr><th>Item</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Subtotal</th></tr>
    </thead>
    <tbody>
      ${items.map((item) => `
      <tr>
        <td>${item?.product_name || "Product / Service"}</td>
        <td class="right">${item?.quantity || 0}</td>
        <td class="right">${formatMoney(item?.unit_price || 0)}</td>
        <td class="right"><strong>${formatMoney(item?.subtotal_amount || ((Number(item?.unit_price || 0) * Number(item?.quantity || 0))))}</strong></td>
      </tr>
      `).join("")}
    </tbody>
  </table>
  <div class="card">
    <div style="display:flex; justify-content:space-between; gap:12px;"><span>Grand Total</span><strong>${formatMoney(grandTotal)}</strong></div>
  </div>
  <div class="muted" style="margin-top:16px;">Thank you for your business.</div>
</body>
</html>`;
  }

  function buildQuoteHtml(quote, customer, product) {
    const subtotal = Number(quote?.subtotal_amount || 0);
    const grandTotal = getDocumentGrandTotal(quote);
    const items = Array.isArray(quote?.items) && quote.items.length
      ? quote.items
      : [{
          product_name: product?.name || quote?.product_name || "Product / Service",
          quantity: quote?.quantity || 0,
          unit_price: quote?.unit_price || 0,
          subtotal_amount: subtotal,
        }];
    const quoteDisplayId = quote?.quotation_id || (quote?.id ? `QUO-${quote.id.substring(0, 8).toUpperCase()}` : "");
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Quotation ${quoteDisplayId}</title>
  <style>
    *{color:#0f172a !important;}
    body{font-family:Inter, Arial, sans-serif; background:#ffffff; padding:32px; font-size:14px; line-height:1.5; -webkit-font-smoothing:antialiased;}
    .header{display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;}
    .brand-block{text-align:left;}
    .brand-block img{display:block; max-width:180px; max-height:72px; width:auto; height:auto; object-fit:contain; object-position:left center; margin:0 0 14px 0;}
    .brand-block h2{margin:0 0 4px;}
    .muted{color:#1f2937; font-size:12px;}
    .card{border:1px solid #e2e8f0; border-radius:12px; padding:16px; margin-top:16px;}
    table{width:100%; border-collapse:collapse; margin-top:16px;}
    th,td{border-bottom:1px solid #e2e8f0; padding:10px; text-align:left; font-size:13px;}
    th{text-transform:uppercase; letter-spacing:.05em; font-size:11px; color:#64748b;}
    .right{text-align:right;}
    @media(max-width:600px){
      body{padding:16px;}
      th,td{padding:8px 6px; font-size:11px;}
      .right{text-align:left;}
    }
  </style>
</head>
<body>
  <div class="header">
    ${renderDocBranding("Sales quotation")}
      <div class="right">
        <div class="muted">Quotation ID</div>
        <div>${quoteDisplayId}</div>
        ${renderShareStatus(quote?.status)}
    </div>
  </div>
  <div class="card">
    <div class="muted">Prepared for</div>
    <div><strong>${customer?.name || "Customer"}</strong></div>
    ${customer?.address ? `<div class="muted">${customer.address}</div>` : ""}
    <div class="muted" style="margin-top:6px;">Payment terms: ${formatPaymentTerms(customer?.payment_terms)}</div>
    ${quote?.due_date ? `<div class="muted" style="margin-top:6px;">Due date: ${new Date(quote.due_date).toLocaleDateString()}</div>` : ""}
  </div>
  <table>
    <thead>
      <tr><th>Item</th><th class="right">Qty</th><th class="right">Unit Cost</th><th class="right">Subtotal</th></tr>
    </thead>
    <tbody>
      ${items.map((item) => {
        const unitCost = Number(item?.unit_price || 0) + Number(item?.unit_cost_of_sales || 0);
        const lineTotal = unitCost * Number(item?.quantity || 0);
        return `
      <tr>
        <td>${item?.product_name || "Product / Service"}</td>
        <td class="right">${item?.quantity || 0}</td>
        <td class="right">${formatMoney(unitCost)}</td>
        <td class="right"><strong>${formatMoney(lineTotal)}</strong></td>
      </tr>`;
      }).join("")}
    </tbody>
  </table>
  <div class="card">
    <div style="display:flex; justify-content:space-between; gap:12px;"><span>Grand Total</span><strong>${formatMoney(grandTotal)}</strong></div>
  </div>
  <div class="muted" style="margin-top:16px;">This quotation is valid for ${quote?.validity_days || 30} days unless otherwise stated.</div>
</body>
</html>`;
  }

  function buildFinancialShareText(kind, record, customer, product) {
    const isInvoice = kind === "invoice";
    const reference = isInvoice
      ? record?.invoice_id || record?.id || "Draft invoice"
      : record?.quotation_id || record?.id || "Draft quotation";
    const grandTotal = getDocumentGrandTotal(record);
    const itemName = summariseProductNames(record) || product?.name || "Product / Service";
    return [
      `${isInvoice ? "Invoice" : "Quotation"} ${reference}`,
      `Customer: ${customer?.name || "Customer"}`,
      `Items: ${itemName}`,
      `Quantity: ${record?.quantity || 0}`,
      `Grand total: ${formatMoney(grandTotal)}`,
      `Status: ${record?.status || (isInvoice ? "pending" : "draft")}`,
      ...(record?.due_date ? [`Due date: ${new Date(record.due_date).toLocaleDateString()}`] : []),
    ].join("\n");
  }

  async function downloadPdfFile(html, filename) {
    try {
      const container = document.createElement("div");
      container.innerHTML = html;
      container.style.width = "210mm";
      container.style.padding = "12mm";
      container.style.boxSizing = "border-box";
      container.style.fontSize = "14px";
      container.style.lineHeight = "1.5";
      container.style.color = "#0f172a";
      container.style.background = "#ffffff";
      document.body.appendChild(container);
      await html2pdf()
        .set({
          filename,
          margin: [10, 10, 10, 10],
          pagebreak: { mode: ["css", "legacy", "avoid-all"] },
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: {
            scale: 3,
            useCORS: true,
            windowWidth: 794,
            windowHeight: 1123,
            backgroundColor: "#ffffff",
            letterRendering: true
          },
          jsPDF: { unit: "pt", format: "a4", orientation: "portrait", compress: true }
        })
        .from(container)
        .save();
      document.body.removeChild(container);
    } catch (e) {
      setError("Unable to generate the PDF. Please refresh and try again.");
    }
  }

  function buildFinancialReportHtml({ kpis, invoiceList, quoteList, expenseList, contractList }) {
    const col = (cells) => cells.map((c) => `<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;">${c ?? "—"}</td>`).join("");
    const hdr = (cells) => cells.map((c) => `<th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;border-bottom:2px solid #e2e8f0;text-align:left;">${c}</th>`).join("");
    const table = (headers, rows) => `
      <table style="width:100%;border-collapse:collapse;margin-top:8px;">
        <thead><tr>${hdr(headers)}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${col(r)}</tr>`).join("")}${!rows.length ? `<tr><td colspan="${headers.length}" style="padding:10px;font-size:12px;color:#94a3b8;text-align:center;">No data.</td></tr>` : ""}</tbody>
      </table>`;
    const section = (title, sub, content) => `
      <div style="margin-top:20px;">
        <div style="font-size:14px;font-weight:600;color:#0f172a;">${title}</div>
        ${sub ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${sub}</div>` : ""}
        ${content}
      </div>`;
    const logoSrc = workspaceLogo && String(workspaceLogo).trim() ? workspaceLogo : null;
    return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Financial Report</title>
<style>*{color:#0f172a!important;}body{font-family:Inter,Arial,sans-serif;background:#fff;padding:32px;font-size:13px;line-height:1.5;}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:8px;}
@media(max-width:600px){body{padding:16px;}.kpi-grid{grid-template-columns:repeat(2,1fr);}table{font-size:11px;}th,td{padding:6px 8px;}}</style>
</head><body>
<div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px;">
  <div>
    ${logoSrc ? `<img src="${logoSrc}" style="display:block;max-width:140px;max-height:56px;margin-bottom:10px;"/>` : ""}
    <div style="font-size:20px;font-weight:700;">${workspaceName || "EnterprateAI"}</div>
    <div style="font-size:12px;color:#64748b;">Financial Report</div>
  </div>
  <div style="text-align:right;font-size:11px;color:#64748b;">${new Date().toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"})}</div>
</div>
${kpis !== null ? `<div class="kpi-grid">${kpis.map((k) => `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;"><div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#64748b;">${k.label}</div><div style="font-size:18px;font-weight:700;margin-top:4px;">${k.value}</div></div>`).join("")}</div>` : ""}
${invoiceList !== null ? section("Invoices","All active invoices, paid and pending.",table(["Customer","Items / Services","Amount","Due / Issued","Status"],invoiceList.map((i)=>[i.customer,i.items,i.amount,i.due,i.status]))) : ""}
${quoteList !== null ? section("Quotation pipeline","Active quotes sent or in draft.",table(["Customer","Items","Amount","Valid","Status"],quoteList.map((q)=>[q.customer,q.items,q.amount,q.validity,q.status]))) : ""}
${expenseList !== null ? section("Expenses","Vendor payables.",table(["Vendor","Description","Amount","Due","Status"],expenseList.map((e)=>[e.vendor,e.description,e.amount,e.due,e.status]))) : ""}
${contractList !== null ? section("Contracts","Active contracts and their value.",table(["Counterparty","Type","Price","Cost of sales","Terms","Status"],contractList.map((c)=>[c.counterparty,c.type,c.price,c.cos,c.terms,c.status]))) : ""}
</body></html>`;
  }

  function downloadFinancialReport({ kpis, invoiceList, quoteList, expenseList, contractList }) {
    const html = buildFinancialReportHtml({ kpis, invoiceList, quoteList, expenseList, contractList });
    const filename = `financial-report-${new Date().toISOString().slice(0, 10)}.pdf`;
    downloadPdfFile(html, filename);
  }

  function downloadInvoice(invoice, customer, product) {
    const html = buildInvoiceHtml(invoice, customer, product);
    const filename = `invoice-${invoice?.invoice_id || invoice?.id || "draft"}.pdf`;
    downloadPdfFile(html, filename);
  }

  function downloadQuote(quote, customer, product) {
    const html = buildQuoteHtml(quote, customer, product);
    const filename = `quotation-${quote?.quotation_id || quote?.id || "draft"}.pdf`;
    downloadPdfFile(html, filename);
  }

  async function createFinancialShareLink(kind, record, customer, product, shareConfig = {}) {
    if (!record) return;
    setError(null);
    setShareNotice("Creating link...");
    try {
      const isInvoice = kind === "invoice";
      const titlePrefix = isInvoice ? "Invoice" : "Sales Quotation";
      const shareIdField = "share_document_id";
      const existingDocumentId = record?.[shareIdField] || null;
      let token = null;
      let documentId = existingDocumentId;
      let shareResponse = null;

      {
        const rawHtml = isInvoice ? buildInvoiceHtml(record, customer, product) : buildQuoteHtml(record, customer, product);
        const markdown = buildFinancialShareText(kind, record, customer, product);
        shareResponse = await apiRequest("/blueprint/financial-documents/share", "POST", {
          access_mode: shareConfig.access_mode || "link",
          email: shareConfig.email || null,
          expires_in_days: shareConfig.expires_in_days || 7,
          document_id: existingDocumentId,
          type: isInvoice ? `invoice_template:${record.id}` : `sales_quotation:${record.id}`,
          title: `${titlePrefix} — ${record?.invoice_id || (isInvoice ? `INV-${record?.id?.substring(0,8).toUpperCase()}` : record?.quotation_id || `QUO-${record?.id?.substring(0,8).toUpperCase()}`) || workspaceName || "Document"}`,
          company_name: workspaceName || "EnterprateAI",
          workspace_id: workspaceId || null,
          document_markdown: markdown,
          document_html: rawHtml,
        }, { timeoutMs: 120000 });
        token = shareResponse?.token;
        documentId = shareResponse?.document_id;
      }

      if (!token || !documentId) throw new Error("Share link could not be created.");

      if (documentId !== record?.[shareIdField]) {
        if (isInvoice) {
          const nextInvoices = invoices.map((item) =>
            item.id === record.id ? { ...item, [shareIdField]: documentId } : item
          );
          setInvoices(nextInvoices);
          await persist({ invoices: nextInvoices, quotes, expenses, contracts });
        } else {
          const nextQuotes = quotes.map((item) =>
            item.id === record.id ? { ...item, [shareIdField]: documentId } : item
          );
          setQuotes(nextQuotes);
          await persist({ invoices, quotes: nextQuotes, expenses, contracts });
        }
      }

        const url = `${window.location.origin}/share/${token}`;
        setShareNotice(null);
        return {
          token,
          url,
          emailSent: Boolean(shareResponse?.email_sent),
          emailError: shareResponse?.email_error || "",
        };
    } catch (e) {
      setShareNotice(null);
      const raw = e instanceof Error ? e.message : "";
      if (raw === "NETWORK_ERROR") {
        setError("Cannot reach the server to create a share link. Check that the backend is running, then try again.");
      } else {
        setError(raw || "Share failed.");
      }
      return null;
    }
  }

  async function shareFinancialDocument(kind, record, customer, product, shareConfig) {
    return createFinancialShareLink(kind, record, customer, product, shareConfig);
  }

  async function sendFinancialShareEmail({ token, email }) {
    const res = await apiRequest(`/blueprint/share/${token}/email`, "POST", { email });
    return {
      sent: Boolean(res?.sent),
      error: res?.error || "",
    };
  }

  function addFinancialShareAction(items, kind, record, customer, product) {
    const shareItem = {
      label: "Share",
      onClick: () => {
        setShareDialog({ kind, record, customer, product });
      }
    };
    const deleteIndex = items.findIndex((item) => item?.tone === "danger" || item?.label === "Delete");
    if (deleteIndex === -1) return [...items, shareItem];
    return [...items.slice(0, deleteIndex), shareItem, ...items.slice(deleteIndex)];
  }

  function openShareMenu(event, kind, record, customer, product) {
    const rect = event.currentTarget.getBoundingClientRect();
    setShareMenu({
      key: `${kind}:${record?.id || ""}`,
      kind,
      record,
      customer,
      product,
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right,
    });
  }

  function ShareDropdown({ kind, record, customer, product }) {
    const menuKey = `${kind}:${record?.id || ""}`;
    const isOpen = shareMenu?.key === menuKey;
    return (
      <div>
        <Button
          variant="secondary"
          onClick={(event) => {
            if (isOpen) {
              setShareMenu(null);
              return;
            }
            openShareMenu(event, kind, record, customer, product);
          }}
        >
          Share
        </Button>
      </div>
    );
  }

  function sendInvoice(invoice, customer) {
    const subject = encodeURIComponent(`Invoice ${invoice?.invoice_id || invoice?.id || ""}`);
    const body = encodeURIComponent(
      `Hi ${customer?.name || ""},\n\nPlease find your invoice ${invoice?.invoice_id || invoice?.id || ""} attached. Let us know if you have any questions.\n\nThank you.`
    );
    window.location.href = `mailto:${""}?subject=${subject}&body=${body}`;
  }

  function sendQuote(quote, customer) {
    const subject = encodeURIComponent(`Quotation ${quote?.quotation_id || quote?.id || ""}`);
    const body = encodeURIComponent(
      `Hi ${customer?.name || ""},\n\nPlease find your quotation ${quote?.quotation_id || quote?.id || ""} attached. Let us know if you have any questions.\n\nThank you.`
    );
    window.location.href = `mailto:${""}?subject=${subject}&body=${body}`;
  }

  function resetInvoiceForm() {
    setInvoiceForm({ invoice_id: "", customer_id: "", contract_id: "", product_ids: [], items: [], issued_at: todayInputValue(), due_date: "" });
    setEditingInvoiceId(null);
    setPreviewInvoiceId(null);
    setInvoiceFormError(null);
    setInvoiceSubmitAttempted(false);
  }

  function resetQuoteForm() {
    setQuoteForm({ quotation_id: "", customer_id: "", product_ids: [], items: [], validity_days: "30", issued_at: todayInputValue(), due_date: "" });
    setEditingQuoteId(null);
  }

  function resetExpenseForm() {
    setExpenseForm({ vendor_id: "", item: "", price: "", cost_type: "variable", incurred_at: todayInputValue(), due_date: "" });
    setEditingExpenseId(null);
  }

  function resetContractForm() {
    setContractForm({
      contract_type: "sales",
      counterparty_id: "",
      product_ids: [],
      price: "",
      payment_terms: "",
      discount: "",
      freight: "",
      cost_of_sales: "",
      start_date: todayInputValue(),
      end_date: "",
      due_date: "",
      status: "pending"
    });
    setEditingContractId(null);
  }

  function updateInvoiceSelectedProducts(nextIds) {
    setInvoiceSubmitAttempted(false);
    setInvoiceForm((prev) => ({
      ...prev,
      product_ids: nextIds,
      items: syncProductLineItems(nextIds, Array.isArray(prev.items) ? prev.items : []),
    }));
  }

  function updateQuoteSelectedProducts(nextIds) {
    setQuoteForm((prev) => ({
      ...prev,
      product_ids: nextIds,
      items: syncProductLineItems(nextIds, Array.isArray(prev.items) ? prev.items : []),
    }));
  }

  function coerceItemField(field, value) {
    if (field === "product_name") return value;
    if (field === "quantity") return Math.max(0, Number(value || 0));
    return Number(value || 0);
  }

  function updateInvoiceItem(productId, field, value) {
    setInvoiceForm((prev) => ({
      ...prev,
      items: (Array.isArray(prev.items) ? prev.items : []).map((item) =>
        item.product_id === productId ? { ...item, [field]: coerceItemField(field, value) } : item
      ),
    }));
  }

  function updateQuoteItem(productId, field, value) {
    setQuoteForm((prev) => ({
      ...prev,
      items: (Array.isArray(prev.items) ? prev.items : []).map((item) =>
        item.product_id === productId ? { ...item, [field]: coerceItemField(field, value) } : item
      ),
    }));
  }

  async function upsertInvoice() {
    setInvoiceSubmitAttempted(true);
    setInvoiceFormError(null);
    if (!invoiceForm.customer_id || !Array.isArray(invoiceForm.product_ids) || !invoiceForm.product_ids.length) {
      setInvoiceFormError("Invoice must reference a customer and at least one product or service.");
      return;
    }
    const customer = resolveCustomer(invoiceForm.customer_id);
    const lineItems = syncProductLineItems(invoiceForm.product_ids, Array.isArray(invoiceForm.items) ? invoiceForm.items : []);
    if (!lineItems.length) {
      setInvoiceFormError("Select at least one product or service for this invoice.");
      return;
    }
    if (lineItems.some((item) => !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) {
      setInvoiceFormError("Each selected product or service must have a quantity greater than zero.");
      return;
    }
    if (lineItems.some((item) => item.product_id === OTHER_PRODUCT_ID && !String(item.product_name || "").trim())) {
      setInvoiceFormError("Enter a name for the custom product or service.");
      return;
    }
    const subtotal = Number(lineItems.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0).toFixed(2));
    const totalCostOfSales = Number(lineItems.reduce((sum, item) => sum + (Number(item.unit_cost_of_sales || 0) * Number(item.quantity || 0)), 0).toFixed(2));
    const grandTotal = Number((subtotal + totalCostOfSales).toFixed(2));
    if (invoiceForm.contract_id) {
      const contract = activeContracts.find((c) => c.id === invoiceForm.contract_id);
      if (contract) {
        const remaining = contractRemaining(contract, editingInvoiceId);
        if (subtotal > remaining.price + 0.001) {
          setInvoiceFormError(`Invoice subtotal (${formatMoney(subtotal)}) exceeds the remaining contract price allowance of ${formatMoney(remaining.price)}.`);
          return;
        }
        if (totalCostOfSales > remaining.cost_of_sales + 0.001) {
          setInvoiceFormError(`Invoice cost of sales (${formatMoney(totalCostOfSales)}) exceeds the remaining contract cost-of-sales allowance of ${formatMoney(remaining.cost_of_sales)}.`);
          return;
        }
        if (grandTotal > remaining.total + 0.001) {
          setInvoiceFormError(`Invoice grand total (${formatMoney(grandTotal)}) exceeds the remaining contract balance of ${formatMoney(remaining.total)}. Reduce the amount or unlink the contract.`);
          return;
        }
      }
    }
    const totalQuantity = sumLineItemQuantity(lineItems);
    const next = invoices.map((i) => ({ ...i }));
    const payload = {
      id: editingInvoiceId || crypto.randomUUID(),
      invoice_id: String(invoiceForm.invoice_id || "").trim(),
      customer_id: customer?.id || invoiceForm.customer_id,
      customer_name: customer?.name || String(invoiceForm.customer_id || "").trim(),
      product_id: lineItems[0]?.product_id || invoiceForm.product_ids[0],
      product_ids: lineItems.map((item) => item.product_id),
      product_name: lineItems[0]?.product_name || "Product / Service",
      product_names: lineItems.map((item) => item.product_name),
      items: lineItems,
      quantity: totalQuantity,
      unit_price: lineItems.length === 1 ? Number(Number(lineItems[0]?.unit_price || 0).toFixed(2)) : null,
      unit_cost_of_sales: lineItems.length === 1 ? Number(Number(lineItems[0]?.unit_cost_of_sales || 0).toFixed(2)) : null,
      subtotal_amount: subtotal,
      cost_of_sales: totalCostOfSales,
      total_amount: grandTotal,
      status: editingInvoiceId ? next.find((i) => i.id === editingInvoiceId)?.status || "pending" : "pending",
      issued_at: invoiceForm.issued_at || null,
      due_date: invoiceForm.due_date || null,
      contract_id: invoiceForm.contract_id || null,
      updated_at: new Date().toISOString()
    };
    if (editingInvoiceId) {
      const idx = next.findIndex((i) => i.id === editingInvoiceId);
      if (idx >= 0) next[idx] = { ...next[idx], ...payload };
    } else {
      next.unshift({ ...payload, created_at: new Date().toISOString() });
    }
    setInvoices(next);
    await persist({ invoices: next, quotes, expenses, contracts });
    resetInvoiceForm();
  }

  async function upsertQuote() {
    if (!quoteForm.customer_id || !Array.isArray(quoteForm.product_ids) || !quoteForm.product_ids.length) {
      setError("Quotation must reference a customer and at least one product or service.");
      return;
    }
    setError(null);
    const customer = resolveCustomer(quoteForm.customer_id);
    const lineItems = syncProductLineItems(quoteForm.product_ids, Array.isArray(quoteForm.items) ? quoteForm.items : []);
    if (!lineItems.length) {
      setError("Select at least one product or service for this quotation.");
      return;
    }
    if (lineItems.some((item) => !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) {
      setError("Each selected product or service must have a quantity greater than zero.");
      return;
    }
    if (lineItems.some((item) => item.product_id === OTHER_PRODUCT_ID && !String(item.product_name || "").trim())) {
      setError("Enter a name for the custom product or service.");
      return;
    }
    const subtotal = Number(lineItems.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0).toFixed(2));
    const totalCostOfSales = Number(lineItems.reduce((sum, item) => sum + (Number(item.unit_cost_of_sales || 0) * Number(item.quantity || 0)), 0).toFixed(2));
    const grandTotal = Number((subtotal + totalCostOfSales).toFixed(2));
    const validity = Math.max(1, parseInt(String(quoteForm.validity_days || "30"), 10) || 30);
    const totalQuantity = sumLineItemQuantity(lineItems);
    const next = quotes.map((q) => ({ ...q }));
    const payload = {
      id: editingQuoteId || crypto.randomUUID(),
      quotation_id: String(quoteForm.quotation_id || "").trim(),
      customer_id: customer?.id || quoteForm.customer_id,
      customer_name: customer?.name || String(quoteForm.customer_id || "").trim(),
      product_id: lineItems[0]?.product_id || quoteForm.product_ids[0],
      product_ids: lineItems.map((item) => item.product_id),
      product_name: lineItems[0]?.product_name || "Product / Service",
      product_names: lineItems.map((item) => item.product_name),
      items: lineItems,
      quantity: totalQuantity,
      unit_price: lineItems.length === 1 ? Number(Number(lineItems[0]?.unit_price || 0).toFixed(2)) : null,
      unit_cost_of_sales: lineItems.length === 1 ? Number(Number(lineItems[0]?.unit_cost_of_sales || 0).toFixed(2)) : null,
      subtotal_amount: subtotal,
      cost_of_sales: totalCostOfSales,
      total_amount: grandTotal,
      validity_days: validity,
      status: editingQuoteId ? next.find((q) => q.id === editingQuoteId)?.status || "draft" : "draft",
      issued_at: quoteForm.issued_at || null,
      due_date: quoteForm.due_date || null,
      updated_at: new Date().toISOString()
    };
    if (editingQuoteId) {
      const idx = next.findIndex((q) => q.id === editingQuoteId);
      if (idx >= 0) next[idx] = { ...next[idx], ...payload };
    } else {
      next.unshift({ ...payload, created_at: new Date().toISOString() });
    }
    setQuotes(next);
    await persist({ invoices, quotes: next, expenses, contracts });
    resetQuoteForm();
  }

  async function upsertExpense() {
    if (!expenseForm.vendor_id || !expenseForm.item.trim()) {
      setError("Expense must reference a vendor and item.");
      return;
    }
    const price = Number(expenseForm.price || 0);
    if (!Number.isFinite(price) || price <= 0) {
      setError("Expense price must be a positive number.");
      return;
    }
    setError(null);
    const vendor = resolveVendor(expenseForm.vendor_id);
    const next = expenses.map((e) => ({ ...e }));
    const payload = {
      id: editingExpenseId || crypto.randomUUID(),
      vendor_id: vendor?.id || expenseForm.vendor_id,
      vendor_name: vendor?.name || String(expenseForm.vendor_id || "").trim(),
      item: expenseForm.item.trim(),
      price: Number(price.toFixed(2)),
      cost_type: expenseForm.cost_type,
      status: editingExpenseId ? next.find((e) => e.id === editingExpenseId)?.status || "pending" : "pending",
      incurred_at: expenseForm.incurred_at || null,
      due_date: expenseForm.due_date || null,
      updated_at: new Date().toISOString()
    };
    if (editingExpenseId) {
      const idx = next.findIndex((e) => e.id === editingExpenseId);
      if (idx >= 0) next[idx] = { ...next[idx], ...payload };
    } else {
      next.unshift({ ...payload, created_at: new Date().toISOString() });
    }
    setExpenses(next);
    await persist({ invoices, quotes, expenses: next, contracts });
    resetExpenseForm();
  }

  async function upsertContract() {
    if (!contractForm.counterparty_id || !Array.isArray(contractForm.product_ids) || !contractForm.product_ids.length) {
      setError("Contract must reference a customer/vendor and at least one product or service.");
      return;
    }
    const party =
      contractForm.contract_type === "sales"
        ? resolveCustomer(contractForm.counterparty_id)
        : resolveVendor(contractForm.counterparty_id);
    const selectedProducts = resolveProducts(contractForm.product_ids);
    const defaultPrice = selectedProducts.reduce((sum, product) => sum + getProductPrice(product), 0);
    const defaultCostOfSales = selectedProducts.reduce((sum, product) => sum + getProductDefaultCost(product), 0);
    const rawPrice = contractForm.price !== "" ? Number(contractForm.price) : defaultPrice;
    const rawCostOfSales = contractForm.cost_of_sales !== "" ? Number(contractForm.cost_of_sales) : defaultCostOfSales;
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
      setError("Contract price must be a positive number.");
      return;
    }
    setError(null);
    const next = contracts.map((c) => ({ ...c }));
    const payload = {
      id: editingContractId || crypto.randomUUID(),
      contract_type: contractForm.contract_type,
      counterparty_id: party?.id || contractForm.counterparty_id,
      counterparty_name: party?.name || String(contractForm.counterparty_id || "").trim(),
      product_id: selectedProducts[0]?.id || contractForm.product_ids[0],
      product_ids: selectedProducts.map((product) => product.id),
      product_name: selectedProducts[0]?.name || "Product / Service",
      product_names: selectedProducts.map((product) => product.name),
      price: Number(rawPrice.toFixed(2)),
      cost_of_sales: Number((Number.isFinite(rawCostOfSales) ? rawCostOfSales : 0).toFixed(2)),
      payment_terms: contractForm.payment_terms || "",
      discount: Number(contractForm.discount || 0),
      freight: Number(contractForm.freight || 0),
      start_date: contractForm.start_date || null,
      end_date: contractForm.end_date || null,
      due_date: contractForm.due_date || null,
      status: editingContractId ? next.find((c) => c.id === editingContractId)?.status || "pending" : "pending",
      updated_at: new Date().toISOString()
    };
    if (editingContractId) {
      const idx = next.findIndex((c) => c.id === editingContractId);
      if (idx >= 0) next[idx] = { ...next[idx], ...payload };
    } else {
      next.unshift({ ...payload, created_at: new Date().toISOString() });
    }
    setContracts(next);
    await persist({ invoices, quotes, expenses, contracts: next });
    resetContractForm();
  }

  async function updateStatus(type, id, status) {
    if (type === "invoice") {
      const next = invoices.map((i) =>
        i.id === id ? { ...i, status, paid_at: status === "paid" ? new Date().toISOString() : null } : i
      );
      setInvoices(next);
      await persist({ invoices: next, quotes, expenses, contracts });
    }
    if (type === "expense") {
      const next = expenses.map((e) =>
        e.id === id ? { ...e, status, paid_at: status === "paid" ? new Date().toISOString() : null } : e
      );
      setExpenses(next);
      await persist({ invoices, quotes, expenses: next, contracts });
    }
    if (type === "contract") {
      const next = contracts.map((c) =>
        c.id === id ? { ...c, status, signed_at: status === "signed" ? new Date().toISOString() : null } : c
      );
      setContracts(next);
      await persist({ invoices, quotes, expenses, contracts: next });
    }
    if (type === "quote") {
      const next = quotes.map((q) => (q.id === id ? { ...q, status } : q));
      setQuotes(next);
      await persist({ invoices, quotes: next, expenses, contracts });
    }
  }

  async function archiveItem(type, id) {
    if (type === "invoice") {
      const next = invoices.map((i) =>
        i.id === id ? { ...i, archived: true, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() } : i
      );
      setInvoices(next);
      await persist({ invoices: next, quotes, expenses, contracts });
    }
    if (type === "quote") {
      const next = quotes.map((q) =>
        q.id === id ? { ...q, archived: true, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() } : q
      );
      setQuotes(next);
      await persist({ invoices, quotes: next, expenses, contracts });
    }
    if (type === "expense") {
      const next = expenses.map((e) =>
        e.id === id ? { ...e, archived: true, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() } : e
      );
      setExpenses(next);
      await persist({ invoices, quotes, expenses: next, contracts });
    }
    if (type === "contract") {
      const next = contracts.map((c) =>
        c.id === id ? { ...c, archived: true, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() } : c
      );
      setContracts(next);
      await persist({ invoices, quotes, expenses, contracts: next });
    }
  }

  async function restoreItem(type, id) {
    if (type === "invoice") {
      const next = invoices.map((i) =>
        i.id === id ? { ...i, archived: false, archived_at: null, updated_at: new Date().toISOString() } : i
      );
      setInvoices(next);
      await persist({ invoices: next, quotes, expenses, contracts });
    }
    if (type === "quote") {
      const next = quotes.map((q) =>
        q.id === id ? { ...q, archived: false, archived_at: null, updated_at: new Date().toISOString() } : q
      );
      setQuotes(next);
      await persist({ invoices, quotes: next, expenses, contracts });
    }
    if (type === "expense") {
      const next = expenses.map((e) =>
        e.id === id ? { ...e, archived: false, archived_at: null, updated_at: new Date().toISOString() } : e
      );
      setExpenses(next);
      await persist({ invoices, quotes, expenses: next, contracts });
    }
    if (type === "contract") {
      const next = contracts.map((c) =>
        c.id === id ? { ...c, archived: false, archived_at: null, updated_at: new Date().toISOString() } : c
      );
      setContracts(next);
      await persist({ invoices, quotes, expenses, contracts: next });
    }
  }

  async function deleteItem(type, id) {
    if (type === "invoice") {
      const next = invoices.filter((i) => i.id !== id);
      setInvoices(next);
      await persist({ invoices: next, quotes, expenses, contracts });
    }
    if (type === "quote") {
      const next = quotes.filter((q) => q.id !== id);
      setQuotes(next);
      await persist({ invoices, quotes: next, expenses, contracts });
    }
    if (type === "expense") {
      const next = expenses.filter((e) => e.id !== id);
      setExpenses(next);
      await persist({ invoices, quotes, expenses: next, contracts });
    }
    if (type === "contract") {
      const next = contracts.filter((c) => c.id !== id);
      setContracts(next);
      await persist({ invoices, quotes, expenses, contracts: next });
    }
  }

  function openRfqApproveModal(rfq) {
    const items = (rfq.items || []).map((item) => ({
      product_name: item.name || "Item",
      quantity: Math.max(1, Number(item.quantity) || 1),
      unit_price: 0,
      unit_cost_of_sales: 0,
    }));
    setRfqApproveModal({ rfq, items, validityDays: 30 });
  }

  async function approveRfq(rfqId, itemPrices, validityDays = 30) {
    setError(null);
    try {
      const result = await apiRequest(`/marketplace/rfq/${rfqId}/approve`, "POST", {
        validity_days: validityDays,
        item_prices: itemPrices || undefined,
      });
      const { rfq, quote, workspace_id: wsId, company_name } = result;
      setRfqRequests((prev) => prev.map((r) => r.id === rfqId ? rfq : r));
      setQuotes((prev) => [quote, ...prev.filter((q) => q.id !== quote.id)]);
      // Build PDF HTML and send share link to customer
      const customer = { name: rfq.customer_name };
      const quoteHtml = buildRfqQuoteHtml(quote, customer, company_name);
      const shareTitle = `Quotation ${quote.quotation_id || quote.id} — ${company_name}`;
      const shareRes = await apiRequest("/blueprint/financial-documents/share", "POST", {
        access_mode: "email",
        email: rfq.customer_email,
        expires_in_days: 30,
        type: `quotation_acceptance::${wsId}::${rfqId}::${quote.id}`,
        title: shareTitle,
        company_name: company_name || workspaceName || "Business",
        workspace_id: wsId || workspaceId,
        document_html: quoteHtml,
        document_markdown: "",
      }, { timeoutMs: 120000 });
      if (shareRes?.token) {
        const nextQuotes = quotes.map((q) => q.id === quote.id ? { ...q, share_document_id: shareRes.document_id, share_token: shareRes.token } : q);
        setQuotes(nextQuotes);
        await persist({ invoices, quotes: nextQuotes, expenses, contracts });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve RFQ.");
    }
  }

  async function rejectRfq(rfqId) {
    setError(null);
    try {
      const rfq = await apiRequest(`/marketplace/rfq/${rfqId}/reject`, "POST", {});
      setRfqRequests((prev) => prev.map((r) => r.id === rfqId ? rfq : r));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reject RFQ.");
    }
  }

  async function deleteRfq(rfqId) {
    setError(null);
    try {
      await apiRequest(`/marketplace/rfq/${rfqId}`, "DELETE");
      setRfqRequests((prev) => prev.filter((r) => r.id !== rfqId));
      await persist({ invoices, quotes, expenses, contracts });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete RFQ.");
    }
  }

  function buildRfqQuoteHtml(quote, customer, companyName) {
    const items = Array.isArray(quote.items) && quote.items.length ? quote.items : [];
    const subtotal = Number(quote.subtotal_amount || 0);
    const grandTotal = subtotal || Number(quote.total_amount || 0);
    const validUntil = quote.validity_days ? (() => { const d = new Date(); d.setDate(d.getDate() + quote.validity_days); return d.toLocaleDateString(); })() : "";
    const logoSrc = workspaceLogo && String(workspaceLogo).trim() ? workspaceLogo : null;
    const rfqDisplayId = quote.quotation_id || (quote.id ? `QUO-${quote.id.substring(0, 8).toUpperCase()}` : "");
    return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Quotation ${rfqDisplayId}</title>
<style>*{color:#0f172a !important;}body{font-family:Inter,Arial,sans-serif;background:#fff;padding:32px;font-size:14px;line-height:1.5;}
.header{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;}
.brand-block img{display:block;max-width:160px;max-height:60px;margin:0 0 12px;}
.brand-block h2{margin:0 0 4px;}
.muted{color:#1f2937;font-size:12px;}
.card{border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-top:16px;}
table{width:100%;border-collapse:collapse;margin-top:16px;}
th,td{border-bottom:1px solid #e2e8f0;padding:10px;text-align:left;font-size:13px;}
th{text-transform:uppercase;letter-spacing:.05em;font-size:11px;color:#64748b;}
.right{text-align:right;}
.actions{margin-top:28px;display:flex;gap:12px;flex-wrap:wrap;}
.btn{display:inline-block;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none;cursor:pointer;}
.btn-accept{background:#16a34a;color:#fff !important;}
.btn-reject{background:#f1f5f9;color:#374151 !important;border:1px solid #e2e8f0;}
@media(max-width:600px){body{padding:16px;}th,td{padding:8px 6px;font-size:11px;}.right{text-align:left;}.btn{padding:10px 20px;font-size:13px;}}
</style></head><body>
<div class="header">
  <div class="brand-block">
    ${logoSrc ? `<img src="${logoSrc}" alt="${companyName}"/>` : ""}
    <h2>${companyName || workspaceName || "Business"}</h2>
    <div class="muted">Sales Quotation</div>
  </div>
  <div class="right">
    <div class="muted">Quotation ID</div>
    <div>${rfqDisplayId}</div>
    ${quote.issued_at ? `<div class="muted" style="margin-top:4px;">Date: ${new Date(quote.issued_at).toLocaleDateString()}</div>` : ""}
    ${validUntil ? `<div class="muted">Valid until: ${validUntil}</div>` : ""}
  </div>
</div>
<div class="card">
  <div class="muted">Prepared for</div>
  <div><strong>${customer?.name || "Customer"}</strong></div>
</div>
<table>
  <thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Unit Price</th><th class="right">Subtotal</th></tr></thead>
  <tbody>
    ${items.map((item) => `<tr>
      <td>${item.product_name || "Item"}</td>
      <td class="right">${item.quantity || 0}</td>
      <td class="right">${formatMoney(item.unit_price || 0)}</td>
      <td class="right"><strong>${formatMoney((Number(item.unit_price || 0) * Number(item.quantity || 0)))}</strong></td>
    </tr>`).join("")}
  </tbody>
</table>
<div class="card">
  <div style="display:flex;justify-content:space-between;gap:12px;"><span>Grand Total</span><strong>${formatMoney(grandTotal)}</strong></div>
</div>
<p class="muted" style="margin-top:16px;">This quotation is valid for ${quote.validity_days || 30} days.</p>
<div class="muted" style="margin-top:24px;font-size:13px;">Please use the buttons below to accept or reject this quotation.</div>
</body></html>`;
  }

  function contractRemaining(c, excludeInvoiceId = null) {
    const prior = activeInvoices.filter((i) => i.contract_id === c.id && i.id !== excludeInvoiceId);
    const usedPrice = prior.reduce((sum, i) => {
      const subtotal = Number(i.subtotal_amount);
      if (Number.isFinite(subtotal) && subtotal >= 0) return sum + subtotal;
      const total = Number(i.total_amount) || 0;
      const costOfSales = Number(i.cost_of_sales) || 0;
      return sum + Math.max(0, total - costOfSales);
    }, 0);
    const usedCos = prior.reduce((sum, i) => sum + (Number(i.cost_of_sales) || 0), 0);
    const contractPrice = Number(c.price) || 0;
    const contractCos = Number(c.cost_of_sales) || 0;
    const remainingPrice = Math.max(0, contractPrice - usedPrice);
    const remainingCostOfSales = Math.max(0, contractCos - usedCos);
    const remainingTotal = Math.max(0, remainingPrice + remainingCostOfSales);
    return {
      price: Number(remainingPrice.toFixed(2)),
      cost_of_sales: Number(remainingCostOfSales.toFixed(2)),
      total: Number(remainingTotal.toFixed(2)),
    };
  }

  const availableSalesContracts = useMemo(() => {
    return activeContracts.filter((c) => {
      if (c.contract_type !== "sales") return false;
      const contractTotal = (Number(c.price) || 0) + (Number(c.cost_of_sales) || 0);
      if (contractTotal <= 0) return true;
      return contractRemaining(c, editingInvoiceId).total > 0.001;
    });
  }, [activeContracts, activeInvoices, editingInvoiceId]); // eslint-disable-line

  const customerSalesContracts = useMemo(() => {
    if (!invoiceForm.customer_id) return [];
    const customer = resolveCustomer(invoiceForm.customer_id);
    return availableSalesContracts.filter((c) => {
      if (customer) return c.counterparty_id === customer.id || c.counterparty_name === customer.name;
      // free-typed name match
      const typed = String(invoiceForm.customer_id).trim().toLowerCase();
      return (
        String(c.counterparty_name || "").toLowerCase() === typed ||
        String(c.counterparty_id || "").toLowerCase() === typed
      );
    });
  }, [availableSalesContracts, invoiceForm.customer_id]); // eslint-disable-line

  const requiresCatalogue = !activeProducts.length || !activeCustomers.length || !activeVendors.length;
  const invoicePreviewItems = syncProductLineItems(invoiceForm.product_ids, Array.isArray(invoiceForm.items) ? invoiceForm.items : []);
  const invoiceSubtotal = Number(invoicePreviewItems.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0).toFixed(2));
  const invoiceCostOfSalesTotal = Number(invoicePreviewItems.reduce((sum, item) => sum + (Number(item.unit_cost_of_sales || 0) * Number(item.quantity || 0)), 0).toFixed(2));
  const invoiceGrandTotal = Number((invoiceSubtotal + invoiceCostOfSalesTotal).toFixed(2));
  const linkedContract = invoiceForm.contract_id ? activeContracts.find((c) => c.id === invoiceForm.contract_id) : null;
  const contractInvoiceLimit = linkedContract ? contractRemaining(linkedContract, editingInvoiceId) : null;
  const invoiceExceedsContractPrice = Boolean(linkedContract && contractInvoiceLimit && invoiceSubtotal > contractInvoiceLimit.price + 0.001);
  const invoiceExceedsContractCost = Boolean(linkedContract && contractInvoiceLimit && invoiceCostOfSalesTotal > contractInvoiceLimit.cost_of_sales + 0.001);
  const invoiceExceedsContractTotal = Boolean(linkedContract && contractInvoiceLimit && invoiceGrandTotal > contractInvoiceLimit.total + 0.001);
  const invoiceContractWarning = useMemo(() => {
    if (!linkedContract || !contractInvoiceLimit) return "";
    if (invoiceExceedsContractPrice) {
      return `Unit price / subtotal is above the remaining contract price allowance. Allowed: ${formatMoney(contractInvoiceLimit.price)}. Current subtotal: ${formatMoney(invoiceSubtotal)}.`;
    }
    if (invoiceExceedsContractCost) {
      return `Cost of sales is above the remaining contract cost-of-sales allowance. Allowed: ${formatMoney(contractInvoiceLimit.cost_of_sales)}. Current cost of sales: ${formatMoney(invoiceCostOfSalesTotal)}.`;
    }
    if (invoiceExceedsContractTotal) {
      return `Grand total is above the remaining contract balance. Allowed: ${formatMoney(contractInvoiceLimit.total)}. Current grand total: ${formatMoney(invoiceGrandTotal)}.`;
    }
    return "";
  }, [
    contractInvoiceLimit,
    invoiceCostOfSalesTotal,
    invoiceExceedsContractCost,
    invoiceExceedsContractPrice,
    invoiceExceedsContractTotal,
    invoiceGrandTotal,
    invoiceSubtotal,
    linkedContract,
  ]);
  const quotePreviewItems = syncProductLineItems(quoteForm.product_ids, Array.isArray(quoteForm.items) ? quoteForm.items : []);
  const quoteSubtotal = Number(quotePreviewItems.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0).toFixed(2));
  const quoteCostOfSalesTotal = Number(quotePreviewItems.reduce((sum, item) => sum + (Number(item.unit_cost_of_sales || 0) * Number(item.quantity || 0)), 0).toFixed(2));
  const quoteGrandTotal = Number((quoteSubtotal + quoteCostOfSalesTotal).toFixed(2));
  const previewInvoice = activeInvoices.find((inv) => inv.id === previewInvoiceId) || null;
  const previewCustomer = previewInvoice ? resolveCustomer(previewInvoice.customer_id, previewInvoice.customer_name) : null;
  const previewProduct = previewInvoice ? resolveProduct(previewInvoice.product_id, previewInvoice.product_name) : null;
  const previewQuote = activeQuotes.find((q) => q.id === previewQuoteId) || null;
  const previewQuoteCustomer = previewQuote ? resolveCustomer(previewQuote.customer_id, previewQuote.customer_name) : null;
  const previewQuoteProduct = previewQuote ? resolveProduct(previewQuote.product_id, previewQuote.product_name) : null;

  if (!workspaceId) {
    return <WorkspacePrompt />;
  }

  return (
    <div>
      <datalist id="financial-customers">
        {activeCustomers.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      <datalist id="financial-products">
        {activeProducts.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      <datalist id="financial-vendors">
        {activeVendors.map((v) => (
          <option key={v.id} value={v.name} />
        ))}
      </datalist>
      <PageHeader
        title="Financials"
        description="Track invoices, expenses, and contracts with live operational indicators."
        badge={{ text: "Live", tone: "emerald" }}
      />

      {error ? (
        <div className="mt-4">
          <InlineAlert kind="error" message={error} />
        </div>
      ) : null}
      {hasArchiveWarning ? (
        <div className="mt-4">
          <InlineAlert kind="warn" message="Archived items older than 60 days will expire after 90 days. Review the archive list to restore or delete them." />
        </div>
      ) : null}

      <div className="mt-6">
        <SegmentedTabs
          value={activeTab}
          onChange={setActiveTab}
          options={[
            ...(canViewFinancialsOverview ? [{ value: "overview", label: "Overview" }] : []),
            ...(canFinancialsFeature("invoices") ? [{ value: "invoices", label: "Invoices" }] : []),
            ...(canFinancialsFeature("quotations") ? [{ value: "quotes", label: "Quotations" }] : []),
            ...(canFinancialsFeature("expenses") ? [{ value: "expenses", label: "Expenses" }] : []),
            ...(canFinancialsFeature("contracts") ? [{ value: "contracts", label: "Contracts" }] : []),
            { value: "report", label: "Report" },
          ]}
        />
      </div>

      {activeTab === "overview" ? (
      <div className="mt-6 space-y-4"> {/* overview */}

        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Monthly run rate", value: formatMoney(overviewKpis.monthlyRev), sub: "from paid invoices", tone: "emerald", type: "invoices-paid", items: activeInvoices.filter((i) => String(i.status || "").toLowerCase() === "paid") },
            { label: "Pending receivables", value: formatMoney(overviewKpis.pendingRec), sub: `${invoicePendingCount} unpaid invoice${invoicePendingCount !== 1 ? "s" : ""}`, tone: overviewKpis.pendingRec > 0 ? "amber" : "slate", type: "invoices-unpaid", items: activeInvoices.filter((i) => String(i.status || "").toLowerCase() !== "paid") },
            { label: "Pending payables", value: formatMoney(overviewKpis.pendingPay), sub: `${expensePendingCount} unpaid expense${expensePendingCount !== 1 ? "s" : ""}`, tone: overviewKpis.pendingPay > 0 ? "rose" : "slate", type: "expenses-unpaid", items: activeExpenses.filter((e) => String(e.status || "").toLowerCase() !== "paid") },
            { label: "Overdue invoices", value: overviewKpis.overdueInvCount, sub: overviewKpis.overdueInvCount > 0 ? "require immediate action" : "all within terms", tone: overviewKpis.overdueInvCount > 0 ? "rose" : "emerald", type: "invoices-overdue", items: activeInvoices.filter((i) => String(i.status || "").toLowerCase() !== "paid" && i.due_date && new Date(i.due_date) < new Date()) },
          ].map((kpi) => {
            const isOpen = overviewDrill?.type === kpi.type;
            return (
              <button key={kpi.label} type="button"
                onClick={() => setOverviewDrill(isOpen ? null : { label: kpi.label, type: kpi.type, items: kpi.items })}
                className={`rounded-2xl border bg-white p-4 shadow-sm text-left w-full transition hover:shadow-md ${isOpen ? "border-brand-400 ring-1 ring-brand-200" : "border-slate-200 hover:border-slate-300"}`}
              >
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{kpi.label}</div>
                <div className={`mt-1.5 text-2xl font-bold ${kpi.tone === "emerald" ? "text-emerald-600" : kpi.tone === "rose" ? "text-rose-600" : kpi.tone === "amber" ? "text-amber-600" : "text-slate-900"}`}>
                  {kpi.value}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">{kpi.sub}</div>
              </button>
            );
          })}
        </div>

        {/* KPI drill-down panel */}
        {overviewDrill ? (
          <div className="rounded-2xl border border-brand-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">
                {overviewDrill.label}
                <span className="ml-1.5 text-slate-400 font-normal">({overviewDrill.items.length})</span>
              </span>
              <button type="button" onClick={() => setOverviewDrill(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            {overviewDrill.items.length === 0 ? (
              <p className="text-[13px] text-slate-400 italic">No records found.</p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-64 overflow-auto">
                {overviewDrill.items.map((item) => {
                  const isExp = overviewDrill.type.startsWith("expenses");
                  const isContract = overviewDrill.type.startsWith("contracts");
                  const isQuote = overviewDrill.type.startsWith("quotes");
                  const name = isExp
                    ? (item.vendor_name || item.counterparty_name || item.description || "Expense")
                    : isContract
                      ? (item.counterparty_name || item.title || "Contract")
                      : isQuote
                        ? (item.customer_name || "Quote")
                        : (item.customer_name || "Invoice");
                  const detail = isExp
                    ? (item.description || item.expense_type || "")
                    : isContract
                      ? (item.contract_type || "")
                      : (item.product_names?.join(", ") || item.product_name || "");
                  const date = item.due_date
                    ? `Due ${new Date(item.due_date).toLocaleDateString()}`
                    : item.issued_at
                      ? new Date(item.issued_at).toLocaleDateString()
                      : "";
                  const amount = Number(item.total_amount || item.price || item.subtotal_amount || 0);
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-4 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-800">{name}</div>
                        <div className="text-[11px] text-slate-400">{[detail, date].filter(Boolean).join(" · ")}</div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-0.5">
                        <span className="text-sm font-semibold text-slate-800">{formatMoney(amount)}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${item.status === "paid" || item.status === "signed" ? "bg-emerald-50 text-emerald-700" : item.status === "pending" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                          {item.status || "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {/* Activity + Catalogue readiness */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <SectionCard title="Invoice activity" subtitle="Status breakdown across all invoices." className="h-full">
            <div className="mt-3 space-y-1">
              {[
                { label: "Paid", count: invoicePaidCount, color: "bg-emerald-500", type: "invoices-paid", items: activeInvoices.filter((i) => i.status === "paid") },
                { label: "Pending", count: invoicePendingCount, color: "bg-amber-400", type: "invoices-pending", items: activeInvoices.filter((i) => i.status === "pending") },
                { label: "Draft / Sent", count: activeInvoices.filter((i) => ["draft","sent"].includes(i.status || "")).length, color: "bg-sky-400", type: "invoices-draft", items: activeInvoices.filter((i) => ["draft","sent"].includes(i.status || "")) },
                { label: "Quotes", count: activeQuotes.length, color: "bg-violet-400", type: "quotes-active", items: activeQuotes },
              ].map((row) => {
                const isOpen = overviewDrill?.type === row.type;
                return (
                  <button key={row.label} type="button"
                    onClick={() => setOverviewDrill(isOpen ? null : { label: row.label, type: row.type, items: row.items })}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition ${isOpen ? "bg-brand-50 text-brand-700" : "hover:bg-slate-50"}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${row.color}`} />
                      <span className="truncate text-sm text-slate-700">{row.label}</span>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-slate-900">{row.count}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4">
              <Button size="sm" onClick={() => setActiveTab("invoices")}>Go to invoices</Button>
            </div>
          </SectionCard>

          <SectionCard title="Expenses & contracts" subtitle="Payables and active agreements." className="h-full">
            <div className="mt-3 space-y-1">
              {[
                { label: "Paid expenses", count: expensePaidCount, color: "bg-slate-400", type: "expenses-paid", items: activeExpenses.filter((e) => e.status === "paid") },
                { label: "Pending expenses", count: expensePendingCount, color: "bg-rose-400", type: "expenses-pending", items: activeExpenses.filter((e) => e.status === "pending") },
                { label: "Pending contracts", count: contractPendingCount, color: "bg-amber-400", type: "contracts-pending", items: activeContracts.filter((c) => c.status === "pending") },
                { label: "Signed contracts", count: contractSignedCount, color: "bg-emerald-500", type: "contracts-signed", items: activeContracts.filter((c) => c.status === "signed") },
              ].map((row) => {
                const isOpen = overviewDrill?.type === row.type;
                return (
                  <button key={row.label} type="button"
                    onClick={() => setOverviewDrill(isOpen ? null : { label: row.label, type: row.type, items: row.items })}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition ${isOpen ? "bg-brand-50 text-brand-700" : "hover:bg-slate-50"}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${row.color}`} />
                      <span className="truncate text-sm text-slate-700">{row.label}</span>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-slate-900">{row.count}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setActiveTab("expenses")}>Expenses</Button>
              <Button size="sm" variant="secondary" onClick={() => setActiveTab("contracts")}>Contracts</Button>
            </div>
          </SectionCard>

          <SectionCard title="Catalogue readiness" subtitle="Products, customers, and vendors set up." className="h-full">
            <div className="mt-3 space-y-3">
              {[
                { label: "Products", count: activeProducts.length, ok: activeProducts.length > 0 },
                { label: "Customers", count: activeCustomers.length, ok: activeCustomers.length > 0 },
                { label: "Vendors", count: activeVendors.length, ok: activeVendors.length > 0 },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${row.ok ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                      {row.ok ? "✓" : "—"}
                    </span>
                    <span className="text-sm text-slate-700">{row.label}</span>
                  </div>
                  <span className="text-sm font-semibold text-slate-900">{row.count}</span>
                </div>
              ))}
            </div>
            {requiresCatalogue && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                Add at least one product, customer, and vendor to start invoicing.
              </div>
            )}
            {rfqRequests.filter((r) => r.status === "pending").length > 0 && (
              <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-700">
                {rfqRequests.filter((r) => r.status === "pending").length} incoming RFQ request{rfqRequests.filter((r) => r.status === "pending").length !== 1 ? "s" : ""} pending approval.
              </div>
            )}
          </SectionCard>
        </div>


        <SectionCard
          title="Integrations"
          subtitle="Connect QuickBooks or Xero to sync invoices, expenses and contacts."
        >
          <IntegrationPanel providers={["quickbooks", "xero"]} />
        </SectionCard>
      </div>
      ) : null}

      {activeTab !== "overview" ? (
      <div className="mt-6">
        {activeTab === "invoices" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          title="Invoices"
          subtitle="Create invoices and mark them paid."
          className="lg:col-span-2"
          icon={
            <CardIcon tone="bg-violet-50 text-violet-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 4h12v16l-3-2-3 2-3-2-3 2V4z" />
                <path d="M9 8h6M9 12h6" />
              </svg>
            </CardIcon>
          }
        >
            <div className="grid grid-cols-1 gap-3">
              <div>
                <div className="ea-label">Invoice ID (optional)</div>
                <Input
                  placeholder="Enter invoice ID"
                  value={invoiceForm.invoice_id}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, invoice_id: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Customer *</div>
                <Input
                  list="financial-customers"
                  placeholder={activeCustomers.length ? "Select or type customer" : "Type customer"}
                  value={invoiceForm.customer_id}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, customer_id: e.target.value, contract_id: "" }))}
                />
              </div>
              {customerSalesContracts.length > 0 && (
                <div>
                  <div className="ea-label">Link to contract (optional)</div>
                  <div className="relative">
                    <select
                      className={`w-full appearance-none rounded-xl border border-slate-200 bg-white pl-3.5 pr-10 py-2.5 text-sm outline-none ring-brand-200 focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 ${invoiceForm.contract_id ? "text-slate-900 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}`}
                      value={invoiceForm.contract_id}
                      onChange={(e) => {
                        const contractId = e.target.value;
                        if (!contractId) {
                          setInvoiceForm((f) => ({ ...f, contract_id: "" }));
                          return;
                        }
                        const contract = activeContracts.find((c) => c.id === contractId);
                        if (!contract) {
                          setInvoiceForm((f) => ({ ...f, contract_id: contractId }));
                          return;
                        }
                        const productIds = Array.isArray(contract.product_ids) && contract.product_ids.length
                          ? contract.product_ids
                          : contract.product_id ? [contract.product_id] : [];
                        const linkedPriorInvoices = activeInvoices
                          .filter((i) => i.contract_id === contractId && i.id !== editingInvoiceId);
                        const remaining = contractRemaining(contract, editingInvoiceId);
                        const remainingPrice = remaining.price;
                        const remainingCos = remaining.cost_of_sales;
                        const count = productIds.length || 1;
                        const perUnitPrice = Number((remainingPrice / count).toFixed(2));
                        const perUnitCos = Number((remainingCos / count).toFixed(2));
                        const newItems = syncProductLineItems(productIds, []).map((item) => ({
                          ...item,
                          unit_price: perUnitPrice,
                          unit_cost_of_sales: perUnitCos,
                        }));
                        setInvoiceForm((f) => ({
                          ...f,
                          contract_id: contractId,
                          customer_id: contract.counterparty_name || contract.counterparty_id || f.customer_id,
                          product_ids: productIds.length ? productIds : f.product_ids,
                          items: productIds.length ? newItems : f.items,
                          due_date: contract.due_date || contract.end_date || f.due_date,
                        }));
                      }}
                    >
                      <option value="">Select contract</option>
                      {customerSalesContracts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.counterparty_name || "Unnamed"} — {formatMoney(contractRemaining(c, editingInvoiceId).total)} remaining{c.end_date ? ` (ends ${new Date(c.end_date).toLocaleDateString()})` : ""}
                          </option>
                        ))}
                    </select>
                    <svg
                      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
              )}
              <div>
                <div className="ea-label">Products / Services *</div>
                <MultiProductDropdown
                  products={activeProducts}
                  selectedIds={Array.isArray(invoiceForm.product_ids) ? invoiceForm.product_ids : []}
                  onChange={updateInvoiceSelectedProducts}
                  disabled={Boolean(invoiceForm.contract_id)}
                />
                {invoiceForm.contract_id && (
                  <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
                    Items are locked by the selected contract. Remove the contract to change products.
                  </div>
                )}
              </div>
              {invoicePreviewItems.length ? (
                <div className="space-y-3">
                  <div className="ea-label">Selected item details</div>
                  {invoicePreviewItems.map((item) => (
                    <div key={item.product_id} className="rounded-xl border border-slate-200 p-3">
                      {item.product_id === OTHER_PRODUCT_ID ? (
                        <div className="mb-3">
                          <div className="ea-label">Product / Service name *</div>
                          <Input
                            placeholder="Enter name"
                            value={item.product_name}
                            disabled={Boolean(invoiceForm.contract_id)}
                            onChange={(e) => updateInvoiceItem(OTHER_PRODUCT_ID, "product_name", e.target.value)}
                          />
                        </div>
                      ) : (
                        <div className="mb-3 text-sm font-semibold text-slate-900">{item.product_name}</div>
                      )}
                      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
                        <div>
                          <div className="ea-label">Quantity *</div>
                          <Input
                            type="number"
                            min="1"
                            value={String(item.quantity ?? 1)}
                            disabled={Boolean(invoiceForm.contract_id)}
                            onChange={(e) => updateInvoiceItem(item.product_id, "quantity", e.target.value)}
                          />
                        </div>
                        <div>
                          <div className="ea-label">Unit price</div>
                          <Input
                            type="number"
                            min="0"
                            value={String(item.unit_price ?? 0)}
                            onChange={(e) => updateInvoiceItem(item.product_id, "unit_price", e.target.value)}
                          />
                        </div>
                        <div>
                          <div className="ea-label">Unit cost of sales</div>
                          <Input
                            type="number"
                            min="0"
                            value={String(item.unit_cost_of_sales ?? 0)}
                            onChange={(e) => updateInvoiceItem(item.product_id, "unit_cost_of_sales", e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Issued date</div>
                <Input type="date" value={invoiceForm.issued_at} onChange={(e) => setInvoiceForm((f) => ({ ...f, issued_at: e.target.value }))} />
              </div>
              <div>
                <div className="ea-label">Due date</div>
                <Input type="date" value={invoiceForm.due_date} onChange={(e) => setInvoiceForm((f) => ({ ...f, due_date: e.target.value }))} />
              </div>
            </div>
            <div className={`grid grid-cols-1 items-start gap-3 ${invoiceCostOfSalesTotal > 0 ? "sm:grid-cols-2" : ""}`}>
              <div>
                <div className="ea-label">Subtotal</div>
                <Input value={formatMoney(invoiceSubtotal)} disabled />
              </div>
              {invoiceCostOfSalesTotal > 0 && (
                <div>
                  <div className="ea-label">Total cost of sales</div>
                  <Input value={formatMoney(invoiceCostOfSalesTotal)} disabled />
                </div>
              )}
            </div>
            {invoiceCostOfSalesTotal > 0 && (
              <div>
                <div className="ea-label">Grand Total</div>
                <Input value={formatMoney(invoiceGrandTotal)} disabled />
              </div>
            )}
            {invoiceSubmitAttempted && invoiceContractWarning ? <InlineAlert kind="error" message={invoiceContractWarning} /> : null}
            {linkedContract && contractInvoiceLimit !== null && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                <div className="flex items-center justify-between">
                  <span>Contract remaining balance</span>
                  <span className={`font-semibold tabular-nums ${contractInvoiceLimit.total <= 0 ? "text-emerald-600" : "text-slate-900 dark:text-slate-100"}`}>
                    {formatMoney(contractInvoiceLimit.total)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500">
                  <span>Price left: {formatMoney(contractInvoiceLimit.price)}</span>
                  <span>Cost of sales left: {formatMoney(contractInvoiceLimit.cost_of_sales)}</span>
                </div>
              </div>
            )}
            {invoiceFormError && !invoiceContractWarning ? <InlineAlert kind="error" message={invoiceFormError} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={upsertInvoice}>{editingInvoiceId ? "Update invoice" : "Add invoice"}</Button>
              {editingInvoiceId ? (
                <Button variant="secondary" onClick={resetInvoiceForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Recent invoices"
          subtitle="Latest invoice activity."
          className="lg:col-span-3"
          icon={
            <CardIcon tone="bg-amber-50 text-amber-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 8v5l3 2" />
                <circle cx="12" cy="12" r="8" />
              </svg>
            </CardIcon>
          }
        >
            <div className="mt-2 space-y-2">
              {activeInvoices.length ? (
                activeInvoices.map((inv) => {
                  const customer = resolveCustomer(inv.customer_id, inv.customer_name);
                  const product = resolveProduct(inv.product_id, inv.product_name);
                  return (
                    <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-sm font-semibold text-slate-900">
                            {customer?.name || "Customer"} · {summariseProductNames(inv)}
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${inv.status === "paid" ? "bg-emerald-50 text-emerald-700" : inv.status === "draft" || inv.status === "sent" ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700"}`}>
                            {inv.status || "pending"}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          Qty {inv.quantity} · {formatMoney(inv.total_amount)} · Due {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : "Not set"}
                        </div>
                      </div>
                      <ActionMenu
                        items={addFinancialShareAction([
                          {
                            label: "Edit",
                            onClick: () => {
                              setEditingInvoiceId(inv.id);
                              setInvoiceForm({
                                  invoice_id: inv.invoice_id || "",
                                  customer_id: inv.customer_name || inv.customer_id,
                                  contract_id: inv.contract_id || "",
                                  product_ids: Array.isArray(inv.product_ids) && inv.product_ids.length ? inv.product_ids : inv.product_id ? [inv.product_id] : [],
                                  items: normalizeRecordItems(inv),
                                  issued_at: inv.issued_at || "",
                                  due_date: inv.due_date || "",
                                });
                            }
                          },
                          {
                            label: inv.status === "paid" ? "Mark pending" : "Mark paid",
                            onClick: () => updateStatus("invoice", inv.id, inv.status === "paid" ? "pending" : "paid")
                          },
                          {
                            label: "View invoice",
                            onClick: () => setPreviewInvoiceId(inv.id)
                          },
                          {
                            label: "Archive",
                            onClick: () => archiveItem("invoice", inv.id)
                          },
                          {
                            label: "Delete",
                            tone: "danger",
                            onClick: () => deleteItem("invoice", inv.id)
                          }
                        ], "invoice", inv, customer, product)}
                      />
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  No invoices yet. Add your first invoice above.
                </div>
              )}
            </div>
        </SectionCard>
        <SectionCard
          title="Archived invoices"
          subtitle="Restore or delete archived invoices."
          className="lg:col-span-5"
          icon={
            <CardIcon tone="bg-slate-100 text-slate-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16" />
                <path d="M6 7l1 12h10l1-12" />
                <path d="M9 7V5h6v2" />
              </svg>
            </CardIcon>
          }
        >
          <div className="mt-2 space-y-2 max-h-60 overflow-auto pr-1">
            {archivedInvoices.length ? (
              archivedInvoices.map((inv) => {
                const customer = resolveCustomer(inv.customer_id, inv.customer_name);
                const age = daysSince(inv.archived_at || inv.updated_at || inv.created_at);
                const expiring = Math.max(0, ARCHIVE_EXPIRE_DAYS - age);
                return (
                  <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{customer?.name || "Customer"} • {formatMoney(inv.total_amount)}</div>
                      <div className="text-xs text-slate-500">Archived {age} days ago • Expires in {expiring} days</div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => restoreItem("invoice", inv.id)}>Activate</Button>
                      <Button variant="ghost" onClick={() => deleteItem("invoice", inv.id)}>Delete</Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No archived invoices.
              </div>
            )}
          </div>
        </SectionCard>
        </div>
        ) : null}

        {activeTab === "quotes" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          title="Sales quotations"
          subtitle="Prepare customer-ready quotes before invoicing."
          className="lg:col-span-2"
          icon={
            <CardIcon tone="bg-indigo-50 text-indigo-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 4h14v16H5z" />
                <path d="M8 8h8M8 12h8M8 16h5" />
              </svg>
            </CardIcon>
          }
        >
            <div className="grid grid-cols-1 gap-3">
              <div>
                <div className="ea-label">Quotation ID (optional)</div>
                <Input
                  placeholder="Enter quotation ID"
                  value={quoteForm.quotation_id}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, quotation_id: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Customer *</div>
                <Input
                  list="financial-customers"
                  placeholder={activeCustomers.length ? "Select or type customer" : "Type customer"}
                  value={quoteForm.customer_id}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, customer_id: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Products / Services *</div>
                <MultiProductDropdown
                  products={activeProducts}
                  selectedIds={Array.isArray(quoteForm.product_ids) ? quoteForm.product_ids : []}
                  onChange={updateQuoteSelectedProducts}
                />
              </div>
              {quotePreviewItems.length ? (
                <div className="space-y-3">
                  <div className="ea-label">Selected item details</div>
                  {quotePreviewItems.map((item) => (
                    <div key={item.product_id} className="rounded-xl border border-slate-200 p-3">
                      {item.product_id === OTHER_PRODUCT_ID ? (
                        <div className="mb-3">
                          <div className="ea-label">Product / Service name *</div>
                          <Input
                            placeholder="Enter name"
                            value={item.product_name}
                            onChange={(e) => updateQuoteItem(OTHER_PRODUCT_ID, "product_name", e.target.value)}
                          />
                        </div>
                      ) : (
                        <div className="mb-3 text-sm font-semibold text-slate-900">{item.product_name}</div>
                      )}
                      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
                        <div>
                          <div className="ea-label">Quantity *</div>
                          <Input
                            type="number"
                            min="1"
                            value={String(item.quantity ?? 1)}
                            onChange={(e) => updateQuoteItem(item.product_id, "quantity", e.target.value)}
                          />
                        </div>
                        <div>
                          <div className="ea-label">Unit price</div>
                          <Input
                            type="number"
                            min="0"
                            value={String(item.unit_price ?? 0)}
                            onChange={(e) => updateQuoteItem(item.product_id, "unit_price", e.target.value)}
                          />
                        </div>
                        <div>
                          <div className="ea-label">Unit cost of sales</div>
                          <Input
                            type="number"
                            min="0"
                            value={String(item.unit_cost_of_sales ?? 0)}
                            onChange={(e) => updateQuoteItem(item.product_id, "unit_cost_of_sales", e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Quotation validity (days)</div>
                <Input
                  type="number"
                  min="1"
                  value={quoteForm.validity_days}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, validity_days: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Issued date</div>
                <Input type="date" value={quoteForm.issued_at} onChange={(e) => setQuoteForm((f) => ({ ...f, issued_at: e.target.value }))} />
              </div>
              <div>
                <div className="ea-label">Due date</div>
                <Input type="date" value={quoteForm.due_date} onChange={(e) => setQuoteForm((f) => ({ ...f, due_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Subtotal</div>
                <Input value={formatMoney(quoteSubtotal)} disabled />
              </div>
              <div>
                <div className="ea-label">Total cost of sales</div>
                <Input value={formatMoney(quoteCostOfSalesTotal)} disabled />
              </div>
            </div>
            <div>
              <div className="ea-label">Grand Total</div>
              <Input value={formatMoney(quoteGrandTotal)} disabled />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upsertQuote}>{editingQuoteId ? "Update quotation" : "Add quotation"}</Button>
              {editingQuoteId ? (
                <Button variant="secondary" onClick={resetQuoteForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Recent quotations"
          subtitle="Drafts, sent quotes, accepted proposals, and incoming requests."
          className="lg:col-span-3"
          icon={
            <CardIcon tone="bg-amber-50 text-amber-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 8v5l3 2" />
                <circle cx="12" cy="12" r="8" />
              </svg>
            </CardIcon>
          }
        >
            <div className="mt-2 space-y-2">
              {activeQuotes.length ? (
                activeQuotes.map((quote) => {
                  const customer = resolveCustomer(quote.customer_id, quote.customer_name);
                  const product = resolveProduct(quote.product_id, quote.product_name);
                  return (
                    <div key={quote.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-sm font-semibold text-slate-900">
                            {customer?.name || "Customer"} · {summariseProductNames(quote)}
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${quote.status === "accepted" ? "bg-emerald-50 text-emerald-700" : quote.status === "rejected" ? "bg-rose-50 text-rose-700" : quote.status === "sent" ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600"}`}>
                            {quote.status || "draft"}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          Qty {quote.quantity} · {formatMoney(quote.total_amount)} · Due {quote.due_date ? new Date(quote.due_date).toLocaleDateString() : "Not set"}
                        </div>
                      </div>
                      <ActionMenu
                        items={addFinancialShareAction([
                          {
                            label: "Edit",
                            onClick: () => {
                              setEditingQuoteId(quote.id);
                              setQuoteForm({
                                  quotation_id: quote.quotation_id || "",
                                  customer_id: quote.customer_name || quote.customer_id,
                                  product_ids: Array.isArray(quote.product_ids) && quote.product_ids.length ? quote.product_ids : quote.product_id ? [quote.product_id] : [],
                                  items: normalizeRecordItems(quote),
                                  validity_days: String(quote.validity_days || "30"),
                                  issued_at: quote.issued_at || "",
                                  due_date: quote.due_date || "",
                                });
                            }
                          },
                          {
                            label: quote.status === "sent" ? "Mark draft" : "Mark sent",
                            onClick: () => updateStatus("quote", quote.id, quote.status === "sent" ? "draft" : "sent")
                          },
                          {
                            label: quote.status === "accepted" ? "Mark draft" : "Mark accepted",
                            onClick: () => updateStatus("quote", quote.id, quote.status === "accepted" ? "draft" : "accepted")
                          },
                          {
                            label: "View quotation",
                            onClick: () => setPreviewQuoteId(quote.id)
                          },
                          {
                            label: "Archive",
                            onClick: () => archiveItem("quote", quote.id)
                          },
                          {
                            label: "Delete",
                            tone: "danger",
                            onClick: () => deleteItem("quote", quote.id)
                          }
                        ], "quote", quote, customer, product)}
                      />
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  No quotations yet. Add your first quote above.
                </div>
              )}
            </div>
        </SectionCard>

        {/* Incoming RFQ Requests */}
        <SectionCard
          title="Incoming Requests"
          subtitle="Quotation requests from marketplace visitors."
          className="lg:col-span-5"
          icon={
            <CardIcon tone="bg-sky-50 text-sky-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14,2 14,8 20,8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </CardIcon>
          }
        >
          <div className="mt-2 space-y-2 max-h-96 overflow-auto pr-1">
            {rfqRequests.length ? (
              [...rfqRequests].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map((rfq) => {
                const statusColors = {
                  pending: "bg-amber-50 text-amber-700 border-amber-200",
                  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
                  rejected: "bg-rose-50 text-rose-700 border-rose-200",
                };
                const customerResponse = rfq.customer_response;
                return (
                  <div key={rfq.id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">{rfq.customer_name}</div>
                        <div className="text-xs text-slate-500">{rfq.customer_email}</div>
                        {rfq.message && <div className="mt-1 text-xs text-slate-500 italic line-clamp-2">"{rfq.message}"</div>}
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {(rfq.items || []).map((item, i) => (
                            <span key={i} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">
                              {item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ""}
                            </span>
                          ))}
                        </div>
                        <div className="mt-1 text-[10px] text-slate-400">{rfq.created_at ? new Date(rfq.created_at).toLocaleDateString() : ""}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusColors[rfq.status] || "bg-slate-50 text-slate-600 border-slate-200"}`}>
                          {customerResponse ? `Customer ${customerResponse}` : rfq.status}
                        </span>
                        {rfq.status === "pending" && (
                          <div className="flex gap-1.5">
                            <Button onClick={() => openRfqApproveModal(rfq)}>Approve & Send</Button>
                            <Button variant="secondary" onClick={() => rejectRfq(rfq.id)}>Reject</Button>
                          </div>
                        )}
                        <Button variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => deleteRfq(rfq.id)}>Delete</Button>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No incoming requests yet. Once your business is listed in the marketplace, quotation requests will appear here.
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Archived quotations"
          subtitle="Restore or delete archived quotations."
          className="lg:col-span-5"
          icon={
            <CardIcon tone="bg-slate-100 text-slate-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16" />
                <path d="M6 7l1 12h10l1-12" />
                <path d="M9 7V5h6v2" />
              </svg>
            </CardIcon>
          }
        >
          <div className="mt-2 space-y-2 max-h-60 overflow-auto pr-1">
            {archivedQuotes.length ? (
              archivedQuotes.map((quote) => {
                const customer = resolveCustomer(quote.customer_id, quote.customer_name);
                const age = daysSince(quote.archived_at || quote.updated_at || quote.created_at);
                const expiring = Math.max(0, ARCHIVE_EXPIRE_DAYS - age);
                return (
                  <div key={quote.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{customer?.name || "Customer"} • {formatMoney(quote.total_amount)}</div>
                      <div className="text-xs text-slate-500">Archived {age} days ago • Expires in {expiring} days</div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => restoreItem("quote", quote.id)}>Activate</Button>
                      <Button variant="ghost" onClick={() => deleteItem("quote", quote.id)}>Delete</Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No archived quotations.
              </div>
            )}
          </div>
        </SectionCard>

        </div>
        ) : null}

        {activeTab === "expenses" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          title="Expenses"
          subtitle="Track vendor payments and cost types."
          className="lg:col-span-2"
          icon={
            <CardIcon tone="bg-rose-50 text-rose-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16v12H4z" />
                <path d="M8 10h8M8 14h5" />
              </svg>
            </CardIcon>
          }
        >
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="ea-label">Vendor *</div>
              <Input
                list="financial-vendors"
                placeholder={activeVendors.length ? "Select or type vendor" : "Type vendor"}
                value={expenseForm.vendor_id}
                onChange={(e) => {
                  const value = e.target.value;
                  const vendor = resolveVendor(value);
                  setExpenseForm((f) => ({
                    ...f,
                    vendor_id: vendor?.id || value,
                    item: f.item || vendor?.product_name || "",
                    price: f.price || (vendor?.price ? String(vendor.price) : "")
                  }));
                }}
              />
            </div>
            <div>
              <div className="ea-label">Item *</div>
              <Input value={expenseForm.item} onChange={(e) => setExpenseForm((f) => ({ ...f, item: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Cost type</div>
                <select
                  className="ea-input"
                  value={expenseForm.cost_type}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, cost_type: e.target.value }))}
                >
                  <option value="fixed">Fixed</option>
                  <option value="variable">Variable</option>
                </select>
              </div>
              <div>
                <div className="ea-label">Price *</div>
                <Input
                  type="number"
                  min="0"
                  value={expenseForm.price}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, price: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Incurred date</div>
                <Input type="date" value={expenseForm.incurred_at} onChange={(e) => setExpenseForm((f) => ({ ...f, incurred_at: e.target.value }))} />
              </div>
              <div>
                <div className="ea-label">Due date</div>
                <Input type="date" value={expenseForm.due_date} onChange={(e) => setExpenseForm((f) => ({ ...f, due_date: e.target.value }))} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upsertExpense}>{editingExpenseId ? "Update expense" : "Add expense"}</Button>
              {editingExpenseId ? (
                <Button variant="secondary" onClick={resetExpenseForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Recent expenses"
          subtitle="Latest vendor payments."
          className="lg:col-span-3"
          icon={
            <CardIcon tone="bg-amber-50 text-amber-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 8v5l3 2" />
                <circle cx="12" cy="12" r="8" />
              </svg>
            </CardIcon>
          }
        >
            <div className="mt-2 space-y-2">
              {activeExpenses.length ? (
                activeExpenses.map((exp) => {
                  const vendor = resolveVendor(exp.vendor_id, exp.vendor_name);
                  return (
                    <div key={exp.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-sm font-semibold text-slate-900">
                            {vendor?.name || "Vendor"} · {exp.item}
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${exp.status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                            {exp.status || "pending"}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {exp.cost_type} · {formatMoney(exp.price)} · Due {exp.due_date ? new Date(exp.due_date).toLocaleDateString() : "Not set"}
                        </div>
                      </div>
                      <ActionMenu
                        items={[
                          {
                            label: "Edit",
                            onClick: () => {
                              setEditingExpenseId(exp.id);
                              setExpenseForm({
                                vendor_id: exp.vendor_name || exp.vendor_id,
                                item: exp.item,
                                price: String(exp.price || ""),
                                cost_type: exp.cost_type || "variable",
                                incurred_at: exp.incurred_at || "",
                                due_date: exp.due_date || ""
                              });
                            }
                          },
                          {
                            label: exp.status === "paid" ? "Mark pending" : "Mark paid",
                            onClick: () => updateStatus("expense", exp.id, exp.status === "paid" ? "pending" : "paid")
                          },
                          {
                            label: "Archive",
                            onClick: () => archiveItem("expense", exp.id)
                          },
                          {
                            label: "Delete",
                            tone: "danger",
                            onClick: () => deleteItem("expense", exp.id)
                          }
                        ]}
                      />
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  No expenses yet. Add your first expense above.
                </div>
              )}
            </div>
        </SectionCard>
        <SectionCard
          title="Archived expenses"
          subtitle="Restore or delete archived expenses."
          className="lg:col-span-5"
          icon={
            <CardIcon tone="bg-slate-100 text-slate-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16" />
                <path d="M6 7l1 12h10l1-12" />
                <path d="M9 7V5h6v2" />
              </svg>
            </CardIcon>
          }
        >
          <div className="mt-2 space-y-2 max-h-60 overflow-auto pr-1">
            {archivedExpenses.length ? (
              archivedExpenses.map((exp) => {
                const vendor = resolveVendor(exp.vendor_id, exp.vendor_name);
                const age = daysSince(exp.archived_at || exp.updated_at || exp.created_at);
                const expiring = Math.max(0, ARCHIVE_EXPIRE_DAYS - age);
                return (
                  <div key={exp.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{vendor?.name || "Vendor"} • {exp.item}</div>
                      <div className="text-xs text-slate-500">Archived {age} days ago • Expires in {expiring} days</div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => restoreItem("expense", exp.id)}>Activate</Button>
                      <Button variant="ghost" onClick={() => deleteItem("expense", exp.id)}>Delete</Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No archived expenses.
              </div>
            )}
          </div>
        </SectionCard>
        </div>
        ) : null}

        {activeTab === "contracts" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          title="Contracts"
          subtitle="Capture recurring revenue or cost obligations."
          className="lg:col-span-2"
          icon={
            <CardIcon tone="bg-blue-50 text-blue-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 4h12v16l-3-2-3 2-3-2-3 2V4z" />
                <path d="M9 8h6M9 12h6M9 16h4" />
              </svg>
            </CardIcon>
          }
        >
          <div className="grid grid-cols-1 gap-3">
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Contract type</div>
                <select
                  className="ea-input"
                  value={contractForm.contract_type}
                  onChange={(e) => setContractForm((f) => ({ ...f, contract_type: e.target.value }))}
                >
                  <option value="sales">Sales</option>
                  <option value="purchase">Purchase</option>
                </select>
              </div>
              <div>
                <div className="ea-label">{contractForm.contract_type === "sales" ? "Customer" : "Vendor"} *</div>
                <Input
                  list={contractForm.contract_type === "sales" ? "financial-customers" : "financial-vendors"}
                  placeholder={contractForm.contract_type === "sales" ? "Select or type customer" : "Select or type vendor"}
                  value={contractForm.counterparty_id}
                  onChange={(e) => {
                    const value = e.target.value;
                    const party =
                      contractForm.contract_type === "sales" ? resolveCustomer(value) : resolveVendor(value);
                    setContractForm((f) => ({
                      ...f,
                      counterparty_id: party?.name || value,
                      payment_terms: party?.payment_terms ? String(party.payment_terms) : f.payment_terms
                    }));
                  }}
                />
              </div>
            </div>
            <div>
              <div className="ea-label">Products / Services *</div>
              <MultiProductDropdown
                products={activeProducts}
                selectedIds={Array.isArray(contractForm.product_ids) ? contractForm.product_ids : []}
                onChange={(nextIds) => {
                  const selected = resolveProducts(nextIds);
                  const defaultPrice = selected.reduce((sum, p) => sum + Number(getProductPrice(p) || 0), 0);
                  const defaultCos = selected.reduce((sum, p) => sum + Number(getProductDefaultCost(p) || 0), 0);
                  setContractForm((f) => ({
                    ...f,
                    product_ids: nextIds,
                    price: nextIds.length ? String(Number(defaultPrice.toFixed(2))) : f.price,
                    cost_of_sales: nextIds.length ? String(Number(defaultCos.toFixed(2))) : f.cost_of_sales,
                  }));
                }}
              />
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
              <div>
                <div className="ea-label">Price *</div>
                <Input
                  type="number"
                  min="0"
                  value={contractForm.price}
                  onChange={(e) => setContractForm((f) => ({ ...f, price: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Cost of sales</div>
                <Input
                  type="number"
                  min="0"
                  value={contractForm.cost_of_sales}
                  onChange={(e) => setContractForm((f) => ({ ...f, cost_of_sales: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Payment terms (days)</div>
                <Input
                  type="number"
                  min="0"
                  value={contractForm.payment_terms}
                  onChange={(e) => setContractForm((f) => ({ ...f, payment_terms: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Discount</div>
                <Input
                  type="number"
                  min="0"
                  value={contractForm.discount}
                  onChange={(e) => setContractForm((f) => ({ ...f, discount: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Freight</div>
                <Input
                  type="number"
                  min="0"
                  value={contractForm.freight}
                  onChange={(e) => setContractForm((f) => ({ ...f, freight: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Start date</div>
                <Input type="date" value={contractForm.start_date} onChange={(e) => setContractForm((f) => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div>
                <div className="ea-label">End date</div>
                <Input type="date" value={contractForm.end_date} onChange={(e) => setContractForm((f) => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upsertContract}>{editingContractId ? "Update contract" : "Add contract"}</Button>
              {editingContractId ? (
                <Button variant="secondary" onClick={resetContractForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Recent contracts"
          subtitle="Latest signed or pending contracts."
          className="lg:col-span-3"
          icon={
            <CardIcon tone="bg-amber-50 text-amber-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 8v5l3 2" />
                <circle cx="12" cy="12" r="8" />
              </svg>
            </CardIcon>
          }
        >
            <div className="mt-2 space-y-2">
              {activeContracts.length ? (
                activeContracts.map((contract) => {
                  const party =
                    contract.contract_type === "sales"
                      ? resolveCustomer(contract.counterparty_id, contract.counterparty_name)
                      : resolveVendor(contract.counterparty_id, contract.counterparty_name);
                  const product = resolveProduct(contract.product_id, contract.product_name);
                  const contractTotal = (Number(contract.price) || 0) + (Number(contract.cost_of_sales) || 0);
                  const linkedInvoices = activeInvoices.filter((i) => i.contract_id === contract.id);
                  const totalInvoiced = linkedInvoices.reduce((sum, i) => sum + (Number(i.total_amount) || 0), 0);
                  const totalPaid = linkedInvoices.filter((i) => i.status === "paid").reduce((sum, i) => sum + (Number(i.total_amount) || 0), 0);
                  const remainingToInvoice = contractRemaining(contract);
                  const paidPct = contractTotal > 0 ? Math.min(100, Math.round((totalPaid / contractTotal) * 100)) : 0;
                  return (
                    <div key={contract.id} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="truncate text-sm font-semibold text-slate-900">
                              {contract.contract_type === "sales" ? "Sales" : "Purchase"} · {party?.name || "Partner"}
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${contract.status === "signed" || contract.status === "active" ? "bg-emerald-50 text-emerald-700" : contract.status === "expired" || contract.status === "cancelled" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                              {contract.status || "pending"}
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {summariseProductNames(contract)} · {formatMoney(contractTotal)} · {contract.end_date ? `Ends ${new Date(contract.end_date).toLocaleDateString()}` : "No end date"}
                          </div>
                        </div>
                      <ActionMenu
                        items={[
                          {
                            label: "Edit",
                            onClick: () => {
                              setEditingContractId(contract.id);
                              setContractForm({
                                contract_type: contract.contract_type || "sales",
                                counterparty_id: contract.counterparty_name || contract.counterparty_id,
                                product_ids: Array.isArray(contract.product_ids) && contract.product_ids.length ? contract.product_ids : contract.product_id ? [contract.product_id] : [],
                                price: String(contract.price || ""),
                                cost_of_sales: String(contract.cost_of_sales || ""),
                                payment_terms: String(contract.payment_terms || ""),
                                discount: String(contract.discount || ""),
                                freight: String(contract.freight || ""),
                                start_date: contract.start_date || "",
                                end_date: contract.end_date || "",
                                status: contract.status || "pending"
                              });
                            }
                          },
                          {
                            label: contract.status === "signed" ? "Mark pending" : "Mark signed",
                            onClick: () => updateStatus("contract", contract.id, contract.status === "signed" ? "pending" : "signed")
                          },
                          {
                            label: "Archive",
                            onClick: () => archiveItem("contract", contract.id)
                          },
                          {
                            label: "Delete",
                            tone: "danger",
                            onClick: () => deleteItem("contract", contract.id)
                          }
                        ]}
                      />
                      </div>
                      {contract.contract_type === "sales" && (
                        <div className="mt-2 border-t border-slate-100 pt-2">
                          <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-500">
                            <span>Invoiced {formatMoney(totalInvoiced)} of {formatMoney(contractTotal)}</span>
                            <span className={remainingToInvoice.total <= 0 ? "font-semibold text-emerald-600" : "font-semibold text-slate-700"}>
                              {remainingToInvoice.total <= 0 ? "Fully invoiced" : `${formatMoney(remainingToInvoice.total)} left to invoice`}
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full transition-all ${paidPct >= 100 ? "bg-emerald-500" : "bg-brand-500"}`}
                              style={{ width: `${paidPct}%` }}
                            />
                          </div>
                          {linkedInvoices.length > 0 && (
                            <div className="mt-1 text-[10px] text-slate-400">
                              {linkedInvoices.length} invoice{linkedInvoices.length !== 1 ? "s" : ""} linked • {formatMoney(totalPaid)} paid • Price left {formatMoney(remainingToInvoice.price)} • Cost of sales left {formatMoney(remainingToInvoice.cost_of_sales)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  No contracts yet. Add your first contract above.
                </div>
              )}
            </div>
        </SectionCard>
        <SectionCard
          title="Archived contracts"
          subtitle="Restore or delete archived contracts."
          className="lg:col-span-5"
          icon={
            <CardIcon tone="bg-slate-100 text-slate-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16" />
                <path d="M6 7l1 12h10l1-12" />
                <path d="M9 7V5h6v2" />
              </svg>
            </CardIcon>
          }
        >
          <div className="mt-2 space-y-2 max-h-60 overflow-auto pr-1">
            {archivedContracts.length ? (
              archivedContracts.map((contract) => {
                const party =
                  contract.contract_type === "sales"
                    ? resolveCustomer(contract.counterparty_id, contract.counterparty_name)
                    : resolveVendor(contract.counterparty_id, contract.counterparty_name);
                const age = daysSince(contract.archived_at || contract.updated_at || contract.created_at);
                const expiring = Math.max(0, ARCHIVE_EXPIRE_DAYS - age);
                return (
                  <div key={contract.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">
                        {contract.contract_type === "sales" ? "Sales" : "Purchase"} • {party?.name || "Partner"}
                      </div>
                      <div className="text-xs text-slate-500">Archived {age} days ago • Expires in {expiring} days</div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => restoreItem("contract", contract.id)}>Activate</Button>
                      <Button variant="ghost" onClick={() => deleteItem("contract", contract.id)}>Delete</Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No archived contracts.
              </div>
            )}
          </div>
        </SectionCard>
        </div>
        ) : null}


      </div>
      ) : null}

      {activeTab === "overview" ? (() => {
        const paidInvs = activeInvoices.filter(i => String(i.status || "").toLowerCase() === "paid");
        const paidExps = expenses.filter(e => String(e.status || "").toLowerCase() === "paid");
        function _dmc(items) {
          const s = new Set();
          for (const item of items) {
            const raw = item?.created_at || item?.updated_at || item?.issued_at;
            if (!raw) continue;
            const d = new Date(raw);
            if (!Number.isFinite(d.getTime())) continue;
            s.add(`${d.getFullYear()}-${d.getMonth()}`);
          }
          return Math.max(1, s.size);
        }
        const invMonths = _dmc(paidInvs);
        const expMonths = _dmc(paidExps);
        const totalPaidRev = paidInvs.reduce((s, i) => s + Number(i.total_amount || 0), 0);
        const totalPaidCos = paidInvs.reduce((s, i) => s + Number(i.cost_of_sales || 0), 0);
        const totalPaidExp = paidExps.reduce((s, e) => s + Number(e.price || e.total_amount || 0), 0);
        const monthlyRevenue = totalPaidRev / invMonths;
        const monthlyCos = totalPaidCos / invMonths;
        const monthlyExp = totalPaidExp / expMonths;
        const grossMargin = monthlyRevenue > 0 ? (((monthlyRevenue - monthlyCos) / monthlyRevenue) * 100).toFixed(1) : null;
        const pendingReceivablesTotal = activeInvoices.filter(i => String(i.status || "").toLowerCase() !== "paid").reduce((s, i) => s + Number(i.total_amount || 0), 0);
        const pendingPayablesTotal = expenses.filter(e => String(e.status || "").toLowerCase() !== "paid").reduce((s, e) => s + Number(e.price || e.total_amount || 0), 0);

        const invoiceRows = [...activeInvoices]
          .sort((a, b) => new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0))
          .slice(0, 30)
          .map(inv => ({
            customer: inv.customer_name || "—",
            items: Array.isArray(inv.product_names) && inv.product_names.length ? inv.product_names.join(", ") : inv.product_name || "—",
            amount: formatMoney(Number(inv.total_amount || 0)),
            due: inv.due_date ? new Date(inv.due_date).toLocaleDateString() : inv.issued_at ? new Date(inv.issued_at).toLocaleDateString() : "—",
            status: <StatusBadge status={inv.status} />,
          }));

        const quoteRows = [...activeQuotes]
          .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
          .slice(0, 20)
          .map(q => ({
            customer: q.customer_name || "—",
            items: Array.isArray(q.product_names) && q.product_names.length ? q.product_names.join(", ") : q.product_name || "—",
            amount: formatMoney(Number(q.total_amount || q.subtotal_amount || 0)),
            validity: q.validity_days ? `${q.validity_days}d` : "—",
            status: <StatusBadge status={q.status || "draft"} />,
          }));

        const expenseRows = [...expenses]
          .sort((a, b) => new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0))
          .slice(0, 20)
          .map(e => ({
            vendor: e.vendor_name || e.counterparty_name || "—",
            description: e.description || e.expense_type || "—",
            amount: formatMoney(Number(e.price || e.total_amount || 0)),
            due: e.due_date ? new Date(e.due_date).toLocaleDateString() : "—",
            status: <StatusBadge status={e.status || "pending"} />,
          }));

        const contractRows = [...activeContracts]
          .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
          .map(c => ({
            counterparty: c.counterparty_name || "—",
            type: c.contract_type || "—",
            price: formatMoney(Number(c.price || 0)),
            cos: formatMoney(Number(c.cost_of_sales || 0)),
            terms: c.payment_terms || "—",
            status: <StatusBadge status={c.status || "active"} />,
          }));

        const kpiTiles = [
          { label: "Monthly run rate", value: formatMoney(monthlyRevenue) },
          { label: "Gross margin", value: grossMargin != null ? `${grossMargin}%` : "—" },
          { label: "Pending receivables", value: formatMoney(pendingReceivablesTotal) },
          { label: "Pending payables", value: formatMoney(pendingPayablesTotal) },
        ];

        return (
          <div className="mt-6 space-y-4">
            <SectionCard title="Invoices" subtitle="All active invoices — paid and pending.">
              <div className="mt-2">
                <ReportTable
                  paginate
                  columns={[
                    { key: "customer", label: "Customer", bold: true },
                    { key: "items", label: "Items / Services" },
                    { key: "amount", label: "Amount", right: true, bold: true },
                    { key: "due", label: "Due / Issued", right: true },
                    { key: "status", label: "Status", right: true },
                  ]}
                  rows={invoiceRows}
                  emptyText="No invoices yet."
                />
              </div>
            </SectionCard>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectionCard title="Quotation pipeline" subtitle="Active quotes sent or in draft.">
                <div className="mt-2">
                  <ReportTable
                    paginate
                    columns={[
                      { key: "customer", label: "Customer", bold: true },
                      { key: "items", label: "Items" },
                      { key: "amount", label: "Amount", right: true, bold: true },
                      { key: "validity", label: "Valid", right: true },
                      { key: "status", label: "Status", right: true },
                    ]}
                    rows={quoteRows}
                    emptyText="No quotations yet."
                  />
                </div>
              </SectionCard>

              <SectionCard title="Expenses" subtitle={`Pending payables: ${formatMoney(pendingPayablesTotal)}`}>
                <div className="mt-2">
                  <ReportTable
                    paginate
                    columns={[
                      { key: "vendor", label: "Vendor", bold: true },
                      { key: "description", label: "Description" },
                      { key: "amount", label: "Amount", right: true, bold: true },
                      { key: "due", label: "Due", right: true },
                      { key: "status", label: "Status", right: true },
                    ]}
                    rows={expenseRows}
                    emptyText="No expenses recorded."
                  />
                </div>
              </SectionCard>
            </div>

            <SectionCard title="Contracts" subtitle="Active contracts and their value.">
              <div className="mt-2">
                <ReportTable
                  paginate
                  columns={[
                    { key: "counterparty", label: "Counterparty", bold: true },
                    { key: "type", label: "Type" },
                    { key: "price", label: "Price", right: true, bold: true },
                    { key: "cos", label: "Cost of sales", right: true },
                    { key: "terms", label: "Payment terms", right: true },
                    { key: "status", label: "Status", right: true },
                  ]}
                  rows={contractRows}
                  emptyText="No contracts yet."
                />
              </div>
            </SectionCard>
          </div>
        );
      })() : null}

      {activeTab === "report" && (
        <div className="mt-6 space-y-5">
          <SectionCard title="Generate Financial Report" subtitle="Select the sections to include, preview, then download as PDF.">
            <div className="mt-3 flex flex-wrap gap-4">
              {[
                { key: "kpis", label: "KPI Summary" },
                { key: "invoices", label: "Invoices" },
                { key: "quotes", label: "Quotations" },
                { key: "expenses", label: "Expenses" },
                { key: "contracts", label: "Contracts" },
              ].map(({ key, label }) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={reportFilter[key]}
                    onChange={(e) => {
                      setReportFilter((prev) => ({ ...prev, [key]: e.target.checked }));
                      setReportPreviewHtml(null);
                    }}
                    className="h-4 w-4 rounded accent-brand-600"
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  const { kpiTiles, invoiceListRaw, quoteListRaw, expenseListRaw, contractListRaw } = financialReportRows;
                  const payload = {
                    kpis: reportFilter.kpis ? kpiTiles : null,
                    invoiceList: reportFilter.invoices ? invoiceListRaw : null,
                    quoteList: reportFilter.quotes ? quoteListRaw : null,
                    expenseList: reportFilter.expenses ? expenseListRaw : null,
                    contractList: reportFilter.contracts ? contractListRaw : null,
                  };
                  const html = buildFinancialReportHtml(payload);
                  setReportPreviewHtml(html);
                  setPendingFinancialReport(html);
                }}
              >
                Generate &amp; Preview
              </Button>
              {pendingFinancialReport && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => downloadPdfFile(pendingFinancialReport, `financial-report-${new Date().toISOString().slice(0, 10)}.pdf`)}
                  >
                    Download PDF
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setPendingFinancialReport(null); setReportPreviewHtml(null); }}>Clear</Button>
                </>
              )}
            </div>
          </SectionCard>

          {reportPreviewHtml && (
            <SectionCard title="Preview">
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                <iframe
                  srcDoc={reportPreviewHtml}
                  title="Financial Report Preview"
                  className="h-[600px] w-full bg-white"
                  sandbox="allow-same-origin"
                />
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {/* RFQ Approve + Price Edit Modal */}
      {rfqApproveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setRfqApproveModal(null); }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
              <div>
                <div className="text-base font-semibold text-slate-900 dark:text-slate-100">Set prices before approving</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{rfqApproveModal.rfq.customer_name} · {rfqApproveModal.rfq.customer_email}</div>
              </div>
              <button type="button" onClick={() => setRfqApproveModal(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
              </button>
            </div>

            <div className="px-6 py-4 space-y-3">
              <div className="grid grid-cols-[1fr_60px_100px_100px] gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 pb-1">
                <span>Item</span><span className="text-center">Qty</span><span className="text-right">Unit price</span><span className="text-right">Total</span>
              </div>
              {rfqApproveModal.items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_60px_100px_100px] items-center gap-2">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{item.product_name}</span>
                  <span className="text-center text-sm text-slate-600 dark:text-slate-300">{item.quantity}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm text-slate-900 outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    value={item.unit_price}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setRfqApproveModal((prev) => ({
                        ...prev,
                        items: prev.items.map((it, i) => i === idx ? { ...it, unit_price: val } : it),
                      }));
                    }}
                  />
                  <span className="text-right text-sm text-slate-600 dark:text-slate-300">
                    {new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(item.unit_price * item.quantity)}
                  </span>
                </div>
              ))}

              <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Grand total</span>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
                    rfqApproveModal.items.reduce((sum, it) => sum + it.unit_price * it.quantity, 0)
                  )}
                </span>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 shrink-0">Validity (days)</label>
                <input
                  type="number"
                  min="1"
                  className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  value={rfqApproveModal.validityDays}
                  onChange={(e) => setRfqApproveModal((prev) => ({ ...prev, validityDays: Math.max(1, parseInt(e.target.value) || 30) }))}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
              <Button variant="secondary" onClick={() => setRfqApproveModal(null)}>Cancel</Button>
              <Button onClick={async () => {
                const { rfq, items, validityDays } = rfqApproveModal;
                setRfqApproveModal(null);
                await approveRfq(rfq.id, items, validityDays);
              }}>
                Confirm & Send
              </Button>
            </div>
          </div>
        </div>
      )}

      {previewInvoice ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShareMenu(null);
              setPreviewInvoiceId(null);
            }
          }}
        >
          <div className="ea-dialog w-full max-w-3xl max-h-[90vh] overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">Invoice preview</div>
                <div className="text-xs text-slate-600">Generated from your catalogue and invoice inputs.</div>
              </div>
              <div className="flex items-center gap-2">
                <ShareDropdown kind="invoice" record={previewInvoice} customer={previewCustomer} product={previewProduct} />
                <Button
                  variant="secondary"
                  onClick={() => downloadInvoice(previewInvoice, previewCustomer, previewProduct)}
                >
                  Download
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setShareMenu(null);
                    setPreviewInvoiceId(null);
                  }}
                  className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="max-h-[calc(90vh-64px)] overflow-auto p-6 text-sm text-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 max-w-[240px] flex-col items-start">
                  {workspaceLogo ? (
                    <img src={workspaceLogo} alt="Company logo" className="mb-3 block h-auto max-h-20 w-auto max-w-full self-start object-contain object-left" />
                  ) : null}
                  <div className="text-lg font-semibold text-slate-900">{workspaceName || "EnterprateAI"}</div>
                  <div className="text-xs text-slate-500">Invoice</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Invoice ID</div>
                  <div className="text-sm font-semibold text-slate-900">{previewInvoice.invoice_id || `INV-${previewInvoice.id.substring(0, 8).toUpperCase()}`}</div>
                  <div className="mt-2 text-xs text-slate-500">Status</div>
                  <div className="text-sm font-semibold text-slate-900">{previewInvoice.status}</div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-600">Bill to</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">{previewCustomer?.name || "Customer"}</div>
                  {previewCustomer?.address ? <div className="text-xs text-slate-500">{previewCustomer.address}</div> : null}
                  <div className="mt-2 text-xs text-slate-500">Payment terms: {formatPaymentTerms(previewCustomer?.payment_terms)}</div>
                  {previewInvoice.due_date ? <div className="mt-1 text-xs text-slate-500">Due date: {new Date(previewInvoice.due_date).toLocaleDateString()}</div> : null}
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-600">Invoice summary</div>
                  <div className="mt-2 text-xs text-slate-500">Grand Total</div>
                  <div className="text-lg font-semibold text-slate-900">{formatMoney(getDocumentGrandTotal(previewInvoice))}</div>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-slate-200">
                <div className="grid grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  <div className="col-span-6">Item</div>
                  <div className="col-span-2 text-right">Qty</div>
                  <div className="col-span-2 text-right">Unit</div>
                  <div className="col-span-2 text-right">Subtotal</div>
                </div>
                {(Array.isArray(previewInvoice.items) && previewInvoice.items.length ? previewInvoice.items : [{
                  product_name: previewProduct?.name || previewInvoice.product_name || "Product / Service",
                  quantity: previewInvoice.quantity,
                  unit_price: previewInvoice.unit_price,
                  unit_cost_of_sales: previewInvoice.unit_cost_of_sales,
                  subtotal_amount: previewInvoice.subtotal_amount,
                }]).map((item, index) => {
                  const qty = Number(item.quantity || 0);
                  const unitFull = Number(item.unit_price || 0) + Number(item.unit_cost_of_sales || 0);
                  const subtotalFull = unitFull * qty;
                  return (
                    <div key={`${item.product_name || "item"}-${index}`} className="grid grid-cols-12 gap-2 px-3 py-3 text-sm text-slate-700">
                      <div className="col-span-6">{item.product_name || "Product / Service"}</div>
                      <div className="col-span-2 text-right">{qty}</div>
                      <div className="col-span-2 text-right">{formatMoney(unitFull)}</div>
                      <div className="col-span-2 text-right font-semibold text-slate-900">{formatMoney(subtotalFull)}</div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex justify-end border-t border-slate-200 pt-3">
                <div className="text-sm">
                  <span className="mr-6 text-slate-500">Grand Total</span>
                  <span className="font-semibold text-slate-900">{formatMoney(getDocumentGrandTotal(previewInvoice))}</span>
                </div>
              </div>

              <div className="mt-4 text-xs text-slate-500">
                Thank you for your business. If you have questions about this invoice, contact us to update details.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {previewQuote ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShareMenu(null);
              setPreviewQuoteId(null);
            }
          }}
        >
          <div className="ea-dialog w-full max-w-3xl max-h-[90vh] overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">Quotation preview</div>
                <div className="text-xs text-slate-600">Generated from your catalogue and quotation inputs.</div>
              </div>
              <div className="flex items-center gap-2">
                <ShareDropdown kind="quote" record={previewQuote} customer={previewQuoteCustomer} product={previewQuoteProduct} />
                <Button
                  variant="secondary"
                  onClick={() => downloadQuote(previewQuote, previewQuoteCustomer, previewQuoteProduct)}
                >
                  Download
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setShareMenu(null);
                    setPreviewQuoteId(null);
                  }}
                  className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="max-h-[calc(90vh-64px)] overflow-auto p-6 text-sm text-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 max-w-[240px] flex-col items-start">
                  {workspaceLogo ? (
                    <img src={workspaceLogo} alt="Company logo" className="mb-3 block h-auto max-h-20 w-auto max-w-full self-start object-contain object-left" />
                  ) : null}
                  <div className="text-lg font-semibold text-slate-900">{workspaceName || "EnterprateAI"}</div>
                  <div className="text-xs text-slate-500">Sales quotation</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Quotation ID</div>
                  <div className="text-sm font-semibold text-slate-900">{previewQuote.quotation_id || `QUO-${previewQuote.id.substring(0, 8).toUpperCase()}`}</div>
                  <div className="mt-2 text-xs text-slate-500">Status</div>
                  <div className="text-sm font-semibold text-slate-900">{previewQuote.status || "draft"}</div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-xs font-semibold text-slate-600">Prepared for</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{previewQuoteCustomer?.name || "Customer"}</div>
                    {previewQuoteCustomer?.address ? <div className="text-xs text-slate-500">{previewQuoteCustomer.address}</div> : null}
                    <div className="mt-2 text-xs text-slate-500">Payment terms: {formatPaymentTerms(previewQuoteCustomer?.payment_terms)}</div>
                    {previewQuote.due_date ? <div className="mt-1 text-xs text-slate-500">Due date: {new Date(previewQuote.due_date).toLocaleDateString()}</div> : null}
                  </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-600">Quotation summary</div>
                  <div className="mt-2 text-xs text-slate-500">Grand Total</div>
                  <div className="text-lg font-semibold text-slate-900">{formatMoney(getDocumentGrandTotal(previewQuote))}</div>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-slate-200">
                <div className="grid grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  <div className="col-span-6">Item</div>
                  <div className="col-span-2 text-right">Qty</div>
                  <div className="col-span-2 text-right">Unit</div>
                  <div className="col-span-2 text-right">Subtotal</div>
                </div>
                {(Array.isArray(previewQuote.items) && previewQuote.items.length ? previewQuote.items : [{
                  product_name: previewQuoteProduct?.name || previewQuote.product_name || "Product / Service",
                  quantity: previewQuote.quantity,
                  unit_price: previewQuote.unit_price,
                  subtotal_amount: previewQuote.subtotal_amount,
                }]).map((item, index) => (
                  <div key={`${item.product_name || "item"}-${index}`} className="grid grid-cols-12 gap-2 px-3 py-3 text-sm text-slate-700">
                    <div className="col-span-6">{item.product_name || "Product / Service"}</div>
                    <div className="col-span-2 text-right">{item.quantity}</div>
                    <div className="col-span-2 text-right">{formatMoney(item.unit_price)}</div>
                    <div className="col-span-2 text-right font-semibold text-slate-900">{formatMoney(item.subtotal_amount || (Number(item.unit_price || 0) * Number(item.quantity || 0)))}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex justify-end border-t border-slate-200 pt-3">
                <div className="text-sm">
                  <span className="mr-6 text-slate-500">Grand Total</span>
                  <span className="font-semibold text-slate-900">{formatMoney(getDocumentGrandTotal(previewQuote))}</span>
                </div>
              </div>

              <div className="mt-4 text-xs text-slate-500">
                This quotation is valid for {previewQuote.validity_days || 30} days unless otherwise stated.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {shareMenu ? (
        <div
          data-financial-share-menu
          className="fixed z-[120] min-w-[170px] rounded-2xl border border-slate-200 bg-white p-1 shadow-2xl"
          style={{ top: `${shareMenu.top}px`, right: `${Math.max(12, shareMenu.right)}px` }}
        >
          <button
            type="button"
            onClick={async () => {
              const { kind, record, customer, product } = shareMenu;
              setShareMenu(null);
              setShareDialog({ kind, record, customer, product });
            }}
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Copy link
          </button>
          <button
            type="button"
            onClick={async () => {
              const { kind, record, customer, product } = shareMenu;
              setShareMenu(null);
              setShareDialog({ kind, record, customer, product });
            }}
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Via mail
          </button>
        </div>
      ) : null}

      {shareNotice ? (
        <div className="fixed left-1/2 top-4 z-[130] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-2xl">
          {shareNotice}
        </div>
      ) : null}

      {shareDialog ? (
        <DocumentShareModal
          title="Share financial document"
          subtitle="Choose who can use this document link before generating it."
          defaultEmail={shareDialog.customer?.email || ""}
          onClose={() => setShareDialog(null)}
          onGenerate={(config) =>
            shareFinancialDocument(
              shareDialog.kind,
              shareDialog.record,
              shareDialog.customer,
              shareDialog.product,
              config
            )
          }
          onSendEmail={sendFinancialShareEmail}
          getMailtoHref={({ url, email, expiryDays }) => {
            const isInvoice = shareDialog.kind === "invoice";
            const recipient = encodeURIComponent(email || shareDialog.customer?.email || "");
            const reference = isInvoice
              ? shareDialog.record?.invoice_id || shareDialog.record?.id || ""
              : shareDialog.record?.quotation_id || shareDialog.record?.id || "";
            const subject = encodeURIComponent(`${isInvoice ? "Invoice" : "Quotation"} ${reference}`);
            const body = encodeURIComponent(
              `Hi${shareDialog.customer?.name ? ` ${shareDialog.customer.name}` : ""},\n\nHere is your shared document link:\n${url}\n\nThis link expires in ${expiryDays} day${expiryDays !== 1 ? "s" : ""}.\n\nThank you.`
            );
            return `mailto:${recipient}?subject=${subject}&body=${body}`;
          }}
        />
      ) : null}
    </div>
  );
}
