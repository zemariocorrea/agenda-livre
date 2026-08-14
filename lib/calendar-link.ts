type CalendarLinkInput = {
  title: string;
  startsAtUtc: string;
  endsAtUtc: string;
  details: string;
  location?: string;
};

function compactUtc(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function googleCalendarLink(input: CalendarLinkInput) {
  const query = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${compactUtc(input.startsAtUtc)}/${compactUtc(input.endsAtUtc)}`,
    details: input.details,
    location: input.location ?? "",
  });
  return `https://calendar.google.com/calendar/render?${query.toString()}`;
}
