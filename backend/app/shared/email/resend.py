from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from html import escape

import httpx

from app.core.config import get_settings
from app.shared.utils.doc_labels import doc_label as _doc_label

logger = logging.getLogger(__name__)

RESEND_MAIL_SEND_URL = "https://api.resend.com/emails"


@dataclass
class EmailDeliveryResult:
    sent: bool
    error: str | None = None


def _email_ready() -> tuple[bool, str | None]:
    settings = get_settings(refresh=True)
    if not settings.resend_api_key:
        return False, "RESEND_API_KEY is not configured."
    if not settings.resend_from_email:
        return False, "RESEND_FROM_EMAIL is not configured."
    return True, None


_FOOTER_HTML = (
    "<div style=\"margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;"
    "font-size:11px;color:#94a3b8;line-height:1.5;\">"
    "You received this email because an action was requested for your EnterprateAI account.<br/>"
    "If you did not request this, you can safely ignore this email."
    "</div>"
)

_FOOTER_TEXT = (
    "\n\n"
    "You received this email because an action was requested for your EnterprateAI account.\n"
    "If you did not request this, you can safely ignore this email."
)


async def send_email_via_resend(
    *,
    to_email: str,
    subject: str,
    text_content: str,
    html_content: str,
    sender_name: str | None = None,
    reply_to_email: str | None = None,
) -> EmailDeliveryResult:
    ready, reason = _email_ready()
    if not ready:
        return EmailDeliveryResult(sent=False, error=reason)

    settings = get_settings(refresh=True)
    from_email = settings.resend_from_email
    display_name = sender_name or settings.app_name

    payload = {
        "from": f"{display_name} <{from_email}>",
        "reply_to": reply_to_email or from_email,
        "to": [to_email],
        "subject": subject,
        "text": text_content,
        "html": html_content,
        "headers": {
            "Precedence": "transactional",
            "X-Entity-Ref-ID": str(uuid.uuid4()),
        },
    }

    logger.info("Sending email via Resend to=%s subject=%r from=%s", to_email, subject, from_email)
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                RESEND_MAIL_SEND_URL,
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        logger.error("Resend request failed: %s", exc)
        return EmailDeliveryResult(sent=False, error=f"Resend request failed: {exc}")

    if response.status_code in (200, 201):
        logger.info("Resend accepted email to=%s", to_email)
        return EmailDeliveryResult(sent=True)

    error_message = response.text
    try:
        data = response.json()
        error_message = data.get("message") or data.get("name") or error_message
    except Exception:
        pass

    logger.error("Resend rejected email (%s): %s", response.status_code, error_message)
    return EmailDeliveryResult(
        sent=False,
        error=f"Resend rejected the email ({response.status_code}): {error_message}",
    )


async def send_workspace_invitation_email_with_link(
    *,
    to_email: str,
    inviter_email: str,
    invite_url: str,
    expires_in_days: int,
    permission_type: str,
    workspace_name: str | None = None,
) -> EmailDeliveryResult:
    app_name = get_settings().app_name
    sender_name = workspace_name or app_name
    access_label = "module access" if permission_type == "module" else "feature-based access"
    subject = f"You've been invited to join a workspace on {app_name}"
    text_content = (
        f"{inviter_email} has invited you to join their workspace on {app_name}.\n\n"
        f"Access level: {access_label}\n"
        f"This invitation expires in {expires_in_days} day{'s' if expires_in_days != 1 else ''}.\n\n"
        f"Accept invitation:\n{invite_url}"
        + _FOOTER_TEXT
    )
    html_content = (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
        "line-height:1.6;color:#0f172a;max-width:520px;margin:0 auto;padding:24px 16px;\">"
        f"<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700;color:#0f172a;\">Workspace invitation</h2>"
        f"<p style=\"margin:0 0 12px;\"><strong>{escape(inviter_email)}</strong> has invited you to join their "
        f"workspace on <strong>{escape(app_name)}</strong>.</p>"
        f"<p style=\"margin:0 0 20px;color:#475569;\">Access level: {escape(access_label)}<br/>"
        f"This invitation expires in {expires_in_days} day{'s' if expires_in_days != 1 else ''}.</p>"
        f"<p style=\"text-align:center;margin:24px 0;\"><a href=\"{escape(invite_url)}\" "
        "style=\"display:inline-block;padding:12px 28px;border-radius:8px;background:#2563eb;"
        "color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;\">"
        "Accept invitation</a></p>"
        + _FOOTER_HTML
        + "</div>"
    )
    return await send_email_via_resend(
        to_email=to_email,
        subject=subject,
        text_content=text_content,
        html_content=html_content,
        sender_name=sender_name,
    )


