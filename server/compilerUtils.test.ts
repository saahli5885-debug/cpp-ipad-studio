import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompilerInvocation,
  buildSanitizedRunEnv,
  isValidSessionId,
  MAX_CODE_BYTES,
  validateCompileRequest,
} from './compilerUtils';

test('validates C++ and C compile requests and rejects invalid inputs', () => {
  const validCpp = validateCompileRequest({
    language: 'cpp',
    standard: 'c++20',
    code: 'int main() { return 0; }',
  });
  assert.equal(validCpp.ok, true);
  if (validCpp.ok) {
    assert.equal(validCpp.data.language, 'cpp');
    assert.equal(validCpp.data.standard, 'c++20');
  }

  // Fallback to default standard when mismatched standard is passed
  const mismatchedStd = validateCompileRequest({
    language: 'c',
    standard: 'c++20',
    code: 'int main(void) { return 0; }',
  });
  assert.equal(mismatchedStd.ok, true);
  if (mismatchedStd.ok) {
    assert.equal(mismatchedStd.data.standard, 'c17');
  }

  assert.equal(validateCompileRequest({ language: 'python', code: 'print(1)' }).ok, false);
  assert.equal(validateCompileRequest({ language: 'cpp', code: '   ' }).ok, false);
  assert.equal(
    validateCompileRequest({ language: 'cpp', code: 'a'.repeat(MAX_CODE_BYTES + 1) }).ok,
    false
  );
});

test('validates hex session IDs strictly', () => {
  assert.equal(isValidSessionId('0123456789abcdef0123456789abcdef'), true);
  assert.equal(isValidSessionId('../etc/passwd'), false);
  assert.equal(isValidSessionId('short'), false);
});

test('builds safe compiler invocations without shell flags and adds -lm for C', () => {
  const cpp = buildCompilerInvocation('cpp', 'c++20', '/tmp/a/main.cpp', '/tmp/a/main.out');
  assert.equal(cpp.command, '/usr/bin/g++');
  assert.ok(cpp.args.includes('-std=c++20'));
  assert.ok(!cpp.args.includes('-lm'));

  const c = buildCompilerInvocation('c', 'c17', '/tmp/a/main.c', '/tmp/a/main.out');
  assert.equal(c.command, '/usr/bin/gcc');
  assert.ok(c.args.includes('-std=c17'));
  assert.ok(c.args.includes('-lm'));
});

test('sanitized runtime environment strips host secrets', () => {
  process.env.GEMINI_API_KEY = 'secret-test-key';
  const env = buildSanitizedRunEnv();
  assert.equal('GEMINI_API_KEY' in env, false);
  assert.equal(env.PATH, '/usr/bin:/bin');
});
