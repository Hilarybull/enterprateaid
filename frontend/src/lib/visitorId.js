// A random id generated once per browser and persisted in localStorage, used
// to dedupe anonymous (not signed-in) views on public marketplace pages — e.g.
// so a proposal request's view count reflects unique visitors, not page loads.
// Clearing site data or visiting from another browser/device starts a new id;
// that's the honest limit of tracking anonymous visitors without requiring
// login.
const STORAGE_KEY = "ea_visitor_id";

export function getVisitorId() {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `v_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    // Private browsing / storage blocked — fall back to a per-session id so
    // the request still carries a header, it just won't persist across visits.
    return `v_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}
