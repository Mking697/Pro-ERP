import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Execute the actual dialog with loaded API rows, without React/DOM/DB imports.
// Only its top-level functions are compiled; effects deliberately do not run.
const source = fs.readFileSync(path.join(__dirname, "../src/app/payroll/payroll-admin-console.tsx"), "utf8");
const ast = ts.createSourceFile("console.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements.filter(ts.isFunctionDeclaration).map((node) => node.getText(ast)).join("\n");
const compiled = ts.transpileModule(functions, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function render(payslips, shortfallByUserId = {}) {
  let stateIndex = 0;
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    require(name) {
      assert.equal(name, "react/jsx-runtime");
      return { jsx, jsxs: jsx };
    },
    useT: () => (text) => text,
    useState: () => [ [true, false, payslips][stateIndex++], () => {} ],
    useEffect: () => {},
  };
  for (const name of ["Dialog", "DialogTrigger", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription", "Button", "AlertTriangle", "TableSkeleton", "EmptyState", "FileText", "Table", "TableHeader", "TableRow", "TableHead", "TableBody", "TableCell", "Badge"]) {
    context[name] = name;
  }
  vm.createContext(context);
  vm.runInContext(compiled, context);
  const tree = context.RunPayslipsDialog({ run: { id: "RUN-test", month: "2026-09", status: "Finalized" }, shortfallByUserId });
  const nodes = [];
  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    nodes.push(value);
    walk(value.props?.children);
  }
  walk(tree);
  return {
    warning: nodes.some((node) => node.type === "AlertTriangle"),
    shortfalls: nodes.filter((node) => node.type === "Badge" && node.props.variant === "destructive").map((node) => node.props.children),
  };
}

function payslip(deductionShortfall) {
  return {
    id: "PS-test", userId: "USER-test", userFullName: "Test Employee", daysEmployed: 1,
    daysInMonth: 30, grossPay: 100, pfEmployee: 0, esiEmployee: 0, tds: 0, netPay: 100,
    pdfUrl: "", ...(deductionShortfall === undefined ? {} : { deductionShortfall }),
  };
}

test("reloaded API shortfall renders both warning banner and formatted column without Generate state", () => {
  assert.deepEqual(render([payslip(1800)]), { warning: true, shortfalls: ["Rs. 1,800.00"] });
});

test("persisted zero overrides stale nonzero Generate state", () => {
  assert.deepEqual(render([payslip(0)], { "USER-test": 1800 }), { warning: false, shortfalls: [] });
});

test("persisted positive shortfall overrides a different Generate value", () => {
  assert.deepEqual(render([payslip(25)], { "USER-test": 1800 }), { warning: true, shortfalls: ["Rs. 25.00"] });
});

test("absent durable field retains compatibility with Generate state", () => {
  assert.deepEqual(render([payslip(undefined)], { "USER-test": 75 }), { warning: true, shortfalls: ["Rs. 75.00"] });
});

test("banner ignores map entries with no loaded payslip", () => {
  assert.deepEqual(render([payslip(0)], { "OTHER-user": 1800 }), { warning: false, shortfalls: [] });
  assert.deepEqual(render([], { "USER-test": 1800 }), { warning: false, shortfalls: [] });
});

for (const invalid of [-10, NaN, Infinity, -Infinity, null, "900"]) {
  test(`present invalid durable value ${String(invalid)} never warns or falls back to stale state`, () => {
    assert.deepEqual(render([payslip(invalid)], { "USER-test": 1800 }), { warning: false, shortfalls: [] });
  });
}

for (const invalid of [-10, NaN, Infinity, -Infinity, "900"]) {
  test(`invalid compatibility value ${String(invalid)} never warns`, () => {
    assert.deepEqual(render([payslip(undefined)], { "USER-test": invalid }), { warning: false, shortfalls: [] });
  });
}

test("absent durable and compatibility fields do not warn", () => {
  assert.deepEqual(render([payslip(undefined)]), { warning: false, shortfalls: [] });
});

test("Generate never caches or warns for negative/nonfinite shortfalls", async () => {
  let handler;
  function find(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "handleGenerate") handler = node;
    ts.forEachChild(node, find);
  }
  find(ast);
  assert.ok(handler);
  const code = ts.transpileModule(handler.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const warnings = [];
  let cache;
  const context = {
    month: "2026-09", setGenerating: () => {}, setVersion: () => {},
    setShortfallsByRun: (update) => { cache = update({}); },
    fetch: async () => ({ ok: true, json: async () => ({ run: { id: "RUN-test" }, payslips: [payslip(Infinity), { ...payslip(-10), userId: "NEG-test" }] }) }),
    t: (text) => text,
    toast: { warning: (text) => warnings.push(text), success: () => {}, error: () => {} },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  await context.handleGenerate();
  assert.equal(warnings.length, 0);
  assert.deepEqual(Object.keys(cache["RUN-test"]), []);
});
