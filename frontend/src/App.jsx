import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector(".ea-scroll")?.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
import { useAuthStore } from "./store/auth";
import { useWorkspaceStore } from "./store/workspace";
import Layout from "./components/Layout";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ValidationWizardPage from "./pages/ValidationWizardPage";
import ResultsPage from "./pages/ResultsPage";
import SimulationPage from "./pages/SimulationPage";
import BlueprintPage from "./pages/BlueprintPage";
import RegistrationPage from "./pages/RegistrationPage";
import CataloguePage from "./pages/CataloguePage";
import FinancialsPage from "./pages/FinancialsPage";
import NotFoundPage from "./pages/NotFoundPage";
import SharedBlueprintPage from "./pages/SharedBlueprintPage";
import TeamPage from "./pages/TeamPage";
import JoinPage from "./pages/JoinPage";
import AdminPage from "./pages/AdminPage";
import PricingPage from "./pages/PricingPage";
import PricingSuccessPage from "./pages/PricingSuccessPage";
import MarketplacePage from "./pages/MarketplacePage";
import AccountPage from "./pages/AccountPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import IntegrationsCallbackPage from "./pages/IntegrationsCallbackPage";
import PrivacyPolicyPage from "./pages/PrivacyPolicyPage";
import TermsOfServicePage from "./pages/TermsOfServicePage";
import DisclaimerPage from "./pages/DisclaimerPage";
import ReferralClickPage from "./pages/ReferralClickPage";
import ReferralPage from "./pages/ReferralPage";

function Protected({ children }) {
  const token = useAuthStore((s) => s.token);
  const hydrated = useAuthStore((s) => s.hydrated);
  if (!hydrated) return null;
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicRoot() {
  return <LandingPage />;
}

export default function App() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const authHydrated = useAuthStore((s) => s.hydrated);
  const email = useAuthStore((s) => s.email);
  const resetForUser = useWorkspaceStore((s) => s.resetForUser);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  useEffect(() => {
    if (!authHydrated) return;
    resetForUser(email);
  }, [authHydrated, email, resetForUser]);

  return (
    <>
      <ScrollToTop />
      <Routes>
      <Route path="/" element={<PublicRoot />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/pricing/success" element={<PricingSuccessPage />} />
      <Route path="/integrations/callback" element={<IntegrationsCallbackPage />} />
      <Route path="/legal/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/legal/terms" element={<TermsOfServicePage />} />
      <Route path="/legal/disclaimer" element={<DisclaimerPage />} />
      <Route path="/share/:token" element={<SharedBlueprintPage />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route path="/r/:code" element={<ReferralClickPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="validation" element={<ValidationWizardPage />} />
        <Route path="results" element={<ResultsPage />} />
        <Route path="simulation" element={<SimulationPage />} />
        <Route path="blueprint" element={<BlueprintPage />} />
        <Route path="registration" element={<RegistrationPage />} />
        <Route path="catalogue" element={<CataloguePage />} />
        <Route path="financials" element={<FinancialsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="referrals" element={<ReferralPage />} />
      </Route>
      <Route
        path="ent-admin"
        element={
          <Protected>
            <AdminPage />
          </Protected>
        }
      />
      <Route path="/marketplace" element={<MarketplacePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </>
  );
}
