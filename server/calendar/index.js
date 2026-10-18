import { config } from '../config.js';
import { mockCalendar } from './mock.js';

export async function getCalendar() {
  if (config.calendarMode === 'google') {
    const { googleCalendar } = await import('./google.js');
    return googleCalendar;
  }
  return mockCalendar;
}
