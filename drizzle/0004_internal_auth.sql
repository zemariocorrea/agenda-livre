CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`failed_login_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_login_at` text,
	`password_changed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
CREATE INDEX `users_email_active_idx` ON `users` (`email`,`is_active`);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_token_hash_unique` ON `auth_sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_idx` ON `auth_sessions` (`expires_at`);
--> statement-breakpoint
ALTER TABLE `platform_admins` ADD `user_id` text REFERENCES users(id) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `tenant_members` ADD `user_id` text REFERENCES users(id) ON DELETE set null;
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_admins_user_uq` ON `platform_admins` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_members_tenant_user_uq` ON `tenant_members` (`tenant_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `tenant_members_user_idx` ON `tenant_members` (`user_id`);
