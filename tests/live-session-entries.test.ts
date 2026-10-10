import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), verifySession: vi.fn(), liveUser: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth/session", () => ({ SESSION_COOKIE: "erp_session", verifySession: mocks.verifySession }));
vi.mock("@/db/client", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.liveUser }) }) }) },
}));
import { getLiveSession } from "@/lib/auth/live-session";

const app = path.resolve("src/app");
function entries(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? entries(file) : /^(page|layout)\.tsx$/.test(entry.name)
      ? [path.relative(app, file).replaceAll("\\", "/")] : [];
  });
}
const publicEntries = ["layout.tsx", "login/page.tsx", "signup/page.tsx", "share/[token]/page.tsx"];
const protectedEntries = entries(app).filter((entry) => !publicEntries.includes(entry));
const session = {
  orgId: "ORG-sec01", userId: "USR-sec01", email: "user@example.com", fullName: "Test",
  role: "Admin", access: ["INVENTORY_VIEW"], tokenVersion: 3,
};

/** Execute the actual SSR entry body while isolating its imports. Transpilation, not
 * text substitution, preserves control flow; business functions must never run after
 * revoked auth. No component/data import can initialize the real database or dotenv. */
function loadEntry(entry: string) {
  const reads = vi.fn((name: string) => { throw new Error(`DATA_READ:${name}`); });
  const source = readFileSync(path.join(app, entry), "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: entry,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports: { default?: (props: unknown) => Promise<unknown> } = {};
  const requireMock = (id: string) => {
    if (id === "@/lib/auth/live-session") return { getLiveSession };
    if (id === "@/lib/auth/session") return { SESSION_COOKIE: "erp_session", verifySession: mocks.verifySession };
    if (id === "next/headers") return { cookies: mocks.cookies };
    if (id === "next/navigation") return {
      redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
      notFound: () => { throw new Error("NOT_FOUND"); },
    };
    if (id === "@/lib/i18n/server") return { getT: async () => (key: string) => key };
    if (id === "react/jsx-runtime") return { jsx: () => ({}), jsxs: () => ({}), Fragment: "fragment" };
    return new Proxy({ __esModule: true }, {
      get: (target, key) => key === "__esModule" ? target.__esModule : () => reads(`${id}:${String(key)}`),
    });
  };
  vm.runInNewContext(compiled.outputText, { exports, require: requireMock }, { filename: entry });
  return { run: exports.default!, reads };
}
const props = {
  params: Promise.resolve({ sku: "SKU-test", report: "tasks", quotationId: "QT-test", templateId: "FMS-test" }),
  searchParams: Promise.resolve({}), children: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "signed-cookie" }) });
  mocks.verifySession.mockResolvedValue(session);
  mocks.liveUser.mockResolvedValue([{ status: "Active", tokenVersion: 3 }]);
});

describe.each(protectedEntries)("protected SSR %s", (entry) => {
  it.each([
    ["deleted", []],
    ["inactive", [{ status: "Inactive", tokenVersion: 3 }]],
    ["wrong token version", [{ status: "Active", tokenVersion: 4 }]],
  ])("rejects %s before data or rendering", async (_reason, rows) => {
    mocks.liveUser.mockResolvedValue(rows);
    const page = loadEntry(entry);
    await expect(page.run(props)).rejects.toThrow("REDIRECT:/login");
    expect(page.reads).not.toHaveBeenCalled();
    expect(mocks.liveUser).toHaveBeenCalledOnce();
  });
  it("propagates DB failure before data or rendering", async () => {
    mocks.liveUser.mockRejectedValue(new Error("DB unavailable"));
    const page = loadEntry(entry);
    await expect(page.run(props)).rejects.toThrow("DB unavailable");
    expect(page.reads).not.toHaveBeenCalled();
  });
  it.each(["missing cookie", "invalid token"])("rejects %s before data or rendering", async (reason) => {
    if (reason === "missing cookie") mocks.cookies.mockResolvedValue({ get: () => undefined });
    else mocks.verifySession.mockResolvedValue(null);
    const page = loadEntry(entry);
    await expect(page.run(props)).rejects.toThrow("REDIRECT:/login");
    expect(page.reads).not.toHaveBeenCalled();
    expect(mocks.liveUser).not.toHaveBeenCalled();
  });
});

describe("SSR entry coverage inventory", () => {
  it("classifies every current page/layout explicitly", () => {
    const classified = [...protectedEntries, ...publicEntries].sort();
    expect(classified).toEqual(entries(app).sort());
    expect(protectedEntries).toContain("admin/users/page.tsx");
    expect(protectedEntries).toContain("admin/settings/page.tsx");
  });
  it.each(protectedEntries)("%s imports no signature-only authentication", (entry) => {
    const ast = ts.createSourceFile(entry, readFileSync(path.join(app, entry), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const signatureImports = ast.statements.filter((node) => ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "@/lib/auth/session");
    expect(signatureImports.map((node) => node.getText(ast))).toEqual([]);
  });

});
