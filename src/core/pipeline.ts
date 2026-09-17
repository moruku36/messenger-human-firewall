import { assertNotPaused } from './killswitch.js';
import { getConfig } from './config.js';
import type { HumanFirewallCore, FirewallProcessResult } from './firewall.js';
import type { ThreadStore } from './storage.js';
import { logEvent } from './logger.js';
import type { Action } from './types.js';

export interface PipelineExecutionOptions {
  threadId: string;
  threadHash: string;
  senderIdHash: string;
  lastMessageHash: string;
  incomingText: string;
  historySummary?: string;
}

export class FirewallPipeline {
  constructor(
    private firewall: HumanFirewallCore,
    private store: ThreadStore,
  ) {}

  /**
   * Executes the full pipeline for a detected message request.
   * Enforces Kill Switch -> Deduplication -> LLM Classification -> Reply Generation -> Reply Guard -> Dry Run Output.
   */
  public async handleIncomingMessage(
    options: PipelineExecutionOptions,
  ): Promise<FirewallProcessResult | null> {
    const { threadHash, senderIdHash, lastMessageHash, incomingText, historySummary } = options;
    const config = getConfig();

    // 1. Mandatory Kill Switch Gate
    assertNotPaused('Pipeline Execution');

    // 2. Duplicate Check
    if (this.store.isDuplicateMessage(threadHash, lastMessageHash)) {
      return null;
    }

    // 3. Process via Firewall Core (Classification + Generation + Reply Guard)
    const result = await this.firewall.processMessage(incomingText, threadHash, historySummary);

    // 4. Update SQLite State Store (never storing raw incoming or outgoing message text)
    const existing = this.store.getThread(threadHash);
    const now = Date.now();

    this.store.upsertThread({
      threadId: threadHash,
      senderIdHash,
      firstSeen: existing?.firstSeen || now,
      lastSeen: now,
      lastMessageHash,
      mode: result.classification.action as Action,
      messageCount: (existing?.messageCount || 0) + 1,
      riskScore: result.classification.risk,
      paused: existing?.paused || false,
      humanRequired: result.finalDecision === 'HUMAN_REQUIRED',
    });

    // 5. Output Display (Dry Run Mode)
    this.renderDryRunOutput(options, result, config.DRY_RUN);

    return result;
  }

  private renderDryRunOutput(
    options: PipelineExecutionOptions,
    result: FirewallProcessResult,
    isDryRun: boolean,
  ): void {
    console.log('\n====================================================');
    console.log('🛡️  FIREWALL INTERCEPTION & DECISION (DRY RUN)');
    console.log('====================================================');
    console.log(`[Thread ID Hash] : ${options.threadHash.slice(0, 16)}...`);
    console.log(`[Classification] : ${result.classification.category} (Risk: ${result.classification.risk}/100)`);
    console.log(`[Reason]         : ${result.classification.reason}`);
    console.log(`[Action Decided] : ${result.classification.action}`);

    if (result.candidateReply) {
      console.log('----------------------------------------------------');
      console.log('💬 Generated Candidate Reply:');
      console.log(`   「${result.candidateReply}」`);
      console.log('----------------------------------------------------');
    }

    console.log(`[Reply Guard]    : ${result.guardResult ? (result.guardResult.allowed ? 'PASSED (Clean)' : `BLOCKED (${result.guardResult.ruleTriggered}: ${result.guardResult.blockedReason})`) : 'NOT_APPLICABLE'}`);
    console.log(`[Final Action]   : ${result.finalDecision}`);
    console.log(`[Execution Mode] : ${isDryRun ? 'DRY_RUN=true (NO actual reply sent to Messenger)' : 'LIVE (Controlled Reply)'}`);
    console.log('====================================================\n');

    if (result.finalDecision === 'SEND_ALLOWED') {
      logEvent({
        event: 'REPLY_SENT',
        threadHash: options.threadHash,
        action: result.classification.action,
        details: {
          step: isDryRun ? 'DRY_RUN_LOGGED' : 'SENT_TO_BROWSER',
        },
      });
    }
  }
}
