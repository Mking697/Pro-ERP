import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Table = { name: string } & Record<string, string>;
type Predicate = (row: Row) => boolean;
const h = vi.hoisted(() => {
  const names = ["customers", "orderActivities", "orderItems", "orderPayments", "orders", "quotationItems", "quotations"];
  const tables = Object.fromEntries(names.map((name) => [name, Object.assign({ name }, Object.fromEntries(["id", "orgId", "orderId", "lineNo", "sku", "status", "customerId", "quotationId", "createdAt", "receivedAt"].map((key) => [key, key])))]));
  const state = { rows: {} as Record<string, Row[]>, active: false, events: [] as string[], free: 10, sequence: 0, effects: [] as (() => Promise<void>)[] };
  const transaction = vi.fn(async (_org: string, work: () => Promise<unknown>) => {
    if (state.active) return work();
    const snapshot = structuredClone(state.rows);
    state.active = true;
    state.events.push("lock");
    let result: unknown;
    try { result = await work(); state.events.push("commit"); }
    catch (error) { state.rows = snapshot; state.effects = []; throw error; }
    finally { state.active = false; }
    const effects = state.effects.splice(0);
    for (const effect of effects) await effect();
    return result;
  });
  const select = vi.fn(() => ({ from: (table: Table) => ({ where: async (predicate: Predicate) => {
    state.events.push(`read:${table.name}`);
    return state.rows[table.name].filter(predicate);
  } }) }));
  const update = vi.fn((table: Table) => ({ set: (values: Row) => ({ where: async (predicate: Predicate) => {
    state.events.push(`write:${table.name}`);
    for (const row of state.rows[table.name].filter(predicate)) Object.assign(row, values);
  } }) }));
  const insert = vi.fn(async (table: Table, values: Row) => {
    state.events.push(`write:${table.name}`);
    state.rows[table.name].push({ createdAt: new Date("2026-01-01"), reservedQty: "0", shortageQty: "0", consumedQty: "0", ...values });
  });
  const find = vi.fn(async (table: Table, orgId: string, id: string) => {
    state.events.push(`read:${table.name}`);
    return state.rows[table.name].find((row) => row.orgId === orgId && row.id === id) ?? null;
  });
  const journal = vi.fn(async (input: Row) => { state.events.push("journal"); state.rows.journals.push(input); return "JRN-1"; });
  const availability = vi.fn(async () => ({ onHand: new Map([["FG", state.free]]), orderReserved: new Map(), planReserved: new Map(), free: new Map([["FG", state.free]]) }));
  const mutation = vi.fn(async (_org: string, _options: Row, work: () => Promise<unknown>) => transaction(_org, work));
  return { tables, state, transaction, select, update, insert, find, journal, availability, mutation,
    tasks: vi.fn(async () => { state.events.push("task"); }),
    whatsapp: vi.fn(async () => { state.events.push("whatsapp"); return { ok: true }; }),
    afterCommit: vi.fn(async (effect: () => Promise<void>) => { state.events.push("afterCommit"); if (state.active) state.effects.push(effect); else await effect(); }),
    event: vi.fn(async () => { state.events.push("fms"); }),
    pdi: vi.fn(async () => { state.events.push("pdi"); }),
    users: vi.fn(async () => [] as Row[]),
    item: vi.fn(async (sku: string) => ({ SKU: sku, Item_Name: sku, UOM: "PCS" })),
  };
});
vi.mock("drizzle-orm", () => ({
  eq: (key: string, value: unknown) => (row: Row) => row[key] === value,
  and: (...predicates: Predicate[]) => (row: Row) => predicates.every((predicate) => predicate(row)),
  inArray: (key: string, values: unknown[]) => (row: Row) => values.includes(row[key]),
  desc: (key: string) => key,
}));
vi.mock("@/db/schema", () => h.tables);
vi.mock("@/db/client", () => ({ db: { select: h.select, update: h.update }, runInTenantTransaction: h.transaction, afterTenantCommit: h.afterCommit }));
vi.mock("@/db/repo", () => ({ findById: h.find, insertRecord: h.insert,
  updateById: async (table: Table, org: string, id: string, values: Row) => h.update(table).set(values).where((row) => row.orgId === org && row.id === id),
  listByOrg: async (table: Table, org: string) => h.state.rows[table.name].filter((row) => row.orgId === org),
}));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG" }));
vi.mock("@/lib/id", () => ({ generateId: (prefix: string) => `${prefix}-${++h.state.sequence}` }));
vi.mock("@/lib/mutations", () => ({ runIdempotentTenantMutation: h.mutation }));
vi.mock("@/lib/inventory/availability", () => ({ getStockAvailability: h.availability }));
vi.mock("@/lib/inventory/items", () => ({ findItem: h.item }));
vi.mock("@/lib/inventory/ledger", () => ({ listLedger: async () => [], onHandBySku: () => new Map(), positionFor: () => ({ free: h.state.free }) }));
vi.mock("@/lib/inventory/plans", () => ({ committedBySku: async () => new Map() }));
vi.mock("@/lib/inventory/indents", () => ({ inTransitBySku: async () => new Map() }));
vi.mock("@/lib/parties/customers", () => ({ createCustomer: vi.fn() }));
vi.mock("@/lib/fms/engine", () => ({ emitFmsEvent: h.event, startFmsInstance: h.event }));
vi.mock("@/lib/fms/templates", () => ({ listFmsTemplates: async () => [{Step_No:"1",Trigger_Event:"ORDER_READY_FOR_PDI",Status:"Active",Template_ID:"FTP"}] }));
vi.mock("@/lib/tasks", () => ({ createTask: h.tasks }));
vi.mock("@/lib/chatxflow", () => ({ sendWhatsAppMessage: h.whatsapp }));
vi.mock("@/lib/auth/users", () => ({ listUsers: h.users }));
vi.mock("@/lib/moduleAccess", () => ({ effectiveModuleAccess: () => ["PPC_PLAN"] }));
vi.mock("@/lib/orders/settings", () => ({ getOrderSetup: async () => ({ creditHoldApprover: "actor" }) }));
vi.mock("@/lib/accounts/ledger", () => ({ postJournalEntry: h.journal, SYSTEM_ACCOUNT_CODES: { CASH_BANK: "CASH", ACCOUNTS_RECEIVABLE: "AR", CUSTOMER_CREDIT_BALANCE: "CC" } }));
vi.mock("@/lib/pdi/pdi", () => ({ noteStockAvailable: h.pdi }));
import { cancelOrder, runStockCheck, recordPayment, orderReservedBySku, recheckShortfallForSku, commitDispatch, workPaymentReview, approveCreditHold, createDirectOrder, createOrderFromQuotation, setTransportArrangedBy } from "@/lib/orders/orders";

