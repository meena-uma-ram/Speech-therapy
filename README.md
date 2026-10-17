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
| **Clinical supervisor** | All diagnostics and all therapy patients: allotment, review queue, leave & cover, reschedules, people, retention and erasure |
| **Diagnostician** | The waiting list and the patients they assessed |
| **Speech therapist** | Only their own patients, plus sessions they cover or were invited to observe |
| **Student clinician** | Only their allotted cases and coursework, plus sessions they cover or observe |

### Signing in

Everyone signs in with their **email and own password** (stored only as a salted PBKDF2 hash). A supervisor creates accounts under **Privacy → People & sign-in**. The app shows a temporary password once, and the person must choose their own at first sign-in. Supervisors can reset forgotten passwords. People are signed out after the idle time set in Privacy. Demo accounts use the password `demo1234`.

### Inbox

Review comments ("Lesson plan returned with comments"), approvals, new allotments, referrals, leave requests, cover assignments, reschedules, missed sessions and invitations arrive in the **Inbox**. Unread messages **pop up when you sign in**, and the menu shows the unread count. You can also write to a colleague. Messages refer to patients by case code and initials.

### Sessions, attendance and rescheduling

Each patient has **sessions allotted** (set when the case is allotted). The patient file, cases table and session page show *attended of allotted*, *did not attend*, *cancelled*, *rescheduled* and *booked*. Mark attendance on the session page. **Reschedule** asks for the new time, **who asked for it** (patient/family, clinician, supervisor, other) and the reason. The supervisor is told each time, and **Cases → Reschedules** lists them all with totals by who asked for the change.

### Appointment reminders: SMS or WhatsApp Business

Under **Privacy → Appointment reminders**, a supervisor chooses **SMS only**, **WhatsApp Business only**, or **both, with each patient choosing** (and a default). Each patient's details hold their mobile number, chosen channel and **opt-in with a timestamp**. **Reports → Appointment reminders** lists the day's sessions with the channel and message for each, plus who won't get one and why. Messages contain only the clinic name, date, time and portal link, and the app warns if a template includes health words. The app can't send messages until there's a server version; for now, *Copy SMS list* and *Copy WhatsApp list* produce a phone,message list to paste into your provider.

### Where the data is stored

Only in **this browser on this device** (local storage). Nothing is sent anywhere. **Privacy → Where your data is stored** shows each item, its size and whether it is encrypted. Each browser and device keeps its own separate copy.

### Invite to observe

From a session, **Invite to observe** (or co-treat or supervise) sends an invitation. When it is accepted, the session appears on that person's timetable and they can open the record for it.

### Leave & cover

A clinician enters their leave dates. The app lists the sessions that will need cover, highlights them on the timetable and sends them to the supervisor. On **Leave**, the supervisor picks cover for each session from the clinicians who are free (not on leave, no clash, students only with patient consent) or clicks **Auto-assign cover**. Supervisors can also switch on **automatic cover**, which assigns it as soon as leave is requested. Cover clinicians and the person on leave get a message.

The bar at the top shows your quick links with counts, e.g. *To allot · To review · Needs cover · Rescheduled* for a supervisor, *My cases · Covering · Invitations* for a therapist, or *Allotted cases · Changes requested* for a student.

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
| Right to erasure | Erasing a patient removes all linked records on the device **and destroys the patient's key** (crypto-shredding), so earlier backups can no longer be read for that patient. Each erasure issues a **deletion receipt** |
| Backups | Each patient is encrypted with their own key; keys are never in the backup. A separate key file is the recovery copy of the keys |
| Deletion test | One click creates a fake patient, backs it up, erases it, and checks every place data lives on the device |
| Storage limitation | Retention period after therapy ends; records past it are listed, or **erased automatically** by a daily rule |

**Limits, stated plainly:** this is a single-device app. Sign-in protects records on a shared clinic computer, but everyone's data is on that one device. For staff and students on their own devices, it needs a server with individual accounts, role-based access enforced on the server, and encrypted transport and backups. Your organisation, as data controller, still needs a DPIA, a privacy notice, a documented lawful basis (usually Art. 6(1)(e)/(b) with Art. 9(2)(h)), and processes for access requests and breaches. See [docs/SECURITY-PLAN.md](docs/SECURITY-PLAN.md) for the server design, risks and launch plan.

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

It loads demo data the first time: five people (supervisor, therapist, diagnostician, two students), patients at each stage, and coursework waiting for review. Sign in with any demo account (password `demo1234`) to see each role. **Privacy → Delete all patient data** gives you a clean start; set up your own people under **Privacy → People**.

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
