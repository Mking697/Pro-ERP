/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS test infrastructure, not an application module. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, "../..");
const preferences = { useT: () => (text) => text };

// Transpile complete production modules, never slice function bodies. No DB/network.
function load(relative, overrides = {}, globals = {}) {
  const file = path.resolve(root, relative);
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const testModule = { exports: {} };
  function localRequire(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === "@/components/preferences-provider") return preferences;
    if (name.startsWith("@/components/ui/")) return new Proxy({}, { get: (_, key) => ({ children, ...props }) => React.createElement(key === "Button" ? "button" : "div", props, children) });
    if (name === "@/components/file-upload-field") return { __esModule: true, default: () => null };
    if (name === "sonner") return { toast: { error() {}, success() {} } };
    if (name.startsWith("./") || name.startsWith("@/")) {
      const base = name.startsWith("@/") ? path.resolve(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      const child = [base, base + ".ts", base + ".tsx"].find((candidate) => fs.existsSync(candidate));
      return load(path.relative(root, child), overrides, globals);
    }
    return require(name);
  }
  vm.runInNewContext(compiled, { module: testModule, exports: testModule.exports, require: localRequire, console, URL, AbortController, setTimeout, clearTimeout, ...globals }, { filename: file });
  return testModule.exports;
}

// Deterministic hook unit runner: effects clean up on dependency change/unmount.
function hooks() {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, (next) => { slots[i].value = typeof next === "function" ? next(slots[i].value) : next; }];
    },
    useRef(initial) {
      const i = cursor++;
      return (slots[i] ??= { current: initial });
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn, deps };
      return slots[i].value;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.();
        slots[i] = { deps, cleanup: fn() };
      });
    },
  };
  return {
    react,
    render(fn) { cursor = 0; return fn(); },
    flush() { const pending = effects; effects = []; pending.forEach((fn) => fn()); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const settle = () => new Promise((resolve) => setImmediate(resolve));
const reply = (task) => ({ ok: true, json: async () => ({ job: task, activities: [] }) });

// Runs actual exported hook with controlled fetches, including responses ignoring abort.
test("detail masks the old task and ignores an out-of-order response", async () => {
  const h = hooks(); const calls = [];
  const { useTaskDetail } = load("components/field-service/use-task-detail.ts", { react: h.react }, { fetch: (url, options) => { const pending = deferred(); calls.push({ url, options, ...pending }); return pending.promise; } });
  let value = h.render(() => useTaskDetail("/api/services", "A", "job")); h.flush();
  assert.equal(value.loading, true);
  value = h.render(() => useTaskDetail("/api/services", "B", "job")); h.flush();
  assert.equal(value.task, null); assert.equal(calls[0].options.signal.aborted, true);
  calls[1].resolve(reply({ id: "B" })); await settle();
  calls[0].resolve(reply({ id: "A" })); await settle();
  value = h.render(() => useTaskDetail("/api/services", "B", "job"));
  assert.equal(value.task.id, "B"); assert.equal(value.loading, false); h.unmount();
});

test("detail refresh and closing/reopening the same task do not reuse stale data", async () => {
  const h = hooks(); const calls = [];
  const { useTaskDetail } = load("components/field-service/use-task-detail.ts", { react: h.react }, { fetch: () => { const pending = deferred(); calls.push(pending); return pending.promise; } });
  const render = (id) => h.render(() => useTaskDetail("/api/services", id, "job"));
  render("A"); h.flush(); calls[0].resolve(reply({ id: "A" })); await settle();
  let value = render("A"); assert.equal(value.task.id, "A"); value.refresh();
  value = render("A"); assert.equal(value.task, null); h.flush(); calls[1].resolve(reply({ id: "A", currentCycle: 2 })); await settle();
  assert.equal(render("A").task.currentCycle, 2);
  render(null); h.flush(); value = render("A");
  assert.equal(value.task, null); assert.equal(value.loading, true); h.flush(); h.unmount();
});

test("detail HTTP error is actionable and retry clears it", async () => {
  const h = hooks(); let fail = true;
  const { useTaskDetail } = load("components/field-service/use-task-detail.ts", { react: h.react }, { fetch: async () => fail ? { ok: false, json: async () => ({ error: "Forbidden" }) } : reply({ id: "A" }) });
  const render = () => h.render(() => useTaskDetail("/api/services", "A", "job"));
  render(); h.flush(); await settle(); let value = render();
  assert.equal(value.error, "Forbidden"); assert.equal(value.loading, false);
  fail = false; value.refresh(); value = render(); assert.equal(value.error, ""); h.flush(); await settle();
  assert.equal(render().task.id, "A"); h.unmount();
});

test("GPS retry accepts only the newest device result and ignores callbacks after unmount", () => {
  const h = hooks(); const calls = [];
  const { useDeviceLocation } = load("components/field-service/use-device-location.ts", { react: h.react }, { navigator: { geolocation: { getCurrentPosition: (ok, fail, options) => calls.push({ ok, fail, options }) } } });
  const render = () => h.render(() => useDeviceLocation(false));
  let value = render(); h.flush(); value.locate(); value.locate();
  calls[0].ok({ coords: { latitude: 1, longitude: 2 } });
  assert.equal(render().coords, null);
  calls[1].ok({ coords: { latitude: 3, longitude: 4 } });
  assert.equal(render().coords.lat, 3); assert.equal(calls[1].options.maximumAge, 0);
  value = render(); value.locate(); h.unmount(); calls[2].ok({ coords: { latitude: 9, longitude: 9 } });
  assert.equal(render().coords, null);
});

test("GPS failure permits retry without an editable evidence pin", () => {
  const h = hooks(); const calls = [];
  const { useDeviceLocation } = load("components/field-service/use-device-location.ts", { react: h.react }, { navigator: { geolocation: { getCurrentPosition: (ok, fail) => calls.push({ ok, fail }) } } });
  const render = () => h.render(() => useDeviceLocation(false));
  let value = render(); h.flush(); value.locate(); calls[0].fail();
  value = render(); assert.equal(value.error, true); assert.equal(value.locating, false); value.locate();
  calls[1].ok({ coords: { latitude: 10, longitude: 20 } });
  assert.equal(render().coords.lng, 20); h.unmount();
});

test("map wrapper disables SSR and never evaluates Leaflet on the server", () => {
  let options;
  const component = load("components/location-picker.tsx", { "next/dynamic": (_loader, config) => { options = config; return () => null; } }).default;
  const html = renderToStaticMarkup(React.createElement(component, { value: null, onChange() {} }));
  assert.equal(options.ssr, false); assert.match(html, /aria-label="Location"/);
});

test("evidence URL validation blocks script/protocol-relative URLs", () => {
  const { safeEvidenceUrl } = load("components/field-service/evidence-file.tsx");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "//example.com", "/\\example.com"]) assert.equal(safeEvidenceUrl(bad), null);
  assert.equal(safeEvidenceUrl("/uploads/photo.jpg"), "/uploads/photo.jpg");
  assert.equal(safeEvidenceUrl("https://example.com/bill.pdf"), "https://example.com/bill.pdf");
});

