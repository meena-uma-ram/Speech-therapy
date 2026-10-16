# Speech Therapy Planner

A day-to-day workspace for speech therapists. Open the schedule, tap a patient, see their SMART goals and the materials to bring, log the session, and send the family a summary.

## What it does

| Area | What you get |
|---|---|
| **Schedule** (home) | The day's sessions in time order. Each shows the goals being targeted, the materials needed, and whether it is scheduled, logged or reported. Move between days, add sessions (with weekly repeats). |
| **Session** (tap a patient) | Four tabs: **Goals & materials** (SMART breakdown, last accuracy vs target, materials checklist) → **Log session** (trials/times done, correct, auto-calculated accuracy, cueing level, progress rating, per-goal notes, session journal notes, home practice) → **Progress** (accuracy chart with target line, trend) → **Report** (auto-written family summary: edit, copy, email, mark as sent). |
| **Materials** | *For the day*: **common materials** used in 2+ sessions, the full pick list (who needs each item and where it's kept), and a per-session breakdown. Ticks stay in sync across all three lists. Printable. *Library*: every material and which goals use it. |
| **Goals** | All SMART goals across the caseload, filterable by patient, area and status. |
| **Patients** | Caseload list; each patient has SMART goals, progress charts for every goal, and a dated session journal. |
| **Reports** | Every session of the day with its report status, so nothing is left unsent. |
| **Settings** | Your name for signing reports, backup download/restore, demo data, delete all. |

## Running it

No install or build step. Either:

- open `index.html` directly in a browser, or
- serve the folder: `npm start` (then visit http://localhost:8080), or any static host (GitHub Pages works).

It loads demo patients the first time so you can try it out. **Settings → Delete all data** gives you a clean start.

## Your data and privacy

Everything is stored **only in the browser on this device** (`localStorage`). Nothing is sent to a server. That means:

- Data does not sync between devices. Use **Settings → Download backup** and **Restore from backup** to move it.
- Clearing browser data deletes it. Download backups regularly.
- Patient information is sensitive. Use a password-protected device and follow your local privacy rules (e.g. HIPAA/GDPR).

## Development

```
js/logic.js   pure helpers (accuracy, trends, materials-for-the-day, report text), unit tested
js/store.js   localStorage persistence + demo data
js/app.js     hash router, views, forms
css/styles.css
tests/        node --test unit tests  →  npm test
```
