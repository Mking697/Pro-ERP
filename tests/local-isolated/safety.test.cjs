/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS infrastructure, not application modules. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvironment, validateConnection } = require('./safety.cjs');
test('local infrastructure refuses missing explicit opt-in', () => {
  assert.throws(() => validateEnvironment({}), /PRO_ERP_LOCAL_TESTS/);
});
const local = 'postgresql://pro_erp_test:fresh@pro-erp-regression-pg:5432/pro_erp_test?sslmode=disable';
test('connection guard rejects cloud, alternate databases, users, options and credentials', () => {
  assert.equal(validateConnection(local, local).hostname, 'pro-erp-regression-pg');
  assert.equal(validateConnection(local + '&application_name=pkg%3Anpm%2F%2540neondatabase%2Fserverless%401.2.0', local).hostname, 'pro-erp-regression-pg');
  for (const bad of [local.replace('pro-erp-regression-pg', 'example.com'), local.replace('/pro_erp_test?', '/production?'), local.replace('fresh', 'wrong'), local + '&options=unsafe', local.replace('sslmode=disable', 'sslmode=require')]) {
    assert.throws(() => validateConnection(bad, local), /disposable/);
  }
});
test('passwordless public test URL is accepted only against its explicit expected target', () => {
  const publicURL = local.replace(':fresh', '');
  assert.equal(validateConnection(publicURL, publicURL).password, '');
  assert.throws(() => validateConnection(publicURL), /disposable/);
  assert.throws(() => validateConnection(publicURL, local), /disposable/);
});
test('explicit opt-in still requires a credential file', () => {
  assert.throws(() => validateEnvironment({ PRO_ERP_LOCAL_TESTS: '1' }), /PRO_ERP_LOCAL_CREDENTIALS/);
});