async def send_password_reset_email(
    *,
    to_email: str,
    reset_url: str,
    expires_in_minutes: int = 60,
) -> EmailDeliveryResult:
    app_name = get_settings().app_name
    subject = f"Your {app_name} password link"
    text_content = (
        f"Hi,\n\n"
        f"We received a request to set a new password for your {app_name} account.\n\n"
        f"Use the link below to continue. It expires in {expires_in_minutes} minutes.\n\n"
        f"{reset_url}"
        + _FOOTER_TEXT
    )
    html_content = (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
        "line-height:1.6;color:#0f172a;max-width:520px;margin:0 auto;padding:24px 16px;\">"
        f"<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700;color:#0f172a;\">Set a new password</h2>"
        f"<p style=\"margin:0 0 12px;\">We received a request to set a new password for your "
        f"<strong>{escape(app_name)}</strong> account ({escape(to_email)}).</p>"
        f"<p style=\"margin:0 0 20px;color:#475569;\">This link expires in <strong>{expires_in_minutes} minutes</strong>.</p>"
        f"<p style=\"text-align:center;margin:24px 0;\"><a href=\"{escape(reset_url)}\" "
        "style=\"display:inline-block;padding:12px 28px;border-radius:8px;background:#2563eb;"
        "color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;\">"
        "Set new password</a></p>"
        + _FOOTER_HTML
        + "</div>"
    )
    return await send_email_via_resend(
        to_email=to_email,
        subject=subject,
        text_content=text_content,
        html_content=html_content,
    )


async def send_password_otp_email(
    *,
    to_email: str,
    otp_code: str,
) -> EmailDeliveryResult:
    app_name = get_settings().app_name
    subject = f"Your {app_name} password verification code"
    text_content = (
        f"Your verification code is: {otp_code}\n\n"
        f"Enter this code to confirm your identity and update your password.\n"
        f"This code expires in 10 minutes."
        + _FOOTER_TEXT
    )
    html_content = (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
        "line-height:1.6;color:#0f172a;max-width:520px;margin:0 auto;padding:24px 16px;\">"
        f"<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700;color:#0f172a;\">Password verification code</h2>"
        f"<p style=\"margin:0 0 20px;\">Use the code below to verify your identity and update your password.</p>"
        f"<div style=\"text-align:center;margin:28px 0;\">"
        f"<span style=\"display:inline-block;padding:16px 32px;border-radius:12px;background:#f1f5f9;"
        f"font-size:32px;font-weight:800;letter-spacing:8px;color:#0f172a;\">{escape(otp_code)}</span>"
        f"</div>"
        f"<p style=\"color:#475569;font-size:13px;\">This code expires in <strong>10 minutes</strong>. "
        f"If you did not request this, ignore this email. Your password will not change.</p>"
        + _FOOTER_HTML
        + "</div>"
    )
    return await send_email_via_resend(
        to_email=to_email,
        subject=subject,
        text_content=text_content,
        html_content=html_content,
    )


