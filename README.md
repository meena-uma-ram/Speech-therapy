# TJS

A workspace for a speech **diagnostics** department, a speech **therapy** department, and university clinics where supervisors allot cases to students. It also covers the daily work: a timetable, SMART goals, materials, session logging, progress and family reports.

## Demo and clinic: two separate workspaces

The first screen asks: **Try the demo** or **Set up my clinic**. Each device keeps the two completely apart.

| | Demo | Clinic |
|---|---|---|
| Data | A full fake clinic: five staff, patients at every stage, coursework, messages | Starts **empty** |
| Accounts | Demo accounts, password `demo1234` | You create the first supervisor with **your own password**; they add everyone else |
| Encryption | Not needed (fake data) | A passphrase is **required before any patient can be added** |
| Banner | "Demo – fake data only" on every screen | None |
| Tools | **+ Generate fake patients** (Indian names, child and adult cases, waiting list → allotment → therapy → discharge, spread across every role), **Reset demo**, simulated OTP ("Demo code: 123456") | **Clean start** deletes every patient *and every account*, then asks for a new first supervisor |

So you can always show TJS to people with a full, realistic demo, and your clinic's real records are never mixed with it. Switch from the sign-in screen (*Open the demo* / *Go to my clinic*). A clinic server started with `--demo` runs the demo for everyone.

## Consent

Consent has its own page (**Patient → Details & consent → Record consent**), and new patients go straight to it after registration.

1. **Language and format:** English, Tamil, Hindi, Malayalam or Kannada; **accessible mode** (pictures, simple sentences, larger text, read aloud, a witness) for aphasia, dementia, low literacy or low vision.
2. **Who consents:** the patient, a parent, a guardian, or a legal guardian / nominated representative of an adult, with the **legal basis** and a reference.
3. **Answers per purpose, nothing pre-ticked.** Consent to *assessment and therapy* (clinical) is separate from each use of data: keeping records, supervised students, reports to the family, reminders, pseudonymised teaching use.
4. **Confirmation:** signature on screen, one-time code to their phone (simulated in the demo; real SMS needs the online version and DLT approval), a photo of a signed paper form, or a thumbprint with a witness.
5. **Sealed** into an **append-only ledger**: each entry records purpose, decision, who, relationship, recorded by, notice version, language and method, and its hash includes the previous entry's, so any later change shows. A **receipt** can be printed or copied for the family.

**Withdrawal** is per purpose and takes effect at once: no students → the case comes off the student and goes back to *To allot*, students are removed as observers; no treatment → upcoming sessions are cancelled; no reminders → reminders stop; no teaching → coursework can't be copied out; no records → the supervisor is asked to review for erasure. **Ask again** is flagged when a child turns 18, the guardian changes, a new purpose is added, the notice changes, or consent predates the ledger (*Cases → Consent to ask again*).

The notice text is versioned. **English is a draft for clinical and legal review; the other four languages are draft translations** that must be checked by a qualified translator. The app says so, and asks the clinician to confirm the notice was explained.

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

Everyone signs in with their **email and own password** (stored only as a salted PBKDF2 hash). A supervisor creates accounts under **Privacy → People & sign-in**. The app shows a temporary password once, and the person must choose their own at first sign-in. Supervisors can reset forgotten passwords. People are signed out after the idle time set in Privacy. **Every account needs a password**: there is no first sign-in without one. Demo accounts (demo workspace only) use `demo1234`.

### Inbox

Review comments ("Lesson plan returned with comments"), approvals, new allotments, referrals, leave requests, cover assignments, reschedules, missed sessions and invitations arrive in the **Inbox**. Unread messages **pop up when you sign in**, and the menu shows the unread count. You can also write to a colleague. Messages refer to patients by case code and initials.

### Sessions, attendance and rescheduling

Each patient has **sessions allotted** (set when the case is allotted). The patient file, cases table and session page show *attended of allotted*, *did not attend*, *cancelled*, *rescheduled* and *booked*. Mark attendance on the session page. **Reschedule** asks for the new time, **who asked for it** (patient/family, clinician, supervisor, other) and the reason. The supervisor is told each time, and **Cases → Reschedules** lists them all with totals by who asked for the change.

### Appointment reminders: SMS or WhatsApp Business

