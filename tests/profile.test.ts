import { describe, expect, it } from 'vitest';
import { mergeProfile, regexExtract, sanitizeProfile } from '@/lib/profile';

describe('regexExtract', () => {
  it('returns {} for text with nothing recognizable', () => {
    expect(regexExtract('Hello there, I have questions')).toEqual({});
  });

  it('extracts the first 5-digit zip', () => {
    expect(regexExtract('I live in 33101, moving to 75201').zip).toBe('33101');
    expect(regexExtract('zip is 123456').zip).toBeUndefined();
  });

  it.each([
    ['I can pay $50/month', 50],
    ['about $50 a month', 50],
    ['50 dollars per month max', 50],
    ['I have a budget of $40', 40],
    ['something under $30 please', 30],
    ['$25.50 per month', 25.5],
  ])('budget: %s', (text, expected) => {
    expect(regexExtract(text).maxMonthlyPremium).toBe(expected);
  });

  it('does not treat a zip or age as budget', () => {
    expect(regexExtract('I am 67 and live in 10001').maxMonthlyPremium).toBeUndefined();
  });

  it('extracts generic drugs and brand aliases', () => {
    const r = regexExtract('I take Metformin, LIPITOR and Synthroid, also eliquis.');
    expect(new Set(r.drugs)).toEqual(new Set(['metformin', 'atorvastatin', 'levothyroxine', 'eliquis']));
    expect(regexExtract('metformins aren’t a thing').drugs).toBeUndefined();
    expect(regexExtract('Prilosec and Neurontin and Norvasc and Zestril and Cozaar and Glucophage').drugs?.sort()).toEqual(
      ['amlodipine', 'gabapentin', 'lisinopril', 'losartan', 'metformin', 'omeprazole'],
    );
  });

  it('extracts extras', () => {
    const r = regexExtract('I need dental, new glasses, hearing aids, an OTC card and Silver Sneakers');
    expect(r.extrasWanted).toEqual(['dental', 'vision', 'hearing', 'otc', 'fitness']);
    expect(regexExtract('want a gym').extrasWanted).toEqual(['fitness']);
  });

  describe('current coverage (conservative)', () => {
    it.each([
      ['I have a Medicare Advantage plan', 'MA'],
      ["I'm on a Humana Medicare Advantage plan", 'MA'],
      ['my medicare advantage premium went up', 'MA'],
      ['I have Original Medicare + Medigap', 'ORIGINAL_PLUS_MEDIGAP'],
      ['I have a Medicare Supplement', 'ORIGINAL_PLUS_MEDIGAP'],
      ['currently on a medigap plan G', 'ORIGINAL_PLUS_MEDIGAP'],
      ['I have medigap and am thinking about medicare advantage', 'ORIGINAL_PLUS_MEDIGAP'],
    ])('%s -> %s', (text, expected) => {
      expect(regexExtract(text).currentCoverage).toBe(expected);
    });

    it.each([
      'Should I switch from Medicare Advantage to Original Medicare?',
      'I want to switch to Medicare Advantage',
      'I have questions about medicare advantage',
      'I have a Part D drug plan',
      "I'm not sure what I have",
      'I take a vitamin supplement',
      'my wife has medicare advantage',
    ])('no coverage for: %s', (text) => {
      expect(regexExtract(text).currentCoverage).toBeUndefined();
    });
  });

  describe('current monthly premium', () => {
    it.each([
      ['I pay $45 a month for my plan', 45],
      ['we currently pay about $32.50/month', 32.5],
      ['My premium is $60', 60],
      ["my current plan's premium went up to $38", 38],
      ['My plan has a $25 premium', 25],
      ['currently a $19/month premium', 19],
    ])('%s -> %s', (text, expected) => {
      const r = regexExtract(text);
      expect(r.currentMonthlyPremium).toBe(expected);
      expect(r.maxMonthlyPremium).toBeUndefined();
    });

    it.each([
      'I can pay $50/month',
      'I want a $0 premium plan',
      'my budget for premium is $40',
      'something under $30 please',
      'I would pay $20 a month',
    ])('not a current premium: %s', (text) => {
      expect(regexExtract(text).currentMonthlyPremium).toBeUndefined();
    });

    it('does not double-count the current premium as budget, but keeps a separate budget', () => {
      expect(regexExtract('I pay $45 a month now but want something under $30')).toEqual({
        currentMonthlyPremium: 45,
        maxMonthlyPremium: 30,
      });
      expect(regexExtract('I pay $45 monthly')).toEqual({ currentMonthlyPremium: 45 });
    });
  });

  it('combines fields', () => {
    expect(regexExtract('Zip 75201, budget of $35, on ozempic, want vision')).toEqual({
      zip: '75201',
      maxMonthlyPremium: 35,
      drugs: ['ozempic'],
      extrasWanted: ['vision'],
    });
  });
});

