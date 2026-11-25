import type { CodeTemplate, Language } from '../types/compiler';

export const DEFAULT_CODE: Record<Language, string> = {
  cpp: `#include <iostream>
using namespace std;

int main() {
    int a, b;
    cout << "Введите два числа через пробел: ";
    if (cin >> a >> b) {
        cout << "Сумма: " << (a + b) << "\\n";
        cout << "Произведение: " << (a * b) << "\\n";
    }
    return 0;
}
`,
  c: `#include <stdio.h>

int main(void) {
    int a, b;
    printf("Введите два числа через пробел: ");
    if (scanf("%d %d", &a, &b) == 2) {
        printf("Сумма: %d\\n", a + b);
        printf("Произведение: %d\\n", a * b);
    }
    return 0;
}
`,
};

export const CODE_TEMPLATES: CodeTemplate[] = [
  {
    id: 'cpp-sum',
    language: 'cpp',
    title: 'Интерактивный ввод (cin)',
    description: 'Сложение и умножение двух чисел из консоли',
    code: DEFAULT_CODE.cpp,
  },
  {
    id: 'cpp-array-sort',
    language: 'cpp',
    title: 'Сортировка вектора',
    description: 'Ввод массива чисел, сортировка и поиск минимума/максимума',
    code: `#include <algorithm>
#include <iostream>
#include <vector>
using namespace std;

int main() {
    int n;
    cout << "Сколько чисел ввести? ";
    if (!(cin >> n) || n <= 0) {
        cout << "Нужно положительное число.\\n";
        return 0;
    }

    vector<int> nums(n);
    cout << "Введите " << n << " чисел: ";
    for (int i = 0; i < n; ++i) {
        cin >> nums[i];
    }

    sort(nums.begin(), nums.end());

    cout << "Отсортировано: ";
    for (int i = 0; i < n; ++i) {
        cout << nums[i] << (i + 1 < n ? " " : "\\n");
    }
    cout << "Минимум: " << nums.front() << ", Максимум: " << nums.back() << "\\n";
    return 0;
}
`,
  },
  {
    id: 'cpp-calculator',
    language: 'cpp',
    title: 'Интерактивный калькулятор',
    description: 'Многократный ввод выражений вида 12 * 4 в цикле',
    code: `#include <iostream>
using namespace std;

int main() {
    double a, b;
    char op;

    cout << "Калькулятор (например: 12.5 * 4). Для выхода нажмите Ctrl+D.\\n";
    while (true) {
        cout << "> ";
        if (!(cin >> a >> op >> b)) break;

        switch (op) {
            case '+': cout << "= " << (a + b) << "\\n"; break;
            case '-': cout << "= " << (a - b) << "\\n"; break;
            case '*': cout << "= " << (a * b) << "\\n"; break;
            case '/':
                if (b == 0) cout << "Ошибка: деление на ноль\\n";
                else cout << "= " << (a / b) << "\\n";
                break;
            default:
                cout << "Неизвестная операция: " << op << "\\n";
        }
    }
    return 0;
}
`,
  },
  {
    id: 'c-sum',
    language: 'c',
    title: 'Ввод и вывод (scanf / printf)',
    description: 'Базовый интерактивный пример на чистом C',
    code: DEFAULT_CODE.c,
  },
  {
    id: 'c-stats',
    language: 'c',
    title: 'Среднее и статистика массива',
    description: 'Динамический массив чисел на C с подсчётом среднего',
    code: `#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int n;
    printf("Количество элементов: ");
    if (scanf("%d", &n) != 1 || n <= 0) {
        printf("Некорректный размер.\\n");
        return 0;
    }

    double *arr = (double *)malloc((size_t)n * sizeof(double));
    if (!arr) return 1;

    double sum = 0.0;
    printf("Введите %d чисел: ", n);
    for (int i = 0; i < n; ++i) {
        scanf("%lf", &arr[i]);
        sum += arr[i];
    }

    printf("Сумма: %.2f\\n", sum);
    printf("Среднее: %.2f\\n", sum / n);

    free(arr);
    return 0;
}
`,
  },
];
