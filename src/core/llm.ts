import type { Action, ClassificationResult } from './types.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMClassifier {
  name: string;
  classify(
    incomingMessage: string,
    historySummary?: string,
  ): Promise<ClassificationResult>;
}

export interface LLMReplyGenerator {
  name: string;
  generateReply(
    action: Extract<Action, 'POLITE_REPLY' | 'TIME_WASTER'>,
    incomingMessage: string,
    historySummary?: string,
    timeWasterState?: string,
  ): Promise<string>;
}

export interface LLMProvider {
  classifier: LLMClassifier;
  generator: LLMReplyGenerator;
}
