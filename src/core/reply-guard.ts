export interface ReplyGuardResult {
  allowed: boolean;
  blockedReason?: string;
  ruleTriggered?: string;
}

interface GuardRule {
  name: string;
  pattern: RegExp;
  reason: string;
}

const GUARD_RULES: GuardRule[] = [
  // 1. Email addresses
  {
    name: 'EMAIL_DETECTED',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i,
    reason: 'Detected potential email address in generated reply.',
  },

  // 2. Phone numbers (Japan and International formats)
  {
    name: 'PHONE_NUMBER_DETECTED',
    pattern: /(?:\+?81[- ]?|0)(?:[789]0[- ]?\d{4}[- ]?\d{4}|[1-9]\d{0,3}[- ]?\d{1,4}[- ]?\d{4})/,
    reason: 'Detected telephone number format in generated reply.',
  },

  // 3. Postal codes and Japanese residential address patterns
  {
    name: 'POSTAL_CODE_OR_ADDRESS_DETECTED',
    pattern: /〒?\d{3}[-‐ー]\d{4}|(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県)(?:[^\d\s]{1,6}(?:市|区|町|村|郡))/,
    reason: 'Detected postal code or residential address pattern in generated reply.',
  },

  // 4. External URLs or links
  {
    name: 'URL_DETECTED',
    pattern: /https?:\/\/[^\s]+|www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}|[a-zA-Z0-9-]+\.(?:com|org|net|io|jp|me|app|xyz|top|site|cc|info)\b/i,
    reason: 'Detected external URL or link pattern in generated reply.',
  },

  // 5. Credit Card numbers
  {
    name: 'CREDIT_CARD_DETECTED',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12})\b/,
    reason: 'Detected possible credit card number pattern.',
  },

  // 6. Bank account, password, authentication codes
  {
    name: 'CREDENTIAL_OR_BANK_DETECTED',
    pattern: /(口座番号|暗証番号|パスワード|password|認証コード|確認コード|ワンタイムパスワード|otp|security code)/i,
    reason: 'Detected credential, bank account, or OTP reference.',
  },

  // 7. Meeting commitments (面会・訪問の約束)
  {
    name: 'MEETING_COMMITMENT_DETECTED',
    pattern: /(会いましょう|会えます|伺います|待ち合わせ|お会いできる|お会いしましょう|訪問します|面談しましょう|オフラインで会|対面で会)/,
    reason: 'Detected meeting or in-person commitment.',
  },

  // 8. Payment, purchase, and contract commitments (金銭・契約・購入合意)
  {
    name: 'FINANCIAL_COMMITMENT_DETECTED',
    pattern: /(支払います|振り込みます|送金します|買います|購入します|契約します|申し込みます|契約に応じ|参加します|購入手続き|送金完了)/,
    reason: 'Detected financial commitment, purchase, or contract agreement.',
  },
];

/**
 * Validates a candidate reply before sending to Messenger.
 * Returns allowed: true only if ALL rules pass.
 */
export function inspectReply(text: string): ReplyGuardResult {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return {
      allowed: false,
      blockedReason: 'Reply text is empty or invalid.',
      ruleTriggered: 'EMPTY_REPLY',
    };
  }

  for (const rule of GUARD_RULES) {
    if (rule.pattern.test(text)) {
      return {
        allowed: false,
        blockedReason: rule.reason,
        ruleTriggered: rule.name,
      };
    }
  }

  return { allowed: true };
}
