import type { ClassificationResult } from '../types/index.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMProvider {
  name: string;
  classifyAndReply(
    incomingMessage: string,
    conversationHistory?: string[],
  ): Promise<ClassificationResult>;
}
