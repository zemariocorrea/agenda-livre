"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { LogoutButton } from "./logout-button";
import { TemporaryCredentials } from "./temporary-credentials";
import { parseLocalDateTime, partsInZone } from "@/lib/timezone";

type View = "overview" | "agenda" | "administrators" | "professionals" | "services" | "availability" | "blocks" | "integrations" | "company";
type DayRule = { weekday: number; enabled: boolean; start: string; end: string; interval: number };
type RawRule = { professional_id: string; weekday: number; start_time: string; end_time: string; slot_interval_minutes: number; is_active: number };
type AdminService = { id: string; name: string; description: string; duration: number; priceCents: number; active: boolean; color: string; professionalIds: string[] };
type AdminProfessional = { id: string; name: string; title: string; bio: string; email: string; color: string; active: boolean; serviceIds: string[]; googleStatus: string | null };
type Appointment = { id: string; customer_name: string; customer_email: string; customer_phone: string; starts_at_utc: string; ends_at_utc?: string; status: string; payment_status: string; service_name: string; duration_minutes?: number; professional_id: string; professional_name: string; professional_color: string };
type Integration = { provider: string; status: string; last_synced_at: string | null; professional_id: string | null; professional_name: string | null };
type AdminMember = { id: string; email: string; display_name: string; role: string; is_active: number };
type AdminBlock = { id: string; professional_id: string | null; professional_name: string | null; starts_at_utc: string; ends_at_utc: string; reason: string };
type CompanySettings = { id: string; slug: string; name: string; subtitle: string; timezone: string; location: string; contact_email: string; plan: string; max_professionals: number; brand_color: string; hero_title: string; hero_description: string };
type DashboardData = {
  tenant: { slug: string; name: string; timezone: string; plan: string; maxProfessionals: number };
  user: { name: string; email: string; role: string };
  metrics: { today: number; upcoming: number; revenueCents: number; pendingNotifications: number; professionals: number };
  appointments: Appointment[];
  integrations: Integration[];
};

const navigation: Array<{ id: View; label: string; mark: string }> = [
  { id: "overview", label: "Visão geral", mark: "◫" },
  { id: "agenda", label: "Agenda", mark: "□" },
  { id: "administrators", label: "Administradores", mark: "♙" },
  { id: "professionals", label: "Profissionais", mark: "◎" },
  { id: "services", label: "Atividades", mark: "＋" },
  { id: "availability", label: "Disponibilidade", mark: "⌁" },
  { id: "blocks", label: "Bloqueios", mark: "⊘" },
  { id: "integrations", label: "Integrações", mark: "↗" },
  { id: "company", label: "Empresa e site", mark: "◇" },
];
const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const timeOptions = ["07:00", "07:30", "08:00", "08:30", "09:00", "12:00", "13:00", "17:00", "17:30", "18:00", "19:00", "20:00"];
const emptyRules = () => weekdays.map((_, weekday) => ({ weekday, enabled: false, start: "08:30", end: "17:30", interval: 30 }));

