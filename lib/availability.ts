import { addDaysToLocalDate, addMinutes, minutesToTime, parseLocalDateTime, timeToMinutes, weekdayOf } from "./timezone";

type ServiceForAvailability = {
  durationMinutes: number;
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
};

export async function findPrimaryMember(d1: D1Database, tenantId: string) {
  return d1.prepare(
    "SELECT id, email, display_name FROM tenant_members WHERE tenant_id = ? AND is_active = 1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at LIMIT 1",
  ).bind(tenantId).first<{ id: string; email: string; display_name: string }>();
}

export async function listAvailableSlots(
  d1: D1Database,
  input: {
    tenantId: string;
    memberId: string;
    timezone: string;
    localDate: string;
    service: ServiceForAvailability;
    now?: Date;
  },
): Promise<AvailableSlot[]> {
  const weekday = weekdayOf(input.localDate);
  const dayStart = parseLocalDateTime(input.localDate, "00:00", input.timezone);
  const nextLocalDate = addDaysToLocalDate(input.localDate, 1);
  const dayEnd = parseLocalDateTime(nextLocalDate, "00:00", input.timezone);

  const [rulesResult, appointmentsResult, blocksResult] = await d1.batch([
    d1.prepare(
      "SELECT start_time, end_time, slot_interval_minutes FROM availability_rules WHERE tenant_id = ? AND member_id = ? AND weekday = ? AND is_active = 1 ORDER BY start_time, end_time",
    ).bind(input.tenantId, input.memberId, weekday),
    d1.prepare(
      "SELECT starts_at_utc, ends_at_utc FROM appointments WHERE tenant_id = ? AND member_id = ? AND status IN ('pending', 'confirmed') AND starts_at_utc < ? AND ends_at_utc > ?",
    ).bind(input.tenantId, input.memberId, dayEnd.toISOString(), dayStart.toISOString()),
    d1.prepare(
      "SELECT starts_at_utc, ends_at_utc FROM blocked_periods WHERE tenant_id = ? AND (member_id IS NULL OR member_id = ?) AND starts_at_utc < ? AND ends_at_utc > ?",
    ).bind(input.tenantId, input.memberId, dayEnd.toISOString(), dayStart.toISOString()),
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

    for (let minute = startMinute; minute + input.service.durationMinutes <= endMinute; minute += interval) {
      const localTime = minutesToTime(minute);
      const startsAt = parseLocalDateTime(input.localDate, localTime, input.timezone);
      const endsAt = addMinutes(startsAt, input.service.durationMinutes);
      const startsAtUtc = startsAt.toISOString();
      const endsAtUtc = endsAt.toISOString();
      const overlaps = unavailable.some((item) => item.starts_at_utc < endsAtUtc && item.ends_at_utc > startsAtUtc);

      if (!overlaps && startsAt.getTime() > now) {
        uniqueSlots.set(startsAtUtc, { localTime, startsAtUtc, endsAtUtc });
      }
    }
  }

  return [...uniqueSlots.values()].sort((left, right) => left.startsAtUtc.localeCompare(right.startsAtUtc));
}
