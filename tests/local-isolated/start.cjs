/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS infrastructure, not application modules. */
// Creates only fresh labelled disposable resources using cached images. No dotenv.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { validateEnvironment } = require('./safety.cjs');
const { root, label } = require('./runtime.cjs');
const file = path.resolve(validateEnvironment());
if (file.startsWith(root + path.sep)) throw new Error('Credential file must be outside repository');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const names = { pg: 'pro-erp-regression-pg', ws: 'pro-erp-regression-ws', internal: 'pro-erp-local-tests-20261009-internal', ingress: 'pro-erp-local-tests-20261009-ingress' };
for (const image of ['postgres:17-alpine', 'ghcr.io/neondatabase/wsproxy:latest']) docker('image', 'inspect', image, '--format', '{{.Id}}');
for (const [kind, name] of Object.entries(names)) {
  const command = ['internal', 'ingress'].includes(kind) ? 'network' : 'container';
  let exists = false;
  try { docker(command, 'inspect', name, '--format', '{{.Id}}'); exists = true; } catch { /* expected absent */ }
  if (exists) throw new Error('Refusing to overwrite existing resource: ' + name);
}
const password = randomBytes(32).toString('hex');
const data = { label, connectionString: `postgresql://pro_erp_test:${password}@pro-erp-regression-pg:5432/pro_erp_test?sslmode=disable`, names };
fs.writeFileSync(file, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
const protect = target => {
  if (process.platform === 'win32') execFileSync('icacls', [target, '/inheritance:r', '/grant:r', `${os.userInfo().username}:(F)`], { stdio: 'pipe' });
  else fs.chmodSync(target, 0o600);
};
protect(file);
const envFile = file + '.docker-env';
fs.writeFileSync(envFile, `POSTGRES_USER=pro_erp_test\nPOSTGRES_DB=pro_erp_test\nPOSTGRES_PASSWORD=${password}\n`, { flag: 'wx', mode: 0o600 });
try {
  protect(envFile);
  docker('network', 'create', '--internal', '--label', `task=${label}`, names.internal);
  docker('network', 'create', '--label', `task=${label}`, names.ingress);
  docker('run', '-d', '--pull=never', '--name', names.pg, '--label', `task=${label}`, '--network', names.internal, '--env-file', envFile, '--tmpfs', '/var/lib/postgresql/data', 'postgres:17-alpine');
  docker('run', '-d', '--pull=never', '--name', names.ws, '--label', `task=${label}`, '--network', names.ingress, '-p', '127.0.0.1:55007:80', '-e', 'ALLOW_ADDR_REGEX=^pro-erp-regression-pg:5432$', '-e', 'LISTEN_PORT=:80', 'ghcr.io/neondatabase/wsproxy:latest');
  docker('network', 'connect', names.internal, names.ws);
  console.log(JSON.stringify({ label, ...names, credentialsFile: file, wsBinding: docker('port', names.ws, '80/tcp'), postgresPorts: docker('port', names.pg) }));
} finally { fs.unlinkSync(envFile); }
