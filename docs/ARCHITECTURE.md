# Architecture & Trust Boundary

## 1. System Topology & Trust Boundary

<p align="center">
  <img src="assets/architecture.png" alt="Messenger Human Firewall 構成図" width="100%">
</p>

> **Note:** 上の画像は Jev 導入前（Gemini のみ）の旧構成図です。現行構成は下のテキスト図と §3 を正としてください。

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Local Host Machine (Trusted & Controlled Environment)                           │
│                                                                                 │
│  [Playwright Browser]                                                           │
│    Messenger Message Requests                                                   │
│         │                                                                       │
│         ▼                                                                       │
│  [Browser Watcher & Validator]                                                  │
│         │                                                                       │
│         ├──────────────────────────► [SQLite State Store]                       │
│         │                             (sha256 hashes, quotas & counters only)   │
│         │                                                                       │
│         ▼ (1. HTTPS: Stranger message & sanitized context)                      │
│    ═════════════════════════════════════════════════════════════╗               │
│                                                                 ║               │
│  [Deterministic Policy (jev-policy.ts)] ◄───────────────────────╫───────────┐   │
│         │                                                       ║           │   │
│         ├── IGNORE / HUMAN_REQ / BLOCK (Gemini calls = 0)       ║           │   │
│         │                                                       ║           │   │
│         ▼ (POLITE_REPLY / TIME_WASTER only)                     ║           │   │
│         │                                                       ║           │   │
│         ▼ (2. HTTPS: Reply generation prompt)                   ║           │   │
│    ═════════════════════════════════════════════════════════╗   ║           │   │
│                                                             ║   ║           │   │
│  [Reply Guard (Safety Regex & Policies)] ◄──────────────────╫───╫───────┐   │   │
│         │                                                   ║   ║       │   │   │
│         ▼                                                   ║   ║       │   │   │
│  [Controlled Send Gate]                                     ║   ║       │   │   │
│    (Strict Thread Match, 15s interval, 24h cap, Kill Switch)║   ║       │   │   │
│         │                                                   ║   ║       │   │   │
│         ▼                                                   ║   ║       │   │   │
│  [Playwright Dispatch to Active Thread]                     ║   ║       │   │   │
└─────────────────────────────────────────────────────────────╫───╫───────┘   │   │
                                                              ║   ║           │   │
                                           Internet Boundary  ║   ║           │   │
                                                              ▼   ▼           │   │
                                ┌─────────────────────────────────────────┐   │   │
                                │ Third-Party Cloud AI Providers          │   │   │
                                │                                         │   │   │
                                │ 1. TypeSafe Jev API (Production Triage) ├───┘   │
                                │    Header: Authorization: Bearer <key>  │       │
                                │                                         │       │
                                │ 2. Google Gemini API (Reply Generation) ├───────┘
                                │    Header: x-goog-api-key               │
                                └─────────────────────────────────────────┘
