// Card: 13–16 digits, optional single space/dash between digits. SSN: ddd-dd-dddd.
// SSNs are replaced first so their digits can't be swallowed by the card pattern.
const SSN = /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g;
const CARD = /(?<!\d)\d(?:[ -]?\d){12,15}(?!\d)/g;

export function redactPII(text: string): { text: string; count: number } {
  let count = 0;
  const out = text
    .replace(SSN, () => (count++, '[REDACTED_SSN]'))
    .replace(CARD, () => (count++, '[REDACTED_CARD]'));
  return { text: out, count };
}
