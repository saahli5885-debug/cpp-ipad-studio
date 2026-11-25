import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  CornerDownLeft,
  Info,
  Loader2,
  Trash2,
} from 'lucide-react';
import type { CompilerDiagnostic, ConsoleChunk, RunStatus } from '../types/compiler';
import { summarizeDiagnostics } from '../utils/diagnostics';

export interface ConsolePanelHandle {
  focusInput: () => void;
}

interface ConsolePanelProps {
  runId: number;
  status: RunStatus;
  chunks: ConsoleChunk[];
  diagnostics: CompilerDiagnostic[];
  rawCompilerOutput: string;
  compileTimeMs: number | null;
  runDurationMs: number | null;
  exitCode: number | null;
  exitReason: string | null;
  fontSize: number;
  onSendInput: (line: string) => void;
  onSendEof: () => void;
  onStop: () => void;
  onClear: () => void;
  onJumpToDiagnostic: (line: number, column?: number | null) => void;
}

export const ConsolePanel = forwardRef<ConsolePanelHandle, ConsolePanelProps>(function ConsolePanel(
  {
    runId,
    status,
    chunks,
    diagnostics,
    rawCompilerOutput,
    compileTimeMs,
    runDurationMs,
    exitCode,
    exitReason,
    fontSize,
    onSendInput,
    onSendEof,
    onStop,
    onClear,
    onJumpToDiagnostic,
  },
  ref
) {
  const [inputValue, setInputValue] = useState('');
  const [copied, setCopied] = useState(false);
  const [errorViewMode, setErrorViewMode] = useState<'parsed' | 'raw'>('parsed');
  const [warningsExpanded, setWarningsExpanded] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const summary = useMemo(() => summarizeDiagnostics(diagnostics), [diagnostics]);

  useImperativeHandle(ref, () => ({
    focusInput() {
      inputRef.current?.focus();
    },
  }));

  // Auto-scroll console to bottom as output streams in
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chunks, status, inputValue]);

  // Reset draft input atomically on every new Run
  useEffect(() => {
    setInputValue('');
  }, [runId]);

  // Automatically focus inline console input when program starts running
  useEffect(() => {
    if (status === 'running') {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [status, runId]);

  const handleSubmitLine = () => {
    if (status !== 'running') return;
    onSendInput(inputValue);
    setInputValue('');
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Let Cmd+Enter / Ctrl+Enter bubble up to global Run shortcut on Magic Keyboard
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      handleSubmitLine();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      onStop();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'd' && inputValue === '') {
      e.preventDefault();
      onSendEof();
    }
  };

  const handleBodyClick = () => {
    // Allow users to drag-select output without stealing focus
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    if (status === 'running') {
      inputRef.current?.focus();
    }
  };

  const handleCopyOutput = async () => {
    const text =
      status === 'compile_error'
        ? rawCompilerOutput
        : chunks.map((c) => c.text).join('');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable in restricted context
    }
  };

  const statusText = useMemo(() => {
    if (status === 'compiling') return 'Компиляция...';
    if (status === 'running') return 'Выполняется · ввод активен';
    if (status === 'compile_error') {
      const parts: string[] = [];
      if (summary.errors > 0) parts.push(`Ошибок: ${summary.errors}`);
      if (summary.warnings > 0) parts.push(`Предупреждений: ${summary.warnings}`);
      return parts.join(' · ') || 'Ошибка компиляции';
    }
    if (status === 'stopped') return exitReason || 'Остановлено';
    if (status === 'completed') {
      const timeStr = runDurationMs !== null ? ` · ${runDurationMs} мс` : '';
      return `Код выхода: ${exitCode ?? 0}${timeStr}`;
    }
    if (status === 'error') return 'Ошибка выполнения';
    return 'Готово к запуску';
  }, [status, summary, exitCode, exitReason, runDurationMs]);

  const hasCopyableContent =
    (status === 'compile_error' && rawCompilerOutput.length > 0) || chunks.length > 0;

  return (
    <section
      aria-label="Консоль вывода и отчёт об ошибках"
      data-testid="console-panel"
      className="flex h-full w-full flex-col bg-[#FAFBFD] dark:bg-[#0D1117]"
    >
      {/* Console pane header */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-[#DFE4EC] bg-[#F3F5F8] px-3.5 dark:border-[#232B38] dark:bg-[#141922]">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-xs font-semibold text-[#111827] whitespace-nowrap dark:text-[#E6EDF3]">
            Консоль
          </span>
          <span aria-hidden="true" className="text-[#94A3B8] dark:text-[#4B5565]">
            ·
          </span>
          <span
            data-testid="console-status"
            className={`truncate text-xs tabular-nums ${
              status === 'compile_error' || status === 'error'
                ? 'font-medium text-rose-600 dark:text-rose-400'
                : status === 'running'
                  ? 'font-medium text-blue-600 dark:text-blue-400'
                  : status === 'completed' && exitCode === 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-[#5B6576] dark:text-[#8B95A5]'
            }`}
          >
            {statusText}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {status === 'running' && (
            <button
              type="button"
              onClick={onSendEof}
              title="Отправить конец ввода (Ctrl+D)"
              className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-[#475569] transition-colors hover:bg-black/5 hover:text-[#111827] whitespace-nowrap dark:text-[#9CA3AF] dark:hover:bg-white/5 dark:hover:text-[#E6EDF3]"
            >
              EOF
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyOutput}
            disabled={!hasCopyableContent}
            aria-label="Копировать вывод консоли"
            title="Копировать вывод"
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[#475569] transition-colors hover:bg-black/5 hover:text-[#111827] disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap dark:text-[#9CA3AF] dark:hover:bg-white/5 dark:hover:text-[#E6EDF3]"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">{copied ? 'Скопировано' : 'Копировать'}</span>
          </button>

          <button
            type="button"
            onClick={onClear}
            aria-label="Очистить консоль"
            title="Очистить консоль (⌘K)"
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[#475569] transition-colors hover:bg-black/5 hover:text-[#111827] whitespace-nowrap dark:text-[#9CA3AF] dark:hover:bg-white/5 dark:hover:text-[#E6EDF3]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Очистить</span>
          </button>
        </div>
      </div>

      {/* Expandable compiler warnings strip when build succeeded with warnings */}
      {status !== 'compile_error' && summary.warnings > 0 && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/25">
          <button
            type="button"
            onClick={() => setWarningsExpanded((v) => !v)}
            aria-expanded={warningsExpanded}
            className="flex w-full items-center justify-between px-3.5 py-2 text-left text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100/60 dark:text-amber-300 dark:hover:bg-amber-900/20"
          >
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>Предупреждения компилятора: {summary.warnings}</span>
            </span>
            {warningsExpanded ? (
              <ChevronUp className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            )}
          </button>
          {warningsExpanded && (
            <div className="max-h-40 divide-y divide-amber-200/70 overflow-y-auto border-t border-amber-200/70 dark:divide-amber-900/40 dark:border-amber-900/40">
              {diagnostics
                .filter((d) => d.severity === 'warning')
                .map((diag) => (
                  <button
                    key={diag.id}
                    type="button"
                    onClick={() => diag.line && onJumpToDiagnostic(diag.line, diag.column)}
                    className="flex w-full items-baseline gap-2.5 px-3.5 py-2 text-left font-mono text-xs text-amber-900 transition-colors hover:bg-amber-100/70 dark:text-amber-200 dark:hover:bg-amber-900/30"
                  >
                    {diag.line !== null && (
                      <span className="shrink-0 font-semibold tabular-nums">
                        {diag.line}:{diag.column ?? 1}
                      </span>
                    )}
                    <span className="break-words">{diag.message}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Main console / error report body */}
      <div
        ref={scrollRef}
        onClick={handleBodyClick}
        className={`min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 pb-[max(5.5rem,env(safe-area-inset-bottom))] ${
          status === 'running' ? 'cursor-text' : ''
        }`}
        style={{ fontSize: `${fontSize}px`, lineHeight: 1.6 }}
      >
        {status === 'compiling' && (
          <div className="flex items-center gap-2.5 text-sm text-[#5B6576] dark:text-[#8B95A5]">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
            <span>Компиляция кода...</span>
          </div>
        )}

        {status === 'compile_error' && (
          <div data-testid="error-report" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DFE4EC] pb-3 dark:border-[#232B38]">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <h2 className="text-sm font-semibold text-[#111827] dark:text-[#E6EDF3]">
                  Отчёт об ошибках компиляции
                </h2>
                {compileTimeMs !== null && (
                  <span className="text-xs text-[#5B6576] tabular-nums dark:text-[#8B95A5]">
                    · {compileTimeMs} мс
                  </span>
                )}
              </div>

              <div
                role="tablist"
                aria-label="Формат отчёта об ошибках"
                className="flex items-center rounded-md border border-[#DFE4EC] bg-[#F3F5F8] p-0.5 dark:border-[#232B38] dark:bg-[#141922]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={errorViewMode === 'parsed'}
                  onClick={() => setErrorViewMode('parsed')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    errorViewMode === 'parsed'
                      ? 'bg-white text-[#111827] shadow-xs dark:bg-[#232B38] dark:text-[#E6EDF3]'
                      : 'text-[#5B6576] hover:text-[#111827] dark:text-[#8B95A5] dark:hover:text-[#E6EDF3]'
                  }`}
                >
                  Разбор ({diagnostics.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={errorViewMode === 'raw'}
                  onClick={() => setErrorViewMode('raw')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    errorViewMode === 'raw'
                      ? 'bg-white text-[#111827] shadow-xs dark:bg-[#232B38] dark:text-[#E6EDF3]'
                      : 'text-[#5B6576] hover:text-[#111827] dark:text-[#8B95A5] dark:hover:text-[#E6EDF3]'
                  }`}
                >
                  Сырой вывод
                </button>
              </div>
            </div>

            {errorViewMode === 'parsed' ? (
              <div className="space-y-2.5">
                {diagnostics.map((diag) => {
                  const isError = diag.severity === 'error';
                  const isWarning = diag.severity === 'warning';
                  const canJump = diag.line !== null;

                  return (
                    <button
                      key={diag.id}
                      type="button"
                      disabled={!canJump}
                      onClick={() => {
                        if (diag.line !== null) {
                          onJumpToDiagnostic(diag.line, diag.column);
                        }
                      }}
                      className={`block w-full rounded-lg border p-3 text-left transition-colors ${
                        isError
                          ? 'border-rose-200 bg-rose-50/50 hover:bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/20 dark:hover:bg-rose-950/35'
                          : isWarning
                            ? 'border-amber-200 bg-amber-50/50 hover:bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20 dark:hover:bg-amber-950/35'
                            : 'border-[#DFE4EC] bg-white hover:bg-[#F8FAFC] dark:border-[#232B38] dark:bg-[#141922] dark:hover:bg-[#1A212C]'
                      } ${canJump ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {isError ? (
                          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                        ) : isWarning ? (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <Info className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                        )}
                        <span
                          className={`font-semibold ${
                            isError
                              ? 'text-rose-700 dark:text-rose-300'
                              : isWarning
                                ? 'text-amber-800 dark:text-amber-300'
                                : 'text-blue-700 dark:text-blue-300'
                          }`}
                        >
                          {isError ? 'Ошибка' : isWarning ? 'Предупреждение' : 'Примечание'}
                        </span>
                        {diag.line !== null && (
                          <>
                            <span aria-hidden="true" className="text-[#94A3B8] dark:text-[#4B5565]">
                              ·
                            </span>
                            <span className="font-mono font-medium text-[#111827] tabular-nums dark:text-[#E6EDF3]">
                              Строка {diag.line}
                              {diag.column !== null ? `, колонка ${diag.column}` : ''}
                            </span>
                          </>
                        )}
                        {canJump && (
                          <span className="ml-auto text-[#5B6576] dark:text-[#8B95A5]">
                            Перейти →
                          </span>
                        )}
                      </div>

                      <p className="mt-1.5 font-mono text-[13px] leading-relaxed text-[#111827] break-words dark:text-[#E6EDF3]">
                        {diag.message}
                      </p>

                      {diag.codeSnippet && (
                        <pre className="mt-2 overflow-x-auto rounded bg-black/[0.04] px-2.5 py-1.5 font-mono text-xs leading-snug text-[#334155] dark:bg-black/30 dark:text-[#CBD5E1]">
                          {diag.codeSnippet}
                          {diag.caretLine ? `\n${diag.caretLine}` : ''}
                        </pre>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-[#DFE4EC] bg-white p-3 font-mono text-xs leading-relaxed text-[#111827] dark:border-[#232B38] dark:bg-[#11161E] dark:text-[#E6EDF3]">
                {rawCompilerOutput}
              </pre>
            )}
          </div>
        )}

        {status === 'idle' && chunks.length === 0 && (
          <div className="flex h-full flex-col items-start justify-start pt-2 text-[#5B6576] dark:text-[#8B95A5]">
            <p className="text-sm leading-relaxed">
              Нажмите <strong className="font-semibold text-[#111827] dark:text-[#E6EDF3]">Запустить</strong> или{' '}
              <kbd className="rounded border border-[#DFE4EC] bg-[#F3F5F8] px-1.5 py-0.5 font-mono text-xs text-[#111827] dark:border-[#2C3545] dark:bg-[#161D28] dark:text-[#E6EDF3]">
                ⌘↵
              </kbd>{' '}
              на Magic Keyboard, чтобы скомпилировать и запустить программу.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-[#64748B] dark:text-[#6E7A8A]">
              Во время выполнения числа и строки вводятся прямо здесь — так же, как в консоли Programiz.
            </p>
          </div>
        )}

        {status !== 'compile_error' && (chunks.length > 0 || status === 'running') && (
          <div
            data-testid="console-transcript"
            className="font-mono whitespace-pre-wrap break-words text-[#111827] dark:text-[#E6EDF3]"
          >
            {chunks.map((chunk) => {
              if (chunk.kind === 'stdin') {
                return (
                  <span
                    key={chunk.id}
                    className="font-medium text-blue-700 dark:text-blue-400"
                  >
                    {chunk.text}
                  </span>
                );
              }
              if (chunk.kind === 'stderr' || chunk.kind === 'error') {
                return (
                  <span key={chunk.id} className="text-rose-600 dark:text-rose-400">
                    {chunk.text}
                  </span>
                );
              }
              if (chunk.kind === 'system') {
                return (
                  <span
                    key={chunk.id}
                    className="block pt-3 text-xs text-[#64748B] dark:text-[#6E7A8A]"
                  >
                    {chunk.text}
                  </span>
                );
              }
              return <span key={chunk.id}>{chunk.text}</span>;
            })}

            {/* Programiz-style inline keyboard input right at the end of stdout */}
            {status === 'running' && (
              <span className="inline-flex min-w-[96px] max-w-full items-center align-baseline">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  aria-label="Ввод в консоль"
                  placeholder=""
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  autoComplete="off"
                  style={{
                    width: `${Math.max(inputValue.length + 2, 10)}ch`,
                    fontSize: `${fontSize}px`,
                  }}
                  className="max-w-full border-0 border-b border-blue-500/35 bg-transparent px-0.5 py-0 font-mono font-medium text-blue-700 caret-blue-600 outline-none transition-colors focus:border-blue-600 focus:ring-0 dark:border-blue-400/35 dark:text-blue-400 dark:caret-blue-400 dark:focus:border-blue-400"
                />
              </span>
            )}
          </div>
        )}
      </div>

      {/* Subtle interactive input helper bar ONLY while program is actively running */}
      {status === 'running' && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#DFE4EC] bg-[#F3F5F8] px-3.5 py-2 dark:border-[#232B38] dark:bg-[#141922]">
          <span className="truncate text-xs text-[#5B6576] dark:text-[#8B95A5]">
            Печатайте прямо в консоли и нажмите Enter для отправки ввода
          </span>
          <button
            type="button"
            onClick={handleSubmitLine}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[#CFD7E3] bg-white px-2.5 text-xs font-medium text-[#111827] transition-colors hover:bg-[#F8FAFC] whitespace-nowrap dark:border-[#2D3748] dark:bg-[#1C2330] dark:text-[#E6EDF3] dark:hover:bg-[#242D3D]"
          >
            <CornerDownLeft className="h-3.5 w-3.5" />
            <span>Отправить</span>
          </button>
        </div>
      )}
    </section>
  );
});
