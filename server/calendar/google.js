// Real Google Calendar adapter (service-account auth).
// Setup: see README "Switching to real Google Calendar".
import { readFileSync } from 'node:fs';
import { google } from 'googleapis';
import { config } from '../config.js';

function loadCredentials() {
  const { keyJson, keyFile } = config.google;
  if (keyJson) return JSON.parse(keyJson);
  if (keyFile) return JSON.parse(readFileSync(keyFile, 'utf8'));
  throw new Error(
    'CALENDAR_MODE=google but no credentials. Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE or GOOGLE_SERVICE_ACCOUNT_JSON.',
  );
}

let api;
function calendar() {
  if (api) return api;
  const auth = new google.auth.GoogleAuth({
    credentials: loadCredentials(),
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  api = google.calendar({ version: 'v3', auth });
  return api;
}

const calendarId = () => config.google.calendarId;

const normalize = (e) => ({
  id: e.id,
  summary: e.summary,
  description: e.description,
  location: e.location,
  start: e.start?.dateTime || e.start?.date,
  end: e.end?.dateTime || e.end?.date,
  htmlLink: e.htmlLink,
  created: e.created,
  extendedProperties: e.extendedProperties,
});

export const googleCalendar = {
  mode: 'google',
  get label() {
    return `Google Calendar (${calendarId()})`;
  },

  async getBusy(timeMin, timeMax) {
    const { data } = await calendar().freebusy.query({
      requestBody: { timeMin, timeMax, timeZone: config.business.tz, items: [{ id: calendarId() }] },
    });
    const cal = data.calendars?.[calendarId()];
    if (cal?.errors?.length) {
      throw new Error(`Free/busy error: ${cal.errors.map((e) => e.reason).join(', ')} — is the calendar shared with the service account?`);
    }
    return cal?.busy ?? [];
  },

  async createEvent(requestBody) {
    // Note: service accounts can't invite attendees without Workspace domain-wide
    // delegation, so the customer's email lives in the description instead.
    const { data } = await calendar().events.insert({ calendarId: calendarId(), requestBody });
    return normalize(data);
  },

  async listEvents(timeMin, timeMax) {
    const { data } = await calendar().events.list({
      calendarId: calendarId(),
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });
    return (data.items ?? []).map(normalize);
  },

  async deleteEvent(id) {
    await calendar().events.delete({ calendarId: calendarId(), eventId: id });
    return true;
  },
};
