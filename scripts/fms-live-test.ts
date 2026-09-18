/**
 * Live end-to-end test for the FMS Phase 3 group, run directly against Neon (bypassing
 * HTTP/session — calls the lib functions inside a fabricated runWithTenant() context, the
 * same tenant scoping every request goes through).
 *
 *   npx tsx scripts/fms-live-test.ts
 *
 * Creates its own throwaway organization, users, item, BOM, vendor, production plan and
 * FMS templates/instances, exercises them, and deletes every row it created at the end
 * (organizations.deleteOrganization does not cascade to domain tables, so this cleans up
 * items/stock_ledger/bom/production_plans/plan_materials/vendors/fms_templates/fms_runs
 * itself before deleting the org).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}
function ok(msg: string) {
  console.log(`  OK: ${msg}`);
}

async function main() {
  const { runWithTenant } = await import("../src/lib/tenant");
  const { createOrganization, deleteOrganization } = await import("../src/lib/platform/registry");
  const { createUser } = await import("../src/lib/auth/users");
  const { createItem } = await import("../src/lib/inventory/items");
  const { createBom } = await import("../src/lib/inventory/bom");
  const { createVendor } = await import("../src/lib/parties/vendors");
  const { createPlans, startProduction, completePlan } = await import("../src/lib/inventory/plans");
  const { listLedger, onHandBySku } = await import("../src/lib/inventory/ledger");
  const {
    createFmsTemplate,
    updateFmsTemplate,
    setFmsTemplateStatus,
    deleteFmsTemplate,
    listFmsTemplates,
    getFmsTemplateSteps,
    listNavFmsTemplates,
    userCanAccessTemplate,
  } = await import("../src/lib/fms/templates");
  const {
    startFmsInstance,
    completeFmsStep,
    emitFmsEvent,
    listAllFmsRuns,
    listFmsInstanceHistory,
    listMyPendingFmsSteps,
    hasPendingFmsRunsForTemplate,
    hasFmsLine,
  } = await import("../src/lib/fms/engine");
  const { resetAllFmsData } = await import("../src/lib/fms/reset");
  const { listSourceModuleRows } = await import("../src/lib/fms/dataSourceResolver");
  const { db } = await import("../src/db/client");
  const {
    items,
    stockLedger,
    bom,
    productionPlans,
    planMaterials,
    vendors,
    fmsTemplates: fmsTemplatesTable,
    fmsRuns: fmsRunsTable,
    users,
    usersIndex,
    settings,
  } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const org = await createOrganization({
    orgName: `FMS Test Org ${Date.now()}`,
    ownerEmail: `fms-test-${Date.now()}@example.com`,
  });
  console.log(`Created test org ${org.id} (${org.orgName})`);

  const ctx = { orgId: org.id, org };

  try {
    await runWithTenant(ctx, async () => {
      // ---- Setup: two doers, an item, a BOM, a vendor ----
      const doer1 = await createUser({
        fullName: "Doer One",
        email: `doer1-${Date.now()}@example.com`,
        password: "Password123!",
        role: "Staff",
        department: "Production",
        phoneNumber: "9990000001",
        createdBy: "SYSTEM",
      });
      const doer2 = await createUser({
        fullName: "Doer Two",
        email: `doer2-${Date.now()}@example.com`,
        password: "Password123!",
        role: "Staff",
        department: "Production",
        phoneNumber: "9990000002",
        createdBy: "SYSTEM",
      });
      ok(`created doer1=${doer1.User_ID}, doer2=${doer2.User_ID}`);

      const rawItem = await createItem({
        itemName: "Test Raw Material",
        category: "RM",
        uom: "Kg",
        createdBy: "SYSTEM",
      });
      const fgItem = await createItem({
        itemName: "Test Finished Good",
        category: "FG",
        uom: "Pcs",
        createdBy: "SYSTEM",
      });
      ok(`created items raw=${rawItem.SKU}, fg=${fgItem.SKU}`);

      const testBom = await createBom({
        productName: "Test Finished Good",
        productSku: fgItem.SKU,
        lines: [
          {
            componentSku: rawItem.SKU,
            componentName: rawItem.Item_Name,
            qtyPerUnit: 1,
            uom: "Kg",
          },
        ],
        createdBy: "SYSTEM",
      });
      ok(`created BOM ${testBom.bomId} v${testBom.version}`);

      const { vendor } = await createVendor({
        vendorName: "Test Vendor Co",
        contactPerson: "Mr Vendor",
        phone: "9998887777",
        createdBy: "SYSTEM",
      });
      ok(`created vendor ${vendor.Vendor_ID}`);

      // Opening stock for the raw material so production can actually consume it.
      const { recordMovement } = await import("../src/lib/inventory/ledger");
      await recordMovement({
        sku: rawItem.SKU,
        direction: "In",
        quantity: 100,
        uom: "Kg",
        source: "Opening",
        remark: "Test opening stock",
        userId: "SYSTEM",
      });
      ok("recorded opening stock for raw material (100 Kg)");

      // =========================================================================
      // TEST 1 — a real multi-step FMS template: branching outcomes, a lookup
      // field, and a TAT sourced from an earlier step's own field.
      // =========================================================================
      console.log("\n--- TEST 1: multi-step template (branching + TAT-source + lookup) ---");

      const templateIdV1 = await createFmsTemplate({
        templateName: "QC Review Flow",
        triggerEvent: "MANUAL",
        createdBy: "SYSTEM",
        steps: [
          {
            stepNo: 1,
            stepName: "Initial Review",
            assignedTo: doer1.User_ID,
            tatValue: 4,
            tatUnit: "Hours",
            outcomeOptions: ["Pass", "Fail"],
            nextStepMap: { Pass: 2, Fail: "END" },
            dataSourceConfig: JSON.stringify({
              form: {
                fields: [
                  { key: "lead-days", label: "Lead Days", type: "number", required: true },
                ],
              },
            }),
            actionType: "",
            actionConfig: "",
            outcomeType: "",
            tatSourceStepNo: "",
            tatSourceFieldKey: "",
            tatOffset: 0,
          },
          {
            stepNo: 2,
            stepName: "Vendor Follow-up",
            assignedTo: doer2.User_ID,
            // Fallback TAT — should be overridden by the TAT-source below.
            tatValue: 999,
            tatUnit: "Hours",
            outcomeOptions: ["Done"],
            nextStepMap: { Done: "END" },
            dataSourceConfig: JSON.stringify({
              form: {
                fields: [
                  {
                    key: "vendor-name",
                    label: "Vendor Name",
                    type: "lookup",
                    required: false,
                    lookup: {
                      sourceModule: "VENDORS",
                      displayField: "Vendor_Name",
                      autofillMap: { phone: "Phone" },
                    },
                  },
                  { key: "phone", label: "Phone", type: "text", required: false },
                ],
              },
            }),
            actionType: "",
            actionConfig: "",
            outcomeType: "",
            // TAT sourced from step 1's own "lead-days" field, offset -1 (Hours unit,
            // inherited from this step's own TAT_Unit).
            tatSourceStepNo: "1",
            tatSourceFieldKey: "lead-days",
            tatOffset: -1,
          },
        ],
      });
      ok(`created template ${templateIdV1}`);

      const steps = await getFmsTemplateSteps(templateIdV1);
      assert(steps.length === 2, `expected 2 steps, got ${steps.length}`);
      // jsonb does not preserve key insertion order (Postgres normalizes it), so compare
      // as a set rather than an exact string — every consumer (engine.ts's
      // parseNextStepMap, the frontend's own copy) parses this into a Record anyway,
      // where order is meaningless.
      const nextStepMapPairs = steps[0].Next_Step_Map.split(";").sort();
      assert(
        nextStepMapPairs.join(";") === "Fail:END;Pass:2",
        `unexpected Next_Step_Map: ${steps[0].Next_Step_Map}`
      );
      assert(steps[0].Data_Source_Type === "FORM", `unexpected Data_Source_Type: ${steps[0].Data_Source_Type}`);
      ok("Next_Step_Map round-trips correctly (order-independent — stored as real jsonb underneath)");

      // userCanAccessTemplate / listNavFmsTemplates (per-flow nav)
      assert(userCanAccessTemplate(steps, doer1.User_ID, false), "doer1 should see the template (assigned step 1)");
      assert(!userCanAccessTemplate(steps, "SOME-OTHER-USER", false), "an unrelated user should not see the template");
      const nav1 = await listNavFmsTemplates(doer1.User_ID, false);
      assert(nav1.some((n) => n.templateId === templateIdV1), "listNavFmsTemplates should include the template for doer1");
      const navAdmin = await listNavFmsTemplates("ANY-ADMIN", true);
      assert(navAdmin.some((n) => n.templateId === templateIdV1), "listNavFmsTemplates should include every Active template for an admin");
      ok("userCanAccessTemplate / listNavFmsTemplates behave as expected");

      // lookup-source backing function against real Postgres data (VENDORS)
      const vendorRows = await listSourceModuleRows("VENDORS");
      assert(vendorRows.some((r) => r.Vendor_ID === vendor.Vendor_ID), "listSourceModuleRows('VENDORS') should return the test vendor");
      ok("listSourceModuleRows('VENDORS') returns real Postgres-backed vendor rows (backs the FMS 'lookup' field)");

      // ---- Instance A: Pass branch ----
      const instanceA = await startFmsInstance({
        templateId: templateIdV1,
        contextRef: "MANUAL:TEST-A",
        startedBy: "SYSTEM",
      });
      assert(instanceA.Status === "Pending" && instanceA.Step_No === "1", "instance A should start at step 1, Pending");

      const completeA1 = await completeFmsStep({
        runId: instanceA.Run_ID,
        outcome: "Pass",
        completedBy: doer1.User_ID,
        formData: { "lead-days": "3" },
      });
      assert(completeA1.completed.Status === "On Time" || completeA1.completed.Status === "Delay Done", "step 1 should be completed");
      assert(completeA1.next.length === 1, `expected 1 next run (Pass -> step 2), got ${completeA1.next.length}`);
      const runA2 = completeA1.next[0];
      assert(runA2.Step_No === "2" && runA2.Status === "Pending", "step 2 should be created, Pending");

      // TAT-source check: step 2's deadline should be derived from lead-days=3, offset -1
      // => TAT_Value effectively 2 (Hours) from tatStart, not the fallback 999h.
      const tatStart = new Date(runA2.TAT_Start).getTime();
      const tatDeadline = new Date(runA2.TAT_Deadline).getTime();
      const hoursDiff = (tatDeadline - tatStart) / 3_600_000;
      assert(hoursDiff < 24, `TAT-sourced deadline should be a couple of hours out, not the 999h fallback — got ${hoursDiff}h`);
      ok(`step 2's deadline is TAT-sourced from step 1's "lead-days" field (~${hoursDiff.toFixed(2)}h out, not the 999h fallback)`);

      const completeA2 = await completeFmsStep({
        runId: runA2.Run_ID,
        outcome: "Done",
        completedBy: doer2.User_ID,
        formData: { "vendor-name": vendor.Vendor_Name, phone: vendor.Phone },
      });
      assert(completeA2.next.length === 0, "step 2 (Done -> END) should create no further run");
      ok("instance A (Pass branch) ran end-to-end: step 1 -> step 2 -> END");

      // ---- Instance B: Fail branch (ends at step 1) ----
      const instanceB = await startFmsInstance({
        templateId: templateIdV1,
        contextRef: "MANUAL:TEST-B",
        startedBy: "SYSTEM",
      });
      const completeB1 = await completeFmsStep({
        runId: instanceB.Run_ID,
        outcome: "Fail",
        completedBy: doer1.User_ID,
        formData: { "lead-days": "5" },
      });
      assert(completeB1.next.length === 0, "Fail branch should end the flow (no step 2)");
      ok("instance B (Fail branch) correctly ended at step 1 (Next_Step_Map Fail:END honoured)");

      // "one open TAT per person" queuing: doer1 completed both their steps, so no more
      // Pending steps should remain for them from this template.
      const doer1Pending = await listMyPendingFmsSteps(doer1.User_ID);
      assert(doer1Pending.length === 0, `doer1 should have 0 pending steps left, got ${doer1Pending.length}`);
      ok("listMyPendingFmsSteps reflects both of doer1's steps as completed");

      const history = await listFmsInstanceHistory(instanceA.Instance_ID);
      assert(history.length === 2, `instance A history should have 2 runs, got ${history.length}`);
      ok("listFmsInstanceHistory returns both steps for instance A");

      // ---- Template versioning: edit mints a new Template_ID, archives the old one ----
      const templateIdV2 = await updateFmsTemplate(templateIdV1, {
        templateName: "QC Review Flow (v2)",
        triggerEvent: "MANUAL",
        createdBy: "SYSTEM",
        steps: [
          {
            stepNo: 1,
            stepName: "Initial Review (v2)",
            assignedTo: doer1.User_ID,
            tatValue: 2,
            tatUnit: "Hours",
            outcomeOptions: ["Done"],
            nextStepMap: { Done: "END" },
            dataSourceConfig: "",
            actionType: "",
            actionConfig: "",
            outcomeType: "DONE",
            tatSourceStepNo: "",
            tatSourceFieldKey: "",
            tatOffset: 0,
          },
        ],
      });
      assert(templateIdV2 !== templateIdV1, "editing must mint a new Template_ID");
      const allTemplates = await listFmsTemplates();
      const oldRows = allTemplates.filter((t) => t.Template_ID === templateIdV1);
      assert(oldRows.every((r) => r.Status === "Archived"), "old template version should be Archived");
      ok(`updateFmsTemplate archived v1 (${templateIdV1}) and created v2 (${templateIdV2})`);

      // Instance A/B still resolve against the archived v1 steps (their own history is
      // untouched, already asserted above via listFmsInstanceHistory).

      // Delete guard: v1 has completed runs but nothing Pending against it, so it's not
      // blocked by hasPendingFmsRunsForTemplate; v2 (Active) must refuse Delete.
      const v1Pending = await hasPendingFmsRunsForTemplate(templateIdV1);
      assert(!v1Pending, "template v1 should have no Pending runs (both instances finished)");
      await deleteFmsTemplate(templateIdV1);
      ok("deleteFmsTemplate succeeded on the Archived v1 (only-Archived-may-delete guard passed)");

      let deleteActiveThrew = false;
      try {
        await deleteFmsTemplate(templateIdV2);
      } catch {
        deleteActiveThrew = true;
      }
      assert(deleteActiveThrew, "deleteFmsTemplate must refuse an Active template");
      ok("deleteFmsTemplate correctly refused to delete the Active v2");

      await setFmsTemplateStatus(templateIdV2, "Archived");
      await deleteFmsTemplate(templateIdV2);
      ok("archived + deleted v2 for cleanup");

      // =========================================================================
      // TEST 2 — the full cross-module chain: Item + BOM + Production Plan ->
      // Start Production -> FMS "Line" (PRODUCTION_STARTED) -> Pass/Fail/Scrap
      // rework loop -> final step's Ledger Movement Action writes real FG stock.
      // =========================================================================
      console.log("\n--- TEST 2: Inventory -> PPC -> FMS Line -> Inventory (real stock write) ---");

      const lineTemplateId = await createFmsTemplate({
        templateName: "FG Production Line",
        triggerEvent: "PRODUCTION_STARTED",
        createdBy: "SYSTEM",
        steps: [
          {
            stepNo: 1,
            stepName: "Stage 1 — Assembly",
            assignedTo: doer1.User_ID,
            tatValue: 8,
            tatUnit: "Hours",
            outcomeOptions: ["Pass", "Fail"],
            nextStepMap: { Pass: 2, Fail: "END" },
            dataSourceConfig: JSON.stringify({
              form: {
                fields: [
                  { key: "pass-qty", label: "Pass Qty", type: "number", required: true },
                  { key: "fail-qty", label: "Fail Qty", type: "number", required: true },
                  { key: "scrap-qty", label: "Scrap Qty", type: "number", required: false },
                ],
              },
            }),
            actionType: "",
            actionConfig: "",
            outcomeType: "PASS_FAIL_QTY",
            tatSourceStepNo: "",
            tatSourceFieldKey: "",
            tatOffset: 0,
          },
          {
            stepNo: 2,
            stepName: "Final QC + Stock In",
            assignedTo: doer2.User_ID,
            tatValue: 8,
            tatUnit: "Hours",
            outcomeOptions: ["Done"],
            nextStepMap: { Done: "END" },
            dataSourceConfig: JSON.stringify({
              form: {
                fields: [{ key: "survived-qty", label: "Survived Qty", type: "number", required: true }],
              },
              existing: {
                sourceModule: "PRODUCTION_PLANS",
                columns: ["Product_SKU"],
                filterByContext: true,
              },
            }),
            actionType: "LEDGER_MOVEMENT",
            actionConfig: JSON.stringify({
              Done: { direction: "In", skuField: "Product_SKU", qtyField: "survived-qty" },
            }),
            outcomeType: "",
            tatSourceStepNo: "",
            tatSourceFieldKey: "",
            tatOffset: 0,
          },
        ],
      });
      ok(`created FMS Line template ${lineTemplateId}`);

      const [plan] = await createPlans(
        [{ productName: "Test Finished Good", plannedQty: 10, productionDate: "2026-09-20" }],
        "SYSTEM"
      );
      assert(plan.status === "Ready", `plan should be Ready (enough raw stock), got ${plan.status}`);
      ok(`created production plan ${plan.planId} (Job ${plan.jobNo}), status=${plan.status}`);

      const started = await startProduction(plan.planId, 10, "SYSTEM");
      assert(started.status === "In_Production", "startProduction should set status In_Production");
      ok(`startProduction consumed raw material for actualQty=10`);

      // Same as the real /api/ppc/plans/[planId] route's "start" action: fire
      // PRODUCTION_STARTED (no plan.fmsTemplateId chosen here, so the broadcast path).
      await emitFmsEvent("PRODUCTION_STARTED", `PRODUCTION_PLANS:${plan.planId}`, started.actualQty ?? undefined);

      const lineRuns = (await listAllFmsRuns()).filter(
        (r) => r.Context_Ref === `PRODUCTION_PLANS:${plan.planId}`
      );
      assert(lineRuns.length === 1, `expected exactly 1 run created for the Line's first step, got ${lineRuns.length}`);
      const stage1Run = lineRuns[0];
      assert(stage1Run.Step_No === "1" && stage1Run.Quantity === "10", `stage1 run should carry Quantity=10, got ${stage1Run.Quantity}`);
      ok("emitFmsEvent(PRODUCTION_STARTED) started the Line, first step carries the plan's actual quantity (10)");

      const lineHasFmsLine = await hasFmsLine(plan.planId);
      assert(lineHasFmsLine, "hasFmsLine(planId) should be true once the Line's first step exists");
      ok("hasFmsLine() correctly detects the running Line (Postgres-backed, via the surgical fix in plans.ts)");

      // Stage 1: 7 pass, 2 fail (rework), 1 scrap.
      const stage1Complete = await completeFmsStep({
        runId: stage1Run.Run_ID,
        outcome: "Pass", // ignored for PASS_FAIL_QTY — branch follows the numbers
        completedBy: doer1.User_ID,
        formData: { "pass-qty": "7", "fail-qty": "2", "scrap-qty": "1" },
      });
      assert(stage1Complete.completed.Outcome === "Fail", "derived Outcome should be Fail (nonzero Fail Qty)");
      assert(stage1Complete.next.length === 2, `expected 2 next runs (Pass->step2, Fail->rework at step1), got ${stage1Complete.next.length}`);
      const toStep2 = stage1Complete.next.find((r) => r.Step_No === "2");
      const rework = stage1Complete.next.find((r) => r.Step_No === "1");
      assert(toStep2?.Quantity === "7", `Pass branch should carry Quantity=7, got ${toStep2?.Quantity}`);
      assert(rework?.Quantity === "2", `Fail rework should carry Quantity=2, got ${rework?.Quantity}`);
      assert(rework?.Assigned_To === doer1.User_ID, "rework should stay assigned to the same doer");
      ok("PASS_FAIL_QTY split: 7 -> step 2, 2 -> rework at step 1 (same doer), 1 scrapped (accounted for, spawns nothing)");

      // Rework the 2 failed units — this time all pass.
      const reworkComplete = await completeFmsStep({
        runId: rework!.Run_ID,
        outcome: "Pass",
        completedBy: doer1.User_ID,
        formData: { "pass-qty": "2", "fail-qty": "0", "scrap-qty": "0" },
      });
      assert(reworkComplete.next.length === 1 && reworkComplete.next[0].Quantity === "2", "reworked units should now move on to step 2 with Quantity=2");
      const toStep2FromRework = reworkComplete.next[0];
      ok("rework loop resolved: the 2 reworked units now also queued at step 2");

      // doer2 now has two Pending step-2 runs (7 and 2) — "one open TAT per person"
      // should have queued the second one's clock to start after the first's deadline.
      const doer2Pending = await listMyPendingFmsSteps(doer2.User_ID);
      assert(doer2Pending.length === 2, `doer2 should have 2 pending step-2 runs, got ${doer2Pending.length}`);
      const deadlines = doer2Pending.map((r) => new Date(r.TAT_Deadline).getTime()).sort((a, b) => a - b);
      assert(deadlines[1] > deadlines[0], "the second-created run's deadline should be pushed out past the first's");
      ok(`doer2 correctly holds 2 queued open TATs (deadlines ${new Date(deadlines[0]).toISOString()} then ${new Date(deadlines[1]).toISOString()})`);

      // Complete both step-2 runs — each fires the Ledger Movement Action (In, real stock).
      const ledgerBefore = onHandBySku(await listLedger()).get(fgItem.SKU) ?? 0;

      const completedStep2A = await completeFmsStep({
        runId: toStep2.Run_ID,
        outcome: "Done",
        completedBy: doer2.User_ID,
        formData: { "survived-qty": "7" },
      });
      assert(completedStep2A.completed.Status === "On Time" || completedStep2A.completed.Status === "Delay Done", "step2 (7) should complete");

      const completedStep2B = await completeFmsStep({
        runId: toStep2FromRework.Run_ID,
        outcome: "Done",
        completedBy: doer2.User_ID,
        formData: { "survived-qty": "2" },
      });
      assert(completedStep2B.completed.Status === "On Time" || completedStep2B.completed.Status === "Delay Done", "step2 (2) should complete");

      const ledgerAfter = onHandBySku(await listLedger()).get(fgItem.SKU) ?? 0;
      const gained = Math.round((ledgerAfter - ledgerBefore) * 1000) / 1000;
      assert(gained === 9, `FG stock should have gained exactly 9 (7 + 2, the survived qty — never the plan's optimistic 10), got ${gained}`);
      ok(`Ledger Movement Action wrote real FG stock: +${gained} (7 then 2 — matches what actually survived every stage, not the plan's 10)`);

      // completePlan() should now SKIP its own stock write (the Line already wrote it).
      const beforeComplete = onHandBySku(await listLedger()).get(fgItem.SKU) ?? 0;
      const completedPlan = await completePlan(plan.planId, "SYSTEM");
      assert(completedPlan.status === "Completed", "completePlan should set status Completed");
      const afterComplete = onHandBySku(await listLedger()).get(fgItem.SKU) ?? 0;
      assert(afterComplete === beforeComplete, `completePlan() must NOT write additional stock when hasFmsLine() is true — before=${beforeComplete}, after=${afterComplete}`);
      ok("completePlan() correctly skipped its own stock write — the Line's final step already wrote it (no double-count)");

      // =========================================================================
      // TEST 3 — Admin reset wipes fms_templates + fms_runs only.
      // =========================================================================
      console.log("\n--- TEST 3: Admin full FMS reset ---");
      const beforeReset = { templates: (await listFmsTemplates()).length, runs: (await listAllFmsRuns()).length };
      assert(beforeReset.templates > 0 && beforeReset.runs > 0, "should have FMS data to reset");
      const resetResult = await resetAllFmsData();
      assert(resetResult.templatesDeleted === beforeReset.templates, `templatesDeleted mismatch: ${resetResult.templatesDeleted} vs ${beforeReset.templates}`);
      assert(resetResult.runsDeleted === beforeReset.runs, `runsDeleted mismatch: ${resetResult.runsDeleted} vs ${beforeReset.runs}`);
      const afterReset = { templates: (await listFmsTemplates()).length, runs: (await listAllFmsRuns()).length };
      assert(afterReset.templates === 0 && afterReset.runs === 0, "reset should leave 0 templates and 0 runs");
      // FG stock (a different table) must be untouched by the FMS reset.
      const fgStockAfterReset = onHandBySku(await listLedger()).get(fgItem.SKU) ?? 0;
      assert(fgStockAfterReset === afterComplete, "resetAllFmsData must not touch stock_ledger");
      ok(`resetAllFmsData deleted ${resetResult.templatesDeleted} template rows + ${resetResult.runsDeleted} run rows, left stock_ledger untouched`);

      console.log("\nAll FMS live tests passed.");
    });
  } finally {
    // ---- Cleanup: delete every row this script created, across every table touched ----
    console.log("\nCleaning up test data...");
    await db.delete(fmsRunsTable).where(eq(fmsRunsTable.orgId, org.id));
    await db.delete(fmsTemplatesTable).where(eq(fmsTemplatesTable.orgId, org.id));
    await db.delete(planMaterials).where(eq(planMaterials.orgId, org.id));
    await db.delete(productionPlans).where(eq(productionPlans.orgId, org.id));
    await db.delete(stockLedger).where(eq(stockLedger.orgId, org.id));
    await db.delete(bom).where(eq(bom.orgId, org.id));
    await db.delete(items).where(eq(items.orgId, org.id));
    await db.delete(vendors).where(eq(vendors.orgId, org.id));
    await db.delete(settings).where(eq(settings.orgId, org.id));
    await db.delete(usersIndex).where(eq(usersIndex.orgId, org.id));
    await db.delete(users).where(eq(users.orgId, org.id));
    await deleteOrganization(org.id);
    console.log(`Deleted organization ${org.id} and all test rows.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nFMS LIVE TEST FAILED:", error);
    process.exit(1);
  });
