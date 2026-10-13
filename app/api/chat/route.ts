import { computeCadence } from '@/lib/cadence';
import { streamLLM } from '@/lib/llm';
import { encodeEvent } from '@/lib/ndjson';
import { isProfileSufficient, rankPlans } from '@/lib/planEngine';
import { mergeProfile, regexExtract, sanitizeProfile } from '@/lib/profile';
import { buildPrompt, buildSuggestionPrompt } from '@/lib/prompt';
import { TagStreamParser } from '@/lib/streamParser';
import { fallbackSuggestions, parseSuggestionBody, validateSuggestions } from '@/lib/suggestions';
import type { ChatMessage, ChatRequest, StreamEvent, SuggestionWithPlan, UserProfile } from '@/lib/types';


const MAX_MESSAGES = 50;
const MAX_CHARS = 4000;
const CANDIDATE_COUNT = 6;
const LLM_ERROR_MESSAGE =
  "Sorry — I'm having trouble responding right now. Please try again in a moment.";

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

function validateBody(body: unknown): { ok: true; value: ChatRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid request body.' };
  const b = body as Partial<ChatRequest>;
  const start = b.start === true;
  if (!Array.isArray(b.messages)) return { ok: false, error: 'messages must be an array.' };
  if (start && b.messages.length > 0) return { ok: false, error: 'A start request must have an empty messages array.' };
  if (!start && b.messages.length === 0) return { ok: false, error: 'messages must be a non-empty array.' };
  if (b.messages.length > MAX_MESSAGES) return { ok: false, error: `Too many messages (max ${MAX_MESSAGES}).` };
  for (const m of b.messages) {
    if (!m || typeof m !== 'object' || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      return { ok: false, error: 'Each message needs a role of user/assistant and string content.' };
    }
    if (m.content.length > MAX_CHARS) return { ok: false, error: `Message too long (max ${MAX_CHARS} characters).` };
  }
  if (!start) {
    const last = b.messages[b.messages.length - 1];
    if (last.role !== 'user') return { ok: false, error: 'The last message must be from the user.' };
  }
  const profile = b.profile && typeof b.profile === 'object' && !Array.isArray(b.profile) ? b.profile : {};
  return { ok: true, value: { messages: b.messages as ChatMessage[], profile, start } };
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest('Invalid JSON.');
  }
  const v = validateBody(raw);
  if (!v.ok) return badRequest(v.error);
  const { messages, start = false } = v.value;
  const lastUser = start ? '' : messages[messages.length - 1].content;

  // Client-held profile is untrusted, so it is re-sanitized before merging.
  const base = sanitizeProfile(v.value.profile || {});
  const extracted = regexExtract(lastUser);
  // Regex coverage detection only fills a gap; it never overrides what's already known.
  if (extracted.currentCoverage && base.currentCoverage && base.currentCoverage !== 'UNKNOWN') {
    delete extracted.currentCoverage;
  }
  const profile0: UserProfile = mergeProfile(base, extracted);
  // Start/greeting turns have no user message, so they never count toward the cadence.
  const cadence = computeCadence(messages);
  const mustSuggest = !start && cadence.mustSuggest;
  const ranked = rankPlans(profile0);
  const sufficient = !start && isProfileSufficient(profile0);
  const prompt = buildPrompt({
    messages,
    profile: profile0,
    candidates: ranked.slice(0, CANDIDATE_COUNT),
    cadence,
    sufficient,
    start,
  });

  const abort = new AbortController();
  const onAbort = () => abort.abort();
  if (req.signal.aborted) abort.abort();
  else req.signal.addEventListener('abort', onAbort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: StreamEvent) => {
        if (closed || abort.signal.aborted) return;
        try {
          controller.enqueue(encodeEvent(e));
        } catch {
          closed = true;
        }
      };

      send({ type: 'meta', userTurn: cadence.userTurn, mustSuggest, profileSufficient: sufficient });

      /** Stream one Gemini call, forwarding visible text via `onText` and collecting tag bodies. */
      const runLLM = async (llmPrompt: string, onText: (t: string) => void) => {
        const parser = new TagStreamParser();
        const tags: { profile: string | null; suggestions: string | null } = { profile: null, suggestions: null };
        const handle = (pieces: ReturnType<TagStreamParser['push']>) => {
          for (const p of pieces) {
            if (p.kind === 'text') onText(p.text);
            else if (p.name === 'profile') tags.profile = p.body;
            else tags.suggestions = p.body;
          }
        };
        for await (const chunk of streamLLM(llmPrompt, abort.signal)) {
          if (abort.signal.aborted) break;
          handle(parser.push(chunk));
        }
        handle(parser.end());
        return tags;
      };

      try {
        let modelText = '';
        const main = await runLLM(prompt, (t) => {
          modelText += t;
          send({ type: 'text', delta: t });
        });
        if (abort.signal.aborted) return;

        let profile = profile0;
        if (main.profile !== null) {
          try {
            profile = mergeProfile(profile0, sanitizeProfile(safeJson(main.profile)));
          } catch {
            profile = profile0;
          }
        }
        send({ type: 'profile', profile });

        // No plan suggestions on the opening greeting.
        if (start) return;

        const reranked = rankPlans(profile);
        let items: SuggestionWithPlan[] = main.suggestions
          ? validateSuggestions(parseSuggestionBody(main.suggestions), reranked)
          : [];
        let source: 'model' | 'fallback' = 'model';

        if (items.length === 0 && mustSuggest) {
          // One short follow-up Gemini call for a lead-in + <plan_suggestions>.
          try {
            let first = true;
            const follow = await runLLM(
              buildSuggestionPrompt({
                profile,
                candidates: reranked.slice(0, CANDIDATE_COUNT),
                replySoFar: modelText,
              }),
              (t) => {
                let delta = t;
                if (first) {
                  delta = delta.replace(/^\s+/, '');
                  if (!delta) return;
                  first = false;
                  if (modelText.trim()) delta = `\n\n${delta}`;
                }
                send({ type: 'text', delta });
              },
            );
            if (abort.signal.aborted) return;
            if (follow.suggestions) {
              items = validateSuggestions(parseSuggestionBody(follow.suggestions), reranked);
            }
          } catch (err) {
            if (abort.signal.aborted) return;
            console.error('[chat] suggestion follow-up failed', err);
          }
          // Still nothing: attach ranked cards as UI data only (no canned chat text).
          if (items.length === 0) {
            items = fallbackSuggestions(reranked);
            source = 'fallback';
          }
        }
        if (items.length > 0) send({ type: 'suggestions', items, source });
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error('[chat] LLM error', err);
          send({ type: 'error', message: LLM_ERROR_MESSAGE });
          if (mustSuggest) {
            try {
              const items = fallbackSuggestions(ranked);
              if (items.length > 0) send({ type: 'suggestions', items, source: 'fallback' });
            } catch {
              /* ignore */
            }
          }
        }
      } finally {
        send({ type: 'done' });
        req.signal.removeEventListener('abort', onAbort);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
