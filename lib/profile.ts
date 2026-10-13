import type { CurrentCoverage, Extra, PlanType, UserProfile } from './types';
import { EXTRAS } from './types';
import { getCatalog } from './catalog';

const BRAND_ALIASES: Record<string, string> = {
  glucophage: 'metformin',
  lipitor: 'atorvastatin',
  synthroid: 'levothyroxine',
  prilosec: 'omeprazole',
  neurontin: 'gabapentin',
  norvasc: 'amlodipine',
  zestril: 'lisinopril',
  cozaar: 'losartan',
};

const EXTRA_PATTERNS: [Extra, RegExp][] = [
  ['dental', /\bdental\b|\bdentist/i],
  ['vision', /\bvision\b|\b(eye)?glasses\b/i],
  ['hearing', /\bhearing(\s+aids?)?\b/i],
  ['otc', /\botc\b|\bover[-\s]the[-\s]counter\b/i],
  ['fitness', /\bfitness\b|\bgym\b|\bsilver\s*sneakers\b/i],
];

const NUM = '(\\d{1,5}(?:\\.\\d{1,2})?)';
const BUDGET_PATTERNS: RegExp[] = [
  new RegExp(`\\$\\s?${NUM}\\s*(?:\\/|a|per|each)\\s*(?:month|mo)\\b`, 'i'),
  new RegExp(`\\b${NUM}\\s*(?:dollars?|bucks)\\s*(?:\\/|a|per|each)\\s*(?:month|mo)\\b`, 'i'),
  new RegExp(`\\bbudget\\s*(?:of|is|around|about|:)?\\s*(?:around|about)?\\s*\\$\\s?${NUM}`, 'i'),
  new RegExp(`\\b(?:under|below|less than|no more than|up to|max(?:imum)?(?: of)?)\\s*\\$\\s?${NUM}`, 'i'),
  new RegExp(`\\b(?:under|below|less than|no more than|up to)\\s*${NUM}\\s*(?:dollars?|bucks)\\b`, 'i'),
  new RegExp(`\\$\\s?${NUM}\\s*(?:monthly|budget)\\b`, 'i'),
];

// Current-plan premium. Only phrases that clearly describe what the user pays NOW
// ("I pay $45", "my premium is $45", "my plan has a $45 premium"); never "I can pay".
const PER_MONTH_SUFFIX = '(?:\\s*(?:\\/|a|per|each)\\s*(?:month|mo)\\b|\\s*monthly\\b)?';
const NOT_BUDGET = '(?!\\s*(?:budget|afford|want|would|could|under|less|max|limit)\\b)';
const CURRENT_PREMIUM_PATTERNS: RegExp[] = [
  new RegExp(
    `\\b(?:i|we)\\s+(?:currently\\s+|now\\s+)?(?:pay|am paying|are paying)\\s+(?:about\\s+|around\\s+|roughly\\s+)?\\$\\s?${NUM}${PER_MONTH_SUFFIX}`,
    'i',
  ),
  new RegExp(
    `\\b(?:my|current)\\b(?:${NOT_BUDGET}[^$.?!\\n]){0,40}?\\bpremium\\b(?:${NOT_BUDGET}[^$.?!\\n]){0,25}?\\$\\s?${NUM}${PER_MONTH_SUFFIX}`,
    'i',
  ),
  new RegExp(
    `\\b(?:my|current(?:ly)?)\\b(?:${NOT_BUDGET}[^$.?!\\n]){0,40}?\\$\\s?${NUM}${PER_MONTH_SUFFIX}\\s*premium\\b`,
    'i',
  ),
];

// Current coverage: only when the user says they HAVE it ("I have / I'm on / my ...").
const HAVE =
  "(?:i\\s+have|i['’]ve\\s+got|i\\s+got|i['’]?m\\s+(?:on|in|enrolled\\s+in)|i\\s+am\\s+(?:on|in|enrolled\\s+in)|currently\\s+(?:have|on|in)|my(?:\\s+current)?)";
