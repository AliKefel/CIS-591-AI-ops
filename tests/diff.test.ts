import { describe, it, expect } from 'vitest';
import { diffLines } from '../src/lib/diff';

describe('diffLines', () => {
  it('marks identical text as unchanged', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: 'b' },
    ]);
  });

  it('detects an added line', () => {
    expect(diffLines('a\nc', 'a\nb\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'add', text: 'b' },
      { type: 'same', text: 'c' },
    ]);
  });

  it('detects a removed line', () => {
    expect(diffLines('a\nb\nc', 'a\nc').map((l) => l.type)).toEqual(['same', 'del', 'same']);
  });

  it('shows a replaced line as a removal plus an addition', () => {
    const d = diffLines('one\ntwo', 'one\n2');
    expect(d.filter((l) => l.type === 'del').map((l) => l.text)).toEqual(['two']);
    expect(d.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['2']);
  });
});
