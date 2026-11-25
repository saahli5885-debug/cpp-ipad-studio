import type { CompilerDiagnostic, Language } from '../types/compiler';
import { CompileError, tokenizeCpp } from './lexer';
import { parseCpp, type ProgramNode } from './parser';
import { InteractiveStdin, runProgram, RuntimeAbortError } from './interpreter';
import { StreamAbortError } from './streams';

export interface BrowserCompileResult {
  ok: boolean;
  program?: ProgramNode;
  diagnostics: CompilerDiagnostic[];
  rawCompilerOutput: string;
  compileTimeMs: number;
}

export interface BrowserSessionCallbacks {
  onStdout: (text: string) => void;
  onStderr: (text: string) => void;
  onWaitingForInput?: () => void;
  onExit: (result: { code: number | null; durationMs: number; reason?: string }) => void;
}

export function compileInBrowser(code: string, language: Language): BrowserCompileResult {
  const fileName = language === 'cpp' ? 'main.cpp' : 'main.c';
  const startedAt = performance.now();

  if (!code.trim()) {
    const diag: CompilerDiagnostic = {
      id: 'browser-empty',
      file: fileName,
      line: 1,
      column: 1,
      severity: 'error',
      message: 'Нельзя скомпилировать пустой файл.',
    };
    return {
      ok: false,
      diagnostics: [diag],
      rawCompilerOutput: `${fileName}:1:1: error: Нельзя скомпилировать пустой файл.`,
      compileTimeMs: Math.max(1, Math.round(performance.now() - startedAt)),
    };
  }

  try {
    const lex = tokenizeCpp(code, fileName);
    const program = parseCpp(lex, fileName);

    const hasMain = program.declarations.some(
      (d) => d.kind === 'function' && d.name === 'main' && d.body !== null
    );
    if (!hasMain) {
      const diag: CompilerDiagnostic = {
        id: 'browser-no-main',
        file: fileName,
        line: null,
        column: null,
        severity: 'error',
        message: "undefined reference to 'main'",
      };
      return {
        ok: false,
        diagnostics: [diag],
        rawCompilerOutput: `${fileName}: error: undefined reference to 'main'`,
        compileTimeMs: Math.max(1, Math.round(performance.now() - startedAt)),
      };
    }

    return {
      ok: true,
      program,
      diagnostics: [],
      rawCompilerOutput: '',
      compileTimeMs: Math.max(1, Math.round(performance.now() - startedAt)),
    };
  } catch (err) {
    const compileTimeMs = Math.max(1, Math.round(performance.now() - startedAt));
    if (err instanceof CompileError) {
      const d = err.diagnostic;
      const loc = d.line !== null ? `:${d.line}:${d.column ?? 1}` : '';
      const rawLines = [`${d.file}${loc}: error: ${d.message}`];
      if (d.codeSnippet) rawLines.push(d.codeSnippet);
      if (d.caretLine) rawLines.push(d.caretLine);
      return {
        ok: false,
        diagnostics: [d],
        rawCompilerOutput: rawLines.join('\n'),
        compileTimeMs,
      };
    }

    const message = err instanceof Error ? err.message : 'Ошибка компиляции';
    return {
      ok: false,
      diagnostics: [
        {
          id: 'browser-unknown',
          file: fileName,
          line: null,
          column: null,
          severity: 'error',
          message,
        },
      ],
      rawCompilerOutput: `${fileName}: error: ${message}`,
      compileTimeMs,
    };
  }
}

export class BrowserCppSession {
  private readonly stdin: InteractiveStdin;
  private readonly controller = new AbortController();
  private finished = false;

  constructor(program: ProgramNode, callbacks: BrowserSessionCallbacks) {
    const startedAt = performance.now();
    this.stdin = new InteractiveStdin({
      interactive: true,
      onBeforeWait: callbacks.onWaitingForInput,
    });

    void runProgram(program, {
      onStdout: callbacks.onStdout,
      onStderr: callbacks.onStderr,
      stdin: this.stdin,
      signal: this.controller.signal,
    })
      .then((exitCode) => {
        if (this.finished) return;
        this.finished = true;
        callbacks.onExit({
          code: exitCode,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        });
      })
      .catch((err) => {
        if (this.finished) return;
        this.finished = true;
        const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
        if (err instanceof RuntimeAbortError || err instanceof StreamAbortError) {
          callbacks.onExit({
            code: null,
            durationMs,
            reason: err.message,
          });
          return;
        }
        const msg = err instanceof Error ? err.message : 'Ошибка выполнения программы';
        callbacks.onStderr(`\n${msg}\n`);
        callbacks.onExit({
          code: 1,
          durationMs,
        });
      });
  }

  writeStdin(text: string): void {
    if (!this.finished) {
      this.stdin.push(text);
    }
  }

  sendEof(): void {
    if (!this.finished) {
      this.stdin.close();
    }
  }

  stop(): void {
    if (!this.finished) {
      this.controller.abort();
      this.stdin.close();
    }
  }
}
