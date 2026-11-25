export class StreamAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamAbortError';
  }
}

export function isCppSpace(ch: string): boolean {
  return (
    ch === ' ' ||
    ch === '\t' ||
    ch === '\n' ||
    ch === '\r' ||
    ch === '\v' ||
    ch === '\f'
  );
}

function isDigitForRadix(ch: string, radix: number): boolean {
  const code = ch.charCodeAt(0);
  if (radix === 8) return code >= 48 && code <= 55;
  if (radix === 10) return code >= 48 && code <= 57;
  if (radix === 16) {
    return (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 70) ||
      (code >= 97 && code <= 102)
    );
  }
  return false;
}

export interface StreamFormatFlags {
  fixed: boolean;
  scientific: boolean;
  precision: number | null;
  width: number | null;
  fillChar: string;
  alignLeft: boolean;
  boolAlpha: boolean;
  base: 10 | 16 | 8;
}

export function createDefaultFormatFlags(): StreamFormatFlags {
  return {
    fixed: false,
    scientific: false,
    precision: null,
    width: null,
    fillChar: ' ',
    alignLeft: false,
    boolAlpha: false,
    base: 10,
  };
}

/**
 * Unified character-cursor stream buffer used by:
 * - Interactive std::cin and C stdio (scanf, getchar, fgets)
 * - Non-interactive std::istringstream / std::stringstream
 * - Virtual-FS backed std::ifstream / std::fstream
 */
export class CharStreamBuffer {
  private buffer: string;
  private pos = 0;
  private closed: boolean;
  private readonly interactive: boolean;
  private waiters: Array<() => void> = [];
  private onBeforeWait?: () => void;

  eofbit = false;
  failbit = false;
  badbit = false;

  constructor(options?: {
    initial?: string;
    interactive?: boolean;
    onBeforeWait?: () => void;
  }) {
    this.buffer = options?.initial ?? '';
    this.interactive = options?.interactive ?? false;
    this.closed = !this.interactive;
    this.onBeforeWait = options?.onBeforeWait;
  }

  good(): boolean {
    return !this.eofbit && !this.failbit && !this.badbit;
  }

  eof(): boolean {
    return this.eofbit;
  }

  fail(): boolean {
    return this.failbit || this.badbit;
  }

  bad(): boolean {
    return this.badbit;
  }

  isOk(): boolean {
    return !this.failbit && !this.badbit;
  }

  clear(): void {
    this.eofbit = false;
    this.failbit = false;
    this.badbit = false;
  }

  setContent(text: string): void {
    this.buffer = text;
    this.pos = 0;
    this.clear();
  }

  appendContent(text: string): void {
    this.buffer += text;
    this.eofbit = false;
  }

  getContent(): string {
    return this.buffer;
  }

  push(text: string): void {
    if (this.closed) return;
    this.buffer += text;
    this.notify();
  }

  close(): void {
    this.closed = true;
    this.notify();
  }

  private notify(): void {
    const list = this.waiters.splice(0, this.waiters.length);
    for (const resolve of list) resolve();
  }

  private async ensureAvailable(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) {
      throw new StreamAbortError('Остановлено пользователем');
    }
    if (this.pos < this.buffer.length) {
      return true;
    }
    if (this.closed) {
      return false;
    }

    // Tie mechanism: flush/notify UI and yield a macrotask so prompt renders before blocking
    this.onBeforeWait?.();
    await new Promise<void>((r) => setTimeout(r, 0));

