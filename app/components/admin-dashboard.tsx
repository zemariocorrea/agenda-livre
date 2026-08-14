"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type View = "overview" | "agenda" | "services" | "availability" | "integrations";
type AdminService = { id: string; name: string; description: string; duration: number; priceCents: number; active: boolean; color: string };
type DayRule = { weekday: number; enabled: boolean; start: string; end: string; interval: number };
type Appointment = { id: string; customer_name: string; starts_at_utc: string; status: string; payment_status: string; service_name: string; duration_minutes: number };
type DashboardData = {
  tenant: { slug: string; name: string; timezone: string };
  user: { name: string; email: string; role: string };
  metrics: { today: number; upcoming: number; revenueCents: number; pendingNotifications: number };
  appointments: Appointment[];
  integrations: Array<{ provider: string; status: string; last_synced_at: string | null }>;
};

const navigation: Array<{ id: View; label: string; mark: string }> = [
  { id: "overview", label: "Visão geral", mark: "◫" },
  { id: "agenda", label: "Agenda", mark: "□" },
  { id: "services", label: "Atividades", mark: "＋" },
  { id: "availability", label: "Disponibilidade", mark: "⌁" },
  { id: "integrations", label: "Integrações", mark: "↗" },
];

const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const timeOptions = ["07:00", "07:30", "08:00", "08:30", "09:00", "12:00", "13:00", "17:00", "17:30", "18:00", "19:00", "20:00"];

