import type { Plan } from './types';
import plansJson from './plans.json';

const CATALOG: Plan[] = plansJson as unknown as Plan[];
const BY_ID = new Map<string, Plan>(CATALOG.map((p) => [p.id, p]));

export function getCatalog(): Plan[] {
  return CATALOG;
}

export function getPlanById(id: string): Plan | undefined {
  return BY_ID.get(id);
}
