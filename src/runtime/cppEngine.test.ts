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

test('stops cleanly while blocked waiting on interactive stdin', async () => {
  const compiled = compileInBrowser(
    '#include <iostream>\nint main() { int x; std::cout << "Enter: " << std::flush; std::cin >> x; return 0; }',
    'cpp'
  );
  assert.equal(compiled.ok, true);

  let waited = false;
  let stdout = '';
  const result = await new Promise<{ exitCode: number | null; reason?: string }>((resolve) => {
    const session = new BrowserCppSession(compiled.program!, {
      onStdout: (chunk) => {
        stdout += chunk;
      },
      onStderr: () => {},
      onWaitingForInput: () => {
        waited = true;
      },
      onExit: ({ code, reason }) => resolve({ exitCode: code, reason }),
    });
    setTimeout(() => session.stop(), 20);
  });

  assert.equal(stdout, 'Enter: ');
  assert.equal(waited, true);
  assert.equal(result.exitCode, null);
  assert.match(result.reason ?? '', /Остановлено/);
});

// Verification Gate #1: Glued tokens "12.5*.5" and "12+34"
test('[Gate 1] non-greedy numeric parsing handles glued tokens 12.5*.5 and 12+34 and rollback on invalid input', async () => {
  const code = `#include <iostream>
using namespace std;
int main() {
    double a, b;
    char op;
    cin >> a >> op >> b;
    cout << a << "|" << op << "|" << b << "\\n";

    int x, y;
    char op2;
    cin >> x >> op2 >> y;
    cout << x << "|" << op2 << "|" << y << "\\n";

    int bad = 99;
    if (!(cin >> bad)) {
        cout << "FAIL\\n";
        cin.clear();
        string word;
        cin >> word;
        cout << "RECOVERED:" << word << "\\n";
    }
    return 0;
}`;
  const res = await runWithInputs(code, 'cpp', ['12.5*.5', '12+34', 'hello']);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, '12.5|*|0.5\n12|+|34\nFAIL\nRECOVERED:hello\n');
});

// Verification Gate #2: cin >> age + getline(cin >> ws, name) with Cyrillic (both batched & async)
test('[Gate 2] getline(cin >> ws, name) reads UTF-8 Cyrillic line after numeric cin >> age', async () => {
  const code = `#include <iostream>
#include <string>
using namespace std;
int main() {
    int age;
    string name;
    cout << "Age: " << flush;
    cin >> age;
    cout << "Name: " << flush;
    getline(cin >> ws, name);
    cout << age << ":" << name << endl;
    return 0;
}`;
  // Test interactive async delivery where second line arrives after cin >> ws blocks
  const compiled = compileInBrowser(code, 'cpp');
  assert.equal(compiled.ok, true, compiled.rawCompilerOutput);

  let stdout = '';
  let stderr = '';
  const exitCode = await new Promise<number | null>((resolve) => {
    const session = new BrowserCppSession(compiled.program!, {
      onStdout: (t) => {
        stdout += t;
      },
      onStderr: (t) => {
        stderr += t;
      },
      onExit: ({ code: c }) => resolve(c),
    });
    setTimeout(() => session.writeStdin('25\n'), 10);
    setTimeout(() => session.writeStdin('Иван Иванов\n'), 35);
  });

  assert.equal(exitCode, 0, stderr);
  assert.equal(stdout, 'Age: Name: 25:Иван Иванов\n');
});

// Verification Gate #3: putback, unget, peek
test('[Gate 3] cin.putback, cin.unget, and cin.peek navigate stream cursor accurately', async () => {
  const code = `#include <iostream>
using namespace std;
int main() {
    char c;
    int x;
    cin >> c;
    cin.putback(c);
    int p = cin.peek();
    cin >> x;
    cout << c << "|" << static_cast<char>(p) << "|" << x << "\\n";

    char a = static_cast<char>(cin.get());
    cin.unget();
    char b = static_cast<char>(cin.get());
    cout << (a == b ? "SAME" : "DIFF") << "\\n";
    return 0;
}`;
  const res = await runWithInputs(code, 'cpp', ['42', 'Z']);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, '4|4|42\nSAME\n');
});

// Verification Gate #4: std::numeric_limits<std::streamsize>::max() with extra parens & cin.ignore
test('[Gate 4] cin.clear() and cin.ignore((std::numeric_limits<std::streamsize>::max)(), \'\\n\') clear garbage', async () => {
  const code = `#include <iostream>
#include <limits>
using namespace std;
int main() {
    int n = 0;
    while (!(cin >> n)) {
        cout << "BAD\\n";
        cin.clear();
        cin.ignore((std::numeric_limits<std::streamsize>::max)(), '\\n');
    }
    cout << "OK:" << n << "\\n";
    return 0;
}`;
  const res = await runWithInputs(code, 'cpp', ['abc def', '+++', '77']);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, 'BAD\nBAD\nOK:77\n');
});

// Verification Gate #5: istringstream, ostringstream, vector<string>
test('[Gate 5] std::istringstream, std::ostringstream, and std::vector<std::string> work together', async () => {
  const code = `#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <iomanip>
using namespace std;
int main() {
    istringstream iss("10 + 20");
    int a, b;
    char op;
    iss >> a >> op >> b;

    ostringstream oss;
    oss << a << " " << op << " " << b << " = " << fixed << setprecision(1) << static_cast<double>(a + b);

    vector<string> results;
    results.push_back(oss.str());

    istringstream lines("first line\\nsecond line");
    string ln;
    while (getline(lines, ln)) {
        results.push_back(ln);
    }

    for (const auto& item : results) {
        cout << item << "\\n";
    }
    return 0;
}`;
  const res = await runWithInputs(code, 'cpp', []);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, '10 + 20 = 30.0\nfirst line\nsecond line\n');
});

