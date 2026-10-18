// Property lookup using free, key-less public APIs:
//   - Photon (OpenStreetMap)          address autocomplete
//   - US Census Geocoder              verified address, coordinates, county, tract
//   - OSM Nominatim                   fallback geocoder
//   - OSM Overpass                    building footprint tags (type, levels, year)
//   - FEMA National Flood Hazard Layer flood zone
//   - Rentcast (optional, free tier)  beds / baths / sqft / year built / lot size
import { config } from './config.js';

const UA = `HISCORP-Scheduler/1.0 (${config.osmContact})`;
const cache = new Map();
const TTL = 1000 * 60 * 60 * 6;

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

async function getJSON(url, { timeout = 8000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return res.json();
}

/** Run a lookup but never let one failing source break the whole response. */
async function safe(name, fn, sources) {
  try {
    const v = await fn();
    sources.push({ name, ok: v != null });
    return v;
  } catch (err) {
    sources.push({ name, ok: false, error: err.message });
    return null;
  }
}

/* ------------------------------ Autocomplete ------------------------------ */

export async function suggestAddresses(q) {
  if (!q || q.trim().length < 4) return [];
  const { lat, lon } = config.business.office;
  const url = new URL('https://photon.komoot.io/api/');
  url.search = new URLSearchParams({ q, limit: '8', lang: 'en', lat, lon }).toString();
  const data = await cached(`sug:${q.toLowerCase()}`, () => getJSON(url, { timeout: 5000 }));
  const seen = new Set();
  return (data.features || [])
    .filter((f) => f.properties?.countrycode === 'US')
    .map((f) => {
      const p = f.properties;
      const street = [p.housenumber, p.street || (p.housenumber ? null : p.name)].filter(Boolean).join(' ');
      const label = [street || p.name, p.city || p.town || p.village || p.county, [p.state, p.postcode].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', ');
      return { label, hasNumber: Boolean(p.housenumber), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
    })
    .filter((s) => s.label && !seen.has(s.label) && seen.add(s.label))
    .sort((a, b) => Number(b.hasNumber) - Number(a.hasNumber))
    .slice(0, 5);
}

/* ------------------------------ Geocoding -------------------------------- */

async function censusGeocode(address) {
  const url = new URL('https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress');
  url.search = new URLSearchParams({
    address,
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    format: 'json',
  }).toString();
  const data = await getJSON(url, { timeout: 10000 });
  const m = data?.result?.addressMatches?.[0];
  if (!m) return null;
  const g = m.geographies || {};
  const county = g.Counties?.[0];
  const tract = g['Census Tracts']?.[0];
  const place = g['Incorporated Places']?.[0];
  return {
    matchedAddress: m.matchedAddress,
    lat: m.coordinates.y,
    lon: m.coordinates.x,
    components: {
      city: m.addressComponents?.city,
      state: m.addressComponents?.state,
      zip: m.addressComponents?.zip,
    },
    county: county?.NAME ? `${county.NAME}` : null,
    countyFips: county?.GEOID ?? null,
    censusTract: tract?.NAME ?? null,
    incorporatedPlace: place?.NAME ?? null,
    source: 'US Census Geocoder',
  };
}

async function nominatimGeocode(address) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q: address, format: 'jsonv2', addressdetails: '1', countrycodes: 'us', limit: '1' }).toString();
  const [r] = await getJSON(url);
  if (!r) return null;
  const a = r.address || {};
  return {
    matchedAddress: r.display_name,
    lat: Number(r.lat),
    lon: Number(r.lon),
    components: { city: a.city || a.town || a.village, state: a.state, zip: a.postcode },
    county: a.county ?? null,
    countyFips: null,
    censusTract: null,
    incorporatedPlace: null,
    source: 'OpenStreetMap Nominatim',
  };
}

