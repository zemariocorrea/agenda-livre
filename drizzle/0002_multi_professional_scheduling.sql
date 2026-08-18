CREATE TABLE `professional_services` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`professional_id` text NOT NULL,
	`service_id` text NOT NULL,
	`duration_minutes` integer,
	`buffer_before_minutes` integer,
	`buffer_after_minutes` integer,
	`price_cents` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`professional_id`) REFERENCES `professionals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `professional_services_professional_service_uq` ON `professional_services` (`professional_id`,`service_id`);--> statement-breakpoint
CREATE INDEX `professional_services_tenant_service_idx` ON `professional_services` (`tenant_id`,`service_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `professionals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`member_id` text,
	`name` text NOT NULL,
	`title` text DEFAULT 'Profissional' NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#17624f' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `tenant_members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `professionals_tenant_member_uq` ON `professionals` (`tenant_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `professionals_tenant_active_idx` ON `professionals` (`tenant_id`,`is_active`,`sort_order`);--> statement-breakpoint
DROP INDEX `integration_tenant_provider_uq`;--> statement-breakpoint
ALTER TABLE `integration_connections` ADD `professional_id` text REFERENCES professionals(id);--> statement-breakpoint
CREATE UNIQUE INDEX `integration_tenant_provider_professional_uq` ON `integration_connections` (`tenant_id`,`provider`,`professional_id`);--> statement-breakpoint
CREATE INDEX `integration_professional_idx` ON `integration_connections` (`professional_id`,`provider`);--> statement-breakpoint
ALTER TABLE `appointments` ADD `professional_id` text REFERENCES professionals(id);--> statement-breakpoint
ALTER TABLE `appointments` ADD `busy_starts_at_utc` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `busy_ends_at_utc` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `duration_minutes` integer;--> statement-breakpoint
ALTER TABLE `appointments` ADD `buffer_before_minutes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `appointments` ADD `buffer_after_minutes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `appointments` ADD `price_cents` integer;--> statement-breakpoint
CREATE INDEX `appointments_professional_window_idx` ON `appointments` (`professional_id`,`busy_starts_at_utc`,`busy_ends_at_utc`);--> statement-breakpoint
ALTER TABLE `availability_rules` ADD `professional_id` text REFERENCES professionals(id);--> statement-breakpoint
CREATE INDEX `availability_professional_weekday_idx` ON `availability_rules` (`professional_id`,`weekday`,`is_active`);--> statement-breakpoint
ALTER TABLE `blocked_periods` ADD `professional_id` text REFERENCES professionals(id);--> statement-breakpoint
CREATE INDEX `blocked_periods_professional_window_idx` ON `blocked_periods` (`professional_id`,`starts_at_utc`,`ends_at_utc`);--> statement-breakpoint
ALTER TABLE `oauth_states` ADD `professional_id` text REFERENCES professionals(id);--> statement-breakpoint

-- Converte cada responsável existente em um profissional sem misturar login e agenda.
INSERT INTO `professionals` (`id`, `tenant_id`, `member_id`, `name`, `title`, `email`, `color`, `is_active`, `sort_order`)
SELECT 'professional_' || `id`, `tenant_id`, `id`, `display_name`, 'Profissional', `email`, '#17624f', `is_active`, 0
FROM `tenant_members`;--> statement-breakpoint

-- Garante uma agenda para tenants legados que não possuam membro cadastrado.
INSERT INTO `professionals` (`id`, `tenant_id`, `name`, `title`, `color`, `is_active`, `sort_order`)
SELECT 'professional_default_' || `id`, `id`, `name` || ' · Agenda', 'Profissional', '#17624f', 1, 0
FROM `tenants` AS tenant
WHERE NOT EXISTS (
  SELECT 1 FROM `professionals` AS professional WHERE professional.`tenant_id` = tenant.`id`
);--> statement-breakpoint

-- Equipe demonstrativa da Clínica Aurora para validar o cenário N:N.
INSERT INTO `professionals` (`id`, `tenant_id`, `name`, `title`, `bio`, `email`, `color`, `is_active`, `sort_order`)
VALUES
  ('professional_aurora_helena', 'tenant_clinica_aurora', 'Helena Souza', 'Psicóloga clínica', 'Atendimento acolhedor para adultos e adolescentes.', 'helena@clinicaaurora.example', '#8d6e63', 1, 2),
  ('professional_aurora_rafael', 'tenant_clinica_aurora', 'Rafael Mendes', 'Terapeuta', 'Cuidado individual com foco em bem-estar e continuidade.', 'rafael@clinicaaurora.example', '#3f7c70', 1, 3);--> statement-breakpoint

-- Preserva o comportamento legado: todos os profissionais existentes começam habilitados
-- para todas as atividades da própria empresa. O painel permite ajustar os vínculos.
INSERT INTO `professional_services` (`id`, `tenant_id`, `professional_id`, `service_id`)
SELECT 'professional_service_' || professional.`id` || '_' || service.`id`, professional.`tenant_id`, professional.`id`, service.`id`
FROM `professionals` AS professional
INNER JOIN `services` AS service ON service.`tenant_id` = professional.`tenant_id`;--> statement-breakpoint

UPDATE `availability_rules`
SET `professional_id` = COALESCE(
  (SELECT professional.`id` FROM `professionals` AS professional WHERE professional.`member_id` = `availability_rules`.`member_id` AND professional.`tenant_id` = `availability_rules`.`tenant_id` LIMIT 1),
  (SELECT professional.`id` FROM `professionals` AS professional WHERE professional.`tenant_id` = `availability_rules`.`tenant_id` AND professional.`is_active` = 1 ORDER BY professional.`sort_order`, professional.`name` LIMIT 1)
);--> statement-breakpoint

UPDATE `blocked_periods`
SET `professional_id` = (
  SELECT professional.`id` FROM `professionals` AS professional
  WHERE professional.`member_id` = `blocked_periods`.`member_id`
    AND professional.`tenant_id` = `blocked_periods`.`tenant_id`
  LIMIT 1
)
WHERE `member_id` IS NOT NULL;--> statement-breakpoint

UPDATE `appointments`
SET
  `professional_id` = COALESCE(
    (SELECT professional.`id` FROM `professionals` AS professional WHERE professional.`member_id` = `appointments`.`member_id` AND professional.`tenant_id` = `appointments`.`tenant_id` LIMIT 1),
    (SELECT professional.`id` FROM `professionals` AS professional WHERE professional.`tenant_id` = `appointments`.`tenant_id` ORDER BY professional.`sort_order`, professional.`name` LIMIT 1)
  ),
  `duration_minutes` = (SELECT service.`duration_minutes` FROM `services` AS service WHERE service.`id` = `appointments`.`service_id`),
  `buffer_before_minutes` = COALESCE((SELECT service.`buffer_before_minutes` FROM `services` AS service WHERE service.`id` = `appointments`.`service_id`), 0),
  `buffer_after_minutes` = COALESCE((SELECT service.`buffer_after_minutes` FROM `services` AS service WHERE service.`id` = `appointments`.`service_id`), 0),
  `price_cents` = (SELECT service.`price_cents` FROM `services` AS service WHERE service.`id` = `appointments`.`service_id`),
  `busy_starts_at_utc` = strftime('%Y-%m-%dT%H:%M:%fZ', `starts_at_utc`, '-' || COALESCE((SELECT service.`buffer_before_minutes` FROM `services` AS service WHERE service.`id` = `appointments`.`service_id`), 0) || ' minutes'),
  `busy_ends_at_utc` = strftime('%Y-%m-%dT%H:%M:%fZ', `ends_at_utc`, '+' || COALESCE((SELECT service.`buffer_after_minutes` FROM `services` AS service WHERE service.`id` = `appointments`.`service_id`), 0) || ' minutes');--> statement-breakpoint

UPDATE `integration_connections`
SET `professional_id` = (
  SELECT professional.`id` FROM `professionals` AS professional
  WHERE professional.`tenant_id` = `integration_connections`.`tenant_id`
  ORDER BY professional.`sort_order`, professional.`name`
  LIMIT 1
)
WHERE `provider` = 'google_calendar' AND `professional_id` IS NULL;--> statement-breakpoint

UPDATE `oauth_states`
SET `professional_id` = (
  SELECT professional.`id` FROM `professionals` AS professional
  WHERE professional.`tenant_id` = `oauth_states`.`tenant_id`
  ORDER BY professional.`sort_order`, professional.`name`
  LIMIT 1
)
WHERE `provider` = 'google_calendar' AND `professional_id` IS NULL;--> statement-breakpoint

INSERT INTO `availability_rules` (`id`, `tenant_id`, `professional_id`, `weekday`, `start_time`, `end_time`, `slot_interval_minutes`)
VALUES
  ('availability_helena_tue', 'tenant_clinica_aurora', 'professional_aurora_helena', 2, '10:00', '19:00', 30),
  ('availability_helena_wed', 'tenant_clinica_aurora', 'professional_aurora_helena', 3, '10:00', '19:00', 30),
  ('availability_helena_thu', 'tenant_clinica_aurora', 'professional_aurora_helena', 4, '10:00', '19:00', 30),
  ('availability_helena_fri', 'tenant_clinica_aurora', 'professional_aurora_helena', 5, '10:00', '18:00', 30),
  ('availability_rafael_mon', 'tenant_clinica_aurora', 'professional_aurora_rafael', 1, '07:30', '16:30', 30),
  ('availability_rafael_tue', 'tenant_clinica_aurora', 'professional_aurora_rafael', 2, '07:30', '16:30', 30),
  ('availability_rafael_thu', 'tenant_clinica_aurora', 'professional_aurora_rafael', 4, '07:30', '16:30', 30),
  ('availability_rafael_fri', 'tenant_clinica_aurora', 'professional_aurora_rafael', 5, '07:30', '16:30', 30);--> statement-breakpoint

DROP TRIGGER `appointments_prevent_overlap`;--> statement-breakpoint
DROP TRIGGER `appointments_respect_blocks`;--> statement-breakpoint

CREATE TRIGGER `professional_services_validate_tenant_insert`
BEFORE INSERT ON `professional_services`
BEGIN
  SELECT RAISE(ABORT, 'TENANT_SCOPE_VIOLATION')
  WHERE NOT EXISTS (SELECT 1 FROM `professionals` WHERE `id` = NEW.`professional_id` AND `tenant_id` = NEW.`tenant_id`)
     OR NOT EXISTS (SELECT 1 FROM `services` WHERE `id` = NEW.`service_id` AND `tenant_id` = NEW.`tenant_id`);
END;--> statement-breakpoint

CREATE TRIGGER `professional_services_validate_tenant_update`
BEFORE UPDATE OF `tenant_id`, `professional_id`, `service_id` ON `professional_services`
BEGIN
  SELECT RAISE(ABORT, 'TENANT_SCOPE_VIOLATION')
  WHERE NOT EXISTS (SELECT 1 FROM `professionals` WHERE `id` = NEW.`professional_id` AND `tenant_id` = NEW.`tenant_id`)
     OR NOT EXISTS (SELECT 1 FROM `services` WHERE `id` = NEW.`service_id` AND `tenant_id` = NEW.`tenant_id`);
END;--> statement-breakpoint

CREATE TRIGGER `availability_validate_professional_insert`
BEFORE INSERT ON `availability_rules`
BEGIN
  SELECT RAISE(ABORT, 'PROFESSIONAL_REQUIRED') WHERE NEW.`professional_id` IS NULL;
  SELECT RAISE(ABORT, 'TENANT_SCOPE_VIOLATION')
  WHERE NOT EXISTS (SELECT 1 FROM `professionals` WHERE `id` = NEW.`professional_id` AND `tenant_id` = NEW.`tenant_id`);
END;--> statement-breakpoint

CREATE TRIGGER `availability_validate_professional_update`
BEFORE UPDATE OF `tenant_id`, `professional_id` ON `availability_rules`
BEGIN
  SELECT RAISE(ABORT, 'PROFESSIONAL_REQUIRED') WHERE NEW.`professional_id` IS NULL;
  SELECT RAISE(ABORT, 'TENANT_SCOPE_VIOLATION')
  WHERE NOT EXISTS (SELECT 1 FROM `professionals` WHERE `id` = NEW.`professional_id` AND `tenant_id` = NEW.`tenant_id`);
END;--> statement-breakpoint

CREATE TRIGGER `blocked_periods_validate_professional_insert`
BEFORE INSERT ON `blocked_periods`
WHEN NEW.`professional_id` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_SCOPE_VIOLATION')
  WHERE NOT EXISTS (SELECT 1 FROM `professionals` WHERE `id` = NEW.`professional_id` AND `tenant_id` = NEW.`tenant_id`);
END;--> statement-breakpoint

CREATE TRIGGER `blocked_periods_validate_professional_update`
BEFORE UPDATE OF `tenant_id`, `professional_id` ON `blocked_periods`
WHEN NEW.`professional_id` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_SCOPE_VIOLATION')
  WHERE NOT EXISTS (SELECT 1 FROM `professionals` WHERE `id` = NEW.`professional_id` AND `tenant_id` = NEW.`tenant_id`);
END;--> statement-breakpoint

CREATE TRIGGER `integration_connections_validate_professional_insert`
BEFORE INSERT ON `integration_connections`
WHEN NEW.`professional_id` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_SCOPE_VIOLATION')
  WHERE NOT EXISTS (SELECT 1 FROM `professionals` WHERE `id` = NEW.`professional_id` AND `tenant_id` = NEW.`tenant_id`);
END;--> statement-breakpoint

CREATE TRIGGER `integration_connections_validate_professional_update`
BEFORE UPDATE OF `tenant_id`, `professional_id` ON `integration_connections`
WHEN NEW.`professional_id` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_SCOPE_VIOLATION')
  WHERE NOT EXISTS (SELECT 1 FROM `professionals` WHERE `id` = NEW.`professional_id` AND `tenant_id` = NEW.`tenant_id`);
END;--> statement-breakpoint

CREATE TRIGGER `oauth_states_validate_professional_insert`
BEFORE INSERT ON `oauth_states`
WHEN NEW.`professional_id` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_SCOPE_VIOLATION')
  WHERE NOT EXISTS (SELECT 1 FROM `professionals` WHERE `id` = NEW.`professional_id` AND `tenant_id` = NEW.`tenant_id`);
END;--> statement-breakpoint

CREATE TRIGGER `oauth_states_validate_professional_update`
BEFORE UPDATE OF `tenant_id`, `professional_id` ON `oauth_states`
WHEN NEW.`professional_id` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_SCOPE_VIOLATION')
  WHERE NOT EXISTS (SELECT 1 FROM `professionals` WHERE `id` = NEW.`professional_id` AND `tenant_id` = NEW.`tenant_id`);
END;--> statement-breakpoint

CREATE TRIGGER `appointments_validate_professional_insert`
BEFORE INSERT ON `appointments`
BEGIN
  SELECT RAISE(ABORT, 'PROFESSIONAL_REQUIRED') WHERE NEW.`professional_id` IS NULL;
  SELECT RAISE(ABORT, 'SCHEDULE_SNAPSHOT_REQUIRED')
  WHERE NEW.`busy_starts_at_utc` IS NULL OR NEW.`busy_ends_at_utc` IS NULL OR NEW.`duration_minutes` IS NULL OR NEW.`price_cents` IS NULL;
  SELECT RAISE(ABORT, 'TENANT_SCOPE_VIOLATION')
  WHERE NOT EXISTS (SELECT 1 FROM `professionals` WHERE `id` = NEW.`professional_id` AND `tenant_id` = NEW.`tenant_id`)
     OR NOT EXISTS (SELECT 1 FROM `services` WHERE `id` = NEW.`service_id` AND `tenant_id` = NEW.`tenant_id`)
     OR NOT EXISTS (
       SELECT 1 FROM `professional_services`
       WHERE `tenant_id` = NEW.`tenant_id`
         AND `professional_id` = NEW.`professional_id`
         AND `service_id` = NEW.`service_id`
         AND `is_active` = 1
     );
END;--> statement-breakpoint

CREATE TRIGGER `appointments_validate_professional_update`
BEFORE UPDATE OF `tenant_id`, `professional_id`, `service_id`, `busy_starts_at_utc`, `busy_ends_at_utc`, `duration_minutes`, `price_cents` ON `appointments`
BEGIN
  SELECT RAISE(ABORT, 'PROFESSIONAL_REQUIRED') WHERE NEW.`professional_id` IS NULL;
  SELECT RAISE(ABORT, 'SCHEDULE_SNAPSHOT_REQUIRED')
  WHERE NEW.`busy_starts_at_utc` IS NULL OR NEW.`busy_ends_at_utc` IS NULL OR NEW.`duration_minutes` IS NULL OR NEW.`price_cents` IS NULL;
  SELECT RAISE(ABORT, 'TENANT_SCOPE_VIOLATION')
  WHERE NOT EXISTS (SELECT 1 FROM `professionals` WHERE `id` = NEW.`professional_id` AND `tenant_id` = NEW.`tenant_id`)
     OR NOT EXISTS (SELECT 1 FROM `services` WHERE `id` = NEW.`service_id` AND `tenant_id` = NEW.`tenant_id`)
     OR NOT EXISTS (
       SELECT 1 FROM `professional_services`
       WHERE `tenant_id` = NEW.`tenant_id`
         AND `professional_id` = NEW.`professional_id`
         AND `service_id` = NEW.`service_id`
         AND `is_active` = 1
     );
END;--> statement-breakpoint

CREATE TRIGGER `appointments_prevent_overlap`
BEFORE INSERT ON `appointments`
WHEN NEW.`status` IN ('pending', 'confirmed')
BEGIN
  SELECT RAISE(ABORT, 'APPOINTMENT_CONFLICT')
  WHERE EXISTS (
    SELECT 1 FROM `appointments` AS existing
    WHERE existing.`tenant_id` = NEW.`tenant_id`
      AND existing.`professional_id` = NEW.`professional_id`
      AND existing.`status` IN ('pending', 'confirmed')
      AND existing.`busy_starts_at_utc` < NEW.`busy_ends_at_utc`
      AND existing.`busy_ends_at_utc` > NEW.`busy_starts_at_utc`
  );
END;--> statement-breakpoint

CREATE TRIGGER `appointments_prevent_overlap_update`
BEFORE UPDATE OF `professional_id`, `busy_starts_at_utc`, `busy_ends_at_utc`, `status` ON `appointments`
WHEN NEW.`status` IN ('pending', 'confirmed')
BEGIN
  SELECT RAISE(ABORT, 'APPOINTMENT_CONFLICT')
  WHERE EXISTS (
    SELECT 1 FROM `appointments` AS existing
    WHERE existing.`id` <> NEW.`id`
      AND existing.`tenant_id` = NEW.`tenant_id`
      AND existing.`professional_id` = NEW.`professional_id`
      AND existing.`status` IN ('pending', 'confirmed')
      AND existing.`busy_starts_at_utc` < NEW.`busy_ends_at_utc`
      AND existing.`busy_ends_at_utc` > NEW.`busy_starts_at_utc`
  );
END;--> statement-breakpoint

CREATE TRIGGER `appointments_respect_blocks`
BEFORE INSERT ON `appointments`
WHEN NEW.`status` IN ('pending', 'confirmed')
BEGIN
  SELECT RAISE(ABORT, 'BLOCKED_PERIOD_CONFLICT')
  WHERE EXISTS (
    SELECT 1 FROM `blocked_periods` AS blocked
    WHERE blocked.`tenant_id` = NEW.`tenant_id`
      AND (blocked.`professional_id` IS NULL OR blocked.`professional_id` = NEW.`professional_id`)
      AND blocked.`starts_at_utc` < NEW.`busy_ends_at_utc`
      AND blocked.`ends_at_utc` > NEW.`busy_starts_at_utc`
  );
END;--> statement-breakpoint

CREATE TRIGGER `appointments_respect_blocks_update`
BEFORE UPDATE OF `professional_id`, `busy_starts_at_utc`, `busy_ends_at_utc`, `status` ON `appointments`
WHEN NEW.`status` IN ('pending', 'confirmed')
BEGIN
  SELECT RAISE(ABORT, 'BLOCKED_PERIOD_CONFLICT')
  WHERE EXISTS (
    SELECT 1 FROM `blocked_periods` AS blocked
    WHERE blocked.`tenant_id` = NEW.`tenant_id`
      AND (blocked.`professional_id` IS NULL OR blocked.`professional_id` = NEW.`professional_id`)
      AND blocked.`starts_at_utc` < NEW.`busy_ends_at_utc`
      AND blocked.`ends_at_utc` > NEW.`busy_starts_at_utc`
  );
END;