it("payment review admits status writer before reading the order", async () => {
  h.state.rows.orders[0].status = "Payment_Review"; h.state.rows.customers.push({id:"CUS",orgId:"ORG",creditLimit:"1000",creditDays:null}); await workPaymentReview("ORD", "actor");
  expect(h.state.events[0]).toBe("lock");
  expect(h.state.events.at(-1)).toBe("commit");
});

it("credit approval admits status writer before reading the order", async () => {
  h.state.rows.orders[0].status = "Credit_Hold"; await approveCreditHold("ORD", {userId:"actor",role:"Admin"});
  expect(h.state.events[0]).toBe("lock");
  expect(h.state.events.at(-1)).toBe("commit");
});

it("dispatch commitment admits status writer before reading the order", async () => {
  h.state.rows.orders[0].status = "Dispatch_Pending"; await commitDispatch("ORD", "2026-11-01", "actor");
  expect(h.state.events[0]).toBe("lock");
  expect(h.state.events.at(-1)).toBe("commit");
});

it("transport backfill admits header writer before reading the order", async () => {
  await setTransportArrangedBy("ORD", "Self", "actor");
  expect(h.state.events[0]).toBe("lock");
  expect(h.state.events.at(-1)).toBe("commit");
});

it("direct intake admits item writer before customer and item reads", async () => {
  h.state.rows.customers.push({id:"CUS",orgId:"ORG"}); await createDirectOrder({customerId:"CUS",items:[{sku:"FG",qty:2,rate:10}],transportArrangedBy:"Self"}, "actor");
  expect(h.state.events[0]).toBe("lock");
  expect(h.state.events.at(-1)).toBe("commit");
});

