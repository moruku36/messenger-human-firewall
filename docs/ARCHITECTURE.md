# Architecture & Trust Boundary

## 1. System Topology & Trust Boundary

<p align="center">
  <img src="assets/architecture.png" alt="Messenger Human Firewall 構成図" width="100%">
</p>

```text
┌────────────────────────────────────────────────────────────┐
│ Local Host Machine (Trusted & Controlled Environment)      │
│                                                            │
│  [Playwright Browser]                                      │
│    Messenger Message Requests                              │
│         │                                                  │
│         ▼                                                  │
│  [Browser Watcher & Validator]                             │
│         │                                                  │
│         ├──────────────► [SQLite State Store]              │
│         │                 (sha256 hashes & counters only)  │
│         │                                                  │
│         ▼ (HTTPS: Stranger message text only)              │
│    ═══════════════════════════════════════════════╗        │
│                                                   ║        │
│  [Reply Guard (Safety Regex & Policies)] ◄────────╫────────┼───┐
│         │                                         ║        │   │
│         ▼                                         ║        │   │
│  [Controlled Send Gate]                           ║        │   │
│    (Strict Thread Match, 15s interval, 24h cap)   ║        │   │
│         │                                         ║        │   │
│         ▼                                         ║        │   │
│  [Playwright Dispatch to Active Thread]           ║        │   │
└───────────────────────────────────────────────────╫────────┘   │
                                                    ║             │
                                 Internet Boundary  ║             │
                                                    ▼             │
                                      ┌───────────────────────┐   │
                                      │ Third-Party Cloud     │   │
                                      │ Google Gemini API     │───┘
                                      │ (gemini-3.6-flash)    │
                                      │ Header: x-goog-api-key│
                                      └───────────────────────┘
```

---

## 2. Component Pipeline

1. **Browser Watcher (`src/browser/`)**:
   - Playwright によるローカル常駐監視。
   - `Message Requests` タブを走査し、未読メッセージおよびスレッドIDを抽出。
   - メッセージ本文の SHA-256 ハッシュをローカル SQLite (`src/core/storage.ts`) に照合して重複排除。

2. **Human Firewall AI (`src/llm/gemini.ts` & `src/llm/jev.ts`)**:
   - **Google Gemini (Active / Production Source of Truth)**:
     - メッセージの分類・トリアージおよび安全な返信文章生成（`POLITE_REPLY` / `TIME_WASTER`）を担当。
   - **TypeSafe Jev (Shadow Mode / Experimental Semantic Triage)**:
     - `@typesafe-ai/sdk` による高速な Typed Decision（Choice / Noul / Score）。
     - 返信文章は生成せず、構造化シグナル（`category`, `credentialRequest`, `moneyRequest`, `threatOrUrgency`, `promptInjection`, `suspiciousExternalLink`, `overallRisk`）の抽出に特化。
   - **Deterministic Decision Policy (`src/core/jev-policy.ts`)**:
     - Jev の Typed Signal を純粋な TypeScript ルールに入力し、最終 Action（`IGNORE`, `POLITE_REPLY`, `TIME_WASTER`, `HUMAN_REQUIRED`, `BLOCK_RECOMMENDED`）を決定論的に導出。
   - **Safe Telemetry & Comparator (`src/core/comparator.ts`)**:
     - メッセージ本文や秘密情報を一切残さず、非機微なメトリクス・ハッシュ・reasonCode のみで両者の判定（一致/不一致、確信度、レイテンシ）を比較ログ記録。
   - **Fail-Closed & Safety Invariants**:
     - Jev のタイムアウト・API障害・パースエラー時も安全基準を下げず、安全側（`HUMAN_REQUIRED`）へ自動倒置（Fail-Closed）。Gemini側の本番パイプラインを阻害しません。

3. **Decision & State Machine (`src/core/firewall.ts`, `src/core/state-machine.ts`)**:
   - ターン数に応じた対話状態の遷移（`curious` ➜ `deep_probing` ➜ `hesitant_closing`）。
   - スレッド状態管理（`active`, `paused`, `blocked`）。

4. **Reply Guard (`src/core/reply-guard.ts`)**:
   - LLM出力に対するローカル正規表現・ルールベース検査（PII、金銭・契約・合意、URL）。
   - 危険パターン検知時は即座に `REPLY_BLOCKED` とし、人間へエスカレーション。

5. **Controlled Send Gate (`src/core/pipeline.ts`, `src/browser/send-reply.ts`)**:
   - スレッドID完全一致およびクリック後の DOM `.active` 要素再検証。
   - 1スレッド24時間最大20通、1日最大100回LLMリクエスト、15秒送信インターバル、緊急停止（Kill Switch）を強制。

---

## 3. Shadow Triage Architecture (Target Architecture)

```text
Incoming Message
       │
       ├─────────────────────────────────────────┐
       ▼                                         ▼
[Gemini Classifier] (Active Source of Truth)  [Jev Semantic Triage] (Shadow Mode)
       │                                         │ (Typed Semantic Signals)
       │                                         ▼
       │                              [Deterministic Policy Engine]
       │                                         │
       │                                         ▼ (Shadow Action Decision)
       ▼                                         │
[Production Decision]                            │
       │                                         │
       ├─────────────────► [Safe Telemetry] ◄────┘
       ▼                   (Comparison Metrics, Hashes, Agreement)
[Gemini Reply Generator]
       │
       ▼
[Existing Reply Guard]
       │
       ▼
[Controlled Send Gate]
```

