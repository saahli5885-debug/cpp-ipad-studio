import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { cpp } from '@codemirror/lang-cpp';
import { tags } from '@lezer/highlight';
import type { CompilerDiagnostic } from '../types/compiler';

export interface CodeEditorHandle {
  focus: () => void;
  jumpToLine: (line: number, column?: number | null) => void;
}

interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  theme: 'dark' | 'light';
  fontSize: number;
  lineWrapping: boolean;
  diagnostics: CompilerDiagnostic[];
  onRun: () => void;
  onFormat: () => void;
  onWidthChange?: (width: number) => void;
}

const setDiagnosticsEffect = StateEffect.define<{
  diagnostics: CompilerDiagnostic[];
  theme: 'dark' | 'light';
}>();

const diagnosticLinesField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setDiagnosticsEffect)) {
        const { diagnostics, theme } = effect.value;
        const lineSeverity = new Map<number, 'error' | 'warning'>();
        for (const d of diagnostics) {
          if (d.line === null || d.line < 1 || d.line > tr.state.doc.lines) continue;
          if (d.severity === 'error') {
            lineSeverity.set(d.line, 'error');
          } else if (d.severity === 'warning' && !lineSeverity.has(d.line)) {
            lineSeverity.set(d.line, 'warning');
          }
        }

        const builder = new RangeSetBuilder<Decoration>();
        const sortedLines = Array.from(lineSeverity.entries()).sort((a, b) => a[0] - b[0]);
        for (const [lineNum, severity] of sortedLines) {
          const line = tr.state.doc.line(lineNum);
          const className =
            severity === 'error'
              ? theme === 'dark'
                ? 'cm-error-line-dark'
                : 'cm-error-line-light'
              : theme === 'dark'
                ? 'cm-warning-line-dark'
                : 'cm-warning-line-light';
          builder.add(line.from, line.from, Decoration.line({ class: className }));
        }
        next = builder.finish();
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const darkHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.modifier], color: '#FF7B72' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#FFA657' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#D2A8FF' },
  { tag: [tags.string, tags.special(tags.string)], color: '#A5D6FF' },
  { tag: [tags.number, tags.bool, tags.atom], color: '#79C0FF' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#7D8590', fontStyle: 'italic' },
  { tag: [tags.meta, tags.processingInstruction], color: '#79C0FF' },
  { tag: [tags.operator, tags.punctuation], color: '#C9D1D9' },
  { tag: [tags.variableName, tags.propertyName], color: '#E6EDF3' },
]);

const lightHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.modifier], color: '#CF222E' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#953800' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#8250DF' },
  { tag: [tags.string, tags.special(tags.string)], color: '#0A3069' },
  { tag: [tags.number, tags.bool, tags.atom], color: '#0550AE' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#6E7781', fontStyle: 'italic' },
  { tag: [tags.meta, tags.processingInstruction], color: '#0550AE' },
  { tag: [tags.operator, tags.punctuation], color: '#24292F' },
  { tag: [tags.variableName, tags.propertyName], color: '#1F2328' },
]);

