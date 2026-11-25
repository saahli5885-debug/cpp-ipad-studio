import type { CompilerStandard, Language } from '../src/types/compiler';

export const MAX_CODE_BYTES = 128 * 1024; // 128 KB
export const MAX_STDIN_CHUNK_BYTES = 16 * 1024; // 16 KB
export const MAX_OUTPUT_BYTES = 256 * 1024; // 256 KB
export const COMPILE_TIMEOUT_MS = 10_000;
export const RUN_TIMEOUT_MS = 60_000;
export const MAX_CONCURRENT_SESSIONS = 12;

export const ALLOWED_STANDARDS: Record<Language, readonly CompilerStandard[]> = {
  cpp: ['c++23', 'c++20', 'c++17', 'c++14'],
  c: ['c17', 'c11', 'c99'],
};

const SESSION_ID_RE = /^[a-f0-9]{32}$/;

export interface ValidatedCompileRequest {
  language: Language;
  standard: CompilerStandard;
  code: string;
}

export function validateCompileRequest(
  body: unknown
): { ok: true; data: ValidatedCompileRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Некорректный формат запроса.' };
  }

  const candidate = body as Record<string, unknown>;
  const language = candidate.language;
  const standard = candidate.standard;
  const code = candidate.code;

  if (language !== 'cpp' && language !== 'c') {
    return { ok: false, error: 'Поддерживаются только языки C++ и C.' };
  }

  if (typeof code !== 'string') {
    return { ok: false, error: 'Исходный код должен быть строкой.' };
  }

  if (code.trim().length === 0) {
    return { ok: false, error: 'Нельзя скомпилировать пустой файл.' };
  }

  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
    return { ok: false, error: 'Размер исходного кода превышает допустимый лимит (128 КБ).' };
  }

  const allowed = ALLOWED_STANDARDS[language];
  const resolvedStandard: CompilerStandard =
    typeof standard === 'string' && (allowed as readonly string[]).includes(standard)
      ? (standard as CompilerStandard)
      : language === 'cpp'
        ? 'c++20'
        : 'c17';

  return {
    ok: true,
    data: {
      language,
      standard: resolvedStandard,
      code,
    },
  };
}

export function isValidSessionId(sessionId: unknown): sessionId is string {
  return typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId);
}

export function buildCompilerInvocation(
  language: Language,
  standard: CompilerStandard,
  sourcePath: string,
  binaryPath: string
): { command: string; args: string[] } {
  const command = language === 'cpp' ? '/usr/bin/g++' : '/usr/bin/gcc';
  const args = [
    `-std=${standard}`,
    '-Wall',
    '-Wextra',
    '-O0',
    '-fno-diagnostics-color',
    sourcePath,
    '-o',
    binaryPath,
  ];
  if (language === 'c') {
    args.push('-lm');
  }
  return { command, args };
}

/**
 * Returns a strictly minimal environment for compiled user binaries so host
 * secrets (API keys, tokens, credentials) are never visible to user programs.
 */
export function buildSanitizedRunEnv(): Record<string, string> {
  return {
    PATH: '/usr/bin:/bin',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TERM: 'dumb',
  };
}
