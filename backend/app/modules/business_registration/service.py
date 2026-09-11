from __future__ import annotations

import csv
import re
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from typing import Iterable, List

import httpx

from app.core.config import Settings
from fastapi import HTTPException, status
from app.modules.business_registration.schemas import RegistrationGuideRequest, RegistrationGuideResponse
from app.modules.business_registration.schemas import (
    UkEntityType,
    UkEntityTypeGroup,
    UkEntityTypesResponse,
    UkNameCheckResponse,
    UkSicCode,
)


def recommend_business_type(payload: RegistrationGuideRequest) -> str:
    risk = payload.liability_risk.lower().strip()
    if payload.wants_investment:
        return "Corporation (C-Corp equivalent)"
    if risk == "high" or payload.has_employees_soon:
        return "Limited Liability Company (LLC equivalent)"
    if payload.founder_count == 1:
        return "Sole Proprietorship (early-stage) or LLC"
    return "Partnership (early-stage) or LLC"


def readiness_checklist(_: RegistrationGuideRequest) -> list[str]:
    return [
        "Confirm business name availability",
        "Define ownership split and roles",
        "Write a short business description and objectives",
        "Decide registered address and contact email",
        "List initial products/services and pricing approach",
        "Draft founder agreement (if >1 founder)",
        "Prepare basic financial assumptions (revenue, costs, runway)",
        "Choose accounting approach and open a business bank account",
    ]


def next_steps(payload: RegistrationGuideRequest) -> list[str]:
    steps = [
        "Select a legal structure based on liability and funding needs",
        "Collect required IDs/documents for founders",
        "Prepare a simple operating agreement / bylaws",
        "Register tax identification (as required)",
    ]
    if payload.has_employees_soon:
        steps.append("Set up payroll provider and employee contracts")
    if payload.wants_investment:
        steps.append("Prepare cap table, investor materials, and due diligence folder")
    return steps


def external_link_for_country(country: str) -> str:
    c = country.lower().strip()
    if "nigeria" in c:
        return "https://portal.cac.gov.ng/"
    if "united states" in c or c in ("usa", "us"):
        return "https://www.sba.gov/business-guide/launch-your-business/register-your-business"
    if "united kingdom" in c or c in ("uk", "britain", "england"):
        return "https://www.gov.uk/set-up-business"
    return "https://www.google.com/search?q=business+registration+portal"


def generate_registration_guide(payload: RegistrationGuideRequest) -> RegistrationGuideResponse:
    return RegistrationGuideResponse(
        recommended_type=recommend_business_type(payload),
        checklist=readiness_checklist(payload),
        next_steps=next_steps(payload),
        external_link=external_link_for_country(payload.country),
    )