// Verification Gate #6: Recursive descent Parser class with map<string, double>&, initializer list, std::stod
test('[Gate 6] recursive class Parser with map reference, member initializer list, and std::stod evaluates 2 + 3 * (4 - 1) = 11', async () => {
  const code = `#include <iostream>
#include <string>
#include <map>
#include <cctype>
#include <stdexcept>
using namespace std;

class Parser {
    const string& src;
    map<string, double>& vars;
    size_t pos;

    void skipWs() {
        while (pos < src.size() && isspace(static_cast<unsigned char>(src[pos]))) {
            pos++;
        }
    }

    double parseFactor() {
        skipWs();
        if (pos < src.size() && src[pos] == '(') {
            pos++;
            double v = parseExpr();
            skipWs();
            if (pos < src.size() && src[pos] == ')') pos++;
            return v;
        }
        if (pos < src.size() && isalpha(static_cast<unsigned char>(src[pos]))) {
            size_t start = pos;
            while (pos < src.size() && isalnum(static_cast<unsigned char>(src[pos]))) pos++;
            string name = src.substr(start, pos - start);
            return vars[name];
        }
        size_t consumed = 0;
        double num = stod(src.substr(pos), &consumed);
        pos += consumed;
        return num;
    }

    double parseTerm() {
        double left = parseFactor();
        while (true) {
            skipWs();
            if (pos < src.size() && (src[pos] == '*' || src[pos] == '/')) {
                char op = src[pos++];
                double right = parseFactor();
                left = (op == '*') ? (left * right) : (left / right);
            } else {
                break;
            }
        }
        return left;
    }

public:
    Parser(const string& s, map<string, double>& v) : src(s), vars(v), pos(0) {}

    double parseExpr() {
        double left = parseTerm();
        while (true) {
            skipWs();
            if (pos < src.size() && (src[pos] == '+' || src[pos] == '-')) {
                char op = src[pos++];
                double right = parseTerm();
                left = (op == '+') ? (left + right) : (left - right);
            } else {
                break;
            }
        }
        return left;
    }
};

int main() {
    map<string, double> vars;
    vars["x"] = 4.0;
    string expr1 = "2 + 3 * (4 - 1)";
    Parser p1(expr1, vars);
    cout << p1.parseExpr() << "\\n";

    string expr2 = "2 + 3 * (x - 1)";
    Parser p2(expr2, vars);
    cout << p2.parseExpr() << "\\n";
    return 0;
}`;
  const res = await runWithInputs(code, 'cpp', []);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, '11\n11\n');
});

test('supports unified C stdio + C++ iostream, fstream Virtual FS with RAII close, string ops, map/set, try/catch, and atomic static reset', async () => {
  const code = `#include <iostream>
#include <cstdio>
#include <fstream>
#include <string>
#include <map>
#include <set>
#include <stdexcept>
using namespace std;

int nextCounter() {
    static int counter = 0;
    counter++;
    return counter;
}

int main() {
    // 1. Unified scanf + cin over same buffer
    int a, b;
    scanf("%d", &a);
    cin >> b;
    printf("SUM=%d\\n", a + b);

    // 2. Virtual FS ofstream/ifstream with RAII scope close
    {
        ofstream out("data.txt");
        out << "hello file " << 42 << "\\n";
    }
    ifstream in("data.txt");
    string line;
    getline(in, line);
    cout << "FILE=" << line << "\\n";

    // 3. std::string + char, char + string, [] mutation, npos
    string s = "ab";
    s = s + 'c';
    s = '>' + s;
    s[1] = 'A';
    cout << "STR=" << s << " NPOS=" << (s.find("zzz") == string::npos ? 1 : 0) << "\\n";

    // 4. map structured bindings & set
    map<string, int> m;
    m["b"] = 2;
    m["a"] = 1;
    for (const auto& [k, v] : m) {
        cout << k << "=" << v << " ";
    }
    cout << "\\n";

    set<int> st;
    st.insert(3);
    st.insert(1);
    st.insert(3);
    cout << "SET=" << st.size() << "\\n";

    // 5. try/catch/throw
    try {
        throw runtime_error("boom");
    } catch (const exception& e) {
        cout << "CAUGHT=" << e.what() << "\\n";
    }

    // 6. static local counter
    cout << "STATIC=" << nextCounter() << "," << nextCounter() << "\\n";
    return 0;
}`;

  const run1 = await runWithInputs(code, 'cpp', ['10 20']);
  assert.equal(run1.exitCode, 0, run1.stderr);
  assert.equal(
    run1.stdout,
    'SUM=30\nFILE=hello file 42\nSTR=>Abc NPOS=1\na=1 b=2 \nSET=2\nCAUGHT=boom\nSTATIC=1,2\n'
  );

  // Atomic reset check: second run must start static counter fresh at 1,2 and clean Virtual FS
  const run2 = await runWithInputs(code, 'cpp', ['3 4']);
  assert.equal(run2.exitCode, 0, run2.stderr);
  assert.match(run2.stdout, /SUM=7/);
  assert.match(run2.stdout, /STATIC=1,2/);
});

test('prevents browser crash on infinite recursion with stack overflow guard', async () => {
  const code = `int boom(int n) { return boom(n + 1); }
int main() { return boom(0); }`;
  const res = await runWithInputs(code, 'cpp', []);
  assert.equal(res.exitCode, 1);
  assert.match(res.stderr, /Stack overflow/i);
});

