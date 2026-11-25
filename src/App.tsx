import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlignLeft, Check, WrapText } from 'lucide-react';
import { CodeEditor, type CodeEditorHandle } from './components/CodeEditor';
import { ConsolePanel, type ConsolePanelHandle } from './components/ConsolePanel';
import { ShortcutsModal } from './components/ShortcutsModal';
import { TopBar } from './components/TopBar';
import { CODE_TEMPLATES, DEFAULT_CODE } from './data/templates';
import type {
  CodeTemplate,
  CompileRunResponse,
  CompilerDiagnostic,
  CompilerStandard,
  ConsoleChunk,
  Language,
  LayoutPreference,
  RunStatus,
} from './types/compiler';
import { summarizeDiagnostics } from './utils/diagnostics';
import { formatCppCode } from './utils/formatCpp';
import {
  clampSplitRatio,
  getDefaultSplitRatio,
  resolveEffectiveLayout,
  resolveWordWrap,
  type WordWrapPreference,
} from './utils/layout';

const STORAGE_KEYS = {
  language: 'cppstudio.language',
  standardCpp: 'cppstudio.standard.cpp',
  standardC: 'cppstudio.standard.c',
  codeCpp: 'cppstudio.code.cpp',
  codeC: 'cppstudio.code.c',
  theme: 'cppstudio.theme',
  fontSize: 'cppstudio.fontSize',
  layout: 'cppstudio.layout',
  wordWrap: 'cppstudio.wordWrap',
};

function readStorage(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota / private mode errors
  }
}

