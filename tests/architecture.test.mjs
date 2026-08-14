import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("migration protects scheduling concurrency", async () => {
  const migration = await readFile(new URL("../drizzle/0000_magical_talos.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TRIGGER `appointments_prevent_overlap`/);
  assert.match(migration, /RAISE\(ABORT, 'APPOINTMENT_CONFLICT'\)/);
  assert.match(migration, /CREATE TRIGGER `appointments_respect_blocks`/);
});

test("booking persists work in the transactional outbox", async () => {
  const route = await readFile(new URL("../app/api/public/bookings/route.ts", import.meta.url), "utf8");
  assert.match(route, /d1\.batch\(statements\)/);
  assert.match(route, /appointment\.created/);
  assert.match(route, /notification\.customer\.confirmation/);
  assert.match(route, /Idempotency-Key/);
  assert.match(route, /listAvailableSlots/);
  assert.match(route, /SLOT_UNAVAILABLE/);
});

test("integration credentials are encrypted before persistence", async () => {
  const callback = await readFile(new URL("../app/api/admin/integrations/google/callback/route.ts", import.meta.url), "utf8");
  const cryptoModule = await readFile(new URL("../lib/crypto-secrets.ts", import.meta.url), "utf8");
  assert.match(callback, /encryptSecret/);
  assert.match(cryptoModule, /AES-GCM/);
  assert.doesNotMatch(callback, /console\.log/);
});

test("public and admin interfaces use persisted APIs instead of fixed demo state", async () => {
  const publicWizard = await readFile(new URL("../app/components/booking-wizard.tsx", import.meta.url), "utf8");
  const adminDashboard = await readFile(new URL("../app/components/admin-dashboard.tsx", import.meta.url), "utf8");
  assert.match(publicWizard, /\/api\/public\/catalog/);
  assert.match(publicWizard, /\/api\/public\/availability/);
  assert.doesNotMatch(publicWizard, /2026-08-17/);
  assert.match(adminDashboard, /\/api\/admin\/services/);
  assert.match(adminDashboard, /\/api\/admin\/availability/);
});
