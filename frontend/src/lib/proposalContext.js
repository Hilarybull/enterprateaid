// Round-trip state for the "Use EnterprateAI" proposal path:
// ApplyModal → /blueprint?from=marketplace → generate → back to ApplyModal
// with the Blueprint PDF attached. Single sessionStorage key; cleared on
// submit or cancel. Silent drop on abandon (no recovery).

const KEY = "ea_proposal_context";

export function readProposalContext() {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeProposalContext(ctx) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ctx || {}));
  } catch {
    /* private mode / quota — the flow degrades to the manual path */
  }
}

export function patchProposalContext(patch) {
  writeProposalContext({ ...(readProposalContext() || {}), ...(patch || {}) });
}

export function clearProposalContext() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * True when `ctx` was saved for the proposal this modal is showing —
 * request-linked matches by requestId, unsolicited matches by recipient.
 */
export function contextMatches(ctx, { requestId, recipientWorkspaceId }) {
  if (!ctx) return false;
  if (requestId) return ctx.requestId === requestId;
  return !ctx.requestId && ctx.recipientWorkspaceId === recipientWorkspaceId;
}
