CREATE INDEX "plan_materials_org_id_plan_id_idx" ON "plan_materials" USING btree ("org_id","plan_id");--> statement-breakpoint
CREATE INDEX "production_plans_org_id_status_idx" ON "production_plans" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_org_id_po_id_idx" ON "purchase_order_lines" USING btree ("org_id","po_id");--> statement-breakpoint
CREATE INDEX "orders_org_id_customer_id_idx" ON "orders" USING btree ("org_id","customer_id");--> statement-breakpoint
CREATE INDEX "bills_org_id_status_idx" ON "bills" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "bills_org_id_vendor_id_idx" ON "bills" USING btree ("org_id","vendor_id","status");--> statement-breakpoint
CREATE INDEX "invoices_org_id_status_idx" ON "invoices" USING btree ("org_id","status","issued_at");