import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { DateTime } from 'luxon';
import { config } from './config.js';
import { getCalendar } from './calendar/index.js';
import { computeSlots, isSlotAvailable, businessRules } from './availability.js';
import { suggestAddresses, lookupProperty } from './property.js';
import { publicServices, getService, estimateDuration } from './services.js';

const app = express();
app.use(express.json({ limit: '50kb' }));

const calendar = await getCalendar();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/* ------------------------------- Meta ------------------------------------ */

app.get('/api/config', (_req, res) => {
  res.json({
    calendarMode: calendar.mode,
    calendarLabel: calendar.label,
    rules: businessRules(),
    services: publicServices(),
    rentcastEnabled: Boolean(config.rentcastKey),
  });
});

app.get('/api/duration', (req, res) => {
  const { service, sqft, units } = req.query;
  if (!getService(service)) return res.status(400).json({ error: 'Unknown service' });
  res.json({ minutes: estimateDuration(service, { sqft, units }) });
});

/* ------------------------------ Property --------------------------------- */

app.get('/api/address/suggest', wrap(async (req, res) => {
  const q = String(req.query.q || '').slice(0, 200);
  try {
    res.json({ suggestions: await suggestAddresses(q) });
  } catch {
    res.json({ suggestions: [] }); // autocomplete is best-effort
  }
}));

app.get('/api/property', wrap(async (req, res) => {
  const address = String(req.query.address || '').trim().slice(0, 300);
  if (address.length < 6) return res.status(400).json({ error: 'Please enter a full street address.' });
  const result = await lookupProperty(address);
  if (!result.found) return res.status(404).json({ error: "We couldn't verify that address. Check the street number and city.", sources: result.sources });
  res.json(result);
}));

/* ---------------------------- Availability ------------------------------- */

app.get('/api/availability', wrap(async (req, res) => {
  const { from, to } = req.query;
  const minutes = Number(req.query.minutes);
  if (!from || !to || !(minutes >= 30 && minutes <= 600)) return res.status(400).json({ error: 'from, to, minutes required' });
  const span = DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days;
  if (!(span >= 0 && span <= 42)) return res.status(400).json({ error: 'Range must be 0–42 days' });
  const slots = await computeSlots(calendar, from, to, minutes);
  res.json({ tz: config.business.tz, minutes, slots });
}));

