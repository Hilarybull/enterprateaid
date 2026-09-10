import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { DemoTourProvider } from "./context/DemoTourContext";
import DemoTour from "./components/DemoTour";

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
import NewLandingPage from "./pages/NewLandingPage";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ValidationWizardPage from "./pages/ValidationWizardPage";
import ResultsPage from "./pages/ResultsPage";
import SimulationPage from "./pages/SimulationPage";
import BlueprintPage from "./pages/BlueprintPage";
import BusinessPlanPage from "./pages/LivePlanPage";
import RegistrationPage from "./pages/RegistrationPage";
import CataloguePage from "./pages/CataloguePage";
import FinancialsPage from "./pages/FinancialsPage";
import ProposalRequestDetailPage from "./pages/ProposalRequestDetailPage";
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
import IntegrationsPage from "./pages/IntegrationsPage";
import IntegrationsCallbackPage from "./pages/IntegrationsCallbackPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import PrivacyPolicyPage from "./pages/PrivacyPolicyPage";
import TermsOfServicePage from "./pages/TermsOfServicePage";
import DisclaimerPage from "./pages/DisclaimerPage";
import CreditsPage from "./pages/CreditsPage";
import RequireWorkspace from "./components/RequireWorkspace";
import ReferralPage from "./pages/ReferralPage";
import ReferralClickPage from "./pages/ReferralClickPage";
import BlogPage from "./pages/BlogPage";
import BlogArticlePage from "./pages/BlogArticlePage";
import ResearchPage from "./pages/ResearchPage";
import BookDemoPage from "./pages/BookDemoPage";
import CookieBanner from "./components/CookieBanner";

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
    <DemoTourProvider>
      <ScrollToTop />
      <Routes>
      <Route path="/" element={<PublicRoot />} />
      <Route path="/home" element={<NewLandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/pricing/success" element={<PricingSuccessPage />} />
      <Route path="/integrations/callback" element={<IntegrationsCallbackPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/legal/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/legal/terms" element={<TermsOfServicePage />} />
      <Route path="/legal/disclaimer" element={<DisclaimerPage />} />
      <Route path="/r/:code" element={<ReferralClickPage />} />
      <Route path="/book-demo" element={<BookDemoPage />} />
      <Route path="/blog" element={<BlogPage />} />
      <Route path="/blog/:slug" element={<BlogArticlePage />} />
      <Route path="/research" element={<ResearchPage />} />
      <Route path="/share/:token" element={<SharedBlueprintPage />} />
      <Route path="/join/:token" element={<JoinPage />} />
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
        <Route path="simulation" element={<RequireWorkspace><SimulationPage /></RequireWorkspace>} />
        <Route path="blueprint" element={<RequireWorkspace><BlueprintPage /></RequireWorkspace>} />
        <Route path="business-plan" element={<RequireWorkspace><BusinessPlanPage /></RequireWorkspace>} />
        <Route path="live-plan" element={<Navigate to="/business-plan" replace />} />
        <Route path="registration" element={<RequireWorkspace><RegistrationPage /></RequireWorkspace>} />
        <Route path="catalogue" element={<RequireWorkspace><CataloguePage /></RequireWorkspace>} />
        <Route path="financials" element={<RequireWorkspace><FinancialsPage /></RequireWorkspace>} />
        <Route path="proposals" element={<Navigate to="/financials?tab=proposals" replace />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="credits" element={<CreditsPage />} />
        <Route path="referrals" element={<ReferralPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
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
      <Route path="/marketplace/requests" element={<Navigate to="/marketplace?tab=requests" replace />} />
      <Route path="/marketplace/request/:requestId" element={<ProposalRequestDetailPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    <DemoTour />
    <CookieBanner />
    </DemoTourProvider>
  );
}