function calculatePolygonAreaSqFt(geometry) {
  if (!geometry || geometry.length < 3) return null;
  const lat0 = (geometry[0].lat * Math.PI) / 180;
  const mPerDegLat = 111132.954;
  const mPerDegLon = 111412.84 * Math.cos(lat0);

  let areaM2 = 0;
  for (let i = 0; i < geometry.length; i++) {
    const j = (i + 1) % geometry.length;
    const xi = geometry[i].lon * mPerDegLon;
    const yi = geometry[i].lat * mPerDegLat;
    const xj = geometry[j].lon * mPerDegLon;
    const yj = geometry[j].lat * mPerDegLat;
    areaM2 += xi * yj - xj * yi;
  }
  areaM2 = Math.abs(areaM2) / 2;
  const sqft = areaM2 * 10.7639;
  return Math.round(sqft);
}

async function osmBuilding(lat, lon) {
  const query = `[out:json][timeout:8];(way(around:40,${lat},${lon})["building"];);out geom 5;`;
  const data = await getJSON(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, { timeout: 9000 });
  const els = data.elements || [];
  if (!els.length) return null;
  const dist = (e) =>
    e.center
      ? (e.center.lat - lat) ** 2 + (e.center.lon - lon) ** 2
      : e.geometry?.[0]
      ? (e.geometry[0].lat - lat) ** 2 + (e.geometry[0].lon - lon) ** 2
      : 1;
  const el = els.sort((a, b) => dist(a) - dist(b))[0];
  const t = el.tags || {};
  const levels = t['building:levels'] ? Number(t['building:levels']) : null;
  const footprintSqft = el.geometry ? calculatePolygonAreaSqFt(el.geometry) : null;
  const totalSqft = footprintSqft ? footprintSqft * (levels || 1) : null;

  return {
    buildingType: t.building && t.building !== 'yes' ? t.building : null,
    levels,
    yearBuilt: t.start_date ? Number.parseInt(t.start_date, 10) || null : null,
    roofShape: t['roof:shape'] ?? null,
    name: t.name ?? null,
    footprintSqft,
    totalSqft,
  };
}

async function femaFloodZone(lat, lon) {
  const url = new URL('https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query');
  url.search = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF',
    returnGeometry: 'false',
    f: 'json',
  }).toString();
  const data = await getJSON(url, { timeout: 9000 });
  const a = data.features?.[0]?.attributes;
  if (!a) return null;
  return { zone: a.FLD_ZONE, subtype: a.ZONE_SUBTY || null, specialHazardArea: a.SFHA_TF === 'T' };
}

async function rentcast(address) {
  if (!config.rentcastKey) return null;
  const url = `https://api.rentcast.io/v1/properties?address=${encodeURIComponent(address)}`;
  const data = await getJSON(url, { headers: { 'X-Api-Key': config.rentcastKey } });
  const p = Array.isArray(data) ? data[0] : data;
  if (!p) return null;
  return {
    propertyType: p.propertyType ?? null,
    bedrooms: p.bedrooms ?? null,
    bathrooms: p.bathrooms ?? null,
    squareFootage: p.squareFootage ?? null,
    lotSize: p.lotSize ?? null,
    yearBuilt: p.yearBuilt ?? null,
    lastSaleDate: p.lastSaleDate ?? null,
    units: p.features?.unitCount ?? null,
  };
}

/* ------------------------------ Derived ---------------------------------- */

function milesBetween(a, b) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function suggestService({ osm, records }) {
  const t = `${records?.propertyType || ''} ${osm?.buildingType || ''}`.toLowerCase();
  if (/manufactured|mobile|static_caravan/.test(t)) return 'mobile-t25';
  if (/apartment|multi|duplex|triplex|quadruplex/.test(t) || (records?.units ?? 0) > 1) return 'multi-unit';
  if (/commercial|retail|office|industrial|warehouse/.test(t)) return 'commercial';
  return 'residential';
}

