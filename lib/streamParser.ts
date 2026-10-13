export type TagName = 'profile' | 'plan_suggestions';

export type ParsedPiece =
  | { kind: 'text'; text: string }
  | { kind: 'tag'; name: TagName; body: string };

const TAG_NAMES: TagName[] = ['profile', 'plan_suggestions'];
const OPEN_TAGS = TAG_NAMES.map((n) => `<${n}>`);

/** Remove ``` / ```json fences and surrounding whitespace from a tag body. */
export function stripFences(body: string): string {
  let s = body.trim();
  s = s.replace(/^```[a-zA-Z]*\s*/, '');
  s = s.replace(/\s*```$/, '');
  return s.trim();
}

/** Trim trailing whitespace (useful for the visible text before a trailing tag). */
export function stripTrailingWs(s: string): string {
  return s.replace(/\s+$/, '');
}

/**
 * Incremental parser that splits a streamed LLM reply into visible text and
 * `<profile>` / `<plan_suggestions>` tag bodies. Tag content never leaks as text.
 */
export class TagStreamParser {
  private buf = '';
  private current: TagName | null = null;

  push(chunk: string): ParsedPiece[] {
    this.buf += chunk;
    const out: ParsedPiece[] = [];
     
    while (true) {
      if (this.current === null) {
        // Find earliest complete opening tag.
        let best = -1;
        let bestName: TagName | null = null;
        for (let i = 0; i < TAG_NAMES.length; i++) {
          const idx = this.buf.indexOf(OPEN_TAGS[i]);
          if (idx !== -1 && (best === -1 || idx < best)) {
            best = idx;
            bestName = TAG_NAMES[i];
          }
        }
        if (bestName !== null) {
          this.emitText(out, this.buf.slice(0, best));
          this.buf = this.buf.slice(best + bestName.length + 2);
          this.current = bestName;
          continue;
        }
        // Hold back the longest suffix that could be the start of an opening tag.
        const hold = this.holdBackLength();
        this.emitText(out, this.buf.slice(0, this.buf.length - hold));
        this.buf = this.buf.slice(this.buf.length - hold);
        return out;
      } else {
        const close = `</${this.current}>`;
        const idx = this.buf.indexOf(close);
        if (idx === -1) return out;
        out.push({ kind: 'tag', name: this.current, body: stripFences(this.buf.slice(0, idx)) });
        this.buf = this.buf.slice(idx + close.length);
        this.current = null;
      }
    }
  }

  end(): ParsedPiece[] {
    const out: ParsedPiece[] = [];
    if (this.current === null) {
      this.emitText(out, this.buf);
    } else {
      // Unterminated tag: drop any partial closing tag and emit what we have.
      let body = this.buf;
      const close = `</${this.current}>`;
      for (let k = Math.min(close.length - 1, body.length); k > 0; k--) {
        if (body.endsWith(close.slice(0, k))) {
          body = body.slice(0, body.length - k);
          break;
        }
      }
      out.push({ kind: 'tag', name: this.current, body: stripFences(body) });
    }
    this.buf = '';
    this.current = null;
    return out;
  }

  private holdBackLength(): number {
    let max = 0;
    for (const tag of OPEN_TAGS) {
      const lim = Math.min(tag.length - 1, this.buf.length);
      for (let k = lim; k > max; k--) {
        if (this.buf.endsWith(tag.slice(0, k))) {
          max = k;
          break;
        }
      }
    }
    return max;
  }

  private emitText(out: ParsedPiece[], text: string) {
    if (text.length > 0) out.push({ kind: 'text', text });
  }
}
