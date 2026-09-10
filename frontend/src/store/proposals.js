import { create } from "zustand";
import { apiRequest } from "../api/client";

// Proposal state is always fetched fresh on mount — never persisted to
// localStorage (unlike the workspace store).

const ACTIVE_STATUSES = [
  "SUBMITTED", "VIEWED", "UNDER_REVIEW", "CLARIFICATION_REQUESTED",
  "REVISION_REQUESTED", "SHORTLISTED", "PREFERRED", "NEGOTIATION",
];
const TERMINAL_STATUSES = [
  "AWARDED", "CONTRACT_DRAFTED", "CONTRACTED", "DECLINED", "WITHDRAWN", "EXPIRED", "ARCHIVED",
];

export const PROPOSAL_ACTIVE_STATUSES = ACTIVE_STATUSES;
export const PROPOSAL_TERMINAL_STATUSES = TERMINAL_STATUSES;

function errText(e) {
  const raw = (e instanceof Error ? e.message : String(e || "")).replace(/^HTTP \d+:\s*/i, "");
  if (/network_error|failed to fetch|networkerror|load failed/i.test(raw)) return "Couldn't reach the server. Check your connection and try again.";
  if (/bearer token|not authenticated|401|unauthor/i.test(raw)) return "Your session has expired — please sign in again.";
  if (/greater than or equal to 1|less than or equal to|should be a valid/i.test(raw)) return "Some values are out of range — please check the form.";
  if (/^\s*5\d\d\b|internal server|schema cache|does not exist|timed out/i.test(raw)) return "Something went wrong on our side. Please try again in a moment.";
  return raw || "Something went wrong.";
}

export const useProposalStore = create((set, get) => ({
  // Preferences
  preferences: null,
  preferencesLoading: false,
  preferencesError: null,

  // Requests (recipient)
  requests: [],
  requestsLoading: false,
  requestsError: null,

  // Inbox (recipient)
  inbox: [],
  inboxUnread: 0,
  inboxLoading: false,
  inboxError: null,

  // Activity (proposer)
  activity: [],
  activityLoading: false,
  activityError: null,

  // ── Preferences ─────────────────────────────────────────────
  async fetchPreferences() {
    set({ preferencesLoading: true, preferencesError: null });
    try {
      const data = await apiRequest("/proposals/preferences", "GET");
      set({ preferences: data, preferencesLoading: false });
    } catch (e) {
      set({ preferencesError: errText(e), preferencesLoading: false });
    }
  },
  async savePreferences(prefs) {
    set({ preferencesError: null });
    const data = await apiRequest("/proposals/preferences", "PUT", prefs);
    set({ preferences: data });
    return data;
  },

  // ── Requests ────────────────────────────────────────────────
  async fetchRequests() {
    set({ requestsLoading: true, requestsError: null });
    try {
      const data = await apiRequest("/proposals/requests", "GET");
      set({ requests: data.items || [], requestsLoading: false });
    } catch (e) {
      set({ requestsError: errText(e), requestsLoading: false });
    }
  },
  async createRequest(payload) {
    const row = await apiRequest("/proposals/requests", "POST", payload);
    set({ requests: [row, ...get().requests] });
    return row;
  },
  async updateRequest(id, payload) {
    const row = await apiRequest(`/proposals/requests/${id}`, "PATCH", payload);
    set({ requests: get().requests.map((r) => (r.id === id ? row : r)) });
    return row;
  },
  async requestAction(id, action) {
    const row = await apiRequest(`/proposals/requests/${id}/${action}`, "POST");
    set({ requests: get().requests.map((r) => (r.id === id ? row : r)) });
    return row;
  },
  async deleteRequest(id) {
    const prev = get().requests;
    set({ requests: prev.filter((r) => r.id !== id) }); // optimistic
    try {
      await apiRequest(`/proposals/requests/${id}`, "DELETE");
    } catch (e) {
      set({ requests: prev });
      throw e;
    }
  },
  async inviteToRequest(id, emails) {
    return apiRequest(`/proposals/requests/${id}/invite`, "POST", { emails });
  },

  // ── Inbox ───────────────────────────────────────────────────
  async fetchInbox() {
    set({ inboxLoading: true, inboxError: null });
    try {
      const data = await apiRequest("/proposals/inbox", "GET");
      set({ inbox: data.items || [], inboxUnread: data.unread || 0, inboxLoading: false });
    } catch (e) {
      set({ inboxError: errText(e), inboxLoading: false });
    }
  },
  async removeFromInbox(id) {
    const prev = get().inbox;
    set({ inbox: prev.filter((p) => p.id !== id) }); // optimistic
    try {
      await apiRequest(`/proposals/inbox/${id}`, "DELETE");
    } catch (e) {
      set({ inbox: prev });
      throw e;
    }
  },
  async linkToRequest(proposalId, requestId) {
    const row = await apiRequest(`/proposals/inbox/${proposalId}/link`, "PATCH", { request_id: requestId });
    set({ inbox: get().inbox.map((p) => (p.id === proposalId ? { ...p, ...row } : p)) });
    return row;
  },

  // ── Activity ────────────────────────────────────────────────
  async fetchActivity() {
    set({ activityLoading: true, activityError: null });
    try {
      const data = await apiRequest("/proposals/activity", "GET");
      set({ activity: data.items || [], activityLoading: false });
    } catch (e) {
      set({ activityError: errText(e), activityLoading: false });
    }
  },

  // ── Shared: status transitions ─────────────────────────────
  async transitionStatus(proposalId, statusValue, reason, attachments) {
    const row = await apiRequest(`/proposals/${proposalId}/status`, "POST", {
      status: statusValue,
      reason: reason || null,
      attachments: attachments?.length ? attachments : null,
    });
    set({
      inbox: get().inbox.map((p) => (p.id === proposalId ? { ...p, ...row } : p)),
      activity: get().activity.map((p) => (p.id === proposalId ? { ...p, ...row } : p)),
    });
    return row;
  },
  async withdraw(proposalId, reason) {
    return get().transitionStatus(proposalId, "WITHDRAWN", reason);
  },
  async reviseProposal(proposalId, payload) {
    const row = await apiRequest(`/proposals/${proposalId}/revise`, "POST", payload);
    set({ activity: get().activity.map((p) => (p.id === proposalId ? { ...p, ...row } : p)) });
    return row;
  },
  async getProposal(proposalId) {
    return apiRequest(`/proposals/${proposalId}`, "GET");
  },
}));
