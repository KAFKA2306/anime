import { access, readdir } from 'node:fs/promises';

const required = [
  'data/manifest.json',
  'data/works.json',
  'scripts/acquire-danime.mjs',
  'scripts/validate-data.mjs',
  'index.html',
  'app.js',
  'ontology/project.yaml',
];

const forbidden = new Set([
  '.github/workflows/actions-probe.yml',
  '.github/workflows/logs-probe.yml',
  '.github/workflows/probe-pages-config.yml',
  'verification/actions-probe-trigger.txt',
  'verification/actions-probe.json',
  'verification/bootstrap-error.txt',
  'verification/logs-probe-trigger.txt',
]);

for (const path of required) await access(path);
for (const path of forbidden) {
  try {
    await access(path);
    throw new Error(`obsolete probe artifact must not exist: ${path}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const workflows = await readdir('.github/workflows');
for (const name of workflows) {
  if (/probe/i.test(name)) throw new Error(`probe workflow is not part of the canonical pipeline: ${name}`);
}

console.log('repository ratchet OK: canonical data/UI entrypoints present; obsolete probes absent');
