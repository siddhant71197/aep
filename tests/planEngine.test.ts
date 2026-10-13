import { describe, expect, it } from 'vitest';
import { isCurrentPlanKnown, isProfileSufficient, rankPlans } from '@/lib/planEngine';
import { getCatalog, getPlanById } from '@/lib/catalog';
import type { Plan, UserProfile } from '@/lib/types';

const ids = (profile: UserProfile, catalog?: Plan[]) => rankPlans(profile, catalog).map((r) => r.plan.id);

const base: Plan = {
  id: 'x',
  name: 'X',
  carrier: 'Test',
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
};
const mk = (o: Partial<Plan>): Plan => ({ ...base, ...o });

describe('catalog', () => {
  it('has 15 plans with unique ids, each region with >= 2 MA options', () => {
    const c = getCatalog();
    expect(c).toHaveLength(15);
    expect(new Set(c.map((p) => p.id)).size).toBe(15);
    for (const prefix of ['100', '330', '750']) {
      const ma = c.filter((p) => p.type.startsWith('MA') && p.serviceZipPrefixes.includes(prefix));
      expect(ma.length).toBeGreaterThanOrEqual(2);
    }
    expect(getPlanById('medigap-g')?.medigapLetter).toBe('G');
    expect(getPlanById('nope')).toBeUndefined();
  });
});

describe('rankPlans filters', () => {
  it('zip filter keeps regional + national plans only', () => {
    const result = rankPlans({ zip: '33101' });
    for (const r of result) {
      const pre = r.plan.serviceZipPrefixes;
      expect(pre.length === 0 || pre.includes('331')).toBe(true);
    }
    const got = result.map((r) => r.plan.id);
    expect(got).toContain('fl-hmo-sunshine');
    expect(got).toContain('pdp-basic');
    expect(got).toContain('medigap-g');
    expect(got).not.toContain('ny-hmo-zero');
    expect(got).not.toContain('tx-ppo-prairie');
  });

  it('no zip keeps all plans', () => {
    expect(rankPlans({})).toHaveLength(15);
  });

  it('MA path keeps only MA/MAPD types', () => {
    const r = rankPlans({ zip: '10001', preferredPath: 'MA' });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => /^(MA_|MAPD_)/.test(x.plan.type))).toBe(true);
  });

  it('ORIGINAL_MEDICARE path keeps only PDP + Medigap', () => {
    const r = rankPlans({ zip: '75201', preferredPath: 'ORIGINAL_MEDICARE' });
    expect(r).toHaveLength(6);
    expect(r.every((x) => x.plan.type === 'PDP' || x.plan.type === 'MEDIGAP')).toBe(true);
  });

  it('drops no-Rx MA_PPO for MA path with drugs unless veteran', () => {
    expect(ids({ zip: '10001', preferredPath: 'MA', drugs: ['metformin'] })).not.toContain('ma-ppo-patriot');
    expect(
      ids({ zip: '10001', preferredPath: 'MA', drugs: ['metformin'], healthNotes: ['I get my meds through the VA'] }),
    ).toContain('ma-ppo-patriot');
    expect(ids({ zip: '10001', preferredPath: 'MA' })).toContain('ma-ppo-patriot');
  });
});

