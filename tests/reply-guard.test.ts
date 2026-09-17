import { describe, expect, it } from 'vitest';
import { inspectReply } from '../src/core/reply-guard.js';

describe('Reply Guard Pre-Send Gate', () => {
  it('allows safe Receptionist and Time Waster replies', () => {
    const receptionistReply = 'こんにちは。どのようなご用件でしょうか？';
    const timeWasterReply = 'なるほど、それはどういう仕組みなんですか？もう少し詳しく教えてもらえますか？';

    expect(inspectReply(receptionistReply).allowed).toBe(true);
    expect(inspectReply(timeWasterReply).allowed).toBe(true);
  });

  it('blocks empty or whitespace-only replies', () => {
    expect(inspectReply('').allowed).toBe(false);
    expect(inspectReply('   ').allowed).toBe(false);
  });

  it('blocks email addresses', () => {
    const reply = 'こちらのアドレスに連絡してください: test-user@example.com';
    const res = inspectReply(reply);
    expect(res.allowed).toBe(false);
    expect(res.ruleTriggered).toBe('EMAIL_DETECTED');
  });

  it('blocks Japanese and international phone numbers', () => {
    const res1 = inspectReply('私の番号は 090-1234-5678 です。');
    expect(res1.allowed).toBe(false);
    expect(res1.ruleTriggered).toBe('PHONE_NUMBER_DETECTED');

    const res2 = inspectReply('Call me at +81-3-1234-5678');
    expect(res2.allowed).toBe(false);
    expect(res2.ruleTriggered).toBe('PHONE_NUMBER_DETECTED');
  });

  it('blocks postal codes and physical addresses', () => {
    const res1 = inspectReply('住所は 〒100-0001 です。');
    expect(res1.allowed).toBe(false);
    expect(res1.ruleTriggered).toBe('POSTAL_CODE_OR_ADDRESS_DETECTED');

    const res2 = inspectReply('東京都千代田区千代田1-1まで来てください。');
    expect(res2.allowed).toBe(false);
    expect(res2.ruleTriggered).toBe('POSTAL_CODE_OR_ADDRESS_DETECTED');
  });

  it('blocks external URLs and links', () => {
    const res1 = inspectReply('こちらのリンクをご覧ください: https://evil-phishing.com/login');
    expect(res1.allowed).toBe(false);
    expect(res1.ruleTriggered).toBe('URL_DETECTED');

    const res2 = inspectReply('詳細は www.example.org を参照してください。');
    expect(res2.allowed).toBe(false);
    expect(res2.ruleTriggered).toBe('URL_DETECTED');
  });

  it('blocks credential, bank, and authentication requests/responses', () => {
    const res1 = inspectReply('口座番号を教えてください。');
    expect(res1.allowed).toBe(false);
    expect(res1.ruleTriggered).toBe('CREDENTIAL_OR_BANK_DETECTED');

    const res2 = inspectReply('認証コードを送ります。');
    expect(res2.allowed).toBe(false);
    expect(res2.ruleTriggered).toBe('CREDENTIAL_OR_BANK_DETECTED');
  });

  it('blocks meeting and in-person commitments', () => {
    const res1 = inspectReply('ぜひ明日お会いしましょう。');
    expect(res1.allowed).toBe(false);
    expect(res1.ruleTriggered).toBe('MEETING_COMMITMENT_DETECTED');

    const res2 = inspectReply('来週水曜日にオフィスへ伺います。');
    expect(res2.allowed).toBe(false);
    expect(res2.ruleTriggered).toBe('MEETING_COMMITMENT_DETECTED');
  });

  it('blocks financial commitments and purchase/contract agreements', () => {
    const res1 = inspectReply('そのプランに申し込みます！');
    expect(res1.allowed).toBe(false);
    expect(res1.ruleTriggered).toBe('FINANCIAL_COMMITMENT_DETECTED');

    const res2 = inspectReply('今すぐ指定口座へ振り込みます。');
    expect(res2.allowed).toBe(false);
    expect(res2.ruleTriggered).toBe('FINANCIAL_COMMITMENT_DETECTED');
  });
});
