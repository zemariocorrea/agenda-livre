import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(migrationDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationDirectory), "utf8");
    database.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
  database.exec("PRAGMA foreign_keys = ON");
  return database;
}

test("manual payment migration is incremental and keeps safe defaults", async () => {
  const database = await migratedDatabase();
  const tenant = database.prepare(`
    SELECT payment_enabled, pix_enabled, pay_on_site_enabled, contact_for_payment_enabled, require_payment_to_confirm
    FROM tenants WHERE id = 'tenant_clinica_aurora'
  `).get();
  const service = database.prepare("SELECT payment_type, deposit_amount_cents FROM services WHERE id = 'service_terapia'").get();

  assert.deepEqual({ ...tenant }, {
    payment_enabled: 0,
    pix_enabled: 0,
    pay_on_site_enabled: 1,
    contact_for_payment_enabled: 0,
    require_payment_to_confirm: 1,
  });
  assert.deepEqual({ ...service }, { payment_type: "none", deposit_amount_cents: null });
  database.close();
});

test("manual Pix flow stores a payment snapshot on the appointment", async () => {
  const database = await migratedDatabase();
  database.exec(`
    UPDATE tenants
    SET payment_enabled = 1, pix_enabled = 1, pix_key = 'pix@example.test', require_payment_to_confirm = 1
    WHERE id = 'tenant_clinica_aurora';
    UPDATE services
    SET payment_type = 'deposit', deposit_amount_cents = 3000
    WHERE id = 'service_terapia';
  `);

  database.prepare(`
    INSERT INTO appointments (
      id, tenant_id, service_id, professional_id,
      customer_name, customer_email, customer_phone,
      starts_at_utc, ends_at_utc, busy_starts_at_utc, busy_ends_at_utc,
      duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents,
      timezone, status, payment_preference, payment_status, payment_method,
      payment_amount_cents, public_token
    ) VALUES (
      'appointment-pix', 'tenant_clinica_aurora', 'service_terapia', 'professional_member_aurora_owner',
      'Maria', 'maria@example.test', '+5541999999999',
      '2035-01-01T13:00:00.000Z', '2035-01-01T14:00:00.000Z', '2035-01-01T13:00:00.000Z', '2035-01-01T14:00:00.000Z',
      60, 0, 0, 10000, 'America/Sao_Paulo', 'pending', 'at_venue', 'proof_sent', 'pix',
      3000, 'public-pix-token'
    )
  `).run();

  database.exec("UPDATE services SET deposit_amount_cents = 5000 WHERE id = 'service_terapia'");
  const appointment = database.prepare("SELECT status, payment_status, payment_method, payment_amount_cents FROM appointments WHERE id = 'appointment-pix'").get();
  assert.deepEqual({ ...appointment }, {
    status: "pending",
    payment_status: "proof_sent",
    payment_method: "pix",
    payment_amount_cents: 3000,
  });
  database.close();
});

test("manual payment endpoints scope administrative reads and writes by tenant", async () => {
  const paymentRoute = await readFile(new URL("../app/api/admin/appointments/[id]/payment/route.ts", import.meta.url), "utf8");
  const proofRoute = await readFile(new URL("../app/api/admin/appointments/[id]/payment-proof/route.ts", import.meta.url), "utf8");
  const bookingRoute = await readFile(new URL("../app/api/public/bookings/route.ts", import.meta.url), "utf8");

  assert.match(paymentRoute, /appointment\.tenant_id = \?/);
  assert.match(paymentRoute, /access\.tenant\.id/);
  assert.match(paymentRoute, /requireTenantManager/);
  assert.match(proofRoute, /WHERE id = \? AND tenant_id = \?/);
  assert.match(proofRoute, /tenants\/\$\{access\.tenant\.id\}\/payment-proofs/);
  assert.match(bookingRoute, /advancePaymentAmountCents/);
  assert.match(bookingRoute, /payment_amount_cents/);
  assert.doesNotMatch(bookingRoute, /payload\.paymentAmount/);
});
