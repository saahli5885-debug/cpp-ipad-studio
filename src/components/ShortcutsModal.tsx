import { useEffect } from 'react';
import { X } from 'lucide-react';

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ['⌘', 'Enter'], label: 'Скомпилировать и запустить код' },
  { keys: ['⌘', '⇧', 'F'], label: 'Форматировать код (clang-format стиль)' },
  { keys: ['⌘', '\\'], label: 'Сменить раскладку: Рядом / Сверху / Вкладки' },
  { keys: ['⌘', '.'], label: 'Остановить выполняющуюся программу' },
  { keys: ['⌘', 'B'], label: 'Переключить фокус: Редактор ↔ Консоль' },
  { keys: ['⌘', 'K'], label: 'Очистить консоль' },
  { keys: ['⌘', '/'], label: 'Закомментировать / раскомментировать строку' },
  { keys: ['⌘', 'F'], label: 'Поиск по коду' },
  { keys: ['⌘', 'S'], label: 'Скачать текущий файл (.cpp / .c)' },
  { keys: ['⌘', '+ / -'], label: 'Увеличить или уменьшить шрифт' },
  { keys: ['Ctrl', 'D'], label: 'Отправить конец ввода (EOF) в консоль' },
  { keys: ['Tab'], label: 'Отступ 4 пробела (Shift+Tab — убрать)' },
];

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-[#DFE4EC] bg-white p-5 shadow-xl dark:border-[#283244] dark:bg-[#141922]"
      >
        <div className="flex items-center justify-between gap-4 border-b border-[#E6EBF2] pb-3 dark:border-[#232B38]">
          <h2 id="shortcuts-title" className="text-sm font-semibold text-[#111827] dark:text-[#E6EDF3]">
            Горячие клавиши Magic Keyboard
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно горячих клавиш"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#5B6576] transition-colors hover:bg-black/5 hover:text-[#111827] dark:text-[#8B95A5] dark:hover:bg-white/5 dark:hover:text-[#E6EDF3]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="mt-3 divide-y divide-[#EDF1F6] dark:divide-[#1F2735]">
          {SHORTCUTS.map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-4 py-2.5 text-xs">
              <span className="text-[#334155] dark:text-[#CBD5E1]">{item.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {item.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border border-[#D8DEE8] bg-[#F3F5F8] px-1.5 py-0.5 font-mono text-[11px] font-medium text-[#111827] dark:border-[#2C3648] dark:bg-[#0D1117] dark:text-[#E6EDF3]"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