def uk_entity_types() -> UkEntityTypesResponse:
    # Deterministic catalog based on Companies House & UK registration authorities.
    # Fees: Companies House incorporation (most company types) and CIC registration.
    companies_house = [
        UkEntityType(
            key="ltd_shares",
            name="Private Company Limited by Shares (Ltd)",
            authority="Companies House",
            recommended=True,
            description="Most common UK company structure. Shareholders' liability limited to unpaid share value.",
            fee={"online_gbp": 50, "paper_gbp": 71, "same_day_gbp": 78},
            ideal_for=["SMEs & startups", "Consultants & freelancers", "Trading businesses", "Investment vehicles"],
            benefits=["Limited liability protection", "Professional credibility", "Tax planning flexibility", "Easier to raise investment"],
        ),
        UkEntityType(
            key="ltd_guarantee",
            name="Private Company Limited by Guarantee",
            authority="Companies House",
            description="No shareholders; members act as guarantors. Profits reinvested, not distributed.",
            fee={"online_gbp": 50, "paper_gbp": 71, "same_day_gbp": 78},
            ideal_for=["Non-profit organisations", "Membership bodies", "Charities & associations", "Clubs & societies"],
            benefits=["Limited liability for members", "No share capital required", "Democratic structure", "Asset lock compatible (when used with CIC/charity routes)"],
        ),
        UkEntityType(
            key="plc",
            name="Public Limited Company (PLC)",
            authority="Companies House",
            description="Can offer shares to the public. Required for stock exchange listing.",
            fee={"online_gbp": 50, "paper_gbp": 71, "same_day_gbp": 78},
            ideal_for=["Large enterprises", "Companies planning IPO", "Stock exchange listing", "Public investment raising"],
            benefits=["Can raise capital publicly", "Enhanced credibility", "Share liquidity", "Growth potential"],
        ),
        UkEntityType(
            key="unlimited",
            name="Unlimited Company",
            authority="Companies House",
            description="Members have unlimited personal liability. Rarely used; sometimes chosen for privacy or structuring.",
            fee={"online_gbp": 50, "paper_gbp": 71, "same_day_gbp": 78},
            ideal_for=["Privacy-focused structures", "Family investment vehicles", "Specialist structuring"],
            benefits=["Potential privacy advantages (context-dependent)", "Flexible structuring"],
        ),
        UkEntityType(
            key="llp",
            name="Limited Liability Partnership (LLP)",
            authority="Companies House",
            description="Hybrid of partnership and limited company. Members have limited liability.",
            fee={"online_gbp": 50, "paper_gbp": 71, "same_day_gbp": 78},
            ideal_for=["Law firms", "Accountancy practices", "Consulting firms", "Professional services"],
            benefits=["Limited liability for partners", "Profit sharing flexibility", "Professional credibility"],
        ),
        UkEntityType(
            key="lp",
            name="Limited Partnership (LP)",
            authority="Companies House",
            description="At least one general partner (unlimited liability) and one limited partner.",
            fee={"paper_gbp": 20, "note": "No standard online filing for LP in the same way as companies."},
            ideal_for=["Investment funds", "Private equity structures", "Venture capital", "Real estate investments"],
            benefits=["Limited liability for limited partners", "Flexible profit allocation", "Common fund structure"],
        ),
        UkEntityType(
            key="cic_shares",
            name="Community Interest Company (CIC) - Limited by Shares",
            authority="Companies House",
            description="Social enterprise structure. Profits must benefit the community (dividends capped).",
            fee={"online_gbp": 35, "paper_gbp": 71},
            ideal_for=["Social enterprises", "Ethical businesses", "Impact investing", "Community projects"],
            benefits=["Community benefit focus", "Social credibility", "Asset lock protection", "Can pay dividends (capped)"],
        ),
        UkEntityType(
            key="cic_guarantee",
            name="Community Interest Company (CIC) - Limited by Guarantee",
            authority="Companies House",
            description="Social enterprise without share capital. Profits reinvested in community.",
            fee={"online_gbp": 35, "paper_gbp": 71},
            ideal_for=["Non-profit social enterprises", "Community organisations", "Charitable trading", "Social housing"],
            benefits=["Community asset lock", "Grant eligibility potential", "Social enterprise status"],
        ),
        UkEntityType(
            key="overseas_uk_establishment",
            name="Overseas Company (UK Establishment)",
            authority="Companies House",
            description="Non-UK company operating in the UK. Must register UK establishment or branch.",
            fee={"online_gbp": 50, "paper_gbp": 71},
            ideal_for=["International expansion", "UK branch operations", "Foreign subsidiaries", "Global businesses"],
            benefits=["UK trading presence", "Local credibility", "Access to UK market"],
        ),
    ]

    other_authorities = [
        UkEntityType(
            key="sole_trader",
            name="Sole Trader",
            authority="HMRC",
            description="Simplest structure. You and the business are legally the same entity.",
            fee={"online_gbp": 0, "note": "Registration is typically via HMRC Self Assessment."},
            ideal_for=["Freelancers", "Small service providers", "Testing business ideas"],
            benefits=["Minimal paperwork", "Full control", "Simple tax setup"],
        ),
        UkEntityType(
            key="cio",
            name="Charitable Incorporated Organisation (CIO)",
            authority="Charity Commission",
            description="Legal structure exclusively for charities. Limited liability without company status.",
            fee={"online_gbp": 0},
            ideal_for=["Charities", "Grant-funded organisations", "Educational charities"],
            benefits=["Charity credibility", "Limited liability", "Charity tax exemptions (eligibility-based)"],
        ),
        UkEntityType(
            key="royal_charter",
            name="Royal Charter Company",
            authority="Privy Council",
            description="Incorporated by Royal Charter. Used by universities and institutions.",
            fee={"note": "Fees depend on application and process."},
            ideal_for=["Universities", "Professional bodies", "Historic institutions"],
            benefits=["Prestige", "Royal recognition", "Public trust"],
        ),
        UkEntityType(
            key="coop_society",
            name="Co-operative / Community Benefit Society",
            authority="Financial Conduct Authority (FCA)",
            description="Member-owned organisations with democratic control (one member, one vote).",
            fee={"note": "Fees vary by route and filing method."},
            ideal_for=["Worker co-operatives", "Consumer co-operatives", "Housing associations"],
            benefits=["Democratic control", "Community ownership", "Social purpose alignment"],
        ),
    ]

    return UkEntityTypesResponse(
        groups=[
            UkEntityTypeGroup(
                title="Companies House Registered",
                subtitle="Entity types registered with Companies House.",
                items=companies_house,
            ),
            UkEntityTypeGroup(
                title="Other Registration Authorities",
                subtitle="These entities are registered with other authorities (HMRC, Charity Commission, FCA, etc.).",
                items=other_authorities,
            ),
        ]
    )