export default function App() {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = readStorage(STORAGE_KEYS.language, 'cpp');
    return saved === 'c' ? 'c' : 'cpp';
  });

  const [standards, setStandards] = useState<Record<Language, CompilerStandard>>(() => ({
    cpp: readStorage(STORAGE_KEYS.standardCpp, 'c++20') as CompilerStandard,
    c: readStorage(STORAGE_KEYS.standardC, 'c17') as CompilerStandard,
  }));

  const [codes, setCodes] = useState<Record<Language, string>>(() => ({
    cpp: readStorage(STORAGE_KEYS.codeCpp, DEFAULT_CODE.cpp),
    c: readStorage(STORAGE_KEYS.codeC, DEFAULT_CODE.c),
  }));

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = readStorage(STORAGE_KEYS.theme, 'dark');
    return saved === 'light' ? 'light' : 'dark';
  });

  const [fontSize, setFontSize] = useState<number>(() => {
    const parsed = Number.parseInt(readStorage(STORAGE_KEYS.fontSize, '14'), 10);
    return Number.isFinite(parsed) && parsed >= 12 && parsed <= 22 ? parsed : 14;
  });

  const [layoutPreference, setLayoutPreference] = useState<LayoutPreference>(() => {
    const saved = readStorage(STORAGE_KEYS.layout, 'auto');
    if (saved === 'side-by-side' || saved === 'stacked' || saved === 'tabs') return saved;
    return 'auto';
  });

  const [wordWrapPreference, setWordWrapPreference] = useState<WordWrapPreference>(() => {
    const saved = readStorage(STORAGE_KEYS.wordWrap, 'auto');
    if (saved === 'on' || saved === 'off') return saved;
    return 'auto';
  });

  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1440,
    height: typeof window !== 'undefined' ? window.innerHeight : 900,
  }));

  const [editorWidth, setEditorWidth] = useState<number | undefined>(undefined);

  const [splitRatio, setSplitRatio] = useState<number>(() =>
    getDefaultSplitRatio(typeof window !== 'undefined' ? window.innerWidth : 1440)
  );
  const [activeTab, setActiveTab] = useState<'editor' | 'console'>('editor');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [formattedFeedback, setFormattedFeedback] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Compiler & execution session state
  const [status, setStatus] = useState<RunStatus>('idle');
  const [chunks, setChunks] = useState<ConsoleChunk[]>([]);
  const [diagnostics, setDiagnostics] = useState<CompilerDiagnostic[]>([]);
  const [rawCompilerOutput, setRawCompilerOutput] = useState('');
  const [compileTimeMs, setCompileTimeMs] = useState<number | null>(null);
  const [runDurationMs, setRunDurationMs] = useState<number | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [exitReason, setExitReason] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const chunkCounterRef = useRef(0);
  const formatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const consoleRef = useRef<ConsolePanelHandle | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const effectiveLayout = useMemo(
    () => resolveEffectiveLayout(layoutPreference, viewport.width, viewport.height),
    [layoutPreference, viewport.width, viewport.height]
  );

  const effectiveWordWrap = useMemo(
    () => resolveWordWrap(wordWrapPreference, viewport.width, editorWidth),
    [wordWrapPreference, viewport.width, editorWidth]
  );

  const currentCode = codes[language];
  const currentStandard = standards[language];
  const diagSummary = useMemo(() => summarizeDiagnostics(diagnostics), [diagnostics]);

  const appendChunk = useCallback((kind: ConsoleChunk['kind'], text: string) => {
    chunkCounterRef.current += 1;
    const id = `c-${chunkCounterRef.current}`;
    setChunks((prev) => [...prev, { id, kind, text }]);
  }, []);

  // Keep <html>.dark synced with theme state
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    writeStorage(STORAGE_KEYS.theme, theme);
  }, [theme]);

  // Persist editor code & settings
  useEffect(() => {
    writeStorage(STORAGE_KEYS.language, language);
  }, [language]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.standardCpp, standards.cpp);
    writeStorage(STORAGE_KEYS.standardC, standards.c);
  }, [standards]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.codeCpp, codes.cpp);
  }, [codes.cpp]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.codeC, codes.c);
  }, [codes.c]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.fontSize, String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.layout, layoutPreference);
  }, [layoutPreference]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.wordWrap, wordWrapPreference);
  }, [wordWrapPreference]);

  // Track viewport resize (iPad Split View transitions & external Full HD monitor attach/detach)
  useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const closeActiveStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const handleStop = useCallback(async () => {
    const activeId = sessionIdRef.current;
    closeActiveStream();
    sessionIdRef.current = null;

    if (activeId) {
      try {
        await fetch(`/api/sessions/${activeId}/stop`, { method: 'POST' });
      } catch {
        // Ignore network errors while stopping
      }
    }

    setStatus('stopped');
    setExitReason('Остановлено пользователем');
    appendChunk('system', 'Программа остановлена пользователем.');
  }, [appendChunk, closeActiveStream]);

  const handleRun = useCallback(async () => {
    if (sessionIdRef.current) {
      const prevId = sessionIdRef.current;
      sessionIdRef.current = null;
      closeActiveStream();
      void fetch(`/api/sessions/${prevId}/stop`, { method: 'POST' }).catch(() => {});
    }

    setStatus('compiling');
    setChunks([]);
    setDiagnostics([]);
    setRawCompilerOutput('');
    setCompileTimeMs(null);
    setRunDurationMs(null);
    setExitCode(null);
    setExitReason(null);

    if (effectiveLayout === 'tabs') {
      setActiveTab('console');
    }

    try {
      const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language,
          standard: currentStandard,
          code: currentCode,
        }),
      });

      const payload = (await response.json()) as CompileRunResponse;
      setCompileTimeMs(payload.compileTimeMs ?? null);
      setDiagnostics(payload.diagnostics ?? []);
      setRawCompilerOutput(payload.rawCompilerOutput ?? '');

      if (!payload.ok || !payload.sessionId) {
        if (payload.stage === 'compile') {
          setStatus('compile_error');
        } else {
          setStatus('error');
          appendChunk('error', payload.error || 'Не удалось скомпилировать программу.');
        }
        return;
      }

      const sid = payload.sessionId;
      sessionIdRef.current = sid;
      setStatus('running');

      const es = new EventSource(`/api/sessions/${sid}/stream`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            type: 'stdout' | 'stderr' | 'exit' | 'error';
            data?: string;
            code?: number | null;
            signal?: string | null;
            durationMs?: number;
            reason?: string;
          };

          if (msg.type === 'stdout' && msg.data) {
            appendChunk('stdout', msg.data);
          } else if (msg.type === 'stderr' && msg.data) {
            appendChunk('stderr', msg.data);
          } else if (msg.type === 'error' && msg.data) {
            appendChunk('error', msg.data);
          } else if (msg.type === 'exit') {
            es.close();
            if (eventSourceRef.current === es) {
              eventSourceRef.current = null;
            }
            if (sessionIdRef.current === sid) {
              sessionIdRef.current = null;
            }
            setRunDurationMs(msg.durationMs ?? null);
            setExitCode(msg.code ?? 0);
            if (msg.reason) {
              setExitReason(msg.reason);
              setStatus('stopped');
              appendChunk('system', `Процесс завершён: ${msg.reason}`);
            } else {
              setStatus('completed');
              const codeNum = msg.code ?? 0;
              const timeSuffix = msg.durationMs !== undefined ? ` за ${msg.durationMs} мс` : '';
              appendChunk('system', `Процесс завершён с кодом ${codeNum}${timeSuffix}`);
            }
          }
        } catch {
          // Ignore malformed event chunks
        }
      };

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) return;
        es.close();
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
      };
    } catch {
      setStatus('error');
      appendChunk('error', 'Ошибка соединения с сервером компилятора.');
    }
  }, [appendChunk, closeActiveStream, currentCode, currentStandard, effectiveLayout, language]);

  const handleFormatCode = useCallback(() => {
    setCodes((prev) => {
      const formatted = formatCppCode(prev[language]);
      if (formatted === prev[language]) return prev;
      return { ...prev, [language]: formatted };
    });
    setFormattedFeedback(true);
    if (formatTimerRef.current) clearTimeout(formatTimerRef.current);
    formatTimerRef.current = setTimeout(() => {
      setFormattedFeedback(false);
    }, 1500);
  }, [language]);

  const handleToggleWordWrap = useCallback(() => {
    setWordWrapPreference(effectiveWordWrap ? 'off' : 'on');
  }, [effectiveWordWrap]);

  const handleCycleLayoutAllThree = useCallback(() => {
    setLayoutPreference(() => {
      if (effectiveLayout === 'side-by-side') return 'stacked';
      if (effectiveLayout === 'stacked') return 'tabs';
      return 'side-by-side';
    });
  }, [effectiveLayout]);

  const handleSendInput = useCallback(
    async (line: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      appendChunk('stdin', `${line}\n`);
      try {
        await fetch(`/api/sessions/${sid}/stdin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: `${line}\n` }),
        });
      } catch {
        appendChunk('error', '\nНе удалось отправить ввод в процесс.\n');
      }
    },
    [appendChunk]
  );

  const handleSendEof = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    appendChunk('system', '^D (конец ввода)');
    try {
      await fetch(`/api/sessions/${sid}/eof`, { method: 'POST' });
    } catch {
      // Ignore
    }
  }, [appendChunk]);

  const handleClearConsole = useCallback(() => {
    setChunks([]);
    if (status !== 'running' && status !== 'compiling') {
      setStatus('idle');
      setDiagnostics([]);
      setRawCompilerOutput('');
      setExitCode(null);
      setExitReason(null);
      setRunDurationMs(null);
    }
  }, [status]);

  const handleJumpToDiagnostic = useCallback(
    (line: number, column?: number | null) => {
      if (effectiveLayout === 'tabs') {
        setActiveTab('editor');
        setTimeout(() => editorRef.current?.jumpToLine(line, column), 40);
      } else {
        editorRef.current?.jumpToLine(line, column);
      }
    },
    [effectiveLayout]
  );

  const handleDownloadCode = useCallback(() => {
    const filename = language === 'cpp' ? 'main.cpp' : 'main.c';
    const blob = new Blob([currentCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [currentCode, language]);

  const handleImportCode = useCallback(
    (content: string, detectedLang?: Language) => {
      const targetLang = detectedLang ?? language;
      if (detectedLang) {
        setLanguage(detectedLang);
      }
      setCodes((prev) => ({ ...prev, [targetLang]: content }));
      setDiagnostics([]);
    },
    [language]
  );

  const handleSelectTemplate = useCallback(
    (tpl: CodeTemplate) => {
      setLanguage(tpl.language);
      setCodes((prev) => ({ ...prev, [tpl.language]: tpl.code }));
      setDiagnostics([]);
      setChunks([]);
      setStatus('idle');
      if (effectiveLayout === 'tabs') {
        setActiveTab('editor');
      }
    },
    [effectiveLayout]
  );

  const handleChangeFontSize = useCallback((delta: number) => {
    setFontSize((prev) => Math.max(12, Math.min(22, prev + delta)));
  }, []);

  // Global Magic Keyboard shortcuts (Cmd on iPadOS/macOS, Ctrl on Windows/Linux)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();
      if (e.key === 'Enter') {
        e.preventDefault();
        void handleRun();
        return;
      }
      if (e.shiftKey && key === 'f') {
        e.preventDefault();
        handleFormatCode();
        return;
      }
      if (e.key === '\\') {
        e.preventDefault();
        handleCycleLayoutAllThree();
        return;
      }
      if (key === '.' && status === 'running') {
        e.preventDefault();
        void handleStop();
        return;
      }
      if (key === 'k') {
        e.preventDefault();
        handleClearConsole();
        return;
      }
      if (key === 's') {
        e.preventDefault();
        handleDownloadCode();
        return;
      }
      if (key === 'b') {
        e.preventDefault();
        const activeEl = document.activeElement;
        const inConsole = activeEl?.closest('[data-testid="console-panel"]');
        if (inConsole) {
          if (effectiveLayout === 'tabs') setActiveTab('editor');
          setTimeout(() => editorRef.current?.focus(), 20);
        } else {
          if (effectiveLayout === 'tabs') setActiveTab('console');
          setTimeout(() => consoleRef.current?.focusInput(), 20);
        }
        return;
      }
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        handleChangeFontSize(1);
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        handleChangeFontSize(-1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    effectiveLayout,
    handleChangeFontSize,
    handleClearConsole,
    handleCycleLayoutAllThree,
    handleDownloadCode,
    handleFormatCode,
    handleRun,
    handleStop,
    status,
  ]);

  // Cleanup SSE and timers on unmount
  useEffect(() => {
    return () => {
      closeActiveStream();
      if (formatTimerRef.current) clearTimeout(formatTimerRef.current);
    };
  }, [closeActiveStream]);

  // Pointer drag resizing for both side-by-side and stacked split dividers (Magic Keyboard trackpad + iPad touch/stylus)
  const handleDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!workspaceRef.current) return;
    e.preventDefault();
    draggingRef.current = true;
    setIsDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events without active pointer id
    }
  };

  const handleDividerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !workspaceRef.current) return;
    e.preventDefault();
    const rect = workspaceRef.current.getBoundingClientRect();
    if (effectiveLayout === 'side-by-side' && rect.width > 0) {
      const ratio = (e.clientX - rect.left) / rect.width;
      setSplitRatio(clampSplitRatio(ratio));
    } else if (effectiveLayout === 'stacked' && rect.height > 0) {
      const ratio = (e.clientY - rect.top) / rect.height;
      setSplitRatio(clampSplitRatio(ratio));
    }
  };

  const finishDividerDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
  };

  const currentFileName = language === 'cpp' ? 'main.cpp' : 'main.c';

  return (
    <div
      className={`flex h-dvh w-full flex-col overflow-hidden bg-white text-[#111827] dark:bg-[#0D1117] dark:text-[#E6EDF3] ${
        isDragging
          ? effectiveLayout === 'side-by-side'
            ? 'select-none cursor-col-resize'
            : 'select-none cursor-row-resize'
          : ''
      }`}
    >
      <TopBar
        language={language}
        standard={currentStandard}
        status={status}
        theme={theme}
        fontSize={fontSize}
        layoutPreference={layoutPreference}
        effectiveLayout={effectiveLayout}
        templates={CODE_TEMPLATES}
        onChangeLanguage={(lang) => {
          setLanguage(lang);
          setDiagnostics([]);
        }}
        onChangeStandard={(std) => setStandards((prev) => ({ ...prev, [language]: std }))}
        onSelectTemplate={handleSelectTemplate}
        onRun={() => void handleRun()}
        onStop={() => void handleStop()}
        onFormat={handleFormatCode}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        onChangeFontSize={handleChangeFontSize}
        onSelectLayout={(nextLayout) => setLayoutPreference(nextLayout)}
        onDownloadCode={handleDownloadCode}
        onImportCode={handleImportCode}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />

      {/* Dedicated tab bar when in Tabs mode (reachable anytime via Layout picker or narrow screens) */}
      {effectiveLayout === 'tabs' && (
        <div
          role="tablist"
          aria-label="Переключение между редактором и консолью"
          className="flex h-11 shrink-0 items-center border-b border-[#DFE4EC] bg-[#F3F5F8] px-3 dark:border-[#232B38] dark:bg-[#141922]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'editor'}
            onClick={() => setActiveTab('editor')}
            className={`flex h-full flex-1 items-center justify-center border-b-2 text-xs font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'editor'
                ? 'border-[#2563EB] text-[#111827] dark:text-[#E6EDF3]'
                : 'border-transparent text-[#5B6576] hover:text-[#111827] dark:text-[#8B95A5] dark:hover:text-[#E6EDF3]'
            }`}
          >
            Код · {currentFileName}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'console'}
            onClick={() => setActiveTab('console')}
            className={`flex h-full flex-1 items-center justify-center border-b-2 text-xs font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'console'
                ? 'border-[#2563EB] text-[#111827] dark:text-[#E6EDF3]'
                : 'border-transparent text-[#5B6576] hover:text-[#111827] dark:text-[#8B95A5] dark:hover:text-[#E6EDF3]'
            }`}
          >
            Консоль
            {diagSummary.errors > 0 ? ` (${diagSummary.errors})` : status === 'running' ? ' · ввод' : ''}
          </button>
        </div>
      )}

      {/* Main Adaptive Split Workspace */}
      <main
        ref={workspaceRef}
        data-layout={effectiveLayout}
        className={`flex min-h-0 min-w-0 w-full flex-1 overflow-hidden ${
          effectiveLayout === 'side-by-side' ? 'flex-row' : 'flex-col'
        }`}
      >
        {/* Editor Pane: strictly flex-constrained with min-w-0 + overflow-hidden so code never goes under Console */}
        <section
          aria-label="Панель редактора кода"
          data-testid="editor-pane"
          className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${
            effectiveLayout === 'tabs' && activeTab !== 'editor' ? 'hidden' : 'flex'
          } ${isDragging ? 'pointer-events-none select-none' : ''}`}
          style={
            effectiveLayout === 'side-by-side'
              ? {
                  flex: `0 0 ${splitRatio * 100}%`,
                  width: `${splitRatio * 100}%`,
                  maxWidth: `${splitRatio * 100}%`,
                }
              : effectiveLayout === 'stacked'
                ? {
                    flex: `0 0 ${splitRatio * 100}%`,
                    height: `${splitRatio * 100}%`,
                    maxHeight: `${splitRatio * 100}%`,
                  }
                : { flex: '1 1 0%' }
          }
        >
          {/* Editor sub-header: file info + Word Wrap toggle + Format (⌘⇧F) */}
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-[#DFE4EC] bg-[#F3F5F8] px-3 sm:px-3.5 dark:border-[#232B38] dark:bg-[#141922]">
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <span className="truncate font-mono font-semibold text-[#111827] dark:text-[#E6EDF3]">
                {currentFileName}
              </span>
              <span aria-hidden="true" className="hidden min-[440px]:inline text-[#94A3B8] dark:text-[#4B5565]">
                ·
              </span>
              <span className="hidden min-[440px]:inline truncate text-[#5B6576] dark:text-[#8B95A5]">
                {language === 'cpp' ? 'g++' : 'gcc'} ({currentStandard})
              </span>
              {diagSummary.errors > 0 && (
                <>
                  <span aria-hidden="true" className="text-[#94A3B8] dark:text-[#4B5565]">
                    ·
                  </span>
                  <span className="font-medium text-rose-600 tabular-nums whitespace-nowrap dark:text-rose-400">
                    Ошибок: {diagSummary.errors}
                  </span>
                </>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-pressed={effectiveWordWrap}
                onClick={handleToggleWordWrap}
                title={
                  effectiveWordWrap
                    ? 'Перенос строк включён (нажмите, чтобы выключить)'
                    : 'Перенос строк выключен (включается автоматически при узком экране)'
                }
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  effectiveWordWrap
                    ? 'bg-blue-500/12 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                    : 'text-[#475569] hover:bg-black/5 hover:text-[#111827] dark:text-[#9CA3AF] dark:hover:bg-white/5 dark:hover:text-[#E6EDF3]'
                }`}
              >
                <WrapText className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Перенос</span>
              </button>

              <button
                type="button"
                onClick={handleFormatCode}
                aria-label="Форматировать код"
                title="Форматировать код (⌘⇧F)"
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[#475569] transition-colors hover:bg-black/5 hover:text-[#111827] whitespace-nowrap dark:text-[#9CA3AF] dark:hover:bg-white/5 dark:hover:text-[#E6EDF3]"
              >
                {formattedFeedback ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlignLeft className="h-3.5 w-3.5" />
                )}
                <span>{formattedFeedback ? 'Готово' : 'Формат'}</span>
                <span className="hidden xl:inline font-mono text-[10px] text-[#64748B] dark:text-[#6E7A8A]">
                  ⌘⇧F
                </span>
              </button>
            </div>
          </div>

          <div className="min-h-0 min-w-0 w-full flex-1 overflow-hidden">
            <CodeEditor
              ref={editorRef}
              value={currentCode}
              onChange={(next) => setCodes((prev) => ({ ...prev, [language]: next }))}
              theme={theme}
              fontSize={fontSize}
              lineWrapping={effectiveWordWrap}
              diagnostics={diagnostics}
              onRun={() => void handleRun()}
              onFormat={handleFormatCode}
              onWidthChange={setEditorWidth}
            />
          </div>
        </section>

        {/* Draggable Split Handle (Magic Keyboard trackpad + iPad touch/stylus) */}
        {effectiveLayout !== 'tabs' && (
          <div
            role="separator"
            aria-orientation={effectiveLayout === 'side-by-side' ? 'vertical' : 'horizontal'}
            aria-label="Изменить размер панелей"
            data-testid="split-divider"
            onPointerDown={handleDividerPointerDown}
            onPointerMove={handleDividerPointerMove}
            onPointerUp={finishDividerDrag}
            onPointerCancel={finishDividerDrag}
            onDoubleClick={() => setSplitRatio(0.5)}
            className={`group relative z-10 flex shrink-0 touch-none select-none items-center justify-center transition-colors ${
              isDragging
                ? 'bg-[#2563EB] dark:bg-[#3B82F6]'
                : 'bg-[#DFE4EC] hover:bg-[#2563EB] dark:bg-[#232B38] dark:hover:bg-[#3B82F6]'
            } ${
              effectiveLayout === 'side-by-side'
                ? 'w-1.5 cursor-col-resize'
                : 'h-1.5 cursor-row-resize'
            }`}
          >
            {/* Subtle tactile grip bar for iPad trackpad & touch */}
            <div
              aria-hidden="true"
              className={`rounded-full transition-colors ${
                isDragging
                  ? 'bg-white/90'
                  : 'bg-[#94A3B8]/60 group-hover:bg-white/90 dark:bg-[#64748B]/70'
              } ${effectiveLayout === 'side-by-side' ? 'h-8 w-0.5' : 'h-0.5 w-8'}`}
            />
            {/* Expanded invisible hit target for effortless iPad touch & stylus grabbing */}
            <div
              className={
                effectiveLayout === 'side-by-side'
                  ? 'absolute inset-y-0 -left-2.5 -right-2.5'
                  : 'absolute inset-x-0 -top-2.5 -bottom-2.5'
              }
            />
          </div>
        )}

        {/* Console Pane: strictly flex-1 with min-w-0 + overflow-hidden */}
        <div
          data-testid="console-pane"
          className={`min-h-0 min-w-0 flex-1 overflow-hidden ${
            effectiveLayout === 'tabs' && activeTab !== 'console' ? 'hidden' : 'flex'
          } ${isDragging ? 'pointer-events-none select-none' : ''}`}
        >
          <ConsolePanel
            ref={consoleRef}
            status={status}
            chunks={chunks}
            diagnostics={diagnostics}
            rawCompilerOutput={rawCompilerOutput}
            compileTimeMs={compileTimeMs}
            runDurationMs={runDurationMs}
            exitCode={exitCode}
            exitReason={exitReason}
            fontSize={fontSize}
            onSendInput={(line) => void handleSendInput(line)}
            onSendEof={() => void handleSendEof()}
            onStop={() => void handleStop()}
            onClear={handleClearConsole}
            onJumpToDiagnostic={handleJumpToDiagnostic}
          />
        </div>
      </main>

      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
