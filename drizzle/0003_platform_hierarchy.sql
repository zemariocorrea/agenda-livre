CREATE TABLE `platform_admins` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_admins_email_unique` ON `platform_admins` (`email`);--> statement-breakpoint
CREATE INDEX `platform_admins_email_idx` ON `platform_admins` (`email`,`is_active`);--> statement-breakpoint
ALTER TABLE `tenants` ADD `contact_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `plan` text DEFAULT 'essential' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `max_professionals` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `brand_color` text DEFAULT '#17624f' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `hero_title` text DEFAULT 'Seu cuidado começa com um horário só seu.' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `hero_description` text DEFAULT 'Escolha o atendimento, encontre o melhor horário e confirme em poucos passos.' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `custom_domain` text;
--> statement-breakpoint
INSERT INTO `platform_admins` (`id`, `email`, `display_name`)
VALUES ('platform_admin_seed', 'master@agenda-livre.example', 'Administrador Master');
--> statement-breakpoint
UPDATE `tenants`
SET `contact_email` = COALESCE((
  SELECT member.`email` FROM `tenant_members` AS member
  WHERE member.`tenant_id` = `tenants`.`id` AND member.`role` = 'owner'
  ORDER BY member.`created_at` LIMIT 1
), '')
WHERE `contact_email` = '';