export function AdminDashboard({ tenantSlug = "clinica-aurora" }: { tenantSlug?: string }) {
  const [view, setView] = useState<View>("overview");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [services, setServices] = useState<AdminService[]>([]);
  const [professionals, setProfessionals] = useState<AdminProfessional[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [blocks, setBlocks] = useState<AdminBlock[]>([]);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [rawRules, setRawRules] = useState<RawRule[]>([]);
  const [selectedProfessionalId, setSelectedProfessionalId] = useState("");
  const [rules, setRules] = useState<DayRule[]>(emptyRules);
  const [modal, setModal] = useState<"service" | "professional" | "member" | "block" | null>(null);
  const [editingProfessional, setEditingProfessional] = useState<AdminProfessional | null>(null);
  const [editingService, setEditingService] = useState<AdminService | null>(null);
  const [editingMember, setEditingMember] = useState<AdminMember | null>(null);
  const [editingBlock, setEditingBlock] = useState<AdminBlock | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [temporaryAccess, setTemporaryAccess] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const query = `tenant=${encodeURIComponent(tenantSlug)}`;

  useEffect(() => {
    let active = true;
    Promise.all([
      apiJson<DashboardData>(`/api/admin/dashboard?${query}`),
      apiJson<{ services: Array<Record<string, unknown>> }>(`/api/admin/services?${query}`),
      apiJson<{ professionals: Array<Record<string, unknown>> }>(`/api/admin/professionals?${query}`),
      apiJson<{ rules: RawRule[] }>(`/api/admin/availability?${query}`),
      apiJson<{ members: AdminMember[] }>(`/api/admin/members?${query}`),
      apiJson<{ blocks: AdminBlock[] }>(`/api/admin/blocked-periods?${query}`),
      apiJson<{ appointments: Appointment[] }>(`/api/admin/appointments?${query}`),
      apiJson<{ company: CompanySettings }>(`/api/admin/company?${query}`),
    ]).then(([dashboardData, serviceData, professionalData, availabilityData, memberData, blockData, appointmentData, companyData]) => {
      if (!active) return;
      const mappedProfessionals = professionalData.professionals.map(mapProfessional);
      const initialProfessionalId = mappedProfessionals.find((professional) => professional.active)?.id ?? mappedProfessionals[0]?.id ?? "";
      setDashboard(dashboardData);
      setServices(serviceData.services.map(mapService));
      setProfessionals(mappedProfessionals);
      setAppointments(appointmentData.appointments);
      setMembers(memberData.members);
      setBlocks(blockData.blocks);
      setCompany(companyData.company);
      setRawRules(availabilityData.rules);
      setSelectedProfessionalId(initialProfessionalId);
      setRules(rulesFor(availabilityData.rules, initialProfessionalId));
    }).catch((error) => active && setMessage(error instanceof Error ? error.message : "Não foi possível carregar o painel."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [query]);

  const money = useMemo(() => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }), []);
  const publicUrl = `/empresa/${encodeURIComponent(dashboard?.tenant.slug ?? tenantSlug)}`;
  const initials = (dashboard?.user.name ?? "Gestor").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  async function addService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const professionalIds = data.getAll("professionalIds").map(String);
    await performSave(async () => {
      const endpoint = editingService ? `/api/admin/services/${encodeURIComponent(editingService.id)}?${query}` : `/api/admin/services?${query}`;
      const result = await apiJson<{ service: { id: string; name: string; description: string; durationMinutes: number; priceCents: number; isActive?: boolean; professionalIds: string[] } }>(endpoint, {
        method: editingService ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          name: String(data.get("name") ?? ""), description: String(data.get("description") ?? ""),
          durationMinutes: Number(data.get("duration")), priceCents: Math.round(Number(data.get("price")) * 100),
          color: String(data.get("color") ?? "#567f72"), professionalIds,
        }),
      });
      const service = result.service;
      const mapped = { id: service.id, name: service.name, description: service.description, duration: service.durationMinutes, priceCents: service.priceCents, active: service.isActive ?? editingService?.active ?? true, color: String(data.get("color") ?? "#567f72"), professionalIds: service.professionalIds };
      setServices((items) => editingService ? items.map((item) => item.id === mapped.id ? mapped : item) : [...items, mapped]);
      setProfessionals((items) => items.map((professional) => ({ ...professional, serviceIds: professionalIds.includes(professional.id) ? [...new Set([...professional.serviceIds, service.id])] : professional.serviceIds.filter((id) => id !== service.id) })));
      form.reset(); setModal(null); setEditingService(null); setMessage(editingService ? "Atividade atualizada." : "Atividade criada e vinculada aos profissionais.");
    }, "Não foi possível salvar a atividade.");
  }

  async function addProfessional(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const serviceIds = data.getAll("serviceIds").map(String);
    await performSave(async () => {
      const payload = { name: String(data.get("name") ?? ""), title: String(data.get("title") ?? ""), email: String(data.get("email") ?? ""), bio: String(data.get("bio") ?? ""), color: String(data.get("color") ?? "#17624f"), serviceIds };
      const endpoint = editingProfessional ? `/api/admin/professionals/${encodeURIComponent(editingProfessional.id)}?${query}` : `/api/admin/professionals?${query}`;
      const result = await apiJson<{ professional: { id: string; name: string; title: string; bio: string; email: string; color: string; isActive: boolean; serviceIds: string[] } }>(endpoint, {
        method: editingProfessional ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const professional = result.professional;
      const mapped = { id: professional.id, name: professional.name, title: professional.title, bio: professional.bio, email: professional.email, color: professional.color, active: professional.isActive, serviceIds: professional.serviceIds, googleStatus: editingProfessional?.googleStatus ?? null };
      setProfessionals((items) => editingProfessional ? items.map((item) => item.id === professional.id ? mapped : item) : [...items, mapped]);
      setServices((items) => items.map((service) => ({ ...service, professionalIds: serviceIds.includes(service.id) ? [...new Set([...service.professionalIds, professional.id])] : service.professionalIds.filter((id) => id !== professional.id) })));
      setSelectedProfessionalId((current) => current || professional.id);
      form.reset(); setModal(null); setEditingProfessional(null); setMessage(editingProfessional ? "Profissional e atividades atualizados." : "Profissional adicionado à equipe.");
    }, "Não foi possível salvar o profissional.");
  }

  async function toggleService(id: string) {
    const current = services.find((service) => service.id === id);
    if (!current) return;
    const isActive = !current.active;
    setServices((items) => items.map((item) => item.id === id ? { ...item, active: isActive } : item));
    try {
      await apiJson(`/api/admin/services/${encodeURIComponent(id)}?${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
    } catch (error) {
      setServices((items) => items.map((item) => item.id === id ? current : item));
      setMessage(error instanceof Error ? error.message : "Não foi possível alterar a atividade.");
    }
  }

  async function toggleProfessional(id: string) {
    const current = professionals.find((professional) => professional.id === id);
    if (!current) return;
    const isActive = !current.active;
    setProfessionals((items) => items.map((item) => item.id === id ? { ...item, active: isActive } : item));
    try {
      await apiJson(`/api/admin/professionals/${encodeURIComponent(id)}?${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
    } catch (error) {
      setProfessionals((items) => items.map((item) => item.id === id ? current : item));
      setMessage(error instanceof Error ? error.message : "Não foi possível alterar o profissional.");
    }
  }

  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await performSave(async () => {
      const endpoint = editingMember ? `/api/admin/members/${encodeURIComponent(editingMember.id)}?${query}` : `/api/admin/members?${query}`;
      const result = await apiJson<{ member: { id: string; email: string; displayName: string; role: string; isActive: boolean }; credentials?: { email: string; temporaryPassword: string } | null }>(endpoint, {
        method: editingMember ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: data.get("displayName"), email: data.get("email"), role: data.get("role") }),
      });
      const mapped = { id: result.member.id, email: result.member.email, display_name: result.member.displayName, role: result.member.role, is_active: result.member.isActive ? 1 : 0 };
      setMembers((items) => editingMember ? items.map((item) => item.id === mapped.id ? mapped : item) : [...items, mapped]);
      form.reset(); setModal(null); setEditingMember(null);
      if (result.credentials) setTemporaryAccess(result.credentials);
      setMessage(editingMember ? "Acesso atualizado." : "Administrador adicionado à empresa.");
    }, "Não foi possível adicionar o administrador.");
  }

  async function toggleMember(member: AdminMember) {
    if (member.role === "owner") return;
    const isActive = !Boolean(member.is_active);
    try {
      await apiJson(`/api/admin/members/${encodeURIComponent(member.id)}?${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
      setMembers((items) => items.map((item) => item.id === member.id ? { ...item, is_active: isActive ? 1 : 0 } : item));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível alterar o acesso."); }
  }

  async function addBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const timezone = dashboard?.tenant.timezone ?? "America/Sao_Paulo";
    const startsAt = localDateToIso(String(data.get("startsAt") ?? ""), timezone);
    const endsAt = localDateToIso(String(data.get("endsAt") ?? ""), timezone);
    await performSave(async () => {
      const endpoint = editingBlock ? `/api/admin/blocked-periods/${encodeURIComponent(editingBlock.id)}?${query}` : `/api/admin/blocked-periods?${query}`;
      const result = await apiJson<{ block?: { id: string } }>(endpoint, {
        method: editingBlock ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ professionalId: data.get("professionalId") || null, startsAtUtc: startsAt, endsAtUtc: endsAt, reason: data.get("reason") }),
      });
      const professionalId = String(data.get("professionalId") ?? "") || null;
      const professional = professionals.find((item) => item.id === professionalId);
      const mapped = { id: editingBlock?.id ?? result.block?.id ?? crypto.randomUUID(), professional_id: professionalId, professional_name: professional?.name ?? null, starts_at_utc: startsAt, ends_at_utc: endsAt, reason: String(data.get("reason") ?? "Bloqueio manual") };
      setBlocks((items) => (editingBlock ? items.map((item) => item.id === mapped.id ? mapped : item) : [...items, mapped]).sort((a, b) => a.starts_at_utc.localeCompare(b.starts_at_utc)));
      form.reset(); setModal(null); setEditingBlock(null); setMessage(editingBlock ? "Bloqueio atualizado." : "Bloqueio criado.");
    }, "Não foi possível criar o bloqueio.");
  }

  async function deleteBlock(id: string) {
    try {
      await apiJson(`/api/admin/blocked-periods/${encodeURIComponent(id)}?${query}`, { method: "DELETE" });
      setBlocks((items) => items.filter((item) => item.id !== id)); setMessage("Bloqueio removido.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível remover o bloqueio."); }
  }

  async function updateAppointmentStatus(id: string, status: string) {
    const current = appointments.find((item) => item.id === id);
    if (!current) return;
    setAppointments((items) => items.map((item) => item.id === id ? { ...item, status } : item));
    try { await apiJson(`/api/admin/appointments/${encodeURIComponent(id)}?${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); }
    catch (error) { setAppointments((items) => items.map((item) => item.id === id ? current : item)); setMessage(error instanceof Error ? error.message : "Não foi possível alterar o agendamento."); }
  }

  async function saveCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await performSave(async () => {
      await apiJson(`/api/admin/company?${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: data.get("name"), subtitle: data.get("subtitle"), location: data.get("location"), timezone: data.get("timezone"), contactEmail: data.get("contactEmail"), brandColor: data.get("brandColor"), heroTitle: data.get("heroTitle"), heroDescription: data.get("heroDescription") }) });
      setCompany((current) => current ? { ...current, name: String(data.get("name")), subtitle: String(data.get("subtitle")), location: String(data.get("location")), timezone: String(data.get("timezone")), contact_email: String(data.get("contactEmail")), brand_color: String(data.get("brandColor")), hero_title: String(data.get("heroTitle")), hero_description: String(data.get("heroDescription")) } : current);
      setMessage("Dados da empresa e do site atualizados.");
    }, "Não foi possível salvar a empresa.");
  }

  async function saveAvailability() {
    if (!selectedProfessionalId) return setMessage("Cadastre um profissional antes de definir horários.");
    await performSave(async () => {
      const savedRules = rules.filter((rule) => rule.enabled).map((rule) => ({ weekday: rule.weekday, startTime: rule.start, endTime: rule.end, slotIntervalMinutes: rule.interval, isActive: true }));
      await apiJson(`/api/admin/availability?${query}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ professionalId: selectedProfessionalId, rules: savedRules }) });
      setRawRules((items) => [...items.filter((item) => item.professional_id !== selectedProfessionalId), ...savedRules.map((rule) => ({ professional_id: selectedProfessionalId, weekday: rule.weekday, start_time: rule.startTime, end_time: rule.endTime, slot_interval_minutes: rule.slotIntervalMinutes, is_active: 1 }))]);
      setMessage("Disponibilidade individual salva.");
    }, "Não foi possível salvar a disponibilidade.");
  }

  async function performSave(action: () => Promise<void>, fallback: string) {
    setSaving(true); setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : fallback); } finally { setSaving(false); }
  }

  return <main className="admin-shell">
    <aside className="admin-sidebar">
      <Link className="admin-brand" href={publicUrl}><span>A</span><strong>Agenda Livre</strong></Link>
      <nav aria-label="Navegação administrativa">{navigation.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)} type="button"><span>{item.mark}</span>{item.label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="plan-meter"><span><strong>Plano {planName(dashboard?.tenant.plan ?? "essential")}</strong><small>{dashboard?.metrics.professionals ?? 0}/{dashboard?.tenant.maxProfessionals ?? 10} profissionais</small></span><i><b style={{ width: `${Math.min(100, ((dashboard?.metrics.professionals ?? 0) / (dashboard?.tenant.maxProfessionals || 10)) * 100)}%` }} /></i></div><div className="profile-button"><span>{initials || "G"}</span><span><strong>{dashboard?.user.name ?? "Gestor"}</strong><small>{dashboard?.tenant.name ?? "Carregando..."}</small></span></div><LogoutButton className="admin-logout" /></div>
    </aside>
    <section className="admin-main">
      <header className="admin-topbar"><div><p>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date())}</p><h1>{titleFor(view, dashboard?.user.name)}</h1></div><div className="admin-actions"><button className="icon-button" aria-label="Notificações" type="button">•<span>{dashboard?.metrics.pendingNotifications ?? 0}</span></button><Link className="preview-link" href={publicUrl}>Ver página pública ↗</Link>{view === "services" && <button className="admin-primary" onClick={() => { setEditingService(null); setModal("service"); }} type="button">＋ Nova atividade</button>}{view === "professionals" && <button className="admin-primary" onClick={() => { setEditingProfessional(null); setModal("professional"); }} type="button">＋ Novo profissional</button>}{view === "administrators" && <button className="admin-primary" onClick={() => { setEditingMember(null); setModal("member"); }} type="button">＋ Novo administrador</button>}{view === "blocks" && <button className="admin-primary" onClick={() => { setEditingBlock(null); setModal("block"); }} type="button">＋ Novo bloqueio</button>}</div></header>
      {message && <p className="form-error admin-message" role="status">{message}</p>}
      {loading && <div className="admin-content"><section className="panel"><p>Carregando painel...</p></section></div>}
      {!loading && view === "overview" && <Overview dashboard={dashboard} money={money} />}
      {!loading && view === "agenda" && <Agenda appointments={appointments} timezone={dashboard?.tenant.timezone ?? "America/Sao_Paulo"} onStatus={updateAppointmentStatus} />}
      {!loading && view === "administrators" && <Administrators members={members} onAdd={() => { setEditingMember(null); setModal("member"); }} onEdit={(member) => { setEditingMember(member); setModal("member"); }} onToggle={toggleMember} />}
      {!loading && view === "professionals" && <Professionals professionals={professionals} services={services} onToggle={toggleProfessional} onEdit={(professional) => { setEditingProfessional(professional); setModal("professional"); }} onAdd={() => { setEditingProfessional(null); setModal("professional"); }} />}
      {!loading && view === "services" && <Services services={services} professionals={professionals} money={money} onToggle={toggleService} onEdit={(service) => { setEditingService(service); setModal("service"); }} onAdd={() => { setEditingService(null); setModal("service"); }} />}
      {!loading && view === "availability" && <Availability professionals={professionals} selectedId={selectedProfessionalId} rules={rules} saving={saving} onSelect={(id) => { setSelectedProfessionalId(id); setRules(rulesFor(rawRules, id)); }} onChange={(weekday, patch) => setRules((items) => items.map((rule) => rule.weekday === weekday ? { ...rule, ...patch } : rule))} onSave={saveAvailability} />}
      {!loading && view === "blocks" && <Blocks blocks={blocks} timezone={dashboard?.tenant.timezone ?? "America/Sao_Paulo"} onAdd={() => { setEditingBlock(null); setModal("block"); }} onEdit={(block) => { setEditingBlock(block); setModal("block"); }} onDelete={deleteBlock} />}
      {!loading && view === "integrations" && <Integrations tenantSlug={tenantSlug} professionals={professionals} integrations={dashboard?.integrations ?? []} pending={dashboard?.metrics.pendingNotifications ?? 0} />}
      {!loading && view === "company" && <CompanySettingsView company={company} saving={saving} onSave={saveCompany} />}
    </section>
    {temporaryAccess && <TemporaryCredentials credentials={temporaryAccess} title="Acesso administrativo criado" onClose={() => setTemporaryAccess(null)} />}
    {modal === "service" && <Modal onClose={() => { setModal(null); setEditingService(null); }}><form className="service-modal" onSubmit={addService}><ModalHead eyebrow="Catálogo" title={editingService ? "Editar atividade" : "Nova atividade"} onClose={() => { setModal(null); setEditingService(null); }} /><label>Nome da atividade<input name="name" required maxLength={120} placeholder="Ex.: Consulta nutricional" defaultValue={editingService?.name} /></label><label>Descrição<textarea name="description" maxLength={500} placeholder="Explique brevemente o atendimento" defaultValue={editingService?.description} /></label><div className="modal-grid"><label>Duração<select name="duration" defaultValue={String(editingService?.duration ?? 60)}><option value="30">30 minutos</option><option value="45">45 minutos</option><option value="60">60 minutos</option><option value="90">90 minutos</option></select></label><label>Preço (R$)<input name="price" min="0" step="0.01" type="number" defaultValue={(editingService?.priceCents ?? 15000) / 100} /></label></div><label>Cor<input className="color-input" name="color" type="color" defaultValue={editingService?.color ?? "#567f72"} /></label><CheckboxGroup name="professionalIds" title="Profissionais que atendem" selectedIds={editingService?.professionalIds} items={professionals.filter((item) => item.active).map((item) => ({ id: item.id, label: item.name }))} /><ModalActions saving={saving} label="Salvar atividade" onClose={() => { setModal(null); setEditingService(null); }} /></form></Modal>}
    {modal === "professional" && <Modal onClose={() => { setModal(null); setEditingProfessional(null); }}><form className="service-modal" onSubmit={addProfessional}><ModalHead eyebrow="Equipe" title={editingProfessional ? "Editar profissional" : "Novo profissional"} onClose={() => { setModal(null); setEditingProfessional(null); }} /><div className="modal-grid"><label>Nome<input name="name" required maxLength={120} placeholder="Nome completo" defaultValue={editingProfessional?.name} /></label><label>Função<input name="title" required maxLength={120} placeholder="Ex.: Psicóloga" defaultValue={editingProfessional?.title} /></label></div><label>E-mail<input name="email" type="email" maxLength={200} placeholder="profissional@clinica.com" defaultValue={editingProfessional?.email} /></label><label>Apresentação<textarea name="bio" maxLength={800} placeholder="Especialidade e breve apresentação" defaultValue={editingProfessional?.bio} /></label><label>Cor da agenda<input className="color-input" name="color" type="color" defaultValue={editingProfessional?.color ?? "#17624f"} /></label><CheckboxGroup name="serviceIds" title="Atividades realizadas" selectedIds={editingProfessional?.serviceIds} items={services.filter((item) => item.active).map((item) => ({ id: item.id, label: item.name }))} /><ModalActions saving={saving} label="Salvar profissional" onClose={() => { setModal(null); setEditingProfessional(null); }} /></form></Modal>}
    {modal === "member" && <Modal onClose={() => { setModal(null); setEditingMember(null); }}><form className="service-modal" onSubmit={saveMember}><ModalHead eyebrow="Acesso" title={editingMember ? "Editar administrador" : "Novo administrador"} onClose={() => { setModal(null); setEditingMember(null); }} /><label>Nome completo<input name="displayName" required maxLength={120} defaultValue={editingMember?.display_name} /></label><label>E-mail de acesso<input name="email" required type="email" maxLength={254} defaultValue={editingMember?.email} readOnly={Boolean(editingMember)} /></label><label>Permissão<select name="role" defaultValue={editingMember?.role ?? "admin"}><option value="admin">Administrador</option><option value="staff">Equipe operacional</option></select></label><p className="modal-hint">O usuário acessará somente esta empresa. O proprietário permanece protegido.</p><ModalActions saving={saving} label="Salvar acesso" onClose={() => { setModal(null); setEditingMember(null); }} /></form></Modal>}
    {modal === "block" && <Modal onClose={() => { setModal(null); setEditingBlock(null); }}><form className="service-modal" onSubmit={addBlock}><ModalHead eyebrow="Agenda" title={editingBlock ? "Editar bloqueio" : "Novo bloqueio"} onClose={() => { setModal(null); setEditingBlock(null); }} /><label>Escopo<select name="professionalId" defaultValue={editingBlock?.professional_id ?? ""}><option value="">Toda a empresa</option>{professionals.map((professional) => <option key={professional.id} value={professional.id}>{professional.name}</option>)}</select></label><div className="modal-grid"><label>Início<input name="startsAt" required type="datetime-local" defaultValue={editingBlock ? dateTimeInput(editingBlock.starts_at_utc, dashboard?.tenant.timezone ?? "America/Sao_Paulo") : undefined} /></label><label>Fim<input name="endsAt" required type="datetime-local" defaultValue={editingBlock ? dateTimeInput(editingBlock.ends_at_utc, dashboard?.tenant.timezone ?? "America/Sao_Paulo") : undefined} /></label></div><label>Motivo<input name="reason" required maxLength={300} placeholder="Feriado, reunião, férias..." defaultValue={editingBlock?.reason} /></label><p className="modal-hint">Um bloqueio global impede todas as agendas; o individual afeta apenas o profissional escolhido.</p><ModalActions saving={saving} label="Salvar bloqueio" onClose={() => { setModal(null); setEditingBlock(null); }} /></form></Modal>}
  </main>;
}