it("quotation intake admits item writer before source and customer reads", async () => {
  h.state.rows.customers.push({id:"CUS",orgId:"ORG"}); h.state.rows.quotations.push({id:"QUO",orgId:"ORG",status:"Accepted",orderId:"",payableAmount:"100"}); h.state.rows.quotationItems.push({orgId:"ORG",quotationId:"QUO",lineNo:"1",qty:"2",rate:"10",amount:"20"}); await createOrderFromQuotation({quotationId:"QUO",customerId:"CUS",items:[{lineNo:"1",sku:"FG"}],transportArrangedBy:"Self"}, "actor");
  expect(h.state.events[0]).toBe("lock");
  expect(h.state.events.at(-1)).toBe("commit");
});

it.each([0.0001, 1.0004, Infinity])("direct intake rejects invalid stock demand %s without persisting an order", async (qty) => {
  h.state.rows.customers.push({ id: "CUS", orgId: "ORG" });
  await expect(createDirectOrder({ customerId: "CUS", items: [{ sku: "FG", qty, rate: 10 }], transportArrangedBy: "Self" }, "actor")).rejects.toThrow(/quantity/i);
  expect(h.state.rows.orders).toHaveLength(1);
  expect(h.state.rows.orderItems).toHaveLength(1);
  expect(h.state.rows.orderActivities).toEqual([]);
});

it.each(["NaN", "0", "1.0004"])("quotation intake rejects corrupt demand %s without claiming its source", async (qty) => {
  h.state.rows.customers.push({ id: "CUS", orgId: "ORG" });
  h.state.rows.quotations.push({ id: "QUO", orgId: "ORG", status: "Accepted", orderId: "", payableAmount: "100" });
  h.state.rows.quotationItems.push({ orgId: "ORG", quotationId: "QUO", lineNo: "1", qty, rate: "10", amount: "20" });
  await expect(createOrderFromQuotation({ quotationId: "QUO", customerId: "CUS", items: [{ lineNo: "1", sku: "FG" }], transportArrangedBy: "Self" }, "actor")).rejects.toThrow(/quantity/i);
  expect(h.state.rows.quotations[0].orderId).toBe("");
  expect(h.state.rows.orders).toHaveLength(1);
  expect(h.state.rows.orderActivities).toEqual([]);
});

it("automatic top-up owns the common lock and uses remaining authoritative free stock", async () => {
  h.state.rows.orders[0].status = "Dispatch_Pending";
  h.state.free = 3;
  await recheckShortfallForSku("FG");
  expect(h.state.events[0]).toBe("lock");
  expect(h.availability).toHaveBeenCalledExactlyOnceWith();
  expect(h.state.rows.orderItems[0].reservedQty).toBe("3");
  expect(h.state.rows.orderItems[0].shortageQty).toBe("3");
});

it("automatic recheck propagates authoritative read faults instead of committing an empty view", async () => {
  h.select.mockImplementationOnce(() => ({ from: () => ({ where: async () => { throw new Error("stock read unavailable"); } }) }));
  await expect(recheckShortfallForSku("FG")).rejects.toThrow("stock read unavailable");
  expect(h.state.events).not.toContain("commit");
});

