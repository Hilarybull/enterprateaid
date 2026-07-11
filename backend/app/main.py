from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
import urllib3.util.retry

# GLOBAL MONKEYPATCH: pytrends uses 'method_whitelist' which was renamed to 'allowed_methods' 
# in urllib3 >= 2.0.0. This global patch ensures compatibility across all engines.
# We apply it very aggressively to ensure no imports bypass it.
try:
    orig_retry_init = urllib3.util.retry.Retry.__init__
    def patched_retry_init(self, *args, **kwargs):
        if 'method_whitelist' in kwargs:
            # Always map method_whitelist to allowed_methods if the latter is supported
            # and the former is what's being passed (as in pytrends)
            kwargs['allowed_methods'] = kwargs.pop('method_whitelist')
        return orig_retry_init(self, *args, **kwargs)
    urllib3.util.retry.Retry.__init__ = patched_retry_init
except Exception as e:
    logging.getLogger(__name__).warning(f"Failed to apply global urllib3 patch: {e}")

from app.core.config import get_settings
from app.core.database import connect_to_mongo, close_mongo_connection
from app.modules.blueprint.router import router as blueprint_router
from app.modules.business_assistant.router import router as business_assistant_router
from app.modules.business_registration.router import router as registration_router
from app.modules.idea_validation.router import router as validation_router
from app.modules.scenario_intelligence.router import router as scenario_intelligence_router
from app.modules.simulation.router import router as simulation_router
from app.modules.workspace_profile.router import router as workspace_profile_router
from app.modules.service_ideas.router import router as service_ideas_router
from app.modules.upgrade.router import router as upgrade_router
from app.modules.workspace_access.router import router as workspace_access_router
from app.modules.admin.router import router as admin_router
from app.modules.plans.router import router as plans_router
from app.modules.marketplace.router import router as marketplace_router
from app.modules.support.router import router as support_router
from app.modules.reports.router import router as reports_router
from app.modules.integrations.router import router as integrations_router
from app.modules.credits.router import router as credits_router
from app.shared.auth.router import router as auth_router
from app.shared.utils.logging import configure_logging
from app.shared.utils.middleware import request_logging_middleware

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.environment)
    if settings.environment == "development":
        logger.info(
            "Config loaded env=%s cors_origins=%s supabase_enabled=%s",
            settings.environment,
            settings.cors_origins,
            bool(settings.supabase_url and settings.supabase_service_role_key),
        )
        logger.info(
            "LLM providers configured claude=%s gemini=%s openai=%s",
            bool(settings.claude_api_key),
            bool(settings.gemini_api_key),
            bool(settings.openai_api_key),
        )

    app = FastAPI(title=settings.app_name)

    if settings.environment == "development":
        allow_origins = list(dict.fromkeys(settings.cors_origins + [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8001",
            "http://127.0.0.1:8001",
        ]))
        cors_kwargs = dict(
            allow_origins=allow_origins,
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        # Allow any localhost port in dev and Render preview domains as a safe fallback.
        cors_kwargs["allow_origin_regex"] = r"(^https?://(localhost|127\.0\.0\.1)(:\d+)?$)|(^https?://.*\.onrender\.com$)"
    else:
        # Production: allow any origin (no cookies), to avoid blocked auth/signup across Render domains.
        cors_kwargs = dict(
            allow_origins=["*"],
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    app.add_middleware(CORSMiddleware, **cors_kwargs)

    if settings.environment == "development":
        app.middleware("http")(request_logging_middleware)

    app.include_router(auth_router)
    app.include_router(validation_router)
    app.include_router(workspace_profile_router)
    app.include_router(registration_router)
    app.include_router(blueprint_router)
    app.include_router(business_assistant_router)
    app.include_router(simulation_router)
    app.include_router(scenario_intelligence_router)
    app.include_router(upgrade_router)
    app.include_router(service_ideas_router)
    app.include_router(workspace_access_router)
    app.include_router(admin_router)
    app.include_router(plans_router)
    app.include_router(marketplace_router)
    app.include_router(support_router)
    app.include_router(reports_router)
    app.include_router(integrations_router)
    app.include_router(credits_router)

    @app.on_event("startup")
    async def startup():
        await connect_to_mongo()

    @app.on_event("shutdown")
    async def shutdown():
        await close_mongo_connection()

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok"}

    @app.get("/")
    async def root() -> dict:
        return {"status": "ok"}

    @app.head("/")
    async def root_head() -> None:
        return None

    return app


app = create_app()
