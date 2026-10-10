import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { tasks } from "@/db/schema/tasks";
import { payslips } from "@/db/schema/payroll";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";

const snapshot = JSON.parse(readFileSync("drizzle/meta/0032_snapshot.json", "utf8"));
const migration = readFileSync("drizzle/0032_faulty_mariko_yashida.sql", "utf8");

describe("0032 honest legacy cycle identity", () => {
  it("matches Drizzle's DB-free schema serialization and exact 0031-to-0032 generated SQL", async () => {
    const previous = JSON.parse(readFileSync("drizzle/meta/0031_snapshot.json", "utf8"));
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    const generated = generateDrizzleJson({ tasks, payslips }, previous.id);
    expect(snapshot.prevId).toBe(previous.id);
    expect(journal.entries.at(-1).tag).toBe("0032_faulty_mariko_yashida");
    expect(snapshot.tables["public.tasks"]).toEqual(generated.tables["public.tasks"]);
    expect(snapshot.tables["public.payslips"]).toEqual(generated.tables["public.payslips"]);
    const statements = await generateMigration(previous, snapshot);
    expect(statements).toHaveLength(3);
    expect(migration).toBe(statements.join("--> statement-breakpoint\n"));
    for (const [name, table] of Object.entries(previous.tables)) {
      if (name !== "public.tasks" && name !== "public.payslips") {
        expect(snapshot.tables[name]).toEqual(table);
      }
    }
  });
  it("leaves multiple historical occurrences unknown instead of assigning an empty shared key", () => {
    expect(tasks.naturalCycleStartDate.getSQLType()).toBe("date");
    expect(tasks.naturalCycleStartDate.notNull).toBe(false);
    expect(tasks.naturalCycleStartDate.hasDefault).toBe(false);
    expect(snapshot.tables["public.tasks"].columns.natural_cycle_start_date).toEqual({
      name: "natural_cycle_start_date", type: "date", primaryKey: false, notNull: false,
    });
    expect(migration).toContain('ADD COLUMN "natural_cycle_start_date" date;');
    expect(migration).not.toMatch(/UPDATE\s+"?tasks|natural_cycle_start_date[^;]*DEFAULT/i);
  });

  it("limits natural identity uniqueness to known recurring cycles, retaining the old same-day guard", () => {
    const indexes = getTableConfig(tasks).indexes;
    const natural = indexes.find((index) => index.config.name === "tasks_org_id_recurring_id_natural_cycle_unique")!;
    const predicate = new PgDialect().sqlToQuery(natural.config.where!).sql;
    expect(predicate).toBe('"tasks"."recurring_id" <> \'\' and "tasks"."natural_cycle_start_date" is not null');
    expect(snapshot.tables["public.tasks"].indexes["tasks_org_id_recurring_id_natural_cycle_unique"].where).toBe(predicate);
    expect(migration).toContain(`WHERE ${predicate};`);
    expect(indexes.some((index) => index.config.name === "tasks_org_id_recurring_id_due_date_unique")).toBe(true);
  });
});
