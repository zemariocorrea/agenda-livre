PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`professional_id` text,
	`provider` text NOT NULL,
	`state_hash` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`professional_id`) REFERENCES `professionals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_oauth_states`("id", "tenant_id", "professional_id", "provider", "state_hash", "redirect_uri", "expires_at", "consumed_at", "created_at") SELECT "id", "tenant_id", "professional_id", "provider", "state_hash", "redirect_uri", "expires_at", "consumed_at", "created_at" FROM `oauth_states`;--> statement-breakpoint
DROP TABLE `oauth_states`;--> statement-breakpoint
ALTER TABLE `__new_oauth_states` RENAME TO `oauth_states`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_states_state_hash_unique` ON `oauth_states` (`state_hash`);--> statement-breakpoint
CREATE INDEX `oauth_states_lookup_idx` ON `oauth_states` (`provider`,`state_hash`,`expires_at`);--> statement-breakpoint
ALTER TABLE `tenants` ADD `secondary_color` text DEFAULT '#f2ac72' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `logo_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `cover_image_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `site_template` text DEFAULT 'modern' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `promotion_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `promotion_title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `promotion_description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `promotion_image_url` text DEFAULT '' NOT NULL;