// Up to 3 filler words between HAVE and the coverage name (e.g. "a Humana", "Original Medicare +"),
// but never words that signal a question / comparison / someone else's coverage.
const FILLER_STOP =
  '(?!(?:about|regarding|questions?|on|of|to|vs|versus|or|and|than|not|no|has|had|want|wants|switch\\w*|join\\w*|thinking|considering|interested|looking)\\b)';
const GAP = `(?:\\s+${FILLER_STOP}[\\w+&\\-]+){0,3}?\\s+`;
const MEDIGAP_RE = new RegExp(`\\b${HAVE}${GAP}(?:medigap|medicare\\s+supplement|supplement\\s+plan)\\b`, 'i');
const MA_RE = new RegExp(`\\b${HAVE}${GAP}medicare\\s+advantage\\b`, 'i');

let drugKeysCache: string[] | null = null;
function drugKeys(): string[] {
  if (!drugKeysCache) {
    const set = new Set<string>();
    for (const p of getCatalog()) for (const k of Object.keys(p.formulary)) set.add(k.toLowerCase());
    drugKeysCache = Array.from(set).sort();
  }
  return drugKeysCache;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Deterministic extraction of zip / budget / known drug names, plus (conservatively)
 * current coverage and current monthly premium, from free text.
 */
export function regexExtract(text: string): UserProfile {
  const out: UserProfile = {};
  if (typeof text !== 'string' || !text) return out;

  const zip = text.match(/\b\d{5}\b/);
  if (zip) out.zip = zip[0];

  // Current premium first; its span is blanked so the budget regex can't double-count it.
  let budgetText = text;
  for (const re of CURRENT_PREMIUM_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 10000) {
        out.currentMonthlyPremium = n;
        budgetText = text.slice(0, m.index) + ' '.repeat(m[0].length) + text.slice(m.index + m[0].length);
        break;
      }
    }
  }

  const medigap = MEDIGAP_RE.test(text);
  const ma = MA_RE.test(text);
  if (medigap !== ma) out.currentCoverage = medigap ? 'ORIGINAL_PLUS_MEDIGAP' : 'MA';

  for (const re of BUDGET_PATTERNS) {
    const m = budgetText.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 10000) {
        out.maxMonthlyPremium = n;
        break;
      }
    }
  }

  const drugs = new Set<string>();
  for (const key of drugKeys()) {
    if (new RegExp(`\\b${escapeRe(key)}\\b`, 'i').test(text)) drugs.add(key);
  }
  for (const [brand, generic] of Object.entries(BRAND_ALIASES)) {
    if (new RegExp(`\\b${brand}\\b`, 'i').test(text)) drugs.add(generic);
  }
  if (drugs.size) out.drugs = Array.from(drugs);

  const extras = EXTRA_PATTERNS.filter(([, re]) => re.test(text)).map(([e]) => e);
  if (extras.length) out.extrasWanted = extras;

  return out;
}

const ARRAY_KEYS = [
  'drugs',
  'doctors',
  'extrasWanted',
  'healthNotes',
  'currentPlanLikes',
  'currentPlanConcerns',
] as const;

function normList(list: unknown[]): string[] {
  const seen = new Set<string>();
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const s = v.trim().toLowerCase();
    if (s) seen.add(s);
  }
  return Array.from(seen);
}

/** Scalars last-write-wins; arrays unioned (lowercased); undefined/null never overwrite. */
export function mergeProfile(prev: UserProfile, ...patches: UserProfile[]): UserProfile {
  const out: Record<string, unknown> = {};
  const all = [prev, ...patches].filter((p): p is UserProfile => !!p && typeof p === 'object');
  for (const p of all) {
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined || v === null || v === '') continue;
      if ((ARRAY_KEYS as readonly string[]).includes(k)) {
        if (!Array.isArray(v)) continue;
        const existing = (out[k] as string[] | undefined) ?? [];
        out[k] = normList([...existing, ...v]);
      } else {
        out[k] = v;
      }
    }
  }
  for (const k of ARRAY_KEYS) {
    if (Array.isArray(out[k]) && (out[k] as unknown[]).length === 0) delete out[k];
  }
  return out as UserProfile;
}

