import { describe, expect, it, vi } from 'vitest';
import type { Plan, RankedPlan } from '@/lib/types';

const mkPlan = (id: string): Plan => ({
  id,
  name: `Plan ${id}`,
  carrier: 'Acme',
  type: 'MAPD_HMO',
  monthlyPremium: 0,
  deductible: 0,
  drugDeductible: 0,
  moop: 5000,
  includesDrugCoverage: true,
  formulary: {},
  starRating: 4,
  extras: {},
  networkType: 'HMO',
  outOfNetworkCoverage: false,
  serviceZipPrefixes: [],
  counties: [],
  highlights: [],
});
const PLANS: Record<string, Plan> = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((id) => [id, mkPlan(id)]));

vi.mock('@/lib/catalog', () => ({
  getPlanById: (id: string) => PLANS[id],
  getCatalog: () => Object.values(PLANS),
}));

const { parseSuggestionBody, validateSuggestions, fallbackSuggestions } = await import('@/lib/suggestions');

const ranked: RankedPlan[] = [
  { plan: PLANS.c, score: 9, reasons: ['$0 premium', 'covers metformin', 'dental'] },
  { plan: PLANS.a, score: 8, reasons: ['PPO flexibility'] },
  { plan: PLANS.b, score: 7, reasons: [] },
];

describe('parseSuggestionBody', () => {
  it('accepts object and bare array forms', () => {
    expect(parseSuggestionBody('{"suggestions":[{"planId":"a","reason":"x"}]}')).toEqual([{ planId: 'a', reason: 'x' }]);
    expect(parseSuggestionBody('[{"planId":"b"}]')).toEqual([{ planId: 'b', reason: '' }]);
  });
  it('returns [] on garbage', () => {
    expect(parseSuggestionBody('not json')).toEqual([]);
    expect(parseSuggestionBody('{"foo":1}')).toEqual([]);
    expect(parseSuggestionBody('')).toEqual([]);
  });
});

describe('validateSuggestions', () => {
  it('drops unknown ids, dedupes, caps at 3', () => {
    const out = validateSuggestions(
      [
        { planId: 'zzz', reason: 'fake' },
        { planId: 'a', reason: 'first' },
        { planId: 'a', reason: 'dup' },
        { planId: 'b', reason: 'second' },
        { planId: 'd', reason: 'third' },
        { planId: 'e', reason: 'fourth' },
      ],
      ranked,
    );
    expect(out.map((s) => s.planId)).toEqual(['a', 'b', 'd']);
    expect(out[0].reason).toBe('first');
    expect(out[0].plan).toBe(PLANS.a);
  });

  it('fills missing reasons from ranked reasons or a generic one', () => {
    const out = validateSuggestions(
      [
        { planId: 'c', reason: '' },
        { planId: 'd', reason: '  ' },
      ],
      ranked,
    );
    expect(out[0].reason).toBe('$0 premium; covers metformin');
    expect(out[1].reason).toMatch(/popular option/);
  });
});

describe('fallbackSuggestions', () => {
  it('returns top 2 ranked plans with reasons', () => {
    const out = fallbackSuggestions(ranked);
    expect(out.map((s) => s.planId)).toEqual(['c', 'a']);
    expect(out[0].reason).toBe('$0 premium; covers metformin');
    expect(out[1].reason).toBe('PPO flexibility');
  });
  it('uses generic reason when none', () => {
    expect(fallbackSuggestions([ranked[2]], 2)[0].reason).toBe(
      "A popular option in your area based on what you've shared so far.",
    );
  });
});