function titleFor(view: View, displayName?: string) {
  const firstName = displayName?.split(" ")[0] ?? "gestor";
  return ({ overview: `Olá, ${firstName}`, agenda: "Agendamentos", administrators: "Administradores", professionals: "Profissionais", services: "Atividades", availability: "Disponibilidades", blocks: "Bloqueios", integrations: "Integrações", company: "Empresa e site" })[view];
}

function Overview({ dashboard, money }: { dashboard: DashboardData | null; money: Intl.NumberFormat }) {
  const metrics = dashboard?.metrics;
  const appointments = dashboard?.appointments ?? [];
  return <div className="admin-content"><section className="metric-grid"><Metric label="Agendamentos hoje" value={String(metrics?.today ?? 0)} note="Confirmados ou pendentes" /><Metric label="Próximos horários" value={String(metrics?.upcoming ?? 0)} note="Em todas as agendas" /><Metric label="Profissionais ativos" value={String(metrics?.professionals ?? 0)} note="Agendas independentes" /><Metric label="Receita no mês" value={money.format((metrics?.revenueCents ?? 0) / 100)} note="Pagamentos confirmados" /></section><div className="overview-grid"><section className="panel schedule-panel"><div className="panel-title"><div><p className="eyebrow">Próximos</p><h2>Agenda da equipe</h2></div></div><AppointmentList appointments={appointments} timezone={dashboard?.tenant.timezone ?? "America/Sao_Paulo"} /></section><aside className="overview-side"><section className="panel next-slot"><div className="panel-title"><h2>Operação</h2><span>Agora</span></div><strong>{metrics?.pendingNotifications ?? 0}</strong><p>entregas assíncronas pendentes</p></section><section className="panel activity-feed"><div className="panel-title"><h2>Integrações individuais</h2></div><ul>{dashboard?.integrations.length ? dashboard.integrations.map((item) => <li key={`${item.provider}-${item.professional_id ?? "tenant"}`}><span className="feed-icon">↗</span><div><strong>{item.professional_name ?? providerName(item.provider)}</strong><p>{item.status === "connected" ? "Google Agenda conectado" : "Aguardando configuração"}</p></div></li>) : <li><div><strong>Nenhuma agenda conectada</strong><p>Cada profissional conecta a própria conta.</p></div></li>}</ul></section></aside></div></div>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <article className="metric-card"><div><span>{label}</span></div><strong>{value}</strong><p>{note}</p></article>; }