export function AdminDashboard({ tenantSlug = "clinica-aurora" }: { tenantSlug?: string }) {
  const [view, setView] = useState<View>("overview");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [services, setServices] = useState<AdminService[]>([]);
  const [rules, setRules] = useState<DayRule[]>(() => weekdays.map((_, weekday) => ({ weekday, enabled: false, start: "08:30", end: "17:30", interval: 30 })));
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const query = `tenant=${encodeURIComponent(tenantSlug)}`;

  useEffect(() => {
    let active = true;
    Promise.all([
      apiJson<DashboardData>(`/api/admin/dashboard?${query}`),
      apiJson<{ services: Array<Record<string, unknown>> }>(`/api/admin/services?${query}`),
      apiJson<{ rules: Array<Record<string, unknown>> }>(`/api/admin/availability?${query}`),
    ])
      .then(([dashboardData, serviceData, availabilityData]) => {
        if (!active) return;
        setDashboard(dashboardData);
        setServices(serviceData.services.map(mapService));
        setRules((current) => current.map((day) => {
          const row = availabilityData.rules.find((item) => Number(item.weekday) === day.weekday && Boolean(item.is_active));
          return row ? { weekday: day.weekday, enabled: true, start: String(row.start_time), end: String(row.end_time), interval: Number(row.slot_interval_minutes) } : day;
        }));
      })
      .catch((loadError) => active && setMessage(loadError instanceof Error ? loadError.message : "Não foi possível carregar o painel."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [query]);

  const money = useMemo(() => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }), []);
  const publicUrl = `/?tenant=${encodeURIComponent(dashboard?.tenant.slug ?? tenantSlug)}`;
  const userInitials = (dashboard?.user.name ?? "Gestor").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  async function addService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    setMessage("");
    try {
      const result = await apiJson<{ service: { id: string; name: string; description: string; durationMinutes: number; priceCents: number } }>(`/api/admin/services?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          description: String(data.get("description") ?? ""),
          durationMinutes: Number(data.get("duration")),
          priceCents: Math.round(Number(data.get("price")) * 100),
          color: "#567f72",
        }),
      });
      setServices((current) => [...current, { id: result.service.id, name: result.service.name, description: result.service.description, duration: result.service.durationMinutes, priceCents: result.service.priceCents, active: true, color: "#567f72" }]);
      form.reset();
      setShowForm(false);
      setMessage("Atividade criada e publicada.");
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "Não foi possível salvar a atividade.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleService(id: string) {
    const current = services.find((service) => service.id === id);
    if (!current) return;
    const nextActive = !current.active;
    setServices((items) => items.map((item) => item.id === id ? { ...item, active: nextActive } : item));
    try {
      await apiJson(`/api/admin/services/${encodeURIComponent(id)}?${query}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
    } catch (toggleError) {
      setServices((items) => items.map((item) => item.id === id ? { ...item, active: current.active } : item));
      setMessage(toggleError instanceof Error ? toggleError.message : "Não foi possível alterar a publicação.");
    }
  }

  async function saveAvailability() {
    setSaving(true);
    setMessage("");
    try {
      await apiJson(`/api/admin/availability?${query}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: rules.filter((rule) => rule.enabled).map((rule) => ({ weekday: rule.weekday, startTime: rule.start, endTime: rule.end, slotIntervalMinutes: rule.interval, isActive: true })) }),
      });
      setMessage("Disponibilidade salva.");
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "Não foi possível salvar a disponibilidade.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="admin-brand" href={publicUrl}><span>A</span><strong>Agenda Livre</strong></Link>
        <nav aria-label="Navegação administrativa">
          {navigation.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)} type="button"><span>{item.mark}</span>{item.label}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="plan-meter"><span><strong>Plano Essencial</strong><small>{dashboard?.metrics.upcoming ?? 0} próximos horários</small></span><i><b /></i></div>
          <div className="profile-button"><span>{userInitials || "G"}</span><span><strong>{dashboard?.user.name ?? "Gestor"}</strong><small>{dashboard?.tenant.name ?? "Carregando..."}</small></span></div>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div><p>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date())}</p><h1>{titleFor(view, dashboard?.user.name)}</h1></div>
          <div className="admin-actions">
            <button className="icon-button" aria-label="Notificações" type="button">•<span>{dashboard?.metrics.pendingNotifications ?? 0}</span></button>
            <Link className="preview-link" href={publicUrl}>Ver página pública ↗</Link>
            {view === "services" ? <button className="admin-primary" onClick={() => setShowForm(true)} type="button">＋ Nova atividade</button> : null}
          </div>
        </header>

        {message ? <p className="form-error" role="status">{message}</p> : null}
        {loading ? <div className="admin-content"><section className="panel"><p>Carregando painel...</p></section></div> : null}
        {!loading && view === "overview" && <Overview dashboard={dashboard} money={money} />}
        {!loading && view === "agenda" && <Agenda appointments={dashboard?.appointments ?? []} timezone={dashboard?.tenant.timezone ?? "America/Sao_Paulo"} />}
        {!loading && view === "services" && <Services services={services} money={money} onToggle={toggleService} onAdd={() => setShowForm(true)} />}
        {!loading && view === "availability" && <Availability rules={rules} saving={saving} onChange={(weekday, patch) => setRules((current) => current.map((rule) => rule.weekday === weekday ? { ...rule, ...patch } : rule))} onSave={saveAvailability} />}
        {!loading && view === "integrations" && <Integrations tenantSlug={tenantSlug} integrations={dashboard?.integrations ?? []} pending={dashboard?.metrics.pendingNotifications ?? 0} />}
      </section>

      {showForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowForm(false)}>
          <form className="service-modal" onSubmit={addService} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><p className="eyebrow">Catálogo</p><h2>Nova atividade</h2></div><button aria-label="Fechar" onClick={() => setShowForm(false)} type="button">×</button></div>
            <label>Nome da atividade<input name="name" required maxLength={120} placeholder="Ex.: Consulta nutricional" /></label>
            <label>Descrição<textarea name="description" maxLength={500} placeholder="Explique brevemente o atendimento" /></label>
            <div className="modal-grid">
              <label>Duração<select name="duration" defaultValue="60"><option value="30">30 minutos</option><option value="45">45 minutos</option><option value="60">60 minutos</option><option value="90">90 minutos</option></select></label>
              <label>Preço (R$)<input name="price" min="0" step="0.01" type="number" defaultValue="150" /></label>
            </div>
            <p className="modal-hint">A atividade ficará disponível imediatamente na página pública.</p>
            <div className="modal-actions"><button className="admin-ghost" onClick={() => setShowForm(false)} type="button">Cancelar</button><button className="admin-primary" disabled={saving} type="submit">{saving ? "Salvando..." : "Salvar atividade"}</button></div>
          </form>
        </div>
      )}
    </main>
  );
}

function titleFor(view: View, displayName?: string) {
  const firstName = displayName?.split(" ")[0] ?? "gestor";
  return ({ overview: `Olá, ${firstName}`, agenda: "Agenda", services: "Atividades", availability: "Disponibilidade", integrations: "Integrações" })[view];
}

function Overview({ dashboard, money }: { dashboard: DashboardData | null; money: Intl.NumberFormat }) {
  const metrics = dashboard?.metrics;
  const appointments = dashboard?.appointments ?? [];
  const timezone = dashboard?.tenant.timezone ?? "America/Sao_Paulo";
  return (
    <div className="admin-content">
      <section className="metric-grid">
        <Metric label="Agendamentos hoje" value={String(metrics?.today ?? 0)} note="Confirmados ou pendentes" />
        <Metric label="Próximos horários" value={String(metrics?.upcoming ?? 0)} note="A partir de agora" />
        <Metric label="Receita no mês" value={money.format((metrics?.revenueCents ?? 0) / 100)} note="Pagamentos confirmados" />
        <Metric label="Avisos pendentes" value={String(metrics?.pendingNotifications ?? 0)} note="E-mail, agenda e painel" />
      </section>
      <div className="overview-grid">
        <section className="panel schedule-panel">
          <div className="panel-title"><div><p className="eyebrow">Próximos</p><h2>Agenda</h2></div></div>
          <AppointmentList appointments={appointments} timezone={timezone} />
        </section>
        <aside className="overview-side">
          <section className="panel next-slot"><div className="panel-title"><h2>Operação</h2><span>Agora</span></div><strong>{metrics?.pendingNotifications ?? 0}</strong><p>entregas assíncronas pendentes</p></section>
          <section className="panel activity-feed"><div className="panel-title"><h2>Estado das integrações</h2></div><ul>{dashboard?.integrations.length ? dashboard.integrations.map((item) => <li key={item.provider}><span className="feed-icon">↗</span><div><strong>{providerName(item.provider)}</strong><p>{item.status === "connected" ? "Conectado" : "Aguardando configuração"}</p></div></li>) : <li><div><strong>Nenhuma integração conectada</strong><p>Configure quando estiver pronto.</p></div></li>}</ul></section>
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="metric-card"><div><span>{label}</span></div><strong>{value}</strong><p>{note}</p></article>;
}

function Agenda({ appointments, timezone }: { appointments: Appointment[]; timezone: string }) {
  return <div className="admin-content"><section className="panel schedule-panel"><div className="panel-title"><div><p className="eyebrow">Agenda</p><h2>Próximos compromissos</h2></div></div><AppointmentList appointments={appointments} timezone={timezone} /></section></div>;
}

function AppointmentList({ appointments, timezone }: { appointments: Appointment[]; timezone: string }) {
  if (!appointments.length) return <p className="empty-state">Nenhum compromisso encontrado.</p>;
  return <div className="day-timeline">{appointments.map((item, index) => {
    const start = new Date(item.starts_at_utc);
    const end = new Date(start.getTime() + item.duration_minutes * 60_000);
    const time = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
    const date = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "short" });
    return <article className={`appointment ${["orange", "green", "sage"][index % 3]}`} key={item.id}><time>{time.format(start)}<small>{date.format(start)} · {time.format(end)}</small></time><i /><div><strong>{item.customer_name}</strong><span>{item.service_name}</span></div><span className={item.payment_status === "paid" ? "paid" : "pending"}>{item.payment_status === "paid" ? "Pago" : "No local"}</span></article>;
  })}</div>;
}

function Services({ services, money, onToggle, onAdd }: { services: AdminService[]; money: Intl.NumberFormat; onToggle: (id: string) => void; onAdd: () => void }) {
  return <div className="admin-content services-view"><div className="section-intro"><div><h2>Seu catálogo de atividades</h2><p>Defina livremente nome, duração, preço e publicação.</p></div><span>{services.filter((item) => item.active).length} atividades publicadas</span></div><section className="service-admin-grid">{services.map((service) => <article className={`service-admin-card ${service.active ? "" : "disabled"}`} key={service.id}><i style={{ background: service.color }} /><div className="service-admin-head"><span>{service.duration} min</span><label className="switch"><input checked={service.active} onChange={() => onToggle(service.id)} type="checkbox" /><b /></label></div><h3>{service.name}</h3><p>{service.description || "Atendimento configurado para agendamento online."}</p><strong>{money.format(service.priceCents / 100)}</strong></article>)}<button className="add-service-card" onClick={onAdd} type="button"><span>＋</span><strong>Adicionar atividade</strong><small>Crie uma nova opção de agendamento</small></button></section></div>;
}

function Availability({ rules, saving, onChange, onSave }: { rules: DayRule[]; saving: boolean; onChange: (weekday: number, patch: Partial<DayRule>) => void; onSave: () => void }) {
  return <div className="admin-content availability-view"><div className="availability-layout"><section className="panel availability-panel"><div className="panel-title"><div><h2>Horários recorrentes</h2><p>Defina quando sua agenda aceita novos horários.</p></div></div><div className="day-rules">{rules.map((rule) => <div className={rule.enabled ? "enabled" : ""} key={rule.weekday}><label className="switch"><input checked={rule.enabled} onChange={() => onChange(rule.weekday, { enabled: !rule.enabled })} type="checkbox" /><b /></label><strong>{weekdays[rule.weekday]}</strong>{rule.enabled ? <><select aria-label={`Início de ${weekdays[rule.weekday]}`} value={rule.start} onChange={(event) => onChange(rule.weekday, { start: event.target.value })}>{timeOptions.map((time) => <option key={time}>{time}</option>)}</select><span>até</span><select aria-label={`Fim de ${weekdays[rule.weekday]}`} value={rule.end} onChange={(event) => onChange(rule.weekday, { end: event.target.value })}>{timeOptions.map((time) => <option key={time}>{time}</option>)}</select></> : <small>Indisponível</small>}</div>)}</div><div className="availability-save"><span>Intervalos de <select value={rules.find((rule) => rule.enabled)?.interval ?? 30} onChange={(event) => setAllIntervals(rules, Number(event.target.value), onChange)}><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option></select></span><button className="admin-primary" disabled={saving} onClick={onSave} type="button">{saving ? "Salvando..." : "Salvar disponibilidade"}</button></div></section><aside className="panel rules-note"><span>⌁</span><h3>Como funciona?</h3><p>Os horários públicos são calculados usando esta disponibilidade, a duração da atividade, bloqueios e compromissos já existentes.</p><ul><li>Nunca oferecemos horários sobrepostos</li><li>O fuso da empresa é respeitado</li><li>Alterações refletem imediatamente</li></ul></aside></div></div>;
}

function Integrations({ tenantSlug, integrations, pending }: { tenantSlug: string; integrations: DashboardData["integrations"]; pending: number }) {
  const google = integrations.find((item) => item.provider === "google_calendar");
  return <div className="admin-content integrations-view"><div className="section-intro"><div><h2>Conexões do negócio</h2><p>Centralize agenda, pagamento e avisos sem acoplar o núcleo do produto.</p></div></div><section className="integration-grid"><article className={`integration-card ${google?.status === "connected" ? "connected" : ""}`}><div className="integration-logo google">31</div><div><span className={`status-dot ${google?.status === "connected" ? "" : "muted"}`}>{google?.status === "connected" ? "Conectado" : "Configurar"}</span><h3>Google Agenda</h3><p>Cria o compromisso na agenda do administrador e convida o cliente automaticamente.</p></div><Link href={`/api/admin/integrations/google/start?tenant=${encodeURIComponent(tenantSlug)}`}>{google?.status === "connected" ? "Reconectar" : "Conectar"}</Link></article><article className="integration-card"><div className="integration-logo stripe">S</div><div><span className="status-dot muted">Por variável de ambiente</span><h3>Pagamentos</h3><p>Pagamento opcional em checkout seguro.</p><small>Adaptador: Stripe Checkout</small></div></article><article className="integration-card"><div className="integration-logo email">@</div><div><span className="status-dot muted">Por variável de ambiente</span><h3>E-mails transacionais</h3><p>Confirmações para cliente e administrador.</p><small>Adaptador: Resend</small></div></article></section><section className="panel async-health"><div><span className="pulse" /><div><strong>Processamento assíncrono</strong><p>{pending ? `${pending} entrega(s) aguardando processamento.` : "Nenhum evento pendente no painel."}</p></div></div></section></div>;
}

function mapService(item: Record<string, unknown>): AdminService {
  return { id: String(item.id), name: String(item.name), description: String(item.description ?? ""), duration: Number(item.duration_minutes), priceCents: Number(item.price_cents), active: Boolean(item.is_active), color: String(item.color ?? "#567f72") };
}

async function apiJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? "A operação não pôde ser concluída.");
  return data;
}

function providerName(provider: string) {
  return ({ google_calendar: "Google Agenda", stripe: "Stripe", email: "E-mail" } as Record<string, string>)[provider] ?? provider;
}

function setAllIntervals(rules: DayRule[], interval: number, onChange: (weekday: number, patch: Partial<DayRule>) => void) {
  for (const rule of rules) onChange(rule.weekday, { interval });
}