test("completed panel renders photo/video/evidence/chart/bills and zero expense on SSR", () => {
  const component = load("components/field-service/task-step-panel.tsx").default;
  const step = { sitePhotoUrl: "/photo.jpg", siteVideoUrl: "/video.mp4", latitude: 10, longitude: 20, step1At: "2026-10-01T00:00:00Z", evidenceUrl: "/evidence.pdf", notes: "Completed work", chartUrl: "/chart.pdf", step2At: "2026-10-01T01:00:00Z", expenseAmount: 0, expenseNotes: "No expense", billUrls: ["/bill.pdf"], step3At: "2026-10-01T02:00:00Z" };
  const html = renderToStaticMarkup(React.createElement(component, { taskType: "SERVICE", taskId: "A", cycle: 1, isAssignedDoer: false, step, onUpdated() {} }));
  for (const url of ["/photo.jpg", "/video.mp4", "/evidence.pdf", "/chart.pdf", "/bill.pdf"]) assert.ok(html.includes(url), url);
  assert.match(html, /₹0/); assert.match(html, /Completed work/); assert.ok(!html.includes("Step 1 Complete Karein"));
});

test("assignment summary shows funds and only offers unassign for active tasks", () => {
  const component = load("components/field-service/task-assignments.tsx", { "./assign-doers-dialog": { __esModule: true, default: ({ reopening }) => React.createElement("span", null, reopening ? "Reopen" : "Assign") } }).default;
  const props = { taskType: "SERVICE", taskId: "A", cycle: 1, completed: false, assignments: [{ doerId: "D", doerName: "Doer Name", fundAmount: 250, fundNotes: "Travel" }], canWork: true, onUpdated() {} };
  const active = renderToStaticMarkup(React.createElement(component, props));
  assert.match(active, /250 Travel/); assert.match(active, /Unassign Doer/);
  const completed = renderToStaticMarkup(React.createElement(component, { ...props, completed: true }));
  assert.ok(!completed.includes("Unassign Doer")); assert.match(completed, /Reopen/);
});
function findElement(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const found = findElement(child, predicate); if (found) return found;
  }
  return null;
}

