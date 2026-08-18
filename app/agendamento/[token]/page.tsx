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
  service_name: string;
  professional_name: string;
  tenant_name: string;
  tenant_slug: string;
};

export default async function AppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ payment?: string }>;
}) {
  const { token } = await params;
  const payment = (await searchParams)?.payment;
  const d1 = await getD1();
  const appointment = await d1.prepare(
    "SELECT a.customer_name, a.customer_email, a.starts_at_utc, a.timezone, a.status, a.payment_status, s.name AS service_name, p.name AS professional_name, t.name AS tenant_name, t.slug AS tenant_slug FROM appointments a JOIN services s ON s.id = a.service_id JOIN professionals p ON p.id = a.professional_id AND p.tenant_id = a.tenant_id JOIN tenants t ON t.id = a.tenant_id WHERE a.public_token = ? LIMIT 1",
  ).bind(token).first<AppointmentView>();
  if (!appointment) notFound();

  const when = formatInTimeZone(appointment.starts_at_utc, appointment.timezone, { dateStyle: "long", timeStyle: "short" });
  const paymentText = appointment.payment_status === "paid"
    ? "Pagamento confirmado"
    : payment === "cancelled"
      ? "Pagamento online cancelado; o horário continua reservado para pagamento no atendimento."
      : "Pagamento aguardando confirmação";

  return (
    <main className="booking-shell appointment-status-shell">
      <header className="public-header">
        <Link className="brand" href={`/?tenant=${encodeURIComponent(appointment.tenant_slug)}`}>
          <span className="brand-mark">{appointment.tenant_name.slice(0, 1)}</span>
          <span><strong>{appointment.tenant_name}</strong><small>Detalhes do agendamento</small></span>
        </Link>
      </header>
      <section className="booking-card confirmation-card appointment-status-card">
        <div className="success-mark" aria-hidden="true">✓</div>
        <p className="eyebrow">Agendamento {appointment.status === "cancelled" ? "cancelado" : "confirmado"}</p>
        <h1>Olá, {appointment.customer_name.split(" ")[0]}.</h1>
        <p className="confirmation-copy">Estes são os detalhes enviados para <strong>{appointment.customer_email}</strong>.</p>
        <dl className="confirmation-details">
          <div><dt>Atendimento</dt><dd>{appointment.service_name}</dd></div>
          <div><dt>Profissional</dt><dd>{appointment.professional_name}</dd></div>
          <div><dt>Quando</dt><dd>{when}</dd></div>
          <div><dt>Pagamento</dt><dd>{paymentText}</dd></div>
        </dl>
        <Link className="primary-button calendar-button" href={`/?tenant=${encodeURIComponent(appointment.tenant_slug)}`}>Voltar à página de agendamento</Link>
      </section>
    </main>
  );
}
