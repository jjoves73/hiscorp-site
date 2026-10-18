// Inspection service catalog. Durations are estimated server-side so the
// calendar slot always matches the property that was looked up.

export const SERVICES = [
  {
    id: 'residential',
    name: 'Residential Home Inspection',
    short: 'Residential',
    blurb: 'Single-family homes, condos & townhomes. Roof to foundation, every system.',
    baseMinutes: 180,
    image: '/images/residential.jpg',
    colorId: '5', // Google Calendar "banana"
  },
  {
    id: 'mobile-t25',
    name: 'Mobile Home T25 Health & Safety',
    short: 'Mobile Home T25',
    blurb: 'Title 25 health & safety inspection for manufactured and mobile homes.',
    baseMinutes: 90,
    image: '/images/mobile-home.png',
    colorId: '2', // "sage"
  },
  {
    id: 'multi-unit',
    name: 'Multi-Unit & Apartment Inspection',
    short: 'Multi-Unit',
    blurb: 'Duplexes to apartment buildings. Common areas plus individual units.',
    baseMinutes: 120,
    image: '/images/multi-unit.png',
    colorId: '7', // "peacock"
  },
  {
    id: 'commercial',
    name: 'Commercial Property Inspection',
    short: 'Commercial',
    blurb: 'Offices, retail and mixed-use buildings. Clear findings for owners & buyers.',
    baseMinutes: 240,
    image: '/images/commercial.jpg',
    colorId: '9', // "blueberry"
  },
];

export const getService = (id) => SERVICES.find((s) => s.id === id);

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const roundTo = (n, step) => Math.ceil(n / step) * step;

/**
 * Estimate on-site minutes for a service given property details.
 * @param {string} serviceId
 * @param {{ sqft?: number, units?: number }} details
 */
export function estimateDuration(serviceId, details = {}) {
  const svc = getService(serviceId);
  if (!svc) throw new Error(`Unknown service: ${serviceId}`);
  const sqft = Number(details.sqft) || 0;
  const units = Number(details.units) || 0;
  let mins = svc.baseMinutes;

  switch (serviceId) {
    case 'residential':
      // +30 min per 1,000 sqft above 2,000
      if (sqft > 2000) mins += Math.ceil((sqft - 2000) / 1000) * 30;
      mins = clamp(mins, 150, 330);
      break;
    case 'mobile-t25':
      if (sqft > 1600) mins += 30;
      break;
    case 'multi-unit':
      // +30 min per unit beyond 2
      if (units > 2) mins += (units - 2) * 30;
      mins = clamp(mins, 120, 480);
      break;
    case 'commercial':
      if (sqft > 5000) mins += Math.ceil((sqft - 5000) / 5000) * 60;
      mins = clamp(mins, 240, 480);
      break;
  }
  return roundTo(mins, 30);
}

export const publicServices = () =>
  SERVICES.map(({ id, name, short, blurb, baseMinutes, image }) => ({ id, name, short, blurb, baseMinutes, image }));
