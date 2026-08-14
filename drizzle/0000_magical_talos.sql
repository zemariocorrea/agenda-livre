CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`service_id` text NOT NULL,
	`member_id` text,
	`customer_name` text NOT NULL,
	`customer_email` text NOT NULL,
	`customer_phone` text NOT NULL,
	`customer_notes` text DEFAULT '' NOT NULL,
	`starts_at_utc` text NOT NULL,
	`ends_at_utc` text NOT NULL,
	`timezone` text NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`payment_preference` text DEFAULT 'at_venue' NOT NULL,
	`payment_status` text DEFAULT 'not_required' NOT NULL,
	`public_token` text NOT NULL,
	`google_event_id` text,
	`cancelled_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`member_id`) REFERENCES `tenant_members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_public_token_unique` ON `appointments` (`public_token`);--> statement-breakpoint
CREATE INDEX `appointments_tenant_start_idx` ON `appointments` (`tenant_id`,`starts_at_utc`);--> statement-breakpoint
CREATE INDEX `appointments_member_window_idx` ON `appointments` (`member_id`,`starts_at_utc`,`ends_at_utc`);--> statement-breakpoint
CREATE INDEX `appointments_customer_email_idx` ON `appointments` (`tenant_id`,`customer_email`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_tenant_created_idx` ON `audit_log` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `availability_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`member_id` text,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`slot_interval_minutes` integer DEFAULT 30 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `tenant_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `availability_tenant_weekday_idx` ON `availability_rules` (`tenant_id`,`weekday`,`is_active`);--> statement-breakpoint
CREATE TABLE `blocked_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`member_id` text,
	`starts_at_utc` text NOT NULL,
	`ends_at_utc` text NOT NULL,
	`reason` text DEFAULT 'Bloqueio manual' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `tenant_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blocked_periods_window_idx` ON `blocked_periods` (`tenant_id`,`starts_at_utc`,`ends_at_utc`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`resource_id` text NOT NULL,
	`response_json` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_tenant_scope_key_uq` ON `idempotency_keys` (`tenant_id`,`scope`,`key`);--> statement-breakpoint
CREATE TABLE `integration_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`external_account_id` text,
	`encrypted_credentials` text,
	`configuration_json` text DEFAULT '{}' NOT NULL,
	`last_synced_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_tenant_provider_uq` ON `integration_connections` (`tenant_id`,`provider`);--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`channel` text NOT NULL,
	`recipient` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider_reference` text,
	`sent_at` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_appointment_idx` ON `notification_deliveries` (`appointment_id`,`channel`);--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`available_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`processed_at` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outbox_dispatch_idx` ON `outbox_events` (`status`,`available_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`provider` text DEFAULT 'stripe' NOT NULL,
	`provider_reference` text,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'BRL' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`checkout_url` text,
	`paid_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_reference_uq` ON `payments` (`provider`,`provider_reference`);--> statement-breakpoint
CREATE INDEX `payments_appointment_idx` ON `payments` (`appointment_id`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`duration_minutes` integer NOT NULL,
	`buffer_before_minutes` integer DEFAULT 0 NOT NULL,
	`buffer_after_minutes` integer DEFAULT 0 NOT NULL,
	`price_cents` integer DEFAULT 0 NOT NULL,
	`color` text DEFAULT '#17624f' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `services_tenant_active_idx` ON `services` (`tenant_id`,`is_active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `tenant_members` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'staff' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_members_tenant_email_uq` ON `tenant_members` (`tenant_id`,`email`);--> statement-breakpoint
CREATE INDEX `tenant_members_email_idx` ON `tenant_members` (`email`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`subtitle` text DEFAULT '' NOT NULL,
	`timezone` text DEFAULT 'America/Sao_Paulo' NOT NULL,
	`currency` text DEFAULT 'BRL' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_unique` ON `tenants` (`slug`);
--> statement-breakpoint
CREATE TRIGGER `appointments_prevent_overlap`
BEFORE INSERT ON `appointments`
WHEN NEW.status IN ('pending', 'confirmed')
BEGIN
  SELECT RAISE(ABORT, 'APPOINTMENT_CONFLICT')
  WHERE EXISTS (
    SELECT 1
    FROM appointments AS existing
    WHERE existing.tenant_id = NEW.tenant_id
      AND (
        existing.member_id = NEW.member_id
        OR (existing.member_id IS NULL AND NEW.member_id IS NULL)
      )
      AND existing.status IN ('pending', 'confirmed')
      AND existing.starts_at_utc < NEW.ends_at_utc
      AND existing.ends_at_utc > NEW.starts_at_utc
  );
END;
--> statement-breakpoint
CREATE TRIGGER `appointments_respect_blocks`
BEFORE INSERT ON `appointments`
WHEN NEW.status IN ('pending', 'confirmed')
BEGIN
  SELECT RAISE(ABORT, 'BLOCKED_PERIOD_CONFLICT')
  WHERE EXISTS (
    SELECT 1
    FROM blocked_periods AS blocked
    WHERE blocked.tenant_id = NEW.tenant_id
      AND (blocked.member_id IS NULL OR blocked.member_id = NEW.member_id)
      AND blocked.starts_at_utc < NEW.ends_at_utc
      AND blocked.ends_at_utc > NEW.starts_at_utc
  );
END;
--> statement-breakpoint
INSERT INTO `tenants` (`id`, `slug`, `name`, `subtitle`, `timezone`, `currency`, `location`)
VALUES ('tenant_clinica_aurora', 'clinica-aurora', 'Clínica Aurora', 'Saúde & bem-estar', 'America/Sao_Paulo', 'BRL', 'Curitiba · PR');
--> statement-breakpoint
INSERT INTO `tenant_members` (`id`, `tenant_id`, `email`, `display_name`, `role`)
VALUES ('member_aurora_owner', 'tenant_clinica_aurora', 'gestor@clinicaaurora.example', 'Marina Costa', 'owner');
--> statement-breakpoint
INSERT INTO `services` (`id`, `tenant_id`, `name`, `description`, `duration_minutes`, `price_cents`, `sort_order`)
VALUES
  ('service_avaliacao', 'tenant_clinica_aurora', 'Avaliação inicial', 'Uma conversa cuidadosa para entender suas necessidades.', 45, 12000, 1),
  ('service_terapia', 'tenant_clinica_aurora', 'Sessão terapêutica', 'Atendimento individual, acolhedor e personalizado.', 60, 18000, 2),
  ('service_retorno', 'tenant_clinica_aurora', 'Consulta de retorno', 'Acompanhamento da sua evolução e próximos passos.', 30, 9000, 3);
--> statement-breakpoint
INSERT INTO `availability_rules` (`id`, `tenant_id`, `member_id`, `weekday`, `start_time`, `end_time`, `slot_interval_minutes`)
VALUES
  ('availability_mon', 'tenant_clinica_aurora', 'member_aurora_owner', 1, '08:30', '17:30', 30),
  ('availability_tue', 'tenant_clinica_aurora', 'member_aurora_owner', 2, '08:30', '17:30', 30),
  ('availability_wed', 'tenant_clinica_aurora', 'member_aurora_owner', 3, '08:30', '17:30', 30),
  ('availability_thu', 'tenant_clinica_aurora', 'member_aurora_owner', 4, '08:30', '17:30', 30),
  ('availability_fri', 'tenant_clinica_aurora', 'member_aurora_owner', 5, '08:30', '17:30', 30);
