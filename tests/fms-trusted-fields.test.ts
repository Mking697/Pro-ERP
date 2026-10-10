import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findById: vi.fn(), updateById: vi.fn(), insertRecord: vi.fn(),
  getStep: vi.fn(), listTemplates: vi.fn(), resolveExisting: vi.fn(),
  ledgerAction: vi.fn(), select: vi.fn(), workingInstant: vi.fn(), tatDeadline: vi.fn(),
  resolveActiveAssigneeWithAudit: vi.fn(),
}));
vi.mock("@/db/schema", () => ({ fmsRuns: {}, leaveReassignments: {} }));
vi.mock("@/db/client", () => ({
  db: { select: mocks.select },
  runInTenantTransaction: async (_orgId: string, work: () => Promise<unknown>) => work(),
  afterTenantCommit: async (effect: () => void | Promise<void>) => { await effect(); },
}));
vi.mock("@/lib/mutations", () => ({
  runIdempotentTenantMutation: async (_orgId: string, _meta: unknown, work: () => Promise<unknown>) => work(),
}));
vi.mock("@/lib/leave/reassignment", () => ({
  resolveActiveAssigneeWithAudit: mocks.resolveActiveAssigneeWithAudit,
}));
vi.mock("@/db/repo", () => ({
  findById: mocks.findById, updateById: mocks.updateById,
  insertRecord: mocks.insertRecord, listByOrg: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: vi.fn(async () => "org-1") }));
vi.mock("@/lib/fms/templates", () => ({
  getFmsTemplateStep: mocks.getStep, listFmsTemplates: mocks.listTemplates,
  parseOutcomeOptions: (raw: string) => raw.split(","),
  parseNextStepMap: (raw: string) => JSON.parse(raw || "{}"),
}));
vi.mock("@/lib/fms/calendar", () => ({
  computeNextWorkingInstant: mocks.workingInstant, computeTatDeadline: mocks.tatDeadline, computeUserDayEnd: vi.fn(),
}));
vi.mock("@/lib/fms/dataSourceResolver", () => ({ resolveExistingFmsData: mocks.resolveExisting }));
vi.mock("@/lib/fms/actionRunner", () => ({ runLedgerMovementAction: mocks.ledgerAction }));
vi.mock("@/lib/auth/users", () => ({ getUserById: vi.fn() }));
vi.mock("@/lib/chatxflow", () => ({ sendWhatsAppMessage: vi.fn() }));

import { completeFmsStep } from "@/lib/fms/engine";
import type { StepDataSourceConfig } from "@/lib/fms/dataSource";
import { PASS_QTY_KEY, FAIL_QTY_KEY, SCRAP_QTY_KEY } from "@/lib/fms/outcomeType";

const run = {
  id: "run-1", instanceId: "instance-1", templateId: "template-1", templateName: "Production",
  contextRef: "PRODUCTION_PLANS:plan-1", startedBy: "user-1", startedAt: null,
  stepNo: 1, stepName: "Complete", assignedTo: "user-1", createdAt: new Date("2026-01-01"),
  tatStart: null, tatDeadline: null, completedAt: null, completedBy: "", outcome: "",
  status: "Pending", remark: "", formData: null, quantity: "10",
};
const references = { Product_SKU: "TRUSTED-SKU", Actual_Qty: "10", UOM: "pcs" };
let step: Record<string, unknown>;
function configure(config: StepDataSourceConfig) {
  step.Data_Source_Config = JSON.stringify(config);
}
const existing = {
  sourceModule: "PRODUCTION_PLANS", columns: Object.keys(references), filterByContext: true,
};
async function complete(formData: Record<string, string> = {}, outcome = "Done") {
  return completeFmsStep({ runId: "run-1", completedBy: "user-1", outcome, formData });
}
function expectNoWrites() {
  expect(mocks.ledgerAction).not.toHaveBeenCalled();
  expect(mocks.updateById).not.toHaveBeenCalled();
  expect(mocks.insertRecord).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  step = {
    Template_ID: "template-1", Step_No: "1", Outcome_Type: "DONE", Outcome_Options: "Done",
    Data_Source_Config: JSON.stringify({ existing }), Action_Type: "LEDGER_MOVEMENT",
    Action_Config: JSON.stringify({ Done: { direction: "In", skuField: "Product_SKU", qtyField: "Actual_Qty", uomField: "UOM" } }),
    Next_Step_Map: "{}", Notify_On_Complete: [],
  };
  mocks.findById.mockResolvedValue({ ...run });
  mocks.getStep.mockImplementation(async () => step);
  mocks.resolveExisting.mockResolvedValue([{ ...references }]);
  mocks.listTemplates.mockResolvedValue([]);
  mocks.updateById.mockImplementation(async (_table, _org, _id, values) => ({ ...run, ...values }));
  mocks.insertRecord.mockImplementation(async (_table, values) => values);
  mocks.select.mockReturnValue({ from: () => ({ where: async () => [] }) });
  mocks.workingInstant.mockResolvedValue(new Date("2026-01-01").getTime());
  mocks.tatDeadline.mockResolvedValue(new Date("2026-01-02").getTime());
  mocks.resolveActiveAssigneeWithAudit.mockImplementation(async (_orgId: string, userId: string) => ({ assignedTo: userId, leaveId: "" }));
});