test("step submissions explicitly send the displayed task cycle", async () => {
  const h = hooks(); const requests = [];
  const component = load("components/field-service/task-step-panel.tsx", {
    react: h.react,
    "./use-device-location": { useDeviceLocation: () => ({ coords: { lat: 1, lng: 2 }, locating: false, error: false, locate() {} }) },
  }, { fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ step: { step1At: "done" } }) }; } }).default;
  const props = { taskType: "SERVICE", taskId: "A", cycle: 7, isAssignedDoer: true, step: null, onUpdated() {} };
  const render = () => h.render(() => component(props));
  let tree = render(); h.flush();
  const upload = findElement(tree, (node) => node.props?.label === "Site Photo");
  upload.props.onChange("/uploads/site.jpg"); tree = render();
  const button = findElement(tree, (node) => React.Children.toArray(node.props?.children).includes("Step 1 Complete Karein"));
  assert.equal(button.props.disabled, false); await button.props.onClick();
  assert.equal(requests[0].cycle, 7); assert.equal(requests[0].taskId, "A"); assert.equal(requests[0].latitude, 1); h.unmount();
});

test("Site Visit Step 2 submits notes without an optional chart", async () => {
  const h = hooks(); const requests = []; const updates = [];
  const component = load("components/field-service/task-step-panel.tsx", {
    react: h.react,
    "./use-device-location": { useDeviceLocation: () => ({ coords: null, locating: false, error: false, locate() {} }) },
  }, { fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ step: { step1At: "done", step2At: "done" } }) }; } }).default;
  const props = { taskType: "SITE_VISIT", taskId: "V", cycle: 7, isAssignedDoer: true, step: { step1At: "done" }, onUpdated: (step) => updates.push(step) };
  const render = () => h.render(() => component(props));
  const button = (tree) => findElement(tree, (node) => React.Children.toArray(node.props?.children).includes("Step 2 Complete Karein"));
  let tree = render(); h.flush();
  assert.equal(button(tree).props.disabled, true);
  const notes = findElement(tree, (node) => typeof node.props?.onChange === "function" && node.props?.value === "" && !node.props?.label);
  notes.props.onChange({ target: { value: "   " } }); tree = render();
  assert.equal(button(tree).props.disabled, true);
  notes.props.onChange({ target: { value: "Measured the installation site" } }); tree = render();
  assert.equal(button(tree).props.disabled, false);
  await button(tree).props.onClick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].taskType, "SITE_VISIT"); assert.equal(requests[0].taskId, "V");
  assert.equal(requests[0].cycle, 7); assert.equal(requests[0].step, 2);
  assert.equal(requests[0].notes, "Measured the installation site"); assert.equal(requests[0].chartUrl, "");
  assert.equal(updates.length, 1); assert.equal(updates[0].step2At, "done"); h.unmount();
});