/* ------------------------------ Bookings --------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v, max = 500) => (v == null ? '' : String(v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max));

function buildDescription({ svc, minutes, property, details, contact, notes }) {
  const f = property?.facts || {};
  const line = (k, v) => (v != null && v !== '' ? `${k}: ${v}` : null);
  return [
    `📋 ${svc.name} — est. ${minutes / 60} hrs on site`,
    '',
    '👤 CLIENT',
    line('Name', contact.name),
    line('Email', contact.email),
    line('Phone', contact.phone),
    line('Role', contact.role),
    '',
    '🏠 PROPERTY',
    line('Address', property?.address),
    line('Type', details.propertyType || f.propertyType),
    line('Year built', details.yearBuilt || f.yearBuilt),
    line('Square feet', details.sqft || f.sqft),
    line('Beds / Baths', (details.bedrooms || f.bedrooms || details.bathrooms || f.bathrooms) ? `${details.bedrooms || f.bedrooms || '?'} / ${details.bathrooms || f.bathrooms || '?'}` : null),
    line('Units', details.units),
    line('Stories', details.stories || f.stories),
    line('Foundation', details.foundation),
    line('Occupancy', details.occupancy),
    line('County', property?.county),
    line('Census tract', property?.censusTract),
    line('FEMA flood zone', property?.floodZone?.zone),
    line('Distance from office', property?.distanceMiles != null ? `${property.distanceMiles} mi` : null),
    property?.location ? `Map: https://www.google.com/maps/search/?api=1&query=${property.location.lat},${property.location.lon}` : null,
    '',
    property?.insights?.length ? '⚠️ PRE-INSPECTION NOTES' : null,
    ...(property?.insights || []).map((i) => `• ${i.text}`),
    property?.insights?.length ? '' : null,
    line('🔑 Access', details.accessNotes),
    line('📝 Notes', notes),
    '',
    'Booked online via hiscorp.net',
  ].filter((l) => l !== null).join('\n');
}

const gcalTemplateUrl = ({ title, start, end, location, details }) => {
  const fmt = (iso) => DateTime.fromISO(iso).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${fmt(start)}/${fmt(end)}`, location, details });
  return `https://calendar.google.com/calendar/render?${p}`;
};

app.post('/api/bookings', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(400).json({ error: 'Rejected' }); // honeypot

  const svc = getService(b.serviceId);
  if (!svc) return res.status(400).json({ error: 'Choose a service.' });

  const contact = {
    name: clean(b.contact?.name, 100),
    email: clean(b.contact?.email, 200),
    phone: clean(b.contact?.phone, 40),
    role: clean(b.contact?.role, 40),
  };
  if (!contact.name || !EMAIL_RE.test(contact.email)) return res.status(400).json({ error: 'Name and a valid email are required.' });

  const property = b.property;
  if (!property?.address) return res.status(400).json({ error: 'Property address is required.' });

  const d = b.details || {};
  const details = {
    propertyType: clean(d.propertyType, 60),
    yearBuilt: clean(d.yearBuilt, 4),
    sqft: clean(d.sqft, 7),
    bedrooms: clean(d.bedrooms, 3),
    bathrooms: clean(d.bathrooms, 4),
    units: clean(d.units, 4),
    stories: clean(d.stories, 3),
    foundation: clean(d.foundation, 40),
    occupancy: clean(d.occupancy, 40),
    accessNotes: clean(d.accessNotes, 500),
  };
  const notes = clean(b.notes, 1000);

  // Server is the source of truth for duration.
  const minutes = estimateDuration(svc.id, { sqft: details.sqft || property.facts?.sqft, units: details.units });
  const start = DateTime.fromISO(String(b.start), { setZone: true });
  if (!start.isValid) return res.status(400).json({ error: 'Invalid start time.' });

  if (!(await isSlotAvailable(calendar, start.toISO(), minutes))) {
    return res.status(409).json({ error: 'Sorry, that time was just taken. Please choose another slot.' });
  }

  const end = start.plus({ minutes });
  const tz = config.business.tz;
  const city = property.components?.city || property.address.split(',')[1]?.trim() || '';
  const summary = `${svc.short} Inspection — ${contact.name}${city ? ` (${city})` : ''}`;
  const description = buildDescription({ svc, minutes, property, details, contact, notes });

  const event = await calendar.createEvent({
    summary,
    location: property.address,
    description,
    colorId: svc.colorId,
    start: { dateTime: start.toISO(), timeZone: tz },
    end: { dateTime: end.toISO(), timeZone: tz },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }, { method: 'popup', minutes: 24 * 60 }] },
    extendedProperties: {
      private: {
        source: 'hiscorp-web',
        serviceId: svc.id,
        clientEmail: contact.email,
        clientPhone: contact.phone,
        lat: String(property.location?.lat ?? ''),
        lon: String(property.location?.lon ?? ''),
      },
    },
  });

  res.status(201).json({
    id: event.id,
    summary,
    service: svc.name,
    start: start.toISO(),
    end: end.toISO(),
    minutes,
    address: property.address,
    calendarMode: calendar.mode,
    htmlLink: event.htmlLink,
    addToGoogleCalendar: gcalTemplateUrl({
      title: `HISCORP ${svc.short} Inspection`,
      start: start.toISO(),
      end: end.toISO(),
      location: property.address,
      details: `Your ${svc.name} with HISCORP.\nQuestions? (408) 966-1634 · hiscorp@gmail.com`,
    }),
  });
}));

/* -------------------------------- Admin ---------------------------------- */

const requireAdmin = (req, res, next) => {
  if (!config.adminToken || req.get('x-admin-token') === config.adminToken) return next();
  res.status(401).json({ error: 'Admin token required' });
};

app.get('/api/admin/events', requireAdmin, wrap(async (req, res) => {
  const from = req.query.from || DateTime.now().minus({ days: 1 }).toISO();
  const to = req.query.to || DateTime.now().plus({ days: 45 }).toISO();
  res.json({ calendarLabel: calendar.label, events: await calendar.listEvents(from, to) });
}));

app.delete('/api/admin/events/:id', requireAdmin, wrap(async (req, res) => {
  res.json({ deleted: await calendar.deleteEvent(req.params.id) });
}));

app.post('/api/admin/events', requireAdmin, wrap(async (req, res) => {
  const { summary, start, end, location, description } = req.body || {};
  if (!summary || !start || !end) {
    return res.status(400).json({ error: 'Summary, start time, and end time are required.' });
  }
  const tz = config.business.tz;
  const event = await calendar.createEvent({
    summary: String(summary).trim(),
    location: location ? String(location).trim() : '',
    description: description ? String(description).trim() : 'Created from HISCORP Admin Calendar',
    start: { dateTime: new Date(start).toISOString(), timeZone: tz },
    end: { dateTime: new Date(end).toISOString(), timeZone: tz },
  });
  res.json({ event });
}));

/* ------------------------------- Static ---------------------------------- */

const dist = resolve(import.meta.dirname, '../dist');
if (config.isProd && existsSync(dist)) app.use(express.static(dist));

app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(500).json({ error: config.isProd ? 'Something went wrong.' : err.message });
});

app.listen(config.port, () => {
  console.log(`HISCORP API on http://localhost:${config.port}  ·  calendar: ${calendar.label}`);
});
