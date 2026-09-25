import { getSetting, upsertSetting } from "@/lib/settings";
import type { FmsTatUnit } from "@/lib/fms/templates";

const DEFAULT_TAT_VALUE = 4;
const DEFAULT_TAT_UNIT: FmsTatUnit = "Hours";
const DEFAULT_GST_PERCENT = 18;
const DEFAULT_TERMS = [
  "1. Delivery: Order confirm hone ke Lead Time ke andar material deliver karein.",
  "2. Quality: Material humari specification aur quality standard ke mutabik hona chahiye — mismatch hone par reject/return hoga.",
  "3. Price: Upar diye gaye rates basic hain. GST alag se lagega.",
  "4. Payment Terms: Material Received aur Invoice verify hone ke baad hi payment process hoga.",
  "5. Kripya PO ki quantity aur specification se zyada/kam supply na karein bina prior approval ke.",
].join("\n");
const DEFAULT_NOTE = "Please acknowledge receipt of this Purchase Order and confirm the delivery schedule.";

/**
 * The Admin's one-time "Purchase Setup" — which user (Doer) is expected to act on each of
 * the Purchase flow's 4 steps, a fixed TAT for the two steps that have one, and the
 * defaults a new PO's own GST%/Note/Terms & Conditions are seeded with (mirrors
 * QuotationSetupConfig's own gstPercent/defaultNote/defaultTerms shape in
 * src/lib/leads/quotationSetup.ts — kept as separate settings keys here on purpose, since
 * Purchase and Sales GST%/terms are conceptually independent). Step 3 (Follow Up) and
 * Step 4 (Material Received) deliberately have no TAT here — their deadline comes from
 * the vendor's own Lead Time instead, computed per PO at Issue time (see
 * src/lib/purchase/orders.ts).
 */
export interface PurchaseSetupConfig {
  step1TatValue: number;
  step1TatUnit: FmsTatUnit;
  step1Doer: string;
  step2TatValue: number;
  step2TatUnit: FmsTatUnit;
  step2Doer: string;
  step3Doer: string;
  step4Doer: string;
  gstPercentDefault: number;
  defaultTerms: string;
  defaultNote: string;
}

function parseUnit(raw: string | null): FmsTatUnit {
  return raw === "Minutes" || raw === "Days" ? raw : DEFAULT_TAT_UNIT;
}

export async function getPurchaseSetup(): Promise<PurchaseSetupConfig> {
  const [
    step1TatValue,
    step1TatUnit,
    step1Doer,
    step2TatValue,
    step2TatUnit,
    step2Doer,
    step3Doer,
    step4Doer,
    gstPercentDefault,
    defaultTerms,
    defaultNote,
  ] = await Promise.all([
    getSetting("PURCHASE_STEP1_TAT_VALUE"),
    getSetting("PURCHASE_STEP1_TAT_UNIT"),
    getSetting("PURCHASE_STEP1_DOER"),
    getSetting("PURCHASE_STEP2_TAT_VALUE"),
    getSetting("PURCHASE_STEP2_TAT_UNIT"),
    getSetting("PURCHASE_STEP2_DOER"),
    getSetting("PURCHASE_STEP3_DOER"),
    getSetting("PURCHASE_STEP4_DOER"),
    getSetting("PURCHASE_GST_PERCENT_DEFAULT"),
    getSetting("PURCHASE_DEFAULT_TERMS"),
    getSetting("PURCHASE_DEFAULT_NOTE"),
  ]);

  return {
    step1TatValue: Number(step1TatValue) > 0 ? Number(step1TatValue) : DEFAULT_TAT_VALUE,
    step1TatUnit: parseUnit(step1TatUnit),
    step1Doer: step1Doer ?? "",
    step2TatValue: Number(step2TatValue) > 0 ? Number(step2TatValue) : DEFAULT_TAT_VALUE,
    step2TatUnit: parseUnit(step2TatUnit),
    step2Doer: step2Doer ?? "",
    step3Doer: step3Doer ?? "",
    step4Doer: step4Doer ?? "",
    gstPercentDefault: Number(gstPercentDefault) > 0 ? Number(gstPercentDefault) : DEFAULT_GST_PERCENT,
    defaultTerms: defaultTerms || DEFAULT_TERMS,
    defaultNote: defaultNote || DEFAULT_NOTE,
  };
}

export async function savePurchaseSetup(input: PurchaseSetupConfig): Promise<void> {
  await Promise.all([
    upsertSetting("PURCHASE_STEP1_TAT_VALUE", String(input.step1TatValue)),
    upsertSetting("PURCHASE_STEP1_TAT_UNIT", input.step1TatUnit),
    upsertSetting("PURCHASE_STEP1_DOER", input.step1Doer),
    upsertSetting("PURCHASE_STEP2_TAT_VALUE", String(input.step2TatValue)),
    upsertSetting("PURCHASE_STEP2_TAT_UNIT", input.step2TatUnit),
    upsertSetting("PURCHASE_STEP2_DOER", input.step2Doer),
    upsertSetting("PURCHASE_STEP3_DOER", input.step3Doer),
    upsertSetting("PURCHASE_STEP4_DOER", input.step4Doer),
    upsertSetting("PURCHASE_GST_PERCENT_DEFAULT", String(input.gstPercentDefault)),
    upsertSetting("PURCHASE_DEFAULT_TERMS", input.defaultTerms),
    upsertSetting("PURCHASE_DEFAULT_NOTE", input.defaultNote),
  ]);
}
