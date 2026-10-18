// Turns calendar free/busy data into bookable start times.
import { DateTime, Interval } from 'luxon';
import { config } from './config.js';

const B = config.business;

const hm = (s) => {
  const [h, m] = s.split(':').map(Number);
  return { hour: h, minute: m || 0 };
};

/** Earliest bookable instant (now + minimum notice). */
const earliest = () => DateTime.now().setZone(B.tz).plus({ hours: B.minNoticeHours });
/** Last bookable day. */
const horizonEnd = () => DateTime.now().setZone(B.tz).plus({ days: B.horizonDays }).endOf('day');

/**
 * Compute open slots for every day in [fromDate, toDate] (YYYY-MM-DD, business tz).
 * @param {object} calendar  adapter with getBusy()
 * @param {string} fromDate
 * @param {string} toDate
 * @param {number} durationMin
 * @returns {Promise<Record<string, string[]>>} map of date -> ISO start times
 */
export async function computeSlots(calendar, fromDate, toDate, durationMin) {
  const from = DateTime.fromISO(fromDate, { zone: B.tz }).startOf('day');
  const to = DateTime.fromISO(toDate, { zone: B.tz }).endOf('day');
  if (!from.isValid || !to.isValid || to < from) throw new Error('Invalid date range');

  const busy = (await calendar.getBusy(from.toUTC().toISO(), to.toUTC().toISO())).map((b) =>
    Interval.fromDateTimes(DateTime.fromISO(b.start), DateTime.fromISO(b.end)),
  );

  const minStart = earliest();
  const maxDay = horizonEnd();
  const open = hm(B.start);
  const close = hm(B.end);
  const result = {};

  for (let day = from; day <= to; day = day.plus({ days: 1 })) {
    const key = day.toISODate();
    result[key] = [];
    if (!B.days.includes(day.weekday) || day > maxDay) continue;

    const dayOpen = day.set({ ...open, second: 0, millisecond: 0 });
    const dayClose = day.set({ ...close, second: 0, millisecond: 0 });

    for (let s = dayOpen; s.plus({ minutes: durationMin }) <= dayClose; s = s.plus({ minutes: B.slotStepMin })) {
      if (s < minStart) continue;
      // Protect travel time on both sides of the inspection.
      const block = Interval.fromDateTimes(
        s.minus({ minutes: B.travelBufferMin }),
        s.plus({ minutes: durationMin + B.travelBufferMin }),
      );
      if (busy.some((b) => b.overlaps(block))) continue;
      result[key].push(s.toISO({ suppressMilliseconds: true }));
    }
  }
  return result;
}

/** Re-validate a single start time right before booking (guards against races). */
export async function isSlotAvailable(calendar, startISO, durationMin) {
  const start = DateTime.fromISO(startISO, { setZone: true }).setZone(B.tz);
  if (!start.isValid) return false;
  const slots = await computeSlots(calendar, start.toISODate(), start.toISODate(), durationMin);
  return (slots[start.toISODate()] || []).some((s) => DateTime.fromISO(s).toMillis() === start.toMillis());
}

export const businessRules = () => ({
  tz: B.tz,
  days: B.days,
  start: B.start,
  end: B.end,
  minNoticeHours: B.minNoticeHours,
  horizonDays: B.horizonDays,
  travelBufferMin: B.travelBufferMin,
});
