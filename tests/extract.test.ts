import { describe, it, expect } from 'vitest';
import { extractTicket, formatUserMessage, parseExtraction } from '../src/lib/extract';
import { MockModel } from '../src/lib/model';

const VALID = '{"intent":"refund_request","order_id":"ord-1001","reason":"changed_mind","injection_detected":false}';
const EXPECTED = { intent: 'refund_request', order_id: 'ORD-1001', reason: 'changed_mind', injection_detected: false };
const fast = { system: 's', user: 'u', timeoutMs: 50, backoffMs: 1 };

describe('extractTicket', () => {
  it('parses valid JSON in one attempt and uppercases the order id', async () => {
    const model = new MockModel([{ text: VALID, input_tokens: 10, output_tokens: 5 }]);
    const { extraction, attempts } = await extractTicket({ model, ...fast });
    expect(extraction).toEqual(EXPECTED);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ attempt: 1, status: 'ok', input_tokens: 10, output_tokens: 5 });
  });

  it('parses JSON wrapped in a Markdown code fence', async () => {
    const model = new MockModel([{ text: '```json\n' + VALID + '\n```' }]);
    const { extraction } = await extractTicket({ model, ...fast });
    expect(extraction).toEqual(EXPECTED);
  });

  it('retries after invalid JSON and succeeds (2 attempts)', async () => {
    const model = new MockModel([{ text: 'not json at all' }, { text: VALID }]);
    const { extraction, attempts } = await extractTicket({ model, ...fast });
    expect(extraction).toEqual(EXPECTED);
    expect(attempts.map((a) => a.status)).toEqual(['error', 'ok']);
  });

  it('retries after an enum outside the schema and succeeds (2 attempts)', async () => {
    const bad = '{"intent":"complaint","order_id":null,"reason":null,"injection_detected":false}';
    const model = new MockModel([{ text: bad }, { text: VALID }]);
    const { extraction, attempts } = await extractTicket({ model, ...fast });
    expect(extraction).toEqual(EXPECTED);
    expect(attempts).toHaveLength(2);
  });

  it('returns null after two timeouts', async () => {
    const model = new MockModel([
      { text: VALID, delayMs: 500 },
      { text: VALID, delayMs: 500 },
    ]);
    const { extraction, attempts } = await extractTicket({ model, ...fast });
    expect(extraction).toBeNull();
    expect(attempts).toHaveLength(2);
    expect(attempts[0].error).toMatch(/timed out/);
  });

  it('retries on HTTP 500 and succeeds', async () => {
    const model = new MockModel([{ httpStatus: 500 }, { text: VALID }]);
    const { extraction, attempts } = await extractTicket({ model, ...fast });
    expect(extraction).toEqual(EXPECTED);
    expect(attempts).toHaveLength(2);
  });

  it('retries on HTTP 429', async () => {
    const model = new MockModel([{ httpStatus: 429 }, { text: VALID }]);
    const { extraction } = await extractTicket({ model, ...fast });
    expect(extraction).toEqual(EXPECTED);
  });

  it('does not retry HTTP 401: null after exactly 1 attempt', async () => {
    const model = new MockModel([{ httpStatus: 401 }, { text: VALID }]);
    const { extraction, attempts } = await extractTicket({ model, ...fast });
    expect(extraction).toBeNull();
    expect(attempts).toHaveLength(1);
    expect(model.calls).toBe(1);
  });
});

describe('parseExtraction / formatUserMessage', () => {
  it('extracts the JSON object from surrounding prose', () => {
    expect(parseExtraction(`Sure! ${VALID} Hope that helps.`)).toEqual(EXPECTED);
  });

  it('keeps a null order_id as null', () => {
    const text = '{"intent":"other","order_id":null,"reason":null,"injection_detected":false}';
    expect(parseExtraction(text).order_id).toBeNull();
  });

  it('formats the user message exactly', () => {
    expect(formatUserMessage('a@b.com', 'Hi', 'body text')).toBe(
      'FROM: a@b.com\nSUBJECT: Hi\nBODY:\n<<<\nbody text\n>>>',
    );
  });
});
