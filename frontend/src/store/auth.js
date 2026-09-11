import { create } from "zustand";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "./workspace";

function humanizeAuthError(e) {
  const msg = e instanceof Error ? e.message : String(e || "");
  if (e?.code === "NETWORK_ERROR" || msg === "NETWORK_ERROR") {
    // This was previously "Can't reach the server at <url>. Start the backend
    // and check your API URL." — copy written for a developer running the app
    // locally, which a real customer saw verbatim during signup on the live
    // site. Dev-only detail (the API base URL) now only appears in dev builds.
    if (import.meta.env.DEV) {
      const base = import.meta.env.VITE_API_URL ?? import.meta.env.REACT_APP_BACKEND_URL ?? "http://localhost:8000";
      return `Can't reach the server at ${base}. Start the backend and check your API URL.`;
    }
    return "We couldn't reach the server. Please check your connection and try again in a moment.";
  }
  if (msg === "AUTH_RESPONSE_INVALID") return "Authentication failed. Please try again.";
  if (msg.startsWith("HTTP 401:")) return "Invalid credentials. Try again or create an account.";
  if (msg.startsWith("HTTP 403:")) {
    const lower = msg.toLowerCase();
    if (lower.includes("suspended") || lower.includes("blocked")) {
      return msg.replace(/^HTTP 403:\s*/, "");
    }
    if (lower.includes("email not verified") || lower.includes("verification")) {
      return msg.replace(/^HTTP 403:\s*/, "");
    }
    return "Access denied.";
  }
  if (msg.startsWith("HTTP 409:")) return "Account already exists. Sign in instead.";
  if (msg.startsWith("HTTP 422:")) return "Please enter a valid email and a password (8+ characters).";
  if (msg.startsWith("HTTP 500:")) return "Server configuration error. Try again later.";
  return msg;
}

async function fetchPlatformRestrictions() {
  try {
    return await apiRequest("/auth/restrictions", "GET");
  } catch {
    return [];
  }
}

async function fetchPlatformGrants() {
  try {
    return await apiRequest("/auth/grants", "GET");
  } catch {
    return [];
  }
}

async function fetchSubscription() {
  try {
    return await apiRequest("/plans/my", "GET");
  } catch {
    return { plan_key: "explorer", billing_period: "monthly", status: "active" };
  }
}

const DEFAULT_SUB = { plan_key: "explorer", billing_period: "monthly", status: "active" };

function clearDemoTourState() {
  sessionStorage.removeItem("ea_tour_active");
  sessionStorage.removeItem("ea_tour_step");
  sessionStorage.removeItem("ea_tour_done");
}

