import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../Button";
import Input from "../Input";
import Spinner from "../Spinner";
import InlineAlert from "../InlineAlert";
import { useAuthStore } from "../../store/auth";
import { useProposalStore } from "../../store/proposals";
import { hasPaidAccess } from "../../lib/plans";
import { apiRequest, getApiBaseUrl } from "../../api/client";
import {
  readProposalContext,
  writeProposalContext,
  patchProposalContext,
  clearProposalContext,
  contextMatches,
} from "../../lib/proposalContext";

function errText(e) {
  const raw = (e instanceof Error ? e.message : String(e || "")).replace(/^HTTP \d+:\s*/i, "");
  if (/bearer token|not authenticated|401|unauthor/i.test(raw)) return "Please sign in to continue.";
  if (/failed to fetch|networkerror|load failed/i.test(raw)) return "Couldn't reach the server. Check your connection and try again.";
  if (/^\s*5\d\d\b|internal server|schema cache|does not exist/i.test(raw)) return "Something went wrong on our side. Please try again in a moment.";
  return raw || "Something went wrong.";
}

function looksUnauthed(e) {
  const m = (e && e.message) || "";
  return /^HTTP 401/i.test(m) || /bearer token|not authenticated|unauthor/i.test(m);
}

function genId() {
  return (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now() + Math.random());
}

function httpStatus(e) {
  const m = (e && e.message) || "";
  const hit = m.match(/^HTTP (\d{3})/i);
  return hit ? Number(hit[1]) : 0;
}

/**
 * ApplyModal — submit a proposal to a business, against a request or unsolicited.
 *
 * Step machine:  choose → (blueprint round-trip | write) → preview → success
 *   signup / upgrade are reached only from the "Use EnterprateAI" option or a
 *   failed submit — never on modal open. "Upload / Write Manually" is ungated;
 *   a free/anonymous user can fill the form and is gated at Submit instead.
 *
 * props:
 *   recipientWorkspaceId  (required)
 *   recipientName
 *   request   optional { id, title, description, requirements: [{id,text,mandatory}] }
 *   onClose()
 *   onSubmitted(proposal)
 */
