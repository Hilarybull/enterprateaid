import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";

export default function ReferralClickPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    if (!code) {
      navigate("/register", { replace: true });
      return;
    }

    async function capture() {
      try {
        const res = await apiRequest("/referrals/click", "POST", {
          code,
          landing_path: window.location.pathname,
        });
        // Store referral data for the registration flow
        localStorage.setItem(
          "ea_referral",
          JSON.stringify({
            code: res.referral_code,
            click_id: res.click_id,
            expires_at: res.expires_at,
            stored_at: new Date().toISOString(),
          })
        );
        setStatus("ok");
      } catch {
        // Code invalid or expired — still redirect, just without attribution
        setStatus("ok");
      } finally {
        navigate("/register", { replace: true });
      }
    }

    capture();
  }, [code, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
        <p className="text-sm text-slate-500 dark:text-slate-400">Redirecting…</p>
      </div>
    </div>
  );
}