function Agenda({ appointments, timezone, onStatus }: { appointments: Appointment[]; timezone: string; onStatus: (id: string, status: string) => void }) { return <div className="admin-content"><section className="panel schedule-panel"><div className="panel-title"><div><p className="eyebrow">Operação</p><h2>Todos os agendamentos</h2><p>Atualize confirmações, conclusão, faltas e cancelamentos.</p></div><span>{appointments.length} registros</span></div><AppointmentList appointments={appointments} timezone={timezone} onStatus={onStatus} /></section></div>; }

function AppointmentList({ appointments, timezone, onStatus }: { appointments: Appointment[]; timezone: string; onStatus?: (id: string, status: string) => void }) {
  if (!appointments.length) return <p className="empty-state">Nenhum compromisso encontrado.</p>;
  return <div className="day-timeline">{appointments.map((item) => { const start = new Date(item.starts_at_utc); const end = item.ends_at_utc ? new Date(item.ends_at_utc) : new Date(start.getTime() + (item.duration_minutes ?? 60) * 60_000); const time = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }); const date = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "short" }); return <article className="appointment" key={item.id}><time>{time.format(start)}<small>{date.format(start)} · {time.format(end)}</small></time><i style={{ background: item.professional_color }} /><div><strong>{item.customer_name}</strong><span>{item.service_name} · {item.professional_name}</span>{onStatus && <small>{item.customer_email || item.customer_phone}</small>}</div><span className={item.payment_status === "paid" ? "paid" : "pending"}>{item.payment_status === "paid" ? "Pago" : "No local"}</span>{onStatus && <select className={`appointment-status ${item.status}`} aria-label={`Status de ${item.customer_name}`} value={item.status} onChange={(event) => onStatus(item.id, event.target.value)}><option value="pending">Pendente</option><option value="confirmed">Confirmado</option><option value="completed">Concluído</option><option value="no_show">Faltou</option><option value="cancelled">Cancelado</option></select>}</article>; })}</div>;
}

