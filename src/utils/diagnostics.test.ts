import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCompilerDiagnostics, summarizeDiagnostics } from './diagnostics';

test('parses g++ errors and warnings with source snippets and carets', () => {
  const sample = `/tmp/cpp-studio-abc/main.cpp: In function 'int main()':
/tmp/cpp-studio-abc/main.cpp:5:18: error: expected ';' before 'return'
    5 |     int x = 10 + 5
      |                  ^
      |                  ;
/tmp/cpp-studio-abc/main.cpp:4:9: warning: unused variable 'y' [-Wunused-variable]
    4 |     int y = 0;
      |         ^
`;

  const parsed = parseCompilerDiagnostics(sample);
  assert.equal(parsed.length, 2);

  assert.equal(parsed[0].file, 'main.cpp');
  assert.equal(parsed[0].line, 5);
  assert.equal(parsed[0].column, 18);
  assert.equal(parsed[0].severity, 'error');
  assert.equal(parsed[0].message, "expected ';' before 'return'");
  assert.ok(parsed[0].codeSnippet?.includes('int x = 10 + 5'));
  assert.ok(parsed[0].caretLine?.includes('^'));

  assert.equal(parsed[1].file, 'main.cpp');
  assert.equal(parsed[1].line, 4);
  assert.equal(parsed[1].column, 9);
  assert.equal(parsed[1].severity, 'warning');
  assert.match(parsed[1].message, /unused variable 'y'/);

  const summary = summarizeDiagnostics(parsed);
  assert.deepEqual(summary, { errors: 1, warnings: 1, notes: 0 });
});

test('parses linker undefined reference errors cleanly', () => {
  const sample = `/usr/bin/ld: /tmp/ccXYZ.o: in function 'main':
main.cpp:(.text+0x15): undefined reference to 'missing_func()'
collect2: error: ld returned 1 exit status`;

  const parsed = parseCompilerDiagnostics(sample);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].severity, 'error');
  assert.equal(parsed[0].line, null);
  assert.match(parsed[0].message, /undefined reference to 'missing_func\(\)'/);
});

test('returns empty array for clean compiler output', () => {
  assert.deepEqual(parseCompilerDiagnostics(''), []);
  assert.deepEqual(parseCompilerDiagnostics('   \n  '), []);
});