describe('rankPlans scoring', () => {
  it('cheaper plans rank higher under a budget, over-budget plans are penalized', () => {
    const cat = [mk({ id: 'a', monthlyPremium: 0 }), mk({ id: 'b', monthlyPremium: 40 }), mk({ id: 'c', monthlyPremium: 100 })];
    const r = rankPlans({ maxMonthlyPremium: 50 }, cat);
    expect(r.map((x) => x.plan.id)).toEqual(['a', 'b', 'c']);
    const [a, b, c] = r;
    expect(a.score - b.score).toBeCloseTo(12, 1);
    expect(c.score).toBeLessThan(b.score - 20);
    expect(a.reasons).toContain('$0 premium within your $50 budget');
  });

  it('over-budget penalty is capped at -30', () => {
    const cat = [mk({ id: 'ref' }), mk({ id: 'huge', monthlyPremium: 5000 })];
    const r = rankPlans({}, cat);
    const r2 = rankPlans({ maxMonthlyPremium: 10 }, cat);
    const huge = r2.find((x) => x.plan.id === 'huge')!;
    expect(huge.score).toBe(r.find((x) => x.plan.id === 'huge')!.score - 30);
  });

  it('lower drug tiers score higher', () => {
    const cat = [
      mk({ id: 't1', formulary: { eliquis: 1 } }),
      mk({ id: 't3', formulary: { eliquis: 3 } }),
      mk({ id: 't5', formulary: { eliquis: 5 } }),
    ];
    const r = rankPlans({ drugs: ['eliquis'] }, cat);
    expect(r.map((x) => x.plan.id)).toEqual(['t1', 't3', 't5']);
    expect(r[0].score - r[1].score).toBe(4);
    expect(r[1].score - r[2].score).toBe(3);
    expect(r[0].reasons).toContain('Covers eliquis (Tier 1)');
  });

  it('uncovered drugs are penalized -10', () => {
    const cat = [mk({ id: 'yes', formulary: { ozempic: 4 } }), mk({ id: 'no', formulary: {} })];
    const r = rankPlans({ drugs: ['ozempic'] }, cat);
    expect(r[0].plan.id).toBe('yes');
    expect(r[0].score - r[1].score).toBe(11);
    expect(r[1].reasons).toContain("Doesn't cover ozempic");
  });

  it('Medigap is drug-neutral', () => {
    const cat = [mk({ id: 'g', type: 'MEDIGAP', networkType: 'ANY_MEDICARE_PROVIDER', includesDrugCoverage: false, moop: null })];
    expect(rankPlans({ drugs: ['ozempic', 'eliquis'] }, cat)[0].score).toBe(rankPlans({}, cat)[0].score);
  });

  it('wantsKeepDoctors favors PPO and Medigap over HMO', () => {
    const cat = [
      mk({ id: 'hmo' }),
      mk({ id: 'ppo', type: 'MAPD_PPO', networkType: 'PPO' }),
      mk({ id: 'gap', type: 'MEDIGAP', networkType: 'ANY_MEDICARE_PROVIDER', moop: null, includesDrugCoverage: false }),
    ];
    const before = rankPlans({}, cat);
    const after = rankPlans({ wantsKeepDoctors: true }, cat);
    const s = (r: typeof before, id: string) => r.find((x) => x.plan.id === id)!.score;
    expect(s(after, 'hmo') - s(before, 'hmo')).toBe(-8);
    expect(s(after, 'ppo') - s(before, 'ppo')).toBe(10);
    expect(s(after, 'gap') - s(before, 'gap')).toBe(12);
    expect(after[after.length - 1].plan.id).toBe('hmo');
    expect(rankPlans({ travelsOften: true }, cat)[after.length - 1].plan.id).toBe('hmo');
  });

  it('wanted extras add +4 each with a reason', () => {
    const cat = [mk({ id: 'e', extras: { dental: 'x', vision: 'y' } })];
    const r = rankPlans({ extrasWanted: ['dental', 'vision', 'hearing'] }, cat)[0];
    expect(r.score - rankPlans({}, cat)[0].score).toBe(8);
    expect(r.reasons).toContain('Includes dental & vision');
  });

  it('ordering is deterministic: score desc, premium asc, id asc', () => {
    const cat = [mk({ id: 'b' }), mk({ id: 'a' }), mk({ id: 'c', monthlyPremium: 10 })];
    expect(ids({}, cat)).toEqual(['a', 'b', 'c']);
    const p: UserProfile = { zip: '33101', drugs: ['metformin', 'eliquis'], maxMonthlyPremium: 60, extrasWanted: ['dental'] };
    const first = rankPlans(p);
    expect(rankPlans(p)).toEqual(first);
    expect(rankPlans(p, [...getCatalog()].reverse())).toEqual(first);
    for (const r of first) expect(Math.round(r.score * 10) / 10).toBe(r.score);
  });
});

