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

/**
 * Adapter converting Jev's typed security decision into the core ClassificationResult.
 * Preserves deterministic security decisions without exposing internal Jev structures to generic pipelines.
 */
export function jevDecisionToClassification(decision: JevDecision): ClassificationResult {
  switch (decision.action) {
    case 'IGNORE':
      return {
        category: decision.category,
        action: 'IGNORE',
        risk: decision.risk,
        reason: decision.reason,
      };
    case 'HUMAN_REQUIRED':
      return {
        category: decision.category,
        action: 'HUMAN_REQUIRED',
        risk: decision.risk,
        reason: decision.reason,
      };
    case 'BLOCK_RECOMMENDED':
      return {
        category: decision.category,
        action: 'BLOCK_RECOMMENDED',
        risk: decision.risk,
        reason: decision.reason,
      };
    case 'POLITE_REPLY':
      return {
        category: decision.category,
        action: 'POLITE_REPLY',
        risk: decision.risk,
        reason: decision.reason,
        reply: 'どのようなご用件でしょうか？',
      };
    case 'TIME_WASTER':
      return {
        category: decision.category,
        action: 'TIME_WASTER',
        risk: decision.risk,
        reason: decision.reason,
        reply: '具体的にどのようなお話でしょうか？詳しく教えていただけますか？',
      };
    default: {
      const _exhaustive: never = decision.action;
      return {
        category: 'UNKNOWN',
        action: 'HUMAN_REQUIRED',
        risk: 80,
        reason: `Unrecognized Jev action: ${String(_exhaustive)}`,
      };
    }
  }
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
   * Modes:
   * 1. Active Jev Mode (JEV_ENABLED=true, JEV_SHADOW_MODE=false):
   *    - TypeSafe Jev is Production Source of Truth for classification.
   *    - Gemini is never called for classification.
   *    - Gemini is invoked strictly for reply generation (POLITE_REPLY / TIME_WASTER).
   * 2. Shadow Mode (JEV_ENABLED=true, JEV_SHADOW_MODE=true):
   *    - Gemini classifies in production.
   *    - TypeSafe Jev evaluates concurrently in non-blocking shadow observation.
   * 3. Legacy Mode (JEV_ENABLED=false):
   *    - Legacy Gemini classification only.
   */
  public async processMessage(
    incomingMessage: string,
    threadHash: string,
    historySummary?: string,
    replyCount = 0,
  ): Promise<FirewallProcessResult> {
    const config = getConfig();

    let classification: ClassificationResult;

    // 1. Classification Routing
    if (config.JEV_ENABLED && !config.JEV_SHADOW_MODE) {
      // Active Jev Production Triage
      if (!this.jevClassifier) {
        throw new Error('JevClassifier instance is required when JEV_ENABLED=true and JEV_SHADOW_MODE=false.');
      }

      const jevDecision = await this.jevClassifier.evaluate(incomingMessage, historySummary);
      classification = jevDecisionToClassification(jevDecision);

      logEvent({
        event: 'CLASSIFIED',
        threadHash,
        category: classification.category,
        action: classification.action,
        risk: classification.risk,
        reasonCode: jevDecision.reasonCode,
        reason: classification.reason,
        details: {
          classifierSource: 'jev',
          jevCategory: jevDecision.category,
          jevAction: jevDecision.action,
          jevConfidence: jevDecision.signals?.categoryConfidence,
          jevLatencyMs: jevDecision.latencyMs,
          jevSuccess: jevDecision.success,
          jevReasonCode: jevDecision.reasonCode,
          triggeredSignals: jevDecision.triggeredSignals ? jevDecision.triggeredSignals.join(', ') : undefined,
          primarySignal: jevDecision.primarySignal,
        },
      });
    } else {
      // Legacy or Shadow Mode: Gemini is production source of truth for classification
      classification = await this.classifier.classify(incomingMessage, historySummary);

      logEvent({
        event: 'CLASSIFIED',
        threadHash,
        category: classification.category,
        action: classification.action,
        risk: classification.risk,
        reason: classification.reason,
        details: {
          classifierSource: 'gemini',
        },
      });

      // Shadow Mode: Evaluate Jev in parallel non-blocking background task
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

    let reply: string;
    const isJevActive = config.JEV_ENABLED && !config.JEV_SHADOW_MODE;
    // In Legacy or Shadow mode, reuse existing classification.reply for POLITE_REPLY to prevent duplicate Gemini calls
    if (!isJevActive && replyAction === 'POLITE_REPLY' && classification.reply) {
      reply = classification.reply;
    } else {
      try {
        reply = await this.generator.generateReply(replyAction, incomingMessage, historySummary, timeWasterState);
      } catch {
        logEvent({
          event: 'ERROR',
          threadHash,
          category: classification.category,
          action: 'HUMAN_REQUIRED',
          risk: 80,
          reasonCode: 'REPLY_GENERATION_FAILED',
          reason: 'Reply generation failed. Escalating to human.',
          details: {
            statusMessage: 'Reply generation failed; escalated to human.',
          },
        });

        return {
          classification,
          finalDecision: 'HUMAN_REQUIRED',
          timeWasterState,
        };
      }
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