function createEditorTheme(theme: 'dark' | 'light', fontSize: number) {
  const isDark = theme === 'dark';
  return EditorView.theme(
    {
      '&': {
        backgroundColor: isDark ? '#0D1117' : '#FFFFFF',
        color: isDark ? '#E6EDF3' : '#111827',
        fontSize: `${fontSize}px`,
        lineHeight: '1.6',
      },
      '.cm-gutters': {
        backgroundColor: isDark ? '#0D1117' : '#FFFFFF',
        color: isDark ? '#4B5565' : '#94A3B8',
        borderRight: `1px solid ${isDark ? '#1E2530' : '#E5E7EB'}`,
        minWidth: '38px',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 8px 0 6px',
        minWidth: '30px',
      },
      '.cm-activeLine': {
        backgroundColor: isDark ? 'rgba(56, 139, 253, 0.07)' : 'rgba(37, 99, 235, 0.05)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: isDark ? 'rgba(56, 139, 253, 0.09)' : 'rgba(37, 99, 235, 0.06)',
        color: isDark ? '#C9D1D9' : '#334155',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: isDark ? '#60A5FA' : '#2563EB',
        borderLeftWidth: '2px',
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: isDark ? 'rgba(59, 130, 246, 0.28)' : 'rgba(37, 99, 235, 0.18)',
      },
      '.cm-matchingBracket': {
        backgroundColor: isDark ? 'rgba(59, 130, 246, 0.24)' : 'rgba(37, 99, 235, 0.16)',
        outline: `1px solid ${isDark ? 'rgba(96, 165, 250, 0.5)' : 'rgba(37, 99, 235, 0.4)'}`,
      },
      '.cm-panels': {
        backgroundColor: isDark ? '#141922' : '#F3F5F8',
        color: isDark ? '#E6EDF3' : '#111827',
        borderBottom: `1px solid ${isDark ? '#232B38' : '#DFE4EC'}`,
      },
      '.cm-searchMatch': {
        backgroundColor: isDark ? 'rgba(245, 158, 11, 0.28)' : 'rgba(245, 158, 11, 0.3)',
      },
    },
    { dark: isDark }
  );
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { value, onChange, theme, fontSize, lineWrapping, diagnostics, onRun, onFormat, onWidthChange },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef(new Compartment());
  const wrapCompartmentRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onFormatRef = useRef(onFormat);
  const onWidthChangeRef = useRef(onWidthChange);

  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  onFormatRef.current = onFormat;
  onWidthChangeRef.current = onWidthChange;

  useImperativeHandle(ref, () => ({
    focus() {
      viewRef.current?.focus();
    },
    jumpToLine(lineNumber: number, column?: number | null) {
      const view = viewRef.current;
      if (!view) return;
      const clampedLine = Math.max(1, Math.min(lineNumber, view.state.doc.lines));
      const line = view.state.doc.line(clampedLine);
      const colOffset = column && column > 0 ? Math.min(column - 1, line.length) : 0;
      const pos = line.from + colOffset;
      view.dispatch({
        selection: { anchor: pos },
        scrollIntoView: true,
      });
      view.focus();
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const themeCompartment = themeCompartmentRef.current;
    const wrapCompartment = wrapCompartmentRef.current;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        indentOnInput(),
        indentUnit.of('    '),
        EditorState.tabSize.of(4),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        cpp(),
        diagnosticLinesField,
        EditorView.contentAttributes.of({
          'aria-label': 'Редактор кода C++ и C',
          spellcheck: 'false',
          autocorrect: 'off',
          autocapitalize: 'off',
          autocomplete: 'off',
        }),
        themeCompartment.of([
          createEditorTheme(theme, fontSize),
          syntaxHighlighting(theme === 'dark' ? darkHighlight : lightHighlight),
        ]),
        wrapCompartment.of(lineWrapping ? EditorView.lineWrapping : []),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              onRunRef.current();
              return true;
            },
          },
          {
            key: 'Mod-Shift-f',
            preventDefault: true,
            run: () => {
              onFormatRef.current();
              return true;
            },
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: container,
    });
    viewRef.current = view;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) {
        onWidthChangeRef.current?.(Math.round(width));
      }
      view.requestMeasure();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      view.destroy();
      viewRef.current = null;
    };
    // Mount CodeMirror once; external value/theme/wrap/diagnostics sync via effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external document changes (template switch, format, language switch, file import)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // Sync theme & font size dynamically without remounting editor state/history
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartmentRef.current.reconfigure([
        createEditorTheme(theme, fontSize),
        syntaxHighlighting(theme === 'dark' ? darkHighlight : lightHighlight),
      ]),
    });
    view.requestMeasure();
  }, [theme, fontSize]);

  // Sync word wrap dynamically without losing cursor position or undo stack
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrapCompartmentRef.current.reconfigure(
        lineWrapping ? EditorView.lineWrapping : []
      ),
    });
    view.requestMeasure();
  }, [lineWrapping]);

  // Sync error/warning line highlights
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setDiagnosticsEffect.of({ diagnostics, theme }),
    });
  }, [diagnostics, theme]);

  return (
    <div
      ref={containerRef}
      data-testid="code-editor"
      data-wrap={lineWrapping ? 'on' : 'off'}
      className="h-full w-full min-w-0 max-w-full box-border overflow-hidden bg-white dark:bg-[#0D1117]"
    />
  );
});
