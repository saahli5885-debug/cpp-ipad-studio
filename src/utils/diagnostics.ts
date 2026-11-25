import type { CompilerDiagnostic, DiagnosticSeverity, DiagnosticSummary } from '../types/compiler';

const DIAGNOSTIC_LINE_RE = /^(.+?):(\d+):(?:(\d+):)?\s+(fatal error|error|warning|note):\s+(.+)$/;
const LINKER_ERROR_RE = /^(.+?):\s*(undefined reference to .+|multiple definition of .+|ld returned \d+ exit status.*)$/;

function normalizeSeverity(raw: string): DiagnosticSeverity {
  if (raw === 'warning') return 'warning';
  if (raw === 'note') return 'note';
  return 'error';
}

function cleanFileName(rawFile: string): string {
  const parts = rawFile.split(/[\\/]/);
  return parts[parts.length - 1] || rawFile;
}

export function parseCompilerDiagnostics(rawOutput: string): CompilerDiagnostic[] {
  if (!rawOutput.trim()) return [];

  const lines = rawOutput.replace(/\r\n/g, '\n').split('\n');
  const diagnostics: CompilerDiagnostic[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(DIAGNOSTIC_LINE_RE);

    if (match) {
      const [, rawFile, lineNumStr, colNumStr, rawSeverity, message] = match;
      const lineNum = Number.parseInt(lineNumStr, 10);
      const colNum = colNumStr ? Number.parseInt(colNumStr, 10) : null;

      let codeSnippet: string | undefined;
      let caretLine: string | undefined;

      // Capture optional GCC source preview & caret line (e.g. "   12 |   int x = ;")
      if (i + 1 < lines.length && /^\s*\d*\s*\|/.test(lines[i + 1])) {
        const rawSnippet = lines[i + 1];
        if (i + 2 < lines.length && /^\s*\|/.test(lines[i + 2])) {
          const rawCaret = lines[i + 2];
          const minIndent = Math.min(
            rawSnippet.match(/^ */)?.[0].length ?? 0,
            rawCaret.match(/^ */)?.[0].length ?? 0
          );
          codeSnippet = rawSnippet.slice(minIndent);
          caretLine = rawCaret.slice(minIndent);
          i += 2;
        } else {
          codeSnippet = rawSnippet.trimStart();
          i += 1;
        }
      }

      diagnostics.push({
        id: `diag-${diagnostics.length}-${lineNum}-${colNum ?? 0}`,
        file: cleanFileName(rawFile),
        line: Number.isNaN(lineNum) ? null : lineNum,
        column: colNum !== null && !Number.isNaN(colNum) ? colNum : null,
        severity: normalizeSeverity(rawSeverity),
        message: message.trim(),
        codeSnippet,
        caretLine,
      });
      continue;
    }

    const linkerMatch = line.match(LINKER_ERROR_RE);
    if (linkerMatch) {
      const [, rawFile, message] = linkerMatch;
      // Skip duplicate summary line if we already captured specific undefined references
      if (/ld returned \d+ exit status/.test(message) && diagnostics.some((d) => d.severity === 'error')) {
        continue;
      }
      diagnostics.push({
        id: `diag-ld-${diagnostics.length}`,
        file: cleanFileName(rawFile),
        line: null,
        column: null,
        severity: 'error',
        message: message.trim(),
      });
    }
  }

  // Fallback if compiler failed with an unrecognized format
  if (diagnostics.length === 0 && rawOutput.trim().length > 0) {
    const firstMeaningful = lines.find((l) => l.trim().length > 0)?.trim() ?? rawOutput.trim();
    diagnostics.push({
      id: 'diag-raw-0',
      file: 'compiler',
      line: null,
      column: null,
      severity: 'error',
      message: firstMeaningful,
    });
  }

  return diagnostics;
}

export function summarizeDiagnostics(diagnostics: CompilerDiagnostic[]): DiagnosticSummary {
  let errors = 0;
  let warnings = 0;
  let notes = 0;

  for (const diag of diagnostics) {
    if (diag.severity === 'error') errors += 1;
    else if (diag.severity === 'warning') warnings += 1;
    else notes += 1;
  }

  return { errors, warnings, notes };
}
