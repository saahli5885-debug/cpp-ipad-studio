/**
 * Lightweight, deterministic C/C++ formatter (LLVM / clang-format style, 4-space indent).
 * Preserves string/char literals, comments, preprocessor directives, templates, pointers,
 * and Cyrillic text while normalizing braces, indentation, and operator/keyword spacing.
 */

interface ProtectedLine {
  masked: string;
  literals: string[];
  trailingComment: string;
}

const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch']);
const ACCESS_LABEL_RE = /^(public|private|protected)\s*:$/;
const CASE_LABEL_RE = /^(case\b.+|default)\s*:$/;
const SINGLE_CONTROL_NO_BRACE_RE = /^(if\s*\(.*\)|else(\s+if\s*\(.*\))?|for\s*\(.*\)|while\s*\(.*\))$/;

function maskLineLiteralsAndComments(line: string, inBlockComment: boolean): {
  protectedLine: ProtectedLine;
  inBlockComment: boolean;
} {
  const literals: string[] = [];
  let masked = '';
  let trailingComment = '';
  let i = 0;
  let block = inBlockComment;

  while (i < line.length) {
    if (block) {
      const endIdx = line.indexOf('*/', i);
      if (endIdx === -1) {
        const token = line.slice(i);
        const placeholder = `__LIT_${literals.length}__`;
        literals.push(token);
        masked += placeholder;
        return {
          protectedLine: { masked, literals, trailingComment },
          inBlockComment: true,
        };
      }
      const token = line.slice(i, endIdx + 2);
      const placeholder = `__LIT_${literals.length}__`;
      literals.push(token);
      masked += placeholder;
      i = endIdx + 2;
      block = false;
      continue;
    }

    const ch = line[i];
    const next = line[i + 1];

    // Single-line comment
    if (ch === '/' && next === '/') {
      trailingComment = line.slice(i).trimEnd();
      break;
    }

    // Block comment start
    if (ch === '/' && next === '*') {
      const endIdx = line.indexOf('*/', i + 2);
      if (endIdx === -1) {
        const token = line.slice(i);
        const placeholder = `__LIT_${literals.length}__`;
        literals.push(token);
        masked += placeholder;
        return {
          protectedLine: { masked, literals, trailingComment },
          inBlockComment: true,
        };
      }
      const token = line.slice(i, endIdx + 2);
      const placeholder = `__LIT_${literals.length}__`;
      literals.push(token);
      masked += placeholder;
      i = endIdx + 2;
      continue;
    }

    // String or char literal
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      const token = line.slice(i, j);
      const placeholder = `__LIT_${literals.length}__`;
      literals.push(token);
      masked += placeholder;
      i = j;
      continue;
    }

    masked += ch;
    i += 1;
  }

  return {
    protectedLine: { masked, literals, trailingComment },
    inBlockComment: block,
  };
}

function restoreLiterals(text: string, literals: string[]): string {
  return text.replace(/__LIT_(\d+)__/g, (_m, idx) => literals[Number(idx)] ?? '');
}