it("required shortage task failure rolls reservation and status back", async () => {
  h.state.free = 1;
  h.users.mockResolvedValueOnce([{ Status:"Active",Role:"Admin",Module_Access:[],User_ID:"ppc",Full_Name:"Planner",Phone_Number:"123" }]);
  h.tasks.mockRejectedValueOnce(new Error("task persistence failed"));
  await expect(runStockCheck("ORD", "actor")).rejects.toThrow("task persistence failed");
  expect(h.state.rows.orders[0].status).toBe("Stock_Check");
  expect(h.state.rows.orderItems[0].reservedQty).toBe("0");
  expect(h.state.rows.orderActivities).toEqual([]);
  expect(h.whatsapp).not.toHaveBeenCalled();
});

it("shortage WhatsApp is sent only after reservation and required tasks commit", async () => {
  h.state.free = 1;
  h.users.mockResolvedValueOnce([{ Status:"Active",Role:"Admin",Module_Access:[],User_ID:"ppc",Full_Name:"Planner",Phone_Number:"123" }]);
  await runStockCheck("ORD", "actor");
  expect(h.state.events.indexOf("task")).toBeLessThan(h.state.events.indexOf("commit"));
  expect(h.state.events.indexOf("whatsapp")).toBeGreaterThan(h.state.events.indexOf("commit"));
});

it("FMS successor persistence failure rolls dispatch commitment back", async () => {
  h.state.rows.orders[0].status = "Dispatch_Pending";
  h.event.mockRejectedValueOnce(new Error("FMS persistence failed"));
  await expect(commitDispatch("ORD", "2026-11-01", "actor")).rejects.toThrow("FMS persistence failed");
  expect(h.state.rows.orders[0].status).toBe("Dispatch_Pending");
  expect(h.state.rows.orderActivities).toEqual([]);
});

it("PDI timeline persistence failure rolls automatic top-up back", async () => {
  h.state.rows.orders[0].status = "Ready_For_PDI"; h.state.rows.orders[0].pdiId = "PDI";
  h.pdi.mockRejectedValueOnce(new Error("PDI persistence failed"));
  await expect(recheckShortfallForSku("FG")).rejects.toThrow("PDI persistence failed");
  expect(h.state.rows.orderItems[0].reservedQty).toBe("0");
  expect(h.state.rows.orderActivities).toEqual([]);
});

it("reservation map uses central fail-closed policy instead of swallowing unavailable reads", async () => {
  h.availability.mockRejectedValueOnce(new Error("authoritative stock unavailable"));
  await expect(orderReservedBySku()).rejects.toThrow("authoritative stock unavailable");
});

it("external payment receipt binds canonical parsed amount reference and date to the trusted actor", async () => {
  await recordPayment("ORD", {amount:10.004, mode:"Cash", reference:"  ref  ",receivedAt:"2026-01-01T05:30:00+05:30"}, "actor", "opaque-key");
  expect(h.mutation.mock.calls[0][1]).toEqual({operation:"orders.recordPayment.v1",actorId:"actor",key:"opaque-key",payload:{orderId:"ORD",amount:10,mode:"Cash",reference:"ref",receivedAt:"2026-01-01T00:00:00.000Z"}});
});

it.each(["NaN", "Infinity", "-1", "", "0"])("stock admission rejects corrupt demand %s before committing", async (qty) => {
  h.state.rows.orderItems[0].qty = qty;
  await expect(runStockCheck("ORD", "actor")).rejects.toThrow(/quantity/i);
  expect(h.state.rows.orders[0].status).toBe("Stock_Check");
  expect(h.state.rows.orderActivities).toEqual([]);
});

it.each([0.0001, 1.0004, Number.MAX_VALUE])("stock admission rejects unrepresentable demand %s", async (qty) => {
  h.state.rows.orderItems[0].qty = String(qty);
  await expect(runStockCheck("ORD", "actor")).rejects.toThrow(/quantity/i);
  expect(h.state.rows.orders[0].status).toBe("Stock_Check");
  expect(h.state.rows.orderActivities).toEqual([]);
});

