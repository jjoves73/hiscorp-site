// Central configuration, read from environment variables (see .env.example).
const env = process.env;

const toInt = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

export const config = {
  port: toInt(env.PORT, 8787),
  isProd: env.NODE_ENV === 'production',

  calendarMode: (env.CALENDAR_MODE || 'mock').toLowerCase(),

  business: {
    name: 'HISCORP',
    tz: env.BUSINESS_TZ || 'America/Los_Angeles',
    days: (env.BUSINESS_DAYS || '1,2,3,4,5,6').split(',').map((d) => Number(d.trim())),
    start: env.BUSINESS_START || '08:00',
    end: env.BUSINESS_END || '18:00',
    slotStepMin: toInt(env.SLOT_STEP_MIN, 30),
    travelBufferMin: toInt(env.TRAVEL_BUFFER_MIN, 30),
    minNoticeHours: toInt(env.MIN_NOTICE_HOURS, 24),
    horizonDays: toInt(env.BOOKING_HORIZON_DAYS, 60),
    // Office: 1085 Tasman Dr, Sunnyvale, CA 94089
    office: { lat: 37.4119, lon: -121.9966 },
    serviceRadiusMiles: toInt(env.SERVICE_RADIUS_MILES, 60),
  },

  google: {
    calendarId: env.GOOGLE_CALENDAR_ID || 'primary',
    keyFile: env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
    keyJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
  },

  rentcastKey: env.RENTCAST_API_KEY || '',
  osmContact: env.OSM_CONTACT || 'hiscorp@gmail.com',
  adminToken: env.ADMIN_TOKEN || '',
};
