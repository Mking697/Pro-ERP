import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Explicit disposable target only. No dotenv, DATABASE_URL or production fallback.
const container = process.env.BILLING_QA_CONTAINER;
if (container !== "pro-erp-billing-qa-20261021") throw new Error("Set BILLING_QA_CONTAINER to the task-owned network-isolated QA container.");
const args = ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "pro_erp_billing_qa", "-v", "ON_ERROR_STOP=1", "-At"];
function sql(input) {
  const result = spawnSync("docker", args, { input, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "psql failed");
  return result.stdout.trim();
}
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
for (const entry of journal.entries) sql(readFileSync(`drizzle/${entry.tag}.sql`, "utf8"));
console.log("PASS: all checked-in migration SQL applies to an empty isolated PostgreSQL database");
sql(`INSERT INTO organizations(id,org_name,slug,owner_email) VALUES ('BILL-QA-A','QA A','bill-qa-a','a@example.test'),('BILL-QA-B','QA B','bill-qa-b','b@example.test');
INSERT INTO billing_subscription_attempts(id,org_id,plan,cycle,amount_paise,currency,key_id,provider_id) VALUES ('attempt-a','BILL-QA-A','Starter','Monthly',299900,'INR','fixture','sub_qa');`);
sql(`DO $$ BEGIN
 BEGIN INSERT INTO billing_subscription_attempts(id,org_id,plan,cycle,amount_paise,currency,key_id) VALUES ('duplicate','BILL-QA-A','Starter','Monthly',299900,'INR','fixture'); RAISE EXCEPTION 'open-attempt uniqueness failed'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN INSERT INTO billing_subscription_attempts(id,org_id,plan,cycle,amount_paise,currency,key_id,provider_id) VALUES ('duplicate-provider','BILL-QA-B','Starter','Monthly',299900,'INR','fixture','sub_qa'); RAISE EXCEPTION 'provider uniqueness failed'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;`);
console.log("PASS: PostgreSQL rejects competing open attempts and duplicate provider identities");
sql(`INSERT INTO billing_subscription_charges(payment_id,attempt_id,paid_through) VALUES ('pay_qa','attempt-a',now()+interval '1 month');
DO $$ BEGIN
 BEGIN INSERT INTO billing_subscription_charges(payment_id,attempt_id,paid_through) VALUES ('pay_qa','attempt-a',now()+interval '2 months'); RAISE EXCEPTION 'receipt uniqueness failed'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
BEGIN;
INSERT INTO billing_subscription_charges(payment_id,attempt_id,paid_through) VALUES ('pay_rollback','attempt-a',now());
UPDATE organizations SET plan='Growth' WHERE id='BILL-QA-A';
ROLLBACK;`);
assert.equal(sql("SELECT count(*) FROM billing_subscription_charges WHERE payment_id='pay_rollback'"), "0");
assert.equal(sql("SELECT plan FROM organizations WHERE id='BILL-QA-A'"), "Trial");
console.log("PASS: receipt uniqueness and entitlement/receipt rollback persist correctly");
// Same advisory-lock primitive as db/client.ts, exercised on two real connections.
const held = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
let out = "";
held.stdout.on("data", b => { out += b.toString(); });
held.stdin.end("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('BILL-QA-A',0)); SELECT 'LOCK_HELD'; SELECT pg_sleep(2); COMMIT;");
const done = new Promise((resolve, reject) => { held.on("error", reject); held.on("exit", code => code === 0 ? resolve() : reject(new Error("lock holder failed"))); });
for (let tries = 0; !out.includes("LOCK_HELD") && tries < 50; tries++) await delay(50);
assert.ok(out.includes("LOCK_HELD"), "first connection owns lock");
const start = Date.now();
sql("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('BILL-QA-A',0)); COMMIT;");
assert.ok(Date.now() - start >= 1000, "competing connection must wait for the tenant lock");
await done;
console.log("PASS: two real PostgreSQL connections serialize on the tenant advisory lock");
sql(`BEGIN;
DELETE FROM billing_subscription_charges WHERE attempt_id IN (SELECT id FROM billing_subscription_attempts WHERE org_id='BILL-QA-A');
DELETE FROM billing_subscription_attempts WHERE org_id='BILL-QA-A';
DELETE FROM organizations WHERE id='BILL-QA-A';
COMMIT;`);
assert.equal(sql("SELECT count(*) FROM billing_subscription_charges"), "0");
assert.equal(sql("SELECT count(*) FROM organizations WHERE id='BILL-QA-B'"), "1");
console.log("PASS: org-scoped child-first cleanup removes billing rows and preserves the other org");
console.log("Scope: real SQL constraints/locks/rollback, not application-driver or real-provider payment acceptance.");