```

---

## 2. Component Pipeline

1. **Browser Watcher (`src/channels/messenger/watcher.ts`, `validator.ts`, `selectors.ts`)**:
   - Playwright によるローカル常駐監視。
   - `Message Requests` タブを走査し、未読メッセージおよびスレッドIDを抽出。
   - メッセージ本文の SHA-256 ハッシュをローカル SQLite (`src/core/storage.ts`) に照合して重複排除。

2. **Human Firewall AI (`src/llm/gemini.ts` & `src/llm/jev.ts`)**:
   - **TypeSafe Jev (Production Triage Classifier - Active Mode)**:
     - `@typesafe-ai/sdk` による高速な Typed Decision（Choice / Noul / Continuous Score）。
     - 受信メッセージのセマンティックトリアージにおける本番 Source of Truth。返信文章の自由生成は行いません。
   - **Deterministic Decision Policy (`src/core/jev-policy.ts`)**:
     - Jev の Typed Signal を純粋な TypeScript ルールに入力し、最終 Action（`IGNORE`, `POLITE_REPLY`, `TIME_WASTER`, `HUMAN_REQUIRED`, `BLOCK_RECOMMENDED`）を決定論的に導出。
     - `IGNORE`, `HUMAN_REQUIRED`, `BLOCK_RECOMMENDED` 時は Gemini API 呼び出しを行いません（APIコール数 = 0）。
   - **Google Gemini (Reply Generator ONLY in Active Mode)**:
     - Jev の判定が `POLITE_REPLY` または `TIME_WASTER` の場合のみ、コンテキストに応じた安全な返信文章を生成。
     - 生成失敗時は Fail-Closed により即座に `HUMAN_REQUIRED` に倒置し送信を停止。
   - **Safe Telemetry & Comparator (`src/core/comparator.ts`)**:
     - Shadow Mode 時において、メッセージ本文や秘密情報を一切残さず、非機微なメトリクス・ハッシュ・reasonCode のみで両者の判定（一致/不一致、確信度、レイテンシ）を比較ログ記録。
   - **Fail-Closed & Safety Invariants**:
     - Jev のタイムアウト・API障害・パースエラー時も安全基準を下げず、安全側（`HUMAN_REQUIRED`）へ自動倒置（Fail-Closed）。Gemini 分類への安易なフォールバックは行いません。

3. **Decision & State Machine (`src/core/firewall.ts`, `src/core/state-machine.ts`)**:
   - 送信済み返信数に応じた対話状態の遷移（`CONFUSED_CURIOUS` ➜ `DEEP_PROBING` ➜ `HESITANT_CLOSING`）。
   - スレッド状態管理（SQLite `threads` テーブル。`paused` / `humanRequired` の boolean フラグと、最終 Action を示す `mode`）。`BLOCK_RECOMMENDED` は推奨フラグのみで、Messenger 上での実ブロック処理は行いません。

4. **Reply Guard (`src/core/reply-guard.ts`)**:
   - LLM出力に対するローカル正規表現・ルールベース検査（PII、金銭・契約・合意、URL）。
   - 危険パターン検知時は即座に `REPLY_BLOCKED` とし、送信を中止（自動リトライなし。`HUMAN_REQUIRED` フラグは立たない）。

5. **Controlled Send Gate (`src/core/pipeline.ts`, `src/core/controlled-limiter.ts`, `src/channels/messenger/sender.ts`)**:
   - 実送信は `ALLOWED_TEST_THREAD_ID` に完全一致するスレッドのみ（未設定なら送信しない）。
   - スレッドID完全一致およびクリック後の DOM `.active` 要素再検証。
   - 1スレッド累計最大 `CONTROLLED_MAX_REPLIES`（デフォルト3）通、24時間ローリング最大 `MAX_REPLIES_PER_THREAD_PER_DAY`（デフォルト20）通、1日最大 `MAX_LLM_REQUESTS_PER_DAY`（デフォルト100）回のLLMリクエスト、15秒送信インターバル、緊急停止（Kill Switch）を強制。

---

## 3. Production Triage Pipeline Architecture

```text
Incoming Messenger Message
        │
        ▼
TypeSafe Jev
Production Triage
        │
        ▼
Typed Semantic Signals (Choice / Noul / Score)
        │
        ▼
Deterministic TypeScript Policy (jev-policy.ts)
        │
        ├── IGNORE              ──────────────┐
        ├── HUMAN_REQUIRED      ──────────────┤ (Gemini API calls = 0)
        ├── BLOCK_RECOMMENDED   ──────────────┘
        │
        ├── POLITE_REPLY
        └── TIME_WASTER
                   │
                   ▼
               Gemini
             Reply Generation
                ONLY
                   │ (Fail-Closed to HUMAN_REQUIRED on error)
                   ▼
              Reply Guard
      (Local Regex PII / URL / Commitment Checks)
                   │
                   ▼
              Send Gate
       (Dry Run / Playwright Dispatch)
```