function Administrators({ members, onToggle, onEdit, onAdd }: { members: AdminMember[]; onToggle: (member: AdminMember) => void; onEdit: (member: AdminMember) => void; onAdd: () => void }) {
  return <div className="admin-content"><div className="section-intro"><div><h2>Acessos da empresa</h2><p>Administradores gerenciam configurações; equipe operacional cuida da agenda.</p></div><span>{members.filter((item) => item.is_active).length} acessos ativos</span></div><section className="member-grid">{members.map((member) => <article className={`member-card ${member.is_active ? "" : "disabled"}`} key={member.id}><span>{initialsFor(member.display_name)}</span><div><h3>{member.display_name}</h3><p>{member.email}</p><strong>{roleName(member.role)}</strong>{member.role !== "owner" && <button className="inline-edit" onClick={() => onEdit(member)} type="button">Editar acesso</button>}</div>{member.role === "owner" ? <small>Protegido</small> : <label className="switch"><input checked={Boolean(member.is_active)} onChange={() => onToggle(member)} type="checkbox" /><b /></label>}</article>)}<button className="add-service-card member-add" onClick={onAdd} type="button"><span>＋</span><strong>Adicionar administrador</strong><small>Acesso restrito a esta empresa</small></button></section></div>;
}

function Blocks({ blocks, timezone, onAdd, onEdit, onDelete }: { blocks: AdminBlock[]; timezone: string; onAdd: () => void; onEdit: (block: AdminBlock) => void; onDelete: (id: string) => void }) {
  const format = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  return <div className="admin-content"><div className="section-intro"><div><h2>Exceções de agenda</h2><p>Bloqueie toda a empresa ou apenas uma agenda profissional.</p></div><span>{blocks.length} bloqueios</span></div><section className="panel block-list">{blocks.length ? blocks.map((block) => <article key={block.id}><span className={block.professional_id ? "individual" : "global"}>{block.professional_id ? "Individual" : "Global"}</span><div><strong>{block.reason}</strong><p>{block.professional_name ?? "Todos os profissionais"}</p></div><time>{format(block.starts_at_utc)}<small>até {format(block.ends_at_utc)}</small></time><div className="block-actions"><button onClick={() => onEdit(block)} type="button">Editar</button><button aria-label={`Remover ${block.reason}`} onClick={() => onDelete(block.id)} type="button">Remover</button></div></article>) : <div className="empty-action"><p>Nenhum bloqueio cadastrado.</p><button className="admin-primary" onClick={onAdd} type="button">Criar primeiro bloqueio</button></div>}</section></div>;
}

