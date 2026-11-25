import { useEffect, useRef, useState } from 'react';
import {
  AlignLeft,
  BookOpen,
  Check,
  ChevronDown,
  Columns2,
  Download,
  Keyboard,
  Loader2,
  Minus,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelTop,
  Play,
  Plus,
  Rows2,
  Square,
  Sun,
  Upload,
} from 'lucide-react';
import type {
  CodeTemplate,
  CompilerStandard,
  EffectiveLayout,
  Language,
  LayoutPreference,
  RunStatus,
} from '../types/compiler';

const STANDARDS_BY_LANG: Record<Language, { value: CompilerStandard; label: string }[]> = {
  cpp: [
    { value: 'c++23', label: 'C++23' },
    { value: 'c++20', label: 'C++20' },
    { value: 'c++17', label: 'C++17' },
    { value: 'c++14', label: 'C++14' },
  ],
  c: [
    { value: 'c17', label: 'C17' },
    { value: 'c11', label: 'C11' },
    { value: 'c99', label: 'C99' },
  ],
};

interface LayoutOption {
  value: LayoutPreference;
  label: string;
  hint: string;
}

const LAYOUT_OPTIONS: LayoutOption[] = [
  { value: 'auto', label: 'Авто', hint: 'Подстраивается под экран' },
  { value: 'side-by-side', label: 'Рядом', hint: 'Код слева, консоль справа' },
  { value: 'stacked', label: 'Сверху и снизу', hint: 'Код сверху, консоль снизу' },
  { value: 'tabs', label: 'Вкладки', hint: 'Переключение Код / Консоль' },
];

interface TopBarProps {
  language: Language;
  standard: CompilerStandard;
  status: RunStatus;
  theme: 'dark' | 'light';
  fontSize: number;
  layoutPreference: LayoutPreference;
  effectiveLayout: EffectiveLayout;
  templates: CodeTemplate[];
  onChangeLanguage: (lang: Language) => void;
  onChangeStandard: (std: CompilerStandard) => void;
  onSelectTemplate: (template: CodeTemplate) => void;
  onRun: () => void;
  onStop: () => void;
  onFormat: () => void;
  onToggleTheme: () => void;
  onChangeFontSize: (delta: number) => void;
  onSelectLayout: (layout: LayoutPreference) => void;
  onDownloadCode: () => void;
  onImportCode: (content: string, detectedLang?: Language) => void;
  onOpenShortcuts: () => void;
}

function LayoutIcon({ layout, className }: { layout: EffectiveLayout | LayoutPreference; className?: string }) {
  if (layout === 'side-by-side') return <Columns2 className={className} />;
  if (layout === 'stacked') return <Rows2 className={className} />;
  if (layout === 'tabs') return <PanelTop className={className} />;
  return <Monitor className={className} />;
}