async def uk_check_company_name(*, name: str, settings: Settings) -> UkNameCheckResponse:
    q = name.strip()
    if not q:
        return UkNameCheckResponse(name=name, available=False, exact_matches=[], similar=[])

    api_key = (settings.companies_house_api_key or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Companies House API key not configured on server.",
        )

    base_url = "https://api.company-information.service.gov.uk"
    url = f"{base_url}/search/companies"
    params = {"q": q, "items_per_page": 10}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, params=params, auth=(api_key, ""))
            r.raise_for_status()
            data = r.json() or {}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Companies House error: {e.response.status_code}")
    except Exception:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to reach Companies House.")

    items = data.get("items") or []
    titles: List[str] = []
    for it in items:
        t = it.get("title")
        if isinstance(t, str) and t.strip():
            titles.append(t.strip())

    suffixes = {
        "limited",
        "ltd",
        "llp",
        "plc",
        "cic",
        "company",
        "co",
        "the",
        "and",
    }

    def norm(s: str) -> str:
        s2 = re.sub(r"\s+", " ", s.strip().lower())
        return re.sub(r"[^a-z0-9 ]+", "", s2)

    def tokens(s: str) -> list[str]:
        raw = [t for t in norm(s).split(" ") if t]
        return [t for t in raw if t not in suffixes]

    def compact(s: str) -> str:
        return "".join(tokens(s))

    def similarity(a: str, b: str) -> float:
        ta = set(tokens(a))
        tb = set(tokens(b))
        if not ta or not tb:
            return 0.0
        jaccard = len(ta & tb) / len(ta | tb)
        seq = SequenceMatcher(None, compact(a), compact(b)).ratio()
        return max(jaccard, seq)

    qn = norm(q)
    exact = [t for t in titles if norm(t) == qn]
    similar = []
    for t in titles:
        if t in exact:
            continue
        if similarity(q, t) >= 0.78:
            similar.append(t)
    # Treat as unavailable only when exact match exists or strong similarity exists.
    available = len(exact) == 0 and len(similar) == 0
    return UkNameCheckResponse(name=q, available=available, exact_matches=exact, similar=similar[:8])


