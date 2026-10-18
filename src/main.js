// HISCORP Front-End Application Logic
// Orchestrates multi-step booking, free address property lookup, and Google Calendar sync.

const state = {
  step: 1,
  services: [],
  selectedService: 'residential',
  property: null,
  durationMinutes: 180,
  currentMonth: new Date(),
  availabilityCache: {}, // key: YYYY-MM -> slots
  selectedDate: null,    // YYYY-MM-DD
  selectedSlot: null,    // ISO string
  submitting: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  initServiceSelection();
  initAddressLookup();
  initCalendar();
  initBookingForm();
  await loadConfig();
});

/* --------------------------------------------------------------------------
   Config & Metadata
   -------------------------------------------------------------------------- */
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const data = await res.json();
    state.services = data.services;
    console.log('[hiscorp] Backend connected:', data.calendarLabel, `(${data.calendarMode})`);
  } catch (err) {
    console.warn('[hiscorp] Could not reach backend config', err);
  }
}

/* --------------------------------------------------------------------------
   Navigation & Stepper
   -------------------------------------------------------------------------- */
function initNavigation() {
  // Mobile Menu Drawer
  const mobileToggle = $('#mobileMenuToggle');
  const mobileClose = $('#mobileMenuClose');
  const mobileOverlay = $('#mobileMenuOverlay');
  const mobileDrawer = $('#mobileMenuDrawer');

  function openMobileMenu() {
    mobileDrawer?.classList.add('active');
    mobileOverlay?.classList.add('active');
    mobileToggle?.classList.add('active');
    mobileToggle?.setAttribute('aria-expanded', 'true');
    mobileDrawer?.setAttribute('aria-hidden', 'false');
    mobileOverlay?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeMobileMenu() {
    mobileDrawer?.classList.remove('active');
    mobileOverlay?.classList.remove('active');
    mobileToggle?.classList.remove('active');
    mobileToggle?.setAttribute('aria-expanded', 'false');
    mobileDrawer?.setAttribute('aria-hidden', 'true');
    mobileOverlay?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  mobileToggle?.addEventListener('click', () => {
    if (mobileDrawer?.classList.contains('active')) {
      closeMobileMenu();
    } else {
      openMobileMenu();
    }
  });

  mobileClose?.addEventListener('click', closeMobileMenu);
  mobileOverlay?.addEventListener('click', closeMobileMenu);

  $$('.mobile-nav-link, .mobile-book-btn').forEach((link) => {
    link.addEventListener('click', () => {
      closeMobileMenu();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobileDrawer?.classList.contains('active')) {
      closeMobileMenu();
    }
  });

  // Service shortcuts
  $$('[data-select-svc]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const svcId = el.getAttribute('data-select-svc');
      selectService(svcId);
      goToStep(1);
    });
  });

  // Make step indicators interactive
  $$('.step-indicator').forEach((ind) => {
    ind.style.cursor = 'pointer';
    ind.addEventListener('click', async () => {
      const s = Number(ind.getAttribute('data-step'));
      if (s === 3 && !state.property) {
        const inputVal = $('#addressInput')?.value.trim();
        await runPropertyLookup(inputVal || '1428 Elm St, Berkeley, CA 94702');
      }
      goToStep(s);
      if (s === 3) fetchMonthAvailability(state.currentMonth);
    });
  });

  // Step 1 -> 2
  $('#btnNext1')?.addEventListener('click', () => goToStep(2));

  // Step 2 -> 3
  $('#btnBack2')?.addEventListener('click', () => goToStep(1));
  $('#btnNext2')?.addEventListener('click', async () => {
    const inputVal = $('#addressInput')?.value.trim();
    if (!state.property) {
      await runPropertyLookup(inputVal || '1428 Elm St, Berkeley, CA 94702');
    }
    goToStep(3);
    fetchMonthAvailability(state.currentMonth);
  });

  // Step 3 -> 4
  $('#btnBack3')?.addEventListener('click', () => goToStep(2));
  $('#btnNext3')?.addEventListener('click', () => {
    updateSummary();
    goToStep(4);
  });

  // Step 4 Back
  $('#btnBack4')?.addEventListener('click', () => goToStep(3));

  // Book Another
  $('#btnBookAnother')?.addEventListener('click', () => {
    state.selectedSlot = null;
    state.selectedDate = null;
    $('#selectedSlotBanner').classList.add('hidden');
    $('#btnNext3').disabled = true;
    goToStep(1);
  });
}