function splitCompactStatements(rawCode: string): string[] {
  const inputLines = rawCode.replace(/\r\n/g, '\n').split('\n');
  const outLines: string[] = [];
  let inBlockComment = false;

  for (const rawLine of inputLines) {
    const trimmed = rawLine.trim();
    if (trimmed === '') {
      outLines.push('');
      continue;
    }

    // Keep preprocessor directives untouched on their own line
    if (!inBlockComment && trimmed.startsWith('#')) {
      outLines.push(trimmed);
      continue;
    }

    const { protectedLine, inBlockComment: nextBlock } = maskLineLiteralsAndComments(
      rawLine,
      inBlockComment
    );
    inBlockComment = nextBlock;

    const codePart = protectedLine.masked.trim();
    if (!codePart) {
      outLines.push(protectedLine.trailingComment);
      continue;
    }

    // Split cramped single-line brace blocks like `int main(){int a=1;return 0;}`
    // while keeping initializer lists `{1, 2, 3}` and empty `{}` intact.
    const shouldSplitBraces =
      (codePart.includes('{') && !/=\s*\{[^;]*\}\s*;?$/.test(codePart) && !/\{\s*\}/.test(codePart)) ||
      (codePart.includes('}') && /;\s*\}/.test(codePart));

    if (!shouldSplitBraces) {
      const rebuilt = restoreLiterals(codePart, protectedLine.literals);
      outLines.push(
        protectedLine.trailingComment ? `${rebuilt} ${protectedLine.trailingComment}` : rebuilt
      );
      continue;
    }

    let current = '';
    let parenDepth = 0;
    const segments: string[] = [];

    for (let i = 0; i < codePart.length; i++) {
      const ch = codePart[i];
      if (ch === '(') parenDepth += 1;
      else if (ch === ')' && parenDepth > 0) parenDepth -= 1;

      if (ch === '{' && parenDepth === 0) {
        // Keep braced initializers like `vector<int> v = {1, 2};` or `int a[]{1, 2};` together
        const rest = codePart.slice(i);
        if (/^\{[^;{}]*\}\s*(?:[,;)]|$)/.test(rest)) {
          const closePos = codePart.indexOf('}', i);
          current += codePart.slice(i, closePos + 1);
          i = closePos;
          continue;
        }
        current += ' {';
        segments.push(current.trim());
        current = '';
        continue;
      }

      if (ch === '}' && parenDepth === 0) {
        if (current.trim()) {
          segments.push(current.trim());
          current = '';
        }
        // Keep `};` or `} else` together
        const after = codePart.slice(i + 1);
        const semiMatch = after.match(/^\s*;/);
        const elseMatch = after.match(/^\s*else\b/);
        if (semiMatch) {
          segments.push('};');
          i += semiMatch[0].length;
        } else if (elseMatch) {
          current = '}';
        } else {
          segments.push('}');
        }
        continue;
      }

      if (ch === ';' && parenDepth === 0) {
        current += ';';
        const remaining = codePart.slice(i + 1).trim();
        if (remaining.length > 0) {
          segments.push(current.trim());
          current = '';
        }
        continue;
      }

      current += ch;
    }

    if (current.trim()) {
      segments.push(current.trim());
    }

    for (let s = 0; s < segments.length; s++) {
      const restored = restoreLiterals(segments[s], protectedLine.literals);
      const withComment =
        s === segments.length - 1 && protectedLine.trailingComment
          ? `${restored} ${protectedLine.trailingComment}`
          : restored;
      outLines.push(withComment);
    }
  }

  return outLines;
}

