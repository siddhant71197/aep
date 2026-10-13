import { describe, expect, it } from 'vitest';
import { buildPrompt, buildSuggestionPrompt, currentStage, START_DIRECTIVE, SYSTEM_PROMPT } from '@/lib/prompt';
import { rankPlans } from '@/lib/planEngine';
import type { CadenceState, ChatMessage } from '@/lib/types';

const noCadence: CadenceState = { userTurn: 1, turnsSinceLastSuggestion: 1, mustSuggest: false };
const must: CadenceState = { userTurn: 3, turnsSinceLastSuggestion: 3, mustSuggest: true };
const user = (content: string): ChatMessage => ({ id: content, role: 'user', content, createdAt: 0 });

describe('currentStage', () => {
  it.each([
    [{}, '1 – gather current plan'],
    [{ currentCoverage: 'UNKNOWN' as const, zip: '10001' }, '1 – gather current plan'],
    [{ currentCarrier: 'Acme' }, '2 – questions & intent'],
    [{ currentCoverage: 'MA' as const }, '2 – questions & intent'],
    [{ currentPlanName: 'Acme HMO', wantsToChange: 'NO' as const }, '3 – recommend'],
    [{ currentPlanName: 'Acme HMO', wantsToChange: 'UNSURE' as const }, '3 – recommend'],
  ])('%j -> %s', (profile, stage) => {
    expect(currentStage(profile)).toBe(stage);
  });
});

describe('SYSTEM_PROMPT', () => {
  it('keeps AEP facts, stages and tag format', () => {
    expect(SYSTEM_PROMPT).toContain('# AEP FACTS');
    expect(SYSTEM_PROMPT).toContain('Stage 1 – Current plan');
    expect(SYSTEM_PROMPT).toContain('Stage 2 – Questions & intent');
    expect(SYSTEM_PROMPT).toContain('Stage 3 – Recommend');
    expect(SYSTEM_PROMPT).toContain('alternatives to compare against your current plan');
    for (const key of ['currentCarrier', 'currentMonthlyPremium', 'currentPlanType', 'currentPlanLikes', 'currentPlanConcerns', 'wantsToChange']) {
      expect(SYSTEM_PROMPT).toContain(key);
    }
    expect(SYSTEM_PROMPT).toContain('<plan_suggestions>');
  });
});

describe('buildPrompt', () => {
  it('includes the CURRENT STAGE hint', () => {
    const p = buildPrompt({ messages: [user('hi')], profile: {}, candidates: [], cadence: noCadence, sufficient: false });
    expect(p).toContain('## CURRENT STAGE\n1 – gather current plan');
    expect(p).not.toContain(START_DIRECTIVE);
  });

  it('start turns use the opening directive and no candidates', () => {
    const p = buildPrompt({
      messages: [],
      profile: {},
      candidates: rankPlans({}).slice(0, 3),
      cadence: { userTurn: 0, turnsSinceLastSuggestion: 0, mustSuggest: false },
      sufficient: false,
      start: true,
    });
    expect(p).toContain(`## TURN DIRECTIVE\n${START_DIRECTIVE}`);
    expect(p).toContain('This is the opening message.');
    expect(p).toContain('none (do not suggest plans in the opening message)');
    expect(p).toContain('(no messages yet)');
  });

  it('forced suggestions are framed as alternatives once the current plan is known', () => {
    const known = buildPrompt({ messages: [user('x')], profile: { currentCarrier: 'Acme', wantsToChange: 'NO' }, candidates: [], cadence: must, sufficient: false });
    expect(known).toContain('You MUST include <plan_suggestions>');
    const directive = (p: string) => p.split('## TURN DIRECTIVE')[1].split('## CONVERSATION')[0];
    expect(directive(known)).toContain('alternatives to compare with their current plan');
    expect(directive(known)).toContain('keeping their plan is totally fine');
    const unknown = buildPrompt({ messages: [user('x')], profile: {}, candidates: [], cadence: must, sufficient: false });
    expect(directive(unknown)).toContain('You MUST include <plan_suggestions>');
    expect(directive(unknown)).not.toContain('alternatives to compare');
  });
});

describe('buildSuggestionPrompt', () => {
  it('gives the profile, candidates and reply so far, and asks for a lead-in + tag', () => {
    const profile = { zip: '33101', currentCarrier: 'Acme', currentMonthlyPremium: 45 };
    const candidates = rankPlans(profile).slice(0, 3);
    const p = buildSuggestionPrompt({ profile, candidates, replySoFar: 'Happy to help with that.' });
    expect(p).toContain(JSON.stringify(profile));
    for (const c of candidates) expect(p).toContain(`"id":"${c.plan.id}"`);
    expect(p).toContain('## YOUR REPLY SO FAR\nHappy to help with that.');
    expect(p).toContain('ONE short, conversational sentence');
    expect(p).toContain('<plan_suggestions>');
    expect(p).toContain('alternatives to compare with their current plan');
  });
});
