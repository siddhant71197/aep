import { describe, expect, it } from 'vitest';
import { dedupeReplays } from '@/lib/llm';

async function run(chunks: string[]): Promise<string> {
  async function* src() {
    for (const c of chunks) yield c;
  }
  let out = '';
  for await (const c of dedupeReplays(src())) out += c;
  return out;
}

const A = 'Hello! I am AEP Guide, your Medicare helper. What plan do you have now?';

describe('dedupeReplays', () => {
  it('passes normal streams through unchanged', async () => {
    expect(await run(['', 'Hello! I am ', 'AEP Guide, your Medicare helper.', ' What plan do you have now?'])).toBe(A);
  });

  it('drops a full replay with different chunking', async () => {
    expect(await run([A.slice(0, 12), A.slice(12), A.slice(0, 36), A.slice(36, 60), A.slice(60)])).toBe(A);
  });

  it('drops multiple and truncated replays', async () => {
    expect(await run([A, A.slice(0, 40), A.slice(0, 25), A, A.slice(0, 10)])).toBe(A);
  });

  it('keeps new text that follows a completed replay', async () => {
    expect(await run([A, A, ' Extra line.'])).toBe(A + ' Extra line.');
  });

  it('does not treat short early chunks as replays', async () => {
    expect(await run(['1 2 ', '1 2 3'])).toBe('1 2 1 2 3');
  });

  it('keeps the tag tail when the first copy is complete', async () => {
    const full = A + '\n<profile>{"zip":"10001"}</profile>';
    expect(await run([full.slice(0, 50), full.slice(50), full.slice(0, 70)])).toBe(full);
  });
});

describe('dedupeReplays divergence', () => {
  it('releases held text that only looked like a replay', async () => {
    const intro = 'Here are your options for next year:';
    const out = await run([intro + ' plan A. ', intro.slice(0, 20), ' — and also plan B.']);
    expect(out).toBe(intro + ' plan A. ' + intro.slice(0, 20) + ' — and also plan B.');
  });
});