it.each(["NaN", "Infinity", "-1", "7"])("stock check rejects corrupt own reservation %s before its exclusion can hide it", async (reservedQty) => {
  h.state.rows.orderItems[0].reservedQty = reservedQty;
  await expect(runStockCheck("ORD", "actor")).rejects.toThrow(/quantity/i);
  expect(h.state.rows.orderItems[0].reservedQty).toBe(reservedQty);
  expect(h.state.rows.orders[0].status).toBe("Stock_Check");
  expect(h.state.rows.orderActivities).toEqual([]);
});

it.each(["NaN", "Infinity", "-1", "7"])("stock check rejects corrupt own shortage %s instead of overwriting authoritative evidence", async (shortageQty) => {
  h.state.rows.orderItems[0].shortageQty = shortageQty;
  await expect(runStockCheck("ORD", "actor")).rejects.toThrow(/quantity/i);
  expect(h.state.rows.orderItems[0].shortageQty).toBe(shortageQty);
  expect(h.state.rows.orders[0].status).toBe("Stock_Check");
});

it("stock reallocation preserves consumed quantity without reserving it a second time", async () => {
  h.state.rows.orderItems[0].consumedQty = "2";
  h.state.rows.orderItems[0].reservedQty = "2";
  h.state.free = 3;
  await runStockCheck("ORD", "actor");
  expect(h.state.rows.orderItems[0].reservedQty).toBe("5");
  expect(h.state.rows.orderItems[0].shortageQty).toBe("1");
});

it.each(["NaN", "Infinity", "-1", "10"])("automatic top-up rejects corrupt shortage %s", async (shortage) => {
  h.state.rows.orders[0].status = "Dispatch_Pending";
  h.state.rows.orderItems[0].shortageQty = shortage;
  await expect(recheckShortfallForSku("FG")).rejects.toThrow(/quantity/i);
  expect(h.state.rows.orderItems[0].reservedQty).toBe("0");
});

it("automatic top-up cannot clear PDI while another SKU has corrupt shortage", async () => {
  h.state.rows.orders[0].status = "Ready_For_PDI";
  h.state.rows.orders[0].pdiId = "PDI";
  h.state.rows.orderItems.push({ ...h.state.rows.orderItems[0], lineNo: "2", sku: "OTHER", shortageQty: "NaN" });
  await expect(recheckShortfallForSku("FG")).rejects.toThrow(/quantity/i);
  expect(h.state.rows.orderItems[0].reservedQty).toBe("0");
  expect(h.state.rows.orderActivities).toEqual([]);
  expect(h.pdi).not.toHaveBeenCalled();
});

// Preservation regressions for the interrupted per-payment implementation.
it("GL failure leaves neither payment nor payment activity", async () => {
  h.journal.mockRejectedValueOnce(new Error("GL failed"));
  await expect(recordPayment("ORD", {amount:10,mode:"Cash"}, "actor")).rejects.toThrow("GL failed");
  expect(h.state.rows.orderPayments).toEqual([]);
  expect(h.state.rows.orderActivities).toEqual([]);
});
it("equal-valued installments have independent immutable payment journal sources", async () => {
  await recordPayment("ORD", {amount:10,mode:"Cash"}, "actor");
  await recordPayment("ORD", {amount:10,mode:"Cash"}, "actor");
  expect(h.state.rows.orderPayments).toHaveLength(2);
  expect(h.state.rows.journals.map((row) => row.sourceId)).toEqual(h.state.rows.orderPayments.map((row) => row.id));
  expect(new Set(h.state.rows.journals.map((row) => row.sourceId)).size).toBe(2);
});
it("internal credit-note payment joins active transaction without nested durable receipt", async () => {
  await h.transaction("ORG", async () => recordPayment("ORD", {amount:10,mode:"Credit_Note"}, "actor"));
  expect(h.mutation).not.toHaveBeenCalled();
  expect(h.state.events.filter((event) => event === "lock")).toHaveLength(1);
  expect(h.state.rows.journals[0].lines).toEqual([{accountCode:"CC",debit:10},{accountCode:"AR",credit:10}]);
});
it.each([NaN, Infinity, -Infinity, 0, -1, 0.001])("payment rejects invalid effective amount %s before any writes", async (amount) => {
  await expect(recordPayment("ORD", {amount,mode:"Cash"}, "actor")).rejects.toThrow();
  expect(h.state.rows.orderPayments).toEqual([]);
  expect(h.journal).not.toHaveBeenCalled();
});
it("cancelled order cannot accept a payment", async () => {
  h.state.rows.orders[0].status = "Cancelled";
  await expect(recordPayment("ORD", {amount:10,mode:"Cash"}, "actor")).rejects.toThrow(/Cancelled/);
  expect(h.journal).not.toHaveBeenCalled();
});
it("required reservation activity failure rolls all line writes and status back", async () => {
  h.insert.mockRejectedValueOnce(new Error("activity failed"));
  await expect(runStockCheck("ORD", "actor")).rejects.toThrow("activity failed");
  expect(h.state.rows.orderItems[0].reservedQty).toBe("0");
  expect(h.state.rows.orders[0].status).toBe("Stock_Check");
});
it("central availability error stops reservation without a success transition", async () => {
  h.availability.mockRejectedValueOnce(new Error("availability failed"));
  await expect(runStockCheck("ORD", "actor")).rejects.toThrow("availability failed");
  expect(h.state.rows.orderItems[0].reservedQty).toBe("0");
});

