import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { useWorkspaceStore } from "../store/workspace";
import { apiRequest } from "../api/client";
import { planLabel, getPlan, normalisePlanKey } from "../lib/plans";

function initialsFromName(name, email) {
  const source = name?.trim() || email || "";
  const parts = source.split(/[\s.\-_@]+/).filter(Boolean);
  const first = (parts[0] || "")[0] || "";
  const second = (parts[1] || "")[0] || "";
  return (first + second).toUpperCase() || "?";
}

/* ── primitives ── */

function Card({ children, className = "" }) {
  return (
    <div className={`flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</label>
      {children}
    </div>
  );
}

function Input({ ...props }) {
  return (
    <input
      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none ring-brand-200 placeholder:text-slate-400 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800/50 dark:disabled:text-slate-500"
      {...props}
    />
  );
}

function SubmitButton({ loading, children }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition"
    >
      {loading ? "Saving…" : children}
    </button>
  );
}

function Alert({ type, message }) {
  if (!message) return null;
  const styles =
    type === "error"
      ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800"
      : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800";
  return (
    <p className={`rounded-xl border px-4 py-2.5 text-sm ${styles}`}>{message}</p>
  );
}

function SectionLabel({ children }) {
  return (
    <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
      {children}
    </div>
  );
}

function DetailItem({ label, value }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className="mt-0.5 text-[13px] text-slate-700 dark:text-slate-200 leading-snug">{value}</div>
    </div>
  );
}

function ExternalLink({ href, label }) {
  if (!href) return null;
  const url = href.startsWith("http") ? href : `https://${href}`;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="text-[13px] text-brand-600 underline-offset-2 hover:underline dark:text-brand-400">
      {label || href.replace(/^https?:\/\/(www\.)?/, "")}
    </a>
  );
}

function Pill({ children }) {
  return (
    <span className="inline-block rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
      {children}
    </span>
  );
}

function CompanyAvatar({ logo, name, size = "lg" }) {
  const sizeClass = size === "lg" ? "h-16 w-16 text-xl" : "h-10 w-10 text-base";
  if (logo) {
    return (
      <div className={`${sizeClass} shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 dark:border-slate-700 dark:bg-slate-800`}>
        <img src={logo} alt={name} className="h-full w-full object-contain" />
      </div>
    );
  }
  return (
    <div className={`${sizeClass} shrink-0 flex items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-900/30`}>
      <span className="font-bold text-brand-600 dark:text-brand-400">{(name || "?")[0].toUpperCase()}</span>
    </div>
  );
}

function SelectInput({ value, onChange, children, placeholder, disabled }) {
  return (
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none ring-brand-200 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-800/50"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {children}
    </select>
  );
}

function Textarea({ value, onChange, placeholder, rows = 3, maxLength }) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      maxLength={maxLength}
      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none ring-brand-200 placeholder:text-slate-400 focus:ring-2 resize-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
    />
  );
}

/* ── tabs ── */

const TABS = [
  { id: "workspace", label: "Workspace" },
  { id: "account", label: "Account" },
  { id: "billing", label: "Billing" },
];

