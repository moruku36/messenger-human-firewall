# Jev vs Gemini Security Triage Benchmark

This directory contains the fixed synthetic security dataset and evaluation runner for comparing **TypeSafe Jev** (in non-blocking Shadow Mode) against **Gemini 3.6 Flash** (Production active).

## Architecture

- **Dataset**: `datasets/security-triage-v1.json` (100 fixed, reproducible cases)
- **Evaluation Layer**: `evaluator.ts` runs directly against `GeminiProvider` and `JevClassifier`. It bypasses the live Facebook Messenger session, browser automation, pre-send reply gates, and dispatch limits.
- **Policy Engine**: `src/core/jev-policy.ts` evaluates Jev signals deterministically in TypeScript (`evaluateJevPolicy`) using the calibrated high-risk threshold (0.85).
- **Severity Classification**:
  - `4`: `BLOCK_RECOMMENDED` (Credential theft, money transfer requests, prompt injection)
  - `3`: `HUMAN_REQUIRED` (Harassment, acute threats, doxxing, low confidence)
  - `2`: `TIME_WASTER` (Unverified suspicious links, romance/pig-butchering probes)
  - `1`: `TIME_WASTER` / `IGNORE` (Cold sales outreach, bulk marketing spam)
  - `0`: `POLITE_REPLY` (Normal conversation, hard negatives)

## Dataset Distribution (100 Cases)

| Group | Count | Language | Key Threat Focus |
| :--- | :---: | :---: | :--- |
| `NORMAL` | 15 | ja, en, mixed | Greetings, post-event notes, **Hard Negatives** (mentioning "password", "振込", GitHub URLs, AI research) |
| `SALES` | 10 | ja, en | SaaS cold outreach, recruitment, offshore development pitches |
| `SPAM` | 10 | ja, en | Mass-blast easy money offers, fake sunglasses, casino promotions, follower bots |
| `SCAM` | 15 | ja, en, mixed | Romance/pig-butchering grooming, fake investment funds, inheritance lures, task scams |
| `CREDENTIAL_PHISHING` | 10 | ja, en | Urgent copyright violation OTP requests, 2FA/SMS tokens, seed phrase theft |
| `MONEY_REQUEST_SCAM` | 10 | ja, en | BEC / CEO wire fraud, emergency traveler gift card requests, bogus police laundering demands |
| `PROMPT_INJECTION` | 10 | ja, en, mixed | Jailbreaks (DAN), system prompt leak attacks, delimiter breakouts, HTML comment injections |
| `HARASSMENT_THREAT` | 10 | ja, en | Bomb threats, physical stalking, doxxing intimidation, acute abusive incitement |
| `SUSPICIOUS_EXTERNAL_LINK` | 5 | ja, en | Invoice dropper links, shortened URLs, smishing package tracking |
| `AMBIGUOUS_MULTILINGUAL` | 5 | mixed, ja, en | Single-character inputs, punctuation noise, broken multilingual syntax |

## How to Run

### 1. Offline Tests (CI Safe, Mocked Clients)
```bash
npm run benchmark:offline
```

### 2. Live Smoke Benchmark (5 Representative Cases)
Requires `GEMINI_API_KEY` and `TYPESAFE_API_KEY`:
```bash
npm run benchmark:smoke
```

### 3. Full 100-Case Live Benchmark
```bash
npm run benchmark
# Or with options:
npm run benchmark -- --concurrency 3 --runs 1
```

## Generated Artifacts

- **Raw Results**: `results/benchmark-v1.json` (Machine-readable full evaluation records)
- **Confusion Matrices**:
  - `reports/gemini-confusion-matrix.csv`
  - `reports/jev-confusion-matrix.csv`
- **Markdown Report**: `reports/JEV_VS_GEMINI_BENCHMARK.md`
