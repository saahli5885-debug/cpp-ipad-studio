import type { CompilerDiagnostic } from '../types/compiler';

export type TokenType =
  | 'keyword'
  | 'ident'
  | 'number'
  | 'string'
  | 'char'
  | 'op'
  | 'punct'
  | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export class CompileError extends Error {
  readonly diagnostic: CompilerDiagnostic;

  constructor(
    file: string,
    line: number,
    column: number,
    message: string,
    sourceLines: string[]
  ) {
    super(message);
    this.name = 'CompileError';
    const rawLine = sourceLines[line - 1];
    const linePrefix = `${line} | `;
    const codeSnippet = rawLine !== undefined ? `${linePrefix}${rawLine}` : undefined;
    const caretOffset = Math.max(0, column - 1);
    const caretLine =
      rawLine !== undefined
        ? `${' '.repeat(String(line).length)} | ${' '.repeat(caretOffset)}^`
        : undefined;

    this.diagnostic = {
      id: `browser-err-${line}-${column}`,
      file,
      line,
      column,
      severity: 'error',
      message,
      codeSnippet,
      caretLine,
    };
  }
}

export const CPP_KEYWORDS = new Set([
  'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const',
  'constexpr', 'continue', 'default', 'delete', 'do', 'double', 'else',
  'enum', 'extern', 'false', 'float', 'for', 'goto', 'if', 'inline',
  'int', 'long', 'namespace', 'new', 'nullptr', 'NULL', 'operator',
  'private', 'protected', 'public', 'register', 'return', 'short',
  'signed', 'sizeof', 'static', 'struct', 'switch', 'template', 'this',
  'throw', 'true', 'try', 'typedef', 'typename', 'union', 'unsigned',
  'using', 'virtual', 'void', 'volatile', 'while', 'size_t', 'ssize_t',
  'int64_t', 'uint64_t', 'int32_t', 'uint32_t',
]);

const MULTI_OPS = [
  '<<=', '>>=', '...',
  '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  '++', '--', '->', '::',
];

const SINGLE_OPS = new Set(['+', '-', '*', '/', '%', '=', '<', '>', '!', '~', '&', '|', '^', '?', ':']);
const PUNCT = new Set(['(', ')', '{', '}', '[', ']', ';', ',', '.']);

function unescapeChar(ch: string): string {
  switch (ch) {
    case 'n': return '\n';
    case 't': return '\t';
    case 'r': return '\r';
    case '0': return '\0';
    case '\\': return '\\';
    case '"': return '"';
    case "'": return "'";
    default: return ch;
  }
}

export interface LexResult {
  tokens: Token[];
  includes: string[];
  defines: Map<string, string>;
  sourceLines: string[];
}

