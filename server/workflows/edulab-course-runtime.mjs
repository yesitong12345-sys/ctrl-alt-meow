import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CATALOGS = {
  analytic: ['ellipse_dot_range', 'ellipse_chord_range', 'ellipse_area_max', 'ellipse_slopeprod_const', 'parabola_dot_const', 'hyperbola_ecc_range'],
  chemistry: ['combustion_ch4', 'combustion_h2', 'electrolysis_water', 'redox_na_cl2', 'esterification', 'glucose_combustion']
};

function pythonExecutable() {
  const bundled = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe');
  return process.env.PYTHON_BIN || (existsSync(bundled) ? bundled : 'python');
}

function runPython(script, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable(), ['-X', 'utf8', '-B', script, ...args], {
      cwd: options.cwd,
      windowsHide: true,
      env: {...process.env, PYTHONUTF8: '1', PYTHONPATH: options.pythonPath}
    });
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('SKILL_GENERATION_TIMEOUT')); }, options.timeoutMs || 20000);
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`SKILL_GENERATION_FAILED:${stderr.trim() || code}`));
    });
  });
}

export function skillCatalog(kind) {
  return [...(CATALOGS[kind] || [])];
}

export async function generateSkillCourse({kind, key, seed, serverDir, uiRoot}) {
  const catalog = skillCatalog(kind);
  if (!catalog.length) throw Object.assign(new Error('UNKNOWN_SKILL_KIND'), {statusCode: 422});
  let selected = key;
  if (!selected) selected = catalog[Math.abs(Number(seed) || 0) % catalog.length];
  if (!catalog.includes(selected)) throw Object.assign(new Error('UNKNOWN_SKILL_COURSE'), {statusCode: 422});
  const skillName = kind === 'analytic' ? 'edu-analytic-geometry' : 'edu-chem-reaction';
  const script = path.join(serverDir, 'third_party', 'edulab', 'skills', skillName, 'scripts', 'generate.py');
  const outputDir = path.join(uiRoot, 'skills', 'runtime');
  await mkdir(outputDir, {recursive: true});
  const outputName = `${kind}-${selected}.html`;
  const outputPath = path.join(outputDir, outputName);
  await runPython(script, [selected, outputPath], {
    cwd: serverDir,
    pythonPath: path.join(serverDir, 'python', 'vendor'),
    timeoutMs: 30000
  });
  return {kind, key: selected, url: `/skills/runtime/${outputName}`, generatedBy: `${skillName}/scripts/generate.py`, exactKernel: true};
}
