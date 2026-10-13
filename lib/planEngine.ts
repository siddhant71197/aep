import type { Extra, Plan, RankedPlan, UserProfile } from './types';
import { getCatalog } from './catalog';

const MOOP_MIN = 3000;
const MOOP_MAX = 9350;

const isMA = (p: Plan) => p.type.startsWith('MA_') || p.type.startsWith('MAPD_');
const isOriginal = (p: Plan) => p.type === 'PDP' || p.type === 'MEDIGAP';

function money(n: number): string {
  const s = Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2);
  return `$${s}`;
}

function mentionsVA(notes: string[] | undefined): boolean {
  return (notes ?? []).some((n) => /\b(va|veterans?|tricare)\b/i.test(n));
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} & ${items[items.length - 1]}`;
}

function filterPlans(profile: UserProfile, catalog: Plan[]): Plan[] {
  const zip = profile.zip?.trim();
  const prefix = zip ? zip.slice(0, 3) : undefined;
  const drugs = (profile.drugs ?? []).filter((d) => d.trim());
  return catalog.filter((p) => {
    if (prefix && p.serviceZipPrefixes.length > 0 && !p.serviceZipPrefixes.includes(prefix)) return false;
    if (profile.preferredPath === 'MA' && !isMA(p)) return false;
    if (profile.preferredPath === 'ORIGINAL_MEDICARE' && !isOriginal(p)) return false;
    if (
      profile.preferredPath === 'MA' &&
      drugs.length > 0 &&
      p.type === 'MA_PPO' &&
      !p.includesDrugCoverage &&
      !mentionsVA(profile.healthNotes)
    ) {
      return false;
    }
    return true;
  });
}

function scorePlan(plan: Plan, profile: UserProfile): RankedPlan {
  let score = 50;
  const reasons: string[] = [];

  // Budget
  const budget = profile.maxMonthlyPremium;
  if (typeof budget === 'number' && Number.isFinite(budget)) {
    const premium = plan.monthlyPremium;
    if (premium <= budget) {
      const headroom = budget > 0 ? (budget - premium) / budget : 1;
      score += 15 * headroom;
      reasons.push(`${money(premium)} premium within your ${money(budget)} budget`);
    } else {
      const ratio = (premium - budget) / Math.max(budget, 1);
      score -= Math.min(30, 20 * ratio);
      reasons.push(`${money(premium)} premium is over your ${money(budget)} budget`);
    }
  } else if (plan.monthlyPremium === 0) {
    reasons.push('$0 monthly premium');
  }

  // Compared with the user's current plan
  const current = profile.currentMonthlyPremium;
  if (typeof current === 'number' && Number.isFinite(current) && plan.monthlyPremium < current) {
    const diff = Math.round((current - plan.monthlyPremium) * 100) / 100;
    reasons.push(`${money(diff)}/mo less than your current plan`);
  }

  // Drugs
  const drugs = Array.from(new Set((profile.drugs ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean)));
  if (drugs.length > 0) {
    if (plan.type === 'MEDIGAP') {
      reasons.push('Medigap has no drug coverage, pair it with a Part D plan');
    } else if (plan.includesDrugCoverage) {
      for (const drug of drugs) {
        const tier = plan.formulary[drug];
        if (tier === undefined) {
          score -= 10;
          reasons.push(`Doesn't cover ${drug}`);
        } else {
          score += tier <= 2 ? 8 : tier === 3 ? 4 : 1;
          reasons.push(`Covers ${drug} (Tier ${tier})`);
        }
      }
    } else {
      reasons.push('No Part D drug coverage');
    }
  }

  // Doctors / travel
  if (profile.wantsKeepDoctors || profile.travelsOften) {
    const why = profile.travelsOften && !profile.wantsKeepDoctors ? 'travel' : 'keeping your doctors';
    if (plan.type === 'MEDIGAP') {
      score += 12;
      reasons.push(`Any doctor that accepts Medicare, good for ${why}`);
    } else if (plan.networkType === 'PPO') {
      score += 10;
      reasons.push(`PPO covers out-of-network care, good for ${why}`);
    } else if (plan.networkType === 'HMO') {
      score -= 8;
      reasons.push('HMO limits you to in-network doctors');
    }
  }

  // Extras
  const wanted = Array.from(new Set(profile.extrasWanted ?? [])) as Extra[];
  const matched = wanted.filter((e) => plan.extras[e]);
  if (matched.length > 0) {
    score += 4 * matched.length;
    reasons.push(`Includes ${joinList(matched)}`);
  }

  // Stars
  score += (plan.starRating - 3) * 5;
  if (plan.starRating >= 4) reasons.push(`${plan.starRating}★ rating`);

  // MOOP
  if (plan.type === 'MEDIGAP') {
    score += 6;
  } else if (plan.moop !== null) {
    const norm = (MOOP_MAX - plan.moop) / (MOOP_MAX - MOOP_MIN);
    score += 8 * Math.min(1, Math.max(0, norm));
    if (plan.moop <= 5000) reasons.push(`Low ${money(plan.moop)} out-of-pocket max`);
  }

  return { plan, score: Math.round(score * 10) / 10, reasons };
}

export function rankPlans(profile: UserProfile, catalog: Plan[] = getCatalog()): RankedPlan[] {
  return filterPlans(profile, catalog)
    .map((p) => scorePlan(p, profile))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.plan.monthlyPremium - b.plan.monthlyPremium ||
        (a.plan.id < b.plan.id ? -1 : a.plan.id > b.plan.id ? 1 : 0),
    );
}

/** True once the user's current plan/coverage is known (Stage 1 complete). */
export function isCurrentPlanKnown(profile: UserProfile): boolean {
  return (
    !!profile.currentPlanName ||
    !!profile.currentCarrier ||
    (profile.currentCoverage !== undefined && profile.currentCoverage !== 'UNKNOWN')
  );
}

/**
 * Enough info to proactively recommend plans: current plan known, ZIP, and at least two
 * need signals. False when the user said they want to keep their plan (the every-3-turns
 * cadence rule still applies separately).
 */
export function isProfileSufficient(profile: UserProfile): boolean {
  if (profile.wantsToChange === 'NO') return false;
  if (!isCurrentPlanKnown(profile)) return false;
  if (!profile.zip) return false;
  const signals = [
    profile.maxMonthlyPremium !== undefined,
    (profile.drugs?.length ?? 0) > 0,
    (profile.doctors?.length ?? 0) > 0 || profile.wantsKeepDoctors !== undefined,
    (profile.extrasWanted?.length ?? 0) > 0,
    profile.preferredPath !== undefined && profile.preferredPath !== 'UNSURE',
    (profile.currentCoverage !== undefined && profile.currentCoverage !== 'UNKNOWN') || !!profile.currentPlanName,
  ];
  return signals.filter(Boolean).length >= 2;
}
