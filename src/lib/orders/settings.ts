import { getSetting, upsertSetting } from "@/lib/settings";
import type { FmsTatUnit } from "@/lib/fms/templates";

const DEFAULT_TAT_VALUE = 4;
const DEFAULT_TAT_UNIT: FmsTatUnit = "Hours";

/**
 * The Admin's one-time "Order Setup" — mirrors Purchase Setup's shape exactly: a Doer (+ a
 * fixed TAT) per working step. Unlike Purchase, no step here actually gates who may act on
 * it (same as Purchase's own steps today — see src/lib/purchase/orders.ts, where any
 * PURCHASE_FMS holder can work any step) — Doer/TAT are informational/administrative,
 * matching this codebase's existing convention rather than inventing per-step enforcement
 * this module doesn't otherwise need.
 *
 * `creditHoldApprover` is the one field here that IS actually enforced
 * (src/lib/orders/orders.ts's approveCreditHold) — deliberately NOT a module grant, per the
 * user's explicit instruction that this is a specific, org-configured person, decided here.
 */
export interface OrderSetupConfig {
  step1TatValue: number;
  step1TatUnit: FmsTatUnit;
  step1Doer: string;
  step2TatValue: number;
  step2TatUnit: FmsTatUnit;
  step2Doer: string;
  step3TatValue: number;
  step3TatUnit: FmsTatUnit;
  step3Doer: string;
  step4TatValue: number;
  step4TatUnit: FmsTatUnit;
  step4Doer: string;
  creditHoldApprover: string;
}

function parseUnit(raw: string | null): FmsTatUnit {
  return raw === "Minutes" || raw === "Days" ? raw : DEFAULT_TAT_UNIT;
}

export async function getOrderSetup(): Promise<OrderSetupConfig> {
  const [
    step1TatValue,
    step1TatUnit,
    step1Doer,
    step2TatValue,
    step2TatUnit,
    step2Doer,
    step3TatValue,
    step3TatUnit,
    step3Doer,
    step4TatValue,
    step4TatUnit,
    step4Doer,
    creditHoldApprover,
  ] = await Promise.all([
    getSetting("ORDER_STEP1_TAT_VALUE"),
    getSetting("ORDER_STEP1_TAT_UNIT"),
    getSetting("ORDER_STEP1_DOER"),
    getSetting("ORDER_STEP2_TAT_VALUE"),
    getSetting("ORDER_STEP2_TAT_UNIT"),
    getSetting("ORDER_STEP2_DOER"),
    getSetting("ORDER_STEP3_TAT_VALUE"),
    getSetting("ORDER_STEP3_TAT_UNIT"),
    getSetting("ORDER_STEP3_DOER"),
    getSetting("ORDER_STEP4_TAT_VALUE"),
    getSetting("ORDER_STEP4_TAT_UNIT"),
    getSetting("ORDER_STEP4_DOER"),
    getSetting("ORDER_CREDIT_HOLD_APPROVER"),
  ]);

  return {
    step1TatValue: Number(step1TatValue) > 0 ? Number(step1TatValue) : DEFAULT_TAT_VALUE,
    step1TatUnit: parseUnit(step1TatUnit),
    step1Doer: step1Doer ?? "",
    step2TatValue: Number(step2TatValue) > 0 ? Number(step2TatValue) : DEFAULT_TAT_VALUE,
    step2TatUnit: parseUnit(step2TatUnit),
    step2Doer: step2Doer ?? "",
    step3TatValue: Number(step3TatValue) > 0 ? Number(step3TatValue) : DEFAULT_TAT_VALUE,
    step3TatUnit: parseUnit(step3TatUnit),
    step3Doer: step3Doer ?? "",
    step4TatValue: Number(step4TatValue) > 0 ? Number(step4TatValue) : DEFAULT_TAT_VALUE,
    step4TatUnit: parseUnit(step4TatUnit),
    step4Doer: step4Doer ?? "",
    creditHoldApprover: creditHoldApprover ?? "",
  };
}

export async function saveOrderSetup(input: OrderSetupConfig): Promise<void> {
  await Promise.all([
    upsertSetting("ORDER_STEP1_TAT_VALUE", String(input.step1TatValue)),
    upsertSetting("ORDER_STEP1_TAT_UNIT", input.step1TatUnit),
    upsertSetting("ORDER_STEP1_DOER", input.step1Doer),
    upsertSetting("ORDER_STEP2_TAT_VALUE", String(input.step2TatValue)),
    upsertSetting("ORDER_STEP2_TAT_UNIT", input.step2TatUnit),
    upsertSetting("ORDER_STEP2_DOER", input.step2Doer),
    upsertSetting("ORDER_STEP3_TAT_VALUE", String(input.step3TatValue)),
    upsertSetting("ORDER_STEP3_TAT_UNIT", input.step3TatUnit),
    upsertSetting("ORDER_STEP3_DOER", input.step3Doer),
    upsertSetting("ORDER_STEP4_TAT_VALUE", String(input.step4TatValue)),
    upsertSetting("ORDER_STEP4_TAT_UNIT", input.step4TatUnit),
    upsertSetting("ORDER_STEP4_DOER", input.step4Doer),
    upsertSetting("ORDER_CREDIT_HOLD_APPROVER", input.creditHoldApprover),
  ]);
}
