ALTER TABLE "invoices" DROP CONSTRAINT "invoices_org_id_order_id_unique";--> statement-breakpoint
CREATE INDEX "invoices_org_id_order_id_idx" ON "invoices" USING btree ("org_id","order_id");