describe("FMS trusted completion fields", () => {
  it("passes fresh server references to the action without requiring the client to echo them", async () => {
    await complete();
    expect(mocks.resolveExisting).toHaveBeenCalledWith(existing, run.contextRef, run.instanceId);
    expect(mocks.ledgerAction).toHaveBeenCalledWith(expect.anything(), "Done", references, "run-1", "user-1");
    expect(mocks.updateById).toHaveBeenCalledWith(expect.anything(), "org-1", "run-1", expect.objectContaining({ formData: {} }));
  });

  it("accepts equal declared echoes without changing the trusted action values", async () => {
    configure({ existing, form: { fields: [{ key: "Product_SKU", label: "SKU", type: "text", required: true }] } });
    await complete({ Product_SKU: references.Product_SKU });
    expect(mocks.ledgerAction).toHaveBeenCalledWith(expect.anything(), "Done", references, "run-1", "user-1");
  });

  it.each([{ rows: [] }, { rows: [{}] }, { rows: [{ Product_SKU: "" }] }])("does not let a declared field supply a missing or blank trusted SKU (%j)", async ({ rows }) => {
    configure({ existing, form: { fields: [{ key: "Product_SKU", label: "SKU", type: "text", required: false }] } });
    mocks.resolveExisting.mockResolvedValue(rows);
    await expect(complete({ Product_SKU: "FORGED-SKU" })).rejects.toThrow(/field/i);
    expectNoWrites();
  });

  it("accepts manual SKU and quantity names when no existing source claims them", async () => {
    configure({ form: { fields: [
      { key: "Product_SKU", label: "SKU", type: "text", required: true },
      { key: "Actual_Qty", label: "Qty", type: "number", required: true },
    ] } });
    const values = { Product_SKU: "MANUAL-SKU", Actual_Qty: "3" };
    const result = await complete(values);
    expect(mocks.resolveExisting).not.toHaveBeenCalled();
    expect(mocks.ledgerAction).toHaveBeenCalledWith(expect.anything(), "Done", values, "run-1", "user-1");
    expect(JSON.parse(result.completed.Form_Data)).toEqual(values);
  });

  it("accepts lookup selection, its hidden id, and editable declared autofill siblings", async () => {
    configure({ existing, form: { fields: [
      { key: "customer", label: "Customer", type: "lookup", required: true,
        lookup: { sourceModule: "CUSTOMERS", displayField: "Customer_Name", autofillMap: { address: "Address" } } },
      { key: "address", label: "Address", type: "text", required: true },
    ] } });
    const values = { customer: "Selected customer", customer__id: "customer-1", address: "Edited after autofill" };
    const result = await complete(values);
    expect(mocks.ledgerAction).toHaveBeenCalledWith(expect.anything(), "Done", { ...references, ...values }, "run-1", "user-1");
    expect(JSON.parse(result.completed.Form_Data)).toEqual(values);
  });

  it.each(["address", "customer__id", "notes__id"])("rejects undeclared autofill targets and non-lookup hidden ids (%s)", async (key) => {
    configure({ existing, form: { fields: [
      { key: "customer", label: "Customer", type: "text", required: false },
      { key: "notes", label: "Notes", type: "text", required: false },
    ] } });
    await expect(complete({ [key]: "forged" })).rejects.toThrow(/field/i);
    expectNoWrites();
  });

  it("rejects lookup autofill maps targeting an undeclared source key", async () => {
    configure({ existing, form: { fields: [
      { key: "customer", label: "Customer", type: "lookup", required: false,
        lookup: { sourceModule: "CUSTOMERS", displayField: "Customer_Name", autofillMap: { Product_SKU: "SKU" } } },
    ] } });
    await expect(complete({ customer: "Name", customer__id: "id-1", Product_SKU: "FORGED-SKU" })).rejects.toThrow(/field/i);
    expectNoWrites();
  });

  it("rejects declared lookup autofill fields colliding with a trusted source SKU", async () => {
    configure({ existing, form: { fields: [
      { key: "item", label: "Item", type: "lookup", required: false,
        lookup: { sourceModule: "ITEMS", displayField: "Item_Name", autofillMap: { Product_SKU: "SKU" } } },
      { key: "Product_SKU", label: "SKU", type: "text", required: false },
    ] } });
    await expect(complete({ item: "Other item", item__id: "item-2", Product_SKU: "FORGED-SKU" })).rejects.toThrow(/overwrite/);
    expectNoWrites();
  });

  it("protects a selected THIS_FLOW hidden lookup id from a new lookup selection", async () => {
    configure({ existing: { sourceModule: "THIS_FLOW", sourceStepNo: 1, columns: ["customer__id"], filterByContext: true }, form: { fields: [
      { key: "customer", label: "Customer", type: "lookup", required: false,
        lookup: { sourceModule: "CUSTOMERS", displayField: "Customer_Name", autofillMap: {} } },
    ] } });
    mocks.resolveExisting.mockResolvedValue([{ customer__id: "trusted-customer" }]);
    await expect(complete({ customer: "Different customer", customer__id: "forged-customer" })).rejects.toThrow(/overwrite/);
    expectNoWrites();
  });

  it("rejects unknown fields even in an otherwise valid quantity split", async () => {
    step.Outcome_Type = "PASS_FAIL_QTY";
    step.Outcome_Options = "Pass,Fail";
    await expect(complete({ [PASS_QTY_KEY]: "10", [FAIL_QTY_KEY]: "0", unknown: "forged" }, "Pass")).rejects.toThrow(/field/i);
    expectNoWrites();
  });

  it("keeps required form fields mandatory even if references have a value", async () => {
    configure({ existing, form: { fields: [{ key: "Product_SKU", label: "SKU", type: "text", required: true }] } });
    await expect(complete()).rejects.toThrow(/fields zaroori/);
    expectNoWrites();
  });

  it("accepts an empty completion on a step without data sources", async () => {
    configure({});
    step.Action_Type = "";
    await complete();
    expect(mocks.updateById).toHaveBeenCalledOnce();
    expect(mocks.ledgerAction).not.toHaveBeenCalled();
  });

  it.each([PASS_QTY_KEY, FAIL_QTY_KEY, SCRAP_QTY_KEY])("rejects undeclared runtime key %s outside PASS_FAIL_QTY", async (key) => {
    await expect(complete({ [key]: "10" })).rejects.toThrow(/field/i);
    expectNoWrites();
  });

  it("keeps declared quantity-like names editable on ordinary manual forms", async () => {
    configure({ existing, form: { fields: [{ key: PASS_QTY_KEY, label: "Pass Qty", type: "number", required: false }] } });
    await complete({ [PASS_QTY_KEY]: "5" });
    expect(mocks.ledgerAction).toHaveBeenCalledWith(expect.anything(), "Done", { ...references, [PASS_QTY_KEY]: "5" }, "run-1", "user-1");
  });

  it("uses this run's PASS_FAIL_QTY quantities over previous THIS_FLOW values and carries split quantities forward", async () => {
    step.Outcome_Type = "PASS_FAIL_QTY";
    step.Outcome_Options = "Pass,Fail";
    step.Action_Config = JSON.stringify({ Pass: { direction: "In", skuField: "Product_SKU", qtyField: PASS_QTY_KEY } });
    step.Next_Step_Map = JSON.stringify({ Pass: 2 });
    step.TAT_Value = "1";
    step.TAT_Unit = "HOURS";
    configure({ existing: { sourceModule: "THIS_FLOW", sourceStepNo: 1, columns: ["Product_SKU", PASS_QTY_KEY, FAIL_QTY_KEY, SCRAP_QTY_KEY], filterByContext: true } });
    mocks.resolveExisting.mockResolvedValue([{ Product_SKU: "TRUSTED-SKU", [PASS_QTY_KEY]: "20", [FAIL_QTY_KEY]: "0", [SCRAP_QTY_KEY]: "0" }]);
    mocks.getStep.mockImplementation(async (_id, stepNo) => ({ ...step, Step_No: String(stepNo) }));
    const values = { [PASS_QTY_KEY]: "6", [FAIL_QTY_KEY]: "3", [SCRAP_QTY_KEY]: "1" };
    const result = await complete(values, "Pass");
    expect(result.completed.Outcome).toBe("Fail");
    expect(mocks.ledgerAction).toHaveBeenCalledWith(expect.anything(), "Pass", { Product_SKU: "TRUSTED-SKU", ...values }, "run-1", "user-1");
    expect(result.next.map((next) => [next.Step_No, next.Quantity])).toEqual([["2", "6"], ["1", "3"]]);
    expect(mocks.insertRecord).toHaveBeenCalledTimes(2);
  });

  it.each([
    { [PASS_QTY_KEY]: "9", [FAIL_QTY_KEY]: "0", [SCRAP_QTY_KEY]: "0" },
    { [PASS_QTY_KEY]: "11", [FAIL_QTY_KEY]: "0", [SCRAP_QTY_KEY]: "0" },
    { [PASS_QTY_KEY]: "10", [FAIL_QTY_KEY]: "-1", [SCRAP_QTY_KEY]: "1" },
    { [PASS_QTY_KEY]: "Infinity", [FAIL_QTY_KEY]: "0", [SCRAP_QTY_KEY]: "0" },
    { [PASS_QTY_KEY]: "NaN", [FAIL_QTY_KEY]: "0", [SCRAP_QTY_KEY]: "0" },
  ])("keeps runtime numeric and conservation checks before writes (%j)", async (values) => {
    step.Outcome_Type = "PASS_FAIL_QTY";
    step.Outcome_Options = "Pass,Fail";
    await expect(complete(values, "Pass")).rejects.toThrow(/Qty/);
    expectNoWrites();
  });

  it("keeps omitted Scrap Qty optional for a valid all-pass completion", async () => {
    step.Outcome_Type = "PASS_FAIL_QTY";
    step.Outcome_Options = "Pass,Fail";
    const result = await complete({ [PASS_QTY_KEY]: "10", [FAIL_QTY_KEY]: "0" }, "Fail");
    expect(result.completed.Outcome).toBe("Pass");
    expect(result.next).toEqual([]);
  });

  it("uses only configured THIS_FLOW columns as trusted action inputs, leaving unrelated manual fields editable", async () => {
    configure({
      existing: { sourceModule: "THIS_FLOW", sourceStepNo: 1, columns: ["Product_SKU", "Actual_Qty"], filterByContext: true },
      form: { fields: [{ key: "notes", label: "Notes", type: "text", required: false }] },
    });
    // THIS_FLOW returns the entire earlier run, unlike projected module sources.
    mocks.resolveExisting.mockResolvedValue([{ ...references, notes: "Earlier notes", secret: "unselected" }]);
    await complete({ notes: "Current manual notes" });
    expect(mocks.ledgerAction).toHaveBeenCalledWith(
      expect.anything(), "Done",
      { Product_SKU: "TRUSTED-SKU", Actual_Qty: "10", notes: "Current manual notes" },
      "run-1", "user-1"
    );
  });

  it.each([
    ["Product_SKU", "FORGED-SKU"],
    ["Actual_Qty", "999999"],
  ])("rejects declared field %s overwriting a configured trusted source before any write", async (key, value) => {
    configure({ existing, form: { fields: [{ key, label: key, type: "text", required: false }] } });
    await expect(complete({ [key]: value })).rejects.toThrow(/field/i);
    expectNoWrites();
  });
  it.each([
    ["Product_SKU", "FORGED-SKU"],
    ["Actual_Qty", "999999"],
    ["unknown-field", "forged"],
  ])("rejects undeclared field %s before any write", async (key, value) => {
    await expect(complete({ [key]: value })).rejects.toThrow(/field/i);
    expectNoWrites();
  });
});