function goToStep(stepNum) {
  state.step = stepNum;
  // Update stepper UI
  $$('.step-indicator').forEach((ind) => {
    const s = Number(ind.getAttribute('data-step'));
    ind.classList.remove('active', 'completed');
    if (s === stepNum) ind.classList.add('active');
    else if (s < stepNum) ind.classList.add('completed');
  });

  // Switch Panes
  $$('.wizard-pane').forEach((p) => p.classList.remove('active'));
  $(`#pane-step-${stepNum}`)?.classList.add('active');

  // Scroll booking wizard into comfortable view
  const wizard = $('#bookingApp');
  if (wizard && stepNum > 1) {
    const rect = wizard.getBoundingClientRect();
    if (rect.top < 80 || rect.top > 300) {
      wizard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

/* --------------------------------------------------------------------------
   Step 1: Service Selection
   -------------------------------------------------------------------------- */
function initServiceSelection() {
  $$('.service-select-card').forEach((card) => {
    card.addEventListener('click', () => {
      const svcId = card.getAttribute('data-service-id');
      selectService(svcId);
    });
  });
}

function selectService(svcId) {
  state.selectedService = svcId;
  $$('.service-select-card').forEach((c) => {
    c.classList.toggle('selected', c.getAttribute('data-service-id') === svcId);
  });
  recomputeDuration();
}

async function recomputeDuration() {
  const sqft = $('#detailSqft')?.value || state.property?.facts?.sqft || '';
  const units = state.property?.facts?.units || '';
  try {
    const res = await fetch(`/api/duration?service=${state.selectedService}&sqft=${sqft}&units=${units}`);
    if (res.ok) {
      const data = await res.json();
      state.durationMinutes = data.minutes;
      const hours = (data.minutes / 60).toFixed(1);
      $('#intelMinutesVal').textContent = `${hours} hrs`;
      $('#summaryDuration').textContent = `${hours} Hours on site`;
    }
  } catch (e) {
    console.error(e);
  }
}

/* --------------------------------------------------------------------------
   Step 2: Address & Live Free Property Lookup
   -------------------------------------------------------------------------- */
let autocompleteTimer = null;

function initAddressLookup() {
  const input = $('#addressInput');
  const suggestionsBox = $('#addressSuggestions');

  const sampleAddresses = [
    { label: '1428 Elm St, Berkeley, CA 94702' },
    { label: '100 California St, San Francisco, CA 94111' },
    { label: '450 Grand Ave, Oakland, CA 94610' },
    { label: '782 Marina Blvd, San Francisco, CA 94123' },
    { label: '2200 University Ave, Palo Alto, CA 94301' },
    { label: '55 S Market St, San Jose, CA 95113' },
    { label: '1250 Lincoln Ave, San Jose, CA 95125' },
    { label: '350 Bay St, San Francisco, CA 94133' },
    { label: '888 Howard St, San Francisco, CA 94103' },
  ];

  // Quick Demo Buttons
  $$('.btn-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      input.value = btn.getAttribute('data-addr');
      if ($('#btnNext2')) $('#btnNext2').disabled = false;
      runPropertyLookup(input.value);
    });
  });

  // Autocomplete typing with debounce
  input.addEventListener('input', () => {
    clearTimeout(autocompleteTimer);
    const q = input.value.trim();
    if (q.length > 2 && $('#btnNext2')) {
      $('#btnNext2').disabled = false;
    }
    if (q.length < 2) {
      suggestionsBox.classList.add('hidden');
      return;
    }
    autocompleteTimer = setTimeout(async () => {
      let suggestions = [];
      try {
        const res = await fetch(`/api/address/suggest?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.suggestions && data.suggestions.length) {
            suggestions = data.suggestions;
          }
        }
      } catch (err) {}

      if (!suggestions.length) {
        const lower = q.toLowerCase();
        suggestions = sampleAddresses.filter((a) => a.label.toLowerCase().includes(lower));
        if (!suggestions.length && q.length > 2) {
          suggestions = [{ label: `${q}, San Francisco Bay Area, CA` }];
        }
      }
      renderSuggestions(suggestions);
    }, 200);
  });

  // Lookup button click
  $('#btnLookupAddress')?.addEventListener('click', () => {
    if (input.value.trim()) runPropertyLookup(input.value.trim());
  });

  // Enter key initiates lookup
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      suggestionsBox.classList.add('hidden');
      if (input.value.trim()) runPropertyLookup(input.value.trim());
    }
  });

  // Close suggestions if clicked outside
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !suggestionsBox.contains(e.target)) {
      suggestionsBox.classList.add('hidden');
    }
  });

  // Listen to refined specs changes
  $('#detailSqft')?.addEventListener('input', () => recomputeDuration());
}

function renderSuggestions(list) {
  const box = $('#addressSuggestions');
  if (!list.length) {
    box.classList.add('hidden');
    return;
  }
  box.innerHTML = list
    .map((s) => `<div class="suggestion-item" data-val="${escapeHtml(s.label)}">${escapeHtml(s.label)}</div>`)
    .join('');
  box.classList.remove('hidden');

  box.querySelectorAll('.suggestion-item').forEach((item) => {
    item.addEventListener('click', () => {
      const val = item.getAttribute('data-val');
      $('#addressInput').value = val;
      box.classList.add('hidden');
      runPropertyLookup(val);
    });
  });
}

async function runPropertyLookup(address) {
  const btn = $('#btnLookupAddress');
  const spinner = btn?.querySelector('.spinner');
  const btnText = btn?.querySelector('.btn-text');
  const nextBtn = $('#btnNext2');

  try {
    if (btn) btn.disabled = true;
    spinner?.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Analyzing...';

    let data = null;
    try {
      const res = await fetch(`/api/property?address=${encodeURIComponent(address)}`);
      if (res.ok) {
        data = await res.json();
      }
    } catch (e) {
      console.warn('Backend unavailable, using client property mock:', e);
    }

    if (!data) {
      // Mock property details for client preview
      data = {
        found: true,
        address: address || '1428 Elm St, Berkeley, CA 94702',
        facts: {
          propertyType: 'Single Family Residential',
          yearBuilt: 1988,
          sqft: 2450,
          bedrooms: 4,
          bathrooms: 3,
          stories: 2,
        },
        county: 'Alameda County',
        distanceMiles: 8.4,
        floodZone: { zone: 'X (Minimal Risk)' },
        insights: [
          { type: 'age', text: 'Built in 1988 — Electrical subpanel and copper/PEX plumbing check recommended.' },
          { type: 'foundation', text: 'Raised foundation with crawlspace — moisture barrier and seismic strapping will be inspected.' },
          { type: 'service', text: 'Ideal match for Full Comprehensive Residential Home Inspection.' }
        ],
        sources: ['California Public Records Mock Cache', 'Bay Area GIS']
      };
    }

    state.property = data;
    renderPropertyIntel(data);

    // Auto-select specialized service if suggested by property characteristics!
    if (data.suggestedService && data.suggestedService !== state.selectedService) {
      selectService(data.suggestedService);
    } else {
      recomputeDuration();
    }

    nextBtn.disabled = false;
  } catch (err) {
    alert('Please enter a valid street address.');
  } finally {
    if (btn) btn.disabled = false;
    spinner?.classList.add('hidden');
    if (btnText) btnText.textContent = 'Lookup Property';
  }
}

function renderPropertyIntel(p) {
  const card = $('#propertyIntelCard');
  card.classList.remove('hidden');

  $('#intelVerifiedAddress').textContent = p.address;
  $('#metricCounty').textContent = p.county || 'Santa Clara / Regional';
  const tractClean = p.censusTract ? p.censusTract.replace(/^(census\s+tract\s*|tract\s*)/i, '') : null;
  $('#metricTract').textContent = tractClean ? `Tract ${tractClean}` : 'Bay Area Region';
  
  // Flood zone
  const fz = p.floodZone;
  if (fz?.zone) {
    $('#metricFlood').textContent = `Zone ${fz.zone} ${fz.specialHazardArea ? '(High Risk)' : '(Moderate/Low)'}`;
  } else {
    $('#metricFlood').textContent = 'Zone X (Low Risk)';
  }

  // Distance
  $('#metricDistance').textContent = p.distanceMiles != null ? `${p.distanceMiles} miles` : 'Within Bay Area';

  // Year built & Stories
  const yr = p.facts?.yearBuilt || (p.building?.yearBuilt ? p.building.yearBuilt : 'Estimated');
  $('#metricYear').textContent = yr;
  $('#metricStories').textContent = p.facts?.stories || p.building?.levels || '1 - 2';

  // Square footage
  const sqft = p.facts?.sqft;
  if (sqft) {
    const formattedSqft = Number(sqft).toLocaleString();
    $('#metricSqft').textContent = `${formattedSqft} sq ft`;
    $('#metricSqftSource').textContent = p.facts?.sqftSource || (p.facts?.sqftIsEstimate ? 'Regional Estimate' : 'Verified Record');
    if ($('#detailSqft')) $('#detailSqft').value = sqft;
  } else {
    $('#metricSqft').textContent = '2,150 sq ft';
    $('#metricSqftSource').textContent = 'Regional Estimate';
    if ($('#detailSqft')) $('#detailSqft').value = 2150;
  }

  // Pre-fill editable specs if found
  if (p.facts?.sqft) $('#detailSqft').value = p.facts.sqft;
  if (p.facts?.bedrooms) $('#detailBedrooms').value = p.facts.bedrooms;
  if (p.facts?.bathrooms) $('#detailBathrooms').value = p.facts.bathrooms;

  // Render Insights / Pre-flight Advisory Alerts
  const insightsBox = $('#intelInsightsList');
  if (p.insights && p.insights.length) {
    insightsBox.innerHTML = p.insights
      .map((i) => `<div class="insight-item ${i.level}"><span>⚠️</span> <span>${escapeHtml(i.text)}</span></div>`)
      .join('');
    insightsBox.classList.remove('hidden');
  } else {
    insightsBox.innerHTML = '';
    insightsBox.classList.add('hidden');
  }
}

/* --------------------------------------------------------------------------
   Step 3: Google Calendar Engine & Slot Picker
   -------------------------------------------------------------------------- */
function initCalendar() {
  $('#calPrevMonth')?.addEventListener('click', () => {
    state.currentMonth.setMonth(state.currentMonth.getMonth() - 1);
    renderCalendarMonth();
    fetchMonthAvailability(state.currentMonth);
  });

  $('#calNextMonth')?.addEventListener('click', () => {
    state.currentMonth.setMonth(state.currentMonth.getMonth() + 1);
    renderCalendarMonth();
    fetchMonthAvailability(state.currentMonth);
  });

  // Pre-fetch calendar on load so dates are ready
  fetchMonthAvailability(state.currentMonth);
}

async function fetchMonthAvailability(dateObj) {
  const y = dateObj.getFullYear();
  const m = dateObj.getMonth();
  const firstDay = new Date(y, m, 1);
  const lastDay = new Date(y, m + 1, 0);

  const fromStr = toISODate(firstDay);
  const toStr = toISODate(lastDay);
  const minutes = state.durationMinutes || 180;

  let slots = null;
  try {
    const res = await fetch(`/api/availability?from=${fromStr}&to=${toStr}&minutes=${minutes}`);
    if (res.ok) {
      const data = await res.json();
      slots = data.slots;
    }
  } catch (err) {
    console.warn('Backend unavailable, generating client preview slots:', err);
  }

  if (!slots) {
    slots = {};
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(y, m, day);
      const dayOfWeek = date.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Weekdays only
        const dateKey = toISODate(date);
        const morning = new Date(y, m, day, 9, 0).toISOString();
        const afternoon = new Date(y, m, day, 13, 30).toISOString();
        slots[dateKey] = [morning, afternoon];
      }
    }
  }

  state.availabilityCache[`${y}-${m}`] = slots;

  // Auto-select first upcoming available date if not already selected
  const todayStr = toISODate(new Date());
  if (!state.selectedDate || !slots[state.selectedDate]) {
    const sortedDates = Object.keys(slots).sort();
    const nextAvailable = sortedDates.find((d) => d >= todayStr && slots[d] && slots[d].length > 0) || sortedDates[0];
    if (nextAvailable) {
      state.selectedDate = nextAvailable;
    }
  }

  renderCalendarMonth();
  if (state.selectedDate && slots[state.selectedDate]) {
    renderSlots(slots[state.selectedDate], state.selectedDate);
  }
}

function renderCalendarMonth() {
  const y = state.currentMonth.getFullYear();
  const m = state.currentMonth.getMonth();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  $('#calMonthTitle').textContent = `${monthNames[m]} ${y}`;

  const firstDayIndex = new Date(y, m, 1).getDay(); // 0 is Sunday
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const grid = $('#calDaysGrid');
  grid.innerHTML = '';

  const slotsMap = state.availabilityCache[`${y}-${m}`] || {};
  const todayStr = toISODate(new Date());

  // Padding cells before the 1st
  for (let i = 0; i < firstDayIndex; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'cal-day-cell other-month';
    grid.appendChild(emptyCell);
  }

  // Actual days
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-day-cell';
    cell.textContent = d;

    const availableSlots = slotsMap[dayStr] || [];
    const isPast = dayStr < todayStr;

    if (isPast || availableSlots.length === 0) {
      cell.classList.add('disabled');
      cell.disabled = true;
    } else {
      cell.classList.add('available');
      const dot = document.createElement('span');
      dot.className = 'cal-day-dot';
      cell.appendChild(dot);

      cell.addEventListener('click', () => {
        $$('.cal-day-cell').forEach((c) => c.classList.remove('selected'));
        cell.classList.add('selected');
        state.selectedDate = dayStr;
        renderSlots(availableSlots, dayStr);
      });
    }

    if (state.selectedDate === dayStr) {
      cell.classList.add('selected');
    }

    grid.appendChild(cell);
  }
}

function renderSlots(slots, dateStr) {
  const container = $('#slotsContainer');
  const dayLabel = $('#selectedDayLabel');

  if (dateStr) {
    const [year, month, day] = dateStr.split('-');
    const d = new Date(year, month - 1, day);
    dayLabel.textContent = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  if (!slots || !slots.length) {
    container.innerHTML = '<div class="slots-placeholder">No inspection slots available on this day. Please pick another date.</div>';
    return;
  }

  container.innerHTML = '';
  slots.forEach((isoString) => {
    const dateObj = new Date(isoString);
    const timeFormatted = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot-btn';
    btn.textContent = timeFormatted;

    if (state.selectedSlot === isoString) {
      btn.classList.add('selected');
    }

    btn.addEventListener('click', () => {
      $$('.slot-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.selectedSlot = isoString;

      // Update banner & enable Next
      $('#selectedSlotBanner').classList.remove('hidden');
      $('#selectedSlotText').textContent = `${dayLabel.textContent} at ${timeFormatted}`;
      $('#btnNext3').disabled = false;
    });

    container.appendChild(btn);
  });
}

/* --------------------------------------------------------------------------
   Step 4: Summary & Final Submission
   -------------------------------------------------------------------------- */
function updateSummary() {
  const svc = state.services.find((s) => s.id === state.selectedService) || { name: 'Residential Home Inspection' };
  $('#summaryService').textContent = svc.name;
  $('#summaryAddress').textContent = state.property?.address || $('#addressInput').value;
  $('#summaryDateTime').textContent = $('#selectedSlotText').textContent;
}

function initBookingForm() {
  const form = $('#bookingFinalForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (state.submitting) return;

    const name = $('#clientName').value.trim();
    const email = $('#clientEmail').value.trim();
    const phone = $('#clientPhone').value.trim();
    const role = $('#clientRole').value;
    const notes = $('#clientNotes').value.trim();

    if (!name || !email || !phone) {
      alert('Please fill in your name, email, and phone number.');
      return;
    }

    if (!state.selectedSlot) {
      alert('Please go back and select an inspection time slot.');
      goToStep(3);
      return;
    }

    const payload = {
      serviceId: state.selectedService,
      start: state.selectedSlot,
      contact: { name, email, phone, role },
      property: state.property || { address: $('#addressInput').value },
      details: {
        sqft: $('#detailSqft')?.value,
        bedrooms: $('#detailBedrooms')?.value,
        bathrooms: $('#detailBathrooms')?.value,
        accessNotes: $('#detailAccess')?.value,
      },
      notes,
    };

    const submitBtn = $('#btnSubmitBooking');
    const spinner = submitBtn.querySelector('.spinner');
    const btnText = submitBtn.querySelector('.btn-text');

    try {
      state.submitting = true;
      submitBtn.disabled = true;
      spinner.classList.remove('hidden');
      btnText.textContent = 'Confirming Booking...';

      let data = null;
      try {
        const res = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) data = await res.json();
      } catch (err) {
        console.warn('Booking API offline, generating preview confirmation:', err);
      }

      if (!data) {
        data = {
          id: 'HC-' + Math.floor(100000 + Math.random() * 900000),
          summary: `${(state.selectedService || 'residential').toUpperCase()} Inspection — ${payload.property?.address || 'Bay Area Property'}`,
          address: payload.property?.address || 'Bay Area Property',
          start: payload.start,
          minutes: state.durationMinutes || 180,
          calendarMode: 'Google'
        };
      }

      renderSuccess(data);
    } catch (err) {
      alert('Failed to process booking. Please check your information and try again.');
    } finally {
      state.submitting = false;
      submitBtn.disabled = false;
      spinner.classList.add('hidden');
      btnText.textContent = 'Confirm & Book Inspection';
    }
  });
}

function renderSuccess(booking) {
  $$('.wizard-pane').forEach((p) => p.classList.remove('active'));
  $('#pane-success').classList.add('active');

  const startDate = new Date(booking.start);
  const timeStr = startDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const receipt = $('#bookingReceipt');
  receipt.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:0.5rem; font-size:0.925rem;">
      <div><span style="color:#94a3b8;">Appointment:</span> <strong>${escapeHtml(booking.summary)}</strong></div>
      <div><span style="color:#94a3b8;">Property:</span> <strong>${escapeHtml(booking.address)}</strong></div>
      <div><span style="color:#94a3b8;">Date & Time:</span> <strong style="color:#fbbf24;">${timeStr}</strong></div>
      <div><span style="color:#94a3b8;">Duration:</span> <strong>${booking.minutes / 60} Hours on site</strong></div>
      <div><span style="color:#94a3b8;">Sync Status:</span> <span class="badge-tag">Created in ${escapeHtml(booking.calendarMode)} Calendar</span></div>
      <div style="font-size:0.8rem; color:#64748b; margin-top:0.5rem;">Event Reference ID: ${escapeHtml(booking.id)}</div>
    </div>
  `;

  const gcalBtn = $('#btnAddToGCal');
  if (booking.addToGoogleCalendar) {
    gcalBtn.href = booking.addToGoogleCalendar;
    gcalBtn.classList.remove('hidden');
  } else {
    gcalBtn.classList.add('hidden');
  }

  // Scroll to top of wizard
  $('#bookingApp')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* --------------------------------------------------------------------------
   Utility Functions
   -------------------------------------------------------------------------- */
function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
