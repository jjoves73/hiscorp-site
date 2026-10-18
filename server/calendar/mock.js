// Mock Google Calendar adapter.
// Mirrors the subset of the Calendar API we use (freebusy + events) and
// persists to a local JSON file so you can test the full flow without Google.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { config } from '../config.js';

const FILE = resolve(import.meta.dirname, '../data/mock-calendar.json');
let cache = null;

async function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    cache = { calendarId: 'mock-hiscorp@calendar.local', events: seedEvents() };
    await save();
  }
  return cache;
}

async function save() {
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(cache, null, 2));
}

// Seed a realistic-looking existing schedule for the next ~5 weeks so the
// availability picker shows partially-booked days.
function seedEvents() {
  const tz = config.business.tz;
  const today = DateTime.now().setZone(tz).startOf('day');
  const events = [];
  const pattern = [
    // [dayOffset mod 7, startHour, durationHours, summary]
    [0, 9, 3, 'Residential inspection — Cupertino'],
    [1, 13, 2, 'T25 inspection — Mountain View MHP'],
    [2, 8, 4, 'Commercial walkthrough — Santa Clara'],
    [3, 10, 3, 'Residential inspection — San Jose'],
    [3, 15, 1.5, 'Re-inspection — Sunnyvale'],
    [4, 12, 5, 'Multi-unit (6 units) — Milpitas'],
    [5, 9, 3, 'Residential inspection — Los Altos'],
  ];
  for (let d = 1; d <= 36; d++) {
    const day = today.plus({ days: d });
    for (const [mod, h, dur, summary] of pattern) {
      if (d % 7 !== mod || (d % 5 === 0 && mod % 2 === 0)) continue;
      const start = day.set({ hour: Math.floor(h), minute: (h % 1) * 60 });
      events.push({
        id: randomUUID(),
        summary,
        start: start.toISO(),
        end: start.plus({ minutes: dur * 60 }).toISO(),
        seeded: true,
      });
    }
  }
  return events;
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

export const mockCalendar = {
  mode: 'mock',
  label: 'Mock Google Calendar (local JSON)',

  async getBusy(timeMin, timeMax) {
    const { events } = await load();
    const min = Date.parse(timeMin);
    const max = Date.parse(timeMax);
    return events
      .filter((e) => overlaps(Date.parse(e.start), Date.parse(e.end), min, max))
      .map((e) => ({ start: e.start, end: e.end }));
  },

  async createEvent(ev) {
    const data = await load();
    const event = {
      id: randomUUID(),
      ...ev,
      start: ev.start.dateTime,
      end: ev.end.dateTime,
      created: new Date().toISOString(),
      htmlLink: null,
    };
    data.events.push(event);
    await save();
    return event;
  },

  async listEvents(timeMin, timeMax) {
    const { events } = await load();
    const min = Date.parse(timeMin);
    const max = Date.parse(timeMax);
    return events
      .filter((e) => overlaps(Date.parse(e.start), Date.parse(e.end), min, max))
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  },

  async deleteEvent(id) {
    const data = await load();
    const before = data.events.length;
    data.events = data.events.filter((e) => e.id !== id);
    await save();
    return data.events.length < before;
  },
};
