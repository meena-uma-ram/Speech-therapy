# Hosted backend plan (section 4)

Two ways to run TJS with real data, both from the same app:

| | **Clinic server** (built, in `server/`) | **Hosted TJS** (this plan) |
|---|---|---|
| Who runs it | The clinic, on one computer of its own | You, as a service for many clinics |
| Where the data is | The clinic's own disk | Supabase, Mumbai region (AWS ap-south-1) |
| Reach | Through a VPN (Tailscale/WireGuard) | The internet, over HTTPS |
| Who is the processor | No one (the clinic runs it) | You, plus your sub-processors |
| Best for | A single clinic or department that wants its data on its premises | Many clinics, family portal, SMS/WhatsApp, remote consent |

## One project per region

Patient data stays in the clinic's region: a Supabase project in **Mumbai** for Indian clinics and in the **EU (e.g. Stockholm or Frankfurt)** for Swedish and other EU clinics, each with its own keys, backups and processor contracts. The app picks the project from the clinic's country (`js/regions.js` → `hosting`). Never mix regions in one database.

## Stack decision

**I agree with Supabase in the Mumbai region plus Cloudflare Pages for the front end**, with five conditions:

1. **Pin everything that touches patient data to India.** The database, its backups and Storage are in the project's region. Edge Functions run worldwide by default, so invoke them in `ap-south-1` (regional invocation). Otherwise a function that decrypts a record could run in Frankfurt or Virginia. Turn off or limit log drains and analytics that ship request data abroad. Confirm all of this in Supabase's DPA and sub-processor list ⚖️.
2. **Keep the key table out of the database backups.** Supabase backs up the whole database. If wrapped patient keys sit in it, an old backup plus the KMS can still open an erased patient, which breaks the crypto-shredding claim. Store wrapped keys in a separate store with short retention (e.g. AWS DynamoDB or S3 in ap-south-1 with 7–30 days of versions), wrapped by AWS KMS in ap-south-1. The schema has `keys.patient_keys` for development. Move it before real data 🏢.
3. **Encrypt in the API layer, not the browser.** Names, contact details, notes and reports are stored as ciphertext (`*_enc` columns). An Edge Function (in Mumbai) unwraps the patient's key through KMS, encrypts or decrypts, and calls the database with the user's own token, so row-level security still applies. The browser never holds patient keys. The server can still render reports and send reminders.
4. **Paid plan.** The free tier pauses idle projects and has no point-in-time recovery or session timeouts. Use Pro (or Team, for SOC 2 reports and audit logs) for anything with patients.
5. **Protect the front-end supply chain.** Patient data never passes through Cloudflare: the browser talks to `*.supabase.co` directly. But Cloudflare serves the code, so whoever controls the Cloudflare account controls what runs. Use MFA on Cloudflare, GitHub and Supabase, deploy only from `main` through CI, and keep the strict `_headers` file.

⚖️ Confirm with the lawyer: Supabase Inc. (USA) as sub-processor with data stored in India; Cloudflare as sub-processor for the front end only; your own position as a processor based in Sweden (see [legal/10-gdpr-position.md](legal/10-gdpr-position.md)).

## Status of each task

