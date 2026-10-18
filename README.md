# HISCORP — Premier Property & Home Inspections

Modern, responsive web application for HISCORP inspection services across the San Francisco Bay Area. Features an automated property intelligence lookup, interactive multi-step booking wizard, and direct Google Calendar synchronization.

---

## 🚀 Live Demos

- **Client Preview (GitHub Pages)**: [https://jjoves73.github.io/hiscorp-site/](https://jjoves73.github.io/hiscorp-site/)
- **Admin Calendar Dashboard**: [https://jjoves73.github.io/hiscorp-site/admin.html](https://jjoves73.github.io/hiscorp-site/admin.html)

---

## 🛠️ Key Features

- **Multi-Step Booking Wizard**:
  - Step 1: Inspection service selection (Residential, Title 25 Mobile Home, Multi-Unit Apartment, Commercial).
  - Step 2: Live property lookup with automatic square footage, bedrooms, bathrooms, year built, foundation type, and pre-inspection risk insights.
  - Step 3: Interactive Google Calendar slot picker with real-time availability and buffer calculation.
  - Step 4: Client contact confirmation and instant reference ID generation.
- **Inspector Calendar Portal (`/admin.html`)**:
  - Full Google Calendar-style day, week, month, and agenda views.
  - Live inspection scheduling, appointment cancellation, and real-time synchronization.
- **Responsive Mobile Experience**:
  - Clean 2x2 grid layout for booking steps on mobile screens.
  - Slide-out mobile navigation drawer.

---

## 💻 Local Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Add your optional RENTCAST_API_KEY and Google Calendar credentials in .env
   ```

3. **Start local development**:
   ```bash
   npm run dev
   ```
   - Frontend: `http://localhost:5173`
   - Express Backend API: `http://localhost:8787`

4. **Production Build**:
   ```bash
   npm run build
   npm start
   ```

---

## 📋 Feature Roadmap / Future Enhancements

The following features are scheduled for upcoming releases:

- [ ] **Go-live on the client's Google account (after client approval)**:
  - Create a Google Cloud service account on the client's account and enable the Google Calendar API.
  - Share the client's calendar with the service account (permission: *Make changes to events*).
  - In Render, set `CALENDAR_MODE=google`, `GOOGLE_CALENDAR_ID` and `GOOGLE_SERVICE_ACCOUNT_JSON` (never commit these).
  - Bookings then persist in the real calendar instead of the resettable mock calendar.
  - Move off the Render free tier (no sleep) and connect the client's custom domain.

- [ ] **Automated Email Confirmations & Notifications**:
  - **Client Confirmation Email**:
    - Triggered immediately upon completing Step 4 of the booking wizard.
    - Includes inspection date & time, property specs, inspector contact info, prep instructions, and a 1-click *.ics / Google Calendar invite button.
  - **Inspector Alert Email** (`hiscorp@gmail.com`):
    - Instant notification of new bookings with client name, phone, email, and property pre-inspection intelligence flags.
  - **Delivery Provider**: Integration via Resend, SendGrid, or Nodemailer (Google Workspace SMTP).
- [ ] **Automated SMS Reminders**:
  - 24-hour and 2-hour pre-inspection SMS alerts for clients and real estate agents.
- [ ] **Client Portal & PDF Inspection Report Download**:
  - Direct access link for homeowners and agents to view completed inspection summaries.
