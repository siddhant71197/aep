import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, StreamEvent, UserProfile } from '@/lib/types';

// Never call Replicate from tests.
vi.mock('@/lib/llm', () => ({ streamLLM: vi.fn() }));

const { streamLLM } = await import('@/lib/llm');
const { POST } = await import('@/app/api/chat/route');
const { readNdjson } = await import('@/lib/ndjson');
const mockLLM = vi.mocked(streamLLM);

function chunks(...parts: string[]): AsyncIterable<string> {
  return (async function* () {
    for (const p of parts) yield p;
  })();
}

async function post(body: unknown) {
  const res = await POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const events: StreamEvent[] = [];
  if (res.body) for await (const e of readNdjson(res.body)) events.push(e);
  const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
  return { res, events, text };
}

let n = 0;
const user = (content: string): ChatMessage => ({ id: `u${n++}`, role: 'user', content, createdAt: n });
const bot = (content: string): ChatMessage => ({ id: `a${n++}`, role: 'assistant', content, createdAt: n });

// Third user message with no prior suggestions => mustSuggest.
const mustSuggestMessages = [user('hello'), bot('Hi!'), user('I have questions'), bot('Sure.'), user('What can I change?')];
const profile: UserProfile = { zip: '33101', currentCarrier: 'Acme' };

beforeEach(() => {
  mockLLM.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/chat', () => {
  it('(a) start request streams the Gemini greeting and done, with no suggestions', async () => {
    mockLLM.mockImplementation(() =>
      chunks('Hi, I’m AEP Guide! ', 'What plan are you on today?', '<profile>{}</profile>', '<plan_suggestions>{"suggestions":["fl-hmo-sunshine"]}</plan_suggestions>'),
    );
    const { res, events, text } = await post({ messages: [], profile: {}, start: true });
    expect(res.status).toBe(200);
    expect(text).toBe('Hi, I’m AEP Guide! What plan are you on today?');
    expect(events[0]).toMatchObject({ type: 'meta', userTurn: 0, mustSuggest: false, profileSufficient: false });
    expect(events.some((e) => e.type === 'suggestions')).toBe(false);
    expect(events[events.length - 1]).toEqual({ type: 'done' });
    expect(mockLLM).toHaveBeenCalledTimes(1);
    expect(mockLLM.mock.calls[0][0]).toContain('This is the opening message.');
  });

  it('validates start / empty-message requests', async () => {
    expect((await post({ messages: [], profile: {} })).res.status).toBe(400);
    expect((await post({ messages: [user('hi')], profile: {}, start: true })).res.status).toBe(400);
    expect((await post({ messages: [user('hi'), bot('yo')], profile: {} })).res.status).toBe(400);
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it('(b) mustSuggest without tags triggers one follow-up Gemini call whose suggestions are used', async () => {
    mockLLM
      .mockImplementationOnce(() => chunks('During AEP you can ', 'switch plans.', '<profile>{"wantsToChange":"UNSURE"}</profile>'))
      .mockImplementationOnce(() =>
        chunks(
          '\n\nHere are two alternatives to compare against your current plan.',
          '<plan_suggestions>{"suggestions":[{"planId":"fl-hmo-sunshine","reason":"Low premium"},{"planId":"nope","reason":"x"}]}</plan_suggestions>',
        ),
      );
    const { events, text } = await post({ messages: mustSuggestMessages, profile });
    expect(mockLLM).toHaveBeenCalledTimes(2);
    const followPrompt = mockLLM.mock.calls[1][0];
    expect(followPrompt).toContain('## YOUR REPLY SO FAR\nDuring AEP you can switch plans.');
    expect(followPrompt).toContain('"currentCarrier":"Acme"');
    expect(text).toBe('During AEP you can switch plans.\n\nHere are two alternatives to compare against your current plan.');
    const sug = events.find((e) => e.type === 'suggestions');
    expect(sug).toMatchObject({ type: 'suggestions', source: 'model' });
    expect(sug && sug.type === 'suggestions' && sug.items.map((i) => i.planId)).toEqual(['fl-hmo-sunshine']);
    expect(events.find((e) => e.type === 'profile')).toMatchObject({ profile: { wantsToChange: 'UNSURE' } });
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('prefixes the follow-up lead-in with a blank line even when Gemini omits it', async () => {
    mockLLM
      .mockImplementationOnce(() => chunks('Main reply.'))
      .mockImplementationOnce(() => chunks('  ', 'Lead-in.', '<plan_suggestions>["fl-hmo-sunshine"]</plan_suggestions>'));
    const { text } = await post({ messages: mustSuggestMessages, profile });
    expect(text).toBe('Main reply.\n\nLead-in.');
  });

  it('(c) both calls without suggestions => fallback cards and no hard-coded text', async () => {
    mockLLM
      .mockImplementationOnce(() => chunks('Only Gemini text here.', '<profile>{}</profile>'))
      .mockImplementationOnce(() => chunks('<profile>{}</profile>'));
    const { events, text } = await post({ messages: mustSuggestMessages, profile });
    expect(mockLLM).toHaveBeenCalledTimes(2);
    expect(text).toBe('Only Gemini text here.');
    const sug = events.find((e) => e.type === 'suggestions');
    expect(sug).toMatchObject({ type: 'suggestions', source: 'fallback' });
    expect(sug && sug.type === 'suggestions' && sug.items.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('follow-up failure still falls back to cards silently', async () => {
    mockLLM
      .mockImplementationOnce(() => chunks('Main reply.'))
      .mockImplementationOnce(() => {
        throw new Error('boom');
      });
    const { events, text } = await post({ messages: mustSuggestMessages, profile });
    expect(text).toBe('Main reply.');
    expect(events.find((e) => e.type === 'suggestions')).toMatchObject({ source: 'fallback' });
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('does not make a follow-up call when suggestions are not required', async () => {
    mockLLM.mockImplementation(() => chunks('Just an answer.'));
    const { events } = await post({ messages: [user('What is AEP?')], profile: {} });
    expect(mockLLM).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === 'suggestions')).toBe(false);
  });

  it('(d) missing token / thrown error => error event and done (no bot text)', async () => {
    mockLLM.mockImplementation(() => {
      throw new Error('REPLICATE_API_TOKEN is not set');
    });
    const { events, text } = await post({ messages: [user('hi')], profile: {} });
    expect(text).toBe('');
    expect(events.map((e) => e.type)).toEqual(['meta', 'error', 'done']);

    const start = await post({ messages: [], profile: {}, start: true });
    expect(start.events.map((e) => e.type)).toEqual(['meta', 'error', 'done']);
  });

  it('(d) error on a mustSuggest turn still attaches fallback cards', async () => {
    mockLLM.mockImplementation(() =>
      (async function* () {
        yield 'partial';
        throw new Error('LLM error: upstream');
      })(),
    );
    const { events } = await post({ messages: mustSuggestMessages, profile });
    expect(events.map((e) => e.type)).toEqual(['meta', 'text', 'error', 'suggestions', 'done']);
    expect(events.find((e) => e.type === 'suggestions')).toMatchObject({ source: 'fallback' });
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });
});

describe('streamLLM (real module)', () => {
  it('throws a clear error when REPLICATE_API_TOKEN is missing', async () => {
    const real = await vi.importActual<typeof import('@/lib/llm')>('@/lib/llm');
    vi.stubEnv('REPLICATE_API_TOKEN', '');
    try {
      expect(() => real.streamLLM('hi')).toThrow('REPLICATE_API_TOKEN is not set');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
