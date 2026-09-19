import { getConfig } from './config.js';
import { compareDecisions, renderComparisonSummary } from './comparator.js';
import { inspectReply, type ReplyGuardResult } from './reply-guard.js';
import type { Action, ClassificationResult, JevDecision } from './types.js';
import type { LLMClassifier, LLMReplyGenerator } from './llm.js';
import { logEvent } from './logger.js';
import { determineTimeWasterState, type TimeWasterState } from './state-machine.js';
import type { JevClassifier } from '../llm/jev.js';

export interface FirewallProcessResult {
  classification: ClassificationResult;
  candidateReply?: string;
  guardResult?: ReplyGuardResult;
  finalDecision: 'SEND_ALLOWED' | 'REPLY_BLOCKED' | 'IGNORED' | 'HUMAN_REQUIRED' | 'BLOCK_RECOMMENDED';
  timeWasterState?: TimeWasterState;
}

export class HumanFirewallCore {
  private pendingShadowTasks = new Set<Promise<void>>();

  constructor(
    private classifier: LLMClassifier,
    private generator: LLMReplyGenerator,
    private jevClassifier?: JevClassifier,
  ) {}

  /**
   * Test helper to cleanly await background shadow evaluations without blocking production flow.
   */
  public async waitForPendingShadowTasks(): Promise<void> {
    while (this.pendingShadowTasks.size > 0) {
      await Promise.all(Array.from(this.pendingShadowTasks));
    }
  }

  /**
   * Processes an incoming message:
   * 1. Classify via LLM (Gemini as Production Source of Truth)
   * 1.5 Shadow Mode: Classify via TypeSafe Jev in parallel/shadow, compare and record telemetry
   * 2. Generate candidate reply (if POLITE_REPLY or TIME_WASTER)
   * 3. Run candidate reply through Reply Guard (PII, URL, commitment filters)
   * 4. Return structured decision
   */
  public async processMessage(
    incomingMessage: string,
    threadHash: string,
    historySummary?: string,
    replyCount = 0,
  ): Promise<FirewallProcessResult> {
    const config = getConfig();

    if (config.JEV_ENABLED && !config.JEV_SHADOW_MODE) {
      throw new Error(
        'JEV_SHADOW_MODE=false is not supported yet. Jev production routing is not implemented.',
      );
    }

    // 1. Production Classification (Active Source of Truth)
    const classification = await this.classifier.classify(incomingMessage, historySummary);

    logEvent({
      event: 'CLASSIFIED',
      threadHash,
      category: classification.category,
      action: classification.action,
      risk: classification.risk,
      reason: classification.reason,
    });

    // 1.5 Shadow Evaluation: TypeSafe Jev (Observe Only, Non-Blocking)
    if (config.JEV_ENABLED && config.JEV_SHADOW_MODE && this.jevClassifier) {
      const jev = this.jevClassifier;
      const shadowTask = (async () => {
        try {
          const jevDecision = await jev.evaluate(incomingMessage, historySummary);
          const comparison = compareDecisions(threadHash, classification, jevDecision);
          renderComparisonSummary(comparison);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const jevDecision: JevDecision = {
            action: 'HUMAN_REQUIRED',
            category: 'UNKNOWN',
            risk: 80,
            reasonCode: 'JEV_API_ERROR',
            reason: `Jev shadow evaluation unexpected failure: ${msg}`,
            success: false,
          };
          compareDecisions(threadHash, classification, jevDecision);
        }
      })()
        .catch(() => {})
        .finally(() => {
          this.pendingShadowTasks.delete(shadowTask);
        });

      this.pendingShadowTasks.add(shadowTask);
    }

    // 2. Action branching
    if (classification.action === 'IGNORE') {
      return {
        classification,
        finalDecision: 'IGNORED',
      };
    }

    if (classification.action === 'HUMAN_REQUIRED') {
      logEvent({
        event: 'HUMAN_REQUIRED',
        threadHash,
        category: classification.category,
        action: classification.action,
        risk: classification.risk,
        reason: classification.reason,
      });
      return {
        classification,
        finalDecision: 'HUMAN_REQUIRED',
      };
    }

    if (classification.action === 'BLOCK_RECOMMENDED') {
      return {
        classification,
        finalDecision: 'BLOCK_RECOMMENDED',
      };
    }

    // 3. Reply Generation (POLITE_REPLY or TIME_WASTER)
    const replyAction: Extract<Action, 'POLITE_REPLY' | 'TIME_WASTER'> =
      classification.action === 'POLITE_REPLY' ? 'POLITE_REPLY' : 'TIME_WASTER';

    const timeWasterState = replyAction === 'TIME_WASTER' ? determineTimeWasterState(replyCount) : undefined;

    let reply = classification.reply;
    if (!reply || replyAction === 'TIME_WASTER') {
      reply = await this.generator.generateReply(replyAction, incomingMessage, historySummary, timeWasterState);
    }

    logEvent({
      event: 'REPLY_GENERATED',
      threadHash,
      action: replyAction,
      details: {
        replyLength: reply.length,
        step: 'REPLY_GENERATED',
        timeWasterState,
      },
    });

    // 4. Mandatory Pre-Send Gate: Reply Guard inspection
    const guardResult = inspectReply(reply);

    if (!guardResult.allowed) {
      logEvent({
        event: 'REPLY_BLOCKED',
        threadHash,
        details: {
          blockReason: guardResult.blockedReason,
          ruleTriggered: guardResult.ruleTriggered,
          timeWasterState,
        },
      });

      return {
        classification,
        candidateReply: reply,
        guardResult,
        finalDecision: 'REPLY_BLOCKED',
        timeWasterState,
      };
    }

    return {
      classification,
      candidateReply: reply,
      guardResult,
      finalDecision: 'SEND_ALLOWED',
      timeWasterState,
    };
  }
}