it("vendor debit-note mode is rejected at the order payment boundary", async () => {
  await expect(recordPayment("ORD", {amount:10,mode:"Debit_Note"}, "actor")).rejects.toThrow(/mode/i);
  expect(h.state.rows.orderPayments).toEqual([]);
});

beforeEach(() => {
  vi.clearAllMocks();
  h.state.active = false; h.state.events = []; h.state.effects = []; h.state.sequence = 0; h.state.free = 10;
  h.state.rows = Object.fromEntries([...Object.keys(h.tables), "journals"].map((name) => [name, []]));
  h.state.rows.orders.push({ id: "ORD", orgId: "ORG", status: "Stock_Check", source: "Direct", transportArrangedBy: null, customerId: "CUS", orderValue: "100", gstPercent: "18", gstAmount: "18", createdAt: new Date("2026-01-01"), creditApprovedAt: null, dispatchCommitDate: null,
    ...Object.fromEntries(["leadId", "quotationId", "partyName", "contactPerson", "customerMobile", "customerEmail", "customerGst", "billingAddress", "billingCity", "billingState", "billingPincode", "shippingPartyName", "shippingContactPerson", "shippingAddress", "shippingCity", "shippingState", "shippingPincode", "poAttachmentUrl", "creditApprovedBy", "createdBy", "pdiId"].map((key) => [key, ""])) });
  h.state.rows.orderItems.push({ orgId: "ORG", orderId: "ORD", lineNo: "1", sku: "FG", itemName: "Finished", uom: "PCS", qty: "6", rate: "10", amount: "60", reservedQty: "0", shortageQty: "6", consumedQty: "0" });
});
it("cancellation reads and releases reservations only after tenant lock admission", async () => {
  const result = await cancelOrder("ORD", "no longer needed", "actor");
  expect(result.status).toBe("Cancelled");
  expect(h.state.events[0]).toBe("lock");
  expect(h.state.events.at(-1)).toBe("commit");
});
it("stock check allocates duplicate SKU lines from one authoritative locked pool excluding only itself", async () => {
  h.state.rows.orderItems.push({ ...h.state.rows.orderItems[0], lineNo: "2" });
  await runStockCheck("ORD", "actor");
  expect(h.state.events[0]).toBe("lock");
  expect(h.availability).toHaveBeenCalledExactlyOnceWith({ excludeOrderId: "ORD" });
  expect(h.state.rows.orderItems.map((row) => row.reservedQty)).toEqual(["6", "4"]);
  expect(h.state.rows.orderItems.map((row) => row.shortageQty)).toEqual(["0", "2"]);
});
