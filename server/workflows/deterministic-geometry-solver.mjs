import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {buildPedagogicalVisualization} from './pedagogical-visualization.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_ROOT = path.resolve(HERE, '..', 'python');
const MAX_INPUT_BYTES = 100 * 1024;
const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;

const exactToNumber = node => node?.op === 'integer' ? Number(node.value)
  : node?.op === 'rational' ? Number(node.p) / Number(node.q)
    : node?.op === 'sqrt' ? Math.sqrt(exactToNumber(node.arg))
      : node?.op === 'neg' ? -exactToNumber(node.arg)
        : node?.op === 'add' ? node.args.reduce((sum, item) => sum + exactToNumber(item), 0)
          : node?.op === 'mul' ? node.args.reduce((product, item) => product * exactToNumber(item), 1) : NaN;

function attachPedagogy(result, request) {
  if (result?.solverStatus !== 'verified' || !result.scene || result.scene.pedagogy) return result;
  const coordinates = Object.fromEntries(Object.entries(result.canonicalCoordinates || {}).map(([id, values]) => [id, values.map(exactToNumber)]));
  result.scene.pedagogy = buildPedagogicalVisualization({scene: result.scene, coordinates, query: request?.query, verification: result.verification});
  return result;
}

const failure = (failureCode, details = [], retryable = false) => ({
  solverStatus: 'solver_failed',
  failureCode,
  retryable,
  details
});

function terminateProcessTree(child) {
  if (!child.pid) return Promise.resolve();
  if (process.platform !== 'win32') {
    child.kill('SIGKILL');
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    killer.on('close', resolve);
    killer.on('error', () => {
      child.kill();
      resolve();
    });
  });
}

function runOnce(request, {pythonBin, timeoutMs}) {
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) >= MAX_INPUT_BYTES) {
    return Promise.resolve(failure('INPUT_TOO_LARGE', [{path: '$', code: 'INPUT_TOO_LARGE'}]));
  }
  return new Promise(resolve => {
    const child = spawn(pythonBin, ['-X', 'utf8', '-m', 'geometry_solver.cli'], {
      cwd: PYTHON_ROOT,
      windowsHide: true,
      env: {...process.env, PYTHONUTF8: '1'},
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let outputExceeded = false;
    let outputTerminating = false;
    let timedOut = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(async () => {
      timedOut = true;
      await terminateProcessTree(child);
      finish(failure('SOLVER_TIMEOUT', [], true));
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES && !outputExceeded) {
        outputExceeded = true;
        outputTerminating = true;
        void terminateProcessTree(child).then(() => {
          outputTerminating = false;
          finish(failure('SOLVER_OUTPUT_LIMIT'));
        });
      } else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDERR_BYTES && !outputExceeded) {
        outputExceeded = true;
        outputTerminating = true;
        void terminateProcessTree(child).then(() => {
          outputTerminating = false;
          finish(failure('SOLVER_OUTPUT_LIMIT'));
        });
      } else stderr.push(chunk);
    });
    child.on('error', error => finish(failure('PYTHON_LAUNCH_FAILED', [{path: 'pythonBin', code: error.code || 'SPAWN_ERROR'}])));
    child.on('close', code => {
      if (settled) return;
      if (timedOut) return;
      if (outputExceeded) return outputTerminating ? undefined : finish(failure('SOLVER_OUTPUT_LIMIT'));
      if (code !== 0) return finish(failure('SOLVER_PROCESS_FAILED', [{path: 'stderr', code: Buffer.concat(stderr).toString('utf8').slice(0, 300)}]));
      try {
        const parsed = JSON.parse(Buffer.concat(stdout).toString('utf8'));
        finish(parsed);
      } catch {
        finish(failure('INVALID_SOLVER_JSON'));
      }
    });
    child.stdin.end(input, 'utf8');
  });
}

export async function solveConfirmedGeometry(request, options = {}) {
  const bundledPython = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe');
  const pythonBin = options.pythonBin || process.env.PYTHON_BIN || (existsSync(bundledPython) ? bundledPython : 'python');
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const first = await runOnce(request, {pythonBin, timeoutMs});
  if (first.failureCode !== 'SOLVER_TIMEOUT' || options.retry === false) return attachPedagogy(first, request);
  return attachPedagogy(await runOnce(request, {pythonBin, timeoutMs}), request);
}
