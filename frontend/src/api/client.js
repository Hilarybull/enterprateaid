const API_URL =
  import.meta.env.VITE_API_URL ??
  import.meta.env.REACT_APP_BACKEND_URL ??
  "http://localhost:8000";

export function getApiBaseUrl() {
  return API_URL;
}

export async function apiRequest(path, method, body, options) {
  const token = localStorage.getItem("ea_token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  const controller = new AbortController();
  const timeoutMs = typeof options?.timeoutMs === "number" ? options.timeoutMs : 30000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e && typeof e === "object" && e.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    // Network error (backend down, wrong port, CORS, etc.)
    throw new Error("NETWORK_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    // Clear invalid token on 401
    if (res.status === 401) {
      localStorage.removeItem("ea_token");
      localStorage.removeItem("ea_email");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("ea:unauthorized", { detail: { path, method } }));
      }
    }
    
    let message = `Request failed`;
    let errorDetail = null;
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") {
        message = data.detail;
      } else if (Array.isArray(data?.detail) && data.detail[0]?.msg) {
        message = data.detail[0].msg;
      } else if (data?.detail && typeof data.detail === "object") {
        errorDetail = data.detail;
        message = data.detail.message || data.detail.error || JSON.stringify(data.detail);
      } else if (typeof data?.message === "string") {
        message = data.message;
      } else {
        message = JSON.stringify(data);
      }
    } catch {
      const text = await res.text().catch(() => "");
      if (text) message = text;
    }
    const err = new Error(`HTTP ${res.status}: ${message}`);
    if (errorDetail) err.detail = errorDetail;
    throw err;
  }

  // Some endpoints might return empty body
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
