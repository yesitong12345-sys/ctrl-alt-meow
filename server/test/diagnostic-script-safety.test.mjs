import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const probes = [
  new URL('../scripts/dsh-rebuild-model-test.mjs', import.meta.url),
  new URL('../scripts/dsh-rebuild-success-test.mjs', import.meta.url),
];

test('manual rebuild probes refuse automatic test-runner execution', async () => {
  for (const url of probes) {
    const source = await readFile(url, 'utf8');
    const runnerGuard = source.indexOf('process.env.NODE_TEST_CONTEXT');
    const optInGuard = source.indexOf("process.env.ALLOW_REBUILD_SMOKE !== '1'");
    const firstRequest = source.indexOf('fetch(base');
    assert.ok(runnerGuard >= 0 && runnerGuard < firstRequest, `${url.pathname} must guard before network access`);
    assert.ok(optInGuard >= 0 && optInGuard < firstRequest, `${url.pathname} must require explicit isolated-smoke opt-in`);
  }
});
