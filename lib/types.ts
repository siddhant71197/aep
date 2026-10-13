// Shared contract between engine, server and UI. Change only via the lead.

export type PlanType = 'MA_HMO' | 'MA_PPO' | 'MAPD_HMO' | 'MAPD_PPO' | 'PDP' | 'MEDIGAP';
export type Extra = 'dental' | 'vision' | 'hearing' | 'otc' | 'fitness';
export const EXTRAS: Extra[] = ['dental', 'vision', 'hearing', 'otc', 'fitness'];

export interface Plan {
  id: string;
  name: string;
  carrier: string;
  type: PlanType;
  monthlyPremium: number;
  deductible: number;
  drugDeductible: number | null; // null when no drug coverage
  moop: number | null; // null for PDP / Medigap
  medigapLetter?: 'G' | 'N' | 'F';
  includesDrugCoverage: boolean;
  formulary: Record<string, 1 | 2 | 3 | 4 | 5>; // lowercase generic name -> tier
  starRating: number; // 1–5, step 0.5
  extras: Partial<Record<Extra, string>>; // short description per included extra
  networkType: 'HMO' | 'PPO' | 'ANY_MEDICARE_PROVIDER' | 'N/A';
  outOfNetworkCoverage: boolean;
  serviceZipPrefixes: string[]; // 3-digit prefixes; empty = available nationwide
  counties: string[];
  highlights: string[];
}

export type CurrentCoverage =
  | 'ORIGINAL_MEDICARE'
  | 'ORIGINAL_PLUS_MEDIGAP'
  | 'MA'
  | 'MAPD'
  | 'NONE'
  | 'UNKNOWN';

export interface UserProfile {
  zip?: string;
  currentCoverage?: CurrentCoverage;
  currentPlanName?: string;
  currentCarrier?: string;
  currentMonthlyPremium?: number;
  currentPlanType?: PlanType;
  currentPlanLikes?: string[];
  currentPlanConcerns?: string[]; // e.g. "premium went up", "doctor left network"
  wantsToChange?: 'YES' | 'NO' | 'UNSURE';
  preferredPath?: 'MA' | 'ORIGINAL_MEDICARE' | 'UNSURE';
  maxMonthlyPremium?: number;
  drugs?: string[]; // lowercase generic names
  doctors?: string[];
  wantsKeepDoctors?: boolean;
  extrasWanted?: Extra[];
  healthNotes?: string[];
  travelsOften?: boolean;
}

export interface RankedPlan {
  plan: Plan;
  score: number;
  reasons: string[];
}

export interface PlanSuggestion {
  planId: string;
  reason: string;
}

export type SuggestionWithPlan = PlanSuggestion & { plan: Plan };
export type SuggestionSource = 'model' | 'fallback';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  suggestions?: SuggestionWithPlan[];
  suggestionSource?: SuggestionSource;
  createdAt: number;
}

export interface ChatRequest {
  messages: ChatMessage[];
  profile: UserProfile;
  /** Opening turn: `messages` is empty and the model generates the greeting. */
  start?: boolean;
}

export type StreamEvent =
  | { type: 'meta'; userTurn: number; mustSuggest: boolean; profileSufficient: boolean }
  | { type: 'text'; delta: string }
  | { type: 'profile'; profile: UserProfile }
  | { type: 'suggestions'; items: SuggestionWithPlan[]; source: SuggestionSource }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface LeadInput {
  name: string;
  email: string;
  zip: string;
}
export interface Lead extends LeadInput {
  id: string;
  createdAt: string;
  source: 'chat_ad';
}
export type ValidationErrors = Partial<Record<keyof LeadInput, string>>;

export interface CadenceState {
  userTurn: number;
  turnsSinceLastSuggestion: number;
  mustSuggest: boolean;
}
