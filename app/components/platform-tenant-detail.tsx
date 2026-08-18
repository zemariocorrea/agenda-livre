"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type TenantDetail = {
  id: string; slug: string; name: string; subtitle: string; timezone: string; location: string; contact_email: string;
  plan: string; max_professionals: number; brand_color: string; hero_title: string; hero_description: string;
  custom_domain: string | null; is_active: number;
};
type Member = { id: string; display_name: string; email: string; role: string; is_active: number };

export function PlatformTenantDetail({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);

  useEffect(() => {
    apiJson<{ tenant: TenantDetail; members: Member[]; metrics: Record<string, number> }>(`/api/platform/tenants/${encodeURIComponent(tenantId)}`)
      .then((data) => { setTenant(data.tenant); setMembers(data.members); setMetrics(data.metrics); })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Não foi possível carregar a empresa."));
  }, [tenantId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) return;
    const data = new FormData(event.currentTarget);
    setSaving(true); setMessage("");
    try {
      await apiJson(`/api/platform/tenants/${encodeURIComponent(tenantId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name: data.get("name"), slug: data.get("slug"), subtitle: data.get("subtitle"), location: data.get("location"), contactEmail: data.get("contactEmail"),
        timezone: data.get("timezone"), plan: data.get("plan"), maxProfessionals: Number(data.get("maxProfessionals")), brandColor: data.get("brandColor"),
        heroTitle: data.get("heroTitle"), heroDescription: data.get("heroDescription"), customDomain: data.get("customDomain"), isActive: data.get("isActive") === "on",
      }) });
      setMessage("Empresa atualizada.");
      const refreshed = await apiJson<{ tenant: TenantDetail; members: Member[]; metrics: Record<string, number> }>(`/api/platform/tenants/${encodeURIComponent(tenantId)}`);
      setTenant(refreshed.tenant); setMembers(refreshed.members); setMetrics(refreshed.metrics);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível salvar."); } finally { setSaving(false); }
  }

  async function archive() {
    setSaving(true); setMessage("");
    try { await apiJson(`/api/platform/tenants/${encodeURIComponent(tenantId)}`, { method: "DELETE" }); setTenant((current) => current ? { ...current, is_active: 0 } : current); setConfirmArchive(false); setMessage("Empresa arquivada. Os dados foram preservados."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível arquivar."); } finally { setSaving(false); }
  }

  if (!tenant) return <main className="platform-detail-shell"><div className="platform-detail-top"><Link href="/plataforma/empresas">← Empresas</Link></div><section className="platform-panel">{message || "Carregando empresa..."}</section></main>;
  return <main className="platform-detail-shell">
    <div className="platform-detail-top"><Link href="/plataforma/empresas">← Voltar para empresas</Link><div><Link className="admin-ghost" href={`/empresa/${encodeURIComponent(tenant.slug)}`}>Site público ↗</Link>{tenant.is_active ? <Link className="platform-primary" href={`/admin?tenant=${encodeURIComponent(tenant.slug)}`}>Abrir administração →</Link> : null}</div></div>
    <header className="company-detail-hero"><span style={{ background: tenant.brand_color }}>{tenant.name.slice(0, 1)}</span><div><p>{tenant.is_active ? "Empresa ativa" : "Empresa arquivada"}</p><h1>{tenant.name}</h1><small>/empresa/{tenant.slug}</small></div></header>
    {message && <p className="platform-alert" role="status">{message}</p>}
    <section className="detail-metrics"><article><strong>{Number(metrics.professionals ?? 0)}</strong><span>Profissionais</span></article><article><strong>{Number(metrics.services ?? 0)}</strong><span>Atividades</span></article><article><strong>{Number(metrics.appointments ?? 0)}</strong><span>Agendamentos</span></article><article><strong>{Number(metrics.pending_events ?? 0)}</strong><span>Eventos pendentes</span></article></section>
    <div className="platform-detail-grid"><form className="platform-panel company-form" onSubmit={save}><div className="platform-section-head"><div><p className="eyebrow">Configuração</p><h2>Dados e identidade do site</h2></div></div><div className="modal-grid"><label>Nome<input name="name" required defaultValue={tenant.name} /></label><label>Slug<input name="slug" required defaultValue={tenant.slug} /></label></div><div className="modal-grid"><label>Subtítulo<input name="subtitle" defaultValue={tenant.subtitle} /></label><label>Localização<input name="location" defaultValue={tenant.location} /></label></div><div className="modal-grid"><label>E-mail de contato<input name="contactEmail" type="email" defaultValue={tenant.contact_email} /></label><label>Fuso horário<input name="timezone" defaultValue={tenant.timezone} /></label></div><div className="modal-grid"><label>Plano<select name="plan" defaultValue={tenant.plan}><option value="trial">Teste</option><option value="essential">Essencial</option><option value="professional">Profissional</option></select></label><label>Limite de profissionais<input name="maxProfessionals" type="number" min="1" max="500" defaultValue={tenant.max_professionals} /></label></div><div className="modal-grid"><label>Cor da marca<input className="color-input" name="brandColor" type="color" defaultValue={tenant.brand_color} /></label><label>Domínio personalizado<input name="customDomain" defaultValue={tenant.custom_domain ?? ""} placeholder="agenda.empresa.com.br" /></label></div><label>Título público<input name="heroTitle" defaultValue={tenant.hero_title} /></label><label>Descrição pública<textarea name="heroDescription" defaultValue={tenant.hero_description} /></label><label className="create-professional"><input name="isActive" type="checkbox" defaultChecked={Boolean(tenant.is_active)} /> Empresa ativa e site publicado</label><div className="modal-actions"><button className="platform-primary" disabled={saving} type="submit">{saving ? "Salvando..." : "Salvar alterações"}</button></div></form><aside className="platform-panel company-members"><div className="platform-section-head"><div><p className="eyebrow">Acesso</p><h2>Administradores</h2></div></div>{members.map((member) => <article key={member.id}><span>{member.display_name.slice(0, 1).toUpperCase()}</span><div><strong>{member.display_name}</strong><small>{member.email}</small></div><b>{member.role === "owner" ? "Proprietário" : member.role === "admin" ? "Admin" : "Equipe"}</b></article>)}<p>Novos administradores são gerenciados dentro do painel da própria empresa.</p><hr /><h3>Arquivamento seguro</h3><p>Arquivar remove o site e o acesso da empresa, preservando histórico, pagamentos e auditoria.</p>{confirmArchive ? <div className="archive-confirm"><span>Confirma o arquivamento?</span><button disabled={saving} onClick={archive} type="button">Sim, arquivar</button><button onClick={() => setConfirmArchive(false)} type="button">Cancelar</button></div> : <button className="danger-button" disabled={!tenant.is_active} onClick={() => setConfirmArchive(true)} type="button">Arquivar empresa</button>}</aside></div>
  </main>;
}

async function apiJson<T = unknown>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, init); const body = await response.json() as T & { error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "A operação falhou."); return body; }