export const useAuthStore = create((set, get) => ({
  token: null,
  email: null,
  name: null,
  picture: null,
  authProvider: null,
  hasPassword: false,
  hydrated: false,
  isLoading: false,
  error: null,
  platformRestrictions: [],
  platformGrants: [],
  subscription: DEFAULT_SUB,
  creditBalance: null,
  creditInfo: null,
  verificationPending: false,
  verificationEmail: null,
  clearVerificationPending: () => set({ verificationPending: false, verificationEmail: null }),
  setCreditBalance: (v) => set({ creditBalance: typeof v === "number" ? v : null }),
  setCreditInfo: (info) => set({ creditInfo: info || null, creditBalance: typeof info?.available_credits === "number" ? info.available_credits : null }),

  hydrate: async () => {
    const token = localStorage.getItem("ea_token");
    const email = localStorage.getItem("ea_email");

    if (!token) {
      clearDemoTourState();
      set({ token: null, email: null, hydrated: true });
      return;
    }

    // Verify the token is still valid before marking as hydrated.
    // If it's expired the API returns 401 and we clear it now rather than
    // letting protected pages discover it one call at a time.
    try {
      const [me, restrictions, grants, sub] = await Promise.all([
        apiRequest("/auth/me", "GET"),
        apiRequest("/auth/restrictions", "GET"),
        fetchPlatformGrants(),
        apiRequest("/plans/my", "GET"),
      ]);
      set({
        token,
        email: me?.email ?? email,
        name: me?.name ?? null,
        picture: me?.picture ?? null,
        authProvider: me?.auth_provider ?? null,
        hasPassword: me?.has_password ?? false,
        platformRestrictions: restrictions ?? [],
        platformGrants: grants ?? [],
        subscription: sub ?? DEFAULT_SUB,
        hydrated: true,
      });
      if ((me?.email ?? email) !== "demo") clearDemoTourState();
    } catch {
      localStorage.removeItem("ea_token");
      localStorage.removeItem("ea_email");
      clearDemoTourState();
      set({ token: null, email: null, name: null, picture: null, authProvider: null, hasPassword: false, hydrated: true });
    }
  },

  refreshSubscription: async () => {
    const sub = await fetchSubscription();
    set({ subscription: sub ?? DEFAULT_SUB });
    return sub;
  },

  refreshGrants: async () => {
    const grants = await fetchPlatformGrants();
    set({ platformGrants: grants ?? [] });
    return grants;
  },

  setPlatformRestrictions: (restrictions) => set({ platformRestrictions: restrictions }),

  register: async (email, password, extra = {}) => {
    set({ isLoading: true, error: null });
    try {
      // Attach referral click data if stored from a /r/:code visit
      let refData = {};
      try {
        const raw = localStorage.getItem("ea_referral");
        if (raw) {
          const parsed = JSON.parse(raw);
          const expiresAt = parsed.expires_at ? new Date(parsed.expires_at) : null;
          if (expiresAt && expiresAt > new Date()) {
            refData = { ref_click_id: parsed.click_id, ref_code: parsed.code };
          }
          localStorage.removeItem("ea_referral");
        }
      } catch (_) {}
      const result = await apiRequest("/auth/register", "POST", { email, password, ...extra, ...refData });
      if (result?.email_verification_sent) {
        set({ verificationPending: true, verificationEmail: email });
        return;
      }
      await get().login(email, password);
    } catch (e) {
      set({ error: humanizeAuthError(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const tokenRes = await apiRequest("/auth/login", "POST", { email, password });
      const token = tokenRes?.access_token ?? tokenRes?.token ?? null;
      if (!token) throw new Error("AUTH_RESPONSE_INVALID");
      localStorage.setItem("ea_token", token);
      localStorage.setItem("ea_email", email);
      clearDemoTourState();
      useWorkspaceStore.getState().resetForUser(email);
      set({ token, email, hydrated: true });
      Promise.all([
        apiRequest("/auth/me", "GET").catch(() => null),
        fetchPlatformRestrictions(),
        fetchPlatformGrants(),
        fetchSubscription(),
      ]).then(([me, restrictions, grants, sub]) => set({
        name: me?.name ?? null,
        picture: me?.picture ?? null,
        authProvider: me?.auth_provider ?? null,
        hasPassword: me?.has_password ?? false,
        platformRestrictions: restrictions,
        platformGrants: grants ?? [],
        subscription: sub ?? DEFAULT_SUB,
      })).catch(() => {});
    } catch (e) {
      set({ error: humanizeAuthError(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  googleLogin: async (credential) => {
    set({ isLoading: true, error: null });
    try {
      let refData = {};
      try {
        const raw = localStorage.getItem("ea_referral");
        if (raw) {
          const parsed = JSON.parse(raw);
          const expiresAt = parsed.expires_at ? new Date(parsed.expires_at) : null;
          if (expiresAt && expiresAt > new Date()) {
            refData = { ref_click_id: parsed.click_id, ref_code: parsed.code };
          }
          localStorage.removeItem("ea_referral");
        }
      } catch (_) {}
      const tokenRes = await apiRequest("/auth/google", "POST", { credential, ...refData });
      const token = tokenRes?.access_token ?? tokenRes?.token ?? null;
      if (!token) throw new Error("AUTH_RESPONSE_INVALID");
      localStorage.setItem("ea_token", token);
      set({ token, hydrated: true });
      Promise.all([
        apiRequest("/auth/me", "GET").catch(() => null),
        fetchPlatformRestrictions(),
        fetchPlatformGrants(),
        fetchSubscription(),
      ]).then(([me, restrictions, grants, sub]) => {
        if (me?.email) localStorage.setItem("ea_email", me.email);
        if (me?.email && me.email !== "demo") clearDemoTourState();
        if (me?.email) useWorkspaceStore.getState().resetForUser(me.email);
        set({
          email: me?.email ?? null,
          name: me?.name ?? null,
          picture: me?.picture ?? null,
          authProvider: me?.auth_provider ?? null,
          hasPassword: me?.has_password ?? false,
          platformRestrictions: restrictions,
          platformGrants: grants ?? [],
          subscription: sub ?? DEFAULT_SUB,
        });
      }).catch(() => {});
    } catch (e) {
      set({ error: humanizeAuthError(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  setProfile: ({ name, picture, authProvider, hasPassword }) => set({ name, picture, authProvider, hasPassword: hasPassword ?? false }),

  logout: () => {
    localStorage.removeItem("ea_token");
    localStorage.removeItem("ea_email");
    clearDemoTourState();
    useWorkspaceStore.getState().resetForUser(null);
    set({ token: null, email: null, name: null, picture: null, authProvider: null, hasPassword: false, hydrated: true, platformRestrictions: [], platformGrants: [], subscription: DEFAULT_SUB, creditBalance: null, creditInfo: null });
  }
}));
