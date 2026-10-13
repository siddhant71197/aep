'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import type { ChatMessage } from '@/lib/types';
import MessageBubble from './MessageBubble';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onAsk: (text: string) => void;
  onQuote: () => void;
  /** Rendered after the messages (e.g. starter chips). */
  footer?: ReactNode;
}

function TypingIndicator() {
  return (
    <div className="fade-in flex items-center gap-2.5" role="status" aria-label="AEP Guide is typing">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-sm"
      >
        🩺
      </span>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md bg-assistant px-4 py-3.5">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  );
}

export default function MessageList({
  messages,
  isStreaming,
  onAsk,
  onQuote,
  footer,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const last = messages[messages.length - 1];
  const showTyping =
    isStreaming && last?.role === 'assistant' && !last.content && !last.suggestions?.length;

  // Track total content so streaming deltas also keep us pinned to the bottom.
  const contentSignature = `${messages.length}:${last?.content.length ?? 0}:${
    last?.suggestions?.length ?? 0
  }:${showTyping}:${footer ? 1 : 0}`;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: isStreaming ? 'auto' : 'smooth' });
  }, [contentSignature, isStreaming]);

  return (
    <div
      ref={scrollRef}
      className="scroll-area flex-1 overflow-y-auto px-3 py-4 sm:px-5"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-busy={isStreaming}
    >
      {messages.length > 0 && (
        <div className="flex flex-col gap-4">
          {messages.map((m) =>
            showTyping && m === last ? null : (
              <MessageBubble
                key={m.id}
                message={m}
                onAsk={onAsk}
                onQuote={onQuote}
                isStreaming={isStreaming}
              />
            ),
          )}
          {showTyping && <TypingIndicator />}
        </div>
      )}
      {footer}
    </div>
  );
}
