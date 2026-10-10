---
id: dev-startup-log-errors
title: Resolve development startup log errors
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Diagnose damaged persisted credentials precisely and avoid futile reconnects, development updater requests, and development macOS login-item changes.
touchedAreas:
  - electron/gateway/config-delivery.ts
  - electron/gateway/startup-recovery.ts
  - electron/main/updater.ts
  - electron/main/launch-at-startup.ts
  - tests/unit/gateway-config-delivery.test.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/launch-at-startup.test.ts
  - tests/unit/app-updater.test.ts
  - harness/specs/tasks/dev-startup-log-errors.md
  - harness/specs/tasks/config-set-redacted-credentials.md
  - harness/specs/rules/openclaw-config-delivery.md
  - harness/reference/openclaw-config-delivery.md
  - docs/TROUBLESHOOTING.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - openclaw-config-delivery
  - comms-regression
requiredTests:
  - tests/unit/gateway-config-delivery.test.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/launch-at-startup.test.ts
  - tests/unit/app-updater.test.ts
expectedUserBehavior:
  - Invalid saved redaction placeholders report the field path and require credential recovery rather than retrying startup indefinitely.
  - Development launches skip application updates and macOS login-item registration while packaged behavior remains unchanged.
acceptance:
  - Do not log credential values or automatically select an ambiguous historical credential.
  - Never delete credential-bearing channels or disable validation to make startup succeed.
  - Development update checks return an idle state without accessing dev-app-update.yml or spoofing the installed version.
docs:
  required: false
  reason: Internal startup and development-only corrections; production feature interfaces remain unchanged.
---

# Development startup diagnostics

The supplied log reports stored redaction sentinels, a missing development update
feed, and a denied macOS login-item change. Repair the affected local snapshot
only from verified matching credentials and retain a private backup of the damaged
file. Bundler chunk-placement and transitive deprecation warnings are not startup
failures and must not be hidden by globally suppressing diagnostics.
