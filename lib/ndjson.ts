// Client-safe: no node imports.
import type { StreamEvent } from './types';

const encoder = new TextEncoder();

export function encodeEvent(e: StreamEvent): Uint8Array {
  return encoder.encode(JSON.stringify(e) + '\n');
}

export async function* readNdjson(stream: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) yield JSON.parse(line) as StreamEvent;
      }
    }
    buf += decoder.decode();
    const rest = buf.trim();
    if (rest) yield JSON.parse(rest) as StreamEvent;
  } finally {
    reader.releaseLock();
  }
}
