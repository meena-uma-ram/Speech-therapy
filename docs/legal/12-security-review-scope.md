# Security review and penetration test: scope (5.13) 🏢

For an independent tester, before any real patient data goes in. The code was written with AI assistance, so a human expert review is essential.

## In scope

| Area | Look at |
|---|---|
| Browser app (`js/`, `index.html`) | XSS (all output goes through `esc()`), local storage encryption (AES-GCM/PBKDF2), passphrase lock, backup encryption (v3), key file handling, consent ledger sealing, clipboard exports |
| Clinic server (`server/`) | Authentication, sessions and cookies, rate limiting, CSRF (JSON-only + Origin), role filtering (`js/sync.js` `viewFor`), change authorisation (`checkWrite`, `applyFrom`), path traversal in static serving, data file encryption, access log |
| Hosted backend (`supabase/`) | RLS policies, security-definer functions (`erase_patient`, `team_busy`, `log_open`, `app.*`), MFA enforcement (`aal2`), Storage policies, Edge Functions (when built), KMS use |
| Front-end hosting | Cloudflare Pages headers (`_headers`), CSP, deploy pipeline |
| Process | Account lifecycle, leavers, backups and restore, retention job, deletion test |

## Test accounts and data

Use the demo (`npm run server:demo`, or the demo workspace): five roles, fake patients only. Never test with real patients.

## Deliverables

Report with findings rated by severity, reproduction steps and fixes; a retest after fixes; a short letter you can show clinics.

## Already tested automatically

`npm test` (logic, sync rules, consent ledger, store security fixes, server end to end) and `npm run test:db` (27 RLS checks). These do not replace the review.
