import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCppCode } from './formatCpp';

test('formats cramped C++ code with proper indentation and spacing', () => {
  const messy = `#include <iostream>
using namespace std;
int main(){int a,b;cout<<"Введите два числа: ";if(cin>>a>>b){cout<<"Сумма: "<<(a+b)<<"\\n";}else{cout<<"Ошибка\\n";}return 0;}`;

  const result = formatCppCode(messy);
  const expected = `#include <iostream>
using namespace std;
int main() {
    int a, b;
    cout << "Введите два числа: ";
    if (cin >> a >> b) {
        cout << "Сумма: " << (a + b) << "\\n";
    } else {
        cout << "Ошибка\\n";
    }
    return 0;
}
`;
  assert.equal(result, expected);
  // Must be idempotent
  assert.equal(formatCppCode(result), expected);
});

test('preserves C pointers, printf format strings, Cyrillic strings, and comments', () => {
  const input = `#include <stdio.h>

void fillAndPrint(int *arr,int n){
for(int i=0;i<n;i+=1){
printf("Введи элемент [%d]: ",i); // ввод числа
scanf("%d",arr+i);
}
printf("\\nАдрес массива: %p\\n",arr);
}`;

  const result = formatCppCode(input);
  assert.ok(result.includes('void fillAndPrint(int *arr, int n) {'));
  assert.ok(result.includes('    for (int i = 0; i < n; i += 1) {'));
  assert.ok(result.includes('        printf("Введи элемент [%d]: ", i); // ввод числа'));
  assert.ok(result.includes('        scanf("%d", arr + i);'));
  assert.equal(formatCppCode(result), result);
});

test('formats switch/case blocks and class access specifiers cleanly', () => {
  const input = `class Calc {
public:
int add(int a,int b){return a+b;}
private:
int last;
};

void run(int op) {
switch(op){
case 1:
cout<<"one";
break;
default:
cout<<"other";
}
}`;

  const result = formatCppCode(input);
  assert.ok(result.includes('class Calc {\npublic:\n    int add(int a, int b) {'));
  assert.ok(result.includes('    switch (op) {\n    case 1:\n        cout << "one";'));
  assert.ok(result.includes('    default:\n        cout << "other";'));
  assert.equal(formatCppCode(result), result);
});

test('handles empty input gracefully', () => {
  assert.equal(formatCppCode('   \n  '), '');
});
