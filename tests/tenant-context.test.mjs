import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) files.push(...await sourceFiles(url));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) files.push(url);
  }
  return files;
}

test("runtime does not select a demo tenant or obsolete internal origin", async () => {
  const files = [
    ...await sourceFiles(new URL("../app/", import.meta.url)),
    ...await sourceFiles(new URL("../lib/", import.meta.url)),
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /clinica-aurora|agenda\.local/i, file.pathname);
  }
});

test("multi-tenant login has an explicit company selector", async () => {
  const access = await readFile(new URL("../lib/auth/access.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/selecionar-empresa/page.tsx", import.meta.url), "utf8");
  assert.match(access, /tenants\.length > 1/);
  assert.match(access, /\/selecionar-empresa/);
  assert.match(page, /Escolha uma empresa/);
});

test("Google OAuth state is bound to the initiating internal user", async () => {
  const migration = await readFile(new URL("../drizzle/0005_oauth_state_user.sql", import.meta.url), "utf8");
  const start = await readFile(new URL("../app/api/admin/integrations/google/start/route.ts", import.meta.url), "utf8");
  const callback = await readFile(new URL("../app/api/admin/integrations/google/callback/route.ts", import.meta.url), "utf8");
  assert.match(migration, /oauth_states.*user_id|ADD `user_id`/s);
  assert.match(start, /access\.user\.id/);
  assert.match(callback, /OAUTH_STATE_USER_MISMATCH/);
  assert.match(callback, /stored\.user_id !== access\.user\.id/);
});
