'use client';

import type { Plan, SuggestionWithPlan } from '@/lib/types';

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);

export function planTypeLabel(plan: Plan): string {
  switch (plan.type) {
    case 'MA_HMO':
      return 'Medicare Advantage HMO';
    case 'MA_PPO':
      return 'Medicare Advantage PPO';
    case 'MAPD_HMO':
      return 'Medicare Advantage HMO + Rx';
    case 'MAPD_PPO':
      return 'Medicare Advantage PPO + Rx';
    case 'PDP':
      return 'Part D';
    case 'MEDIGAP':
      return plan.medigapLetter ? `Medigap Plan ${plan.medigapLetter}` : 'Medigap';
    default:
      return plan.type;
  }
}

function Stars({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  const empty = Math.max(0, 5 - full - (half ? 1 : 0));
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${rating} out of 5 stars`} role="img">
      <span aria-hidden="true" className="tracking-tight">
        <span className="text-star">{'★'.repeat(full)}</span>
        {half && <span className="text-star opacity-60">★</span>}
        <span className="text-border">{'★'.repeat(empty)}</span>
      </span>
      <span aria-hidden="true" className="text-xs font-medium text-muted">
        {rating.toFixed(1)}
      </span>
    </span>
  );
}

const EXTRA_LABELS: Record<string, string> = {
  dental: 'Dental',
  vision: 'Vision',
  hearing: 'Hearing',
  otc: 'OTC allowance',
  fitness: 'Fitness',
};

interface PlanCardProps {
  suggestion: SuggestionWithPlan;
  onAsk: (text: string) => void;
  onQuote: () => void;
  disabled?: boolean;
}

export default function PlanCard({ suggestion, onAsk, onQuote, disabled }: PlanCardProps) {
  const { plan, reason } = suggestion;
  const extras = Object.entries(plan.extras).filter(([, v]) => Boolean(v)) as [string, string][];
  const isMA = plan.type.startsWith('MA');

  return (
    <article
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm"
      aria-label={plan.name}
    >
      <header className="flex flex-col gap-1.5">
        <span
          className={`self-start rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            isMA ? 'bg-accent-soft text-accent' : 'bg-teal-soft text-teal'
          }`}
        >
          {planTypeLabel(plan)}
        </span>
        <h3 className="text-[15px] font-semibold leading-snug text-fg">{plan.name}</h3>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-muted">
          <span>{plan.carrier}</span>
          <Stars rating={plan.starRating} />
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="col-span-2 flex items-baseline gap-1">
          <dt className="sr-only">Monthly premium</dt>
          <dd className="text-2xl font-bold tracking-tight text-fg">{usd(plan.monthlyPremium)}</dd>
          <span className="text-sm text-muted">/mo</span>
        </div>
        <div className="rounded-lg bg-surface-2 px-2.5 py-1.5">
          <dt className="text-[11px] uppercase tracking-wide text-muted">Deductible</dt>
          <dd className="font-medium text-fg">{usd(plan.deductible)}</dd>
        </div>
        {plan.moop !== null ? (
          <div className="rounded-lg bg-surface-2 px-2.5 py-1.5">
            <dt className="text-[11px] uppercase tracking-wide text-muted">Max out-of-pocket</dt>
            <dd className="font-medium text-fg">{usd(plan.moop)}</dd>
          </div>
        ) : plan.drugDeductible !== null ? (
          <div className="rounded-lg bg-surface-2 px-2.5 py-1.5">
            <dt className="text-[11px] uppercase tracking-wide text-muted">Drug deductible</dt>
            <dd className="font-medium text-fg">{usd(plan.drugDeductible)}</dd>
          </div>
        ) : null}
      </dl>

      {extras.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Extra benefits">
          {extras.map(([key, desc]) => (
            <li
              key={key}
              title={desc}
              className="rounded-full border border-border px-2 py-0.5 text-xs text-muted"
            >
              {EXTRA_LABELS[key] ?? key}
            </li>
          ))}
        </ul>
      )}

      {reason && (
        <p className="rounded-lg border-l-4 border-teal bg-teal-soft px-3 py-2 text-sm leading-relaxed text-fg">
          <span className="font-semibold text-teal">Why it fits: </span>
          {reason}
        </p>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-1 min-[420px]:flex-row">
        <button
          type="button"
          onClick={() => onAsk(`Tell me more about ${plan.name}`)}
          disabled={disabled}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-fg transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Ask about this plan
        </button>
        <button
          type="button"
          onClick={onQuote}
          className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg transition hover:bg-accent-strong"
        >
          Get a free quote
        </button>
      </div>
    </article>
  );
}