describe("FMS active-holder redirect at run-creation time (OPS-01 v2)", () => {
  it("assigns a new successor run (and its TAT) to the buddy when the configured doer is mid-leave, with an atomic audit row", async () => {
    step.Outcome_Type = "PASS_FAIL_QTY";
    step.Outcome_Options = "Pass,Fail";
    step.Action_Config = JSON.stringify({ Pass: { direction: "In", skuField: "Product_SKU", qtyField: PASS_QTY_KEY } });
    step.Next_Step_Map = JSON.stringify({ Pass: 2 });
    configure({ existing: { sourceModule: "THIS_FLOW", sourceStepNo: 1, columns: ["Product_SKU", PASS_QTY_KEY, FAIL_QTY_KEY, SCRAP_QTY_KEY], filterByContext: true } });
    mocks.resolveExisting.mockResolvedValue([{ Product_SKU: "TRUSTED-SKU", [PASS_QTY_KEY]: "10", [FAIL_QTY_KEY]: "0", [SCRAP_QTY_KEY]: "0" }]);
    // Successor step 2 is naturally assigned to "absent-doer", who is currently mid-leave —
    // resolveActiveAssigneeWithAudit redirects to "buddy-1" with a real leaveId.
    mocks.getStep.mockImplementation(async (_id, stepNo) =>
      stepNo === 2 ? { ...step, Step_No: "2", Assigned_To: "absent-doer" } : step
    );
    mocks.resolveActiveAssigneeWithAudit.mockImplementation(async (_orgId: string, userId: string) =>
      userId === "absent-doer" ? { assignedTo: "buddy-1", leaveId: "LVE-1" } : { assignedTo: userId, leaveId: "" }
    );

    const result = await complete({ [PASS_QTY_KEY]: "10", [FAIL_QTY_KEY]: "0" }, "Pass");

    // The successor run itself lands on the buddy, not the absent configured doer.
    expect(result.next).toHaveLength(1);
    expect(mocks.insertRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stepNo: 2, assignedTo: "buddy-1" })
    );
    // A leave_reassignments audit row is written atomically alongside the run itself,
    // naming the original (absent) assignee and the buddy who actually got it.
    expect(mocks.insertRecord).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        entityType: "FMS_RUN",
        leaveId: "LVE-1",
        originalAssignee: "absent-doer",
        buddyId: "buddy-1",
      })
    );
  });

  it("leaves a successor run on its configured doer when nobody is on leave", async () => {
    step.Outcome_Type = "PASS_FAIL_QTY";
    step.Outcome_Options = "Pass,Fail";
    step.Action_Config = JSON.stringify({ Pass: { direction: "In", skuField: "Product_SKU", qtyField: PASS_QTY_KEY } });
    step.Next_Step_Map = JSON.stringify({ Pass: 2 });
    configure({ existing: { sourceModule: "THIS_FLOW", sourceStepNo: 1, columns: ["Product_SKU", PASS_QTY_KEY, FAIL_QTY_KEY, SCRAP_QTY_KEY], filterByContext: true } });
    mocks.resolveExisting.mockResolvedValue([{ Product_SKU: "TRUSTED-SKU", [PASS_QTY_KEY]: "10", [FAIL_QTY_KEY]: "0", [SCRAP_QTY_KEY]: "0" }]);
    mocks.getStep.mockImplementation(async (_id, stepNo) =>
      stepNo === 2 ? { ...step, Step_No: "2", Assigned_To: "present-doer" } : step
    );
    // Default beforeEach mock already returns { assignedTo: userId, leaveId: "" } — confirm
    // this doesn't spuriously write an audit row.

    await complete({ [PASS_QTY_KEY]: "10", [FAIL_QTY_KEY]: "0" }, "Pass");

    expect(mocks.insertRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stepNo: 2, assignedTo: "present-doer" })
    );
    expect(mocks.insertRecord).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityType: "FMS_RUN" })
    );
  });
});