export function TopBar({
  language,
  standard,
  status,
  theme,
  fontSize,
  layoutPreference,
  effectiveLayout,
  templates,
  onChangeLanguage,
  onChangeStandard,
  onSelectTemplate,
  onRun,
  onStop,
  onFormat,
  onToggleTheme,
  onChangeFontSize,
  onSelectLayout,
  onDownloadCode,
  onImportCode,
  onOpenShortcuts,
}: TopBarProps) {
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const templatesMenuRef = useRef<HTMLDivElement | null>(null);
  const layoutMenuRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (templatesMenuRef.current && !templatesMenuRef.current.contains(e.target as Node)) {
        setTemplatesOpen(false);
      }
      if (layoutMenuRef.current && !layoutMenuRef.current.contains(e.target as Node)) {
        setLayoutOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTemplatesOpen(false);
        setLayoutOpen(false);
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const isBusy = status === 'compiling' || status === 'running';
  const filteredTemplates = templates.filter((t) => t.language === language);

  const activeLayoutLabel =
    layoutPreference === 'auto'
      ? `Раскладка: Авто (${
          effectiveLayout === 'side-by-side'
            ? 'рядом'
            : effectiveLayout === 'stacked'
              ? 'сверху/снизу'
              : 'вкладки'
        })`
      : layoutPreference === 'side-by-side'
        ? 'Раскладка: Рядом'
        : layoutPreference === 'stacked'
          ? 'Раскладка: Сверху и снизу'
          : 'Раскладка: Вкладки (Код / Консоль)';

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const lower = file.name.toLowerCase();
      const detectedLang: Language | undefined = lower.endsWith('.c')
        ? 'c'
        : lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx')
          ? 'cpp'
          : undefined;
      onImportCode(text, detectedLang);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <header className="flex h-12 sm:h-13 shrink-0 items-center justify-between gap-2 sm:gap-3 border-b border-[#DFE4EC] bg-[#F3F5F8] px-2.5 sm:px-4 dark:border-[#232B38] dark:bg-[#141922]">
      {/* Left zone: Brand + Language switch + Standard */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <span className="text-sm font-bold tracking-tight text-[#111827] whitespace-nowrap shrink-0 dark:text-[#E6EDF3]">
          C++ Studio
        </span>

        <div
          role="group"
          aria-label="Выбор языка программирования"
          className="flex shrink-0 items-center rounded-lg border border-[#D8DEE8] bg-[#E8ECF2] p-0.5 dark:border-[#252E3D] dark:bg-[#0D1117]"
        >
          <button
            type="button"
            aria-pressed={language === 'cpp'}
            onClick={() => onChangeLanguage('cpp')}
            className={`rounded-md px-2 sm:px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              language === 'cpp'
                ? 'bg-white text-[#111827] shadow-xs dark:bg-[#1E2634] dark:text-[#E6EDF3]'
                : 'text-[#5B6576] hover:text-[#111827] dark:text-[#8B95A5] dark:hover:text-[#E6EDF3]'
            }`}
          >
            C++
          </button>
          <button
            type="button"
            aria-pressed={language === 'c'}
            onClick={() => onChangeLanguage('c')}
            className={`rounded-md px-2 sm:px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              language === 'c'
                ? 'bg-white text-[#111827] shadow-xs dark:bg-[#1E2634] dark:text-[#E6EDF3]'
                : 'text-[#5B6576] hover:text-[#111827] dark:text-[#8B95A5] dark:hover:text-[#E6EDF3]'
            }`}
          >
            C
          </button>
        </div>

        <label className="hidden min-[520px]:block shrink-0">
          <span className="sr-only">Стандарт компилятора</span>
          <select
            aria-label="Стандарт компилятора"
            value={standard}
            onChange={(e) => onChangeStandard(e.target.value as CompilerStandard)}
            className="h-8 rounded-lg border border-[#D8DEE8] bg-white px-2 text-xs font-medium text-[#111827] outline-none transition-colors hover:border-[#B6C2D2] focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-[#252E3D] dark:bg-[#0D1117] dark:text-[#E6EDF3] dark:hover:border-[#39455B]"
          >
            {STANDARDS_BY_LANG[language].map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Right zone: Utilities + Primary CTA */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {/* Examples dropdown (visible on >= md, also inside More menu on narrow screens) */}
        <div ref={templatesMenuRef} className="relative hidden md:block">
          <button
            type="button"
            aria-expanded={templatesOpen}
            aria-haspopup="menu"
            onClick={() => setTemplatesOpen((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#D8DEE8] bg-white px-2.5 text-xs font-medium text-[#111827] transition-colors hover:bg-[#F8FAFC] whitespace-nowrap shrink-0 dark:border-[#252E3D] dark:bg-[#181F2B] dark:text-[#E6EDF3] dark:hover:bg-[#1F2836]"
          >
            <BookOpen className="h-3.5 w-3.5 text-[#5B6576] dark:text-[#8B95A5]" />
            <span>Примеры</span>
            <ChevronDown className="h-3.5 w-3.5 text-[#5B6576] dark:text-[#8B95A5]" />
          </button>

          {templatesOpen && (
            <div
              role="menu"
              className="absolute right-0 z-30 mt-1.5 w-72 rounded-xl border border-[#DFE4EC] bg-white p-1.5 shadow-lg dark:border-[#283244] dark:bg-[#161C26]"
            >
              {filteredTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSelectTemplate(tpl);
                    setTemplatesOpen(false);
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-[#F3F5F8] dark:hover:bg-[#202938]"
                >
                  <div className="text-xs font-semibold text-[#111827] dark:text-[#E6EDF3]">
                    {tpl.title}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#5B6576] dark:text-[#8B95A5]">
                    {tpl.description}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Font size controls on >= lg */}
        <div className="hidden lg:flex items-center rounded-lg border border-[#D8DEE8] bg-white dark:border-[#252E3D] dark:bg-[#181F2B]">
          <button
            type="button"
            onClick={() => onChangeFontSize(-1)}
            aria-label="Уменьшить шрифт"
            title="Уменьшить шрифт (⌘-)"
            className="inline-flex h-8 w-7 items-center justify-center text-[#5B6576] transition-colors hover:text-[#111827] dark:text-[#8B95A5] dark:hover:text-[#E6EDF3]"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="px-1 font-mono text-[11px] text-[#5B6576] tabular-nums dark:text-[#8B95A5]">
            {fontSize}
          </span>
          <button
            type="button"
            onClick={() => onChangeFontSize(1)}
            aria-label="Увеличить шрифт"
            title="Увеличить шрифт (⌘+)"
            className="inline-flex h-8 w-7 items-center justify-center text-[#5B6576] transition-colors hover:text-[#111827] dark:text-[#8B95A5] dark:hover:text-[#E6EDF3]"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 3-mode Layout Picker (Рядом / Сверху и снизу / Вкладки / Авто) — always 1 tap away! */}
        <div ref={layoutMenuRef} className="relative">
          <button
            type="button"
            aria-label={activeLayoutLabel}
            aria-expanded={layoutOpen}
            aria-haspopup="menu"
            title={`${activeLayoutLabel} (⌘\\)`}
            onClick={() => setLayoutOpen((v) => !v)}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#D8DEE8] bg-white px-2 text-[#475569] transition-colors hover:bg-[#F8FAFC] hover:text-[#111827] shrink-0 dark:border-[#252E3D] dark:bg-[#181F2B] dark:text-[#9CA3AF] dark:hover:bg-[#1F2836] dark:hover:text-[#E6EDF3]"
          >
            <LayoutIcon layout={effectiveLayout} className="h-4 w-4" />
            <ChevronDown className="h-3 w-3 opacity-70" />
          </button>

          {layoutOpen && (
            <div
              role="menu"
              aria-label="Выбор раскладки панелей"
              className="absolute right-0 z-30 mt-1.5 w-60 rounded-xl border border-[#DFE4EC] bg-white p-1.5 shadow-lg dark:border-[#283244] dark:bg-[#161C26]"
            >
              <div className="px-2.5 py-1 text-[11px] font-semibold text-[#5B6576] dark:text-[#8B95A5]">
                Раскладка (⌘\)
              </div>
              {LAYOUT_OPTIONS.map((option) => {
                const isSelected = layoutPreference === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isSelected}
                    onClick={() => {
                      onSelectLayout(option.value);
                      setLayoutOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      isSelected
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                        : 'text-[#111827] hover:bg-[#F3F5F8] dark:text-[#E6EDF3] dark:hover:bg-[#202938]'
                    }`}
                  >
                    <LayoutIcon layout={option.value} className="h-4 w-4 shrink-0 opacity-85" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold">{option.label}</div>
                      <div className="truncate text-[11px] text-[#5B6576] dark:text-[#8B95A5]">
                        {option.hint}
                      </div>
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Magic Keyboard shortcuts button on >= lg */}
        <button
          type="button"
          onClick={onOpenShortcuts}
          aria-label="Горячие клавиши Magic Keyboard"
          title="Горячие клавиши Magic Keyboard"
          className="hidden lg:inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#D8DEE8] bg-white text-[#475569] transition-colors hover:bg-[#F8FAFC] hover:text-[#111827] shrink-0 dark:border-[#252E3D] dark:bg-[#181F2B] dark:text-[#9CA3AF] dark:hover:bg-[#1F2836] dark:hover:text-[#E6EDF3]"
        >
          <Keyboard className="h-4 w-4" />
        </button>

        {/* Open file button on >= xl */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Открыть файл с кодом"
          title="Открыть файл (.cpp / .c)"
          className="hidden xl:inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#D8DEE8] bg-white text-[#475569] transition-colors hover:bg-[#F8FAFC] hover:text-[#111827] shrink-0 dark:border-[#252E3D] dark:bg-[#181F2B] dark:text-[#9CA3AF] dark:hover:bg-[#1F2836] dark:hover:text-[#E6EDF3]"
        >
          <Upload className="h-4 w-4" />
        </button>

        {/* Download file button on >= xl */}
        <button
          type="button"
          onClick={onDownloadCode}
          aria-label="Скачать файл с кодом"
          title="Скачать файл (⌘S)"
          className="hidden xl:inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#D8DEE8] bg-white text-[#475569] transition-colors hover:bg-[#F8FAFC] hover:text-[#111827] shrink-0 dark:border-[#252E3D] dark:bg-[#181F2B] dark:text-[#9CA3AF] dark:hover:bg-[#1F2836] dark:hover:text-[#E6EDF3]"
        >
          <Download className="h-4 w-4" />
        </button>

        {/* Theme toggle */}
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
          title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#D8DEE8] bg-white text-[#475569] transition-colors hover:bg-[#F8FAFC] hover:text-[#111827] shrink-0 dark:border-[#252E3D] dark:bg-[#181F2B] dark:text-[#9CA3AF] dark:hover:bg-[#1F2836] dark:hover:text-[#E6EDF3]"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* Overflow menu ONLY when secondary actions are collapsed (< xl) */}
        <div ref={moreMenuRef} className="relative xl:hidden">
          <button
            type="button"
            aria-label="Дополнительные действия"
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            onClick={() => setMoreOpen((v) => !v)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#D8DEE8] bg-white text-[#475569] transition-colors hover:bg-[#F8FAFC] hover:text-[#111827] shrink-0 dark:border-[#252E3D] dark:bg-[#181F2B] dark:text-[#9CA3AF] dark:hover:bg-[#1F2836] dark:hover:text-[#E6EDF3]"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {moreOpen && (
            <div
              role="menu"
              className="absolute right-0 z-30 mt-1.5 w-64 rounded-xl border border-[#DFE4EC] bg-white p-1.5 shadow-lg dark:border-[#283244] dark:bg-[#161C26]"
            >
              {/* Standard selector on narrow screens (< 520px) */}
              <div className="flex items-center justify-between px-2.5 py-2 min-[520px]:hidden">
                <span className="text-xs text-[#5B6576] dark:text-[#8B95A5]">Стандарт</span>
                <select
                  aria-label="Стандарт компилятора в меню"
                  value={standard}
                  onChange={(e) => onChangeStandard(e.target.value as CompilerStandard)}
                  className="h-7 rounded border border-[#D8DEE8] bg-[#F8FAFC] px-2 text-xs font-medium text-[#111827] dark:border-[#252E3D] dark:bg-[#0D1117] dark:text-[#E6EDF3]"
                >
                  {STANDARDS_BY_LANG[language].map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Font size controls (< lg) */}
              <div className="flex items-center justify-between px-2.5 py-2 lg:hidden">
                <span className="text-xs text-[#5B6576] dark:text-[#8B95A5]">Размер шрифта</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onChangeFontSize(-1)}
                    aria-label="Уменьшить шрифт в меню"
                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#D8DEE8] text-[#111827] hover:bg-[#F3F5F8] dark:border-[#2A3446] dark:text-[#E6EDF3] dark:hover:bg-[#202938]"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-7 text-center font-mono text-xs tabular-nums text-[#111827] dark:text-[#E6EDF3]">
                    {fontSize}
                  </span>
                  <button
                    type="button"
                    onClick={() => onChangeFontSize(1)}
                    aria-label="Увеличить шрифт в меню"
                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#D8DEE8] text-[#111827] hover:bg-[#F3F5F8] dark:border-[#2A3446] dark:text-[#E6EDF3] dark:hover:bg-[#202938]"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <div className="my-1 border-t border-[#E6EBF2] lg:hidden dark:border-[#232B38]" />

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onFormat();
                  setMoreOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-[#111827] hover:bg-[#F3F5F8] dark:text-[#E6EDF3] dark:hover:bg-[#202938]"
              >
                <AlignLeft className="h-3.5 w-3.5 text-[#5B6576] dark:text-[#8B95A5]" />
                <span>Форматировать код (⌘⇧F)</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  fileInputRef.current?.click();
                  setMoreOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-[#111827] hover:bg-[#F3F5F8] dark:text-[#E6EDF3] dark:hover:bg-[#202938]"
              >
                <Upload className="h-3.5 w-3.5 text-[#5B6576] dark:text-[#8B95A5]" />
                <span>Открыть файл (.cpp / .c)</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onDownloadCode();
                  setMoreOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-[#111827] hover:bg-[#F3F5F8] dark:text-[#E6EDF3] dark:hover:bg-[#202938]"
              >
                <Download className="h-3.5 w-3.5 text-[#5B6576] dark:text-[#8B95A5]" />
                <span>Скачать код (⌘S)</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onOpenShortcuts();
                  setMoreOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-[#111827] hover:bg-[#F3F5F8] lg:hidden dark:text-[#E6EDF3] dark:hover:bg-[#202938]"
              >
                <Keyboard className="h-3.5 w-3.5 text-[#5B6576] dark:text-[#8B95A5]" />
                <span>Клавиши Magic Keyboard</span>
              </button>

              {/* Examples list inside More menu for narrow screens (< md) */}
              <div className="md:hidden">
                <div className="my-1 border-t border-[#E6EBF2] dark:border-[#232B38]" />
                <div className="px-2.5 py-1 text-[11px] font-semibold text-[#5B6576] dark:text-[#8B95A5]">
                  Примеры ({language === 'cpp' ? 'C++' : 'C'})
                </div>
                {filteredTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onSelectTemplate(tpl);
                      setMoreOpen(false);
                    }}
                    className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-[#111827] hover:bg-[#F3F5F8] dark:text-[#E6EDF3] dark:hover:bg-[#202938]"
                  >
                    {tpl.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".cpp,.cc,.cxx,.c,.h,.hpp,.txt"
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
        />

        {/* Single primary CTA: Запустить / Остановить */}
        {status === 'running' ? (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 sm:px-3.5 text-xs font-semibold text-white transition-colors hover:bg-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 whitespace-nowrap shrink-0"
          >
            <Square className="h-3 w-3 fill-current" />
            <span>Остановить</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onRun}
            disabled={isBusy}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 sm:px-3.5 text-xs font-semibold text-white transition-colors hover:bg-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-65 whitespace-nowrap shrink-0"
          >
            {status === 'compiling' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
            <span>{status === 'compiling' ? 'Сборка...' : 'Запустить'}</span>
            <span className="hidden md:inline font-mono text-[11px] font-normal text-blue-100">
              ⌘↵
            </span>
          </button>
        )}
      </div>
    </header>
  );
}