| # | Task | Status | What's in the repo / what's next |
|---|---|---|---|
| 4.1 | Database schema | **Done, tested** | `supabase/migrations/0001_tjs_schema.sql`: clinics, staff, patients, appointments, observers, assessments, referrals, goals, session logs, documents, messages, notices, consent ledger, leave, events, report links, reminders, keys, audit log, deletion receipts |
| 4.2 | Staff sign-in, MFA, idle timeout | **Partly** | Every policy requires `aal2` (MFA passed). Next: enable TOTP MFA in Supabase Auth and enrol staff at first sign-in; set the inactivity timeout (Auth → Sessions) to the clinic's `idle_minutes` |
| 4.3 | Role-based access on the server (RLS) | **Done, tested** | Same need-to-know rule as the app. 27 checks in `supabase/tests/rls.test.sql` (therapist, student, other clinic, no-MFA, supervisor). Run: `npm run test:db` |
| 4.4 | Envelope encryption | **Designed** | `*_enc` columns and `keys.patient_keys`. Next: Edge Function `crypto` with AWS KMS (GenerateDataKey / Decrypt), regional |
| 4.5 | Key table backed up separately | **Decision needed** 🏢 | See condition 2: move wrapped keys out of the database; document the backup window in the deletion receipt |
| 4.6 | Append-only audit log, no patient content | **Done, tested** | Triggers log every change (table, record, case code); `log_open()` for views; updates and deletes refused |
| 4.7 | Real OTP by SMS | **Not started** 🏢 | Needs DLT registration (entity, sender ID, template). Then Supabase Auth's Send SMS hook to an Indian provider (e.g. MSG91, Gupshup) |
| 4.8 | Remote consent link to the parent | **Not started** | `report_links`-style single-use token + OTP; the consent page already supports language, accessible mode and signature; add method `remote-link` (allowed in the schema) |
| 4.9 | WhatsApp/SMS reminders | **Not started** 🏢 | Provider API from a scheduled Edge Function; neutral template only (the app already checks templates for health words) |
| 4.10 | Family portal | **Table ready** | `report_links`: token stored only as a hash, OTP hash, expiry, single use; every view goes in the audit log |
| 4.11 | Retention, receipts, deletion test | **Done, tested** | `erase_patient()` (crypto-shred + receipt), `run_retention()` for pg_cron. Next: a quarterly deletion test that also checks Storage and the key store |
| 4.12 | Rate limiting, HTTPS/HSTS, headers | **Partly** | `_headers` for Cloudflare Pages (HSTS, CSP, frame, referrer). Supabase Auth has built-in rate limits; tune them. The clinic server already rate-limits sign-in |
| 4.13 | Breach alerting | **Partly** | `access_alerts` view (many patients in an hour, exports). Next: a scheduled Edge Function that emails supervisors and you |
| 4.14 | Move the prototype onto the server; safe offline mode | **Not started** | Replace the sync layer (`js/sync.js`) with Supabase calls through the Edge Functions. Offline: cache only today's schedule, encrypted, cleared at sign-out |
| 4.16 | Files arriving by email | **Designed** | A clinic address (e.g. reports@clinic) on Cloudflare Email Routing → Email Worker → encrypted into Supabase Storage (Mumbai) as an unfiled file, with the sender's address; staff file it under the patient. Unknown senders are held, never auto-filed. ⚖️ Cloudflare processes the email in transit |
| 4.17 | Files arriving on WhatsApp Business | **Designed** 🏢 | Provider webhook (media messages) → Edge Function downloads the media → encrypted unfiled file, matched to a patient by phone number as a *suggestion* only. Needs the BSP and an opt-in; reply with a neutral acknowledgement only |
| 4.15 | Secrets out of the repo; private repo? | **Done / advice** | `.gitignore` covers data folders; no keys or passwords are in the code. See below on a private repo |

## A private repo for the server code? (4.15)

You own the copyright, so you *may* keep your own server code private: the AGPL binds people who receive the code, not its author. But:

- **The open-source promise weakens.** Clinics choose TJS partly because they can see and check the code that holds their patients' data. A closed server undercuts that.
- **Contributions:** if anyone else contributes server code under the AGPL, you can't then keep that part closed.
- **Secrets never belong in any repo,** public or private. Keep them in Supabase/Cloudflare secret settings and your CI's secret store.

Recommendation: keep the server code public under the AGPL, keep secrets out of it, and use a small private repo only for deployment settings (project refs, environment names). ⚖️ Confirm.

## Testing the schema locally

```
# any PostgreSQL 15+; the stubs stand in for Supabase's auth schema
PGHOST=localhost PGUSER=postgres npm run test:db
```
