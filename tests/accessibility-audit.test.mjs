import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function elements(file) {
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attrs = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(source), a.initializer?.getText(source) ?? true]));
      result.push({ tag: node.tagName.getText(source), attrs, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

for (const file of ['src/app/fms/fms-template-form.tsx', 'src/app/orders/order-detail-dialog.tsx', 'src/app/orders/orders-board.tsx']) {
  test(`${file}: inputs and selects have persistent programmatic names`, () => {
    const nodes = elements(file);
    const labels = new Set(nodes.filter(n => n.tag === 'Label' || n.tag === 'label').map(n => n.attrs.htmlFor).filter(Boolean));
    const unnamed = nodes.filter(n => ['Input', 'Textarea', 'SelectTrigger'].includes(n.tag) && !n.attrs['aria-label'] && !n.attrs['aria-labelledby'] && !(n.attrs.id && labels.has(n.attrs.id)));
    assert.deepEqual(unnamed.map(n => `${n.tag}:${n.line}`), []);
  });
}

test('select-all checkboxes expose partial selection', () => {
  for (const file of ['src/app/orders/orders-board.tsx', 'src/app/inventory/inventory-board.tsx']) {
    const all = elements(file).find(n => n.tag === 'Checkbox' && String(n.attrs['aria-label']).includes('Sab select'));
    assert.ok(all.attrs.indeterminate, `${file}: missing mixed state`);
  }
});

test('bulk selection status regions are persistent, outside conditional toolbars', () => {
  for (const [file, count] of [['src/app/orders/orders-board.tsx', 'selectedOrders'], ['src/app/inventory/inventory-board.tsx', 'selectedItems']]) {
    const text = fs.readFileSync(file, 'utf8');
    const region = elements(file).find(n => n.attrs.role === '"status"' && n.attrs.className === '"sr-only"');
    assert.ok(region, `${file}: missing persistent selection status`);
    assert.ok(text.indexOf('role="status"') < text.indexOf(`{${count}.length > 0 && (`));
  }
});

test('notification actions participate in menu keyboard navigation and count changes are announced', () => {
  const nodes = elements('src/components/notification-bell.tsx');
  assert.equal(nodes.filter(n => n.tag === 'button').length, 0);
  assert.ok(nodes.some(n => n.tag === 'DropdownMenuItem'));
  assert.ok(nodes.some(n => n.attrs.role === '"status"' && n.attrs['aria-atomic'] === '"true"'));
});

test('sidebar has a bypass link and a name for the logo-only dashboard link', () => {
  const nodes = elements('src/components/sidebar-shell.tsx');
  assert.ok(nodes.find(n => n.tag === 'a' && n.attrs.href === '"#main-content"'));
  assert.ok(nodes.find(n => n.tag === 'main' && n.attrs.id === '"main-content"'));
  assert.ok(nodes.find(n => n.tag === 'Link' && n.attrs.href === '"/dashboard"').attrs['aria-label']);
});

test('decorative chart SVGs do not introduce aria-hidden keyboard stops', () => {
  const charts = elements('src/components/charts.tsx').filter(n => ['RBarChart', 'PieChart', 'AreaChart'].includes(n.tag));
  assert.equal(charts.length, 3);
  for (const chart of charts) assert.equal(chart.attrs.accessibilityLayer, '{false}', `${chart.tag}:${chart.line}`);
});

test('FMS help returns focus to its invoking control', () => {
  assert.ok(elements('src/components/fms-builder-help.tsx').find(n => n.tag === 'DialogContent').attrs.finalFocus);
});

test('onboarding completion is available without its visual checkmark', () => {
  assert.match(fs.readFileSync('src/app/dashboard/onboarding-checklist.tsx', 'utf8'), /className="sr-only">\{step.done/);
});
