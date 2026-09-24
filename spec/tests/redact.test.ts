// Acceptance tests for PII redaction (SPEC §7.4). Do not edit.
import { describe, it, expect } from 'vitest';
import { redactPII } from '../../src/lib/redact';

describe('redactPII', () => {
  it('redacts a 16-digit card number with spaces', () => {
    expect(redactPII('My card is 4111 1111 1111 1111 thanks')).toEqual({
      text: 'My card is [REDACTED_CARD] thanks',
      count: 1,
    });
  });

  it('redacts a card number with dashes', () => {
    expect(redactPII('Use 4111-1111-1111-1111 please')).toEqual({
      text: 'Use [REDACTED_CARD] please',
      count: 1,
    });
  });

  it('redacts a card number with no separators', () => {
    expect(redactPII('4111111111111111')).toEqual({ text: '[REDACTED_CARD]', count: 1 });
  });

  it('redacts a 15-digit card number', () => {
    expect(redactPII('Amex 3782 822463 10005 on file')).toEqual({
      text: 'Amex [REDACTED_CARD] on file',
      count: 1,
    });
  });

  it('redacts a US SSN', () => {
    expect(redactPII('My SSN is 123-45-6789.')).toEqual({
      text: 'My SSN is [REDACTED_SSN].',
      count: 1,
    });
  });

  it('redacts multiple items and counts them', () => {
    expect(redactPII('Card 4111111111111111 and SSN 123-45-6789')).toEqual({
      text: 'Card [REDACTED_CARD] and SSN [REDACTED_SSN]',
      count: 2,
    });
  });

  it('leaves order IDs, prices, dates, and phone numbers alone', () => {
    const text = 'Order ORD-1042 cost $129.00 on 2026-09-01. Call (555) 010-0199.';
    expect(redactPII(text)).toEqual({ text, count: 0 });
  });

  it('does not redact numbers with 12 or fewer digits', () => {
    const text = 'Tracking number 123456789012';
    expect(redactPII(text)).toEqual({ text, count: 0 });
  });

  it('handles an empty string', () => {
    expect(redactPII('')).toEqual({ text: '', count: 0 });
  });
});
