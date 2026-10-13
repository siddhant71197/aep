'use client';

import { Fragment, type ReactNode } from 'react';
import type { ChatMessage } from '@/lib/types';
import PlanCard from './PlanCard';

/* ---------- Tiny, safe markdown renderer (no HTML injection) ---------- */

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[]; start: number }
  | { kind: 'h'; text: string };

const UL_RE = /^\s*[-*•]\s+(.*)$/;
const OL_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const H_RE = /^\s{0,3}#{1,6}\s+(.*)$/;

function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };

  for (const line of src.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = H_RE.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: 'h', text: h[1] });
      continue;
    }
    const ul = UL_RE.exec(line);
    if (ul) {
      if (cur?.kind !== 'ul') {
        flush();
        cur = { kind: 'ul', items: [] };
      }
      cur.items.push(ul[1]);
      continue;
    }
    const ol = OL_RE.exec(line);
    if (ol) {
      if (cur?.kind !== 'ol') {
        flush();
        cur = { kind: 'ol', items: [], start: Number(ol[1]) || 1 };
      }
      cur.items.push(ol[2]);
      continue;
    }
    // Indented continuation of a list item.
    if ((cur?.kind === 'ul' || cur?.kind === 'ol') && /^\s{2,}\S/.test(line)) {
      cur.items[cur.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (cur?.kind !== 'p') {
      flush();
      cur = { kind: 'p', lines: [] };
    }
    cur.lines.push(line);
  }
  flush();
  return blocks;
}

function renderInline(text: string): ReactNode[] {
  // Split on **bold** spans; unmatched ** (e.g. mid-stream) stays literal.
  return text.split(/(\*\*[^*\n]+?\*\*)/g).map((part, i) => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h':
            return (
              <p key={i} className="font-semibold">
                {renderInline(b.text)}
              </p>
            );
          case 'ul':
            return (
              <ul key={i} className="flex list-disc flex-col gap-1 pl-5 marker:text-teal">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol
                key={i}
                start={b.start}
                className="flex list-decimal flex-col gap-1 pl-5 marker:font-semibold marker:text-accent"
              >
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ol>
            );
          case 'p':
            return (
              <p key={i}>
                {b.lines.map((l, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {renderInline(l)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}

/* ---------- Bubble ---------- */

interface MessageBubbleProps {
  message: ChatMessage;
  onAsk: (text: string) => void;
  onQuote: () => void;
  isStreaming?: boolean;
}

export default function MessageBubble({ message, onAsk, onQuote, isStreaming }: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <div className="fade-in flex justify-end">
        <div className="bg-user max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] leading-relaxed text-user-fg shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  const suggestions = message.suggestions ?? [];
  return (
    <div className="fade-in flex flex-col items-start gap-3">
      {message.content.trim() && (
        <div className="flex max-w-[92%] gap-2.5">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm"
          >
            🩺
          </span>
          <div className="min-w-0 break-words rounded-2xl rounded-tl-md bg-assistant px-4 py-2.5 text-[15px] leading-relaxed text-fg">
            <span className="sr-only">AEP Guide: </span>
            <Markdown text={message.content} />
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <section className="w-full" aria-label="Plan suggestions">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            {message.suggestionSource === 'fallback' ? 'Plans to consider' : 'Recommended for you'}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {suggestions.map((s) => (
              <PlanCard
                key={s.planId}
                suggestion={s}
                onAsk={onAsk}
                onQuote={onQuote}
                disabled={isStreaming}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Plan details are illustrative — verify on Medicare.gov Plan Finder or call 1-800-MEDICARE.
          </p>
        </section>
      )}
    </div>
  );
}