const COVERAGES: CurrentCoverage[] = ['ORIGINAL_MEDICARE', 'ORIGINAL_PLUS_MEDIGAP', 'MA', 'MAPD', 'NONE', 'UNKNOWN'];
const PATHS = ['MA', 'ORIGINAL_MEDICARE', 'UNSURE'] as const;
const PLAN_TYPES: PlanType[] = ['MA_HMO', 'MA_PPO', 'MAPD_HMO', 'MAPD_PPO', 'PDP', 'MEDIGAP'];
const WANTS_TO_CHANGE = ['YES', 'NO', 'UNSURE'] as const;

const isMoney = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10000;
const MAX_ITEMS = 20;
const MAX_LEN = 100;

function sanitizeStrings(v: unknown, lower: boolean): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== 'string') continue;
    let s = item.trim();
    if (!s || s.length > MAX_LEN) continue;
    if (lower) s = s.toLowerCase();
    seen.add(s);
    if (seen.size >= MAX_ITEMS) break;
  }
  return seen.size ? Array.from(seen) : undefined;
}

/** Whitelist + coerce untrusted (model-produced) profile JSON. */
export function sanitizeProfile(raw: unknown): UserProfile {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const r = raw as Record<string, unknown>;
    const out: UserProfile = {};

    if (typeof r.zip === 'string' && /^\d{5}$/.test(r.zip.trim())) out.zip = r.zip.trim();
    if (typeof r.currentCoverage === 'string' && (COVERAGES as string[]).includes(r.currentCoverage)) {
      out.currentCoverage = r.currentCoverage as CurrentCoverage;
    }
    if (typeof r.currentPlanName === 'string') {
      const s = r.currentPlanName.trim();
      if (s && s.length <= MAX_LEN) out.currentPlanName = s;
    }
    if (typeof r.currentCarrier === 'string') {
      const s = r.currentCarrier.trim();
      if (s && s.length <= MAX_LEN) out.currentCarrier = s;
    }
    if (isMoney(r.currentMonthlyPremium)) out.currentMonthlyPremium = r.currentMonthlyPremium;
    if (typeof r.currentPlanType === 'string' && (PLAN_TYPES as string[]).includes(r.currentPlanType)) {
      out.currentPlanType = r.currentPlanType as PlanType;
    }
    if (typeof r.wantsToChange === 'string' && (WANTS_TO_CHANGE as readonly string[]).includes(r.wantsToChange)) {
      out.wantsToChange = r.wantsToChange as UserProfile['wantsToChange'];
    }
    if (typeof r.preferredPath === 'string' && (PATHS as readonly string[]).includes(r.preferredPath)) {
      out.preferredPath = r.preferredPath as UserProfile['preferredPath'];
    }
    if (isMoney(r.maxMonthlyPremium)) out.maxMonthlyPremium = r.maxMonthlyPremium;
    if (typeof r.wantsKeepDoctors === 'boolean') out.wantsKeepDoctors = r.wantsKeepDoctors;
    if (typeof r.travelsOften === 'boolean') out.travelsOften = r.travelsOften;

    const drugs = sanitizeStrings(r.drugs, true);
    if (drugs) out.drugs = drugs;
    const doctors = sanitizeStrings(r.doctors, false);
    if (doctors) out.doctors = doctors;
    const notes = sanitizeStrings(r.healthNotes, false);
    if (notes) out.healthNotes = notes;
    const likes = sanitizeStrings(r.currentPlanLikes, false);
    if (likes) out.currentPlanLikes = likes;
    const concerns = sanitizeStrings(r.currentPlanConcerns, false);
    if (concerns) out.currentPlanConcerns = concerns;
    const extras = sanitizeStrings(r.extrasWanted, true)?.filter((e): e is Extra =>
      (EXTRAS as string[]).includes(e),
    );
    if (extras && extras.length) out.extrasWanted = extras;

    return out;
  } catch {
    return {};
  }
}