async def send_email_verification_email(
    *,
    to_email: str,
    verify_url: str,
    name: str | None = None,
) -> EmailDeliveryResult:
    app_name = get_settings().app_name
    greeting = f"Hi {escape(name)}," if name else "Hi,"
    subject = f"Verify your {app_name} email"
    text_content = (
        f"{greeting}\n\nThank you for signing up to {app_name}!\n\n"
        f"Please verify your email address by clicking the link below:\n{verify_url}\n\n"
        "This link expires in 24 hours."
        + _FOOTER_TEXT
    )
    html_content = (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
        "line-height:1.6;color:#0f172a;max-width:520px;margin:0 auto;padding:24px 16px;\">"
        f"<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700;color:#0f172a;\">Verify your email</h2>"
        f"<p style=\"margin:0 0 12px;\">{greeting}</p>"
        f"<p style=\"margin:0 0 20px;\">Thank you for signing up to <strong>{escape(app_name)}</strong>! "
        "Please verify your email address to activate your account.</p>"
        f"<p style=\"text-align:center;margin:28px 0;\"><a href=\"{escape(verify_url)}\" "
        "style=\"display:inline-block;padding:12px 28px;border-radius:8px;background:#2563eb;"
        "color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;\">"
        "Verify my email</a></p>"
        "<p style=\"color:#475569;font-size:13px;\">This link expires in <strong>24 hours</strong>. "
        "If you did not create an account, you can safely ignore this email.</p>"
        + _FOOTER_HTML
        + "</div>"
    )
    return await send_email_via_resend(
        to_email=to_email,
        subject=subject,
        text_content=text_content,
        html_content=html_content,
    )


async def send_document_share_email(
    *,
    to_email: str,
    sender_email: str,
    share_url: str,
    document_title: str,
    company_name: str,
    expires_in_days: int | None = None,
    document_type: str = "document",
) -> EmailDeliveryResult:
    app_name = get_settings().app_name
    sender_label = company_name or app_name
    doc_label = _doc_label(document_type)
    article = "an" if doc_label[0].lower() in "aeiou" else "a"
    subject = f"{sender_label} shared {article} {doc_label} with you"
    _expiry_text = (
        f"This secure link expires in {expires_in_days} day{'s' if expires_in_days != 1 else ''}.\n\n"
        if expires_in_days else ""
    )
    _expiry_html = (
        "<p style=\"margin:0 0 20px;color:#475569;\">This link expires in "
        f"{expires_in_days} day{'s' if expires_in_days != 1 else ''}.</p>"
        if expires_in_days else ""
    )
    text_content = (
        f"{sender_label} shared {article} {doc_label} with you via {app_name}.\n\n"
        f"{_expiry_text}"
        f"Open {doc_label}:\n{share_url}"
        + _FOOTER_TEXT
    )
    html_content = (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
        "line-height:1.6;color:#0f172a;max-width:520px;margin:0 auto;padding:24px 16px;\">"
        f"<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700;color:#0f172a;\">{escape(doc_label)} shared with you</h2>"
        f"<p style=\"margin:0 0 12px;\"><strong>{escape(sender_label)}</strong> shared "
        f"{article} {escape(doc_label)} with you via {escape(app_name)}.</p>"
        f"{_expiry_html}"
        f"<p style=\"text-align:center;margin:24px 0;\"><a href=\"{escape(share_url)}\" "
        "style=\"display:inline-block;padding:12px 28px;border-radius:8px;background:#2563eb;"
        "color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;\">"
        f"Open {escape(doc_label)}</a></p>"
        + _FOOTER_HTML
        + "</div>"
    )
    return await send_email_via_resend(
        to_email=to_email,
        subject=subject,
        text_content=text_content,
        html_content=html_content,
        sender_name=sender_label,
        reply_to_email=sender_email,
    )


