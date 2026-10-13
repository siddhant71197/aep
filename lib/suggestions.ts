import { getPlanById } from './catalog';
import type { PlanSuggestion, RankedPlan, SuggestionWithPlan } from './types';

export const MAX_SUGGESTIONS = 3;
const GENERIC_REASON = "A popular option in your area based on what you've shared so far.";

/** Tolerant parse of a <plan_suggestions> body. Returns [] on any error. */
export function parseSuggestionBody(body: string): PlanSuggestion[] {
  try {
    const parsed: unknown = JSON.parse(body);
    const arr = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { suggestions?: unknown }).suggestions)
        ? (parsed as { suggestions: unknown[] }).suggestions
        : [];
    const out: PlanSuggestion[] = [];
    for (const item of arr) {
      if (typeof item === 'string') {
        out.push({ planId: item, reason: '' });
      } else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const planId = typeof o.planId === 'string' ? o.planId : typeof o.id === 'string' ? o.id : '';
        if (!planId) continue;
        out.push({ planId: planId.trim(), reason: typeof o.reason === 'string' ? o.reason.trim() : '' });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function reasonFromRanked(r: RankedPlan | undefined): string {
  return r?.reasons.slice(0, 2).join('; ') || GENERIC_REASON;
}

export function validateSuggestions(items: PlanSuggestion[], ranked: RankedPlan[]): SuggestionWithPlan[] {
  const out: SuggestionWithPlan[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (out.length >= MAX_SUGGESTIONS) break;
    if (!item || typeof item.planId !== 'string' || seen.has(item.planId)) continue;
    const plan = getPlanById(item.planId);
    if (!plan) continue;
    seen.add(item.planId);
    const reason =
      typeof item.reason === 'string' && item.reason.trim()
        ? item.reason.trim()
        : reasonFromRanked(ranked.find((r) => r.plan.id === plan.id));
    out.push({ planId: plan.id, reason, plan });
  }
  return out;
}

export function fallbackSuggestions(ranked: RankedPlan[], n = 2): SuggestionWithPlan[] {
  return ranked.slice(0, n).map((r) => ({ planId: r.plan.id, reason: reasonFromRanked(r), plan: r.plan }));
}
