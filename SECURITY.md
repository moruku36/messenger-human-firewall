# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Messenger Human Firewall, please **do not open a public issue**.
Instead, please report the vulnerability privately by contacting the maintainer via GitHub Security Advisories or by emailing:
- maintainer contact via GitHub repository security tab

We will acknowledge your report within 48 hours and work with you on an expedited patch.

## Scope & Trust Boundary

1. **Local Resident Operation**:
   - The firewall runs locally on your machine.
   - Session cookies and browser profiles remain strictly inside your designated `BROWSER_USER_DATA_DIR`.
   - Local database (`firewall.db`) stores hashed identifiers (`sha256`) of threads and incoming message hashes.

2. **External Communication Boundary**:
   - Incoming stranger text (and a conversation-summary field, currently always empty) is submitted via HTTPS to **TypeSafe Jev** for triage when `JEV_ENABLED=true`. When the resulting action is `POLITE_REPLY` / `TIME_WASTER`, the same minimal context is submitted to the **Google Gemini API** for reply generation. In Shadow / Legacy modes (`JEV_SHADOW_MODE=true` or `JEV_ENABLED=false`) Gemini also performs triage.
   - In accordance with privacy safeguards, raw message contents are excluded from application stdout logs and only hashed identifiers and whitelisted metadata are emitted.
   - Ensure your upstream provider's terms and data retention policies align with your organization's confidentiality standards.

3. **Rate Limiting & Anti-Ban Safeguards**:
   - To mitigate risk of platform automated bot detection, the firewall imposes strict hard caps (3 replies per thread by default via `CONTROLLED_MAX_REPLIES`, minimum 15s interval, 24h rolling limit, and a shared daily LLM request quota).
   - Live dispatch (`DRY_RUN=false`) is only performed to the single thread matching `ALLOWED_TEST_THREAD_ID`.
   - Live dispatch should always be preceded by testing in `DRY_RUN=true` mode.