function normalizeSpacing(maskedCode: string): string {
  let s = maskedCode.trim().replace(/\s+/g, ' ');

  // Preserve `operator<<`, `operator+`, etc. temporarily
  s = s.replace(/\boperator\s*([+\-*/%=!<>&|^~\[\]()]+)/g, 'operator__OP__$1');

  // Space after control keywords before `(`
  s = s.replace(/\b(if|for|while|switch|catch)\s*\(/g, '$1 (');

  // Space before `{` when preceded by `)` or identifier/keyword (not empty `{}`)
  s = s.replace(/([)\w])\s*\{/g, '$1 {');
  s = s.replace(/\}\s*else\b/g, '} else');
  s = s.replace(/\belse\s*\{/g, 'else {');

  // Comma spacing: no space before comma, single space after
  s = s.replace(/\s*,\s*/g, ', ');

  // Semicolon spacing: no space before `;`, single space after if followed by code (e.g. for loop)
  s = s.replace(/\s*;\s*/g, '; ');
  s = s.replace(/;\s*$/g, ';');

  // Remove space inside parentheses and brackets: `( x )` -> `(x)`
  s = s.replace(/\(\s+/g, '(');
  s = s.replace(/\s+\)/g, ')');
  s = s.replace(/\[\s+/g, '[');
  s = s.replace(/\s+\]/g, ']');

  // Multi-character binary/stream/comparison/assignment operators
  s = s.replace(/\s*(<<=|>>=|<<|>>|<=|>=|==|!=|&&|\|\||\+=|-=|\*=|\/=|%=)\s*/g, ' $1 ');

  // Single `=` assignment (avoiding `==`, `!=`, `<=`, `>=`, `+=`, etc.)
  s = s.replace(/([^=!<>+\-*/%&|^])\s*=\s*([^=])/g, '$1 = $2');

  // Binary `<` and `>` comparisons (e.g. `i<n`, `x>0`) while protecting templates (`vector<int>`, `static_cast<double>`)
  const TEMPLATE_PREFIXES = new Set([
    'vector', 'map', 'set', 'multiset', 'multimap', 'unordered_map', 'unordered_set',
    'pair', 'tuple', 'array', 'deque', 'queue', 'priority_queue', 'stack', 'list',
    'shared_ptr', 'unique_ptr', 'weak_ptr', 'optional', 'variant', 'function',
    'span', 'string_view', 'bitset', 'complex', 'numeric_limits', 'atomic',
    'static_cast', 'dynamic_cast', 'const_cast', 'reinterpret_cast', 'bit_cast', 'template',
  ]);
  s = s.replace(/(\b[A-Za-z_]\w*|\d+|\)|])\s*([<>])\s*([A-Za-z_\d(\[])/g, (match, left, op, right) => {
    if (op === '<' && (TEMPLATE_PREFIXES.has(left) || /^[A-Z]/.test(left))) {
      return match;
    }
    if (op === '>' && left.includes('<')) {
      return match;
    }
    return `${left} ${op} ${right}`;
  });

  // Binary `+`, `-`, `/`, `%`, and safe `*` (preserving pointer declarations like `int *p` and casts `(void*)`)
  const TYPE_KEYWORDS = new Set([
    'void', 'char', 'short', 'int', 'long', 'float', 'double', 'bool', 'auto',
    'signed', 'unsigned', 'const', 'volatile', 'struct', 'class', 'enum',
    'size_t', 'ssize_t', 'ptrdiff_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
    'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'FILE',
  ]);
  s = s.replace(/([\w)\]])\s*([+\-/%])\s*([\w(\[])/g, '$1 $2 $3');
  s = s.replace(/(\b[A-Za-z_]\w*|\d+|\)|])\s*\*\s*([\w(\[])/g, (match, left, right) => {
    if (TYPE_KEYWORDS.has(left) || /^[A-Z]/.test(left)) {
      return match;
    }
    return `${left} * ${right}`;
  });

  // Normalize scope `::` and member arrow `->`
  s = s.replace(/\s*::\s*/g, '::');
  s = s.replace(/\s*->\s*/g, '->');

  // Clean double spaces introduced by adjacent rules
  s = s.replace(/ {2,}/g, ' ');

  // Restore `operator...`
  s = s.replace(/\boperator__OP__/g, 'operator');

  // Keep `case X:` and `public:` clean
  s = s.replace(/^(public|private|protected)\s*:\s*$/, '$1:');
  s = s.replace(/^default\s*:\s*$/, 'default:');

  // Ensure control keyword space wasn't lost
  for (const kw of CONTROL_KEYWORDS) {
    s = s.replace(new RegExp(`\\b${kw}\\(`, 'g'), `${kw} (`);
  }

  return s.trim();
}

function countBraceDelta(maskedCode: string): { leadingCloses: number; netDelta: number } {
  let leadingCloses = 0;
  let i = 0;
  while (i < maskedCode.length && (maskedCode[i] === '}' || maskedCode[i] === ' ')) {
    if (maskedCode[i] === '}') leadingCloses += 1;
    i += 1;
  }

  let opens = 0;
  let closes = 0;
  for (const ch of maskedCode) {
    if (ch === '{') opens += 1;
    else if (ch === '}') closes += 1;
  }

  return { leadingCloses, netDelta: opens - closes };
}

export function formatCppCode(source: string, indentSize = 4): string {
  if (!source.trim()) return '';

  const indentUnit = ' '.repeat(indentSize);
  const rawLines = splitCompactStatements(source);
  const formatted: string[] = [];

  let indentLevel = 0;
  let inBlockComment = false;
  let pendingSingleIndent = false;
  let consecutiveBlanks = 0;

  for (let idx = 0; idx < rawLines.length; idx++) {
    const rawLine = rawLines[idx];
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      if (formatted.length > 0 && consecutiveBlanks === 0) {
        formatted.push('');
        consecutiveBlanks += 1;
      }
      continue;
    }
    consecutiveBlanks = 0;

    // Preprocessor lines stay at column 0
    if (!inBlockComment && trimmed.startsWith('#')) {
      formatted.push(trimmed.replace(/^#\s+/, '#'));
      pendingSingleIndent = false;
      continue;
    }

    // Pure comment lines follow current indent
    if (!inBlockComment && trimmed.startsWith('//')) {
      const effectiveLevel = indentLevel + (pendingSingleIndent ? 1 : 0);
      formatted.push(`${indentUnit.repeat(Math.max(0, effectiveLevel))}${trimmed}`);
      continue;
    }

    const { protectedLine, inBlockComment: nextBlock } = maskLineLiteralsAndComments(
      rawLine,
      inBlockComment
    );
    const wasInBlockComment = inBlockComment;
    inBlockComment = nextBlock;

    if (wasInBlockComment) {
      formatted.push(`${indentUnit.repeat(Math.max(0, indentLevel))}${trimmed}`);
      continue;
    }

    const normalizedCode = normalizeSpacing(protectedLine.masked);
    const { leadingCloses, netDelta } = countBraceDelta(normalizedCode);

    if (leadingCloses > 0) {
      pendingSingleIndent = false;
      indentLevel = Math.max(0, indentLevel - leadingCloses);
    }

    const isAccessLabel = ACCESS_LABEL_RE.test(normalizedCode);
    const isCaseLabel = CASE_LABEL_RE.test(normalizedCode);

    // LLVM clang-format style aligns access specifiers and case/default labels with enclosing block
    let lineIndent = indentLevel;
    if (isAccessLabel || isCaseLabel) {
      lineIndent = Math.max(0, indentLevel - 1);
    } else if (pendingSingleIndent) {
      lineIndent += 1;
    }

    const restoredCode = restoreLiterals(normalizedCode, protectedLine.literals);
    const finalLine = protectedLine.trailingComment
      ? `${restoredCode} ${protectedLine.trailingComment}`
      : restoredCode;

    formatted.push(`${indentUnit.repeat(Math.max(0, lineIndent))}${finalLine}`);

    if (leadingCloses > 0) {
      const remainingDelta = netDelta + leadingCloses;
      indentLevel = Math.max(0, indentLevel + remainingDelta);
    } else {
      indentLevel = Math.max(0, indentLevel + netDelta);
    }

    if (pendingSingleIndent) {
      pendingSingleIndent = false;
    } else if (
      netDelta === 0 &&
      !normalizedCode.endsWith(';') &&
      !normalizedCode.endsWith('{') &&
      !normalizedCode.endsWith('}') &&
      SINGLE_CONTROL_NO_BRACE_RE.test(normalizedCode)
    ) {
      pendingSingleIndent = true;
    }
  }

  // Strip trailing empty lines and ensure a single trailing newline
  while (formatted.length > 0 && formatted[formatted.length - 1] === '') {
    formatted.pop();
  }

  return `${formatted.join('\n')}\n`;
}
