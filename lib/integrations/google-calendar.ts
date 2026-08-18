export type GoogleCredentials = {
  refreshToken: string;
  calendarId?: string;
};

export type GoogleCalendarChoice = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
};

export type GoogleBusyWindow = {
  startsAtUtc: string;
  endsAtUtc: string;
};

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

type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

function googleClientCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_OAUTH_NOT_CONFIGURED");
  return { clientId, clientSecret };
}

export function googleOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleRedirectUri(requestUrl: string) {
  const configured = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (configured) return configured;
  const origin = new URL(requestUrl).origin;
  return `${origin}/api/admin/integrations/google/callback`;
}

export async function exchangeGoogleAuthorizationCode(input: {
  code: string;
  redirectUri: string;
}) {
  const { clientId, clientSecret } = googleClientCredentials();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const payload = await response.json() as TokenPayload;
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? "GOOGLE_TOKEN_EXCHANGE_FAILED");
  }
  return payload;
}

export async function getGoogleAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = googleClientCredentials();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json() as TokenPayload;
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? "GOOGLE_TOKEN_REFRESH_FAILED");
  }
  return payload.access_token;
}

async function googleApi<T>(url: string, accessToken: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string }; message?: string };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? payload.message ?? `GOOGLE_API_${response.status}`);
  }
  return payload;
}

export async function listGoogleCalendars(refreshToken: string): Promise<GoogleCalendarChoice[]> {
  const accessToken = await getGoogleAccessToken(refreshToken);
  const calendars: GoogleCalendarChoice[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const payload = await googleApi<{
      nextPageToken?: string;
      items?: Array<{ id?: string; summary?: string; primary?: boolean; accessRole?: string; deleted?: boolean }>;
    }>(url.toString(), accessToken);
    for (const item of payload.items ?? []) {
      if (!item.id || item.deleted) continue;
      if (!['owner', 'writer'].includes(item.accessRole ?? '')) continue;
      calendars.push({
        id: item.id,
        summary: item.summary || item.id,
        primary: Boolean(item.primary),
        accessRole: item.accessRole ?? "reader",
      });
    }
    pageToken = payload.nextPageToken;
  } while (pageToken);

  return calendars.sort((left, right) => Number(right.primary) - Number(left.primary) || left.summary.localeCompare(right.summary));
}

export async function createGoogleCalendarEvent(credentials: GoogleCredentials, event: GoogleEventInput) {
  const token = await getGoogleAccessToken(credentials.refreshToken);
  const calendarId = credentials.calendarId ?? "primary";
  const eventId = googleEventId(event.appointmentId);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: eventId,
        summary: event.title,
        description: event.description,
        location: event.location,
        start: { dateTime: event.startsAtUtc, timeZone: event.timezone },
        end: { dateTime: event.endsAtUtc, timeZone: event.timezone },
        attendees: event.customerEmail ? [{ email: event.customerEmail }] : undefined,
        extendedProperties: { private: { appointmentId: event.appointmentId } },
      }),
    },
  );
  if (response.status === 409) return eventId;
  const payload = await response.json().catch(() => ({})) as { id?: string; message?: string; error?: { message?: string } };
  if (!response.ok || !payload.id) throw new Error(payload.error?.message ?? payload.message ?? "GOOGLE_EVENT_CREATE_FAILED");
  return payload.id;
}

export async function deleteGoogleCalendarEvent(credentials: GoogleCredentials, eventId: string) {
  const token = await getGoogleAccessToken(credentials.refreshToken);
  const calendarId = credentials.calendarId ?? "primary";
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (response.ok || response.status === 404 || response.status === 410) return;
  const payload = await response.json().catch(() => ({})) as { error?: { message?: string }; message?: string };
  throw new Error(payload.error?.message ?? payload.message ?? "GOOGLE_EVENT_DELETE_FAILED");
}

export async function listGoogleBusyWindows(
  credentials: GoogleCredentials,
  input: { startsAtUtc: string; endsAtUtc: string; timezone: string },
): Promise<GoogleBusyWindow[]> {
  const token = await getGoogleAccessToken(credentials.refreshToken);
  const calendarId = credentials.calendarId ?? "primary";
  const payload = await googleApi<{
    calendars?: Record<string, { busy?: Array<{ start?: string; end?: string }>; errors?: unknown[] }>;
  }>("https://www.googleapis.com/calendar/v3/freeBusy", token, {
    method: "POST",
    body: JSON.stringify({
      timeMin: input.startsAtUtc,
      timeMax: input.endsAtUtc,
      timeZone: input.timezone,
      items: [{ id: calendarId }],
    }),
  });
  const calendar = payload.calendars?.[calendarId];
  if (calendar?.errors?.length) throw new Error("GOOGLE_FREEBUSY_FAILED");
  return (calendar?.busy ?? [])
    .filter((item): item is { start: string; end: string } => Boolean(item.start && item.end))
    .map((item) => ({ startsAtUtc: item.start, endsAtUtc: item.end }));
}

export async function revokeGoogleToken(refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  });
  if (!response.ok && response.status !== 400) throw new Error("GOOGLE_TOKEN_REVOKE_FAILED");
}

function googleEventId(appointmentId: string) {
  const normalized = appointmentId.toLowerCase().replace(/[^a-v0-9]/g, "");
  return (normalized || crypto.randomUUID().replace(/-/g, "")).slice(0, 64);
}
