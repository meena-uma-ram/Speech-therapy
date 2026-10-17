# Speech Therapy Planner

A workspace for a speech **diagnostics** department, a speech **therapy** department, and university clinics where supervisors allot cases to students. It also covers the daily work: a timetable, SMART goals, materials, session logging, progress and family reports.

## The workflow

```
Diagnostics                     Therapy department                       Student clinician
───────────                     ──────────────────                       ─────────────────
Register patient + consent  →   Referral arrives in "To allot"
Assessment (tests, findings,    Supervisor allots to a student           Pre-assessment
diagnosis, severity)            (needs consent for students) or          Lesson plan   (per session)
Complete & refer to therapy     a therapist takes it on                  Session report (per session)
                                Supervisor reviews submissions:          Conclusion report
                                approve or request changes  ←──────────  Submit for review
```

| Role | Sees |
|---|---|
| **Diagnostician** | Diagnostics (waiting list, assessments, referrals), and only those patients |
| **Speech therapist** | Referrals to take on, their own cases, schedule, goals, materials, reports |
| **Clinical supervisor** | Everything: allotment, review queue, all cases, people, retention and erasure |
| **Student clinician** | Only their allotted cases: My cases, schedule, coursework, goals |

A slim bar at the top shows the department, the quick links for your role with counts (e.g. *To allot 2 · To review 3 · Allotted 6*, or *Allotted cases 3 · Changes requested 1* for a student), a "Hide names" switch and the person switcher.

Documents are **pre-filled** from what the app already knows. The pre-assessment uses the diagnostic assessment, the lesson plan uses the session's goals and materials, the session report uses the session log (SOAP), and the conclusion report uses baseline → final accuracy for each goal. They identify the patient only by case code and initials.

## GDPR safeguards

| Principle | What the app does |
|---|---|
| Security (Art. 32) | Optional passphrase encrypts all data at rest (AES-256-GCM, PBKDF2 key); auto-lock after inactivity; lock button |
| Data minimisation | Need-to-know access by role; case codes; coursework pseudonymised; "Hide names" for screens others can see |
| No third parties | No web fonts, CDNs, analytics or trackers: the page makes no network requests at all; `no-referrer` |
| Consent / permissions | Recorded per patient (therapy, student involvement, family reports, teaching). Allotment to students and family reports check it |
| Accountability | Access log of opening, editing, sharing, allotting, reviewing, exporting and erasing records |
| Right of access & portability | "Copy full record" exports everything held about a person as JSON |
| Right to erasure | Erasing a patient removes all linked assessments, sessions, notes and coursework; the log keeps only the case code |
| Storage limitation | Retention period for discharged records; records past it are listed for erasure |

**Limits, stated plainly:** this is a single-device app. The person switcher suits a shared clinic computer, but it **is not a secure login**. For staff and students on their own devices, it needs a server with individual accounts, role-based access enforced on the server, and encrypted transport and backups. Your organisation, as data controller, still needs a DPIA, a privacy notice, a documented lawful basis (usually Art. 6(1)(e)/(b) with Art. 9(2)(h)), and processes for access requests and breaches. Backups are not encrypted.

## Daily work

| Area | What you get |
|---|---|
| **Schedule** | A **timetable** of the day with a lunch band splitting morning and afternoon. Each block shows the time, patient, **case type** (e.g. *Child · CLP*, *Adult · Stroke – aphasia*, colour-coded by area) and the clinician. Tap an empty slot to book. **List** view groups sessions by morning and afternoon, with materials. |
| **Session** | Goals & materials, plus the lesson plan and session report status for student cases → **Log session** (trials, correct, accuracy, cueing, progress, notes, home practice) → **Progress** → **Report** for the family (checks consent). |
| **Materials** | Common materials across sessions, the full pick list, per session, and the library. |
| **Goals / Patients / Reports** | SMART goals, patient files (goals, progress, session journal, details & consent), daily report status. |

## Running it

No install or build step. Either:

- open **`therapy-planner.html`** (everything in one file; easy to email, put on a USB stick or desktop), or
- open `index.html` directly in a browser, or
- serve the folder: `npm start` (then visit http://localhost:8080), or any static host (GitHub Pages works).

It loads demo data the first time: five people (supervisor, therapist, diagnostician, two students), patients at each stage, and coursework waiting for review. Use the person switcher at the top to see each role. **Privacy → Delete all patient data** gives you a clean start; set up your own people under **Privacy → People**.

## Where the data lives

Everything is stored **only in the browser on this device** (`localStorage`, encrypted if you set a passphrase). It does not sync between devices, and clearing browser data deletes it. If the passphrase is lost, the data cannot be recovered.

## Development

```
js/logic.js   pure helpers (accuracy, trends, materials-for-the-day, report text), unit tested
js/store.js   localStorage persistence + demo data
js/app.js     hash router, views, forms
css/styles.css
tests/        node --test unit tests  →  npm test
```

After changing any source file, rebuild the single-file version with `npm run build`.
