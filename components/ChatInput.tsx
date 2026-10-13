'use client';

import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
}

const MAX_HEIGHT = 180;

export default function ChatInput({ onSend, onStop, isStreaming }: ChatInputProps) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea to fit its content.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  const canSend = value.trim().length > 0 && !isStreaming;

  const submit = () => {
    if (!canSend) return;
    onSend(value);
    setValue('');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={onSubmit} className="px-3 pb-3 pt-2 sm:px-5 sm:pb-4">
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface-2 p-1.5 pl-3 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
        <label htmlFor="chat-input" className="sr-only">
          Message AEP Plan Guide
        </label>
        <textarea
          id="chat-input"
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about plans, drugs, doctors, costs…"
          className="max-h-[180px] min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 text-fg outline-none placeholder:text-muted focus-visible:outline-none"
          autoComplete="off"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm font-medium text-fg transition hover:bg-surface-2"
          >
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-fg" />
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
              <path d="M3.4 2.6a.75.75 0 0 0-1 .9l1.9 6.5-1.9 6.5a.75.75 0 0 0 1 .9l14-6.75a.75.75 0 0 0 0-1.35L3.4 2.6Zm2.1 8.15-1.27 4.33L14.9 10 4.23 4.92 5.5 9.25h5.75a.75.75 0 0 1 0 1.5H5.5Z" />
            </svg>
          </button>
        )}
      </div>
      <p className="mt-2 text-center text-[11px] leading-snug text-muted">
        AEP Guide is an AI assistant, not a licensed agent. Not affiliated with Medicare or CMS.
      </p>
    </form>
  );
}
