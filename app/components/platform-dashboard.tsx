"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { LogoutButton } from "./logout-button";
import { TemporaryCredentials } from "./temporary-credentials";

type PlatformView = "overview" | "companies";
type TenantRow = {
  id: string; slug: string; name: string; subtitle: string; location: string; contact_email: string;
  plan: string; max_professionals: number; brand_color: string; custom_domain: string | null;
  is_active: number; created_at: string; administrators: number; professionals: number; services: number; appointments: number;
};
type Dashboard = {
  user: { name: string; email: string };
  metrics: { tenants: number; activeTenants: number; professionals: number; appointments: number; revenueCents: number };
  recentTenants: TenantRow[];
};

export function PlatformDashboard({ initialView }: { initialView: PlatformView }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [createdAccess, setCreatedAccess] = useState<{ tenantId: string; email: string; temporaryPassword: string } | null>(null);
  const money = useMemo(() => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }), []);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiJson<Dashboard>("/api/platform/dashboard"),
      apiJson<{ tenants: TenantRow[] }>("/api/platform/tenants"),
    ]).then(([dashboardData, tenantData]) => {
      if (!active) return;
      setDashboard(dashboardData); setTenants(tenantData.tenants);
    }).catch((error) => active && setMessage(error instanceof Error ? error.message : "Não foi possível carregar a plataforma."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true); setMessage("");
    try {
      const result = await apiJson<{ tenant: { id: string }; credentials: { email: string; temporaryPassword: string } | null }>("/api/platform/tenants", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          name: String(data.get("name") ?? ""), slug: String(data.get("slug") ?? ""), subtitle: String(data.get("subtitle") ?? ""),
          location: String(data.get("location") ?? ""), timezone: String(data.get("timezone") ?? "America/Sao_Paulo"),
          ownerName: String(data.get("ownerName") ?? ""), ownerEmail: String(data.get("ownerEmail") ?? ""),
          contactEmail: String(data.get("ownerEmail") ?? ""), plan: String(data.get("plan") ?? "essential"),
          maxProfessionals: Number(data.get("maxProfessionals")), brandColor: String(data.get("brandColor") ?? "#17624f"),
          createProfessional: data.get("createProfessional") === "on", professionalName: String(data.get("professionalName") ?? ""),
          professionalTitle: String(data.get("professionalTitle") ?? ""),
        }),
      });
      if (result.credentials) {
        setShowCreate(false);
        setCreatedAccess({ tenantId: result.tenant.id, ...result.credentials });
      } else {
        window.location.assign(`/plataforma/empresas/${encodeURIComponent(result.tenant.id)}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível criar a empresa.");
    } finally { setSaving(false); }
  }

  const filtered = tenants.filter((tenant) => `${tenant.name} ${tenant.slug} ${tenant.contact_email}`.toLowerCase().includes(search.toLowerCase()));
  const visibleTenants = initialView === "overview" ? (dashboard?.recentTenants ?? []) : filtered;

  return <main className="platform-shell">
    <aside className="platform-sidebar">
      <Link className="platform-brand" href="/plataforma"><span>AL</span><div><strong>Agenda Livre</strong><small>Admin Master</small></div></Link>
      <nav aria-label="Navegação da plataforma">
        <Link className={initialView === "overview" ? "active" : ""} href="/plataforma"><span>◫</span>Visão geral</Link>
        <Link className={initialView === "companies" ? "active" : ""} href="/plataforma/empresas"><span>▦</span>Empresas</Link>
      </nav>
      <div className="platform-profile"><span>{initials(dashboard?.user.name ?? "Master")}</span><div><strong>{dashboard?.user.name ?? "Administrador"}</strong><small>{dashboard?.user.email ?? "Acesso master"}</small></div></div>
      <LogoutButton className="platform-logout" />
    </aside>
    <section className="platform-main">
      <header className="platform-topbar"><div><p>Gestão centralizada</p><h1>{initialView === "overview" ? "Visão geral da plataforma" : "Empresas clientes"}</h1></div><button className="platform-primary" onClick={() => setShowCreate(true)} type="button">＋ Nova empresa</button></header>
      {message && <p className="platform-alert" role="status">{message}</p>}
      {loading ? <div className="platform-content"><section className="platform-panel">Carregando plataforma...</section></div> : <div className="platform-content">
        {initialView === "overview" && <>
          <section className="platform-metrics">
            <PlatformMetric label="Empresas ativas" value={String(dashboard?.metrics.activeTenants ?? 0)} note={`${dashboard?.metrics.tenants ?? 0} cadastradas`} />
            <PlatformMetric label="Profissionais" value={String(dashboard?.metrics.professionals ?? 0)} note="Em todas as empresas" />
            <PlatformMetric label="Agendamentos" value={String(dashboard?.metrics.appointments ?? 0)} note="Ativos na plataforma" />
            <PlatformMetric label="Receita processada" value={money.format((dashboard?.metrics.revenueCents ?? 0) / 100)} note="Pagamentos confirmados" />
          </section>
          <section className="platform-hierarchy"><div><p className="eyebrow">Estrutura</p><h2>Uma plataforma, várias empresas isoladas</h2><p>Cada empresa possui seus próprios administradores, profissionais, catálogo, agendas e integrações.</p></div><div className="hierarchy-flow"><span>Agenda Livre</span><b>→</b><span>Empresa</span><b>→</b><span>Equipe e agenda</span><b>→</b><span>Cliente final</span></div></section>
        </>}
        <section className="platform-panel">
          <div className="platform-section-head"><div><p className="eyebrow">{initialView === "overview" ? "Recentes" : "Cadastro"}</p><h2>{initialView === "overview" ? "Últimas empresas" : "Todas as empresas"}</h2></div>{initialView === "companies" && <input aria-label="Buscar empresas" placeholder="Buscar por nome, slug ou e-mail" value={search} onChange={(event) => setSearch(event.target.value)} />}{initialView === "overview" && <Link href="/plataforma/empresas">Ver todas →</Link>}</div>
          <TenantTable tenants={visibleTenants} />
        </section>
      </div>}
    </section>
    {createdAccess && <TemporaryCredentials credentials={createdAccess} title="Empresa e proprietário criados" onClose={() => setCreatedAccess(null)} actionLabel="Abrir empresa" onAction={() => window.location.assign(`/plataforma/empresas/${encodeURIComponent(createdAccess.tenantId)}`)} />}
    {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowCreate(false)}><form className="platform-modal" onSubmit={createTenant} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Provisionamento</p><h2>Nova empresa</h2></div><button aria-label="Fechar" onClick={() => setShowCreate(false)} type="button">×</button></div><div className="modal-grid"><label>Nome da empresa<input name="name" required maxLength={120} placeholder="Clínica Vida" /></label><label>Endereço público<input name="slug" maxLength={100} placeholder="clinica-vida" /></label></div><div className="modal-grid"><label>Segmento ou subtítulo<input name="subtitle" maxLength={160} placeholder="Saúde e bem-estar" /></label><label>Cidade<input name="location" maxLength={160} placeholder="Curitiba · PR" /></label></div><div className="modal-grid"><label>Nome do proprietário<input name="ownerName" required maxLength={120} /></label><label>E-mail do proprietário<input name="ownerEmail" required type="email" maxLength={254} /></label></div><div className="modal-grid"><label>Plano<select name="plan" defaultValue="essential"><option value="trial">Teste</option><option value="essential">Essencial</option><option value="professional">Profissional</option></select></label><label>Limite de profissionais<input name="maxProfessionals" type="number" min="1" max="500" defaultValue="10" /></label></div><div className="modal-grid"><label>Fuso horário<select name="timezone" defaultValue="America/Sao_Paulo"><option value="America/Sao_Paulo">Brasília</option><option value="America/Manaus">Manaus</option><option value="America/Fortaleza">Fortaleza</option><option value="America/Recife">Recife</option></select></label><label>Cor da marca<input className="color-input" name="brandColor" type="color" defaultValue="#17624f" /></label></div><label className="create-professional"><input defaultChecked name="createProfessional" type="checkbox" /> Criar também a primeira agenda profissional</label><div className="modal-grid"><label>Nome profissional<input name="professionalName" maxLength={120} placeholder="Se vazio, usa o proprietário" /></label><label>Função<input name="professionalTitle" maxLength={120} placeholder="Ex.: Psicóloga" /></label></div><p className="modal-hint">A empresa será criada com proprietário, site público e isolamento de dados prontos para configuração.</p><div className="modal-actions"><button className="admin-ghost" onClick={() => setShowCreate(false)} type="button">Cancelar</button><button className="platform-primary" disabled={saving} type="submit">{saving ? "Criando..." : "Criar empresa"}</button></div></form></div>}
  </main>;
}

function TenantTable({ tenants }: { tenants: TenantRow[] }) {
  if (!tenants.length) return <p className="empty-state">Nenhuma empresa encontrada.</p>;
  return <div className="tenant-table"><div className="tenant-row tenant-head"><span>Empresa</span><span>Plano</span><span>Estrutura</span><span>Status</span><span /></div>{tenants.map((tenant) => <div className="tenant-row" key={tenant.id}><div className="tenant-identity"><i style={{ background: tenant.brand_color }}>{tenant.name.slice(0, 1).toUpperCase()}</i><span><strong>{tenant.name}</strong><small>/empresa/{tenant.slug}</small></span></div><span className="plan-pill">{planName(tenant.plan)}</span><span><strong>{Number(tenant.professionals ?? 0)} prof.</strong><small>{Number(tenant.administrators ?? 0)} admins · {Number(tenant.appointments ?? 0)} agendas</small></span><span className={tenant.is_active ? "tenant-active" : "tenant-inactive"}>{tenant.is_active ? "Ativa" : "Arquivada"}</span><Link href={`/plataforma/empresas/${encodeURIComponent(tenant.id)}`}>Gerenciar →</Link></div>)}</div>;
}

function PlatformMetric({ label, value, note }: { label: string; value: string; note: string }) { return <article><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function planName(plan: string) { return ({ trial: "Teste", essential: "Essencial", professional: "Profissional" } as Record<string, string>)[plan] ?? plan; }
async function apiJson<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, init); const body = await response.json() as T & { error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "A operação falhou."); return body; }
