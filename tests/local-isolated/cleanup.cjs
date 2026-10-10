/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS infrastructure, not application modules. */
// Dry-run unless explicitly authorized. Stop the exact bridge process first.
const { execFileSync } = require('node:child_process');
const { loadCredentials, label } = require('./runtime.cjs');
const { names } = loadCredentials();
const expected = { pg: 'pro-erp-regression-pg', ws: 'pro-erp-regression-ws', internal: 'pro-erp-local-tests-20261009-internal', ingress: 'pro-erp-local-tests-20261009-ingress' };
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
for (const [kind, name] of Object.entries(names)) {
  if (name !== expected[kind]) throw new Error('Unexpected cleanup handle');
}
if (Object.keys(names).length !== Object.keys(expected).length) throw new Error('Incomplete cleanup handles');
for (const [kind, name] of Object.entries(expected)) {
  const type = ['internal', 'ingress'].includes(kind) ? 'network' : 'container';
  if (type === 'network' && docker(type, 'inspect', name, '--format', '{{index .Labels "task"}}') !== label) throw new Error('Cleanup network label mismatch');
  if (type === 'container' && docker(type, 'inspect', name, '--format', '{{index .Config.Labels "task"}}') !== label) throw new Error('Cleanup container label mismatch');
}
if (process.env.PRO_ERP_LOCAL_STOP !== '1') console.log('DRY RUN: verified exact task labels; would remove ' + Object.values(expected).join(', '));
else {
  docker('rm', '-f', expected.ws, expected.pg);
  docker('network', 'rm', expected.internal, expected.ingress);
  console.log('Removed only verified task-owned disposable Docker resources; scratch credentials retained for explicit owner cleanup');
}
