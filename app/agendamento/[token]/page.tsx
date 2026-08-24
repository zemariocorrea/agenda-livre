import Link from "next/link";
import { notFound } from "next/navigation";
import { getD1 } from "@/lib/d1";
import { formatInTimeZone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

type AppointmentView = {
  customer_name: string;
  customer_email: string;
  starts_at_utc: string;
  timezone: string;
  status: string;
  payment_status: string;
  payment_method: string | null;
  payment_amount_cents: number | null;
  service_name: string;
  professional_name: string;
  tenant_name: string;
  tenant_slug: string;
  currency: string;
};

export default async function AppointmentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const d1 = await getD1();
  const appointment = await d1.prepare(`
    SELECT a.customer_name, a.customer_email, a.starts_at_utc, a.timezone, a.status,
           a.payment_status, a.payment_method, a.payment_amount_cents,
           s.name AS service_name, p.name AS professional_name,
           t.name AS tenant_name, t.slug AS tenant_slug, t.currency
    FROM appointments a
    JOIN services s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
    JOIN professionals p ON p.id = a.professional_id AND p.tenant_id = a.tenant_id
    JOIN tenants t ON t.id = a.tenant_id
    WHERE a.public_token = ?
    LIMIT 1
  `).bind(token).first<AppointmentView>();
  if (!appointment) notFound();

  const when = formatInTimeZone(appointment.starts_at_utc, appointment.timezone, { dateStyle: "long", timeStyle: "short" });
  const pending = appointment.status === "pending";
  const cancelled = appointment.status === "cancelled";
  const amount = appointment.payment_amount_cents && appointment.payment_amount_cents > 0
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: appointment.currency }).format(appointment.payment_amount_cents / 100)
    : "";

  return (
    <main className="booking-shell appointment-status-shell">
      <header className="public-header">
        <Link className="brand" href={`/?tenant=${encodeURIComponent(appointment.tenant_slug)}`}>
          <span className="brand-mark">{appointment.tenant_name.slice(0, 1)}</span>
          <span><strong>{appointment.tenant_name}</strong><small>Detalhes do agendamento</small></span>
        </Link>
      </header>
      <section className="booking-card confirmation-card appointment-status-card">
        <div className="success-mark" aria-hidden="true">{cancelled ? "×" : pending ? "⌛" : "✓"}</div>
        <p className="eyebrow">{cancelled ? "Agendamento cancelado" : pending ? "Aguardando confirmação" : "Agendamento confirmado"}</p>
        <h1>Olá, {appointment.customer_name.split(" ")[0]}.</h1>
        <p className="confirmation-copy">Estes são os detalhes do horário associado a <strong>{appointment.customer_email}</strong>.</p>
        <dl className="confirmation-details">
          <div><dt>Atendimento</dt><dd>{appointment.service_name}</dd></div>
          <div><dt>Profissional</dt><dd>{appointment.professional_name}</dd></div>
          <div><dt>Quando</dt><dd>{when}</dd></div>
          <div><dt>Forma de pagamento</dt><dd>{paymentMethodLabel(appointment.payment_method)}</dd></div>
          <div><dt>Status do pagamento</dt><dd>{paymentStatusLabel(appointment.payment_status, appointment.payment_method)}</dd></div>
          {amount && <div><dt>Valor esperado</dt><dd>{amount}</dd></div>}
        </dl>
        {pending && <p className="payment-message">O horário está reservado, mas ainda aguarda a confirmação do estabelecimento.</p>}
        <Link className="primary-button calendar-button" href={`/?tenant=${encodeURIComponent(appointment.tenant_slug)}`}>Voltar à página de agendamento</Link>
      </section>
    </main>
  );
}

function paymentMethodLabel(method: string | null) {
  if (method === "pix") return "Pix";
  if (method === "contact") return "Contato com o estabelecimento";
  if (method === "on_site") return "Pagamento no local";
  return "Não exigido";
}

function paymentStatusLabel(status: string, method: string | null) {
  if (status === "paid") return "Pagamento confirmado";
  if (status === "proof_sent") return "Comprovante enviado para conferência";
  if (status === "rejected") return "Pagamento rejeitado";
  if (status === "pending" && method === "contact") return "Aguardando contato para pagamento";
  if (status === "pending") return "Aguardando pagamento";
  if (status === "failed") return "Pagamento falhou";
  if (status === "refunded") return "Pagamento estornado";
  return "Não exigido";
}