function CompanySettingsView({ company, saving, onSave }: { company: CompanySettings | null; saving: boolean; onSave: (event: FormEvent<HTMLFormElement>) => void }) {
  if (!company) return <div className="admin-content"><section className="panel"><p className="empty-state">Empresa não encontrada.</p></section></div>;
  return <div className="admin-content"><div className="section-intro"><div><h2>Identidade e página pública</h2><p>O Admin Master controla plano e slug; a empresa controla sua apresentação.</p></div><span>Plano {planName(company.plan)}</span></div><form className="panel company-admin-form" key={company.id} onSubmit={onSave}><div className="company-admin-preview" style={{ borderColor: company.brand_color }}><i style={{ background: company.brand_color }}>{company.name.slice(0, 1)}</i><div><strong>{company.name}</strong><small>/empresa/{company.slug} · até {company.max_professionals} profissionais</small></div></div><div className="modal-grid"><label>Nome da empresa<input name="name" required defaultValue={company.name} /></label><label>E-mail de contato<input name="contactEmail" type="email" defaultValue={company.contact_email} /></label></div><div className="modal-grid"><label>Subtítulo<input name="subtitle" defaultValue={company.subtitle} /></label><label>Localização<input name="location" defaultValue={company.location} /></label></div><div className="modal-grid"><label>Fuso horário<input name="timezone" required defaultValue={company.timezone} /></label><label>Cor da marca<input className="color-input" name="brandColor" type="color" defaultValue={company.brand_color} /></label></div><label>Título principal do site<input name="heroTitle" maxLength={220} defaultValue={company.hero_title} /></label><label>Descrição do site<textarea name="heroDescription" maxLength={500} defaultValue={company.hero_description} /></label><div className="modal-actions"><button className="admin-primary" disabled={saving} type="submit">{saving ? "Salvando..." : "Salvar empresa e site"}</button></div></form></div>;
}