describe('mergeProfile', () => {
  it('scalars are last-write-wins, ignoring undefined/null/empty', () => {
    const m = mergeProfile(
      { zip: '10001', maxMonthlyPremium: 50, wantsKeepDoctors: true },
      { zip: '33101', maxMonthlyPremium: undefined },
      { zip: '', wantsKeepDoctors: false, currentPlanName: null as unknown as string },
    );
    expect(m).toEqual({ zip: '33101', maxMonthlyPremium: 50, wantsKeepDoctors: false });
  });

  it('handles the current-plan fields (scalars overwrite, likes/concerns union)', () => {
    const m = mergeProfile(
      { currentCarrier: 'Acme', currentMonthlyPremium: 45, currentPlanConcerns: ['Premium went up'], wantsToChange: 'UNSURE' },
      {
        currentMonthlyPremium: 0,
        currentPlanType: 'MAPD_HMO',
        currentPlanConcerns: ['premium went up', 'doctor left network'],
        currentPlanLikes: ['Low copays'],
        wantsToChange: 'YES',
      },
    );
    expect(m).toEqual({
      currentCarrier: 'Acme',
      currentMonthlyPremium: 0,
      currentPlanType: 'MAPD_HMO',
      currentPlanConcerns: ['premium went up', 'doctor left network'],
      currentPlanLikes: ['low copays'],
      wantsToChange: 'YES',
    });
  });

  it('keeps 0 budgets', () => {
    expect(mergeProfile({ maxMonthlyPremium: 50 }, { maxMonthlyPremium: 0 }).maxMonthlyPremium).toBe(0);
  });

  it('arrays are unioned, lowercased, trimmed and deduped', () => {
    const m = mergeProfile({ drugs: ['Metformin', 'eliquis'] }, { drugs: [' metformin ', 'Ozempic', ''] }, { doctors: ['Dr. Lee'] });
    expect(m.drugs).toEqual(['metformin', 'eliquis', 'ozempic']);
    expect(m.doctors).toEqual(['dr. lee']);
  });

  it('does not mutate inputs', () => {
    const a = { drugs: ['metformin'] };
    mergeProfile(a, { drugs: ['eliquis'] });
    expect(a).toEqual({ drugs: ['metformin'] });
  });
});

describe('sanitizeProfile', () => {
  it('never throws on junk', () => {
    for (const junk of [null, undefined, 42, 'str', [], [1, 2], true, () => 1]) {
      expect(sanitizeProfile(junk)).toEqual({});
    }
    const evil = Object.defineProperty({}, 'zip', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    expect(() => sanitizeProfile(evil)).not.toThrow();
  });

  it('keeps valid fields', () => {
    const p = sanitizeProfile({
      zip: '10001',
      currentCoverage: 'MAPD',
      currentPlanName: 'Acme Gold',
      preferredPath: 'MA',
      maxMonthlyPremium: 0,
      drugs: ['Metformin'],
      doctors: ['Dr. Lee'],
      wantsKeepDoctors: false,
      extrasWanted: ['dental', 'jetpack', 'vision'],
      healthNotes: ['veteran'],
      travelsOften: true,
      currentCarrier: ' Acme Health ',
      currentMonthlyPremium: 45.5,
      currentPlanType: 'MAPD_PPO',
      currentPlanLikes: ['low copays'],
      currentPlanConcerns: ['premium went up', 'doctor left network'],
      wantsToChange: 'UNSURE',
    });
    expect(p).toEqual({
      currentCarrier: 'Acme Health',
      currentMonthlyPremium: 45.5,
      currentPlanType: 'MAPD_PPO',
      currentPlanLikes: ['low copays'],
      currentPlanConcerns: ['premium went up', 'doctor left network'],
      wantsToChange: 'UNSURE',
      zip: '10001',
      currentCoverage: 'MAPD',
      currentPlanName: 'Acme Gold',
      preferredPath: 'MA',
      maxMonthlyPremium: 0,
      drugs: ['metformin'],
      doctors: ['Dr. Lee'],
      wantsKeepDoctors: false,
      extrasWanted: ['dental', 'vision'],
      healthNotes: ['veteran'],
      travelsOften: true,
    });
  });

  it('drops invalid fields and unknown keys', () => {
    const p = sanitizeProfile({
      zip: '1234',
      currentCoverage: 'PLATINUM',
      preferredPath: 'whatever',
      maxMonthlyPremium: 99999,
      wantsKeepDoctors: 'yes',
      travelsOften: 1,
      drugs: 'metformin',
      __proto__x: 1,
      admin: true,
    });
    expect(p).toEqual({});
    expect(sanitizeProfile({ maxMonthlyPremium: NaN })).toEqual({});
    expect(sanitizeProfile({ maxMonthlyPremium: -5 })).toEqual({});
    expect(sanitizeProfile({ maxMonthlyPremium: '50' })).toEqual({});
    expect(sanitizeProfile({ zip: 10001 })).toEqual({});
  });

  it('validates the current-plan fields', () => {
    expect(
      sanitizeProfile({
        currentCarrier: 'x'.repeat(101),
        currentMonthlyPremium: 10001,
        currentPlanType: 'MA',
        currentPlanLikes: 'cheap',
        currentPlanConcerns: [1, ''],
        wantsToChange: 'maybe',
      }),
    ).toEqual({});
    expect(sanitizeProfile({ currentMonthlyPremium: -1 })).toEqual({});
    expect(sanitizeProfile({ currentMonthlyPremium: '45' })).toEqual({});
    expect(sanitizeProfile({ currentMonthlyPremium: 0, currentCarrier: '  ' })).toEqual({ currentMonthlyPremium: 0 });
    expect(sanitizeProfile({ wantsToChange: 'NO', currentPlanType: 'PDP' })).toEqual({
      wantsToChange: 'NO',
      currentPlanType: 'PDP',
    });
  });

  it('limits arrays to strings, 20 items, 100 chars', () => {
    const p = sanitizeProfile({
      drugs: [1, null, 'eliquis', { a: 1 }, 'x'.repeat(101)],
      doctors: Array.from({ length: 30 }, (_, i) => `Dr ${i}`),
      extrasWanted: 'dental',
    });
    expect(p.drugs).toEqual(['eliquis']);
    expect(p.doctors).toHaveLength(20);
    expect(p.extrasWanted).toBeUndefined();
  });
});
