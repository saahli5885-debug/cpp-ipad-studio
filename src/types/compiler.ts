export type Language = 'cpp' | 'c';

export type CppStandard = 'c++23' | 'c++20' | 'c++17' | 'c++14';
export type CStandard = 'c17' | 'c11' | 'c99';
export type CompilerStandard = CppStandard | CStandard;

export type DiagnosticSeverity = 'error' | 'warning' | 'note';

export interface CompilerDiagnostic {
  id: string;
  file: string;
  line: number | null;
  column: number | null;
  severity: DiagnosticSeverity;
  message: string;
  codeSnippet?: string;
  caretLine?: string;
}

export interface DiagnosticSummary {
  errors: number;
  warnings: number;
  notes: number;
}

export type ConsoleChunkKind = 'stdout' | 'stderr' | 'stdin' | 'system' | 'error';

export interface ConsoleChunk {
  id: string;
  kind: ConsoleChunkKind;
  text: string;
}

export type RunStatus = 'idle' | 'compiling' | 'running' | 'completed' | 'compile_error' | 'stopped' | 'error';

export type LayoutPreference = 'auto' | 'side-by-side' | 'stacked' | 'tabs';
export type EffectiveLayout = 'side-by-side' | 'stacked' | 'tabs';

export interface CodeTemplate {
  id: string;
  language: Language;
  title: string;
  description: string;
  code: string;
}

export interface CompileRunResponse {
  ok: boolean;
  sessionId?: string;
  stage?: 'compile' | 'validation' | 'server';
  diagnostics: CompilerDiagnostic[];
  rawCompilerOutput: string;
  compileTimeMs: number;
  error?: string;
}
