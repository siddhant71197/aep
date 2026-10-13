import { describe, expect, it } from 'vitest';
import { TagStreamParser, type ParsedPiece } from '@/lib/streamParser';

function run(chunks: string[]) {
  const p = new TagStreamParser();
  const pieces: ParsedPiece[] = [];
  for (const c of chunks) pieces.push(...p.push(c));
  pieces.push(...p.end());
  for (const x of pieces) if (x.kind === 'text') expect(x.text.length).toBeGreaterThan(0);
  const text = pieces.filter((x) => x.kind === 'text').map((x) => (x as { text: string }).text).join('');
  const tags = pieces.filter((x) => x.kind === 'tag') as Extract<ParsedPiece, { kind: 'tag' }>[];
  return { text, tags };
}

const SAMPLE =
  'Hi there <profile>{"zip":"10001"}</profile><plan_suggestions>{"suggestions":[]}</plan_suggestions>';

describe('TagStreamParser', () => {
  it('handles a split at every index', () => {
    for (let i = 0; i <= SAMPLE.length; i++) {
      const { text, tags } = run([SAMPLE.slice(0, i), SAMPLE.slice(i)]);
      expect(text, `split ${i}`).toBe('Hi there ');
      expect(tags).toEqual([
        { kind: 'tag', name: 'profile', body: '{"zip":"10001"}' },
        { kind: 'tag', name: 'plan_suggestions', body: '{"suggestions":[]}' },
      ]);
    }
  });

  it('handles 1-char chunks', () => {
    const { text, tags } = run(SAMPLE.split(''));
    expect(text).toBe('Hi there ');
    expect(tags.map((t) => t.name)).toEqual(['profile', 'plan_suggestions']);
    expect(tags[0].body).toBe('{"zip":"10001"}');
  });

  it('passes a literal < through as text', () => {
    const s = 'A plan cost < $50 and a <b>bold</b> <pro word<profile>{}</profile>';
    const { text, tags } = run(s.split(''));
    expect(text).toBe('A plan cost < $50 and a <b>bold</b> <pro word');
    expect(tags).toEqual([{ kind: 'tag', name: 'profile', body: '{}' }]);
  });

  it('keeps a trailing partial "<" that never becomes a tag', () => {
    expect(run(['cost <']).text).toBe('cost <');
    expect(run(['ends with <prof']).text).toBe('ends with <prof');
  });

  it('emits an unterminated tag as a tag, not text', () => {
    const { text, tags } = run(['Hello <profile>{"zip":"9', '0210"}</prof']);
    expect(text).toBe('Hello ');
    expect(tags).toEqual([{ kind: 'tag', name: 'profile', body: '{"zip":"90210"}' }]);
  });

  it('strips ```json fences from bodies', () => {
    const { tags } = run(['x<plan_suggestions>\n```json\n{"suggestions":[]}\n```\n</plan_suggestions>']);
    expect(tags[0].body).toBe('{"suggestions":[]}');
    const { tags: t2 } = run(['<profile>```{"a":1}```</profile>']);
    expect(t2[0].body).toBe('{"a":1}');
  });

  it('handles tags in reverse order', () => {
    const s = 'Text<plan_suggestions>[1]</plan_suggestions>\n<profile>{}</profile>';
    for (let i = 0; i <= s.length; i++) {
      const { text, tags } = run([s.slice(0, i), s.slice(i)]);
      expect(text).toBe('Text\n');
      expect(tags.map((t) => t.name)).toEqual(['plan_suggestions', 'profile']);
    }
  });
});
