import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("catalog translates unavailable or unmigrated D1 into an explicit 503", async () => {
  const route = await readFile(new URL("../app/api/public/catalog/route.ts", import.meta.url), "utf8");
  const problemDetails = await readFile(new URL("../lib/problem-details.ts", import.meta.url), "utf8");

  assert.match(route, /isDatabaseUnavailable\(error\)/);
  assert.match(route, /status:\s*503/);
  assert.match(route, /DATABASE_UNAVAILABLE/);
  assert.match(route, /correlationId/);
  assert.match(problemDetails, /application\/problem\+json/);
  assert.match(problemDetails, /no such table/);
});

test("new API starts isolated from the legacy Next.js application", async () => {
  const apiPackage = JSON.parse(await readFile(new URL("../apps/api/package.json", import.meta.url), "utf8"));
  const main = await readFile(new URL("../apps/api/src/main.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../apps/api/prisma/schema.prisma", import.meta.url), "utf8");

  assert.equal(apiPackage.name, "@onboarding/api");
  assert.match(main, /setGlobalPrefix\('api\/v1'\)/);
  assert.match(schema, /provider = "postgresql"/);
  assert.match(schema, /model Tenant/);
  assert.match(schema, /model Session/);
  assert.match(schema, /tokenHash String\s+@unique/);
});