describe('current plan comparison', () => {
  it('adds a "less than your current plan" reason only for cheaper plans', () => {
    const cat = [mk({ id: 'cheap', monthlyPremium: 15 }), mk({ id: 'same', monthlyPremium: 45 }), mk({ id: 'pricey', monthlyPremium: 60 })];
    const r = rankPlans({ currentMonthlyPremium: 45 }, cat);
    const reasons = (id: string) => r.find((x) => x.plan.id === id)!.reasons;
    expect(reasons('cheap')).toContain('$30/mo less than your current plan');
    expect(reasons('same').some((x) => x.includes('current plan'))).toBe(false);
    expect(reasons('pricey').some((x) => x.includes('current plan'))).toBe(false);
    expect(rankPlans({}, cat)[0].reasons.some((x) => x.includes('current plan'))).toBe(false);
  });

  it('formats fractional differences', () => {
    const r = rankPlans({ currentMonthlyPremium: 20 }, [mk({ id: 'a', monthlyPremium: 8.9 })]);
    expect(r[0].reasons).toContain('$11.10/mo less than your current plan');
  });
});

describe('isCurrentPlanKnown', () => {
  it.each([
    [{}, false],
    [{ currentCoverage: 'UNKNOWN' }, false],
    [{ currentCoverage: 'MA' }, true],
    [{ currentCoverage: 'NONE' }, true],
    [{ currentPlanName: 'Acme HMO' }, true],
    [{ currentCarrier: 'Acme' }, true],
  ] as [UserProfile, boolean][])('%j -> %s', (profile, expected) => {
    expect(isCurrentPlanKnown(profile)).toBe(expected);
  });
});

describe('isProfileSufficient', () => {
  const cases: [UserProfile, boolean][] = [
    [{}, false],
    [{ maxMonthlyPremium: 50, drugs: ['metformin'] }, false],
    [{ zip: '10001' }, false],
    [{ zip: '10001', maxMonthlyPremium: 50 }, false],
    // Needs signals alone are no longer enough: the current plan must be known.
    [{ zip: '10001', maxMonthlyPremium: 0, drugs: ['metformin'] }, false],
    [{ zip: '10001', currentCarrier: 'Acme', maxMonthlyPremium: 0, drugs: ['metformin'] }, true],
    [{ zip: '10001', wantsKeepDoctors: false, extrasWanted: ['dental'] }, false],
    [{ zip: '10001', currentCoverage: 'MA', wantsKeepDoctors: false, extrasWanted: ['dental'] }, true],
    [{ zip: '10001', doctors: ['Dr. Lee'], preferredPath: 'MA' }, false],
    [{ zip: '10001', preferredPath: 'UNSURE', currentCoverage: 'UNKNOWN' }, false],
    [{ zip: '10001', currentCoverage: 'UNKNOWN', drugs: ['metformin'], maxMonthlyPremium: 20 }, false],
    [{ zip: '10001', preferredPath: 'UNSURE', currentPlanName: 'Acme HMO', drugs: [] }, false],
    [{ zip: '10001', currentCoverage: 'MAPD', preferredPath: 'ORIGINAL_MEDICARE' }, true],
    [{ zip: '10001', currentPlanName: 'Acme HMO', extrasWanted: ['vision'] }, true],
    [{ currentPlanName: 'Acme HMO', extrasWanted: ['vision'] }, false],
    // Wants to keep their plan: never push suggestions via sufficiency.
    [{ zip: '10001', currentPlanName: 'Acme HMO', extrasWanted: ['vision'], wantsToChange: 'NO' }, false],
    [{ zip: '10001', currentPlanName: 'Acme HMO', extrasWanted: ['vision'], wantsToChange: 'UNSURE' }, true],
    [{ zip: '10001', currentPlanName: 'Acme HMO', extrasWanted: ['vision'], wantsToChange: 'YES' }, true],
  ];
  it.each(cases)('%j -> %s', (profile, expected) => {
    expect(isProfileSufficient(profile)).toBe(expected);
  });
});
