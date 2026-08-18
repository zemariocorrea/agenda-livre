import {
  addDaysToLocalDate,
  addMinutes,
  minutesToTime,
  parseLocalDateTime,
  timeToMinutes,
  weekdayOf,
} from "./timezone";

export type ProfessionalForService = {
  id: string;
  name: string;
  title: string;
  email: string;
  color: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceCents: number;
};

type AvailabilityRuleRow = {
  start_time: string;
  end_time: string;
  slot_interval_minutes: number;
};

type WindowRow = {
  starts_at_utc: string;
  ends_at_utc: string;
};

export type AvailableSlot = {
  localTime: string;
  startsAtUtc: string;
  endsAtUtc: string;
  professionalId: string;
  professionalName: string;
  professionalTitle: string;
  durationMinutes: number;
  priceCents: number;
};

export async function listProfessionalsForService(
  d1: D1Database,
  input: { tenantId: string; serviceId: string; professionalId?: string },
): Promise<ProfessionalForService[]> {
  const professionalFilter = input.professionalId ? "AND professional.id = ?" : "";
  const bindings = input.professionalId
    ? [input.tenantId, input.serviceId, input.professionalId]
    : [input.tenantId, input.serviceId];
  const result = await d1.prepare(`
    SELECT
      professional.id,
      professional.name,
      professional.title,
      professional.email,
      professional.color,
      COALESCE(link.duration_minutes, service.duration_minutes) AS duration_minutes,
      COALESCE(link.buffer_before_minutes, service.buffer_before_minutes) AS buffer_before_minutes,
      COALESCE(link.buffer_after_minutes, service.buffer_after_minutes) AS buffer_after_minutes,
      COALESCE(link.price_cents, service.price_cents) AS price_cents
    FROM professional_services AS link
    INNER JOIN professionals AS professional
      ON professional.id = link.professional_id
     AND professional.tenant_id = link.tenant_id
    INNER JOIN services AS service
      ON service.id = link.service_id
     AND service.tenant_id = link.tenant_id
    WHERE link.tenant_id = ?
      AND link.service_id = ?
      AND link.is_active = 1
      AND professional.is_active = 1
      AND service.is_active = 1
      ${professionalFilter}
    ORDER BY professional.sort_order, professional.name
  `).bind(...bindings).all<{
    id: string;
    name: string;
    title: string;
    email: string;
    color: string;
    duration_minutes: number;
    buffer_before_minutes: number;
    buffer_after_minutes: number;
    price_cents: number;
  }>();

  return result.results.map((row) => ({
    id: row.id,
    name: row.name,
    title: row.title,
    email: row.email,
    color: row.color,
    durationMinutes: Number(row.duration_minutes),
    bufferBeforeMinutes: Number(row.buffer_before_minutes),
    bufferAfterMinutes: Number(row.buffer_after_minutes),
    priceCents: Number(row.price_cents),
  }));
}

