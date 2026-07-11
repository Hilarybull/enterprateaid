import { create } from "zustand";
import { apiRequest } from "../api/client";

function humanizeAuthError(e) {
  const msg = e instanceof Error ? e.message : String(e || "");
  if (msg === "NETWORK_ERROR") {
    const base = import.meta.env.VITE_API_URL ?? import.meta.env.REACT_APP_BACKEND_URL ?? "http://localhost:8000";
    return `Can't reach the server at ${base}. Start the backend and check your API URL.`;
  }
  if (msg === "AUTH_RESPONSE_INVALID") return "Authentication failed. Please try again.";
  if (msg.startsWith("HTTP 401:")) return "Invalid credentials. Try again or create an account.";
  if (msg.startsWith("HTTP 403:")) {
    const lower = msg.toLowerCase();
    if (lower.includes("suspended") || lower.includes("blocked")) {
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

async function fetchCreditBalance() {
  try {
    const data = await apiRequest("/credits/balance", "GET");
    return typeof data?.available_credits === "number" ? data.available_credits : null;
  } catch {
    return null;
  }
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

  hydrate: async () => {
    const token = localStorage.getItem("ea_token");
    const email = localStorage.getItem("ea_email");

    if (!token) {
      set({ token: null, email: null, hydrated: true });
      return;
    }

    // Verify the token is still valid before marking as hydrated.
    // If it's expired the API returns 401 and we clear it now rather than
    // letting protected pages discover it one call at a time.
    try {
      const [me, restrictions, grants, sub, creditBal] = await Promise.all([
        apiRequest("/auth/me", "GET"),
        apiRequest("/auth/restrictions", "GET"),
        fetchPlatformGrants(),
        apiRequest("/plans/my", "GET"),
        fetchCreditBalance(),
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
        creditBalance: creditBal,
        hydrated: true,
      });
    } catch {
      localStorage.removeItem("ea_token");
      localStorage.removeItem("ea_email");
      set({ token: null, email: null, name: null, picture: null, authProvider: null, hasPassword: false, hydrated: true });
    }
  },

  refreshSubscription: async () => {
    const sub = await fetchSubscription();
    set({ subscription: sub ?? DEFAULT_SUB });
    return sub;
  },

  refreshCreditBalance: async () => {
    const balance = await fetchCreditBalance();
    set({ creditBalance: balance });
    return balance;
  },

  setPlatformRestrictions: (restrictions) => set({ platformRestrictions: restrictions }),

  register: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      let referralCode = null, referralClickId = null;
      try {
        const stored = JSON.parse(localStorage.getItem("ea_referral") || "null");
        if (stored?.code && stored?.expires_at && new Date(stored.expires_at) > new Date()) {
          referralCode = stored.code;
          referralClickId = stored.click_id || null;
        }
      } catch { /* ignore malformed storage */ }
      await apiRequest("/auth/register", "POST", { email, password, referral_code: referralCode, referral_click_id: referralClickId });
      if (referralCode) localStorage.removeItem("ea_referral");
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
      set({ token, email });
      const [me, restrictions, grants, sub, creditBal] = await Promise.all([
        apiRequest("/auth/me", "GET").catch(() => null),
        fetchPlatformRestrictions(),
        fetchPlatformGrants(),
        fetchSubscription(),
        fetchCreditBalance(),
      ]);
      set({
        name: me?.name ?? null,
        picture: me?.picture ?? null,
        authProvider: me?.auth_provider ?? null,
        hasPassword: me?.has_password ?? false,
        platformRestrictions: restrictions,
        platformGrants: grants ?? [],
        subscription: sub ?? DEFAULT_SUB,
        creditBalance: creditBal,
      });
    } catch (e) {
      set({ error: humanizeAuthError(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  googleLogin: async (credential) => {
    set({ isLoading: true, error: null });
    try {
      let referralCode = null, referralClickId = null;
      try {
        const stored = JSON.parse(localStorage.getItem("ea_referral") || "null");
        if (stored?.code && stored?.expires_at && new Date(stored.expires_at) > new Date()) {
          referralCode = stored.code;
          referralClickId = stored.click_id || null;
        }
      } catch { /* ignore malformed storage */ }
      const tokenRes = await apiRequest("/auth/google", "POST", { credential, referral_code: referralCode, referral_click_id: referralClickId });
      if (referralCode) localStorage.removeItem("ea_referral");
      const token = tokenRes?.access_token ?? tokenRes?.token ?? null;
      if (!token) throw new Error("AUTH_RESPONSE_INVALID");
      localStorage.setItem("ea_token", token);
      const me = await apiRequest("/auth/me", "GET");
      localStorage.setItem("ea_email", me.email);
      set({ token, email: me.email, name: me?.name ?? null, picture: me?.picture ?? null, authProvider: me?.auth_provider ?? null, hasPassword: me?.has_password ?? false });
      const [restrictions, grants, sub, creditBal] = await Promise.all([
        fetchPlatformRestrictions(),
        fetchPlatformGrants(),
        fetchSubscription(),
        fetchCreditBalance(),
      ]);
      set({ platformRestrictions: restrictions, platformGrants: grants ?? [], subscription: sub ?? DEFAULT_SUB, creditBalance: creditBal });
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
    set({ token: null, email: null, name: null, picture: null, authProvider: null, hasPassword: false, hydrated: true, platformRestrictions: [], platformGrants: [], subscription: DEFAULT_SUB, creditBalance: null });
  }
}));