function Professionals({ professionals, services, onToggle, onEdit, onAdd }: { professionals: AdminProfessional[]; services: AdminService[]; onToggle: (id: string) => void; onEdit: (professional: AdminProfessional) => void; onAdd: () => void }) {
  return <div className="admin-content professionals-view"><div className="section-intro"><div><h2>Equipe e agendas individuais</h2><p>Cada profissional tem atividades, horários e Google Agenda próprios.</p></div><span>{professionals.filter((item) => item.active).length} profissionais ativos</span></div><section className="professional-admin-grid">{professionals.map((professional) => <article className={`professional-admin-card ${professional.active ? "" : "disabled"}`} key={professional.id}><div className="professional-admin-head"><span className="professional-avatar" style={{ background: professional.color }}>{initialsFor(professional.name)}</span><label className="switch"><input checked={professional.active} onChange={() => onToggle(professional.id)} type="checkbox" /><b /></label></div><h3>{professional.name}</h3><strong>{professional.title}</strong><p>{professional.bio || professional.email || "Profissional da equipe"}</p><div className="professional-tags">{professional.serviceIds.map((id) => <span key={id}>{services.find((service) => service.id === id)?.name ?? "Atividade"}</span>)}</div><button className="professional-edit" onClick={() => onEdit(professional)} type="button">Editar perfil e atividades</button><small className={professional.googleStatus === "connected" ? "connected-label" : "muted-label"}>{professional.googleStatus === "connected" ? "Google Agenda conectado" : "Google Agenda não conectado"}</small></article>)}<button className="add-service-card" onClick={onAdd} type="button"><span>＋</span><strong>Adicionar profissional</strong><small>Crie uma nova agenda individual</small></button></section></div>;
}

function Services({ services, professionals, money, onToggle, onEdit, onAdd }: { services: AdminService[]; professionals: AdminProfessional[]; money: Intl.NumberFormat; onToggle: (id: string) => void; onEdit: (service: AdminService) => void; onAdd: () => void }) {
  return <div className="admin-content services-view"><div className="section-intro"><div><h2>Catálogo da empresa</h2><p>Uma atividade pode ser realizada por vários profissionais.</p></div><span>{services.filter((item) => item.active).length} atividades publicadas</span></div><section className="service-admin-grid">{services.map((service) => <article className={`service-admin-card ${service.active ? "" : "disabled"}`} key={service.id}><i style={{ background: service.color }} /><div className="service-admin-head"><span>{service.duration} min</span><label className="switch"><input checked={service.active} onChange={() => onToggle(service.id)} type="checkbox" /><b /></label></div><h3>{service.name}</h3><p>{service.description || "Atendimento configurado para agendamento online."}</p><strong>{money.format(service.priceCents / 100)}</strong><small>{service.professionalIds.map((id) => professionals.find((professional) => professional.id === id)?.name).filter(Boolean).join(", ") || "Sem profissional vinculado"}</small><div className="service-card-actions"><button onClick={() => onEdit(service)} type="button">Editar atividade e vínculos</button></div></article>)}<button className="add-service-card" onClick={onAdd} type="button"><span>＋</span><strong>Adicionar atividade</strong><small>Vincule à equipe responsável</small></button></section></div>;
}

function Availability({ professionals, selectedId, rules, saving, onSelect, onChange, onSave }: { professionals: AdminProfessional[]; selectedId: string; rules: DayRule[]; saving: boolean; onSelect: (id: string) => void; onChange: (weekday: number, patch: Partial<DayRule>) => void; onSave: () => void }) {
  return <div className="admin-content availability-view"><div className="section-intro"><div><h2>Agenda de cada profissional</h2><p>Selecione uma pessoa e defina apenas os horários dela.</p></div><label className="professional-select">Profissional<select value={selectedId} onChange={(event) => onSelect(event.target.value)}>{professionals.map((professional) => <option key={professional.id} value={professional.id}>{professional.name}{professional.active ? "" : " (inativo)"}</option>)}</select></label></div><div className="availability-layout"><section className="panel availability-panel"><div className="panel-title"><div><h2>Horários recorrentes</h2><p>Bloqueios e compromissos continuam sendo aplicados sobre estas faixas.</p></div></div><div className="day-rules">{rules.map((rule) => <div className={rule.enabled ? "enabled" : ""} key={rule.weekday}><label className="switch"><input checked={rule.enabled} onChange={() => onChange(rule.weekday, { enabled: !rule.enabled })} type="checkbox" /><b /></label><strong>{weekdays[rule.weekday]}</strong>{rule.enabled ? <><select aria-label={`Início de ${weekdays[rule.weekday]}`} value={rule.start} onChange={(event) => onChange(rule.weekday, { start: event.target.value })}>{timeOptions.map((time) => <option key={time}>{time}</option>)}</select><span>até</span><select aria-label={`Fim de ${weekdays[rule.weekday]}`} value={rule.end} onChange={(event) => onChange(rule.weekday, { end: event.target.value })}>{timeOptions.map((time) => <option key={time}>{time}</option>)}</select></> : <small>Indisponível</small>}</div>)}</div><div className="availability-save"><span>Intervalos de <select value={rules.find((rule) => rule.enabled)?.interval ?? 30} onChange={(event) => setAllIntervals(rules, Number(event.target.value), onChange)}><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option></select></span><button className="admin-primary" disabled={saving || !selectedId} onClick={onSave} type="button">{saving ? "Salvando..." : "Salvar disponibilidade"}</button></div></section><aside className="panel rules-note"><span>⌁</span><h3>Isolamento por agenda</h3><p>Dois profissionais podem atender no mesmo horário. O mesmo profissional nunca recebe compromissos sobrepostos.</p><ul><li>Duração e buffers por atividade</li><li>Fuso horário da empresa</li><li>Bloqueios individuais ou globais</li></ul></aside></div></div>;
}