test("map recenters when controlled coordinates change", () => {
  const h = hooks(); const views = []; let clicks;
  const map = { setView: (point, zoom) => views.push({ point, zoom }), invalidateSize() {} };
  const leaflet = { Icon: class {} };
  const component = load("components/field-service/location-map.tsx", {
    react: h.react,
    leaflet,
    "react-leaflet": { MapContainer: () => null, TileLayer: () => null, Marker: () => null, useMap: () => map, useMapEvents: (events) => { clicks = events; } },
    "leaflet/dist/images/marker-icon.png": { src: "/marker.png" },
    "leaflet/dist/images/marker-icon-2x.png": { src: "/marker-2x.png" },
    "leaflet/dist/images/marker-shadow.png": { src: "/shadow.png" },
    "leaflet/dist/leaflet.css": {},
    "./use-device-location": { useDeviceLocation: () => ({ coords: null, locating: false, error: false, locate() {} }) },
  }).default;
  const selected = [];
  function render(value) {
    const tree = component({ value, onChange: (coords) => selected.push(coords), autoLocate: false });
    const controls = findElement(tree, (node) => node.type?.name === "MapControls");
    h.render(() => controls.type(controls.props)); h.flush();
  }
  render({ lat: 1, lng: 2 }); render({ lat: 3, lng: 4 });
  assert.equal(views[1].point[0], 3); assert.equal(views[1].point[1], 4); assert.equal(views[1].zoom, 16);
  clicks.click({ latlng: { lat: 5, lng: 6 } }); assert.equal(selected[0].lat, 5); h.unmount();
});

test("all boards expose keyboard buttons and all detail panels reset by task/cycle", () => {
  for (const [folder, board, detail, variable] of [["services", "services-board.tsx", "service-detail-dialog.tsx", "job"], ["complaints", "complaints-board.tsx", "complaint-detail-dialog.tsx", "complaint"], ["site-visits", "site-visits-board.tsx", "site-visit-detail-dialog.tsx", "visit"]]) {
    const boardSource = fs.readFileSync(path.join(root, "app", folder, board), "utf8");
    assert.match(boardSource, /<Button[^>]*aria-label=\{`\$\{t\("View details"\)/);
    const detailSource = fs.readFileSync(path.join(root, "app", folder, detail), "utf8");
    assert.ok(detailSource.includes("key={`${" + variable + ".id}:${" + variable + ".currentCycle}`}"));
    assert.ok(detailSource.includes("cycle={" + variable + ".currentCycle}"));
  }
});

test("completed history uses authorized server rows and never allows historical edits", () => {
  const component = load("components/field-service/task-history.tsx", {
    "./task-step-panel": { __esModule: true, default: ({ isAssignedDoer, step }) => React.createElement("span", null, String(isAssignedDoer) + step.evidenceUrl) },
    "./task-assignments": { __esModule: true, default: ({ canWork, assignments }) => React.createElement("span", null, String(canWork) + assignments[0].fundAmount) },
  }).default;
  const props = { taskType: "SERVICE", taskId: "A", currentCycle: 2, history: [{ cycle: 1, step: { step3At: "done", evidenceUrl: "/previous.pdf" }, assignments: [{ doerId: "D", doerName: "Doer", fundAmount: 150, fundNotes: "Advance" }] }] };
  const html = renderToStaticMarkup(React.createElement(component, props));
  assert.match(html, /Completed History/); assert.match(html, /<summary/); assert.match(html, /false150/); assert.match(html, /false\/previous.pdf/);
  const unavailable = renderToStaticMarkup(React.createElement(component, { ...props, history: null }));
  assert.match(unavailable, /Previous cycle evidence is not available/);
});