def uk_sic_suggestions(*, description: str) -> List[UkSicCode]:
    # Deterministic, lightweight SIC suggestion engine.
    # NOTE: This is not an AI model; it is a keyword-based matcher over a curated subset.
    text = re.sub(r"\s+", " ", (description or "").strip().lower())
    tokens = set(re.findall(r"[a-z0-9]+", text))

    catalog: List[tuple[UkSicCode, Iterable[str]]] = [
        (UkSicCode(code="81210", title="General cleaning of buildings"), ["cleaning", "cleaner", "janitorial"]),
        (UkSicCode(code="81221", title="Window cleaning services"), ["window", "windows", "glass"]),
        (UkSicCode(code="81222", title="Specialised cleaning services"), ["deep", "specialised", "specialized", "carpet", "upholstery"]),
        (UkSicCode(code="81223", title="Furnace and chimney cleaning services"), ["chimney", "furnace"]),
        (UkSicCode(code="81229", title="Other building and industrial cleaning activities"), ["industrial", "factory", "warehouse", "building"]),
        (UkSicCode(code="81100", title="Combined facilities support activities"), ["facilities", "facility", "maintenance"]),
        (UkSicCode(code="81300", title="Landscape service activities"), ["landscape", "gardening", "garden"]),
        (UkSicCode(code="96010", title="Washing and (dry-)cleaning of textile and fur products"), ["laundry", "washing", "wash", "dryclean", "dry-clean", "dry"]),
        (UkSicCode(code="62012", title="Business and domestic software development"), ["software", "saas", "app", "development", "platform"]),
        (UkSicCode(code="62020", title="Information technology consultancy activities"), ["it", "consulting", "consultancy", "tech", "systems"]),
        (UkSicCode(code="63110", title="Data processing, hosting and related activities"), ["hosting", "cloud", "data", "infrastructure"]),
        (UkSicCode(code="70229", title="Management consultancy activities other than financial management"), ["management", "strategy", "advisory"]),
        (UkSicCode(code="73110", title="Advertising agencies"), ["advertising", "ads", "campaign", "media", "promotion"]),
        (UkSicCode(code="73120", title="Media representation services"), ["influencer", "representation", "media"]),
        (UkSicCode(code="86900", title="Other human health activities"), ["health", "clinic", "care", "therapy", "medical"]),
        (UkSicCode(code="64999", title="Financial intermediation not elsewhere classified"), ["finance", "lending", "credit", "payments"]),
        (UkSicCode(code="96090", title="Other service activities not elsewhere classified"), ["services", "support", "assistance"]),
        (UkSicCode(code="47910", title="Retail sale via mail order houses or via Internet"), ["ecommerce", "e-commerce", "online", "store", "retail"]),
    ]

    scored: list[tuple[int, UkSicCode]] = []
    for sic, keys in catalog:
        hits = 0
        for k in keys:
            if k in tokens:
                hits += 1
        if hits:
            scored.append((hits, sic))

    scored.sort(key=lambda x: (-x[0], x[1].code))
    suggestions: List[UkSicCode] = [sic for _, sic in scored][:6]

    def add_unique(out: List[UkSicCode], candidates: List[UkSicCode]) -> None:
        existing = {s.code for s in out}
        for c in candidates:
            if c.code in existing:
                continue
            out.append(c)
            existing.add(c.code)
            if len(out) >= 6:
                return

    # Deterministic padding to always return 6 options.
    # Choose category-specific fallbacks first, then general.
    cleaning_fallback = [
        UkSicCode(code="81210", title="General cleaning of buildings"),
        UkSicCode(code="81221", title="Window cleaning services"),
        UkSicCode(code="81222", title="Specialised cleaning services"),
        UkSicCode(code="81229", title="Other building and industrial cleaning activities"),
        UkSicCode(code="81100", title="Combined facilities support activities"),
        UkSicCode(code="96010", title="Washing and (dry-)cleaning of textile and fur products"),
    ]
    tech_fallback = [
        UkSicCode(code="62012", title="Business and domestic software development"),
        UkSicCode(code="62020", title="Information technology consultancy activities"),
        UkSicCode(code="63110", title="Data processing, hosting and related activities"),
        UkSicCode(code="58290", title="Other software publishing"),
        UkSicCode(code="62090", title="Other information technology service activities"),
        UkSicCode(code="82990", title="Other business support service activities n.e.c."),
    ]
    general_fallback = [
        UkSicCode(code="96090", title="Other service activities not elsewhere classified"),
        UkSicCode(code="82990", title="Other business support service activities n.e.c."),
        UkSicCode(code="70229", title="Management consultancy activities other than financial management"),
        UkSicCode(code="47910", title="Retail sale via mail order houses or via Internet"),
        UkSicCode(code="73110", title="Advertising agencies"),
        UkSicCode(code="73120", title="Media representation services"),
    ]

    is_cleaning = any(t in tokens for t in ("clean", "cleaning", "cleaner", "janitorial", "wash", "washing", "laundry"))
    is_tech = any(t in tokens for t in ("software", "saas", "app", "platform", "it", "tech", "hosting", "cloud", "data"))

    if len(suggestions) < 6:
        if is_cleaning:
            add_unique(suggestions, cleaning_fallback)
        if is_tech and len(suggestions) < 6:
            add_unique(suggestions, tech_fallback)
        if len(suggestions) < 6:
            add_unique(suggestions, general_fallback)

    return suggestions[:6]


