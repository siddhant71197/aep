import { describe, expect, it } from 'vitest';
import { encodeEvent, readNdjson } from '@/lib/ndjson';
import type { StreamEvent } from '@/lib/types';

const events: StreamEvent[] = [
  { type: 'meta', userTurn: 1, mustSuggest: false, profileSufficient: false },
  { type: 'text', delta: 'Hello — “unicode” ✓\nnew line' },
  { type: 'profile', profile: { zip: '10001', drugs: ['metformin'] } },
  { type: 'error', message: 'oops' },
  { type: 'done' },
];

function streamFrom(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
}

async function collect(s: ReadableStream<Uint8Array>) {
  const out: StreamEvent[] = [];
  for await (const e of readNdjson(s)) out.push(e);
  return out;
}

describe('ndjson', () => {
  it('encodes with trailing newline', () => {
    expect(new TextDecoder().decode(encodeEvent({ type: 'done' }))).toBe('{"type":"done"}\n');
  });

  it('round-trips when split at every byte offset', async () => {
    const parts = events.map(encodeEvent);
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) {
      all.set(p, off);
      off += p.length;
    }
    for (let i = 0; i <= all.length; i += 3) {
      const got = await collect(streamFrom([all.slice(0, i), all.slice(i)]));
      expect(got).toEqual(events);
    }
    // byte-by-byte (splits multi-byte UTF-8 chars)
    const bytes = Array.from(all, (b) => new Uint8Array([b]));
    expect(await collect(streamFrom(bytes))).toEqual(events);
  });

  it('handles a final line without newline', async () => {
    const got = await collect(streamFrom([new TextEncoder().encode('{"type":"done"}')]));
    expect(got).toEqual([{ type: 'done' }]);
  });
});
