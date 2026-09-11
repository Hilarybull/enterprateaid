import { useEffect, useMemo, useState } from "react";
import Button from "../../components/Button";
import Spinner from "../../components/Spinner";
import { apiRequest } from "../../api/client";
import { REG_STEPS } from "./steps";
import { classNames, pct, formatGbp } from "./utils";
import { useWorkspaceStore } from "../../store/workspace";

import BusinessTypeStep from "./steps/BusinessTypeStep";
import CompanyNameStep from "./steps/CompanyNameStep";
import ActivityStep from "./steps/ActivityStep";
import PeopleStep from "./steps/PeopleStep";
import AddressStep from "./steps/AddressStep";
import DocumentsStep from "./steps/DocumentsStep";
import SummaryStep from "./steps/SummaryStep";
import RegistrationStatusStep from "./steps/RegistrationStatusStep";

export default function RegistrationWizard() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);
  const ideaValidation = useWorkspaceStore((s) => s.ideaValidation);
  const [stepIndex, setStepIndex] = useState(0);
  const step = REG_STEPS[stepIndex];
  const progressPct = pct(stepIndex, REG_STEPS.length);

  function CheckIcon({ className = "h-4 w-4" }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }

  const [entityTypes, setEntityTypes] = useState(null);
  const [entityTypesError, setEntityTypesError] = useState(null);
  const [entityTypesLoading, setEntityTypesLoading] = useState(false);
  const [selectedEntityKey, setSelectedEntityKey] = useState("ltd_shares");

  const [companyName, setCompanyName] = useState("");
  const [companyNameTouched, setCompanyNameTouched] = useState(false);
  const [altName1, setAltName1] = useState("");
  const [altName2, setAltName2] = useState("");
  const [nameCheck, setNameCheck] = useState(null);
  const [altName1Check, setAltName1Check] = useState(null);
  const [altName2Check, setAltName2Check] = useState(null);
  const [nameCheckLoading, setNameCheckLoading] = useState(false);
  const [nameCheckError, setNameCheckError] = useState(null);

  const [businessDescription, setBusinessDescription] = useState("");
  const [sicSuggestions, setSicSuggestions] = useState([]);
  const [sicSelected, setSicSelected] = useState([]);
  const [sicLoading, setSicLoading] = useState(false);
  const [sicError, setSicError] = useState(null);

  const [directors, setDirectors] = useState([{ first_name: "", last_name: "", dob: "", nationality: "", occupation: "", residential_address: "" }]);
  const [addressType, setAddressType] = useState("home");
  const [registeredAddress, setRegisteredAddress] = useState("");
  const [ackNotAgent, setAckNotAgent] = useState(false);
  const [ackSelfRegister, setAckSelfRegister] = useState(false);
  const [registrationStatus, setRegistrationStatus] = useState("not_started");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [registrationDate, setRegistrationDate] = useState("");
  const [registrationNotes, setRegistrationNotes] = useState("");
  const [registrationCheckName, setRegistrationCheckName] = useState("");
  const [registrationCheckResult, setRegistrationCheckResult] = useState(null);
  const [registrationCheckLoading, setRegistrationCheckLoading] = useState(false);
  const [registrationCheckError, setRegistrationCheckError] = useState(null);

  const companiesHouseLink = "https://www.gov.uk/limited-company-formation/register-your-company";
  const modelArticlesLink = "https://www.gov.uk/government/publications/model-articles-for-private-companies-limited-by-shares";

  useEffect(() => {
    let alive = true;
    async function load() {
      setEntityTypesLoading(true);
      setEntityTypesError(null);
      try {
        const res = await apiRequest("/registration/uk/entity-types", "GET");
        if (!alive) return;
        setEntityTypes(res);
      } catch (e) {
        if (!alive) return;
        setEntityTypesError(e instanceof Error ? e.message : "Failed to load entity types");
      } finally {
        if (alive) setEntityTypesLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ideaValidation) return;
    const ctx = ideaValidation.context || {};
    const offer = ideaValidation.offer || {};
    const prob = ideaValidation.problem || {};

    if (!companyNameTouched && !companyName && ctx.business_name) setCompanyName(ctx.business_name);
    if (!businessDescription) {
      const descParts = [offer.service_type, prob.customer_segment, prob.problem_type].filter(Boolean);
      if (descParts.length) setBusinessDescription(descParts.join(" ").trim());
    }
  }, [businessDescription, companyName, companyNameTouched, ideaValidation]);

  useEffect(() => {
    let alive = true;
    async function prefillFromWorkspace() {
      if (!workspaceId || ideaValidation) return;
      try {
        const ws = await apiRequest(`/validation/${workspaceId}`, "GET");
        if (!alive || !ws) return;
        const reg = ws?.data?.registration || {};
        const workspaceProfile = ws?.data?.workspace_profile || {};
        if (!companyNameTouched && !companyName && workspaceProfile.company_name) {
          setCompanyName(workspaceProfile.company_name);
        }
        if (!businessDescription && workspaceProfile.about_company) {
          setBusinessDescription(workspaceProfile.about_company);
        }
        if (!companyName && reg.company_name) setCompanyName(reg.company_name);
        if (!altName1 && reg.alt_name_1) setAltName1(reg.alt_name_1);
        if (!altName2 && reg.alt_name_2) setAltName2(reg.alt_name_2);
        if (!businessDescription && reg.business_description) setBusinessDescription(reg.business_description);
        if (!registeredAddress && reg.registered_address) setRegisteredAddress(reg.registered_address);
        if (reg.address_type) setAddressType(reg.address_type);
        if (Array.isArray(reg.sic_codes) && reg.sic_codes.length) setSicSelected(reg.sic_codes);
        if (reg.entity_type) setSelectedEntityKey(reg.entity_type);
        const status = ws?.data?.registration_status || {};
        if (status.status) setRegistrationStatus(status.status);
        if (status.registration_number) setRegistrationNumber(status.registration_number);
        if (status.registration_date) setRegistrationDate(status.registration_date);
        if (status.notes) setRegistrationNotes(status.notes);
        if (status.checked_company_name) setRegistrationCheckName(status.checked_company_name);
      } catch {
        // ignore
      }
    }
    prefillFromWorkspace();
    return () => {
      alive = false;
    };
  }, [altName1, altName2, businessDescription, companyName, ideaValidation, registeredAddress, workspaceId]);

  function buildPatchPayload() {
    return {
      name: companyName.trim() || undefined,
      data: {
        business_profile: {
          business_name: companyName.trim(),
          primary_industry: ideaValidation?.context?.primary_industry || "",
          business_type: ideaValidation?.context?.business_type || ""
        },
        workspace_profile: {
          company_name: companyName.trim(),
          about_company: businessDescription.trim()
        },
        registration: {
          company_name: companyName.trim(),
          alt_name_1: altName1.trim(),
          alt_name_2: altName2.trim(),
          business_description: businessDescription.trim(),
          entity_type: selectedEntityKey,
          registered_address: registeredAddress.trim(),
          address_type: addressType,
          sic_codes: sicSelected
        },
        registration_status: {
          status: registrationStatus,
          registration_number: registrationNumber.trim(),
          registration_date: registrationDate,
          notes: registrationNotes.trim(),
          checked_company_name: registrationCheckName.trim()
        }
      }
    };
  }

  async function saveNow() {
    if (!workspaceId) return null;
    const ws = await apiRequest(`/validation/${workspaceId}`, "PATCH", buildPatchPayload());
    if (ws?.id) {
      setWorkspaceId(ws.id);
      if (ws?.name) setWorkspaceName(ws.name);
    }
    return ws;
  }

  useEffect(() => {
    const hasAny =
      companyName.trim() ||
      businessDescription.trim() ||
      registeredAddress.trim() ||
      altName1.trim() ||
      altName2.trim();
    if (!hasAny || !workspaceId) return;
    const timer = setTimeout(() => {
      saveNow().catch(() => {
        // ignore — this is a background autosave, the debounce will retry on the next edit
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [
    addressType,
    altName1,
    altName2,
    businessDescription,
    companyName,
    ideaValidation,
    registeredAddress,
    registrationStatus,
    registrationNumber,
    registrationDate,
    registrationNotes,
    selectedEntityKey,
    sicSelected,
    workspaceId
  ]);

  const selectedEntity = useMemo(() => {
    const groups = entityTypes?.groups || [];
    for (const g of groups) {
      for (const it of g.items || []) {
        if (it.key === selectedEntityKey) return it;
      }
    }
    return null;
  }, [entityTypes, selectedEntityKey]);

  const canCheckNames = Boolean(companyName.trim() || altName1.trim() || altName2.trim());

  async function checkAvailability() {
    setNameCheckLoading(true);
    setNameCheckError(null);
    setNameCheck(null);
    setAltName1Check(null);
    setAltName2Check(null);
    try {
      const checks = [];
      if (companyName.trim()) {
        checks.push(
          apiRequest(`/registration/uk/name/check?name=${encodeURIComponent(companyName)}`, "GET").then((res) => ({
            key: "primary",
            res
          }))
        );
      }
      if (altName1.trim()) {
        checks.push(
          apiRequest(`/registration/uk/name/check?name=${encodeURIComponent(altName1)}`, "GET").then((res) => ({
            key: "alt1",
            res
          }))
        );
      }
      if (altName2.trim()) {
        checks.push(
          apiRequest(`/registration/uk/name/check?name=${encodeURIComponent(altName2)}`, "GET").then((res) => ({
            key: "alt2",
            res
          }))
        );
      }
      const results = await Promise.all(checks);
      results.forEach((item) => {
        if (item.key === "primary") setNameCheck(item.res);
        if (item.key === "alt1") setAltName1Check(item.res);
        if (item.key === "alt2") setAltName2Check(item.res);
      });
    } catch (e) {
      setNameCheckError(e instanceof Error ? e.message : "Name check failed");
    } finally {
      setNameCheckLoading(false);
    }
  }

  async function checkRegistrationStatusName() {
    setRegistrationCheckLoading(true);
    setRegistrationCheckError(null);
    setRegistrationCheckResult(null);
    try {
      const res = await apiRequest(
        `/registration/uk/name/check?name=${encodeURIComponent(registrationCheckName)}`,
        "GET"
      );
      setRegistrationCheckResult(res);
    } catch (e) {
      setRegistrationCheckError(e instanceof Error ? e.message : "Registration check failed");
    } finally {
      setRegistrationCheckLoading(false);
    }
  }

  async function generateSic() {
    setSicLoading(true);
    setSicError(null);
    try {
      const res = await apiRequest("/registration/uk/sic/search", "POST", { query: businessDescription, limit: 6 });
      const results = Array.isArray(res?.results) ? res.results : [];
      setSicSuggestions(results);
      setSicSelected([]);
    } catch (e) {
      setSicError(e instanceof Error ? e.message : "SIC generation failed");
    } finally {
      setSicLoading(false);
    }
  }

  function toggleSic(code) {
    setSicSelected((prev) => {
      const has = prev.includes(code);
      if (has) return prev.filter((c) => c !== code);
      if (prev.length >= 4) return prev;
      return [...prev, code];
    });
  }

  function addDirector() {
    setDirectors((prev) => [...prev, { first_name: "", last_name: "", dob: "", nationality: "", occupation: "", residential_address: "" }]);
  }

  function removeDirector(idx) {
    setDirectors((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateDirector(idx, key, value) {
    setDirectors((prev) => prev.map((d, i) => (i === idx ? { ...d, [key]: value } : d)));
  }

  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState(null);
  const [finished, setFinished] = useState(false);

  function goNext() {
    if (stepIndex === REG_STEPS.length - 1) {
      finishRegistration();
      return;
    }
    setStepIndex((i) => Math.min(REG_STEPS.length - 1, i + 1));
  }

  function goBack() {
    setStepIndex((i) => Math.max(0, i - 1));
  }

  async function finishRegistration() {
    // Previously a no-op: on the last step, "Finish" just clamped stepIndex to
    // itself (Math.min(REG_STEPS.length - 1, i + 1)) and did nothing else — no
    // save, no confirmation, no next action. This is a prep guide (see the note
    // above the wizard), so there's nothing to submit to Companies House; "Finish"
    // should guarantee everything is saved and confirm that clearly.
    setFinishing(true);
    setFinishError(null);
    try {
      await saveNow();
      setFinished(true);
    } catch (e) {
      setFinishError(e instanceof Error ? e.message : "Couldn't save your registration details. Please try again.");
    } finally {
      setFinishing(false);
    }
  }

  const summary = useMemo(() => {
    const entityName = selectedEntity?.name || "-";
    const fee = selectedEntity?.fee || {};
    const feeText = fee?.note ? fee.note : fee?.online_gbp !== undefined ? `${formatGbp(fee.online_gbp)} (online)` : "-";
    const director0 = directors?.[0] || {};
    const directorName = [director0.first_name, director0.last_name].filter(Boolean).join(" ").trim() || "-";

    return {
      company_name: companyName || "-",
      entity_type: entityName,
      registration_fee: feeText,
      sic_codes: sicSelected.length ? sicSelected.join(", ") : "-",
      business_description: businessDescription || "-",
      registered_address: registeredAddress || "-",
      address_type: addressType === "home" ? "Home address" : addressType === "office" ? "Office address" : "Virtual office",
      director_name: directorName,
      director_dob: director0.dob || "-",
      director_nationality: director0.nationality || "-",
      director_occupation: director0.occupation || "-",
      director_residential_address: director0.residential_address || "-"
    };
  }, [addressType, businessDescription, companyName, directors, registeredAddress, selectedEntity, sicSelected]);

  const disableNext =
    (step.key === "activity" && sicSelected.length !== 4) ||
    (step.key === "documents" && (!ackNotAgent || !ackSelfRegister)) ||
    (step.key === "status" &&
      registrationStatus === "registered" &&
      !(registrationCheckResult?.exact_matches?.length > 0));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-900">{step.label}</div>
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
              Step {stepIndex + 1} of {REG_STEPS.length}
            </div>
            <div className="text-xs font-semibold text-slate-500">{progressPct}% complete</div>
          </div>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-brand-600" style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }} />
        </div>
      </div>

        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200 [@media(max-height:820px)]:hidden">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {REG_STEPS.map((s, i) => {
            const isActive = i === stepIndex;
            const isDone = i < stepIndex;
            const canGo = i <= stepIndex;
            return (
              <button
                key={s.key}
                type="button"
                disabled={!canGo}
                onClick={() => setStepIndex(i)}
                  className={
                    "group inline-flex items-center justify-center gap-2 rounded-xl border px-2 py-1.5 text-[11px] font-semibold transition " +
                    (isActive
                    ? "border-brand-300 bg-brand-50 text-brand-800"
                    : isDone
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 bg-white text-slate-500") +
                  (canGo ? " hover:border-slate-300" : " cursor-not-allowed opacity-60")
                }
              >
                <span
                  className={
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold " +
                    (isActive ? "bg-brand-600 text-white" : isDone ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600")
                  }
                >
                  {isDone ? <CheckIcon className="h-4 w-4" /> : i + 1}
                </span>
                <span className="min-w-0 truncate">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col">
        <div className="pb-24">
          {step.key === "business_type" ? (
            <BusinessTypeStep
              entityTypes={entityTypes}
              loading={entityTypesLoading}
              error={entityTypesError}
              selectedEntityKey={selectedEntityKey}
              onSelectEntityKey={setSelectedEntityKey}
            />
          ) : step.key === "company_name" ? (
            <CompanyNameStep
              companyName={companyName}
              setCompanyName={(value) => {
                setCompanyNameTouched(true);
                setCompanyName(value);
              }}
              altName1={altName1}
              setAltName1={setAltName1}
              altName2={altName2}
              setAltName2={setAltName2}
              nameCheck={nameCheck}
              altName1Check={altName1Check}
              altName2Check={altName2Check}
              canCheckNames={canCheckNames}
              loading={nameCheckLoading}
              error={nameCheckError}
              onCheck={checkAvailability}
            />
          ) : step.key === "activity" ? (
            <ActivityStep
              businessDescription={businessDescription}
              setBusinessDescription={setBusinessDescription}
              sicSuggestions={sicSuggestions}
              sicSelected={sicSelected}
              loading={sicLoading}
              error={sicError}
              onGenerate={generateSic}
              onToggleSic={toggleSic}
            />
          ) : step.key === "people" ? (
            <PeopleStep
              directors={directors}
              onAddDirector={addDirector}
              onRemoveDirector={removeDirector}
              onUpdateDirector={updateDirector}
            />
          ) : step.key === "address" ? (
            <AddressStep
              addressType={addressType}
              setAddressType={setAddressType}
              registeredAddress={registeredAddress}
              setRegisteredAddress={setRegisteredAddress}
            />
          ) : step.key === "documents" ? (
            <DocumentsStep
              ackNotAgent={ackNotAgent}
              setAckNotAgent={setAckNotAgent}
              ackSelfRegister={ackSelfRegister}
              setAckSelfRegister={setAckSelfRegister}
              modelArticlesLink={modelArticlesLink}
            />
          ) : step.key === "status" ? (
            <RegistrationStatusStep
              status={registrationStatus}
              setStatus={setRegistrationStatus}
              registrationNumber={registrationNumber}
              setRegistrationNumber={setRegistrationNumber}
              registrationDate={registrationDate}
              setRegistrationDate={setRegistrationDate}
              notes={registrationNotes}
              setNotes={setRegistrationNotes}
              checkName={registrationCheckName}
              setCheckName={setRegistrationCheckName}
              checkResult={registrationCheckResult}
              checkLoading={registrationCheckLoading}
              checkError={registrationCheckError}
              onCheck={checkRegistrationStatusName}
            />
          ) : (
            <SummaryStep summary={summary} companiesHouseLink={companiesHouseLink} />
          )}
        </div>

        <div className="sticky bottom-4 z-20">
          <div className="rounded-2xl border border-slate-200 bg-white/85 p-3 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <Button variant="secondary" disabled={stepIndex === 0} onClick={goBack}>
                Back
              </Button>
              <Button disabled={disableNext || finishing} onClick={goNext}>
                {finishing ? <Spinner size={16} /> : null}
                {stepIndex === REG_STEPS.length - 1 ? "Finish" : "Next"}
              </Button>
            </div>

            {stepIndex === REG_STEPS.length - 1 && finished ? (
              <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800">
                Saved. Your registration details are ready — head to{" "}
                <a href={companiesHouseLink} target="_blank" rel="noreferrer" className="underline">
                  Companies House
                </a>{" "}
                to complete the official registration.
              </div>
            ) : null}
            {stepIndex === REG_STEPS.length - 1 && finishError ? (
              <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800">{finishError}</div>
            ) : null}

            {disableNext && step.key === "activity" ? (
              <div className="mt-2 text-xs font-semibold text-slate-500">Select exactly 4 SIC codes to continue.</div>
            ) : null}
            {disableNext && step.key === "documents" ? (
              <div className="mt-2 text-xs font-semibold text-slate-500">Please acknowledge the requirements to continue.</div>
            ) : null}
            {disableNext && step.key === "status" && registrationStatus === "registered" ? (
              <div className="mt-2 text-xs font-semibold text-slate-500">
                Check the company name against Companies House before marking as registered.
              </div>
            ) : null}
          </div>
        </div>

        {(entityTypesLoading || nameCheckLoading || sicLoading) && step.key !== "business_type" ? (
          <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Spinner size={14} /> Working...
          </div>
        ) : null}
      </div>
    </div>
  );
}
