ALTER TABLE `tenants` ADD `payment_enabled` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `tenants` ADD `pix_enabled` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `tenants` ADD `pay_on_site_enabled` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `tenants` ADD `contact_for_payment_enabled` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `tenants` ADD `pix_key` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tenants` ADD `pix_key_type` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tenants` ADD `pix_holder_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tenants` ADD `require_payment_to_confirm` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `services` ADD `payment_type` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE `services` ADD `deposit_amount_cents` integer;
--> statement-breakpoint
ALTER TABLE `appointments` ADD `payment_method` text;
--> statement-breakpoint
ALTER TABLE `appointments` ADD `payment_amount_cents` integer;
--> statement-breakpoint
ALTER TABLE `appointments` ADD `payment_proof_key` text;
--> statement-breakpoint
ALTER TABLE `appointments` ADD `payment_confirmed_at` text;
--> statement-breakpoint
ALTER TABLE `appointments` ADD `payment_confirmed_by` text REFERENCES `users`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `appointments_tenant_payment_status_idx` ON `appointments` (`tenant_id`,`payment_status`,`starts_at_utc`);
