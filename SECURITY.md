# Security Policy

## Supported Versions

YYClaw is under active development and ships from a single release line. Security
fixes land on the latest release; older versions are not patched.

| Version | Supported |
| ------- | --------- |
| 0.5.x (latest) | :white_check_mark: |
| < 0.5 | :x: |

Always upgrade to the newest build from the
[Releases](https://github.com/compking2012/YYClaw/releases) page before reporting
an issue, in case it has already been fixed.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security problems.**

Report vulnerabilities privately through GitHub Security Advisories:

1. Go to the [Security Advisories](https://github.com/compking2012/YYClaw/security/advisories/new)
   page for this repository.
2. Click **Report a vulnerability** and describe the issue.

Please include, as far as you can:

- The affected version and platform (macOS / Windows / Linux)
- A description of the vulnerability and its impact
- Steps to reproduce, or a proof of concept
- Any relevant logs or configuration, with **secrets and API keys removed**

### What to expect

- **Acknowledgement** within 5 business days.
- **Initial assessment** — whether the report is accepted, needs more information,
  or is out of scope — within 10 business days.
- **Progress updates** at least every 14 days while the report is open.
- **Disclosure** coordinated with you. We aim to publish a fix and an advisory
  before any public disclosure, and we will credit you unless you prefer otherwise.

If a report is declined, you will get an explanation of why — most commonly because
the behavior is intentional, requires an already-compromised machine, or belongs to
an upstream project.

## Scope

YYClaw is a desktop client that embeds and supervises the
[OpenClaw](https://github.com/OpenClaw) runtime. Issues in the OpenClaw runtime
itself, in an AI provider's service, or in a third-party channel plugin should be
reported to that project. If you are unsure, report it here and we will help route
it.

In scope, for example:

- Escaping the renderer's security boundary (Node.js access, `contextBridge`
  allowlist bypass, arbitrary local file read/write from renderer code)
- Leaking secrets stored in the OS keychain, or writing credentials to disk or logs
  in plain text unexpectedly
- Arbitrary code execution via chat content, skill installation, HTML preview, or a
  crafted workspace file
- Bypassing the HTML preview restrictions (network access, navigation, downloads,
  device permissions)
- Unauthorized access to the local Gateway listener on `127.0.0.1:18789`
- Privilege escalation through the updater or the packaged binaries

Out of scope:

- Findings that require an attacker who already has full local access to the user's
  account
- Missing hardening that has no demonstrable exploit path
- Vulnerabilities in a dependency with no exploitable path in YYClaw — report those
  upstream, and tell us if YYClaw exposes them
- Automated scanner output with no analysis of real impact

## Handling Secrets

YYClaw stores API keys and credentials in the operating system's native keychain.
Note that configuration files such as `openclaw.json` and `auth-profiles.json` are
written as **plain text** on disk by design — see
[Configuration Storage](docs/en-US/features.md#configuration-storage) for the
rationale. Treat your OpenClaw configuration directory as sensitive, and scrub it
before attaching anything to a report.
