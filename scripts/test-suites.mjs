import { spawnSync } from 'node:child_process';

// Fixed repository-owned entry points. Changed paths never become executable input.
export const suites = Object.freeze({
  unit: 'scripts/tests/unit.mjs',
  'state-machine': 'scripts/tests/state-machine.mjs',
  integration: 'scripts/tests/integration.mjs',
  ui: 'scripts/tests/ui.mjs',
  installer: 'scripts/tests/installer.mjs',
  sandbox: 'scripts/tests/sandbox.mjs',
  policy: 'scripts/tests/policy.mjs',
  plan: 'scripts/tests/plan.mjs',
  approvals: 'scripts/tests/approvals.mjs',
  'approval-storage': 'scripts/tests/approval-storage.mjs',
  proof: 'scripts/tests/proof.mjs',
  fuzz: 'scripts/tests/fuzz.mjs',
  learn: 'scripts/tests/learn.mjs',
  'learn-materials': 'scripts/tests/learn-materials.mjs',
  'learn-workshop': 'scripts/tests/learn-workshop.mjs',
  'learn-storage': 'scripts/tests/learn-storage.mjs',
  'learn-vault': 'scripts/tests/learn-vault.mjs',
  'learn-end-to-end': 'scripts/tests/learn-end-to-end.mjs',
});

export function changedPaths(root) {
  const git = args => {
    const result = spawnSync('git', ['--no-optional-locks', '--no-lazy-fetch', '-c', 'core.fsmonitor=false', ...args],
      {cwd:root,encoding:'utf8',windowsHide:true,timeout:10000});
    if (result.status !== 0) throw new Error('Cannot determine changed files; run full verification.');
    return result.stdout.split('\0').filter(Boolean);
  };
  return [...new Set([...git(['diff','--no-renames','--no-ext-diff','--no-textconv','--name-only','-z','HEAD']),
    ...git(['ls-files','--others','--exclude-standard','-z'])])];
}

export function selectSuites(files) {
  const selected = new Set();
  for (const name of files) {
    if (/^(docs\/|README\.md$|CONTRIBUTING\.md$|CHANGELOG\.md$)/.test(name)) continue;
    if (name === 'agent/extensions/check-gate.ts' || name === 'agent/neura/verification.ts') {
      selected.add('proof'); selected.add('integration'); selected.add('learn');
    } else if (/approval-store\.ts$/.test(name)) {
      selected.add('approvals'); selected.add('approval-storage');
    } else if (/plan-renderer\.ts$/.test(name)) {
      selected.add('plan'); selected.add('ui');
    } else if (name === 'install.ps1') selected.add('installer');
    else if (/^scripts\/tests\/[^/]+\.mjs$/.test(name) && Object.values(suites).includes(name)) {
      selected.add(Object.keys(suites).find(key => suites[key] === name));
    } else return Object.keys(suites);
  }
  return [...selected].sort();
}
