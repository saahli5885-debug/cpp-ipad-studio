import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Response } from 'express';
import { parseCompilerDiagnostics } from '../src/utils/diagnostics';
import type { CompileRunResponse, CompilerStandard, Language } from '../src/types/compiler';
import {
  buildCompilerInvocation,
  buildSanitizedRunEnv,
  COMPILE_TIMEOUT_MS,
  MAX_CONCURRENT_SESSIONS,
  MAX_OUTPUT_BYTES,
  MAX_STDIN_CHUNK_BYTES,
  RUN_TIMEOUT_MS,
} from './compilerUtils';

interface StreamEvent {
  type: 'stdout' | 'stderr' | 'exit' | 'error';
  data?: string;
  code?: number | null;
  signal?: string | null;
  durationMs?: number;
  reason?: string;
}

interface ActiveSession {
  id: string;
  tempDir: string;
  child: ChildProcess | null;
  startedAt: number;
  events: StreamEvent[];
  listeners: Set<Response>;
  finished: boolean;
  outputBytes: number;
  outputTruncated: boolean;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  cleanupHandle: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, ActiveSession>();

function sendSseEvent(res: Response, event: StreamEvent): void {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function broadcastEvent(session: ActiveSession, event: StreamEvent): void {
  session.events.push(event);
  for (const res of session.listeners) {
    sendSseEvent(res, event);
  }
}

function killProcessGroup(child: ChildProcess | null): void {
  if (!child || child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Process already exited
    }
  }
}

async function removeTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function finalizeSession(
  session: ActiveSession,
  code: number | null,
  signal: string | null,
  reason?: string
): void {
  if (session.finished) return;
  session.finished = true;

  if (session.timeoutHandle) {
    clearTimeout(session.timeoutHandle);
    session.timeoutHandle = null;
  }

  const durationMs = Math.max(0, Date.now() - session.startedAt);
  broadcastEvent(session, {
    type: 'exit',
    code,
    signal,
    durationMs,
    reason,
  });

  for (const res of session.listeners) {
    if (!res.writableEnded) {
      res.end();
    }
  }
  session.listeners.clear();
  session.child = null;

  void removeTempDir(session.tempDir);

  // Retain completed event buffer briefly in case SSE connects just after quick exit
  session.cleanupHandle = setTimeout(() => {
    sessions.delete(session.id);
  }, 15_000);
}

function getRunningSessionCount(): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (!session.finished) count += 1;
  }
  return count;
}