export default function ApplyModal({ recipientWorkspaceId, recipientName, request, onClose, onSubmitted }) {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const subscription = useAuthStore((s) => s.subscription);
  const platformGrants = useAuthStore((s) => s.platformGrants);
  const submitProposal = useMemo(() => (payload) => apiRequest("/proposals/submit", "POST", payload), []);
  const fetchActivity = useProposalStore((s) => s.fetchActivity);

  const currentPath = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/marketplace";
  const isLoggedIn = Boolean(token);
  // A paid plan OR an admin platform grant covering proposals — mirrors the
  // backend _can_submit_proposals check, which maps feature "proposal_section"
  // to module "blueprint" and matches any grant on that module.
  const hasProposalGrant = (platformGrants || []).some((g) => g.module_key === "blueprint");
  const canSubmit =
    hasPaidAccess(subscription?.plan_key, subscription?.status) || hasProposalGrant;
  const isUnsolicited = !request?.id;
  // Normalise — older requests may lack id / response_type on their items.
  const requirements = useMemo(
    () => (request?.requirements || []).map((r, i) => ({
      ...r,
      id: r.id || `req_${i}`,
      response_type: r.response_type || "text",
    })),
    [request?.requirements],
  );

  // Coming back to this modal after a detour — either the "Use EnterprateAI"
  // round-trip (PDF attached) or a sign-in (form draft saved).
  const resume = useMemo(() => {
    const ctx = readProposalContext();
    if (!contextMatches(ctx, { requestId: request?.id || null, recipientWorkspaceId })) return {};
    return {
      attachment: ctx?.blueprintReturn?.attachment || null,
      draft: ctx?.draft || null,
    };
  }, [request?.id, recipientWorkspaceId]);
  const returned = resume.attachment;
  const savedDraft = resume.draft;

  const [step, setStep] = useState(returned || savedDraft ? "write" : "choose");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const fileRef = useRef(null);

  const [form, setForm] = useState(() => {
    const base = {
      title: request?.title ? `Proposal: ${request.title}` : "",
      summary: "",
      sections: [],
      // one entry per requirement: { text, attachment }
      responses: Object.fromEntries(requirements.map((r) => [r.id, { text: "", attachment: null }])),
      attachments: returned ? [returned] : [],
    };
    if (savedDraft) {
      return {
        ...base,
        title: savedDraft.title ?? base.title,
        summary: savedDraft.summary ?? base.summary,
        sections: Array.isArray(savedDraft.sections) ? savedDraft.sections : base.sections,
        responses: { ...base.responses, ...(savedDraft.responses || {}) },
        // The saved draft's attachments already include the Blueprint PDF.
        attachments: savedDraft.attachments?.length ? savedDraft.attachments : base.attachments,
      };
    }
    return base;
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setResp = (id, patch) =>
    setForm((f) => ({ ...f, responses: { ...f.responses, [id]: { ...(f.responses[id] || { text: "", attachment: null }), ...patch } } }));

  const isFileReq = (r) => r.response_type === "file" || r.response_type === "image";
  const reqAnswered = (r) => {
    const v = form.responses[r.id] || {};
    return isFileReq(r) ? Boolean(v.attachment?.url) : Boolean((v.text || "").trim());
  };

  // One real hidden <input> in the DOM, retargeted per requirement — a
  // detached createElement('input') does not fire change reliably in prod.
  const reqFileRef = useRef(null);
  const pendingReqRef = useRef(null);

  function pickRequirementFile(r) {
    if (!isLoggedIn) { stashDraftAndSignup(); return; }
    pendingReqRef.current = r;
    const el = reqFileRef.current;
    if (!el) return;
    el.accept = r.response_type === "image" ? "image/*" : "";
    el.value = "";
    el.click();
  }

  async function onRequirementFileChange(e) {
    const file = e.target.files && e.target.files[0];
    const r = pendingReqRef.current;
    e.target.value = "";
    if (!file || !r) return;
    setError(null);
    try {
      const meta = await uploadOne(file);
      setResp(r.id, { attachment: meta });
    } catch (err) {
      if (looksUnauthed(err)) { stashDraftAndSignup(); return; }
      setError(errText(err));
    }
  }

  function close() {
    // Don't wipe the context here — an accidental close (X / backdrop / Cancel)
    // must not throw away a generated Blueprint PDF or a half-written draft.
    // It only matches this exact request/recipient, and it's cleared on submit.
    onClose();
  }

  // Keep the context's draft in step with the form so a refresh or an
  // accidental close can restore the write step exactly as it was.
  useEffect(() => {
    if (step !== "write" && step !== "preview") return;
    const t = setTimeout(() => {
      patchProposalContext({
        recipientWorkspaceId,
        recipientName: recipientName || null,
        requestId: request?.id || null,
        requestTitle: request?.title || null,
        requestDescription: request?.description || null,
        requirements,
        origin: currentPath,
        draft: {
          title: form.title,
          summary: form.summary,
          sections: form.sections,
          responses: form.responses,
          attachments: form.attachments,
        },
      });
    }, 400);
    return () => clearTimeout(t);
  }, [step, form]); // eslint-disable-line

  // Save whatever's typed so the form is intact after the user signs in.
  function stashDraftAndSignup() {
    patchProposalContext({
      recipientWorkspaceId,
      recipientName: recipientName || null,
      requestId: request?.id || null,
      requestTitle: request?.title || null,
      requestDescription: request?.description || null,
      requirements,
      origin: currentPath,
      draft: {
        title: form.title,
        summary: form.summary,
        sections: form.sections,
        responses: form.responses,
        attachments: form.attachments,
      },
    });
    setStep("signup");
  }

  // ── "Use EnterprateAI" — hand off to Business Blueprints ──────────────────
  function startBlueprint() {
    if (!isLoggedIn) { stashDraftAndSignup(); return; }
    if (!canSubmit) { setStep("upgrade"); return; }
    writeProposalContext({
      recipientWorkspaceId,
      recipientName: recipientName || null,
      requestId: request?.id || null,
      requestTitle: request?.title || null,
      requestDescription: request?.description || null,
      requirements,
      origin: currentPath,
    });
    navigate("/blueprint?from=marketplace");
  }

  // ── AI cover letter (secondary, in-form tool) ────────────────────────────
  async function generateCoverLetter() {
    if (!isLoggedIn) { stashDraftAndSignup(); return; }
    if (!canSubmit) { setStep("upgrade"); return; }
    setAiBusy(true);
    setError(null);
    try {
      const { cover_letter } = await apiRequest("/proposals/generate-cover-letter", "POST", {
        recipient_workspace_id: recipientWorkspaceId,
        recipient_name: recipientName || null,
        request_title: request?.title || null,
        request_description: request?.description || null,
        generation_id: genId(),
      });
      if (cover_letter) set({ summary: cover_letter });
    } catch (e) {
      setError(errText(e));
    } finally {
      setAiBusy(false);
    }
  }

  // ── Attachment upload ────────────────────────────────────────────────────
  async function uploadOne(file) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${getApiBaseUrl()}/proposals/upload-attachment`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || "Upload failed");
    return res.json();
  }

  async function addAttachments(files) {
    if (!isLoggedIn) { stashDraftAndSignup(); return; }
    setError(null);
    for (const file of files) {
      try {
        const meta = await uploadOne(file);
        setForm((f) => ({ ...f, attachments: [...f.attachments, meta] }));
      } catch (e) {
        if (looksUnauthed(e)) { stashDraftAndSignup(); return; }
        setError(errText(e));
      }
    }
  }

  // ── Sections ─────────────────────────────────────────────────────────────
  const addSection = () => set({ sections: [...form.sections, { _k: genId(), heading: "", content: "" }] });
  const updateSection = (i, patch) => set({ sections: form.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const removeSection = (i) => set({ sections: form.sections.filter((_, j) => j !== i) });

  // ── Submit ───────────────────────────────────────────────────────────────
  const cleanSections = () =>
    form.sections
      .map((s) => ({ heading: (s.heading || "").trim(), content: (s.content || "").trim() }))
      .filter((s) => s.heading || s.content);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        recipient_workspace_id: recipientWorkspaceId,
        request_id: request?.id || null,
        title: form.title.trim() || null,
        summary: form.summary.trim() || null,
        sections: cleanSections(),
        requirement_responses: requirements
          .filter(reqAnswered)
          .map((r) => {
            const v = form.responses[r.id] || {};
            return isFileReq(r)
              ? { requirement_id: r.id, attachment: v.attachment }
              : { requirement_id: r.id, response: (v.text || "").trim() };
          }),
        attachments: form.attachments,
      };
      const proposal = await submitProposal(payload);
      clearProposalContext();
      fetchActivity();
      setStep("success");
      onSubmitted?.(proposal);
    } catch (e) {
      const code = httpStatus(e);
      const msg = errText(e);
      // Gate at submit: unauthenticated → signup, unentitled → upgrade.
      if (code === 401 || looksUnauthed(e)) {
        stashDraftAndSignup();
      } else if (code === 402 || /Starter plan or above/i.test(msg)) {
        setStep("upgrade");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const mandatoryUnanswered = requirements.some((r) => r.mandatory && !reqAnswered(r));
  const hasContent = form.summary.trim() || cleanSections().length > 0 || form.attachments.length > 0
    || requirements.some(reqAnswered);

  function goPreview() {
    if (mandatoryUnanswered) { setError("Provide every required item before continuing."); return; }
    if (!hasContent) { setError("Add a cover letter, a section, or an attachment before previewing."); return; }
    setError(null);
    setStep("preview");
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const headerTitle = step === "success"
    ? "Proposal sent"
    : `Submit a proposal${recipientName ? ` to ${recipientName}` : ""}`;

  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4">
      {/* No backdrop-click-to-close — a stray click shouldn't drop a proposal in progress. Use the ✕. */}
      <div className="flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{headerTitle}</h2>
            {request?.title && step !== "success" ? (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">For “{request.title}”</p>
            ) : null}
          </div>
          <button type="button" onClick={close} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {returned && step === "write" ? (
            <div className="mb-3"><InlineAlert kind="success" message="Your Blueprint proposal is attached. Add a short cover letter and submit." /></div>
          ) : null}
          {savedDraft && step === "write" && !returned ? (
            <div className="mb-3"><InlineAlert kind="success" message="Welcome back — your proposal draft is here. Finish it and submit." /></div>
          ) : null}

          {step === "signup" ? (
            <div className="py-6 text-center">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Sign up for free first</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
                You need a free EnterprateAI workspace to submit a proposal. It takes a minute, and you come straight back here.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button onClick={() => navigate(`/login?signup=1&next=${encodeURIComponent(currentPath)}`)}>Create free account</Button>
                <Button variant="secondary" onClick={() => navigate(`/login?next=${encodeURIComponent(currentPath)}`)}>Sign in</Button>
              </div>
            </div>
          ) : null}

          {step === "upgrade" ? (
            <div className="py-6 text-center">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Upgrade to submit proposals</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
                Submitting proposals is included from the Starter plan. Receiving proposals is always free.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button onClick={() => navigate("/pricing")}>See plans</Button>
                <Button variant="secondary" onClick={close}>Not now</Button>
              </div>
            </div>
          ) : null}

          {step === "choose" ? (
            <div className="py-2">
              <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">How would you like to start your proposal?</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={startBlueprint}
                  className="rounded-2xl border-2 border-brand-500 bg-brand-50/50 p-4 text-left transition hover:bg-brand-50 dark:border-brand-500 dark:bg-brand-900/20 dark:hover:bg-brand-900/30"
                >
                  <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2Z" /></svg>
                  </div>
                  <div className="text-[13px] font-semibold text-brand-800 dark:text-brand-200">Use EnterprateAI</div>
                  <div className="mt-0.5 text-[12px] text-slate-600 dark:text-slate-400">Generate a full proposal in Business Blueprints, then submit it here.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setStep("write")}
                  className="rounded-2xl border border-slate-200 p-4 text-left transition hover:border-brand-300 hover:bg-brand-50/40 dark:border-slate-700 dark:hover:bg-brand-900/10"
                >
                  <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  </div>
                  <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Upload / Write Manually</div>
                  <div className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">Attach a PDF or Word doc and write your own cover letter.</div>
                </button>
              </div>
            </div>
          ) : null}

          {step === "write" ? (
            <div className="space-y-4 text-sm">
              <div>
                <div className="ea-label">
                  Proposal title <span className="font-normal text-slate-400">{isUnsolicited ? "(recommended)" : "(optional)"}</span>
                </div>
                <Input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="A short name for this proposal" />
                {isUnsolicited ? (
                  <div className="mt-1 text-[11px] text-slate-400">There's no request title for context, so this is how the recipient will identify your proposal.</div>
                ) : null}
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <div className="ea-label">Cover letter <span className="font-normal text-slate-400">(optional)</span></div>
                  <button type="button" className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400" onClick={generateCoverLetter} disabled={aiBusy}>
                    {aiBusy ? "Writing…" : "Draft with AI"}
                  </button>
                </div>
                <textarea rows={5} className="ea-input" value={form.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="A 3–4 sentence introduction: who you are and why you're a fit." />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <div className="ea-label">Proposal sections <span className="font-normal text-slate-400">(optional)</span></div>
                  <button type="button" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={addSection}>+ Add section</button>
                </div>
                {form.sections.length ? (
                  <div className="space-y-3">
                    {form.sections.map((s, i) => (
                      <div key={s._k || i} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        <div className="flex items-center gap-2">
                          <input
                            className="ea-input flex-1"
                            value={s.heading}
                            onChange={(e) => updateSection(i, { heading: e.target.value })}
                            placeholder="Section heading (e.g. Approach, Timeline, Pricing)"
                          />
                          <button type="button" className="shrink-0 text-slate-400 hover:text-rose-500" onClick={() => removeSection(i)}>
                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
                          </button>
                        </div>
                        <textarea
                          rows={3}
                          className="ea-input mt-2"
                          value={s.content}
                          onChange={(e) => updateSection(i, { content: e.target.value })}
                          placeholder="Section content"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-slate-400">Break your proposal into headed sections — approach, timeline, pricing, team, and so on.</p>
                )}
              </div>

              {requirements.length ? (
                <div className="space-y-3">
                  <div className="ea-label">Requirement responses</div>
                  <input ref={reqFileRef} type="file" className="hidden" onChange={onRequirementFileChange} />
                  {requirements.map((r) => {
                    const v = form.responses[r.id] || { text: "", attachment: null };
                    const rt = r.response_type || "text";
                    return (
                      <div key={r.id}>
                        <div className="mb-1 text-xs text-slate-600 dark:text-slate-300">
                          {r.text} {r.mandatory ? <span className="font-semibold text-rose-500">*</span> : null}
                          <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-400">
                            {rt === "file" ? "file" : rt === "image" ? "image" : rt === "link" ? "link" : rt === "number" ? "number" : rt === "paragraph" ? "" : ""}
                          </span>
                        </div>
                        {isFileReq(r) ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button size="sm" variant="secondary" onClick={() => pickRequirementFile(r)}>
                              {v.attachment ? "Replace" : rt === "image" ? "Upload image" : "Upload file"}
                            </Button>
                            {v.attachment ? (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
                                {v.attachment.filename}
                                <button type="button" className="text-slate-400 hover:text-rose-500" onClick={() => setResp(r.id, { attachment: null })}>×</button>
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400">{r.mandatory ? "Required" : "Optional"}</span>
                            )}
                          </div>
                        ) : rt === "paragraph" ? (
                          <textarea rows={3} className="ea-input" value={v.text} onChange={(e) => setResp(r.id, { text: e.target.value })} placeholder={r.mandatory ? "Required" : "Optional"} />
                        ) : (
                          <Input
                            type={rt === "link" ? "url" : rt === "number" ? "number" : "text"}
                            value={v.text}
                            onChange={(e) => setResp(r.id, { text: e.target.value })}
                            placeholder={rt === "link" ? "https://…" : r.mandatory ? "Required" : "Optional"}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div>
                <div className="ea-label">Attachments <span className="font-normal text-slate-400">(optional)</span></div>
                <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addAttachments([...e.target.files]); e.target.value = ""; }} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>Add files</Button>
                  {form.attachments.map((a, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
                      {a.filename}
                      <button type="button" className="text-slate-400 hover:text-rose-500" onClick={() => set({ attachments: form.attachments.filter((_, j) => j !== i) })}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {step === "preview" ? (
            <div className="space-y-4 text-sm">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{form.title || "Proposal"}</div>
                <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                  {form.summary.trim() || <span className="text-slate-400">No cover letter</span>}
                </p>
              </div>
              {cleanSections().map((s, i) => (
                <div key={i}>
                  <div className="text-xs font-semibold text-slate-500">{s.heading || `Section ${i + 1}`}</div>
                  <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{s.content}</p>
                </div>
              ))}
              {requirements.filter(reqAnswered).map((r) => {
                const v = form.responses[r.id] || {};
                return (
                  <div key={r.id}>
                    <div className="text-xs font-semibold text-slate-500">{r.text}</div>
                    {isFileReq(r) ? (
                      <p className="text-slate-700 dark:text-slate-300">📎 {v.attachment?.filename}</p>
                    ) : (
                      <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{v.text}</p>
                    )}
                  </div>
                );
              })}
              {form.attachments.length ? (
                <div className="text-xs text-slate-500">{form.attachments.length} attachment{form.attachments.length === 1 ? "" : "s"}</div>
              ) : null}
            </div>
          ) : null}

          {step === "success" ? (
            <div className="py-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
              </div>
              <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">Your proposal is on its way</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
                Track its status under <span className="font-medium text-slate-600 dark:text-slate-300">Financials → Proposals → Activity</span>.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button onClick={() => navigate("/financials?tab=proposals")}>Go to Proposals</Button>
                <Button variant="secondary" onClick={close}>Close</Button>
              </div>
            </div>
          ) : null}
        </div>

        {error && (step === "choose" || step === "write" || step === "preview") ? (
          <div className="border-t border-slate-200 px-5 pt-3 dark:border-slate-700">
            <InlineAlert kind="error" message={error} />
          </div>
        ) : null}

        {step === "choose" || step === "write" || step === "preview" ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4 dark:border-slate-700">
            {step === "choose" ? (
              <Button variant="secondary" onClick={close}>Cancel</Button>
            ) : step === "preview" ? (
              <Button variant="secondary" onClick={() => setStep("write")}>Back</Button>
            ) : (
              <Button variant="secondary" onClick={() => setStep("choose")}>Back</Button>
            )}
            {step === "write" ? (
              <Button onClick={goPreview}>Preview</Button>
            ) : step === "preview" ? (
              <Button onClick={submit} disabled={busy}>{busy ? <Spinner size={14} /> : "Submit proposal"}</Button>
            ) : <span />}
          </div>
        ) : null}
      </div>
    </div>
  );
}