function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function TabBar({ active, onChange }) {
  return (
    <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
            active === t.id
              ? "text-slate-900 dark:text-slate-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
          }`}
        >
          {t.label}
          {active === t.id && (
            <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" />
          )}
        </button>
      ))}
    </div>
  );
}

/* ── workspace tab ── */

const STAGE_OPTIONS = [
  { value: "idea", label: "Idea stage" },
  { value: "pre_revenue", label: "Pre-revenue" },
  { value: "early_revenue", label: "Early revenue" },
  { value: "growing", label: "Growing" },
  { value: "established", label: "Established" },
];
const STAGE_LABELS = Object.fromEntries(STAGE_OPTIONS.map((o) => [o.value, o.label]));

const DELIVERY_OPTIONS = [
  { value: "manual", label: "Manual / service-led" },
  { value: "hybrid", label: "Hybrid" },
  { value: "automated", label: "Automated" },
];
const DELIVERY_LABELS = Object.fromEntries(DELIVERY_OPTIONS.map((o) => [o.value, o.label]));

const BUSINESS_TYPES = [
  { value: "sole_trader", label: "Sole trader" },
  { value: "partnership", label: "Partnership" },
  { value: "limited_company", label: "Limited company" },
  { value: "llp", label: "LLP" },
  { value: "non_profit", label: "Non-profit" },
  { value: "startup", label: "Startup" },
];

const INDUSTRIES = [
  { value: "consulting", label: "Consulting" },
  { value: "technology", label: "Technology" },
  { value: "finance", label: "Finance" },
  { value: "healthcare", label: "Healthcare" },
  { value: "education", label: "Education" },
  { value: "retail", label: "Retail" },
  { value: "ecommerce", label: "Ecommerce" },
  { value: "logistics", label: "Logistics" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "real_estate", label: "Real estate" },
  { value: "marketing", label: "Marketing" },
  { value: "other", label: "Other" },
];

const COMPANY_SIZES = [
  { value: "solo", label: "Just me (solo)" },
  { value: "2-5", label: "2–5 people" },
  { value: "6-10", label: "6–10 people" },
  { value: "11-50", label: "11–50 people" },
  { value: "51-200", label: "51–200 people" },
  { value: "200+", label: "200+ people" },
];

const COUNTRY_CITIES = {
  "Nigeria": ["Lagos", "Abuja", "Port Harcourt", "Kano", "Ibadan", "Enugu", "Kaduna", "Benin City", "Owerri", "Uyo", "Jos", "Ilorin", "Calabar", "Warri", "Maiduguri"],
  "Ghana": ["Accra", "Kumasi", "Tamale", "Takoradi", "Cape Coast", "Sunyani", "Koforidua", "Ho", "Wa", "Bolgatanga"],
  "Kenya": ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Thika", "Malindi", "Kitale", "Garissa", "Kakamega"],
  "South Africa": ["Johannesburg", "Cape Town", "Durban", "Pretoria", "Port Elizabeth", "Bloemfontein", "East London", "Nelspruit", "Polokwane", "Kimberley"],
  "Tanzania": ["Dar es Salaam", "Mwanza", "Arusha", "Dodoma", "Zanzibar City", "Mbeya", "Morogoro", "Tanga", "Kigoma", "Tabora"],
  "Uganda": ["Kampala", "Gulu", "Lira", "Mbarara", "Jinja", "Mbale", "Masaka", "Entebbe", "Arua", "Fort Portal"],
  "Rwanda": ["Kigali", "Butare", "Gitarama", "Ruhengeri", "Gisenyi", "Byumba", "Cyangugu", "Nyabisindu"],
  "Ethiopia": ["Addis Ababa", "Dire Dawa", "Mekelle", "Gondar", "Hawassa", "Bahir Dar", "Dessie", "Jimma", "Jijiga", "Harar"],
  "Egypt": ["Cairo", "Alexandria", "Giza", "Shubra El Kheima", "Port Said", "Suez", "Luxor", "Aswan", "Mansoura", "Assiut"],
  "Morocco": ["Casablanca", "Rabat", "Fez", "Marrakech", "Agadir", "Tangier", "Meknes", "Oujda", "Kenitra", "Tetouan"],
  "Senegal": ["Dakar", "Touba", "Thiès", "Rufisque", "Kaolack", "Mbour", "Saint-Louis", "Ziguinchor"],
  "Ivory Coast": ["Abidjan", "Bouaké", "Daloa", "San-Pédro", "Yamoussoukro", "Korhogo", "Man", "Gagnoa"],
  "Cameroon": ["Douala", "Yaoundé", "Bamenda", "Bafoussam", "Garoua", "Maroua", "Ngaoundéré", "Bertoua"],
  "Zimbabwe": ["Harare", "Bulawayo", "Chitungwiza", "Mutare", "Gweru", "Kwekwe", "Kadoma", "Masvingo"],
  "Zambia": ["Lusaka", "Kitwe", "Ndola", "Kabwe", "Chingola", "Mufulira", "Livingstone", "Luanshya"],
  "United Kingdom": ["London", "Manchester", "Birmingham", "Leeds", "Edinburgh", "Glasgow", "Bristol", "Liverpool", "Sheffield", "Cardiff", "Nottingham", "Leicester", "Coventry", "Bradford", "Belfast"],
  "United States": ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose", "Austin", "Jacksonville", "Fort Worth", "Columbus", "Charlotte", "Seattle", "Denver", "Boston", "Atlanta", "Miami"],
  "Canada": ["Toronto", "Montreal", "Vancouver", "Calgary", "Edmonton", "Ottawa", "Winnipeg", "Quebec City", "Hamilton", "Kitchener"],
  "Australia": ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast", "Canberra", "Hobart", "Darwin", "Newcastle"],
  "New Zealand": ["Auckland", "Wellington", "Christchurch", "Hamilton", "Tauranga", "Napier", "Dunedin", "Palmerston North"],
  "Germany": ["Berlin", "Munich", "Hamburg", "Frankfurt", "Cologne", "Stuttgart", "Düsseldorf", "Dortmund", "Essen", "Leipzig"],
  "France": ["Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Strasbourg", "Montpellier", "Bordeaux", "Lille"],
  "Netherlands": ["Amsterdam", "Rotterdam", "The Hague", "Utrecht", "Eindhoven", "Tilburg", "Groningen", "Almere", "Breda"],
  "Belgium": ["Brussels", "Antwerp", "Ghent", "Charleroi", "Liège", "Bruges", "Namur", "Leuven"],
  "Spain": ["Madrid", "Barcelona", "Valencia", "Seville", "Zaragoza", "Málaga", "Murcia", "Palma", "Las Palmas", "Bilbao"],
  "Italy": ["Rome", "Milan", "Naples", "Turin", "Palermo", "Genoa", "Bologna", "Florence", "Bari", "Catania"],
  "Portugal": ["Lisbon", "Porto", "Vila Nova de Gaia", "Amadora", "Braga", "Setúbal", "Coimbra", "Funchal"],
  "Sweden": ["Stockholm", "Gothenburg", "Malmö", "Uppsala", "Västerås", "Örebro", "Linköping", "Helsingborg"],
  "Norway": ["Oslo", "Bergen", "Trondheim", "Stavanger", "Drammen", "Fredrikstad", "Kristiansand", "Tromsø"],
  "Denmark": ["Copenhagen", "Aarhus", "Odense", "Aalborg", "Frederiksberg", "Esbjerg", "Randers", "Kolding"],
  "Switzerland": ["Zurich", "Geneva", "Basel", "Bern", "Lausanne", "Winterthur", "Lucerne", "St. Gallen"],
  "Ireland": ["Dublin", "Cork", "Limerick", "Galway", "Waterford", "Drogheda", "Dundalk", "Swords"],
  "India": ["Mumbai", "Delhi", "Bangalore", "Hyderabad", "Ahmedabad", "Chennai", "Kolkata", "Pune", "Jaipur", "Lucknow", "Surat", "Nagpur", "Indore", "Bhopal", "Patna"],
  "Pakistan": ["Karachi", "Lahore", "Islamabad", "Faisalabad", "Rawalpindi", "Multan", "Peshawar", "Quetta"],
  "Bangladesh": ["Dhaka", "Chittagong", "Khulna", "Rajshahi", "Sylhet", "Barisal", "Comilla", "Narayanganj"],
  "Sri Lanka": ["Colombo", "Kandy", "Galle", "Negombo", "Jaffna", "Trincomalee", "Batticaloa"],
  "UAE": ["Dubai", "Abu Dhabi", "Sharjah", "Al Ain", "Ajman", "Ras Al Khaimah", "Fujairah"],
  "Saudi Arabia": ["Riyadh", "Jeddah", "Mecca", "Medina", "Dammam", "Khobar", "Tabuk", "Abha"],
  "Qatar": ["Doha", "Al Rayyan", "Al Wakrah", "Al Khor", "Umm Salal"],
  "Kuwait": ["Kuwait City", "Salmiya", "Hawalli", "Jahra", "Farwaniya"],
  "Bahrain": ["Manama", "Riffa", "Muharraq", "Hamad Town", "Isa Town"],
  "Singapore": ["Singapore"],
  "Malaysia": ["Kuala Lumpur", "George Town", "Johor Bahru", "Ipoh", "Shah Alam", "Petaling Jaya", "Kota Kinabalu", "Kuching"],
  "Indonesia": ["Jakarta", "Surabaya", "Bandung", "Bekasi", "Medan", "Tangerang", "Depok", "Semarang", "Palembang", "Makassar"],
  "Philippines": ["Manila", "Quezon City", "Davao", "Caloocan", "Zamboanga", "Cebu City", "Antipolo", "Taguig", "Pasig"],
  "Japan": ["Tokyo", "Osaka", "Nagoya", "Yokohama", "Sapporo", "Kobe", "Kyoto", "Fukuoka", "Kawasaki", "Hiroshima"],
  "China": ["Beijing", "Shanghai", "Guangzhou", "Shenzhen", "Chengdu", "Tianjin", "Wuhan", "Dongguan", "Chongqing", "Nanjing"],
  "South Korea": ["Seoul", "Busan", "Incheon", "Daegu", "Daejeon", "Gwangju", "Suwon", "Ulsan"],
  "Brazil": ["São Paulo", "Rio de Janeiro", "Brasília", "Salvador", "Fortaleza", "Belo Horizonte", "Manaus", "Curitiba", "Recife", "Goiânia"],
  "Mexico": ["Mexico City", "Guadalajara", "Monterrey", "Puebla", "Tijuana", "León", "Ciudad Juárez", "Zapopan", "Mérida", "Cancún"],
  "Argentina": ["Buenos Aires", "Córdoba", "Rosario", "Mendoza", "San Miguel de Tucumán", "La Plata", "Mar del Plata"],
  "Colombia": ["Bogotá", "Medellín", "Cali", "Barranquilla", "Cartagena", "Bucaramanga", "Cúcuta", "Ibagué"],
};

const COUNTRY_LIST = Object.keys(COUNTRY_CITIES).sort();

const REVENUE_MODELS = [
  { value: "one_off", label: "One-off sales" },
  { value: "subscription", label: "Subscription" },
  { value: "retainer", label: "Retainer" },
  { value: "project_based", label: "Project-based" },
  { value: "mixed", label: "Mixed" },
];

function FormSection({ title, children }) {
  return (
    <Card>
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </Card>
  );
}

function WorkspaceAiFill({ field, profile, onFill }) {
  const [busy, setBusy] = useState(false);
  async function fill() {
    setBusy(true);
    try {
      const res = await apiRequest("/blueprint/suggest-field", "POST", {
        field,
        company_name: profile?.company_name || "",
        industry: profile?.primary_industry || "",
        target_market: "",
        problem: "",
        solution: "",
        value_proposition: profile?.about_company || "",
        selected_services: (profile?.services || []).map((s) => s.service_name).filter(Boolean),
      });
      if (res?.value) onFill(res.value);
    } catch {
      // silent
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={fill}
      disabled={busy}
      className="ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50 transition-colors dark:text-brand-400 dark:hover:bg-brand-900/20"
    >
      {busy ? "..." : "✦ AI Fill"}
    </button>
  );
}

function WorkspaceEditForm({ workspaceId, initialData, onSaved, onCancel }) {
  const p = initialData || {};

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const [companyName, setCompanyName] = useState(p.company_name || "");
  const [businessType, setBusinessType] = useState(p.business_type || "");
  const [primaryIndustry, setPrimaryIndustry] = useState(
    p.primary_industry && !INDUSTRIES.some((o) => o.value === p.primary_industry) ? "Other" : (p.primary_industry || "")
  );
  const [customIndustry, setCustomIndustry] = useState(
    p.primary_industry && !INDUSTRIES.some((o) => o.value === p.primary_industry) ? p.primary_industry : ""
  );
  const [tagline, setTagline] = useState(p.tagline || "");
  const [logo, setLogo] = useState(p.logo_data_url || null);
  const [yearEstablished, setYearEstablished] = useState(p.year_established ? String(p.year_established) : "");
  const [companySize, setCompanySize] = useState(p.company_size || "");
  const [aboutCompany, setAboutCompany] = useState(p.about_company || "");

  const emptyService = () => ({ service_name: "", service_category: "other", service_description: "" });
  const [services, setServices] = useState(
    Array.isArray(p.services) && p.services.length > 0
      ? p.services.map((s) => ({ service_name: s.service_name || "", service_category: s.service_category || "other", service_description: s.service_description || "" }))
      : [emptyService()]
  );

  const [vision, setVision] = useState(p.vision || "");
  const [mission, setMission] = useState(p.mission || "");
  const [coreValuesInput, setCoreValuesInput] = useState(
    Array.isArray(p.core_values) ? p.core_values.join(", ") : (p.core_values || "")
  );

  const _initCountry = COUNTRY_LIST.includes(p.country || "") ? (p.country || "") : (p.country ? "Other" : "");
  const _initCities = _initCountry && _initCountry !== "Other" ? (COUNTRY_CITIES[_initCountry] || []) : [];
  const _initCity = _initCities.includes(p.city || "") ? (p.city || "") : (p.city ? "Other" : "");
  const [country, setCountry] = useState(_initCountry);
  const [customCountry, setCustomCountry] = useState(_initCountry === "Other" ? (p.country || "") : "");
  const [city, setCity] = useState(_initCity);
  const [customCity, setCustomCity] = useState(_initCity === "Other" ? (p.city || "") : "");
  const cityOptions = country && country !== "Other" ? (COUNTRY_CITIES[country] || []) : [];
  const [stateOrRegion, setStateOrRegion] = useState(p.state_or_region || "");
  const [contactEmail, setContactEmail] = useState(p.email || "");
  const [phone, setPhone] = useState(p.phone_number || "");
  const [website, setWebsite] = useState(p.website || "");
  const [linkedin, setLinkedin] = useState(p.linkedin_url || "");
  const [twitter, setTwitter] = useState(p.twitter_url || "");
  const [instagram, setInstagram] = useState(p.instagram_url || "");

  const [operatingStage, setOperatingStage] = useState(p.operating_stage || "");
  const [deliveryModel, setDeliveryModel] = useState(p.delivery_model || "");
  const [revenueModel, setRevenueModel] = useState(p.primary_revenue_model || "");
  const [targetCustomer, setTargetCustomer] = useState(p.target_customer_type || "");
  const [keyOffering, setKeyOffering] = useState(p.key_offering_focus || "");

  function handleLogoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setLogo(ev.target.result);
    reader.readAsDataURL(file);
  }

  function updateService(index, key, value) {
    setServices((prev) => prev.map((s, i) => (i === index ? { ...s, [key]: value } : s)));
  }

  async function handleSave(e) {
    e.preventDefault();
    setMsg(null);
    if (!companyName.trim()) return setMsg({ type: "error", text: "Company name is required." });
    if (!businessType) return setMsg({ type: "error", text: "Business type is required." });
    const resolvedIndustry = primaryIndustry === "Other" ? customIndustry.trim() : primaryIndustry;
    if (!resolvedIndustry) return setMsg({ type: "error", text: "Primary industry is required." });
    if (!aboutCompany.trim()) return setMsg({ type: "error", text: "About company is required." });
    const resolvedCountry = country === "Other" ? customCountry.trim() : country.trim();
    const resolvedCity = city === "Other" ? customCity.trim() : city.trim();
    if (!resolvedCountry) return setMsg({ type: "error", text: "Country is required." });
    if (!resolvedCity) return setMsg({ type: "error", text: "City is required." });
    if (!contactEmail.trim()) return setMsg({ type: "error", text: "Contact email is required." });
    if (!operatingStage) return setMsg({ type: "error", text: "Operating stage is required." });
    if (!deliveryModel) return setMsg({ type: "error", text: "Delivery model is required." });
    const validServices = services.filter((s) => s.service_name.trim().length >= 2);
    if (validServices.length === 0) return setMsg({ type: "error", text: "Add at least one service (min. 2 characters)." });
    const missingDesc = validServices.find((s) => !s.service_description?.trim());
    if (missingDesc) return setMsg({ type: "error", text: `Add a description for "${missingDesc.service_name}" — it's required for the Marketplace.` });

    const coreValues = coreValuesInput.split(",").map((v) => v.trim()).filter(Boolean);

    const profile = {
      company_name: companyName.trim(),
      business_type: businessType,
      primary_industry: resolvedIndustry,
      about_company: aboutCompany.trim(),
      services: validServices,
      country: resolvedCountry,
      city: resolvedCity,
      email: contactEmail.trim(),
      operating_stage: operatingStage,
      delivery_model: deliveryModel,
      ...(logo ? { logo_data_url: logo } : {}),
      ...(tagline.trim() ? { tagline: tagline.trim() } : {}),
      ...(yearEstablished ? { year_established: parseInt(yearEstablished, 10) } : {}),
      ...(companySize ? { company_size: companySize } : {}),
      ...(vision.trim() ? { vision: vision.trim() } : {}),
      ...(mission.trim() ? { mission: mission.trim() } : {}),
      ...(coreValues.length > 0 ? { core_values: coreValues } : {}),
      ...(stateOrRegion.trim() ? { state_or_region: stateOrRegion.trim() } : {}),
      ...(phone.trim() ? { phone_number: phone.trim() } : {}),
      ...(website.trim() ? { website: website.trim() } : {}),
      ...(linkedin.trim() ? { linkedin_url: linkedin.trim() } : {}),
      ...(twitter.trim() ? { twitter_url: twitter.trim() } : {}),
      ...(instagram.trim() ? { instagram_url: instagram.trim() } : {}),
      ...(revenueModel ? { primary_revenue_model: revenueModel } : {}),
      ...(targetCustomer.trim() ? { target_customer_type: targetCustomer.trim() } : {}),
      ...(keyOffering.trim() ? { key_offering_focus: keyOffering.trim() } : {}),
    };

    setSaving(true);
    try {
      const resp = await apiRequest("/workspace/profile", "POST", { workspace_id: workspaceId, profile });
      onSaved(resp.profile);
    } catch (err) {
      setMsg({ type: "error", text: err?.message || "Failed to save workspace profile." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-5">

      <FormSection title="Company identity">
        {/* Logo */}
        <div className="flex items-center gap-4">
          {logo ? (
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
              <img src={logo} alt="logo" className="h-full w-full object-contain" />
            </div>
          ) : (
            <div className="h-14 w-14 shrink-0 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>
          )}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Company logo</label>
            <input type="file" accept="image/*" onChange={handleLogoChange} className="text-xs text-slate-600 dark:text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 dark:file:bg-slate-800 dark:file:text-slate-300" />
            {logo && <button type="button" onClick={() => setLogo(null)} className="mt-1 block text-[11px] text-rose-500 hover:underline">Remove logo</button>}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Company name *">
            <Input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Your company name" maxLength={120} />
          </Field>
          <div>
            <div className="flex items-center mb-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tagline</label>
              <WorkspaceAiFill
                field="tagline"
                profile={{ company_name: companyName, primary_industry: primaryIndustry, about_company: aboutCompany, services }}
                onFill={(v) => setTagline(v)}
              />
            </div>
            <Textarea value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Short catchy tagline" rows={2} maxLength={140} />
          </div>
          <Field label="Business type *">
            <SelectInput value={businessType} onChange={(e) => setBusinessType(e.target.value)} placeholder="Select type">
              {BUSINESS_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SelectInput>
          </Field>
          <Field label="Primary industry *">
            <SelectInput value={primaryIndustry} onChange={(e) => { setPrimaryIndustry(e.target.value); setCustomIndustry(""); }} placeholder="Select industry">
              {INDUSTRIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SelectInput>
            {primaryIndustry === "Other" && (
              <Input
                className="mt-2"
                value={customIndustry}
                onChange={(e) => setCustomIndustry(e.target.value)}
                placeholder="Enter your industry"
                maxLength={80}
              />
            )}
          </Field>
          <Field label="Company size">
            <SelectInput value={companySize} onChange={(e) => setCompanySize(e.target.value)} placeholder="Select size">
              {COMPANY_SIZES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SelectInput>
          </Field>
          <Field label="Year established">
            <Input type="number" value={yearEstablished} onChange={(e) => setYearEstablished(e.target.value)} placeholder="e.g. 2018" min={1500} max={2100} />
          </Field>
        </div>
        <div>
          <div className="flex items-center mb-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">About the company *</label>
            <WorkspaceAiFill
              field="about_company"
              profile={{ company_name: companyName, primary_industry: primaryIndustry, about_company: aboutCompany, services }}
              onFill={(v) => setAboutCompany(v)}
            />
          </div>
          <Textarea value={aboutCompany} onChange={(e) => setAboutCompany(e.target.value)} placeholder="Describe what your company does (min. 10 characters)" rows={4} maxLength={2000} />
        </div>
      </FormSection>

      <FormSection title="Services">
        <div className="space-y-3">
          {services.map((svc, i) => (
            <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Service {i + 1}</span>
                {services.length > 1 && (
                  <button type="button" onClick={() => setServices((prev) => prev.filter((_, idx) => idx !== i))} className="text-[11px] text-rose-500 hover:underline">Remove</button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Service name *">
                  <Input type="text" value={svc.service_name} onChange={(e) => updateService(i, "service_name", e.target.value)} placeholder="e.g. Brand Strategy" maxLength={120} />
                </Field>
                <Field label="Category">
                  <SelectInput value={svc.service_category} onChange={(e) => updateService(i, "service_category", e.target.value)}>
                    {INDUSTRIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </SelectInput>
                </Field>
              </div>
              <Field label="Description *">
                <Textarea value={svc.service_description || ""} onChange={(e) => updateService(i, "service_description", e.target.value)} placeholder="Brief description of this service (required for Marketplace)" rows={2} maxLength={600} />
              </Field>
            </div>
          ))}
          <button type="button" onClick={() => setServices((prev) => [...prev, emptyService()])} className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
            + Add another service
          </button>
        </div>
      </FormSection>

      <FormSection title="Vision · Mission · Values">
        <div>
          <div className="flex items-center mb-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Vision</label>
            <WorkspaceAiFill
              field="vision"
              profile={{ company_name: companyName, primary_industry: primaryIndustry, about_company: aboutCompany, services }}
              onFill={(v) => setVision(v)}
            />
          </div>
          <Textarea value={vision} onChange={(e) => setVision(e.target.value)} placeholder="Where you want to be in the future" rows={2} maxLength={600} />
        </div>
        <div>
          <div className="flex items-center mb-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Mission</label>
            <WorkspaceAiFill
              field="mission"
              profile={{ company_name: companyName, primary_industry: primaryIndustry, about_company: aboutCompany, services }}
              onFill={(v) => setMission(v)}
            />
          </div>
          <Textarea value={mission} onChange={(e) => setMission(e.target.value)} placeholder="How you work toward that vision" rows={2} maxLength={600} />
        </div>
        <div>
          <div className="flex items-center mb-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Core values</label>
            <WorkspaceAiFill
              field="core_values"
              profile={{ company_name: companyName, primary_industry: primaryIndustry, about_company: aboutCompany, services }}
              onFill={(v) => setCoreValuesInput(Array.isArray(v) ? v.join(", ") : v)}
            />
          </div>
          <Input type="text" value={coreValuesInput} onChange={(e) => setCoreValuesInput(e.target.value)} placeholder="Integrity, Innovation, Impact (comma-separated)" />
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Separate multiple values with commas</p>
        </div>
      </FormSection>

      <FormSection title="Location & contact">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Country *</label>
            <SelectInput
              value={country}
              onChange={(e) => { setCountry(e.target.value); setCity(""); setCustomCountry(""); }}
              placeholder="Select country"
            >
              {COUNTRY_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value="Other">Other</option>
            </SelectInput>
            {country === "Other" && (
              <Input type="text" value={customCountry} onChange={(e) => setCustomCountry(e.target.value)} placeholder="Type your country" maxLength={80} />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">City *</label>
            {country && country !== "Other" ? (
              <>
                <SelectInput
                  value={city}
                  onChange={(e) => { setCity(e.target.value); setCustomCity(""); }}
                  placeholder="Select city"
                >
                  {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  <option value="Other">Other</option>
                </SelectInput>
                {city === "Other" && (
                  <Input type="text" value={customCity} onChange={(e) => setCustomCity(e.target.value)} placeholder="Type your city" maxLength={80} />
                )}
              </>
            ) : (
              <Input
                type="text"
                value={country === "Other" ? customCity : ""}
                onChange={(e) => setCustomCity(e.target.value)}
                placeholder={country ? "Type your city" : "Select country first"}
                disabled={!country}
                maxLength={80}
              />
            )}
          </div>
          <Field label="State / region">
            <Input type="text" value={stateOrRegion} onChange={(e) => setStateOrRegion(e.target.value)} placeholder="e.g. Greater London" maxLength={80} />
          </Field>
          <Field label="Contact email *">
            <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="hello@yourcompany.com" maxLength={140} />
          </Field>
          <Field label="Phone number">
            <Input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 20 1234 5678" maxLength={40} />
          </Field>
          <Field label="Website">
            <Input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="yourcompany.com" maxLength={200} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="LinkedIn URL">
            <Input type="text" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="linkedin.com/company/..." maxLength={200} />
          </Field>
          <Field label="X / Twitter URL">
            <Input type="text" value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="x.com/..." maxLength={200} />
          </Field>
          <Field label="Instagram URL">
            <Input type="text" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="instagram.com/..." maxLength={200} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Operations & strategy">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Operating stage *">
            <SelectInput value={operatingStage} onChange={(e) => setOperatingStage(e.target.value)} placeholder="Select stage">
              {STAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SelectInput>
          </Field>
          <Field label="Delivery model *">
            <SelectInput value={deliveryModel} onChange={(e) => setDeliveryModel(e.target.value)} placeholder="Select model">
              {DELIVERY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SelectInput>
          </Field>
          <Field label="Primary revenue model">
            <SelectInput value={revenueModel} onChange={(e) => setRevenueModel(e.target.value)} placeholder="Select model">
              {REVENUE_MODELS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SelectInput>
          </Field>
          <Field label="Target customer">
            <Input type="text" value={targetCustomer} onChange={(e) => setTargetCustomer(e.target.value)} placeholder="e.g. SMEs in the UK" maxLength={200} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Key offering focus">
              <Input type="text" value={keyOffering} onChange={(e) => setKeyOffering(e.target.value)} placeholder="e.g. AI-powered financial insights for growth-stage startups" maxLength={200} />
            </Field>
          </div>
        </div>
      </FormSection>

      <div className="space-y-3 pt-1">
        <Alert type={msg?.type} message={msg?.text} />
        <div className="flex items-center justify-between">
          {onCancel && (
            <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition">
              Cancel
            </button>
          )}
          <SubmitButton loading={saving}>Save workspace profile</SubmitButton>
        </div>
      </div>
    </form>
  );
}

function BillingTab() {
  const navigate = useNavigate();
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  function load() {
    setLoading(true);
    apiRequest("/plans/my", "GET")
      .then((data) => setSub(data))
      .catch(() => setSub(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const isFree = !sub || ["free_trial", "explorer"].includes(sub.plan_key);
  const isCancellable = sub && !isFree && sub.status === "active" && sub.stripe_subscription_id;

  async function handleCancel() {
    setBusy(true);
    setError("");
    try {
      const updated = await apiRequest("/plans/cancel-subscription", "POST");
      setSub(updated);
      setConfirmCancel(false);
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).replace(/^HTTP \d+:\s*/i, "") || "Could not cancel your subscription. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResume() {
    setBusy(true);
    setError("");
    try {
      const updated = await apiRequest("/plans/resume-subscription", "POST");
      setSub(updated);
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).replace(/^HTTP \d+:\s*/i, "") || "Could not resume your subscription. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl mx-auto">
        <Card><div className="px-6 py-10 text-center text-sm text-slate-400">Loading…</div></Card>
      </div>
    );
  }

  const plan = getPlan(normalisePlanKey(sub?.plan_key));
  const renewDate = fmtDate(sub?.current_period_end);

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <Card>
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Plan &amp; billing</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Your current subscription.</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {planLabel(sub?.plan_key, sub?.status)}
              </div>
              {!isFree && plan ? (
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {sub.billing_period === "annual" ? `£${plan.annualTotal}/yr` : `£${plan.monthlyPrice}/mo`}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => navigate("/pricing")}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {isFree ? "Upgrade" : "Change plan"}
            </button>
          </div>

          {sub?.cancel_at_period_end ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              Your subscription is set to cancel{renewDate ? ` on ${renewDate}` : " at the end of this billing period"}.
              You'll keep access until then.
            </div>
          ) : renewDate ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Renews automatically on <strong>{renewDate}</strong>.
            </p>
          ) : null}

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:bg-rose-900/20 dark:text-rose-400">
              {error}
            </p>
          )}

          {isCancellable && (
            sub.cancel_at_period_end ? (
              <button
                type="button"
                onClick={handleResume}
                disabled={busy}
                className="w-full rounded-xl border-2 border-emerald-600 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              >
                {busy ? "Resuming…" : "Resume subscription"}
              </button>
            ) : confirmCancel ? (
              <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/50 dark:bg-rose-950/20">
                <p className="text-[13px] text-rose-800 dark:text-rose-300">
                  Cancel your {planLabel(sub.plan_key, sub.status)} plan? You'll keep access until{" "}
                  {renewDate || "the end of this billing period"}, then it won't renew.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={busy}
                    className="flex-1 rounded-lg bg-rose-600 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                  >
                    {busy ? "Cancelling…" : "Yes, cancel"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(false)}
                    disabled={busy}
                    className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-200"
                  >
                    Keep my plan
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmCancel(true)}
                className="w-full rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel subscription
              </button>
            )
          )}
        </div>
      </Card>
    </div>
  );
}

function WorkspaceTab({ workspaceId }) {
  const setWorkspaceCompanyName = useWorkspaceStore((s) => s.setWorkspaceCompanyName);
  const setWorkspaceLogo = useWorkspaceStore((s) => s.setWorkspaceLogo);
  const [ws, setWs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }
    let alive = true;
    apiRequest(`/validation/${workspaceId}`, "GET", undefined, { timeoutMs: 15000 })
      .then((data) => { if (alive) { setWs(data?.data || null); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [workspaceId]);

  const p = ws?.workspace_profile || {};
  const b = ws?.business_profile || {};
  const companyName = p.company_name || b.business_name || "";
  const logo = p.logo_data_url || null;
  const tagline = p.tagline || "";
  const about = p.about_company || b.about || "";
  const industry = (p.primary_industry || b.primary_industry || "").replace(/_/g, " ");
  const bizType = (p.business_type || "").replace(/_/g, " ");
  const stage = STAGE_LABELS[p.operating_stage] || (p.operating_stage || "").replace(/_/g, " ");
  const delivery = DELIVERY_LABELS[p.delivery_model] || (p.delivery_model || "").replace(/_/g, " ");
  const locationStr = [p.city, p.country].filter(Boolean).join(", ");
  const contactEmail = p.email || b.email || "";
  const phone = p.phone_number || "";
  const website = p.website || b.website || "";
  const linkedin = p.linkedin_url || "";
  const twitter = p.twitter_url || "";
  const instagram = p.instagram_url || "";
  const services = (Array.isArray(p.services) ? p.services : []).filter((s) => s.service_name || typeof s === "string");
  const targetCustomer = (p.target_customer_type || "").replace(/_/g, " ");
  const revenueModel = (p.primary_revenue_model || "").replace(/_/g, " ");
  const keyOffering = p.key_offering_focus || "";
  const vision = p.vision || "";
  const mission = p.mission || "";
  const coreValues = Array.isArray(p.core_values)
    ? p.core_values.filter(Boolean)
    : (typeof p.core_values === "string" && p.core_values ? [p.core_values] : []);
  const companySize = (p.company_size || "").replace(/_/g, " ");
  const yearEstablished = p.year_established ? String(p.year_established) : "";
  const hasContact = contactEmail || phone || website || linkedin || twitter || instagram;
  const hasVMV = vision || mission || coreValues.length > 0;
  const hasOps = delivery || revenueModel || targetCustomer || keyOffering || companySize;

  if (!workspaceId) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">No workspace set up yet.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <svg className="h-6 w-6 animate-spin text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (!companyName || editing) {
    return (
      <WorkspaceEditForm
        workspaceId={workspaceId}
        initialData={p}
        onSaved={(newProfile) => {
          setWs((prev) => ({ ...(prev || {}), workspace_profile: newProfile }));
          setWorkspaceCompanyName(newProfile.company_name || null);
          setWorkspaceLogo(newProfile.logo_data_url || null);
          setEditing(false);
          window.dispatchEvent(new CustomEvent("ea:workspace:refresh"));
        }}
        onCancel={companyName ? () => setEditing(false) : null}
      />
    );
  }

  return (
    <Card className="overflow-hidden">
      {/* Company banner */}
      <div className="bg-slate-50 px-6 py-5 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <CompanyAvatar logo={logo} name={companyName} size="lg" />
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">{companyName}</h3>
              {tagline && <p className="mt-0.5 text-sm italic text-slate-500 dark:text-slate-400">{tagline}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {industry && <Pill>{industry}</Pill>}
                {bizType && <Pill>{bizType}</Pill>}
                {stage && <Pill>{stage}</Pill>}
                {locationStr && (
                  <Pill>
                    <span className="inline-flex items-center gap-1">
                      <svg className="h-3 w-3 text-brand-600 dark:text-brand-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path fillRule="evenodd" d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-2.083 3.9-5.05 3.9-8.977a8.25 8.25 0 00-16.5 0c0 3.927 1.955 6.894 3.9 8.977a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                      </svg>
                      {locationStr}
                    </span>
                  </Pill>
                )}
                {yearEstablished && <Pill>Est. {yearEstablished}</Pill>}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Edit workspace
          </button>
        </div>
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 divide-y divide-slate-100 dark:divide-slate-800 md:grid-cols-2 md:divide-x md:divide-y-0">

        {/* Left */}
        <div className="px-6 py-5 space-y-5">
          {about && (
            <div>
              <SectionLabel>About</SectionLabel>
              <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">{about}</p>
            </div>
          )}

          {services.length > 0 && (
            <div>
              <SectionLabel>Services</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {services.map((s, i) => (
                  <Pill key={i}>{s.service_name || s}</Pill>
                ))}
              </div>
            </div>
          )}

          {hasOps && (
            <div>
              <SectionLabel>Operations</SectionLabel>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <DetailItem label="Delivery" value={delivery} />
                <DetailItem label="Revenue model" value={revenueModel} />
                <DetailItem label="Target customer" value={targetCustomer} />
                <DetailItem label="Key offering" value={keyOffering} />
                {companySize && <DetailItem label="Company size" value={companySize} />}
              </dl>
            </div>
          )}
        </div>

        {/* Right */}
        <div className="px-6 py-5 space-y-5">
          {hasVMV && (
            <div>
              <SectionLabel>Vision · Mission · Values</SectionLabel>
              <div className="space-y-3">
                {vision && (
                  <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Vision</div>
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-relaxed">{vision}</p>
                  </div>
                )}
                {mission && (
                  <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Mission</div>
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-relaxed">{mission}</p>
                  </div>
                )}
                {coreValues.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">Core values</div>
                    <div className="flex flex-wrap gap-1.5">
                      {coreValues.map((v, i) => <Pill key={i}>{v}</Pill>)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {hasContact && (
            <div>
              <SectionLabel>Contact & links</SectionLabel>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <DetailItem label="Email" value={contactEmail} />
                <DetailItem label="Phone" value={phone} />
                {website && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Website</div>
                    <div className="mt-0.5"><ExternalLink href={website} /></div>
                  </div>
                )}
                {linkedin && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">LinkedIn</div>
                    <div className="mt-0.5"><ExternalLink href={linkedin} label="View profile" /></div>
                  </div>
                )}
                {twitter && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">X / Twitter</div>
                    <div className="mt-0.5"><ExternalLink href={twitter} label="View profile" /></div>
                  </div>
                )}
                {instagram && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Instagram</div>
                    <div className="mt-0.5"><ExternalLink href={instagram} label="View profile" /></div>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ── main page ── */

export default function AccountPage() {
  const email = useAuthStore((s) => s.email);
  const name = useAuthStore((s) => s.name);
  const picture = useAuthStore((s) => s.picture);
  const authProvider = useAuthStore((s) => s.authProvider);
  const hasPassword = useAuthStore((s) => s.hasPassword);
  const setProfile = useAuthStore((s) => s.setProfile);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  const [tab, setTab] = useState("workspace");
  const [displayName, setDisplayName] = useState(name || "");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null);

  // OTP-gated password change: null | "request" | "otp" | "form"
  const [pwStep, setPwStep] = useState(null);
  const [otpInput, setOtpInput] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState(null);

  const initials = initialsFromName(name, email);
  const isGoogleOnly = !hasPassword;

  async function handleProfileSave(e) {
    e.preventDefault();
    setProfileLoading(true);
    setProfileMsg(null);
    try {
      const updated = await apiRequest("/auth/me", "PATCH", { name: displayName || null });
      setProfile({ name: updated.name ?? null, picture: updated.picture ?? null, authProvider: updated.auth_provider ?? null, hasPassword: updated.has_password ?? false });
      setProfileMsg({ type: "success", text: "Profile updated." });
    } catch (err) {
      setProfileMsg({ type: "error", text: err?.message || "Failed to update profile." });
    } finally {
      setProfileLoading(false);
    }
  }

  async function handleSendOTP() {
    setPasswordLoading(true);
    setPasswordMsg(null);
    try {
      await apiRequest("/auth/me/send-password-otp", "POST");
      setPwStep("otp");
      setPasswordMsg({ type: "success", text: `Verification code sent to ${email}.` });
    } catch (err) {
      setPasswordMsg({ type: "error", text: err?.message || "Failed to send code." });
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleVerifyOTP() {
    if (otpInput.length !== 6) {
      setPasswordMsg({ type: "error", text: "Enter the 6-digit code from your email." });
      return;
    }
    setPwStep("form");
    setPasswordMsg(null);
  }

  async function handlePasswordSave(e) {
    e.preventDefault();
    setPasswordMsg(null);
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "Passwords do not match." });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMsg({ type: "error", text: "Password must be at least 8 characters." });
      return;
    }
    setPasswordLoading(true);
    try {
      await apiRequest("/auth/me/change-password-otp", "POST", { otp_code: otpInput, new_password: newPassword });
      setOtpInput("");
      setNewPassword("");
      setConfirmPassword("");
      setPwStep(null);
      setPasswordMsg({ type: "success", text: "Password updated successfully." });
    } catch (err) {
      setPasswordMsg({ type: "error", text: err?.message || "Failed to update password." });
    } finally {
      setPasswordLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl pb-12">

      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Account settings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage your personal details, security, and workspace.</p>
      </div>

      <TabBar active={tab} onChange={setTab} />

      <div className="mt-6">

        {/* ── Account tab ── */}
        {tab === "account" && (
          <div className="max-w-xl mx-auto">

            {/* Profile card */}
            <Card>
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Profile</h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Your name and email address.</p>
              </div>

              {/* Avatar + identity row */}
              <div className="px-6 py-5 flex items-center gap-4 border-b border-slate-100 dark:border-slate-800">
                {picture ? (
                  <img src={picture} alt={name || email} className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-white shadow dark:ring-slate-700" />
                ) : (
                  <div className="h-14 w-14 shrink-0 flex items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white shadow">
                    {initials}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {name || <span className="italic text-slate-400">No display name</span>}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{email}</div>
                  {authProvider === "google" && (
                    <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                      <svg className="h-3 w-3" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                      Google account
                    </span>
                  )}
                </div>
              </div>

              {/* Form */}
              <div className="flex-1 px-6 py-5 flex flex-col">
                <form onSubmit={handleProfileSave} className="flex flex-col flex-1">
                  <div className="space-y-4">
                    <Field label="Display name">
                      <Input
                        type="text"
                        placeholder="Your full name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        maxLength={100}
                      />
                    </Field>
                    <Field label="Email address">
                      <Input type="email" value={email || ""} disabled />
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">Email cannot be changed.</p>
                    </Field>
                  </div>
                  <div className="mt-5 flex items-center gap-3">
                    <SubmitButton loading={profileLoading}>Save profile</SubmitButton>
                    {profileMsg && <Alert type={profileMsg?.type} message={profileMsg?.text} />}
                  </div>
                </form>

                {/* Password section */}
                <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Password</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {isGoogleOnly ? "Google account · no password set." : "Email & password login active."}
                      </p>
                    </div>
                    {!pwStep && !isGoogleOnly && (
                      <button
                        type="button"
                        onClick={() => { setPwStep("request"); setPasswordMsg(null); }}
                        className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                      >
                        Change password
                      </button>
                    )}
                    {!pwStep && isGoogleOnly && (
                      <Link
                        to={`/forgot-password?setup=1${email ? `&email=${encodeURIComponent(email)}` : ""}`}
                        className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                      >
                        Set a password
                      </Link>
                    )}
                  </div>

                  {pwStep === "request" && (
                    <div className="space-y-3">
                      <p className="text-[12px] text-slate-500 dark:text-slate-400">
                        We'll send a 6-digit verification code to <strong>{email}</strong> before you can update your password.
                      </p>
                      <Alert type={passwordMsg?.type} message={passwordMsg?.text} />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={passwordLoading}
                          onClick={handleSendOTP}
                          className="flex-1 rounded-lg bg-brand-600 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                        >
                          {passwordLoading ? "Sending…" : "Send verification code"}
                        </button>
                        <button type="button" onClick={() => { setPwStep(null); setPasswordMsg(null); }} className="text-xs text-slate-400 hover:text-slate-600 px-3">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {pwStep === "otp" && (
                    <div className="space-y-3">
                      <Alert type={passwordMsg?.type} message={passwordMsg?.text} />
                      <Field label="Enter the 6-digit code from your email">
                        <Input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="000000"
                          value={otpInput}
                          onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        />
                      </Field>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={otpInput.length !== 6}
                          onClick={handleVerifyOTP}
                          className="flex-1 rounded-lg bg-brand-600 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                        >
                          Verify code
                        </button>
                        <button type="button" onClick={handleSendOTP} disabled={passwordLoading} className="text-xs text-slate-400 hover:text-slate-600 px-3">
                          Resend
                        </button>
                      </div>
                    </div>
                  )}

                  {pwStep === "form" && (
                    <form onSubmit={handlePasswordSave} className="space-y-3">
                      <Field label="New password">
                        <Input
                          type="password"
                          placeholder="At least 8 characters"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                        />
                      </Field>
                      <Field label="Confirm new password">
                        <Input
                          type="password"
                          placeholder="Repeat new password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                        />
                      </Field>
                      <Alert type={passwordMsg?.type} message={passwordMsg?.text} />
                      <SubmitButton loading={passwordLoading}>Update password</SubmitButton>
                    </form>
                  )}

                  {!pwStep && passwordMsg && (
                    <Alert type={passwordMsg.type} message={passwordMsg.text} />
                  )}
                </div>
              </div>
            </Card>

            {/* ── Privacy & Cookies ── */}
            <Card>
              <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Privacy &amp; Cookies</h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Manage your cookie consent preferences.</p>
              </div>
              <div className="px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Cookie consent</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      You have accepted cookies on this site. You can withdraw your consent at any time. You will be asked again on your next visit.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      try { localStorage.removeItem("ea_cookie_consent"); } catch {}
                      window.location.reload();
                    }}
                    className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    Withdraw consent
                  </button>
                </div>
              </div>
            </Card>

          </div>
        )}

        {/* ── Workspace tab ── */}
        {tab === "workspace" && (
          <WorkspaceTab workspaceId={workspaceId} />
        )}

        {/* ── Billing tab ── */}
        {tab === "billing" && (
          <BillingTab />
        )}

      </div>
    </div>
  );
}