function compileSource(
  language: Language,
  standard: CompilerStandard,
  sourcePath: string,
  binaryPath: string,
  cwd: string
): Promise<{ ok: boolean; rawOutput: string; timedOut: boolean; durationMs: number }> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const { command, args } = buildCompilerInvocation(language, standard, sourcePath, binaryPath);

    const compiler = spawn(command, args, {
      cwd,
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildSanitizedRunEnv(),
    });

    let rawOutput = '';
    let outputBytes = 0;
    let timedOut = false;

    const appendOutput = (chunk: Buffer) => {
      if (outputBytes >= 128 * 1024) return;
      const slice = chunk.subarray(0, 128 * 1024 - outputBytes);
      outputBytes += slice.length;
      rawOutput += slice.toString('utf8');
    };

    compiler.stdout?.on('data', appendOutput);
    compiler.stderr?.on('data', appendOutput);

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(compiler);
    }, COMPILE_TIMEOUT_MS);

    compiler.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        rawOutput: `Не удалось запустить компилятор: ${err.message}`,
        timedOut: false,
        durationMs: Date.now() - startedAt,
      });
    });

    compiler.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          ok: false,
          rawOutput: 'Превышено время компиляции (10 секунд).',
          timedOut: true,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      resolve({
        ok: code === 0,
        rawOutput,
        timedOut: false,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

export async function compileAndStartSession(
  language: Language,
  standard: CompilerStandard,
  code: string
): Promise<{ status: number; payload: CompileRunResponse }> {
  if (getRunningSessionCount() >= MAX_CONCURRENT_SESSIONS) {
    return {
      status: 429,
      payload: {
        ok: false,
        stage: 'server',
        diagnostics: [],
        rawCompilerOutput: '',
        compileTimeMs: 0,
        error: 'Слишком много активных запусков. Остановите текущую программу и повторите.',
      },
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpp-studio-'));
  const sourceFile = language === 'cpp' ? 'main.cpp' : 'main.c';
  const sourcePath = path.resolve(tempDir, sourceFile);
  const binaryPath = path.resolve(tempDir, 'main.out');

  // Strict confinement check inside freshly created temp directory
  if (
    !sourcePath.startsWith(tempDir + path.sep) ||
    !binaryPath.startsWith(tempDir + path.sep)
  ) {
    await removeTempDir(tempDir);
    return {
      status: 400,
      payload: {
        ok: false,
        stage: 'validation',
        diagnostics: [],
        rawCompilerOutput: '',
        compileTimeMs: 0,
        error: 'Ошибка подготовки рабочей директории.',
      },
    };
  }

  await fs.writeFile(sourcePath, code, 'utf8');

  const compileResult = await compileSource(language, standard, sourcePath, binaryPath, tempDir);
  const diagnostics = parseCompilerDiagnostics(compileResult.rawOutput);

  if (!compileResult.ok) {
    await removeTempDir(tempDir);
    return {
      status: 200,
      payload: {
        ok: false,
        stage: 'compile',
        diagnostics,
        rawCompilerOutput: compileResult.rawOutput,
        compileTimeMs: compileResult.durationMs,
      },
    };
  }

  const sessionId = crypto.randomBytes(16).toString('hex');

  // Use stdbuf -o0 -e0 so prompts like printf("Enter x: ") flush immediately before scanf/cin
  const child = spawn('/usr/bin/stdbuf', ['-o0', '-e0', binaryPath], {
    cwd: tempDir,
    shell: false,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: buildSanitizedRunEnv(),
  });

  const session: ActiveSession = {
    id: sessionId,
    tempDir,
    child,
    startedAt: Date.now(),
    events: [],
    listeners: new Set(),
    finished: false,
    outputBytes: 0,
    outputTruncated: false,
    timeoutHandle: null,
    cleanupHandle: null,
  };

  sessions.set(sessionId, session);

  const handleChunk = (type: 'stdout' | 'stderr', chunk: Buffer) => {
    if (session.finished || session.outputTruncated) return;

    const remaining = MAX_OUTPUT_BYTES - session.outputBytes;
    if (remaining <= 0) {
      session.outputTruncated = true;
      broadcastEvent(session, {
        type: 'stderr',
        data: '\n[Вывод остановлен: превышен лимит 256 КБ]\n',
      });
      killProcessGroup(session.child);
      return;
    }

    const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
    session.outputBytes += slice.length;
    broadcastEvent(session, { type, data: slice.toString('utf8') });

    if (chunk.length > remaining) {
      session.outputTruncated = true;
      broadcastEvent(session, {
        type: 'stderr',
        data: '\n[Вывод остановлен: превышен лимит 256 КБ]\n',
      });
      killProcessGroup(session.child);
    }
  };

  child.stdout?.on('data', (chunk: Buffer) => handleChunk('stdout', chunk));
  child.stderr?.on('data', (chunk: Buffer) => handleChunk('stderr', chunk));

  session.timeoutHandle = setTimeout(() => {
    if (!session.finished) {
      killProcessGroup(session.child);
      finalizeSession(session, null, 'SIGKILL', 'Превышено время выполнения (60 секунд)');
    }
  }, RUN_TIMEOUT_MS);

  child.on('error', (err) => {
    broadcastEvent(session, {
      type: 'error',
      data: `Ошибка запуска программы: ${err.message}`,
    });
    finalizeSession(session, -1, null, err.message);
  });

  child.on('close', (code, signal) => {
    finalizeSession(session, code, signal);
  });

  return {
    status: 200,
    payload: {
      ok: true,
      sessionId,
      diagnostics,
      rawCompilerOutput: compileResult.rawOutput,
      compileTimeMs: compileResult.durationMs,
    },
  };
}

export function attachSessionStream(sessionId: string, res: Response): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Replay buffered events so fast stdout is never missed
  for (const event of session.events) {
    sendSseEvent(res, event);
  }

  if (session.finished) {
    res.end();
    return true;
  }

  session.listeners.add(res);
  res.on('close', () => {
    session.listeners.delete(res);
  });

  return true;
}

export function writeSessionStdin(
  sessionId: string,
  input: string
): { ok: boolean; error?: string; status: number } {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, status: 404, error: 'Сессия не найдена.' };
  }
  if (session.finished || !session.child?.stdin || session.child.stdin.destroyed) {
    return { ok: false, status: 409, error: 'Программа уже завершена.' };
  }
  if (Buffer.byteLength(input, 'utf8') > MAX_STDIN_CHUNK_BYTES) {
    return { ok: false, status: 413, error: 'Строка ввода слишком длинная.' };
  }

  try {
    session.child.stdin.write(input, 'utf8');
    return { ok: true, status: 200 };
  } catch {
    return { ok: false, status: 409, error: 'Не удалось передать ввод программе.' };
  }
}

export function sendSessionEof(sessionId: string): { ok: boolean; status: number } {
  const session = sessions.get(sessionId);
  if (!session || session.finished || !session.child?.stdin) {
    return { ok: false, status: 404 };
  }
  try {
    session.child.stdin.end();
    return { ok: true, status: 200 };
  } catch {
    return { ok: false, status: 409 };
  }
}

export function stopSession(sessionId: string): { ok: boolean; status: number } {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, status: 404 };
  }
  if (!session.finished) {
    killProcessGroup(session.child);
    finalizeSession(session, null, 'SIGINT', 'Остановлено пользователем');
  }
  return { ok: true, status: 200 };
}

export function shutdownAllSessions(): void {
  for (const session of sessions.values()) {
    if (session.timeoutHandle) clearTimeout(session.timeoutHandle);
    if (session.cleanupHandle) clearTimeout(session.cleanupHandle);
    killProcessGroup(session.child);
    void removeTempDir(session.tempDir);
  }
  sessions.clear();
}
