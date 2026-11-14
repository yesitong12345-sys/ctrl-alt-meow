import test from 'node:test';
import assert from 'node:assert/strict';

import {resolvePythonExecutable} from '../workflows/fsrs-scheduler.mjs';

test('FSRS ignores a relative PYTHON_BIN and selects an existing absolute interpreter', () => {
  const absolutePython = process.platform === 'win32'
    ? 'C:\\educompanion\\python\\python.exe'
    : '/opt/educompanion/python/bin/python3';
  const resolved = resolvePythonExecutable({
    configured: 'python',
    candidates: [absolutePython],
    exists: candidate => candidate === absolutePython
  });
  assert.equal(resolved, absolutePython);
});

test('FSRS rejects startup when no fixed absolute Python interpreter exists', () => {
  assert.throws(
    () => resolvePythonExecutable({configured: 'python', candidates: [], exists: () => false}),
    error => error.code === 'FSRS_UNAVAILABLE' && /绝对路径/.test(error.message)
  );
});