export async function listAvailableSlots(
  d1: D1Database,
  input: {
    tenantId: string;
    professional: ProfessionalForService;
    timezone: string;
    localDate: string;
    now?: Date;
  },
): Promise<AvailableSlot[]> {
  const weekday = weekdayOf(input.localDate);
  const dayStart = parseLocalDateTime(input.localDate, "00:00", input.timezone);
  const nextLocalDate = addDaysToLocalDate(input.localDate, 1);
  const dayEnd = parseLocalDateTime(nextLocalDate, "00:00", input.timezone);

  const [rulesResult, appointmentsResult, blocksResult] = await d1.batch([
    d1.prepare(`
      SELECT start_time, end_time, slot_interval_minutes
      FROM availability_rules
      WHERE tenant_id = ? AND professional_id = ? AND weekday = ? AND is_active = 1
      ORDER BY start_time, end_time
    `).bind(input.tenantId, input.professional.id, weekday),
    d1.prepare(`
      SELECT COALESCE(busy_starts_at_utc, starts_at_utc) AS starts_at_utc,
             COALESCE(busy_ends_at_utc, ends_at_utc) AS ends_at_utc
      FROM appointments
      WHERE tenant_id = ? AND professional_id = ?
        AND status IN ('pending', 'confirmed')
        AND COALESCE(busy_starts_at_utc, starts_at_utc) < ?
        AND COALESCE(busy_ends_at_utc, ends_at_utc) > ?
    `).bind(input.tenantId, input.professional.id, dayEnd.toISOString(), dayStart.toISOString()),
    d1.prepare(`
      SELECT starts_at_utc, ends_at_utc
      FROM blocked_periods
      WHERE tenant_id = ? AND (professional_id IS NULL OR professional_id = ?)
        AND starts_at_utc < ? AND ends_at_utc > ?
    `).bind(input.tenantId, input.professional.id, dayEnd.toISOString(), dayStart.toISOString()),
  ]);

  const rules = rulesResult.results as unknown as AvailabilityRuleRow[];
  const unavailable = [
    ...(appointmentsResult.results as unknown as WindowRow[]),
    ...(blocksResult.results as unknown as WindowRow[]),
  ];
  const now = (input.now ?? new Date()).getTime();
  const uniqueSlots = new Map<string, AvailableSlot>();

  for (const rule of rules) {
    const startMinute = timeToMinutes(rule.start_time);
    const endMinute = timeToMinutes(rule.end_time);
    const interval = Number(rule.slot_interval_minutes);
    if (!Number.isInteger(interval) || interval < 5 || endMinute <= startMinute) continue;

    const firstAppointmentMinute = startMinute + input.professional.bufferBeforeMinutes;
    const lastBusyMinute = input.professional.durationMinutes + input.professional.bufferAfterMinutes;
    for (let minute = firstAppointmentMinute; minute + lastBusyMinute <= endMinute; minute += interval) {
      const localTime = minutesToTime(minute);
      const startsAt = parseLocalDateTime(input.localDate, localTime, input.timezone);
      const endsAt = addMinutes(startsAt, input.professional.durationMinutes);
      const busyStartsAt = addMinutes(startsAt, -input.professional.bufferBeforeMinutes);
      const busyEndsAt = addMinutes(endsAt, input.professional.bufferAfterMinutes);
      const startsAtUtc = startsAt.toISOString();
      const endsAtUtc = endsAt.toISOString();
      const busyStartsAtUtc = busyStartsAt.toISOString();
      const busyEndsAtUtc = busyEndsAt.toISOString();
      const overlaps = unavailable.some(
        (item) => item.starts_at_utc < busyEndsAtUtc && item.ends_at_utc > busyStartsAtUtc,
      );

      if (!overlaps && startsAt.getTime() > now) {
        uniqueSlots.set(startsAtUtc, {
          localTime,
          startsAtUtc,
          endsAtUtc,
          professionalId: input.professional.id,
          professionalName: input.professional.name,
          professionalTitle: input.professional.title,
          durationMinutes: input.professional.durationMinutes,
          priceCents: input.professional.priceCents,
        });
      }
    }
  }

  return [...uniqueSlots.values()].sort((left, right) => left.startsAtUtc.localeCompare(right.startsAtUtc));
}

export async function listAvailableSlotsForService(
  d1: D1Database,
  input: {
    tenantId: string;
    serviceId: string;
    professionalId?: string;
    timezone: string;
    localDate: string;
    now?: Date;
  },
) {
  const professionals = await listProfessionalsForService(d1, input);
  const grouped = await Promise.all(
    professionals.map((professional) => listAvailableSlots(d1, {
      tenantId: input.tenantId,
      professional,
      timezone: input.timezone,
      localDate: input.localDate,
      now: input.now,
    })),
  );
  const allSlots = grouped.flat().sort((left, right) =>
    left.startsAtUtc.localeCompare(right.startsAtUtc)
      || left.professionalName.localeCompare(right.professionalName),
  );

  if (input.professionalId) return { professionals, slots: allSlots };

  // Na opção “qualquer profissional”, um horário aparece uma vez e já carrega
  // o profissional que será reservado. Uma nova consulta expõe a capacidade
  // restante quando mais de uma agenda possui o mesmo horário.
  const firstProfessionalPerTime = new Map<string, AvailableSlot>();
  for (const slot of allSlots) {
    if (!firstProfessionalPerTime.has(slot.startsAtUtc)) {
      firstProfessionalPerTime.set(slot.startsAtUtc, slot);
    }
  }
  return { professionals, slots: [...firstProfessionalPerTime.values()] };
}
