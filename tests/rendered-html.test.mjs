import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("renders public booking pages and protects administrative dashboards", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `routes-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const environment = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const context = { waitUntil() {}, passThroughOnException() {} };

  const publicResponse = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), environment, context);
  assert.equal(publicResponse.status, 200);
  const publicHtml = await publicResponse.text();
  assert.match(publicHtml, /Como podemos cuidar de você/);
  assert.match(publicHtml, /Pagamento opcional/);

  const adminResponse = await worker.fetch(new Request("http://localhost/admin", { headers: { accept: "text/html" } }), environment, context);
  assert.ok([302, 303, 307, 308].includes(adminResponse.status));
  assert.match(adminResponse.headers.get("location") ?? "", /^\/login\?return_to=/);

  const companySiteResponse = await worker.fetch(new Request("http://localhost/empresa/clinica-aurora", { headers: { accept: "text/html" } }), environment, context);
  assert.equal(companySiteResponse.status, 200);
  assert.match(await companySiteResponse.text(), /Área do gestor/);

  const platformResponse = await worker.fetch(new Request("http://localhost/plataforma", { headers: { accept: "text/html" } }), environment, context);
  assert.ok([302, 303, 307, 308].includes(platformResponse.status));
  assert.match(platformResponse.headers.get("location") ?? "", /^\/login\?return_to=/);
});
