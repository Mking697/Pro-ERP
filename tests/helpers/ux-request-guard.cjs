/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS test infrastructure, not an application module. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

// No component harness is installed. Execute the actual pure guard extracted
// from each owned component, not a second implementation of that guard.
module.exports = function loadGuard(component) {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/app', component), 'utf8');
  const code = source.split('// BEGIN request guard (pure logic, exercised by isolated tests)')[1].split('// END request guard')[0];
  const exports = component.startsWith('chat/') ? 'RequestSequencer' : 'RequestSequencer, parseJsonResponse, ResponseNotOkError';
  return vm.runInNewContext(stripTypeScriptTypes(code) + `\n({${exports}})`, { AbortController, Error });
};
