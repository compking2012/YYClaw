#!/usr/bin/env python3
"""
Send a CI build notification email via SMTP.

Required env (GitLab CI Variables):
  YYCLAW_NOTIFY_SMTP_HOST
  YYCLAW_NOTIFY_SMTP_PORT
  YYCLAW_NOTIFY_SMTP_USER
  YYCLAW_NOTIFY_SMTP_PASSWORD
  YYCLAW_NOTIFY_EMAIL_FROM
  YYCLAW_NOTIFY_EMAIL          # comma-separated recipients

Optional env:
  NOTIFY_SUBJECT
  NOTIFY_BODY
"""
from __future__ import annotations

import os
import smtplib
import ssl
import sys
from email.message import EmailMessage


def require(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise SystemExit(f"[ci-notify-smtp] missing required env: {name}")
    return value


def main() -> int:
    host = require("YYCLAW_NOTIFY_SMTP_HOST")
    port = int(require("YYCLAW_NOTIFY_SMTP_PORT"))
    user = require("YYCLAW_NOTIFY_SMTP_USER")
    password = require("YYCLAW_NOTIFY_SMTP_PASSWORD")
    from_addr = require("YYCLAW_NOTIFY_EMAIL_FROM")
    to_raw = require("YYCLAW_NOTIFY_EMAIL")
    to_addrs = [part.strip() for part in to_raw.replace(";", ",").split(",") if part.strip()]
    if not to_addrs:
        raise SystemExit("[ci-notify-smtp] YYCLAW_NOTIFY_EMAIL has no recipients")

    subject = (os.environ.get("NOTIFY_SUBJECT") or "YYClaw CI notification").strip()
    body = os.environ.get("NOTIFY_BODY") or "(empty body)"

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addrs)
    msg.set_content(body)

    print(
        f"[ci-notify-smtp] sending via {host}:{port} "
        f"from={from_addr} to={','.join(to_addrs)} subject={subject!r}"
    )

    context = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=60) as smtp:
            smtp.login(user, password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=60) as smtp:
            smtp.ehlo()
            smtp.starttls(context=context)
            smtp.ehlo()
            smtp.login(user, password)
            smtp.send_message(msg)

    print("[ci-notify-smtp] sent OK")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001 — surface any SMTP failure in CI logs
        print(f"[ci-notify-smtp] FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
