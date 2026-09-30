# Messenger Human Firewall

[English](README.md) | [日本語](README.ja.md)

A local Facebook Messenger triage system for requests from unknown senders. Jev extracts typed security signals, deterministic TypeScript policy selects the action, and Gemini drafts replies only when appropriate.

## Decision flow

1. Observe unknown-sender message requests locally.
2. Jev/System One extracts typed security signals.
3. Deterministic TypeScript policy selects the final action.
4. Gemini generates text only for reply-eligible actions.
5. A local reply guard and controlled send gate check sending.

`BLOCK_RECOMMENDED` records a recommendation; it does not actually block the sender in Messenger or automatically set a human-review flag. Dangerous or ambiguous cases stop automatic replies. The system acts as an automated assistant rather than impersonating the owner.

## Configure

Review `.env.example` and the Japanese setup guide for Active Jev Mode, model configuration, DRY_RUN, and the kill switch. The local policy determines actions independently of Gemini reply wording. Keep the documented send and personal-data boundaries in place.


## Contents

- [SECURITY.md](SECURITY.md)
- [docs/](docs)
- [src/](src)
- [tests/](tests)

## Detailed documentation

The [Japanese guide](README.ja.md) retains the complete original setup instructions, configuration, examples, project status, and limitations. Supporting documents keep their existing language.
