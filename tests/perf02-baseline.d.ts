declare module "perf02-baseline/inventory-service" {
  export const getInventorySnapshot: typeof import("@/lib/inventory/service").getInventorySnapshot;
  export const getItemDetail: typeof import("@/lib/inventory/service").getItemDetail;
}
declare module "perf02-baseline/accounts" {
  export const getReceivablesAging: typeof import("@/lib/accounts/accounts").getReceivablesAging;
  export const getCreditRiskReport: typeof import("@/lib/accounts/accounts").getCreditRiskReport;
}
declare module "perf02-baseline/account-ledger" {
  export const getBalanceSheet: typeof import("@/lib/accounts/ledger").getBalanceSheet;
  export const getProfitAndLoss: typeof import("@/lib/accounts/ledger").getProfitAndLoss;
}
