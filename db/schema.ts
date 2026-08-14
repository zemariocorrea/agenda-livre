import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  subtitle: text("subtitle").notNull().default(""),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  currency: text("currency").notNull().default("BRL"),
  location: text("location").notNull().default(""),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

export const tenantMembers = sqliteTable("tenant_members", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["owner", "admin", "staff"] }).notNull().default("staff"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [
  uniqueIndex("tenant_members_tenant_email_uq").on(table.tenantId, table.email),
  index("tenant_members_email_idx").on(table.email),
]);

export const services = sqliteTable("services", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  durationMinutes: integer("duration_minutes").notNull(),
  bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
  bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
  priceCents: integer("price_cents").notNull().default(0),
  color: text("color").notNull().default("#17624f"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, (table) => [index("services_tenant_active_idx").on(table.tenantId, table.isActive, table.sortOrder)]);

export const availabilityRules = sqliteTable("availability_rules", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  memberId: text("member_id").references(() => tenantMembers.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  slotIntervalMinutes: integer("slot_interval_minutes").notNull().default(30),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [index("availability_tenant_weekday_idx").on(table.tenantId, table.weekday, table.isActive)]);

export const blockedPeriods = sqliteTable("blocked_periods", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  memberId: text("member_id").references(() => tenantMembers.id, { onDelete: "cascade" }),
  startsAtUtc: text("starts_at_utc").notNull(),
  endsAtUtc: text("ends_at_utc").notNull(),
  reason: text("reason").notNull().default("Bloqueio manual"),
  ...timestamps,
}, (table) => [index("blocked_periods_window_idx").on(table.tenantId, table.startsAtUtc, table.endsAtUtc)]);

export const appointments = sqliteTable("appointments", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
  serviceId: text("service_id").notNull().references(() => services.id, { onDelete: "restrict" }),
  memberId: text("member_id").references(() => tenantMembers.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerNotes: text("customer_notes").notNull().default(""),
  startsAtUtc: text("starts_at_utc").notNull(),
  endsAtUtc: text("ends_at_utc").notNull(),
  timezone: text("timezone").notNull(),
  status: text("status", { enum: ["pending", "confirmed", "cancelled", "completed", "no_show"] }).notNull().default("confirmed"),
  paymentPreference: text("payment_preference", { enum: ["online", "at_venue"] }).notNull().default("at_venue"),
  paymentStatus: text("payment_status", { enum: ["not_required", "pending", "paid", "failed", "refunded"] }).notNull().default("not_required"),
  publicToken: text("public_token").notNull().unique(),
  googleEventId: text("google_event_id"),
  cancelledAt: text("cancelled_at"),
  ...timestamps,
}, (table) => [
  index("appointments_tenant_start_idx").on(table.tenantId, table.startsAtUtc),
  index("appointments_member_window_idx").on(table.memberId, table.startsAtUtc, table.endsAtUtc),
  index("appointments_customer_email_idx").on(table.tenantId, table.customerEmail),
]);

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id, { onDelete: "restrict" }),
  provider: text("provider", { enum: ["stripe"] }).notNull().default("stripe"),
  providerReference: text("provider_reference"),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("BRL"),
  status: text("status", { enum: ["pending", "paid", "failed", "refunded"] }).notNull().default("pending"),
  checkoutUrl: text("checkout_url"),
  paidAt: text("paid_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("payments_provider_reference_uq").on(table.provider, table.providerReference),
  index("payments_appointment_idx").on(table.appointmentId),
]);

export const integrationConnections = sqliteTable("integration_connections", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["google_calendar", "stripe", "email"] }).notNull(),
  status: text("status", { enum: ["connected", "disconnected", "error"] }).notNull().default("disconnected"),
  externalAccountId: text("external_account_id"),
  encryptedCredentials: text("encrypted_credentials"),
  configurationJson: text("configuration_json").notNull().default("{}"),
  lastSyncedAt: text("last_synced_at"),
  ...timestamps,
}, (table) => [uniqueIndex("integration_tenant_provider_uq").on(table.tenantId, table.provider)]);

export const oauthStates = sqliteTable("oauth_states", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  stateHash: text("state_hash").notNull().unique(),
  redirectUri: text("redirect_uri").notNull(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("oauth_states_lookup_idx").on(table.provider, table.stateHash, table.expiresAt)]);

export const outboxEvents = sqliteTable("outbox_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  eventType: text("event_type").notNull(),
  payloadJson: text("payload_json").notNull(),
  status: text("status", { enum: ["pending", "processing", "processed", "failed"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: text("available_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  processedAt: text("processed_at"),
  lastError: text("last_error"),
  ...timestamps,
}, (table) => [index("outbox_dispatch_idx").on(table.status, table.availableAt, table.createdAt)]);

export const notificationDeliveries = sqliteTable("notification_deliveries", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id, { onDelete: "cascade" }),
  channel: text("channel", { enum: ["email", "in_app", "calendar"] }).notNull(),
  recipient: text("recipient").notNull(),
  status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
  providerReference: text("provider_reference"),
  sentAt: text("sent_at"),
  lastError: text("last_error"),
  ...timestamps,
}, (table) => [index("notifications_appointment_idx").on(table.appointmentId, table.channel)]);

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  resourceId: text("resource_id").notNull(),
  responseJson: text("response_json").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idempotency_tenant_scope_key_uq").on(table.tenantId, table.scope, table.key)]);

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("audit_tenant_created_idx").on(table.tenantId, table.createdAt)]);
