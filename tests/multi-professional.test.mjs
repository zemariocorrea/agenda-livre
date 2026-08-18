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

function insertAppointment(database, { id, professionalId, start = "2030-06-10T13:00:00.000Z", end = "2030-06-10T14:00:00.000Z" }) {
  database.prepare(`
    INSERT INTO appointments (
      id, tenant_id, service_id, professional_id,
      customer_name, customer_email, customer_phone,
      starts_at_utc, ends_at_utc, busy_starts_at_utc, busy_ends_at_utc,
      duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents,
      timezone, status, payment_preference, payment_status, public_token
    ) VALUES (?, 'tenant_clinica_aurora', 'service_terapia', ?,
      'Cliente Teste', ?, '+5541999999999', ?, ?, ?, ?,
      60, 0, 0, 18000, 'America/Sao_Paulo', 'confirmed', 'at_venue', 'not_required', ?)
  `).run(id, professionalId, `${id}@example.test`, start, end, start, end, `token-${id}`);
}

test("migration creates the Aurora team and N:N service links", async () => {
  const database = await migratedDatabase();
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM professionals WHERE tenant_id = ?").get("tenant_clinica_aurora").total, 3);
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM professional_services WHERE tenant_id = ? AND is_active = 1").get("tenant_clinica_aurora").total, 9);
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM availability_rules WHERE tenant_id = ? AND professional_id IS NULL").get("tenant_clinica_aurora").total, 0);
  database.close();
});

test("two professionals can work simultaneously but one professional cannot overlap", async () => {
  const database = await migratedDatabase();
  insertAppointment(database, { id: "appointment-a", professionalId: "professional_member_aurora_owner" });
  insertAppointment(database, { id: "appointment-b", professionalId: "professional_aurora_helena" });
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM appointments").get().total, 2);
  assert.throws(
    () => insertAppointment(database, { id: "appointment-conflict", professionalId: "professional_aurora_helena", start: "2030-06-10T13:30:00.000Z", end: "2030-06-10T14:30:00.000Z" }),
    /APPOINTMENT_CONFLICT/,
  );
  database.close();
});

test("database rejects relationships that cross tenant boundaries", async () => {
  const database = await migratedDatabase();
  database.exec(`
    INSERT INTO tenants (id, slug, name) VALUES ('tenant_other', 'outra-empresa', 'Outra Empresa');
    INSERT INTO professionals (id, tenant_id, name) VALUES ('professional_other', 'tenant_other', 'Outra Pessoa');
    INSERT INTO services (id, tenant_id, name, duration_minutes) VALUES ('service_other', 'tenant_other', 'Outro Serviço', 30);
  `);
  assert.throws(
    () => database.prepare("INSERT INTO professional_services (id, tenant_id, professional_id, service_id) VALUES (?, ?, ?, ?)").run("cross-link", "tenant_clinica_aurora", "professional_other", "service_terapia"),
    /TENANT_SCOPE_VIOLATION/,
  );
  assert.throws(
    () => database.prepare("UPDATE availability_rules SET professional_id = ? WHERE id = ?").run("professional_other", "availability_mon"),
    /TENANT_SCOPE_VIOLATION/,
  );
  assert.throws(
    () => database.prepare("INSERT INTO integration_connections (id, tenant_id, professional_id, provider) VALUES (?, ?, ?, ?)").run("cross-google", "tenant_clinica_aurora", "professional_other", "google_calendar"),
    /TENANT_SCOPE_VIOLATION/,
  );
  database.close();
});