    if (signal.aborted) {
      throw new StreamAbortError('Остановлено пользователем');
    }
    if (this.pos < this.buffer.length) {
      return true;
    }
    if (this.closed) {
      return false;
    }

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const idx = this.waiters.indexOf(onReady);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new StreamAbortError('Остановлено пользователем'));
      };
      const onReady = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(onReady);
    });

    return this.pos < this.buffer.length;
  }

  private async ensureAtOffset(offset: number, signal: AbortSignal): Promise<boolean> {
    while (this.pos + offset >= this.buffer.length) {
      if (this.closed) return false;
      const got = await this.ensureAvailable(signal);
      if (!got) return false;
    }
    return true;
  }

  /**
   * std::ws — skips all leading whitespace characters without setting failbit.
   * Sets eofbit only if EOF is encountered while skipping whitespace.
   */
  async skipWhitespace(signal: AbortSignal): Promise<void> {
    if (this.fail()) return;
    while (true) {
      while (this.pos < this.buffer.length && isCppSpace(this.buffer[this.pos])) {
        this.pos += 1;
      }
      if (this.pos < this.buffer.length) {
        return;
      }
      if (this.closed) {
        this.eofbit = true;
        return;
      }
      await this.ensureAvailable(signal);
    }
  }

  /**
   * Non-greedy C++ numeric extractor (supports glued tokens like `12+34` and `12.5*.5`).
   * Rolls back cursor and sets failbit=true if no valid digits are found.
   */
  async extractNumber(
    isFloat: boolean,
    radix: 8 | 10 | 16,
    signal: AbortSignal
  ): Promise<number | null> {
    if (this.fail()) return null;

    await this.skipWhitespace(signal);
    if (this.pos >= this.buffer.length) {
      this.eofbit = true;
      this.failbit = true;
      return null;
    }

    const savedPos = this.pos;
    let raw = '';

    // Optional leading sign (+ or -)
    const first = this.buffer[this.pos];
    if (first === '+' || first === '-') {
      raw += first;
      this.pos += 1;
      await this.ensureAtOffset(0, signal);
    }

    if (!isFloat) {
      // Optional 0x / 0X prefix for hex
      if (
        radix === 16 &&
        this.pos < this.buffer.length &&
        this.buffer[this.pos] === '0'
      ) {
        await this.ensureAtOffset(1, signal);
        if (
          this.pos + 1 < this.buffer.length &&
          (this.buffer[this.pos + 1] === 'x' || this.buffer[this.pos + 1] === 'X')
        ) {
          raw += this.buffer[this.pos] + this.buffer[this.pos + 1];
          this.pos += 2;
        }
      }

      let digits = 0;
      while (true) {
        if (this.pos >= this.buffer.length) {
          if (this.closed) break;
          // In interactive line-buffered mode, lines arrive with '\n', so stop if we already have digits and no more chars
          if (digits > 0) break;
          await this.ensureAvailable(signal);
          if (this.pos >= this.buffer.length) break;
        }
        const ch = this.buffer[this.pos];
        if (!isDigitForRadix(ch, radix)) break;
        raw += ch;
        this.pos += 1;
        digits += 1;
      }

      if (digits === 0) {
        this.pos = savedPos;
        this.failbit = true;
        return null;
      }

      if (this.pos >= this.buffer.length && this.closed) {
        this.eofbit = true;
      }

      const parsed = Number.parseInt(raw, radix);
      if (Number.isNaN(parsed)) {
        this.pos = savedPos;
        this.failbit = true;
        return null;
      }
      return parsed;
    }

    // Floating-point extraction: [+-]? ([0-9]+ ('.' [0-9]*)? | '.' [0-9]+) ([eE] [+-]? [0-9]+)?
    let intDigits = 0;
    while (this.pos < this.buffer.length && isDigitForRadix(this.buffer[this.pos], 10)) {
      raw += this.buffer[this.pos];
      this.pos += 1;
      intDigits += 1;
    }

    let fracDigits = 0;
    if (this.pos < this.buffer.length && this.buffer[this.pos] === '.') {
      raw += '.';
      this.pos += 1;
      while (this.pos < this.buffer.length && isDigitForRadix(this.buffer[this.pos], 10)) {
        raw += this.buffer[this.pos];
        this.pos += 1;
        fracDigits += 1;
      }
    }

    if (intDigits + fracDigits === 0) {
      this.pos = savedPos;
      this.failbit = true;
      return null;
    }

    // Optional exponent (only commit if at least one exponent digit follows)
    if (
      this.pos < this.buffer.length &&
      (this.buffer[this.pos] === 'e' || this.buffer[this.pos] === 'E')
    ) {
      const expSavedPos = this.pos;
      let expRaw = this.buffer[this.pos];
      this.pos += 1;
      if (
        this.pos < this.buffer.length &&
        (this.buffer[this.pos] === '+' || this.buffer[this.pos] === '-')
      ) {
        expRaw += this.buffer[this.pos];
        this.pos += 1;
      }
      let expDigits = 0;
      while (this.pos < this.buffer.length && isDigitForRadix(this.buffer[this.pos], 10)) {
        expRaw += this.buffer[this.pos];
        this.pos += 1;
        expDigits += 1;
      }
      if (expDigits > 0) {
        raw += expRaw;
      } else {
        this.pos = expSavedPos;
      }
    }

    if (this.pos >= this.buffer.length && this.closed) {
      this.eofbit = true;
    }

    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      this.pos = savedPos;
      this.failbit = true;
      return null;
    }
    return parsed;
  }

  async extractChar(skipWs: boolean, signal: AbortSignal): Promise<string | null> {
    if (this.fail()) return null;

    if (skipWs) {
      await this.skipWhitespace(signal);
    } else if (this.pos >= this.buffer.length) {
      await this.ensureAvailable(signal);
    }

    if (this.pos >= this.buffer.length) {
      this.eofbit = true;
      this.failbit = true;
      return null;
    }

    const ch = this.buffer[this.pos];
    this.pos += 1;
    return ch;
  }

  async extractWord(signal: AbortSignal): Promise<string | null> {
    if (this.fail()) return null;

    await this.skipWhitespace(signal);
    if (this.pos >= this.buffer.length) {
      this.eofbit = true;
      this.failbit = true;
      return null;
    }

    let word = '';
    while (true) {
      while (this.pos < this.buffer.length && !isCppSpace(this.buffer[this.pos])) {
        word += this.buffer[this.pos];
        this.pos += 1;
      }
      if (this.pos < this.buffer.length) {
        // Stopped at whitespace delimiter; leave delimiter in buffer
        return word;
      }
      if (this.closed) {
        this.eofbit = true;
        return word;
      }
      await this.ensureAvailable(signal);
    }
  }

  async readLine(signal: AbortSignal, delim = '\n'): Promise<string | null> {
    if (this.fail()) return null;

    if (this.pos >= this.buffer.length) {
      const got = await this.ensureAvailable(signal);
      if (!got) {
        this.eofbit = true;
        this.failbit = true;
        return null;
      }
    }

    let line = '';
    while (true) {
      while (this.pos < this.buffer.length) {
        const ch = this.buffer[this.pos];
        this.pos += 1;
        if (ch === delim) {
          if (delim === '\n' && line.endsWith('\r')) {
            line = line.slice(0, -1);
          }
          return line;
        }
        line += ch;
      }
      if (this.closed) {
        this.eofbit = true;
        return line;
      }
      await this.ensureAvailable(signal);
    }
  }

  /**
   * C fgets(buf, maxCount, stdin): reads up to maxCount - 1 characters,
   * stopping after '\n' (which IS included in the returned string) or EOF.
   */
  async readFgets(maxCount: number, signal: AbortSignal): Promise<string | null> {
    if (maxCount <= 1) return '';
    if (this.pos >= this.buffer.length) {
      const got = await this.ensureAvailable(signal);
      if (!got) {
        this.eofbit = true;
        return null;
      }
    }

    let out = '';
    const limit = maxCount - 1;
    while (out.length < limit) {
      if (this.pos >= this.buffer.length) {
        if (this.closed) {
          this.eofbit = true;
          break;
        }
        await this.ensureAvailable(signal);
        if (this.pos >= this.buffer.length) break;
      }
      const ch = this.buffer[this.pos];
      this.pos += 1;
      out += ch;
      if (ch === '\n') break;
    }
    return out;
  }

  async peekChar(signal: AbortSignal): Promise<number> {
    if (this.fail()) return -1;
    if (this.pos >= this.buffer.length) {
      const got = await this.ensureAvailable(signal);
      if (!got) {
        this.eofbit = true;
        return -1;
      }
    }
    return this.buffer.charCodeAt(this.pos);
  }

  async getCharCode(signal: AbortSignal): Promise<number> {
    const ch = await this.extractChar(false, signal);
    return ch === null ? -1 : ch.charCodeAt(0);
  }

  putback(ch: string): void {
    this.eofbit = false;
    if (this.fail()) return;
    const single = ch.length > 0 ? ch[0] : '\0';
    if (this.pos > 0) {
      this.pos -= 1;
      this.buffer =
        this.buffer.slice(0, this.pos) + single + this.buffer.slice(this.pos + 1);
    } else {
      this.buffer = single + this.buffer;
      this.pos = 0;
    }
  }

  unget(): void {
    this.eofbit = false;
    if (this.fail()) return;
    if (this.pos > 0) {
      this.pos -= 1;
    } else {
      this.failbit = true;
    }
  }

  async ignore(count: number, delimCode: number | null, signal: AbortSignal): Promise<void> {
    if (this.fail()) return;
    let remaining = count;
    while (remaining > 0) {
      if (this.pos >= this.buffer.length) {
        const got = await this.ensureAvailable(signal);
        if (!got) {
          this.eofbit = true;
          return;
        }
      }
      const chCode = this.buffer.charCodeAt(this.pos);
      this.pos += 1;
      remaining -= 1;
      if (delimCode !== null && chCode === delimCode) {
        return;
      }
    }
  }
}
