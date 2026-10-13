'use client';

import { useCallback, useState } from 'react';
import { useChat } from '@/hooks/useChat';
import type { CurrentCoverage, UserProfile } from '@/lib/types';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import InsuranceAdBanner, { useLeadSubmitted } from './InsuranceAdBanner';
import LeadFormModal from './LeadFormModal';

// Quick replies to the greeting's "what's your current plan?" question (user inputs, not bot text).
const STARTERS = [
  'I have a Medicare Advantage plan',
  'I have Original Medicare + Medigap',
  'I have a Part D drug plan',
  "I'm not sure what I have",
];

const COVERAGE_LABEL: Record<CurrentCoverage, string | null> = {
  ORIGINAL_MEDICARE: 'Original Medicare',
  ORIGINAL_PLUS_MEDIGAP: 'Original + Medigap',
  MA: 'Medicare Advantage',
  MAPD: 'Medicare Advantage + Rx',
  NONE: 'No coverage yet',
  UNKNOWN: null,
};

function profileSummary(p: UserProfile): string[] {
  const parts: string[] = [];
  if (p.zip) parts.push(`ZIP ${p.zip}`);
  if (p.currentCoverage && COVERAGE_LABEL[p.currentCoverage]) {
    parts.push(COVERAGE_LABEL[p.currentCoverage]!);
  }
  if (p.drugs?.length) parts.push(`${p.drugs.length} drug${p.drugs.length === 1 ? '' : 's'}`);
  if (p.doctors?.length) {
    parts.push(`${p.doctors.length} doctor${p.doctors.length === 1 ? '' : 's'}`);
  }
  if (typeof p.maxMonthlyPremium === 'number') parts.push(`$${p.maxMonthlyPremium}/mo budget`);
  if (p.extrasWanted?.length) parts.push(`wants ${p.extrasWanted.join(', ')}`);
  if (p.travelsOften) parts.push('travels often');
  return parts;
}

function Starters({ onPick, disabled }: { onPick: (t: string) => void; disabled: boolean }) {
  return (
    <ul className="fade-in mt-4 flex flex-wrap gap-2 pl-9" aria-label="Quick answers about your current plan">
      {STARTERS.map((s) => (
        <li key={s}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            className="rounded-full border border-border bg-surface px-3.5 py-2 text-sm text-fg transition hover:border-accent hover:bg-accent-soft hover:text-accent disabled:opacity-50"
          >
            {s}
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function ChatWindow() {
  const { messages, profile, isStreaming, error, send, stop, reset, dismissError } = useChat();
  const leadSubmitted = useLeadSubmitted();
  const [leadOpen, setLeadOpen] = useState(false);
  // Ad stays hidden until a newer assistant suggestion set appears than when dismissed.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const suggestionCount = messages.filter(
    (m) => m.role === 'assistant' && (m.suggestions?.length ?? 0) > 0,
  ).length;
  const adVisible = dismissedAt === null || suggestionCount > dismissedAt;

  const summary = profileSummary(profile);
  // Starter chips stay until the user sends their first message (shown once the greeting settles).
  const showStarters = !isStreaming && !messages.some((m) => m.role === 'user');

  const onAsk = useCallback((text: string) => void send(text), [send]);
  const openLead = useCallback(() => setLeadOpen(true), []);

  const onReset = () => {
    reset();
    setDismissedAt(null);
  };

  return (
    <main className="flex h-dvh w-full justify-center sm:p-4">
      <div className="shadow-card flex h-full w-full max-w-[760px] flex-col overflow-hidden border-border bg-surface sm:rounded-2xl sm:border">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-accent to-teal text-lg text-white"
          >
            ✚
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-fg">AEP Plan Guide</h1>
            <p className="truncate text-xs text-muted">Medicare Annual Enrollment · Oct 15 – Dec 7</p>
          </div>
          <button
            type="button"
            onClick={onReset}
            disabled={messages.length === 0 && summary.length === 0 && !error}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface-2 disabled:opacity-40"
          >
            New chat
          </button>
        </header>

        {summary.length > 0 && (
          <div className="border-b border-border bg-surface-2 px-4 py-1.5 text-xs text-muted sm:px-5">
            <span className="font-semibold text-fg">What I know:</span> {summary.join(' · ')}
          </div>
        )}

        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          onAsk={onAsk}
          onQuote={openLead}
          footer={showStarters ? <Starters onPick={onAsk} disabled={isStreaming} /> : null}
        />

        {error && (
          <div
            role="alert"
            className="mx-3 mb-2 flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger sm:mx-5"
          >
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={dismissError}
              aria-label="Dismiss error"
              className="leading-none opacity-70 hover:opacity-100"
            >
              ×
            </button>
          </div>
        )}

        {(leadSubmitted || adVisible) && (
          <InsuranceAdBanner
            submitted={leadSubmitted}
            onOpen={openLead}
            onDismiss={() => setDismissedAt(suggestionCount)}
          />
        )}

        <ChatInput onSend={onAsk} onStop={stop} isStreaming={isStreaming} />
      </div>

      <LeadFormModal
        open={leadOpen}
        onClose={() => setLeadOpen(false)}
        defaultZip={profile.zip}
      />
    </main>
  );
}
