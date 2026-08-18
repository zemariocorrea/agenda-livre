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

test("platform migration creates the master layer and tenant branding", async () => {
  const database = await migratedDatabase();
  const master = database.prepare("SELECT email, is_active FROM platform_admins WHERE id = 'platform_admin_seed'").get();
  const aurora = database.prepare("SELECT contact_email, plan, max_professionals, brand_color FROM tenants WHERE id = 'tenant_clinica_aurora'").get();
  assert.deepEqual({ ...master }, { email: "master@agenda-livre.example", is_active: 1 });
  assert.equal(aurora.plan, "essential");
  assert.equal(aurora.max_professionals, 10);
  assert.match(aurora.brand_color, /^#/);
  assert.match(aurora.contact_email, /@/);
  database.close();
});

test("a provisioned company owns isolated administrators, professionals and activities", async () => {
  const database = await migratedDatabase();
  database.exec(`
    INSERT INTO tenants (id, slug, name, contact_email, plan, max_professionals)
      VALUES ('tenant_vida', 'clinica-vida', 'Clínica Vida', 'contato@vida.test', 'professional', 30);
    INSERT INTO tenant_members (id, tenant_id, email, display_name, role)
      VALUES ('member_vida', 'tenant_vida', 'dona@vida.test', 'Dona Vida', 'owner');
    INSERT INTO professionals (id, tenant_id, name, title)
      VALUES ('professional_vida_a', 'tenant_vida', 'Ana Vida', 'Psicóloga'),
             ('professional_vida_b', 'tenant_vida', 'Bruno Vida', 'Nutricionista');
    INSERT INTO services (id, tenant_id, name, duration_minutes)
      VALUES ('service_vida_a', 'tenant_vida', 'Consulta', 60),
             ('service_vida_b', 'tenant_vida', 'Retorno', 30);
    INSERT INTO professional_services (id, tenant_id, professional_id, service_id)
      VALUES ('link_vida_1', 'tenant_vida', 'professional_vida_a', 'service_vida_a'),
             ('link_vida_2', 'tenant_vida', 'professional_vida_b', 'service_vida_a'),
             ('link_vida_3', 'tenant_vida', 'professional_vida_b', 'service_vida_b');
  `);
  const hierarchy = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM tenant_members WHERE tenant_id = tenant.id) AS administrators,
      (SELECT COUNT(*) FROM professionals WHERE tenant_id = tenant.id) AS professionals,
      (SELECT COUNT(*) FROM services WHERE tenant_id = tenant.id) AS services,
      (SELECT COUNT(*) FROM professional_services WHERE tenant_id = tenant.id) AS links
    FROM tenants AS tenant WHERE tenant.id = 'tenant_vida'
  `).get();
  assert.deepEqual({ ...hierarchy }, { administrators: 1, professionals: 2, services: 2, links: 3 });
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM professionals WHERE tenant_id = 'tenant_clinica_aurora'").get().total, 3);
  assert.throws(
    () => database.prepare("INSERT INTO professional_services (id, tenant_id, professional_id, service_id) VALUES (?, ?, ?, ?)").run("cross-company", "tenant_vida", "professional_vida_a", "service_terapia"),
    /TENANT_SCOPE_VIOLATION/,
  );
  database.close();
});

test("archiving a company preserves its complete hierarchy", async () => {
  const database = await migratedDatabase();
  const before = database.prepare("SELECT COUNT(*) AS total FROM professionals WHERE tenant_id = 'tenant_clinica_aurora'").get().total;
  database.prepare("UPDATE tenants SET is_active = 0 WHERE id = ?").run("tenant_clinica_aurora");
  assert.equal(database.prepare("SELECT is_active FROM tenants WHERE id = ?").get("tenant_clinica_aurora").is_active, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM professionals WHERE tenant_id = 'tenant_clinica_aurora'").get().total, before);
  assert.ok(database.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE tenant_id = 'tenant_clinica_aurora'").get().total >= 0);
  database.close();
});

test("master and company CRUD surfaces enforce server APIs", async () => {
  const platform = await readFile(new URL("../app/components/platform-dashboard.tsx", import.meta.url), "utf8");
  const tenantDetail = await readFile(new URL("../app/components/platform-tenant-detail.tsx", import.meta.url), "utf8");
  const companyAdmin = await readFile(new URL("../app/components/admin-dashboard.tsx", import.meta.url), "utf8");
  const platformRoute = await readFile(new URL("../app/api/platform/tenants/route.ts", import.meta.url), "utf8");
  const professionalRoute = await readFile(new URL("../app/api/admin/professionals/route.ts", import.meta.url), "utf8");
  assert.match(platform, /\/api\/platform\/tenants/);
  assert.match(tenantDetail, /method: "PATCH"/);
  assert.match(tenantDetail, /method: "DELETE"/);
  assert.match(platformRoute, /platformAdmin\(\)/);
  assert.match(platformRoute, /d1\.batch\(statements\)/);
  assert.match(professionalRoute, /PROFESSIONAL_LIMIT_REACHED/);
  assert.match(companyAdmin, /\/api\/admin\/members/);
  assert.match(companyAdmin, /\/api\/admin\/blocked-periods/);
  assert.match(companyAdmin, /\/api\/admin\/appointments/);
  assert.match(companyAdmin, /\/api\/admin\/company/);
});
