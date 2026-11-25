import test from 'node:test';
import assert from 'node:assert/strict';
import { CODE_TEMPLATES, DEFAULT_CODE } from '../data/templates';
import { BrowserCppSession, compileInBrowser } from './cppEngine';

function runWithInputs(
  code: string,
  language: 'cpp' | 'c',
  inputs: string[],
  sendEofAfter = true
): Promise<{ stdout: string; stderr: string; exitCode: number | null; reason?: string }> {
  const compiled = compileInBrowser(code, language);
  assert.equal(compiled.ok, true, `Expected compile success, got: ${compiled.rawCompilerOutput}`);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const session = new BrowserCppSession(compiled.program!, {
      onStdout: (chunk) => {
        stdout += chunk;
      },
      onStderr: (chunk) => {
        stderr += chunk;
      },
      onExit: ({ code: exitCode, reason }) => {
        resolve({ stdout, stderr, exitCode, reason });
      },
    });

    for (const line of inputs) {
      session.writeStdin(`${line}\n`);
    }
    if (sendEofAfter) {
      session.sendEof();
    }
  });
}

test('runs default C++ interactive cin/cout template accurately', async () => {
  const res = await runWithInputs(DEFAULT_CODE.cpp, 'cpp', ['17 25']);
  assert.equal(res.exitCode, 0);
  assert.match(res.stdout, /Введите два числа через пробел:/);
  assert.match(res.stdout, /Сумма: 42/);
  assert.match(res.stdout, /Произведение: 425/);
});

test('runs default C scanf/printf template accurately', async () => {
  const res = await runWithInputs(DEFAULT_CODE.c, 'c', ['9 6']);
  assert.equal(res.exitCode, 0);
  assert.match(res.stdout, /Сумма: 15/);
  assert.match(res.stdout, /Произведение: 54/);
});

test('runs user pointer + new int[n] + arr + i + %p program from iPad screenshot', async () => {
  const userCode = `#include <stdio.h>

void fillAndPrint(int *arr, int n) {
    for (int i = 0; i < n; i += 1) {
        printf("Введи элемент [%d]: ", i);
        scanf("%d", arr + i);
    }

    printf("\\nАдрес массива: %p\\n", arr);
    for (int i = 0; i < n; i += 1) {
        printf("arr[%d] = %d (адрес: %p)\\n", i, arr[i], arr + i);
    }
}

int main() {
    int n;
    printf("Проверка ввода. Введи размер массива (например, 3): ");
    scanf("%d", &n);

    int *d1 = new int[n];
    fillAndPrint(d1, n);
    delete[] d1;

    printf("\\nКомпилятор работает отлично!\\n");
    return 0;
}`;

  const res = await runWithInputs(userCode, 'cpp', ['3', '10', '20', '30']);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stderr, '');
  assert.match(res.stdout, /Адрес массива: 0x[0-9a-f]+/);
  assert.match(res.stdout, /arr\[0\] = 10 \(адрес: 0x[0-9a-f]+\)/);
  assert.match(res.stdout, /arr\[2\] = 30 \(адрес: 0x[0-9a-f]+\)/);
  assert.match(res.stdout, /Компилятор работает отлично!/);
});

test('runs vector sort template and C malloc/free stats template', async () => {
  const sortTpl = CODE_TEMPLATES.find((t) => t.id === 'cpp-array-sort')!;
  const sortRes = await runWithInputs(sortTpl.code, 'cpp', ['4', '40 10 30 20']);
  assert.equal(sortRes.exitCode, 0);
  assert.match(sortRes.stdout, /Отсортировано: 10 20 30 40/);
  assert.match(sortRes.stdout, /Минимум: 10, Максимум: 40/);

  const statsTpl = CODE_TEMPLATES.find((t) => t.id === 'c-stats')!;
  const statsRes = await runWithInputs(statsTpl.code, 'c', ['3', '2.5 3.5 6.0']);
  assert.equal(statsRes.exitCode, 0);
  assert.match(statsRes.stdout, /Сумма: 12\.00/);
  assert.match(statsRes.stdout, /Среднее: 4\.00/);
});

test('runs interactive calculator loop until EOF cleanly', async () => {
  const calcTpl = CODE_TEMPLATES.find((t) => t.id === 'cpp-calculator')!;
  const res = await runWithInputs(calcTpl.code, 'cpp', ['12.5 * 4', '10 / 0', '7 + 8'], true);
  assert.equal(res.exitCode, 0);
  assert.match(res.stdout, /= 50/);
  assert.match(res.stdout, /Ошибка: деление на ноль/);
  assert.match(res.stdout, /= 15/);
});

test('reports syntax error with exact line, column, and caret preview', () => {
  const broken = `#include <stdio.h>
int main(void) {
    int x = 10
    printf("%d\\n", x);
    return 0;
}`;
  const res = compileInBrowser(broken, 'c');
  assert.equal(res.ok, false);
  assert.equal(res.diagnostics.length, 1);
  assert.equal(res.diagnostics[0].line, 4);
  assert.equal(res.diagnostics[0].severity, 'error');
  assert.match(res.diagnostics[0].message, /expected ';'/);
  assert.ok(res.diagnostics[0].caretLine?.includes('^'));
});

test('stops infinite loops cleanly via session.stop()', async () => {
  const compiled = compileInBrowser('int main() { while (true) {} return 0; }', 'cpp');
  assert.equal(compiled.ok, true);

  const result = await new Promise<{ exitCode: number | null; reason?: string }>((resolve) => {
    const session = new BrowserCppSession(compiled.program!, {
      onStdout: () => {},
      onStderr: () => {},
      onExit: ({ code, reason }) => resolve({ exitCode: code, reason }),
    });
    setTimeout(() => session.stop(), 15);
  });

  assert.equal(result.exitCode, null);
  assert.match(result.reason ?? '', /Остановлено/);
});
