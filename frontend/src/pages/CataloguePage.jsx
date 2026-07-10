import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import html2pdf from "html2pdf.js";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import Input from "../components/Input";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import SegmentedTabs from "../components/SegmentedTabs";
import IntegrationPanel from "../components/IntegrationPanel";
import ReportTable, { StatusBadge } from "../components/ReportTable";
import { formatCurrency } from "../lib/format";
import WorkspacePrompt from "../components/WorkspacePrompt";
import { CatalogueIllustration, IllustrationCard } from "../components/Illustrations";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import { hasFeatureAccess } from "../lib/permissions";

export default function CataloguePage() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);
  const workspaceName = useWorkspaceStore((s) => s.workspaceName);
  const workspaceLogo = useWorkspaceStore((s) => s.workspaceLogo);
  const isMemberMode = useWorkspaceStore((s) => s.isMemberMode);
  const memberPermissionType = useWorkspaceStore((s) => s.memberPermissionType);
  const memberPermissions = useWorkspaceStore((s) => s.memberPermissions);
  const navigate = useNavigate();

  function canCatalogueFeature(featureKey) {
    return !isMemberMode || hasFeatureAccess("catalogue", featureKey, memberPermissionType, memberPermissions);
  }

  const canViewCatalogueOverview = canCatalogueFeature("view_catalogue");

  function firstAccessibleCatalogueTab() {
    if (canViewCatalogueOverview) return "overview";
    if (canCatalogueFeature("manage_products")) return "products";
    if (canCatalogueFeature("manage_customers")) return "customers";
    if (canCatalogueFeature("manage_vendors")) return "vendors";
    return "overview";
  }

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [catalogueIntegrations, setCatalogueIntegrations] = useState({
    crm: { hubspot: "not_connected", salesforce: "not_connected", zoho_crm: "not_connected" },
    inventory: { shopify: "not_connected", woo_commerce: "not_connected", square: "not_connected" }
  });
  const ARCHIVE_WARNING_DAYS = 60;
  const ARCHIVE_EXPIRE_DAYS = 90;

  const [editingProductId, setEditingProductId] = useState(null);
  const [editingCustomerId, setEditingCustomerId] = useState(null);
  const [editingVendorId, setEditingVendorId] = useState(null);
  const [activeTab, setActiveTab] = useState(() => firstAccessibleCatalogueTab());
  const [catalogueDrill, setCatalogueDrill] = useState(null); // { label, type, items }
  const [reportFinancials, setReportFinancials] = useState({ invoices: [], expenses: [] });
  const [pendingCatalogueReport, setPendingCatalogueReport] = useState(null);
  const [reportFilter, setReportFilter] = useState({ products: true, customers: true, vendors: true });
  const [reportPreviewHtml, setReportPreviewHtml] = useState(null);
  const currency = useWorkspaceStore((s) => s.currency);

  // Reset to overview if current tab is locked by feature permissions
  useEffect(() => {
    const locked = {
      overview: !canViewCatalogueOverview,
      products: !canCatalogueFeature("manage_products"),
      customers: !canCatalogueFeature("manage_customers"),
      vendors: !canCatalogueFeature("manage_vendors"),
    };
    if (locked[activeTab]) setActiveTab(firstAccessibleCatalogueTab());
  }, [activeTab, canViewCatalogueOverview, isMemberMode, memberPermissionType, memberPermissions]); // eslint-disable-line

  const reportRows = useMemo(() => {
    const cur = currency || "GBP";
    const activeProducts = products.filter(p => !p.archived);
    const activeCustomers = customers.filter(c => !c.archived);
    const activeVendors = vendors.filter(v => !v.archived);
    const paidInvoices = (reportFinancials.invoices || []).filter(i => String(i.status || "").toLowerCase() === "paid");
    const paidExpenses = (reportFinancials.expenses || []).filter(e => String(e.status || "").toLowerCase() === "paid");
    const customerRevMap = new Map();
    paidInvoices.forEach(inv => {
      const key = inv.customer_name || inv.customer_id || "unknown";
      const prev = customerRevMap.get(key) || { name: key, revenue: 0, invoices: 0 };
      customerRevMap.set(key, { ...prev, revenue: prev.revenue + Number(inv.total_amount || 0), invoices: prev.invoices + 1 });
    });
    const customerPendingMap = new Map();
    (reportFinancials.invoices || []).filter(i => String(i.status || "").toLowerCase() !== "paid").forEach(inv => {
      const key = inv.customer_name || inv.customer_id || "unknown";
      customerPendingMap.set(key, (customerPendingMap.get(key) || 0) + Number(inv.total_amount || 0));
    });
    const vendorSpendMap = new Map();
    paidExpenses.forEach(e => {
      const key = e.vendor_name || e.counterparty_name || "unknown";
      vendorSpendMap.set(key, (vendorSpendMap.get(key) || 0) + Number(e.price || 0));
    });
    const productRows = activeProducts.map(p => {
      const sellPrice = Math.max(0, Number(p.base_price || 0) - Number(p.discount || 0));
      const cos = Number(p.cost_of_sales || p.unit_cost || 0);
      const margin = sellPrice > 0 ? (((sellPrice - cos) / sellPrice) * 100).toFixed(1) : null;
      return { name: p.name || "—", category: p.category || p.product_type || "—", price: formatCurrency(sellPrice, cur), cos: formatCurrency(cos, cur), margin: margin != null ? `${margin}%` : "—" };
    });
    const customerRows = [...customerRevMap.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([key, c]) => {
        const cat = activeCustomers.find(x => x.name === key);
        return { name: c.name, invoices: c.invoices, revenue: formatCurrency(c.revenue, cur), outstanding: formatCurrency(customerPendingMap.get(key) || 0, cur), terms: cat?.payment_terms ? `${cat.payment_terms}d` : "—" };
      });
    activeCustomers.forEach(c => {
      if (!customerRows.some(r => r.name === c.name)) {
        customerRows.push({ name: c.name || "—", invoices: 0, revenue: formatCurrency(0, cur), outstanding: formatCurrency(0, cur), terms: c.payment_terms ? `${c.payment_terms}d` : "—" });
      }
    });
    const vendorRows = activeVendors.map(v => ({
      name: v.name || "—", category: v.vendor_type || v.category || "—",
      terms: v.payment_terms ? `${v.payment_terms}d` : "—",
      spent: formatCurrency(vendorSpendMap.get(v.name) || 0, cur),
    }));
    return { productRows, customerRows, vendorRows, cur };
  }, [products, customers, vendors, reportFinancials, currency]);

  const [productForm, setProductForm] = useState({
    name: "",
    type: "service",
    base_price: "",
    cost_of_sales: "",
    discount: "",
    freight_cost: ""
  });
  const [customerForm, setCustomerForm] = useState({
    name: "",
    address: "",
    email: "",
    phone_number: "",
    payment_terms: "14",
    industry: ""
  });
  const [vendorForm, setVendorForm] = useState({
    name: "",
    address: "",
    email: "",
    phone_number: "",
    payment_terms: "14",
    industry: "",
    product_type: "product",
    product_name: "",
    price: ""
  });

  const paymentTermOptions = ["7", "14", "30", "45", "60", "90", "Other"];
  const INDUSTRY_OPTIONS = [
    "IT",
    "Marketing",
    "Consulting",
    "Accounting",
    "Legal",
    "HR",
    "Design",
    "Sales",
    "Operations",
    "Customer Support",
    "Healthcare",
    "Education",
    "Construction",
    "Other"
  ];
  const customerIndustryCategory = INDUSTRY_OPTIONS.includes(customerForm.industry)
    ? customerForm.industry
    : customerForm.industry
      ? "Other"
      : "";

  function CardIcon({ tone = "bg-brand-50 text-brand-600", children }) {
    return (
      <div className={`flex h-9 w-9 items-center justify-center rounded-2xl ${tone}`}>
        {children}
      </div>
    );
  }

  function daysSince(date) {
    const ts = date ? new Date(date).getTime() : NaN;
    if (!Number.isFinite(ts)) return 0;
    return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  }

  function normalizeHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function parseCsv(text) {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return { headers: [], rows: [] };
    const rawHeaders = lines[0].split(",").map((h) => h.trim());
    const headers = rawHeaders.map(normalizeHeader);
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = cells[idx] ?? "";
      });
      return row;
    });
    return { headers, rows };
  }

  function coercePaymentTerms(value) {
    const num = parseInt(String(value || "").trim(), 10);
    if (!Number.isFinite(num) || num <= 0) return "14";
    return String(num);
  }

  function formatPaymentTerms(value) {
    const str = String(value || "").trim();
    const num = parseInt(str, 10);
    if (str && Number.isFinite(num) && String(num) === str) return `${num} days`;
    return str || "Payment terms";
  }

  function buildCatalogueReportHtml({ productRows, customerRows, vendorRows, cur }) {
    const col = (cells) => cells.map((c) => `<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;">${c ?? "—"}</td>`).join("");
    const hdr = (cells) => cells.map((c) => `<th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;border-bottom:2px solid #e2e8f0;text-align:left;">${c}</th>`).join("");
    const table = (headers, rows) => `
      <table style="width:100%;border-collapse:collapse;margin-top:8px;">
        <thead><tr>${hdr(headers)}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${col(r)}</tr>`).join("")}${!rows.length ? `<tr><td colspan="${headers.length}" style="padding:10px;font-size:12px;color:#94a3b8;text-align:center;">No data.</td></tr>` : ""}</tbody>
      </table>`;
    const section = (title, sub, content) => `
      <div style="margin-top:24px;">
        <div style="font-size:14px;font-weight:600;color:#0f172a;">${title}</div>
        ${sub ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${sub}</div>` : ""}
        ${content}
      </div>`;
    const logoSrc = workspaceLogo && String(workspaceLogo).trim() ? workspaceLogo : null;
    return `<!doctype html><html><head><meta charset="utf-8"/><title>Catalogue Report</title>
<style>*{color:#0f172a!important;}body{font-family:Inter,Arial,sans-serif;background:#fff;padding:32px;font-size:13px;line-height:1.5;}</style>
</head><body>
<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;">
  <div>
    ${logoSrc ? `<img src="${logoSrc}" style="display:block;max-width:140px;max-height:56px;margin-bottom:10px;"/>` : ""}
    <div style="font-size:20px;font-weight:700;">${workspaceName || "EnterprateAI"}</div>
    <div style="font-size:12px;color:#64748b;">Catalogue Report</div>
  </div>
  <div style="text-align:right;font-size:11px;color:#64748b;">${new Date().toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"})}</div>
</div>
${productRows !== null ? section("Products & Services","Pricing, cost of sales, and margin per item.",table(["Name","Category","Sell price","Cost of sales","Margin"],productRows.map((p)=>[p.name,p.category,p.price,p.cos,p.margin]))) : ""}
${customerRows !== null ? section("Customers","Revenue earned and outstanding per customer.",table(["Name","Invoices","Revenue earned","Outstanding","Payment terms"],customerRows.map((c)=>[c.name,c.invoices,c.revenue,c.outstanding,c.terms]))) : ""}
${vendorRows !== null ? section("Vendors","Supplier list and total spend from paid expenses.",table(["Name","Category","Payment terms","Total spent"],vendorRows.map((v)=>[v.name,v.category,v.terms,v.spent]))) : ""}
</body></html>`;
  }

  async function downloadCatalogueReport({ productRows, customerRows, vendorRows, cur }) {
    try {
      const html = buildCatalogueReportHtml({ productRows, customerRows, vendorRows, cur });
      const container = document.createElement("div");
      container.innerHTML = html;
      container.style.width = "210mm";
      container.style.padding = "12mm";
      container.style.boxSizing = "border-box";
      container.style.fontSize = "13px";
      container.style.background = "#ffffff";
      document.body.appendChild(container);
      await html2pdf()
        .set({
          filename: `catalogue-report-${new Date().toISOString().slice(0, 10)}.pdf`,
          margin: [10, 10, 10, 10],
          pagebreak: { mode: ["css", "legacy", "avoid-all"] },
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 3, useCORS: true, windowWidth: 794, windowHeight: 1123, backgroundColor: "#ffffff", letterRendering: true },
          jsPDF: { unit: "pt", format: "a4", orientation: "portrait", compress: true }
        })
        .from(container)
        .save();
      document.body.removeChild(container);
    } catch (e) {
      setError("Unable to generate the PDF report. Please try again.");
    }
  }

  async function handleProductImport(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Upload a CSV file for products.");
      return;
    }
    const text = await file.text();
    const { rows } = parseCsv(text);
    if (!rows.length) {
      setError("No rows found in the product CSV.");
      return;
    }
    const next = [...products];
    rows.forEach((row) => {
      const name = row.product_name || row.name || "";
      const type = row.product_type || row.type || "service";
      const basePrice = row.base_price || row.price || "";
      if (!name || !String(basePrice).trim()) return;
      next.unshift({
        id: crypto.randomUUID(),
        name: String(name).trim(),
        type: String(type).trim() === "product" ? "product" : "service",
        base_price: Number(basePrice || 0),
        cost_of_sales: Number(row.cost_of_sales || row.cost_of_service || row.unit_cost || 0),
        discount: Number(row.discount || 0),
        freight_cost: Number(row.freight_cost || row.freight || 0),
        archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    });
    setProducts(next);
    await persist({ products: next, customers, vendors });
  }

  async function handleCustomerImport(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Upload a CSV file for customers.");
      return;
    }
    const text = await file.text();
    const { rows } = parseCsv(text);
    if (!rows.length) {
      setError("No rows found in the customer CSV.");
      return;
    }
    const next = [...customers];
    rows.forEach((row) => {
      const name = row.customer_name || row.name || "";
      if (!name) return;
      next.unshift({
        id: crypto.randomUUID(),
        name: String(name).trim(),
        address: String(row.address || "").trim(),
        email: String(row.email || row.contact_email || "").trim(),
        phone_number: String(row.phone || row.phone_number || "").trim(),
        payment_terms: coercePaymentTerms(row.payment_terms),
        industry: String(row.industry || "").trim(),
        archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    });
    setCustomers(next);
    await persist({ products, customers: next, vendors });
  }

  async function handleVendorImport(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Upload a CSV file for vendors.");
      return;
    }
    const text = await file.text();
    const { rows } = parseCsv(text);
    if (!rows.length) {
      setError("No rows found in the vendor CSV.");
      return;
    }
    const next = [...vendors];
    rows.forEach((row) => {
      const name = row.vendor_name || row.name || "";
      const productName = row.product_name || "";
      const price = row.price || "";
      if (!name || !productName || !String(price).trim()) return;
      next.unshift({
        id: crypto.randomUUID(),
        name: String(name).trim(),
        address: String(row.address || "").trim(),
        email: String(row.email || row.contact_email || "").trim(),
        phone_number: String(row.phone || row.phone_number || "").trim(),
        payment_terms: coercePaymentTerms(row.payment_terms),
        industry: String(row.industry || "").trim(),
        product_type: String(row.product_type || "product").trim() === "service" ? "service" : "product",
        product_name: String(productName).trim(),
        price: Number(price || 0),
        archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    });
    setVendors(next);
    await persist({ products, customers, vendors: next });
  }

  if (!workspaceId) {
    return <WorkspacePrompt />;
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
        setReportFinancials({
          invoices: ws?.data?.financials?.invoices || [],
          expenses: ws?.data?.financials?.expenses || [],
        });
        const cat = ws?.data?.catalogue || {};
        const integ = ws?.data?.integrations || {};
        const nextProducts = Array.isArray(cat.products) ? cat.products : [];
        const nextCustomers = Array.isArray(cat.customers) ? cat.customers : [];
        const nextVendors = Array.isArray(cat.vendors) ? cat.vendors : [];
        setProducts(nextProducts);
        setCustomers(nextCustomers);
        setVendors(nextVendors);
        setCatalogueIntegrations({
          crm: {
            hubspot: integ?.catalogue?.crm?.hubspot || "not_connected",
            salesforce: integ?.catalogue?.crm?.salesforce || "not_connected",
            zoho_crm: integ?.catalogue?.crm?.zoho_crm || "not_connected"
          },
          inventory: {
            shopify: integ?.catalogue?.inventory?.shopify || "not_connected",
            woo_commerce: integ?.catalogue?.inventory?.woo_commerce || "not_connected",
            square: integ?.catalogue?.inventory?.square || "not_connected"
          }
        });
      } catch (e) {
        if (String(e?.message || "").includes("HTTP 404")) return;
        setError(e instanceof Error ? e.message : "Failed to load catalogue");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [workspaceId, setWorkspaceId, setWorkspaceName]);

  useEffect(() => {
    if (!workspaceId) return;
    const normalizeArchivedAt = (list) =>
      list.map((item) => {
        if (!item.archived) return item;
        if (item.archived_at) return item;
        return { ...item, archived_at: item.updated_at || item.created_at || new Date().toISOString() };
      });
    const stripExpired = (list) => {
      const remaining = list.filter((item) => {
        if (!item.archived) return true;
        const age = daysSince(item.archived_at || item.updated_at || item.created_at);
        return age < ARCHIVE_EXPIRE_DAYS;
      });
      return remaining;
    };
    const nextProducts = stripExpired(normalizeArchivedAt(products));
    const nextCustomers = stripExpired(normalizeArchivedAt(customers));
    const nextVendors = stripExpired(normalizeArchivedAt(vendors));
    const changed =
      nextProducts.length !== products.length ||
      nextCustomers.length !== customers.length ||
      nextVendors.length !== vendors.length ||
      nextProducts.some((p, i) => p.archived_at !== products[i]?.archived_at) ||
      nextCustomers.some((c, i) => c.archived_at !== customers[i]?.archived_at) ||
      nextVendors.some((v, i) => v.archived_at !== vendors[i]?.archived_at);
    if (changed) {
      setProducts(nextProducts);
      setCustomers(nextCustomers);
      setVendors(nextVendors);
      persist({ products: nextProducts, customers: nextCustomers, vendors: nextVendors });
    }
  }, [workspaceId, products, customers, vendors]);

  async function persist(next) {
    await apiRequest("/validation/me", "PATCH", { data: { catalogue: next } });
  }
  async function persistCatalogueIntegrations(next) {
    await apiRequest("/validation/me", "PATCH", { data: { integrations: { catalogue: next } } });
  }

  function resetProductForm() {
    setProductForm({ name: "", type: "service", base_price: "", cost_of_sales: "", discount: "", freight_cost: "" });
    setEditingProductId(null);
  }
  function resetCustomerForm() {
    setCustomerForm({ name: "", address: "", email: "", phone_number: "", payment_terms: "14", industry: "" });
    setEditingCustomerId(null);
  }
  function resetVendorForm() {
    setVendorForm({
      name: "",
      address: "",
      email: "",
      phone_number: "",
      payment_terms: "14",
      industry: "",
      product_type: "product",
      product_name: "",
      price: ""
    });
    setEditingVendorId(null);
  }

  async function upsertProduct() {
    if (!productForm.name.trim() || !String(productForm.base_price).trim()) {
      setError("Product name and base price are required.");
      return;
    }
    setError(null);
    const next = products.map((p) => ({ ...p }));
    const payload = {
      id: editingProductId || crypto.randomUUID(),
      name: productForm.name.trim(),
      type: productForm.type,
      base_price: Number(productForm.base_price || 0),
      cost_of_sales: Number(productForm.cost_of_sales || 0),
      discount: Number(productForm.discount || 0),
      freight_cost: Number(productForm.freight_cost || 0),
      archived: false,
      updated_at: new Date().toISOString()
    };
    if (editingProductId) {
      const idx = next.findIndex((p) => p.id === editingProductId);
      if (idx >= 0) next[idx] = { ...next[idx], ...payload };
    } else {
      next.unshift({ ...payload, created_at: new Date().toISOString() });
    }
    setProducts(next);
    await persist({ products: next, customers, vendors });
    resetProductForm();
  }

  async function upsertCustomer() {
    if (!customerForm.name.trim()) {
      setError("Customer name is required.");
      return;
    }
    setError(null);
    const next = customers.map((c) => ({ ...c }));
    const payload = {
      id: editingCustomerId || crypto.randomUUID(),
      name: customerForm.name.trim(),
      address: customerForm.address.trim(),
      email: customerForm.email.trim(),
      phone_number: customerForm.phone_number.trim(),
      payment_terms: coercePaymentTerms(customerForm.payment_terms),
      industry: customerForm.industry.trim(),
      archived: false,
      updated_at: new Date().toISOString()
    };
    if (editingCustomerId) {
      const idx = next.findIndex((c) => c.id === editingCustomerId);
      if (idx >= 0) next[idx] = { ...next[idx], ...payload };
    } else {
      next.unshift({ ...payload, created_at: new Date().toISOString() });
    }
    setCustomers(next);
    await persist({ products, customers: next, vendors });
    resetCustomerForm();
  }

  async function upsertVendor() {
    if (!vendorForm.name.trim() || !vendorForm.product_name.trim() || !String(vendorForm.price).trim()) {
      setError("Vendor name, product name, and price are required.");
      return;
    }
    setError(null);
    const next = vendors.map((v) => ({ ...v }));
    const payload = {
      id: editingVendorId || crypto.randomUUID(),
      name: vendorForm.name.trim(),
      address: vendorForm.address.trim(),
      email: vendorForm.email.trim(),
      phone_number: vendorForm.phone_number.trim(),
      payment_terms: coercePaymentTerms(vendorForm.payment_terms),
      industry: vendorForm.industry.trim(),
      product_type: vendorForm.product_type,
      product_name: vendorForm.product_name.trim(),
      price: Number(vendorForm.price || 0),
      archived: false,
      updated_at: new Date().toISOString()
    };
    if (editingVendorId) {
      const idx = next.findIndex((v) => v.id === editingVendorId);
      if (idx >= 0) next[idx] = { ...next[idx], ...payload };
    } else {
      next.unshift({ ...payload, created_at: new Date().toISOString() });
    }
    setVendors(next);
    await persist({ products, customers, vendors: next });
    resetVendorForm();
  }

  async function archiveEntity(kind, id) {
    const mutator = (list) =>
      list.map((it) =>
        it.id === id
          ? { ...it, archived: true, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          : it
      );
    const nextProducts = kind === "products" ? mutator(products) : products;
    const nextCustomers = kind === "customers" ? mutator(customers) : customers;
    const nextVendors = kind === "vendors" ? mutator(vendors) : vendors;
    setProducts(nextProducts);
    setCustomers(nextCustomers);
    setVendors(nextVendors);
    await persist({ products: nextProducts, customers: nextCustomers, vendors: nextVendors });
  }

  async function restoreEntity(kind, id) {
    const mutator = (list) =>
      list.map((it) =>
        it.id === id ? { ...it, archived: false, archived_at: null, updated_at: new Date().toISOString() } : it
      );
    const nextProducts = kind === "products" ? mutator(products) : products;
    const nextCustomers = kind === "customers" ? mutator(customers) : customers;
    const nextVendors = kind === "vendors" ? mutator(vendors) : vendors;
    setProducts(nextProducts);
    setCustomers(nextCustomers);
    setVendors(nextVendors);
    await persist({ products: nextProducts, customers: nextCustomers, vendors: nextVendors });
  }

  async function deleteEntity(kind, id) {
    const filterer = (list) => list.filter((it) => it.id !== id);
    const nextProducts = kind === "products" ? filterer(products) : products;
    const nextCustomers = kind === "customers" ? filterer(customers) : customers;
    const nextVendors = kind === "vendors" ? filterer(vendors) : vendors;
    setProducts(nextProducts);
    setCustomers(nextCustomers);
    setVendors(nextVendors);
    await persist({ products: nextProducts, customers: nextCustomers, vendors: nextVendors });
  }

  const activeProducts = useMemo(() => products.filter((p) => !p.archived), [products]);
  const activeCustomers = useMemo(() => customers.filter((c) => !c.archived), [customers]);
  const activeVendors = useMemo(() => vendors.filter((v) => !v.archived), [vendors]);
  const archivedProducts = useMemo(() => products.filter((p) => p.archived), [products]);
  const archivedCustomers = useMemo(() => customers.filter((c) => c.archived), [customers]);
  const archivedVendors = useMemo(() => vendors.filter((v) => v.archived), [vendors]);

  const hasArchiveWarning = useMemo(() => {
    const list = [...archivedProducts, ...archivedCustomers, ...archivedVendors];
    return list.some((item) => daysSince(item.archived_at || item.updated_at || item.created_at) >= ARCHIVE_WARNING_DAYS);
  }, [archivedProducts, archivedCustomers, archivedVendors]);

  const catalogueIntegrationMeta = {
    hubspot: { label: "HubSpot", note: "Sync customer records and lifecycle data." },
    salesforce: { label: "Salesforce", note: "Connect accounts and contact lists." },
    zoho_crm: { label: "Zoho CRM", note: "Pull contacts and company profiles." },
    shopify: { label: "Shopify", note: "Sync products and inventory." },
    woo_commerce: { label: "WooCommerce", note: "Import products and stock levels." },
    square: { label: "Square", note: "Sync catalog and item pricing." }
  };

  function statusBadge(status) {
    if (status === "connected") return { label: "Connected", tone: "emerald" };
    if (status === "pending") return { label: "Pending", tone: "amber" };
    return { label: "Not connected", tone: "slate" };
  }

  function CatalogueLogo({ type }) {
    const icons = {
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
      zoho_crm: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#E42527"/>
          <text x="18" y="25" textAnchor="middle" fill="white" fontSize="17" fontWeight="bold" fontFamily="Arial, sans-serif">Z</text>
        </svg>
      ),
      shopify: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#5C6AC4"/>
          <path d="M22.5 10.5c-.2 0-.3.1-.4.2l-.9.9c-.5-.3-1.1-.5-1.7-.5-1.9 0-2.8 1.4-3.1 2.8l-1.5.5-.3.9h1.2L15 26h11l-.8-11.5.8-.2c.2-.8.2-1.2.2-1.2-.1-1.6-1.3-2.6-3.7-2.6zm-1 1.5c.8 0 1.5.3 2 .7l-.7.7c-.3-.2-.8-.4-1.3-.4-.5 0-.9.2-1.2.5l-.5-.5c.4-.6 1-1 1.7-1z" fill="white" opacity="0.9"/>
        </svg>
      ),
      woo_commerce: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#7F54B3"/>
          <path d="M8 12h20a1 1 0 011 1v2H7v-2a1 1 0 011-1z" fill="white" opacity="0.9"/>
          <path d="M7 15h22l-2 9H9l-2-9z" fill="white" opacity="0.7"/>
          <path d="M12 18l2 4M24 18l-2 4M18 18v4" stroke="#7F54B3" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      square: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#1A1A1A"/>
          <rect x="9" y="9" width="18" height="18" rx="4" fill="white"/>
          <rect x="14" y="14" width="8" height="8" rx="2" fill="#1A1A1A"/>
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

  async function updateCatalogueIntegration(section, key) {
    const current = catalogueIntegrations?.[section]?.[key] || "not_connected";
    const nextStatus = current === "connected" ? "not_connected" : "connected";
    const next = {
      ...catalogueIntegrations,
      [section]: { ...catalogueIntegrations[section], [key]: nextStatus }
    };
    setCatalogueIntegrations(next);
    await persistCatalogueIntegrations(next);
  }

  return (
    <div>
      <PageHeader
        title="Catalogue"
        description="Manage products, customers, and suppliers for reuse across invoices and documents."
        badge={{ text: "Beta", tone: "slate" }}
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
            ...(canViewCatalogueOverview ? [{ value: "overview", label: "Overview" }] : []),
            ...(canCatalogueFeature("manage_products") ? [{ value: "products", label: "Products" }] : []),
            ...(canCatalogueFeature("manage_customers") ? [{ value: "customers", label: "Customers" }] : []),
            ...(canCatalogueFeature("manage_vendors") ? [{ value: "vendors", label: "Vendors" }] : []),
            { value: "report", label: "Report" },
          ]}
        />
      </div>

      {activeTab === "overview" ? (
        <div className="mt-6 space-y-4">

          {/* Stat tiles */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { label: "Active products", type: "products", items: activeProducts, sub: archivedProducts.length ? `${archivedProducts.length} archived` : "All active", tone: "violet" },
              { label: "Active customers", type: "customers", items: activeCustomers, sub: archivedCustomers.length ? `${archivedCustomers.length} archived` : "All active", tone: "sky" },
              { label: "Active vendors", type: "vendors", items: activeVendors, sub: archivedVendors.length ? `${archivedVendors.length} archived` : "All active", tone: "amber" },
            ].map((kpi) => {
              const isOpen = catalogueDrill?.type === kpi.type;
              return (
                <button
                  key={kpi.label}
                  type="button"
                  onClick={() => setCatalogueDrill(isOpen ? null : { label: kpi.label, type: kpi.type, items: kpi.items })}
                  className={`rounded-2xl border bg-white p-4 shadow-sm text-left w-full transition hover:shadow-md ${isOpen ? "border-brand-400 ring-1 ring-brand-200" : "border-slate-200 hover:border-slate-300"}`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{kpi.label}</div>
                  <div className={`mt-1.5 text-3xl font-bold ${kpi.tone === "violet" ? "text-violet-600" : kpi.tone === "sky" ? "text-sky-600" : "text-amber-600"}`}>{kpi.items.length}</div>
                  <div className="mt-1 text-[11px] text-slate-400">{kpi.sub}</div>
                </button>
              );
            })}
          </div>

          {/* Drill-down panel */}
          {catalogueDrill && (
            <div className="rounded-2xl border border-brand-200 bg-white p-4 shadow-sm" ref={(el) => el?.scrollIntoView({ behavior: "smooth", block: "nearest" })}>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">{catalogueDrill.label}</span>
                <button type="button" onClick={() => setCatalogueDrill(null)} className="text-slate-400 hover:text-slate-600">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
              {catalogueDrill.items.length === 0 ? (
                <p className="text-[13px] text-slate-400 italic">No {catalogueDrill.type} yet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {catalogueDrill.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-4 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-800">{item.name || item.company_name || "—"}</div>
                        {catalogueDrill.type === "products" && (
                          <div className="text-[11px] text-slate-400">{item.category || "No category"} · Sell: {formatCurrency(Number(item.base_price || 0), currency)}</div>
                        )}
                        {catalogueDrill.type === "customers" && (
                          <div className="text-[11px] text-slate-400">{item.email || item.contact_email || "No email"}{item.payment_terms ? ` · ${item.payment_terms}d terms` : ""}</div>
                        )}
                        {catalogueDrill.type === "vendors" && (
                          <div className="text-[11px] text-slate-400">{item.email || item.contact_email || "No email"}</div>
                        )}
                      </div>
                      {catalogueDrill.type === "products" && (
                        <span className="shrink-0 text-sm font-semibold text-slate-700">{formatCurrency(Number(item.base_price || 0), currency)}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}


          <SectionCard
            title="Integrations"
            subtitle="Connect Zoho CRM to sync your products, customers and vendors."
            className="lg:col-span-3"
          >
            <IntegrationPanel providers={["zoho_crm"]} />
          </SectionCard>
        </div>
      ) : null}

      {activeTab !== "overview" ? (
      <div className="mt-6">
        {activeTab === "products" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          title="Products & Services"
          subtitle="Define what you sell and its pricing."
          className="lg:col-span-2"
          icon={
            <CardIcon>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 3h12l3 5-3 5H6L3 8l3-5Z" />
                <path d="M6 13v8h12v-8" />
              </svg>
            </CardIcon>
          }
        >
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="ea-label">Product / Service name *</div>
              <Input value={productForm.name} onChange={(e) => setProductForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Type</div>
                <select
                  className="ea-input"
                  value={productForm.type}
                  onChange={(e) => setProductForm((p) => ({ ...p, type: e.target.value }))}
                >
                  <option value="product">Product</option>
                  <option value="service">Service</option>
                </select>
              </div>
              <div>
                <div className="ea-label">Base price *</div>
                <Input
                  type="number"
                  min="0"
                  value={productForm.base_price}
                  onChange={(e) => setProductForm((p) => ({ ...p, base_price: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
              <div>
                <div className="ea-label">Cost of sales / service</div>
                <Input
                  type="number"
                  min="0"
                  value={productForm.cost_of_sales}
                  onChange={(e) => setProductForm((p) => ({ ...p, cost_of_sales: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Discount (optional)</div>
                <Input
                  type="number"
                  min="0"
                  value={productForm.discount}
                  onChange={(e) => setProductForm((p) => ({ ...p, discount: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Freight cost (optional)</div>
                <Input
                  type="number"
                  min="0"
                  value={productForm.freight_cost}
                  onChange={(e) => setProductForm((p) => ({ ...p, freight_cost: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upsertProduct}>{editingProductId ? "Update product" : "Add product"}</Button>
              {editingProductId ? (
                <Button variant="secondary" onClick={resetProductForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
          <div className="mt-5 border-t border-slate-200 pt-4">
            <div className="text-xs font-semibold text-slate-600">Import products (CSV)</div>
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Choose CSV file
              <input type="file" accept=".csv" className="hidden" onChange={(e) => handleProductImport(e.target.files?.[0])} />
            </label>
            <div className="mt-1.5 text-[11px] text-slate-400">Headers: product_name, product_type, base_price, cost_of_sales, discount, freight_cost.</div>
          </div>
        </SectionCard>

        <SectionCard
          title="Active products"
          subtitle="Your current live products and services."
          className="lg:col-span-3"
          icon={
            <CardIcon tone="bg-indigo-50 text-indigo-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 7h8M8 12h8M8 17h5" />
                <path d="M5 3h14v18H5z" />
              </svg>
            </CardIcon>
          }
        >
            <div className="mt-2 space-y-2 max-h-72 overflow-auto pr-1">
              {activeProducts.length ? (
                activeProducts.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">{p.name}</div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${p.type === "product" ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700"}`}>{p.type}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {formatCurrency(p.base_price, currency)} base · {formatCurrency(p.cost_of_sales || 0, currency)} CoS{p.discount ? ` · ${formatCurrency(p.discount, currency)} off` : ""}{p.freight_cost ? ` · ${formatCurrency(p.freight_cost, currency)} freight` : ""}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditingProductId(p.id);
                          setProductForm({
                            name: p.name,
                            type: p.type,
                            base_price: String(p.base_price ?? ""),
                            cost_of_sales: String(p.cost_of_sales ?? ""),
                            discount: String(p.discount ?? ""),
                            freight_cost: String(p.freight_cost ?? "")
                          });
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => archiveEntity("products", p.id)}>
                        Archive
                      </Button>
                      <Button variant="ghost" onClick={() => deleteEntity("products", p.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  No active products yet.
                </div>
              )}
            </div>
        </SectionCard>
        <SectionCard
          title="Archived products"
          subtitle="Restore or delete items in archive."
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
            {archivedProducts.length ? (
              archivedProducts.map((p) => {
                const age = daysSince(p.archived_at || p.updated_at || p.created_at);
                const expiring = Math.max(0, ARCHIVE_EXPIRE_DAYS - age);
                return (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{p.name}</div>
                      <div className="text-xs text-slate-500">
                        Archived {age} days ago • Expires in {expiring} days
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => restoreEntity("products", p.id)}>
                        Activate
                      </Button>
                      <Button variant="ghost" onClick={() => deleteEntity("products", p.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No archived products.
              </div>
            )}
          </div>
        </SectionCard>
        </div>
        ) : null}

        {activeTab === "customers" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          title="Customers"
          subtitle="Define who you bill and their payment terms."
          className="lg:col-span-2"
          icon={
            <CardIcon tone="bg-sky-50 text-sky-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 11a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
                <path d="M4 21a8 8 0 0 1 16 0" />
              </svg>
            </CardIcon>
          }
        >
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="ea-label">Customer name *</div>
              <Input value={customerForm.name} onChange={(e) => setCustomerForm((c) => ({ ...c, name: e.target.value }))} />
            </div>
            <div>
              <div className="ea-label">Address</div>
              <Input value={customerForm.address} onChange={(e) => setCustomerForm((c) => ({ ...c, address: e.target.value }))} />
            </div>
            <div>
              <div className="ea-label">Email</div>
              <Input value={customerForm.email} onChange={(e) => setCustomerForm((c) => ({ ...c, email: e.target.value }))} />
            </div>
            <div>
              <div className="ea-label">Phone</div>
              <Input value={customerForm.phone_number} onChange={(e) => setCustomerForm((c) => ({ ...c, phone_number: e.target.value }))} />
            </div>
              <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                <div>
                  <div className="ea-label">Payment terms</div>
                  <select
                    className="ea-input"
                    value={paymentTermOptions.includes(customerForm.payment_terms) ? customerForm.payment_terms : "Other"}
                    onChange={(e) =>
                      setCustomerForm((c) => ({
                        ...c,
                        payment_terms: e.target.value === "Other" ? "" : e.target.value
                      }))
                    }
                  >
                    {paymentTermOptions.map((term) => (
                      <option key={term} value={term}>
                        {term === "Other" ? "Other" : `${term} days`}
                      </option>
                    ))}
                  </select>
                  {!paymentTermOptions.includes(customerForm.payment_terms) && (
                    <Input
                      className="mt-2 w-full"
                      type="text"
                      placeholder="Enter payment terms"
                      value={customerForm.payment_terms}
                      onChange={(e) => setCustomerForm((c) => ({ ...c, payment_terms: e.target.value }))}
                    />
                  )}
                  <div className="mt-1 text-xs text-slate-500">Choose a term or select Other to enter a custom value.</div>
                </div>
              <div>
                <div className="ea-label">Industry</div>
                <select
                  className="ea-input"
                  value={customerIndustryCategory}
                  onChange={(e) =>
                    setCustomerForm((c) => ({
                      ...c,
                      industry: e.target.value === "Other" ? "" : e.target.value
                    }))
                  }
                >
                  <option value="" disabled>
                    Select industry
                  </option>
                  {INDUSTRY_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                {customerIndustryCategory === "Other" ? (
                  <Input
                    value={customerForm.industry}
                    onChange={(e) => setCustomerForm((c) => ({ ...c, industry: e.target.value }))}
                    placeholder="Type industry"
                    className="mt-2"
                  />
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upsertCustomer}>{editingCustomerId ? "Update customer" : "Add customer"}</Button>
              {editingCustomerId ? (
                <Button variant="secondary" onClick={resetCustomerForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
          <div className="mt-5 border-t border-slate-200 pt-4">
            <div className="text-xs font-semibold text-slate-600">Import customers (CSV)</div>
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Choose CSV file
              <input type="file" accept=".csv" className="hidden" onChange={(e) => handleCustomerImport(e.target.files?.[0])} />
            </label>
            <div className="mt-1.5 text-[11px] text-slate-400">Headers: customer_name, address, email, phone_number, payment_terms, industry.</div>
          </div>
        </SectionCard>

        <SectionCard
          title="Active customers"
          subtitle="Clients you currently bill."
          className="lg:col-span-3"
          icon={
            <CardIcon tone="bg-indigo-50 text-indigo-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3v6l3-3" />
                <path d="M6 21a6 6 0 0 1 12 0" />
                <circle cx="12" cy="9" r="3" />
              </svg>
            </CardIcon>
          }
        >
            <div className="mt-2 space-y-2 max-h-72 overflow-auto pr-1">
              {activeCustomers.length ? (
                activeCustomers.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{c.name}</div>
                      <div className="text-xs text-slate-500">
                        {c.industry || "Industry"} • {formatPaymentTerms(c.payment_terms)} • {c.address || "Address on file"}
                        {c.email ? ` • ${c.email}` : ""}
                        {c.phone_number ? ` • ${c.phone_number}` : ""}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditingCustomerId(c.id);
                          setCustomerForm({
                            name: c.name,
                            address: c.address || "",
                            email: c.email || "",
                            phone_number: c.phone_number || "",
                            payment_terms: String(c.payment_terms || "14"),
                            industry: c.industry || ""
                          });
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => archiveEntity("customers", c.id)}>
                        Archive
                      </Button>
                      <Button variant="ghost" onClick={() => deleteEntity("customers", c.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  No active customers yet.
                </div>
              )}
            </div>
        </SectionCard>
        <SectionCard
          title="Archived customers"
          subtitle="Restore or delete items in archive."
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
            {archivedCustomers.length ? (
              archivedCustomers.map((c) => {
                const age = daysSince(c.archived_at || c.updated_at || c.created_at);
                const expiring = Math.max(0, ARCHIVE_EXPIRE_DAYS - age);
                return (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{c.name}</div>
                      <div className="text-xs text-slate-500">
                        Archived {age} days ago • Expires in {expiring} days
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => restoreEntity("customers", c.id)}>
                        Activate
                      </Button>
                      <Button variant="ghost" onClick={() => deleteEntity("customers", c.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No archived customers.
              </div>
            )}
          </div>
        </SectionCard>
        </div>
        ) : null}

        {activeTab === "vendors" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          title="Vendors"
          subtitle="Capture suppliers and cost sources."
          className="lg:col-span-2"
          icon={
            <CardIcon tone="bg-amber-50 text-amber-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 7h13l5 5v5H3V7Z" />
                <path d="M16 7v5h5" />
              </svg>
            </CardIcon>
          }
        >
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="ea-label">Vendor name *</div>
              <Input value={vendorForm.name} onChange={(e) => setVendorForm((v) => ({ ...v, name: e.target.value }))} />
            </div>
            <div>
              <div className="ea-label">Address</div>
              <Input value={vendorForm.address} onChange={(e) => setVendorForm((v) => ({ ...v, address: e.target.value }))} />
            </div>
            <div>
              <div className="ea-label">Email</div>
              <Input value={vendorForm.email} onChange={(e) => setVendorForm((v) => ({ ...v, email: e.target.value }))} />
            </div>
            <div>
              <div className="ea-label">Phone</div>
              <Input value={vendorForm.phone_number} onChange={(e) => setVendorForm((v) => ({ ...v, phone_number: e.target.value }))} />
            </div>
              <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                <div>
                  <div className="ea-label">Payment terms</div>
                  <select
                    className="ea-input"
                    value={paymentTermOptions.includes(vendorForm.payment_terms) ? vendorForm.payment_terms : "Other"}
                    onChange={(e) =>
                      setVendorForm((v) => ({
                        ...v,
                        payment_terms: e.target.value === "Other" ? "" : e.target.value
                      }))
                    }
                  >
                    {paymentTermOptions.map((term) => (
                      <option key={term} value={term}>
                        {term === "Other" ? "Other" : `${term} days`}
                      </option>
                    ))}
                  </select>
                  {!paymentTermOptions.includes(vendorForm.payment_terms) && (
                    <Input
                      className="mt-2 w-full"
                      type="text"
                      placeholder="Enter payment terms"
                      value={vendorForm.payment_terms}
                      onChange={(e) => setVendorForm((v) => ({ ...v, payment_terms: e.target.value }))}
                    />
                  )}
                </div>
              <div>
                <div className="ea-label">Industry</div>
                <Input value={vendorForm.industry} onChange={(e) => setVendorForm((v) => ({ ...v, industry: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Product type</div>
                <select
                  className="ea-input"
                  value={vendorForm.product_type}
                  onChange={(e) => setVendorForm((v) => ({ ...v, product_type: e.target.value }))}
                >
                  <option value="product">Product</option>
                  <option value="service">Service</option>
                </select>
              </div>
              <div>
                <div className="ea-label">Product / Service name *</div>
                <Input value={vendorForm.product_name} onChange={(e) => setVendorForm((v) => ({ ...v, product_name: e.target.value }))} />
              </div>
            </div>
            <div>
              <div className="ea-label">Price *</div>
              <Input type="number" min="0" value={vendorForm.price} onChange={(e) => setVendorForm((v) => ({ ...v, price: e.target.value }))} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upsertVendor}>{editingVendorId ? "Update vendor" : "Add vendor"}</Button>
              {editingVendorId ? (
                <Button variant="secondary" onClick={resetVendorForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
          <div className="mt-5 border-t border-slate-200 pt-4">
            <div className="text-xs font-semibold text-slate-600">Import vendors (CSV)</div>
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Choose CSV file
              <input type="file" accept=".csv" className="hidden" onChange={(e) => handleVendorImport(e.target.files?.[0])} />
            </label>
            <div className="mt-1.5 text-[11px] text-slate-400">
              Headers: vendor_name, address, email, phone_number, payment_terms, industry, product_type, product_name, price.
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Active vendors"
          subtitle="Suppliers you currently rely on."
          className="lg:col-span-3"
          icon={
            <CardIcon tone="bg-indigo-50 text-indigo-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 12h16" />
                <path d="M4 8h16" />
                <path d="M4 16h16" />
              </svg>
            </CardIcon>
          }
        >
            <div className="mt-2 space-y-2 max-h-72 overflow-auto pr-1">
              {activeVendors.length ? (
                activeVendors.map((v) => (
                  <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">{v.name}</div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${v.product_type === "product" ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700"}`}>{v.product_type}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                                {v.product_name} · {formatCurrency(v.price, currency)} · {formatPaymentTerms(v.payment_terms)}
                                {v.email ? ` • ${v.email}` : ""}
                                {v.phone_number ? ` • ${v.phone_number}` : ""}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditingVendorId(v.id);
                          setVendorForm({
                            name: v.name,
                            address: v.address || "",
                            email: v.email || "",
                            phone_number: v.phone_number || "",
                            payment_terms: String(v.payment_terms || "14"),
                            industry: v.industry || "",
                            product_type: v.product_type || "product",
                            product_name: v.product_name || "",
                            price: String(v.price ?? "")
                          });
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => archiveEntity("vendors", v.id)}>
                        Archive
                      </Button>
                      <Button variant="ghost" onClick={() => deleteEntity("vendors", v.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  No active vendors yet.
                </div>
              )}
            </div>
        </SectionCard>
        <SectionCard
          title="Archived vendors"
          subtitle="Restore or delete items in archive."
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
            {archivedVendors.length ? (
              archivedVendors.map((v) => {
                const age = daysSince(v.archived_at || v.updated_at || v.created_at);
                const expiring = Math.max(0, ARCHIVE_EXPIRE_DAYS - age);
                return (
                  <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{v.name}</div>
                      <div className="text-xs text-slate-500">
                        Archived {age} days ago • Expires in {expiring} days
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => restoreEntity("vendors", v.id)}>
                        Activate
                      </Button>
                      <Button variant="ghost" onClick={() => deleteEntity("vendors", v.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No archived vendors.
              </div>
            )}
          </div>
        </SectionCard>
        </div>
        ) : null}
      </div>
      ) : null}

      {activeTab === "overview" && (
          <div className="mt-6 space-y-4">
            <SectionCard title="Products & services" subtitle="Pricing, cost of sales, and margin per item.">
              <div className="mt-2">
                <ReportTable
                  paginate
                  columns={[
                    { key: "name", label: "Name", bold: true },
                    { key: "category", label: "Category" },
                    { key: "price", label: "Sell price", right: true, bold: true },
                    { key: "cos", label: "Cost of sales", right: true },
                    { key: "margin", label: "Margin", right: true },
                  ]}
                  rows={reportRows.productRows}
                  emptyText="No products in catalogue yet."
                />
              </div>
            </SectionCard>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectionCard title="Customers" subtitle="Revenue earned and outstanding per customer.">
                <div className="mt-2">
                  <ReportTable
                    paginate
                    columns={[
                      { key: "name", label: "Name", bold: true },
                      { key: "invoices", label: "Invoices", right: true },
                      { key: "revenue", label: "Revenue earned", right: true, bold: true },
                      { key: "outstanding", label: "Outstanding", right: true },
                      { key: "terms", label: "Terms", right: true },
                    ]}
                    rows={reportRows.customerRows}
                    emptyText="No customers yet."
                  />
                </div>
              </SectionCard>

              <SectionCard title="Vendors" subtitle="Supplier list and total spend from paid expenses.">
                <div className="mt-2">
                  <ReportTable
                    paginate
                    columns={[
                      { key: "name", label: "Name", bold: true },
                      { key: "category", label: "Category" },
                      { key: "terms", label: "Terms", right: true },
                      { key: "spent", label: "Total spent", right: true, bold: true },
                    ]}
                    rows={reportRows.vendorRows}
                    emptyText="No vendors yet."
                  />
                </div>
              </SectionCard>
            </div>
          </div>
      )}

      {activeTab === "report" && (
        <div className="mt-6 space-y-5">
          {/* Filter controls */}
          <SectionCard title="Generate Catalogue Report" subtitle="Select the sections to include, preview, then download as PDF.">
            <div className="mt-3 flex flex-wrap gap-4">
              {[
                { key: "products", label: "Products & Services" },
                { key: "customers", label: "Customers" },
                { key: "vendors", label: "Vendors" },
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
                  const { productRows, customerRows, vendorRows, cur } = reportRows;
                  const filteredProductRows = reportFilter.products ? productRows : null;
                  const filteredCustomerRows = reportFilter.customers ? customerRows : null;
                  const filteredVendorRows = reportFilter.vendors ? vendorRows : null;
                  setReportPreviewHtml(buildCatalogueReportHtml({ productRows: filteredProductRows, customerRows: filteredCustomerRows, vendorRows: filteredVendorRows, cur }));
                  setPendingCatalogueReport(buildCatalogueReportHtml({ productRows: filteredProductRows, customerRows: filteredCustomerRows, vendorRows: filteredVendorRows, cur }));
                }}
              >
                Generate &amp; Preview
              </Button>
              {pendingCatalogueReport && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      try {
                        const container = document.createElement("div");
                        container.innerHTML = pendingCatalogueReport;
                        container.style.cssText = "width:210mm;padding:12mm;box-sizing:border-box;font-size:13px;background:#fff;";
                        document.body.appendChild(container);
                        await html2pdf().set({ filename: `catalogue-report-${new Date().toISOString().slice(0, 10)}.pdf`, margin: [10, 10, 10, 10], pagebreak: { mode: ["css", "legacy", "avoid-all"] }, image: { type: "jpeg", quality: 0.98 }, html2canvas: { scale: 3, useCORS: true, windowWidth: 794, backgroundColor: "#ffffff", letterRendering: true }, jsPDF: { unit: "pt", format: "a4", orientation: "portrait", compress: true } }).from(container).save();
                        document.body.removeChild(container);
                      } catch { setError("Unable to generate the PDF report."); }
                    }}
                  >
                    Download PDF
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setPendingCatalogueReport(null); setReportPreviewHtml(null); }}>Clear</Button>
                </>
              )}
            </div>
          </SectionCard>

          {/* Live preview */}
          {reportPreviewHtml && (
            <SectionCard title="Preview">
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                <iframe
                  srcDoc={reportPreviewHtml}
                  title="Catalogue Report Preview"
                  className="h-[600px] w-full bg-white"
                  sandbox="allow-same-origin"
                />
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {loading ? (
        <div className="mt-4">
          <div className="text-xs text-slate-500">Syncing catalogue...</div>
        </div>
      ) : null}
    </div>
  );
}

