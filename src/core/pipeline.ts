import type { Page } from 'playwright';
import { assertNotPaused } from './killswitch.js';
import { getConfig } from './config.js';
import type { HumanFirewallCore, FirewallProcessResult } from './firewall.js';
import type { ThreadStore } from './storage.js';
import { logEvent } from './logger.js';
import type { Action } from './types.js';
import { checkControlledReplyEligibility } from './controlled-limiter.js';
import { sendMessageToActiveThread } from '../channels/messenger/sender.js';

export interface PipelineExecutionOptions {
  threadId: string;
  threadHash: string;
  senderIdHash: string;
  lastMessageHash: string;
  incomingText: string;
  historySummary?: string;
  /**
   * True for threads opened from Message Requests. They have no composer (the requester must be
   * accepted first, which this tool never does), so a reply is never dispatched: triage only.
   */
  isRequestThread?: boolean;
  page?: Page;
}

export class FirewallPipeline {
  constructor(
    private firewall: HumanFirewallCore,
    private store: ThreadStore,
  ) {}

  /**
   * Executes the full pipeline for a detected message request.
   * Enforces Kill Switch -> Deduplication -> LLM Classification -> Reply Generation -> Reply Guard -> Controlled Send / Dry Run.
   */
  public async handleIncomingMessage(
    options: PipelineExecutionOptions,
  ): Promise<FirewallProcessResult | null> {
    const { threadId, threadHash, senderIdHash, lastMessageHash, incomingText, historySummary, page, isRequestThread } =
      options;
    const config = getConfig();

    // 1. Mandatory Kill Switch Gate
    assertNotPaused('Pipeline Execution');

    // 2. Duplicate Check
    if (this.store.isDuplicateMessage(threadHash, lastMessageHash)) {
      return null;
    }

    const existing = this.store.getThread(threadHash);
    const initialReplyCount = existing?.replyCount || 0;

    // 2.5 Daily LLM Request Quota Check (Hard Cap Against API Cost Explosion)
    const recentLlmCount = this.store.getRecentLlmRequestCount(24 * 60 * 60 * 1000);
    if (recentLlmCount >= config.MAX_LLM_REQUESTS_PER_DAY) {
      logEvent({
        event: 'RATE_LIMITED',
        threadHash,
        reasonCode: 'LLM_DAILY_QUOTA_EXCEEDED',
        details: {
          blockReason: `Daily LLM request limit reached (${recentLlmCount}/${config.MAX_LLM_REQUESTS_PER_DAY})`,
        },
      });

      const quotaResult: FirewallProcessResult = {
        classification: {
          category: 'UNKNOWN',
          action: 'HUMAN_REQUIRED',
          risk: 50,
          reason: `Daily LLM request quota reached (${recentLlmCount}/${config.MAX_LLM_REQUESTS_PER_DAY}). Escalated to human.`,
        },
        finalDecision: 'HUMAN_REQUIRED',
      };

      this.renderExecutionOutput(
        options,
        quotaResult,
        config.DRY_RUN,
        false,
        `Daily LLM quota exceeded (${recentLlmCount}/${config.MAX_LLM_REQUESTS_PER_DAY})`,
        initialReplyCount,
        config.CONTROLLED_MAX_REPLIES,
      );
      return quotaResult;
    }

    // 3. Process via Firewall Core (Classification + Generation + Reply Guard)
    let result: FirewallProcessResult;
    try {
      result = await this.firewall.processMessage(
        incomingText,
        threadHash,
        historySummary,
        initialReplyCount,
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isQuotaError = errMsg.includes('Daily LLM request quota reached');
      logEvent({
        event: isQuotaError ? 'RATE_LIMITED' : 'ERROR',
        threadHash,
        reasonCode: isQuotaError ? 'LLM_DAILY_QUOTA_EXCEEDED' : 'LLM_PROCESSING_ERROR',
      });

      result = {
        classification: {
          category: 'UNKNOWN',
          action: 'HUMAN_REQUIRED',
          risk: 80,
          reason: `LLM execution halted: ${errMsg}`,
        },
        finalDecision: 'HUMAN_REQUIRED',
      };
    }

    const now = Date.now();
    const messageCount = (existing?.messageCount || 0) + 1;
    let replyCount = initialReplyCount;

    // 4. Controlled Reply Decision
    let actuallySent = false;
    let controlledReason: string | undefined;

    if (!config.DRY_RUN && result.finalDecision === 'SEND_ALLOWED' && result.candidateReply && isRequestThread) {
      controlledReason =
        'REQUEST_THREAD_NO_COMPOSER: Message requests cannot be replied to without accepting them. Triage only; nothing was sent.';
      logEvent({
        event: 'RATE_LIMITED',
        threadHash,
        details: {
          blockReason: 'REQUEST_THREAD_NO_COMPOSER',
          messageCount: replyCount,
        },
      });
    } else if (!config.DRY_RUN && result.finalDecision === 'SEND_ALLOWED' && result.candidateReply && page) {
      const eligibility = checkControlledReplyEligibility(threadId, threadHash, this.store);

      if (eligibility.allowed) {
        assertNotPaused('Controlled Reply Pre-Send');
        try {
          await sendMessageToActiveThread(page, result.candidateReply, threadId);
          actuallySent = true;
          replyCount += 1;
          this.store.recordReply(threadHash, now);

          logEvent({
            event: 'REPLY_SENT',
            threadHash,
            action: result.classification.action,
            details: {
              step: 'DISPATCHED_TO_MESSENGER',
              messageCount: replyCount,
            },
          });
        } catch {
          // Fail closed and persist the message as handled. This is especially important for
          // Message Requests, whose real DOM has no composer until the user accepts the request.
          controlledReason = 'SEND_FAILED: Messenger dispatch unavailable; escalated to human.';
          result = {
            ...result,
            finalDecision: 'HUMAN_REQUIRED',
          };
          logEvent({
            event: 'HUMAN_REQUIRED',
            threadHash,
            action: result.classification.action,
            reasonCode: 'MESSENGER_SEND_FAILED',
            details: {
              statusMessage: 'Messenger dispatch unavailable; escalated to human.',
            },
          });
        }
      } else {
        controlledReason = eligibility.reason;
        logEvent({
          event: 'RATE_LIMITED',
          threadHash,
          details: {
            blockReason: eligibility.reason,
            messageCount: replyCount,
          },
        });
      }
    }

    // 5. Auto-pause thread if reply limit is reached (Only applies when actually sent, not dry run)
    const reachedLimit = replyCount >= config.CONTROLLED_MAX_REPLIES;
    const isPaused = (existing?.paused || false) || (!config.DRY_RUN && reachedLimit);

    this.store.upsertThread({
      threadId: threadHash,
      senderIdHash,
      firstSeen: existing?.firstSeen || now,
      lastSeen: now,
      lastMessageHash,
      mode: result.classification.action as Action,
      messageCount,
      replyCount,
      riskScore: result.classification.risk,
      paused: isPaused,
      humanRequired: result.finalDecision === 'HUMAN_REQUIRED',
    });

    // 6. Output Display
    this.renderExecutionOutput(options, result, config.DRY_RUN, actuallySent, controlledReason, replyCount, config.CONTROLLED_MAX_REPLIES);

    return result;
  }

  private renderExecutionOutput(
    options: PipelineExecutionOptions,
    result: FirewallProcessResult,
    isDryRun: boolean,
    actuallySent: boolean,
    controlledReason: string | undefined,
    currentCount: number,
    maxReplies: number,
  ): void {
    const isDebug = process.env.DEBUG === 'true';
    const reasonDisplay = isDebug
      ? result.classification.reason
      : `[MASKED: Set DEBUG=true to view rationale (${result.classification.category}_CLASSIFIED)]`;

    console.log('\n====================================================');
    console.log(`🛡️  FIREWALL INTERCEPTION & DECISION (${actuallySent ? 'LIVE SENT' : (isDryRun ? 'DRY RUN' : 'CONTROLLED BLOCKED')})`);
    console.log('====================================================');
    console.log(`[Thread ID Hash] : ${options.threadHash.slice(0, 16)}...`);
    console.log(`[Classification] : ${result.classification.category} (Risk: ${result.classification.risk}/100)`);
    console.log(`[Reason Code]    : ${reasonDisplay}`);
    console.log(`[Action Decided] : ${result.classification.action}${result.timeWasterState ? ` (Phase: ${result.timeWasterState})` : ''}`);

    if (options.isRequestThread) {
      console.log('[Request Thread] : 返信には承認が必要なため送信しません（トリアージ専用）');
    }

    if (result.candidateReply) {
      const replyDisplay = isDebug
        ? `「${result.candidateReply}」`
        : `[PROTECTED: ${result.candidateReply.length} chars (Set DEBUG=true to inspect candidate body)]`;

      console.log('----------------------------------------------------');
      console.log(`💬 Candidate Reply (${actuallySent ? '✅ SENT TO MESSENGER' : 'NOT SENT'}):`);
      console.log(`   ${replyDisplay}`);
      console.log('----------------------------------------------------');
    }

    console.log(`[Reply Guard]    : ${result.guardResult ? (result.guardResult.allowed ? 'PASSED (Clean)' : `BLOCKED (${result.guardResult.ruleTriggered}: ${result.guardResult.blockedReason})`) : 'NOT_APPLICABLE'}`);
    console.log(`[Replies Counter]: ${currentCount} / ${maxReplies} (Limit per thread)`);

    if (controlledReason) {
      console.log(`[Controlled Gate]: BLOCKED -> ${controlledReason}`);
    }

    console.log(`[Execution Mode] : ${isDryRun ? 'DRY_RUN=true (Console only)' : (actuallySent ? 'LIVE_DISPATCHED' : 'CONTROLLED_HELD')}`);
    console.log('====================================================\n');
  }
}