export function tokenizeCpp(source: string, fileName: string): LexResult {
  const normalized = source.replace(/\r\n/g, '\n');
  const sourceLines = normalized.split('\n');
  const tokens: Token[] = [];
  const includes: string[] = [];
  const defines = new Map<string, string>();

  let i = 0;
  let line = 1;
  let col = 1;
  const len = normalized.length;

  const advance = () => {
    const ch = normalized[i++];
    if (ch === '\n') {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
    return ch;
  };

  while (i < len) {
    const ch = normalized[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      advance();
      continue;
    }

    // Single-line comment
    if (ch === '/' && normalized[i + 1] === '/') {
      while (i < len && normalized[i] !== '\n') advance();
      continue;
    }

    // Block comment
    if (ch === '/' && normalized[i + 1] === '*') {
      const startLine = line;
      const startCol = col;
      advance();
      advance();
      let closed = false;
      while (i < len) {
        if (normalized[i] === '*' && normalized[i + 1] === '/') {
          advance();
          advance();
          closed = true;
          break;
        }
        advance();
      }
      if (!closed) {
        throw new CompileError(fileName, startLine, startCol, 'unterminated comment', sourceLines);
      }
      continue;
    }

    // Preprocessor directives (#include, #define, #pragma, etc.)
    if (ch === '#') {
      let directive = '';
      while (i < len && normalized[i] !== '\n') {
        if (normalized[i] === '\\' && normalized[i + 1] === '\n') {
          advance();
          advance();
          directive += ' ';
          continue;
        }
        directive += advance();
      }
      const incMatch = directive.match(/^#\s*include\s*[<"]([^>"]+)[>"]/);
      if (incMatch) {
        includes.push(incMatch[1]);
        continue;
      }
      const defMatch = directive.match(/^#\s*define\s+([A-Za-z_]\w*)(?:\s+(.+))?$/);
      if (defMatch) {
        defines.set(defMatch[1], (defMatch[2] ?? '1').trim());
      }
      continue;
    }

    const startLine = line;
    const startCol = col;

    // String literal
    if (ch === '"') {
      advance();
      let val = '';
      let closed = false;
      while (i < len) {
        const c = normalized[i];
        if (c === '\n') break;
        if (c === '\\') {
          advance();
          if (i < len) val += unescapeChar(advance());
          continue;
        }
        if (c === '"') {
          advance();
          closed = true;
          break;
        }
        val += advance();
      }
      if (!closed) {
        throw new CompileError(
          fileName,
          startLine,
          startCol,
          'missing terminating " character',
          sourceLines
        );
      }
      // Adjacent C/C++ string literal concatenation
      const prev = tokens[tokens.length - 1];
      if (prev && prev.type === 'string') {
        prev.value += val;
      } else {
        tokens.push({ type: 'string', value: val, line: startLine, column: startCol });
      }
      continue;
    }

    // Char literal
    if (ch === "'") {
      advance();
      let val = '';
      let closed = false;
      while (i < len) {
        const c = normalized[i];
        if (c === '\n') break;
        if (c === '\\') {
          advance();
          if (i < len) val += unescapeChar(advance());
          continue;
        }
        if (c === "'") {
          advance();
          closed = true;
          break;
        }
        val += advance();
      }
      if (!closed || val.length === 0) {
        throw new CompileError(
          fileName,
          startLine,
          startCol,
          "invalid character constant",
          sourceLines
        );
      }
      tokens.push({ type: 'char', value: val[0], line: startLine, column: startCol });
      continue;
    }

    // Numeric literal (int, hex, float, scientific)
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(normalized[i + 1] ?? ''))) {
      let raw = '';
      if (ch === '0' && (normalized[i + 1] === 'x' || normalized[i + 1] === 'X')) {
        raw += advance() + advance();
        while (i < len && /[0-9a-fA-F]/.test(normalized[i])) raw += advance();
      } else {
        while (i < len && /[0-9]/.test(normalized[i])) raw += advance();
        if (normalized[i] === '.') {
          raw += advance();
          while (i < len && /[0-9]/.test(normalized[i])) raw += advance();
        }
        if (normalized[i] === 'e' || normalized[i] === 'E') {
          raw += advance();
          if (normalized[i] === '+' || normalized[i] === '-') raw += advance();
          while (i < len && /[0-9]/.test(normalized[i])) raw += advance();
        }
      }
      // Consume numeric suffixes (u, l, ll, f, etc.)
      while (i < len && /[uUlLfF]/.test(normalized[i])) advance();
      tokens.push({ type: 'number', value: raw, line: startLine, column: startCol });
      continue;
    }

    // Identifier / keyword
    if (/[A-Za-z_]/.test(ch)) {
      let ident = '';
      while (i < len && /[A-Za-z0-9_]/.test(normalized[i])) ident += advance();

      // Expand simple object-like #define macros
      if (defines.has(ident)) {
        const expansion = defines.get(ident)!;
        const expanded = tokenizeCpp(expansion, fileName).tokens.filter((t) => t.type !== 'eof');
        for (const t of expanded) {
          tokens.push({ ...t, line: startLine, column: startCol });
        }
        continue;
      }

      tokens.push({
        type: CPP_KEYWORDS.has(ident) ? 'keyword' : 'ident',
        value: ident,
        line: startLine,
        column: startCol,
      });
      continue;
    }

    // Multi-character operators
    let matchedMulti = '';
    for (const op of MULTI_OPS) {
      if (normalized.startsWith(op, i)) {
        matchedMulti = op;
        break;
      }
    }
    if (matchedMulti) {
      for (let k = 0; k < matchedMulti.length; k++) advance();
      tokens.push({ type: 'op', value: matchedMulti, line: startLine, column: startCol });
      continue;
    }

    // Single-character operators
    if (SINGLE_OPS.has(ch)) {
      advance();
      tokens.push({ type: 'op', value: ch, line: startLine, column: startCol });
      continue;
    }

    // Punctuation
    if (PUNCT.has(ch)) {
      advance();
      tokens.push({ type: 'punct', value: ch, line: startLine, column: startCol });
      continue;
    }

    throw new CompileError(
      fileName,
      startLine,
      startCol,
      `stray '${ch}' in program`,
      sourceLines
    );
  }

  tokens.push({ type: 'eof', value: '', line, column: col });
  return { tokens, includes, defines, sourceLines };
}
