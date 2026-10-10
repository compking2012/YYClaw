---
id: config-set-redacted-credentials
title: Preserve credentials when deleting providers
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Restore redacted Gateway snapshot credentials from durable Main-owned config before config.set, including Feishu account secrets during provider deletion.
touchedAreas:
  - electron/gateway/config-delivery.ts
  - tests/unit/gateway-config-delivery.test.ts
  - harness/specs/tasks/config-set-redacted-credentials.md
  - harness/specs/rules/openclaw-config-delivery.md
  - harness/reference/openclaw-config-delivery.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - comms-regression
  - openclaw-config-delivery
requiredTests:
  - tests/unit/gateway-config-delivery.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/provider-service-stale-cleanup.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
expectedUserBehavior:
  - Deleting a model provider preserves unrelated channel credentials and succeeds with redacted Gateway snapshots.
acceptance:
  - Config.set never receives unresolved redaction sentinels.
  - Restore only sentinel values; retain Gateway runtime shape, explicit secret changes, intentional deletions, and optimistic concurrency retries.
  - Missing durable credentials fail before config.set or sidecar cleanup, without replacing secrets with placeholders or empty values.
docs:
  required: false
  reason: Internal config delivery correction with no new interface or changed intended user flow.
---

# Credential-preserving provider deletion

Gateway config.get may redact plugin-owned fields that config.set cannot restore
with its current schema hints. Main must restore the original durable values
before committing the mutated snapshot rather than changing channel configuration
or bypassing Gateway validation. Tests use synthetic credentials only.
