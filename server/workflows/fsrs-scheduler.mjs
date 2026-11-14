// FSRS 调度器（Node 侧封装）
//
// 真正的调度数学交给官方 py-fsrs（server/python/fsrs_bridge.py），
// 这里只负责：解释器/PYTHONPATH 解析、进程调用、超时保护、
// 以及把 FSRS 的 stability / retrievability 翻译成成绩单上的「掌握度」。
//
// 独立模块：不 import 项目里任何既有 workflow，避免与并行开发冲突。
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, '..');
const BRIDGE_PATH = path.join(SERVER_DIR, 'python', 'fsrs_bridge.py');

/** 四档评分：与 py-fsrs 的 Rating 一一对应 */
export const RATINGS = Object.freeze([
  {value: 1, key: 'again', label: '忘了', hint: '完全想不起来'},
  {value: 2, key: 'hard', label: '有点难', hint: '想起来了，但很吃力'},
  {value: 3, key: 'good', label: '还行', hint: '顺利回忆起来'},
  {value: 4, key: 'easy', label: '太简单', hint: '毫不费力'}
]);

/** 评分 <= 2（忘了 / 有点难）需要重新进入当前队列 */
export const REPEAT_THRESHOLD = 2;

/** 掌握度满值对应的 stability（天）：约半年后仍能记住即视为掌握 */
const MASTERY_FULL_STABILITY = 180;

export class FsrsUnavailableError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'FsrsUnavailableError';
    this.code = 'FSRS_UNAVAILABLE';
    this.detail = detail || null;
  }
}

function defaultPythonCandidates() {
  const packaged = process.platform === 'win32'
    ? path.join(SERVER_DIR, 'python', 'runtime', 'python.exe')
    : path.join(SERVER_DIR, 'python', 'runtime', 'bin', 'python3');
  return [
    packaged,
    path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
    '/usr/bin/python3',
    '/usr/local/bin/python3'
  ];
}

/** 只允许已存在的绝对路径，避免 PATH 中的 python 别名或应用商店占位程序。 */
export function resolvePythonExecutable({
  configured = process.env.PYTHON_BIN,
  candidates = defaultPythonCandidates(),
  exists = existsSync
} = {}) {
  const requested = String(configured || '').trim();
  if (requested && path.isAbsolute(requested) && exists(requested)) return requested;
  const fallback = candidates.find(candidate => path.isAbsolute(candidate) && exists(candidate));
  if (fallback) return fallback;
  throw new FsrsUnavailableError(
    'FSRS 需要一个已存在的 Python 绝对路径；请设置 PYTHON_BIN=/usr/bin/python3 或随包解释器路径',
    {configured: requested || null, candidates}
  );
}

export function pythonExecutable() {
  return resolvePythonExecutable();
}

/** PYTHONPATH 同时挂上项目的 vendor 与 fsrs 独立目录 */
function pythonPathEnv() {
  const parts = [
    path.join(SERVER_DIR, 'python', 'vendor'),
    path.join(SERVER_DIR, 'python', 'vendor-fsrs')
  ].filter(part => existsSync(part));
  const inherited = process.env.PYTHONPATH;
  if (inherited) parts.push(inherited);
  return parts.join(path.delimiter);
}

/**
 * 调用 py-fsrs 桥。任何失败都抛 FsrsUnavailableError，绝不静默降级 ——
 * 复习间隔算错比报错更糟。
 */
export function callFsrsBridge(payload, {timeoutMs = 20000} = {}) {
  return new Promise((resolve, reject) => {
    const bridgeExists = existsSync(BRIDGE_PATH);
    if (!bridgeExists) {
      reject(new FsrsUnavailableError('找不到 fsrs_bridge.py', {bridgePath: BRIDGE_PATH}));
      return;
    }
    let child;
    try {
      child = spawn(pythonExecutable(), ['-X', 'utf8', '-B', BRIDGE_PATH], {
        cwd: path.join(SERVER_DIR, 'python'),
        windowsHide: true,
        env: {...process.env, PYTHONUTF8: '1', PYTHONPATH: pythonPathEnv()}
      });
    } catch (error) {
      reject(new FsrsUnavailableError('无法启动 Python 进程', {cause: String(error && error.message)}));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new FsrsUnavailableError(`FSRS 调度超时（${timeoutMs}ms）`, {stderr: stderr.slice(-400)}));
    }, timeoutMs);

    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new FsrsUnavailableError('Python 进程启动失败', {cause: String(error && error.message)}));
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = stdout.trim();
      if (!text) {
        reject(new FsrsUnavailableError(`FSRS 桥无输出（exit=${code}）`, {stderr: stderr.slice(-400)}));
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(text.split('\n').filter(Boolean).pop());
      } catch (error) {
        reject(new FsrsUnavailableError('FSRS 桥返回了非 JSON 内容', {stdout: text.slice(-400), stderr: stderr.slice(-400)}));
        return;
      }
      if (!parsed.ok) {
        reject(new FsrsUnavailableError(parsed.error || 'FSRS 桥执行失败', parsed));
        return;
      }
      resolve(parsed);
    });

    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

