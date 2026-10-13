import Replicate from 'replicate';

const DEFAULT_MODEL = 'google/gemini-3.5-flash';

function numEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' && process.env[name] !== undefined ? v : fallback;
}

function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

/**
 * Stream text from Gemini on Replicate. Throws if REPLICATE_API_TOKEN is missing;
 * there is no mock or canned fallback.
 */
export function streamLLM(prompt: string, signal?: AbortSignal): AsyncIterable<string> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    console.error('[llm] REPLICATE_API_TOKEN is not set');
    throw new Error('REPLICATE_API_TOKEN is not set');
  }
  return replicateStream(prompt, token, signal);
}

interface SseEvent {
  event?: string;
  data?: unknown;
}

// Internal helpers that `replicate.stream()` uses; we need the prediction id as well,
// so the stream is opened by hand.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createReadableStream } = require('replicate/lib/stream') as {
  createReadableStream: (args: { url: string; fetch: typeof fetch; options?: { signal?: AbortSignal } }) => ReadableStream<SseEvent>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { streamAsyncIterator } = require('replicate/lib/util') as {
  streamAsyncIterator: (s: ReadableStream<SseEvent>) => AsyncIterable<SseEvent>;
};

function outputText(output: unknown): string {
  if (Array.isArray(output)) return output.map((o) => String(o ?? '')).join('');
  return typeof output === 'string' ? output : '';
}

/**
 * Stream from Replicate, de-duplicating replayed output, then reconcile with the
 * finished prediction: the live stream sometimes ends before the model has, and the
 * final prediction output is authoritative.
 */
async function* replicateStream(prompt: string, token: string, signal?: AbortSignal): AsyncGenerator<string> {
  const replicate = new Replicate({ auth: token });
  const model = (process.env.REPLICATE_MODEL || DEFAULT_MODEL) as `${string}/${string}`;
  const input = {
    prompt,
    images: [],
    videos: [],
    top_p: 0.95,
    temperature: numEnv('LLM_TEMPERATURE', 0.7),
    thinking_level: 'none',
    max_output_tokens: numEnv('LLM_MAX_OUTPUT_TOKENS', 2048),
  };
  const prediction = await replicate.predictions.create({ model, input, stream: true });
  if (signal?.aborted) throw abortError();

  let emitted = '';
  if (prediction.urls?.stream) {
    async function* raw(): AsyncGenerator<string> {
      const sse = createReadableStream({
        url: prediction.urls!.stream!,
        fetch: replicate.fetch.bind(replicate) as typeof fetch,
        options: signal ? { signal } : {},
      });
      for await (const ev of streamAsyncIterator(sse)) {
        if (signal?.aborted) throw abortError();
        if (ev.event === 'output') yield String(ev.data ?? '');
        else if (ev.event === 'error') {
          throw new Error(`LLM error: ${typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data)}`);
        }
        // 'done' and other events are ignored
      }
    }
    try {
      for await (const text of dedupeReplays(raw())) {
        emitted += text;
        yield text;
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      console.warn('[llm] stream interrupted, falling back to final output', err);
    }
  }

  if (signal?.aborted) throw abortError();
  const done = await replicate.wait(prediction, { interval: 250 });
  if (done.status !== 'succeeded') {
    throw new Error(`LLM prediction ${done.status}: ${String(done.error ?? '')}`);
  }
  const final = outputText(done.output);
  if (final.startsWith(emitted)) {
    const rest = final.slice(emitted.length);
    if (rest) yield rest;
  } else if (!emitted) {
    yield final;
  } else {
    // The stream drifted somewhere (e.g. a partial replay). Resume from where the
    // streamed text's tail appears in the final output.
    const tail = emitted.slice(-RESUME_ANCHOR);
    const idx = final.lastIndexOf(tail);
    if (idx >= 0) {
      const rest = final.slice(idx + tail.length);
      if (rest) yield rest;
    } else {
      console.warn('[llm] streamed text diverged from final output', { streamed: emitted.length, final: final.length });
    }
  }
}

const MIN_REPLAY_CHECK = 20;
const RESUME_ANCHOR = 60;
const REPLAY_PROBE = 30;

function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/**
 * Replicate's stream for this model sometimes re-sends the whole answer from the
 * beginning (with different chunking) after it has already been sent. Drop any
 * output that replays text already emitted, and pass genuinely new text through.
 */
export async function* dedupeReplays(source: AsyncIterable<string>): AsyncGenerator<string> {
  let emitted = '';
  let pending = '';
  let replayPos = -1; // index into `emitted` while a suspected replay is being consumed
  let held = ''; // text consumed as a suspected replay; released if it turns out to be new text

  const isRestart = (s: string) => {
    if (emitted.length < MIN_REPLAY_CHECK) return false;
    const k = Math.min(REPLAY_PROBE, emitted.length, s.length);
    return k > 0 && s.slice(0, k) === emitted.slice(0, k);
  };

  function* release(text: string): Generator<string> {
    if (!text) return;
    emitted += text;
    yield text;
  }

  function* drain(final: boolean): Generator<string> {
    while (pending) {
      if (replayPos < 0) {
        if (isRestart(pending)) {
          replayPos = 0;
          held = '';
          continue;
        }
        const text = pending;
        pending = '';
        yield* release(text);
        return;
      }
      const n = commonPrefixLen(pending, emitted.slice(replayPos));
      held += pending.slice(0, n);
      replayPos += n;
      pending = pending.slice(n);
      if (replayPos === emitted.length) {
        replayPos = -1; // full replay consumed; anything left is new text
        held = '';
        continue;
      }
      if (!pending) return;
      if (isRestart(pending)) {
        replayPos = 0; // replay restarted again
        held = '';
        continue;
      }
      // Diverged: what we held back was genuine text after all.
      const text = held + pending;
      held = '';
      pending = '';
      replayPos = -1;
      yield* release(text);
      return;
    }
    // A short held fragment that is a strict prefix of the opening is only ambiguous
    // at end of stream; treat it as a truncated replay and drop it.
    if (final) {
      held = '';
      replayPos = -1;
    }
  }

  for await (const chunk of source) {
    if (!chunk) continue;
    pending += chunk;
    yield* drain(false);
  }
  yield* drain(true);
}
