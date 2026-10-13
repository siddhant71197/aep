'use client';

import { useSyncExternalStore } from 'react';

export const LEAD_SUBMITTED_KEY = 'aep-lead-submitted';
const LEAD_EVENT = 'aep-lead-submitted-change';

function subscribe(cb: () => void) {
  window.addEventListener('storage', cb);
  window.addEventListener(LEAD_EVENT, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(LEAD_EVENT, cb);
  };
}

function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(LEAD_SUBMITTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Hydration-safe read of the "lead submitted" flag (false on the server). */
export function useLeadSubmitted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function markLeadSubmitted() {
  try {
    window.localStorage.setItem(LEAD_SUBMITTED_KEY, '1');
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(LEAD_EVENT));
}

interface InsuranceAdBannerProps {
  submitted: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}

export default function InsuranceAdBanner({ submitted, onOpen, onDismiss }: InsuranceAdBannerProps) {
  if (submitted) {
    return (
      <div className="mx-3 mb-1 sm:mx-5" role="status">
        <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success-soft px-3 py-2 text-sm text-fg">
          <span aria-hidden="true" className="text-success">
            ✓
          </span>
          Thanks — an agent will reach out soon.
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in relative mx-3 mb-1 sm:mx-5">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Sponsored: Compare 2027 Medicare plans with a licensed agent — free, no obligation. Get my quote"
        className="group flex w-full items-center gap-3 rounded-xl border border-accent/25 bg-linear-to-r from-accent-soft to-teal-soft py-2.5 pl-3 pr-10 text-left transition hover:border-accent/50 hover:shadow-sm"
      >
        <span aria-hidden="true" className="text-xl leading-none">
          🛡️
        </span>
        <span className="min-w-0 flex-1">
          <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-muted">
            Sponsored
          </span>
          <span className="block text-sm leading-snug text-fg">
            Compare 2027 Medicare plans with a licensed agent — free, no obligation.{' '}
            <span className="whitespace-nowrap font-semibold text-accent group-hover:underline">
              Get my quote →
            </span>
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss sponsored message"
        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none text-muted transition hover:bg-surface hover:text-fg"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
