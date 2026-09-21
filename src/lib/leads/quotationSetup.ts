import { getSetting, upsertSetting } from "@/lib/settings";

/**
 * The Admin's one-time "Quotation Setup" — letterhead details (company/bank, since
 * `organizations` itself carries no address/GSTIN/bank fields) and the defaults a new
 * quotation is seeded with. Mirrors src/lib/purchase/settings.ts's key-value shape.
 *
 * The org's logo is read straight from ORG_LOGO_URL (Module 10) at render time — no second
 * logo upload here.
 */
export interface QuotationSetupConfig {
  companyName: string;
  companyAddress: string;
  companyGstin: string;
  bankBeneficiary: string;
  bankName: string;
  bankAccountNo: string;
  bankIfsc: string;
  bankBranch: string;
  defaultSubject: string;
  defaultNote: string;
  defaultTerms: string;
  gstPercent: number;
  /** e.g. "QN" -> "QN-0001". */
  numberPrefix: string;
  numberStart: number;
  validityDays: number;
}

const DEFAULTS: QuotationSetupConfig = {
  companyName: "",
  companyAddress: "",
  companyGstin: "",
  bankBeneficiary: "",
  bankName: "",
  bankAccountNo: "",
  bankIfsc: "",
  bankBranch: "",
  defaultSubject: "Supply as per the specifications below:",
  defaultNote:
    "Goods will be supplied as per the specifications and requirements confirmed with the customer.",
  defaultTerms: [
    "1. Delivery Period: Confirmed order ke against decide hoga.",
    "2. Price: Upar diye gaye rates basic hain. GST alag se lagega.",
    "3. Transportation: Actuals par extra charge hoga.",
    "4. Payment Terms: Purchase order ke saath decide honge.",
    "5. Ye offer quotation ki date se 15 din tak valid hai.",
  ].join("\n"),
  gstPercent: 18,
  numberPrefix: "QN",
  numberStart: 1,
  validityDays: 15,
};

export async function getQuotationSetup(): Promise<QuotationSetupConfig> {
  const [
    companyName,
    companyAddress,
    companyGstin,
    bankBeneficiary,
    bankName,
    bankAccountNo,
    bankIfsc,
    bankBranch,
    defaultSubject,
    defaultNote,
    defaultTerms,
    gstPercent,
    numberPrefix,
    numberStart,
    validityDays,
  ] = await Promise.all([
    getSetting("QUOTATION_COMPANY_NAME"),
    getSetting("QUOTATION_COMPANY_ADDRESS"),
    getSetting("QUOTATION_COMPANY_GSTIN"),
    getSetting("QUOTATION_BANK_BENEFICIARY"),
    getSetting("QUOTATION_BANK_NAME"),
    getSetting("QUOTATION_BANK_ACCOUNT_NO"),
    getSetting("QUOTATION_BANK_IFSC"),
    getSetting("QUOTATION_BANK_BRANCH"),
    getSetting("QUOTATION_DEFAULT_SUBJECT"),
    getSetting("QUOTATION_DEFAULT_NOTE"),
    getSetting("QUOTATION_DEFAULT_TERMS"),
    getSetting("QUOTATION_GST_PERCENT"),
    getSetting("QUOTATION_NUMBER_PREFIX"),
    getSetting("QUOTATION_NUMBER_START"),
    getSetting("QUOTATION_VALIDITY_DAYS"),
  ]);

  return {
    companyName: companyName ?? DEFAULTS.companyName,
    companyAddress: companyAddress ?? DEFAULTS.companyAddress,
    companyGstin: companyGstin ?? DEFAULTS.companyGstin,
    bankBeneficiary: bankBeneficiary ?? DEFAULTS.bankBeneficiary,
    bankName: bankName ?? DEFAULTS.bankName,
    bankAccountNo: bankAccountNo ?? DEFAULTS.bankAccountNo,
    bankIfsc: bankIfsc ?? DEFAULTS.bankIfsc,
    bankBranch: bankBranch ?? DEFAULTS.bankBranch,
    defaultSubject: defaultSubject || DEFAULTS.defaultSubject,
    defaultNote: defaultNote || DEFAULTS.defaultNote,
    defaultTerms: defaultTerms || DEFAULTS.defaultTerms,
    gstPercent: Number(gstPercent) > 0 ? Number(gstPercent) : DEFAULTS.gstPercent,
    numberPrefix: numberPrefix || DEFAULTS.numberPrefix,
    numberStart: Number(numberStart) > 0 ? Number(numberStart) : DEFAULTS.numberStart,
    validityDays: Number(validityDays) > 0 ? Number(validityDays) : DEFAULTS.validityDays,
  };
}

export async function saveQuotationSetup(input: QuotationSetupConfig): Promise<void> {
  await Promise.all([
    upsertSetting("QUOTATION_COMPANY_NAME", input.companyName),
    upsertSetting("QUOTATION_COMPANY_ADDRESS", input.companyAddress),
    upsertSetting("QUOTATION_COMPANY_GSTIN", input.companyGstin),
    upsertSetting("QUOTATION_BANK_BENEFICIARY", input.bankBeneficiary),
    upsertSetting("QUOTATION_BANK_NAME", input.bankName),
    upsertSetting("QUOTATION_BANK_ACCOUNT_NO", input.bankAccountNo),
    upsertSetting("QUOTATION_BANK_IFSC", input.bankIfsc),
    upsertSetting("QUOTATION_BANK_BRANCH", input.bankBranch),
    upsertSetting("QUOTATION_DEFAULT_SUBJECT", input.defaultSubject),
    upsertSetting("QUOTATION_DEFAULT_NOTE", input.defaultNote),
    upsertSetting("QUOTATION_DEFAULT_TERMS", input.defaultTerms),
    upsertSetting("QUOTATION_GST_PERCENT", String(input.gstPercent)),
    upsertSetting("QUOTATION_NUMBER_PREFIX", input.numberPrefix),
    upsertSetting("QUOTATION_NUMBER_START", String(input.numberStart)),
    upsertSetting("QUOTATION_VALIDITY_DAYS", String(input.validityDays)),
  ]);
}
