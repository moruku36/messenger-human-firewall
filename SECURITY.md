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
   - In the default `AUTO_REPLY_SCOPE=test_thread_only` mode, live dispatch (`DRY_RUN=false`) is only performed to the single thread matching `ALLOWED_TEST_THREAD_ID`. In `all_threads` mode, that allowlist is intentionally bypassed and eligible Message Requests can be dispatched subject to the remaining safety gates.
   - Live dispatch should always be preceded by testing in `DRY_RUN=true` mode.

4. **Risks of Full Auto-Reply Scope (`AUTO_REPLY_SCOPE=all_threads`)**:
   - **Platform Automation Policy Violation & Account Restriction (BAN Risk)**:
     Meta prohibits unauthorized automated interactions on Facebook Messenger. Enabling full auto-reply across all threads significantly increases the likelihood of automated bot detection, temporary messaging bans, checkpoint verification, or permanent account termination.
   - **Reduced Human Visibility of Misclassifications**:
     While `HumanFirewallCore` deterministically routes high-risk or ambiguous requests to `HUMAN_REQUIRED`, edge cases in classification or LLM hallucinations can occur. In `all_threads` mode, replies are dispatched autonomously across every incoming request without individual pre-approval, reducing the operator's real-time visibility into inappropriate responses.
   - **Mechanical Engagement with Impersonators & Adversaries**:
     Sending automated replies to arbitrary unknown senders opens exposure to prompt injection attempts, social engineering, or adversarial probing designed to elicit specific confirmations or establish sender legitimacy.
   - **Mitigation & Rollback**:
     `all_threads` mode must only be operated with strict rate limits (`CONTROLLED_MAX_REPLIES`, `MAX_REPLIES_PER_THREAD_PER_DAY`, `MIN_REPLY_INTERVAL_SECONDS`), active Reply Guard validation, and an immediate rollback plan. For an immediate stop of a running watcher, use `npm run pause` or the dashboard Kill Switch. Changes to `AUTO_REPLY_SCOPE` or `.env` `PAUSE_ALL=true` are startup configuration and require restarting the watcher to take effect.
