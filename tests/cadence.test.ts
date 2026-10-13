import { describe, expect, it } from 'vitest';
import { computeCadence } from '@/lib/cadence';
import type { ChatMessage, SuggestionWithPlan } from '@/lib/types';

const card = [{ planId: 'p1', reason: 'r', plan: {} }] as unknown as SuggestionWithPlan[];
let n = 0;
const u = (): ChatMessage => ({ id: String(n++), role: 'user', content: 'q', createdAt: 0 });
const a = (withCard = false): ChatMessage => ({
  id: String(n++),
  role: 'assistant',
  content: 'a',
  createdAt: 0,
  ...(withCard ? { suggestions: card } : {}),
});

describe('computeCadence', () => {
  it('turns 1 and 2 without cards are false; turn 3 is true', () => {
    expect(computeCadence([u()]).mustSuggest).toBe(false);
    expect(computeCadence([u(), a(), u()]).mustSuggest).toBe(false);
    const c = computeCadence([u(), a(), u(), a(), u()]);
    expect(c).toEqual({ userTurn: 3, turnsSinceLastSuggestion: 3, mustSuggest: true });
  });

  it('a card on turn 2 resets the count', () => {
    const base = [u(), a(), u(), a(true)];
    expect(computeCadence([...base, u()]).mustSuggest).toBe(false);
    expect(computeCadence([...base, u(), a(), u()]).mustSuggest).toBe(false);
    expect(computeCadence([...base, u(), a(), u(), a(), u()]).mustSuggest).toBe(true);
  });

  it('after a card on turn 3, turns 4 and 5 are false and 6 is true', () => {
    const base = [u(), a(), u(), a(), u(), a(true)];
    const t4 = computeCadence([...base, u()]);
    expect(t4).toMatchObject({ userTurn: 4, turnsSinceLastSuggestion: 1, mustSuggest: false });
    expect(computeCadence([...base, u(), a(), u()]).mustSuggest).toBe(false);
    const t6 = computeCadence([...base, u(), a(), u(), a(), u()]);
    expect(t6).toMatchObject({ userTurn: 6, turnsSinceLastSuggestion: 3, mustSuggest: true });
  });

  it('empty suggestions array does not count as a card', () => {
    const m = { ...a(), suggestions: [] };
    expect(computeCadence([u(), m, u(), a(), u()]).mustSuggest).toBe(true);
  });
});