function Integrations({ tenantSlug, professionals, integrations, pending }: { tenantSlug: string; professionals: AdminProfessional[]; integrations: Integration[]; pending: number }) {
  return <div className="admin-content integrations-view"><div className="section-intro"><div><h2>Google Agenda por profissional</h2><p>Cada pessoa conecta a própria conta; a sincronização ocorre pela outbox.</p></div></div><section className="integration-grid professional-integrations">{professionals.map((professional) => { const connection = integrations.find((item) => item.provider === "google_calendar" && item.professional_id === professional.id); const connected = connection?.status === "connected"; return <article className={`integration-card ${connected ? "connected" : ""}`} key={professional.id}><div className="integration-logo google">31</div><div><span className={`status-dot ${connected ? "" : "muted"}`}>{connected ? "Conectado" : "Configurar"}</span><h3>{professional.name}</h3><p>{professional.title} · agenda exclusiva</p></div><Link href={`/api/admin/integrations/google/start?tenant=${encodeURIComponent(tenantSlug)}&professionalId=${encodeURIComponent(professional.id)}`}>{connected ? "Reconectar" : "Conectar"}</Link></article>; })}<article className="integration-card"><div className="integration-logo stripe">S</div><div><span className="status-dot muted">Empresa</span><h3>Pagamentos opcionais</h3><p>Stripe Checkout pode ser habilitado por ambiente.</p></div></article><article className="integration-card"><div className="integration-logo email">@</div><div><span className="status-dot muted">Assíncrono</span><h3>E-mails transacionais</h3><p>Confirmações para cliente, empresa e profissional.</p></div></article></section><section className="panel async-health"><div><span className="pulse" /><div><strong>Transactional Outbox</strong><p>{pending ? `${pending} entrega(s) aguardando processamento.` : "Nenhum evento pendente no painel."}</p></div></div></section></div>;
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) { return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><div onMouseDown={(event) => event.stopPropagation()}>{children}</div></div>; }
function ModalHead({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) { return <div className="modal-head"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button aria-label="Fechar" onClick={onClose} type="button">×</button></div>; }
function ModalActions({ saving, label, onClose }: { saving: boolean; label: string; onClose: () => void }) { return <div className="modal-actions"><button className="admin-ghost" onClick={onClose} type="button">Cancelar</button><button className="admin-primary" disabled={saving} type="submit">{saving ? "Salvando..." : label}</button></div>; }
function CheckboxGroup({ name, title, items, selectedIds }: { name: string; title: string; items: Array<{ id: string; label: string }>; selectedIds?: string[] }) { return <fieldset className="checkbox-group"><legend>{title}</legend>{items.length ? items.map((item) => <label key={item.id}><input defaultChecked={selectedIds ? selectedIds.includes(item.id) : true} name={name} type="checkbox" value={item.id} />{item.label}</label>) : <p>Cadastre o outro lado do vínculo primeiro.</p>}</fieldset>; }

function mapService(item: Record<string, unknown>): AdminService { return { id: String(item.id), name: String(item.name), description: String(item.description ?? ""), duration: Number(item.duration_minutes), priceCents: Number(item.price_cents), active: Boolean(item.is_active), color: String(item.color ?? "#567f72"), professionalIds: Array.isArray(item.professional_ids) ? item.professional_ids.map(String) : [] }; }
function mapProfessional(item: Record<string, unknown>): AdminProfessional { return { id: String(item.id), name: String(item.name), title: String(item.title ?? "Profissional"), bio: String(item.bio ?? ""), email: String(item.email ?? ""), color: String(item.color ?? "#17624f"), active: Boolean(item.is_active), serviceIds: Array.isArray(item.service_ids) ? item.service_ids.map(String) : [], googleStatus: item.google_status ? String(item.google_status) : null }; }
function rulesFor(rawRules: RawRule[], professionalId: string) { return emptyRules().map((day) => { const row = rawRules.find((item) => item.professional_id === professionalId && Number(item.weekday) === day.weekday && Boolean(item.is_active)); return row ? { weekday: day.weekday, enabled: true, start: row.start_time, end: row.end_time, interval: Number(row.slot_interval_minutes) } : day; }); }
function initialsFor(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function setAllIntervals(rules: DayRule[], interval: number, onChange: (weekday: number, patch: Partial<DayRule>) => void) { rules.forEach((rule) => onChange(rule.weekday, { interval })); }
function providerName(provider: string) { return provider === "google_calendar" ? "Google Agenda" : provider; }
function roleName(role: string) { return ({ owner: "Proprietário", admin: "Administrador", staff: "Equipe operacional", platform_admin: "Admin Master" } as Record<string, string>)[role] ?? role; }
function planName(plan: string) { return ({ trial: "Teste", essential: "Essencial", professional: "Profissional" } as Record<string, string>)[plan] ?? plan; }
function localDateToIso(value: string, timezone: string) { const [date, time] = value.split("T"); try { return parseLocalDateTime(date, time, timezone).toISOString(); } catch { return value; } }
function dateTimeInput(value: string, timezone: string) { const parts = partsInZone(new Date(value), timezone); return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`; }
async function apiJson<T = unknown>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, init); const body = await response.json() as T & { error?: string | { message?: string } }; if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : body.error?.message || "A operação falhou."); return body; }