function buildInsights({ yearBuilt, flood, distanceMiles }) {
  const out = [];
  if (yearBuilt) {
    if (yearBuilt < 1950) out.push({ level: 'warn', text: `Built ${yearBuilt}: may have knob-and-tube wiring or galvanized plumbing.` });
    if (yearBuilt < 1978) out.push({ level: 'warn', text: `Pre-1978 construction: lead-based paint may be present.` });
    if (yearBuilt < 1981) out.push({ level: 'info', text: 'Built before 1981 asbestos phase-out; suspect materials will be noted.' });
    if (yearBuilt >= 2015) out.push({ level: 'ok', text: 'Newer construction: builder warranty items may still apply.' });
  }
  if (flood?.specialHazardArea) out.push({ level: 'warn', text: `FEMA Special Flood Hazard Area (Zone ${flood.zone}). Crawlspace/drainage will get extra attention.` });
  else if (flood?.zone) out.push({ level: 'ok', text: `FEMA flood zone ${flood.zone}${flood.subtype ? ` (${flood.subtype.toLowerCase()})` : ''}.` });
  if (distanceMiles != null && distanceMiles > config.business.serviceRadiusMiles) {
    out.push({ level: 'warn', text: `${Math.round(distanceMiles)} mi from our office: outside the standard service area, a travel fee may apply.` });
  }
  return out;
}

function deriveSquareFootage({ records, osm, address, suggestedService }) {
  if (records?.squareFootage) {
    return { sqft: records.squareFootage, source: 'Public Assessment / MLS Records', isEstimate: false };
  }
  if (osm?.totalSqft && osm.totalSqft > 400 && osm.totalSqft < 200000) {
    return { sqft: osm.totalSqft, source: 'Building Footprint Geometry', isEstimate: false };
  }

  // Intelligent estimation based on property type / suggested service
  switch (suggestedService) {
    case 'mobile-t25':
      return { sqft: 1250, source: 'Manufactured Housing Standard Estimate', isEstimate: true };
    case 'multi-unit':
      return { sqft: 3800, source: 'Multi-Family Parcel Estimate', isEstimate: true };
    case 'commercial':
      return { sqft: 4500, source: 'Commercial Suite Estimate', isEstimate: true };
    case 'residential':
    default:
      return { sqft: 2150, source: 'Regional Single-Family Estimate', isEstimate: true };
  }
}

/* ------------------------------ Public ----------------------------------- */

export async function lookupProperty(address) {
  const key = `prop:${address.trim().toLowerCase()}`;
  return cached(key, async () => {
    const sources = [];
    const geo =
      (await safe('US Census Geocoder', () => censusGeocode(address), sources)) ||
      (await safe('OpenStreetMap Nominatim', () => nominatimGeocode(address), sources));
    if (!geo) return { found: false, sources };

    const [osm, flood, records] = await Promise.all([
      safe('OpenStreetMap buildings', () => osmBuilding(geo.lat, geo.lon), sources),
      safe('FEMA Flood Map', () => femaFloodZone(geo.lat, geo.lon), sources),
      config.rentcastKey ? safe('Rentcast property records', () => rentcast(geo.matchedAddress), sources) : null,
    ]);

    const distanceMiles = milesBetween(config.business.office, geo);
    const yearBuilt = records?.yearBuilt ?? osm?.yearBuilt ?? null;
    const suggestedSvc = suggestService({ osm, records });
    const sqftInfo = deriveSquareFootage({ records, osm, address: geo.matchedAddress, suggestedService: suggestedSvc });

    return {
      found: true,
      address: geo.matchedAddress,
      location: { lat: geo.lat, lon: geo.lon },
      components: geo.components,
      county: geo.county,
      countyFips: geo.countyFips,
      censusTract: geo.censusTract,
      incorporatedPlace: geo.incorporatedPlace,
      distanceMiles: Math.round(distanceMiles * 10) / 10,
      inServiceArea: distanceMiles <= config.business.serviceRadiusMiles,
      building: osm,
      floodZone: flood,
      records,
      facts: {
        propertyType: records?.propertyType ?? osm?.buildingType ?? null,
        yearBuilt,
        sqft: sqftInfo.sqft,
        sqftSource: sqftInfo.source,
        sqftIsEstimate: sqftInfo.isEstimate,
        bedrooms: records?.bedrooms ?? null,
        bathrooms: records?.bathrooms ?? null,
        lotSize: records?.lotSize ?? null,
        stories: osm?.levels ?? null,
        units: records?.units ?? null,
      },
      suggestedService: suggestedSvc,
      insights: buildInsights({ yearBuilt, flood, distanceMiles }),
      rentcastEnabled: Boolean(config.rentcastKey),
      sources,
    };
  });
}
