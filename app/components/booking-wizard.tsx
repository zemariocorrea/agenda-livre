"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Tenant = {
  slug: string;
  name: string;
  subtitle: string;
  timezone: string;
  currency: string;
  location: string;
};

type Service = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
  color: string;
};

type DateOption = {
  weekday: string;
  day: string;
  month: string;
  iso: string;
};

type Slot = {
  localTime: string;
  startsAtUtc: string;
  endsAtUtc: string;
};

const defaultTenant: Tenant = {
  slug: "clinica-aurora",
  name: "Clínica Aurora",
  subtitle: "Saúde & bem-estar",
  timezone: "America/Sao_Paulo",
  currency: "BRL",
  location: "Curitiba · PR",
};

export function BookingWizard({ tenantSlug = "clinica-aurora" }: { tenantSlug?: string }) {
  const [step, setStep] = useState(1);
  const [tenant, setTenant] = useState(defaultTenant);
  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [dateIndex, setDateIndex] = useState(0);
  const [time, setTime] = useState("");
  const [payNow, setPayNow] = useState(false);
  const [customer, setCustomer] = useState({ name: "", email: "", phone: "" });
  const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [calendarUrl, setCalendarUrl] = useState("");
  const [paymentMessage, setPaymentMessage] = useState("");
  const idempotencyKey = useRef("");

  const dates = useMemo(() => buildDateOptions(tenant.timezone), [tenant.timezone]);
  const service = useMemo(() => services.find((item) => item.id === serviceId) ?? services[0], [serviceId, services]);
  const selectedDate = dates[dateIndex] ?? dates[0];
  const selectedSlot = availableSlots.find((slot) => slot.localTime === time);
  const money = useMemo(() => new Intl.NumberFormat("pt-BR", { style: "currency", currency: tenant.currency }), [tenant.currency]);
  const advance = () => {
    if (step === 1) setLoadingSlots(true);
    setStep((current) => Math.min(current + 1, 4));
  };

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/public/catalog?tenant=${encodeURIComponent(tenantSlug)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { tenant?: Tenant; services?: Service[]; error?: { message?: string } };
        if (!response.ok || !data.tenant) throw new Error(data.error?.message ?? "Não foi possível carregar a agenda.");
        return data;
      })
      .then((data) => {
        const catalog = data.services ?? [];
        setTenant(data.tenant ?? defaultTenant);
        setServices(catalog);
        setServiceId((current) => catalog.some((item) => item.id === current) ? current : (catalog[0]?.id ?? ""));
      })
      .catch((catalogError) => {
        if ((catalogError as Error).name !== "AbortError") setError(catalogError instanceof Error ? catalogError.message : "Não foi possível carregar a agenda.");
      })
      .finally(() => setLoadingCatalog(false));
    return () => controller.abort();
  }, [tenantSlug]);

  useEffect(() => {
    if (step !== 2 || !serviceId || !selectedDate) return;
    const controller = new AbortController();
    fetch(`/api/public/availability?tenant=${encodeURIComponent(tenant.slug)}&serviceId=${encodeURIComponent(serviceId)}&date=${selectedDate.iso}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { slots?: Slot[]; error?: { message?: string } };
        if (!response.ok) throw new Error(data.error?.message ?? "Não foi possível consultar os horários.");
        return data.slots ?? [];
      })
      .then((slots) => {
        setAvailableSlots(slots);
        setTime((current) => slots.some((slot) => slot.localTime === current) ? current : (slots[0]?.localTime ?? ""));
      })
      .catch((availabilityError) => {
        if ((availabilityError as Error).name !== "AbortError") {
          setAvailableSlots([]);
          setTime("");
          setError(availabilityError instanceof Error ? availabilityError.message : "Não foi possível consultar os horários.");
        }
      })
      .finally(() => setLoadingSlots(false));
    return () => controller.abort();
  }, [selectedDate, serviceId, step, tenant.slug]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!service || !selectedSlot) {
      setError("Escolha novamente um horário disponível.");
      return;
    }
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/public/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({ tenantSlug: tenant.slug, serviceId, startsAtUtc: selectedSlot.startsAtUtc, customer, paymentPreference: payNow ? "online" : "at_venue" }),
      });
      const data = await response.json() as { calendarUrl?: string; checkoutUrl?: string; paymentFallback?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "Não foi possível reservar esse horário.");
      setCalendarUrl(data.calendarUrl ?? "");
      setPaymentMessage(data.paymentFallback ?? "");
      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }
      advance();
    } catch (submitError) {
      idempotencyKey.current = "";
      setError(submitError instanceof Error ? submitError.message : "Não foi possível reservar esse horário.");
    } finally {
      setSubmitting(false);
    }
  }

  function restart() {
    idempotencyKey.current = "";
    setCustomer({ name: "", email: "", phone: "" });
    setCalendarUrl("");
    setPaymentMessage("");
    setPayNow(false);
    setStep(1);
  }

  if (step === 4 && service && selectedSlot) {
    return (
      <section className="booking-card confirmation-card" aria-live="polite">
        <div className="success-mark" aria-hidden="true">✓</div>
        <p className="eyebrow">Horário reservado</p>
        <h2>Pronto, {customer.name.split(" ")[0] || "seu horário está confirmado"}!</h2>
        <p className="confirmation-copy">Enviamos os detalhes para <strong>{customer.email || "seu e-mail"}</strong>.</p>
        <dl className="confirmation-details">
          <div><dt>Atendimento</dt><dd>{service.name}</dd></div>
          <div><dt>Quando</dt><dd>{formatAppointment(selectedSlot.startsAtUtc, tenant.timezone)}</dd></div>
          <div><dt>Pagamento</dt><dd>{payNow && service.priceCents > 0 ? "Online solicitado" : "No atendimento"}</dd></div>
        </dl>
        {paymentMessage && <p className="payment-message">{paymentMessage}</p>}
        {calendarUrl ? <a className="primary-button calendar-button" href={calendarUrl} target="_blank" rel="noreferrer">Adicionar ao Google Agenda</a> : null}
        <button className="text-button" type="button" onClick={restart}>Fazer outro agendamento</button>
      </section>
    );
  }

  return (
    <section className="booking-card" aria-label="Formulário de agendamento">
      <div className="wizard-header">
        <div>
          <p className="eyebrow">Passo {step} de 3</p>
          <h2>
            {step === 1 && "Como podemos cuidar de você?"}
            {step === 2 && "Escolha o melhor momento"}
            {step === 3 && "Só falta confirmar"}
          </h2>
        </div>
        <div className="step-dots" aria-label={`Etapa ${step} de 3`}>
          {[1, 2, 3].map((item) => <span key={item} className={item <= step ? "active" : ""} />)}
        </div>
      </div>

      {step === 1 && (
        <div className="service-list">
          {loadingCatalog && <p className="empty-state">Carregando atividades...</p>}
          {!loadingCatalog && !services.length && <p className="empty-state">Nenhuma atividade está disponível no momento.</p>}
          {services.map((item, index) => (
            <button className={`service-option ${serviceId === item.id ? "selected" : ""}`} key={item.id} onClick={() => setServiceId(item.id)} type="button">
              <span className="service-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="service-copy">
                <strong>{item.name}</strong>
                <small>{item.description}</small>
                <span className="service-meta">{item.durationMinutes} min <i /> {money.format(item.priceCents / 100)}</span>
              </span>
              <span className="radio-mark" aria-hidden="true" />
            </button>
          ))}
          <button className="primary-button" disabled={!serviceId || loadingCatalog} onClick={advance} type="button">Escolher data e horário</button>
        </div>
      )}

      {step === 2 && service && selectedDate && (
        <div className="schedule-step">
          <div className="selected-summary"><span>{service.name}</span><strong>{service.durationMinutes} min · {money.format(service.priceCents / 100)}</strong></div>
          <div className="month-row"><strong>Próximos dias</strong><span>{tenant.timezone.replace("_", " ")}</span></div>
          <div className="date-grid">
            {dates.map((date, index) => (
              <button className={dateIndex === index ? "selected" : ""} key={date.iso} onClick={() => { setLoadingSlots(true); setDateIndex(index); }} type="button">
                <small>{date.weekday}</small><strong>{date.day}</strong><span>{date.month}</span>
              </button>
            ))}
          </div>
          <p className="field-label">Horários disponíveis</p>
          {loadingSlots ? <p className="empty-state">Consultando horários...</p> : null}
          {!loadingSlots && !availableSlots.length ? <p className="empty-state">Não há horários livres nesta data. Escolha outro dia.</p> : null}
          <div className="time-grid">
            {availableSlots.map((slot) => <button className={time === slot.localTime ? "selected" : ""} key={slot.startsAtUtc} onClick={() => setTime(slot.localTime)} type="button">{slot.localTime}</button>)}
          </div>
          <div className="button-row">
            <button className="secondary-button" onClick={() => setStep(1)} type="button">Voltar</button>
            <button className="primary-button" disabled={!selectedSlot || loadingSlots} onClick={advance} type="button">Continuar</button>
          </div>
        </div>
      )}

      {step === 3 && service && selectedDate && selectedSlot && (
        <form className="details-form" onSubmit={submit}>
          <div className="appointment-ticket">
            <span className="ticket-date"><strong>{selectedDate.day}</strong> {selectedDate.month}</span>
            <span><strong>{service.name}</strong><small>{time} · {service.durationMinutes} minutos</small></span>
            <strong>{money.format(service.priceCents / 100)}</strong>
          </div>
          <label>Nome completo<input required autoComplete="name" maxLength={120} placeholder="Como podemos chamar você?" value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} /></label>
          <div className="form-grid">
            <label>E-mail<input required type="email" autoComplete="email" maxLength={254} placeholder="voce@email.com" value={customer.email} onChange={(event) => setCustomer({ ...customer, email: event.target.value })} /></label>
            <label>Celular<input required type="tel" autoComplete="tel" maxLength={40} placeholder="(41) 99999-9999" value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} /></label>
          </div>
          <fieldset className="payment-choice">
            <legend>Como prefere pagar?</legend>
            <label className={!payNow ? "selected" : ""}>
              <input type="radio" name="payment" checked={!payNow} onChange={() => setPayNow(false)} />
              <span><strong>No atendimento</strong><small>Seu horário fica confirmado agora</small></span>
            </label>
            {service.priceCents > 0 ? (
              <label className={payNow ? "selected" : ""}>
                <input type="radio" name="payment" checked={payNow} onChange={() => setPayNow(true)} />
                <span><strong>Pagar agora</strong><small>Ambiente seguro de pagamento</small></span>
              </label>
            ) : null}
          </fieldset>
          <div className="button-row">
            <button className="secondary-button" onClick={() => { setLoadingSlots(true); setStep(2); }} type="button">Voltar</button>
            <button className="primary-button" disabled={submitting} type="submit">{submitting ? "Reservando..." : payNow ? "Confirmar e pagar" : "Confirmar agendamento"}</button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <p className="privacy-note">Ao confirmar, você concorda com a política de privacidade de {tenant.name}.</p>
        </form>
      )}

      {error && step !== 3 ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}

function buildDateOptions(timeZone: string): DateOption[] {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));

  return Array.from({ length: 10 }, (_, offset) => {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset, 12));
    return {
      weekday: new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(date).replace(".", "").toUpperCase(),
      day: new Intl.DateTimeFormat("pt-BR", { day: "2-digit", timeZone: "UTC" }).format(date),
      month: new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(date).replace(".", "").toUpperCase(),
      iso: date.toISOString().slice(0, 10),
    };
  });
}

function formatAppointment(startsAtUtc: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "long", timeStyle: "short" }).format(new Date(startsAtUtc));
}