async def send_proposal_invite_email(
    *,
    to_email: str,
    sender_name: str,
    request_title: str,
    invite_url: str,
) -> EmailDeliveryResult:
    app_name = get_settings().app_name
    subject = f"{sender_name} invited you to submit a proposal"
    text_content = (
        f"{sender_name} has invited you to submit a proposal for \"{request_title}\" via {app_name}.\n\n"
        f"View the request and apply:\n{invite_url}"
        + _FOOTER_TEXT
    )
    html_content = (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
        "line-height:1.6;color:#0f172a;max-width:520px;margin:0 auto;padding:24px 16px;\">"
        "<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700;\">You've been invited to submit a proposal</h2>"
        f"<p style=\"margin:0 0 12px;\"><strong>{escape(sender_name)}</strong> invited you to submit a proposal for "
        f"<strong>{escape(request_title)}</strong> via {escape(app_name)}.</p>"
        f"<p style=\"text-align:center;margin:24px 0;\"><a href=\"{escape(invite_url)}\" "
        "style=\"display:inline-block;padding:12px 28px;border-radius:8px;background:#2563eb;"
        "color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;\">View request</a></p>"
        + _FOOTER_HTML
        + "</div>"
    )
    return await send_email_via_resend(
        to_email=to_email,
        subject=subject,
        text_content=text_content,
        html_content=html_content,
        sender_name=sender_name,
    )


async def send_proposal_update_email(
    *,
    to_email: str,
    headline: str,
    body: str,
    cta_label: str,
    cta_url: str,
    sender_name: str | None = None,
) -> EmailDeliveryResult:
    app_name = get_settings().app_name
    subject = headline
    text_content = f"{body}\n\n{cta_label}:\n{cta_url}" + _FOOTER_TEXT
    html_content = (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
        "line-height:1.6;color:#0f172a;max-width:520px;margin:0 auto;padding:24px 16px;\">"
        f"<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700;\">{escape(headline)}</h2>"
        f"<p style=\"margin:0 0 12px;\">{escape(body)}</p>"
        f"<p style=\"text-align:center;margin:24px 0;\"><a href=\"{escape(cta_url)}\" "
        "style=\"display:inline-block;padding:12px 28px;border-radius:8px;background:#2563eb;"
        "color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;\">"
        f"{escape(cta_label)}</a></p>"
        + _FOOTER_HTML
        + "</div>"
    )
    return await send_email_via_resend(
        to_email=to_email,
        subject=subject,
        text_content=text_content,
        html_content=html_content,
        sender_name=sender_name or app_name,
    )


async def send_proposal_received_email(
    *,
    to_email: str,
    recipient_name: str,
    proposer_name: str,
    request_title: str | None,
    inbox_url: str,
) -> EmailDeliveryResult:
    app_name = get_settings().app_name
    subject = f"New proposal from {proposer_name}"
    context = f" in response to \"{request_title}\"" if request_title else ""
    text_content = (
        f"{proposer_name} submitted a proposal to {recipient_name}{context} via {app_name}.\n\n"
        f"Review it in your proposal inbox:\n{inbox_url}"
        + _FOOTER_TEXT
    )
    html_content = (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
        "line-height:1.6;color:#0f172a;max-width:520px;margin:0 auto;padding:24px 16px;\">"
        "<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700;\">You've received a new proposal</h2>"
        f"<p style=\"margin:0 0 12px;\"><strong>{escape(proposer_name)}</strong> submitted a proposal to "
        f"<strong>{escape(recipient_name)}</strong>{escape(context)}.</p>"
        f"<p style=\"text-align:center;margin:24px 0;\"><a href=\"{escape(inbox_url)}\" "
        "style=\"display:inline-block;padding:12px 28px;border-radius:8px;background:#2563eb;"
        "color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;\">Open proposal inbox</a></p>"
        + _FOOTER_HTML
        + "</div>"
    )
    return await send_email_via_resend(
        to_email=to_email,
        subject=subject,
        text_content=text_content,
        html_content=html_content,
        sender_name=recipient_name or app_name,
    )