/** 该在什么时候用多高的目标保留率：考前 3 天提到 0.95，其余 0.90 */
export function desiredRetentionFor(examDate, now = new Date()) {
  if (!examDate) return 0.90;
  const exam = new Date(examDate);
  if (Number.isNaN(exam.getTime())) return 0.90;
  const days = (exam.getTime() - now.getTime()) / 86400000;
  if (days <= 3) return 0.95;
  return 0.90;
}

/** stability（天）→ 0~100 掌握度。对数刻度，避免长间隔被线性压扁 */
export function masteryFromStability(stability) {
  const value = Number(stability);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const ratio = Math.log1p(value) / Math.log1p(MASTERY_FULL_STABILITY);
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/** 综合掌握度：稳定度为主，当前可回忆概率为辅 */
export function masteryScore({stability, retrievability} = {}) {
  const base = masteryFromStability(stability);
  const current = Number(retrievability);
  if (!Number.isFinite(current)) return base;
  return Math.round(base * 0.7 + Math.min(1, Math.max(0, current)) * 100 * 0.3);
}

/** 项目的 knowledgeCard → py-fsrs 的 card 结构 */
export function toFsrsCard(fsrsState) {
  if (!fsrsState || typeof fsrsState !== 'object') return null;
  const card = {};
  for (const key of ['card_id', 'state', 'step', 'stability', 'difficulty', 'due', 'last_review']) {
    if (fsrsState[key] !== undefined) card[key] = fsrsState[key];
  }
  return Object.keys(card).length ? card : null;
}

/** 单卡评分 */
export async function reviewCard(card, rating, {now, desiredRetention, examDate} = {}) {
  return callFsrsBridge({
    op: 'review',
    card: toFsrsCard(card),
    rating: Number(rating),
    now: (now || new Date()).toISOString(),
    desiredRetention: desiredRetention ?? desiredRetentionFor(examDate, now || new Date())
  });
}

/** 批量评分 */
export async function reviewCards(items, {now, desiredRetention, examDate} = {}) {
  const stamp = now || new Date();
  return callFsrsBridge({
    op: 'reviewBatch',
    items: (items || []).map(item => ({
      card: toFsrsCard(item.card),
      rating: Number(item.rating),
      now: (item.now || stamp).toISOString()
    })),
    now: stamp.toISOString(),
    desiredRetention: desiredRetention ?? desiredRetentionFor(examDate, stamp)
  });
}

/** 预览四档各自的间隔（前端按钮上显示「忘了→1天」这类提示） */
export async function previewRatings(card, {now, desiredRetention, examDate} = {}) {
  return callFsrsBridge({
    op: 'preview',
    card: toFsrsCard(card),
    now: (now || new Date()).toISOString(),
    desiredRetention: desiredRetention ?? desiredRetentionFor(examDate, now || new Date())
  });
}

/** 当前可回忆概率 */
export async function cardRetrievability(card, {now, desiredRetention} = {}) {
  return callFsrsBridge({
    op: 'retrievability',
    card: toFsrsCard(card),
    now: (now || new Date()).toISOString(),
    desiredRetention: desiredRetention ?? 0.90
  });
}

/** 桥是否可用（启动自检 / 健康检查用） */
export async function fsrsHealth() {
  try {
    const result = await callFsrsBridge({op: 'preview', card: null, desiredRetention: 0.9});
    return {available: true, python: pythonExecutable(), preview: result.items};
  } catch (error) {
    let python = null;
    try { python = pythonExecutable(); } catch {}
    return {available: false, python, error: error.message, code: error.code || null};
  }
}
