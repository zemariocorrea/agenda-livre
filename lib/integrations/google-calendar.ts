type GoogleCredentials = { refreshToken: string; calendarId?: string };
type GoogleEventInput = {
  appointmentId: string;
  title: string;
  description: string;
  location?: string;
  customerEmail: string;
  startsAtUtc: string;
  endsAtUtc: string;
  timezone: string;
};

async function accessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_OAUTH_NOT_CONFIGURED");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const payload = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description ?? "GOOGLE_TOKEN_REFRESH_FAILED");
  return payload.access_token;
}

export async function createGoogleCalendarEvent(credentials: GoogleCredentials, event: GoogleEventInput) {
  const token = await accessToken(credentials.refreshToken);
  const calendarId = credentials.calendarId ?? "primary";
  const eventId = event.appointmentId.replace(/[^a-f0-9]/g, "").slice(0, 64);
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: eventId,
      summary: event.title,
      description: event.description,
      location: event.location,
      start: { dateTime: event.startsAtUtc, timeZone: event.timezone },
      end: { dateTime: event.endsAtUtc, timeZone: event.timezone },
      attendees: [{ email: event.customerEmail }],
      extendedProperties: { private: { appointmentId: event.appointmentId } },
    }),
  });
  const payload = await response.json() as { id?: string; message?: string; error?: { message?: string } };
  if (response.status === 409) return eventId;
  if (!response.ok || !payload.id) throw new Error(payload.error?.message ?? payload.message ?? "GOOGLE_EVENT_CREATE_FAILED");
  return payload.id;
}
