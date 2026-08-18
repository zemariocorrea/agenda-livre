type AuditInput = {
  tenantId: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
};

export async function writeAudit(d1: D1Database, input: AuditInput) {
  await d1.prepare(`
    INSERT INTO audit_log (id, tenant_id, actor, action, entity_type, entity_id, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.tenantId,
    input.actor,
    input.action,
    input.entityType,
    input.entityId,
    JSON.stringify(input.metadata ?? {}),
  ).run();
}