@lru_cache
def _load_uk_sic_2007() -> List[UkSicCode]:
    """
    Load UK SIC 2007 codes from a CSV stored in `app/shared/data/`.

    Expected: a 5-digit code + title/description columns. The loader is tolerant to column names.
    """
    app_dir = Path(__file__).resolve().parents[2]
    data_dir = app_dir / "shared" / "data"
    candidates = [
        data_dir / "uk_sic_2007.csv",
        data_dir / "uk-sic-2007.csv",
    ]
    csv_path = next((p for p in candidates if p.exists()), None)
    if csv_path is None:
        # Best-effort: pick any uk*sic*.csv
        for p in sorted(data_dir.glob("*sic*.csv")):
            csv_path = p
            break
    if csv_path is None:
        raise RuntimeError("UK SIC 2007 CSV not found in app/shared/data/")

    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = [str(x or "").strip() for x in (reader.fieldnames or [])]

        def pick(keys: list[str]) -> str | None:
            lower = {k.lower(): k for k in fieldnames}
            for want in keys:
                for k in fieldnames:
                    if want in k.lower():
                        return k
                if want in lower:
                    return lower[want]
            return None

        code_col = pick(["sic", "code"])
        title_col = pick(["title", "description", "activity", "name"])

        if not code_col or not title_col:
            # Fallback to the first two columns
            if len(fieldnames) >= 2:
                code_col = code_col or fieldnames[0]
                title_col = title_col or fieldnames[1]

        out: list[UkSicCode] = []
        for row in reader:
            if not row:
                continue
            code_raw = str(row.get(code_col) or "").strip()
            title_raw = str(row.get(title_col) or "").strip()
            code = re.sub(r"\D+", "", code_raw)
            if not re.fullmatch(r"\d{5}", code):
                continue
            if not title_raw:
                continue
            out.append(UkSicCode(code=code, title=title_raw))

    # De-dupe by code (keep first)
    seen: set[str] = set()
    unique: list[UkSicCode] = []
    for s in out:
        if s.code in seen:
            continue
        seen.add(s.code)
        unique.append(s)
    return unique


# Common connector/filler words. Left in q_tokens, these matched against every
# SIC title built from the template "Retail sale of X ... in specialised stores"
# (dozens of entries in the 47.xx range alone) — a long free-text business
# description (e.g. the full "About your business" paragraph, not a short
# keyword) would rack up +10 for "of", "and", "in", "for" against practically
# every retail-category title, drowning out any real keyword match and
# returning essentially-random retail codes with zero topical relevance. This
# is the actual bug behind SIC suggestions like "meat retail" / "paint and
# varnish manufacture" for an AI health & wellness business: the query had no
# real matching tokens, but plenty of stopword noise scored positively anyway.
_SIC_SEARCH_STOPWORDS = frozenset({
    "a", "an", "the", "of", "and", "or", "in", "on", "at", "to", "for", "with",
    "is", "are", "was", "were", "be", "been", "being", "it", "its", "as", "by",
    "we", "our", "us", "you", "your", "that", "this", "these", "those", "who",
    "which", "will", "can", "not", "into", "than", "so", "if", "but", "also",
})


def uk_sic_search(*, query: str, limit: int = 6) -> List[UkSicCode]:
    """
    Deterministic SIC search over the official UK SIC 2007 dataset (ONS).
    """
    limit = max(1, min(limit, 6))
    q = (query or "").strip()
    if not q:
        return []

    codes = _load_uk_sic_2007()

    q_lower = q.lower()
    q_tokens = [
        t for t in re.findall(r"[a-z0-9]+", q_lower)
        if len(t) >= 3 and t not in _SIC_SEARCH_STOPWORDS
    ]
    q_digits = re.sub(r"\D+", "", q)

    def score(item: UkSicCode) -> int:
        s = 0
        title = item.title.lower()
        if q_digits and item.code.startswith(q_digits):
            s += 100
        if q_lower in title:
            s += 60
        # Token overlap scoring
        for t in q_tokens:
            if t in title:
                s += 10
        # Prefer more specific matches
        if title.startswith(q_lower):
            s += 20
        return s

    scored: list[tuple[int, UkSicCode]] = []
    for it in codes:
        sc = score(it)
        if sc > 0:
            scored.append((sc, it))

    scored.sort(key=lambda x: (-x[0], x[1].code))
    results = [it for _, it in scored][: max(1, min(int(limit), 50))]

    # If too few results (e.g., weird query), add deterministic padding with common service categories
    if len(results) < min(6, int(limit)):
        common = [
            UkSicCode(code="82990", title="Other business support service activities n.e.c."),
            UkSicCode(code="96090", title="Other service activities not elsewhere classified"),
            UkSicCode(code="70229", title="Management consultancy activities other than financial management"),
        ]
        existing = {r.code for r in results}
        for c in common:
            if c.code in existing:
                continue
            results.append(c)
            existing.add(c.code)
            if len(results) >= min(6, int(limit)):
                break

    return results[: max(1, min(int(limit), 50))]