Under **Privacy → Appointment reminders**, a supervisor chooses **SMS only**, **WhatsApp Business only**, or **both, with each patient choosing** (and a default). Each patient's details hold their mobile number, chosen channel and **opt-in with a timestamp**. **Reports → Appointment reminders** lists the day's sessions with the channel and message for each, plus who won't get one and why. Messages contain only the clinic name, date, time and portal link, and the app warns if a template includes health words. The app can't send messages until there's a server version; for now, *Copy SMS list* and *Copy WhatsApp list* produce a phone,message list to paste into your provider.

### Where the data is stored

Two ways to run it:

- **On one device** (the single file, or any website): only in **this browser on this device** (local storage). Nothing is sent anywhere. Each browser and device keeps its own separate copy.
- **For the whole clinic, from one computer** (the clinic server): the records live on that computer's disk, for example the boss's computer or a small clinic PC. Everyone signs in from their own computer, at the clinic or at home over a VPN, and sees the same records, live. See [One clinic, many computers](#one-clinic-many-computers-the-clinic-server).

**Privacy → Where your data is stored** shows which mode you are in, each item, its size and whether it is encrypted.

### Team calendar

**Team calendar** shows colleagues' schedules side by side. Pick the people (for example Priya, Sam and two students), or use *Everyone*, *Only me* or a role. **Day** view has a column per person with sessions, meetings, lunch and leave; **Week** view has a row per person. **Free for everyone shown** lists the times when all of them are free; tap one to book a meeting with them. Meetings appear in every attendee's column and inbox.

Privacy is built in: you see details only for your own patients. Other sessions show as *Session* with the time and room, leave as *Away* (the reason only to the person and supervisors), and meetings you're not invited to as *Busy*. On the clinic server this filtering is done **on the server**, so the details never reach other people's browsers.

### Invite to observe

From a session, **Invite to observe** (or co-treat or supervise) sends an invitation. When it is accepted, the session appears on that person's timetable and they can open the record for it.

### Leave & cover

A clinician enters their leave dates. The app lists the sessions that will need cover, highlights them on the timetable and sends them to the supervisor. On **Leave**, the supervisor picks cover for each session from the clinicians who are free (not on leave, no clash, students only with patient consent) or clicks **Auto-assign cover**. Supervisors can also switch on **automatic cover**, which assigns it as soon as leave is requested. Cover clinicians and the person on leave get a message.

The bar at the top shows your quick links with counts, e.g. *To allot · To review · Needs cover · Rescheduled* for a supervisor, *My cases · Covering · Invitations* for a therapist, or *Allotted cases · Changes requested* for a student.

Documents are **pre-filled** from what the app already knows. The pre-assessment uses the diagnostic assessment, the lesson plan uses the session's goals and materials, the session report uses the session log (SOAP), and the conclusion report uses baseline → final accuracy for each goal. They identify the patient only by case code and initials.

## GDPR safeguards

| Principle | What the app does |
|---|---|
| Security (Art. 32) | Passphrase encrypts all data at rest (AES-256-GCM, PBKDF2 key), required in the clinic workspace before patients; auto-lock after inactivity; lock button |
| Data minimisation | Need-to-know screens by role (on one device a screen filter, not a security barrier; on the clinic server, enforced by the server); case codes; coursework pseudonymised; "Hide names" for screens others can see |
| No third parties | No web fonts, CDNs, analytics or trackers: the page makes no network requests at all; `no-referrer` |
| Consent | Append-only, sealed consent ledger per purpose, with notice version and language; withdrawal with immediate effect; re-consent triggers. Allotment to students, family reports, reminders and coursework export check it |
| Accountability | Access log of opening, editing, sharing, allotting, reviewing, exporting and erasing records |
| Right of access & portability | "Copy full record" exports everything held about a person as JSON |
| Right to erasure | Erasing a patient removes all linked records on the device **and destroys the patient's key** (crypto-shredding), so earlier backups can no longer be read for that patient. Each erasure issues a **deletion receipt** |
| Backups | The whole file is encrypted with a backup password, and each patient again with their own key; keys are never in the backup. The key file is the recovery copy of the keys. Erased patients are never restored, and a key file older than the latest erasure is refused |
| Deletion test | One click creates a fake patient, backs it up, erases it, and checks every place data lives on the device |
| Storage limitation | Retention period after therapy ends; records past it are listed, or **erased automatically** by a daily rule |

**Limits, stated plainly:** on its own, this is a single-device app: sign-in protects records on a shared clinic computer, but everyone's data is on that one device. For staff and students on their own devices, run the **clinic server**: individual accounts checked by the server, role-based access enforced on the server, encryption at rest, and encrypted transport through a VPN or HTTPS. It is a single-clinic server, not yet independently security-reviewed. Your organisation, as data controller, still needs a DPIA, a privacy notice, a documented lawful basis (usually Art. 6(1)(e)/(b) with Art. 9(2)(h)), and processes for access requests and breaches. See [docs/SECURITY-PLAN.md](docs/SECURITY-PLAN.md) for the server design, risks and launch plan.

## One clinic, many computers: the clinic server

```
 Boss's / clinic computer                         Everyone else (clinic, home, university)
 ┌───────────────────────────────┐   VPN         ┌──────────────────────────┐
 │ node server/server.js         │ ◄──────────►  │ Browser → sign in        │
 │ clinic-data/  (encrypted)     │  (Tailscale / │ sees only their role's   │
 │  • records  • patient keys    │   WireGuard)  │ records, live updates    │
 │  • access.log                 │               │ keeps nothing on sign-out│
 └───────────────────────────────┘               └──────────────────────────┘
```

- **One copy** of the records, on one computer's disk. No copies on laptops.
- **Record-level sync:** each change (a goal, a session, a message) is sent on its own, so people working at the same time don't overwrite each other. Colleagues' changes appear **live**; the pill at the top shows *Live*, *Saving…* or *Offline*.
- **Checked by the server:** each person receives only what their role may see, and the server refuses changes they may not make. Passwords are hashed on the server and never sent to browsers.
- **Encrypted at rest** with `THERAPY_DATA_PASSPHRASE`; per-patient keys in a separate file; an access log of sign-ins, records opened and changes.
- **No dependencies**: Node.js 18+ only.

```
THERAPY_DATA_PASSPHRASE="a long passphrase" node server/server.js --init-admin "Dr. Priya Nair" priya@clinic.in
THERAPY_DATA_PASSPHRASE="a long passphrase" node server/server.js --host 127.0.0.1
tailscale serve --bg 8080        # gives everyone https://clinic-pc.<tailnet>.ts.net
```

Try it with demo data: `npm run server:demo`, then open http://localhost:8080.

**How others reach it:** your VPN idea is the right transport. We compared nine options (LAN only, port forwarding, classic WireGuard/OpenVPN, mesh VPNs, tunnels, cloud hosting, shared files, peer-to-peer, hosted databases) and recommend **a dedicated always-on clinic computer + a mesh VPN (Tailscale, or the fully open-source NetBird/Headscale)** now, moving the same server to an Indian cloud region later. Details and reasons: [docs/SYNC-OPTIONS.md](docs/SYNC-OPTIONS.md). Setup, start-on-boot, Tailscale and backups: [docs/SERVER-SETUP.md](docs/SERVER-SETUP.md).

## Licence

Copyright (C) 2026 Meenakshi Ramesh.

**GNU Affero General Public License v3.0 or later** ([LICENSE](LICENSE)), a strong copyleft licence. Anyone may use, study, change and share TJS, but changed versions must stay under the same licence with their source code, **including when they are only offered over a network** (section 13), so nobody can turn it into a closed product or a closed hosted service. The licence covers the software, not your clinic's records. What this means for clinics, contributors and anyone who hosts or sells it, plus the data protection law for this setup (DPDP Act 2023 and Rules 2025, IT Act, CERT-In, GDPR), is in [docs/LEGAL.md](docs/LEGAL.md).

## Daily work

| Area | What you get |
|---|---|
| **Schedule** | A **timetable** of the day with a lunch band splitting morning and afternoon. Each block shows the time, patient, **case type** (e.g. *Child · CLP*, *Adult · Stroke – aphasia*, colour-coded by area) and the clinician. Tap an empty slot to book. **List** view groups sessions by morning and afternoon, with materials. |
| **Session** | Goals & materials, plus the lesson plan and session report status for student cases → **Log session** (trials, correct, accuracy, cueing, progress, notes, home practice) → **Progress** → **Report** for the family (checks consent). |
| **Materials** | Common materials across sessions, the full pick list, per session, and the library. |
| **Goals / Patients / Reports** | SMART goals, patient files (goals, progress, session journal, details & consent), daily report status. |

## Running it

No install or build step. Either:

- open **`tjs.html`** (everything in one file; easy to email, put on a USB stick or desktop), or
- open `index.html` directly in a browser, or
- serve the folder: `npm start` opens http://localhost:8080 in your browser (needs only Node.js 18+, nothing is downloaded; if 8080 is busy it uses 8081, 8082…), or any static host (GitHub Pages works).

The old file name `therapy-planner.html` still works: it forwards to `tjs.html`.

The first screen offers the **demo** (five people, patients at each stage, coursework waiting for review; password `demo1234`) or **your clinic** (empty; you create the first supervisor and a passphrase). See [Demo and clinic](#demo-and-clinic-two-separate-workspaces).

## Published on Cloudflare

The repository is connected to the Cloudflare Worker **speech-therapy**. Every push to `main` publishes the app (Workers Builds runs `npx wrangler deploy`; settings in `wrangler.jsonc`, no build step).

- Only the app is published: `index.html`, `tjs.html`, `css/`, `js/`, `icons/`, the manifest, the offline worker and the licence. `.assetsignore` keeps the server code, database schema, tests and documents off the site.
- `_headers` adds the security headers (HTTPS only, content security policy, no framing, no referrer).
- Data still stays in each visitor's browser: the published site has no server behind it. It is the single-device version, so use the **demo** there, or a clinic workspace on your own device.

## Install it as an app

TJS is an installable web app (PWA). Once it is served from a website address (for example GitHub Pages, Netlify or the clinic's own server):

- **Android (Chrome):** open the address → menu ⋮ → **Install app** (or *Add to Home screen*).
- **iPhone / iPad (Safari):** Share → **Add to Home Screen**.
- **Windows / Mac (Chrome or Edge):** the **Install** icon in the address bar.

It then opens in its own window with its own icon, and **works offline**. The offline worker caches only the app's own files. Patient data stays in the device's local storage, exactly as before. The single `tjs.html` file still works by double-clicking, but it can't be installed (browsers only install apps served from a web address).

To try it locally: `npm start` (it opens the browser for you).

## Where the data lives

- **Single file / static website:** only in the browser on this device (`localStorage`, encrypted if you set a passphrase). It does not sync between devices, and clearing browser data deletes it. If the passphrase is lost, the data cannot be recovered.
- **Clinic server:** in the server's `clinic-data/` folder (encrypted with `THERAPY_DATA_PASSPHRASE`). Browsers hold records in memory only while signed in. Back up from **Privacy → Backups & keys**, not by copying the folder.

## Documents

| | |
|---|---|
| [docs/SERVER-SETUP.md](docs/SERVER-SETUP.md) | Running the clinic server on one computer, with Tailscale |
| [docs/SYNC-OPTIONS.md](docs/SYNC-OPTIONS.md) | Nine ways to connect the computers, and the choice |
| [docs/BACKEND-PLAN.md](docs/BACKEND-PLAN.md) | Hosted version: Supabase (Mumbai) + Cloudflare Pages, the conditions, and the status of each task |
| [docs/LEGAL.md](docs/LEGAL.md) | Licence and data protection law in detail |
| [docs/legal/](docs/legal/README.md) | Drafts: privacy notice, consent forms, terms, DPA, sub-processors, data map, risk assessment, retention, breach plan, GDPR position, questions for the lawyer, pentest scope |
| [docs/SECURITY-PLAN.md](docs/SECURITY-PLAN.md) | Security design and launch plan |

## Development

```
js/logic.js   pure helpers (accuracy, trends, materials-for-the-day, report text, free slots), unit tested
js/consent.js consent purposes, versioned notices (5 languages), sealed ledger, re-consent triggers, unit tested
js/sync.js    record-level changes, who sees what, who may change what (shared by browser and server), unit tested
js/store.js   localStorage persistence, clinic-server sync, demo data
server/       clinic server (Node.js, no dependencies), tested end to end
supabase/     hosted backend schema with row-level security  →  npm run test:db (needs PostgreSQL)
js/app.js     hash router, views, forms
css/styles.css
tests/        node --test unit and server tests  →  npm test
```

After changing any source file, rebuild the single-file version with `npm run build`.
