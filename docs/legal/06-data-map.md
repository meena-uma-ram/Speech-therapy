# Data map: every place data lives (5.6)

Written from the code as it stands. Update it whenever a feature adds a new place. Each row: what, where, who can read it, encrypted, how long, how it is erased.

## Single-device version (the `tjs.html` file, or the app on a website without a server)

| What | Where | Who can read it | Encrypted | Kept | Erased by |
|---|---|---|---|---|---|
| All clinic records: patients, sessions, goals, logs, assessments, referrals, coursework, messages, leave, meetings, reminders log, consent ledger (incl. signature and scan images), access log, settings | Browser localStorage `speech-therapy-planner-v1` (clinic) or `…-v1-demo` (demo) | Anyone who can unlock this browser profile. Role screens are not a barrier | Yes, once the passphrase is set (AES-256-GCM); the clinic workspace requires it before patients | Until erased or the retention rule runs | Erase record / retention rule / clean start / clearing browser data |
| Per-patient keys | localStorage `…-patient-keys` | As above | With the passphrase | Until the patient is erased | Erasure deletes the key |
| Files (scans, letters, photos, recordings) | Browser IndexedDB `tjs-files-clinic` / `tjs-files-demo` | Anyone with the patient's key (this browser, or a key file) | Yes: each file with its patient's key (unfiled ones with a separate key) | Until deleted or the patient is erased | Delete, erasure (key destroyed + file removed), clean start |
| Files shared in from another app | Browser IndexedDB `tjs-incoming` | This browser | **No, for a moment**: until TJS opens and takes them in (if nobody signs in, they wait) | Seconds to until the next sign-in | Taken in and removed at sign-in |
| Emails sent from TJS | The sender's email program and provider, the recipient's mailbox | Email providers | Usually in transit only | Their policies | Outside TJS: keep the drafts minimal |
| Saved copies of files | Wherever the user saves them | Anyone with the device | No | User's choice | Delete after use |
| Who is signed in | sessionStorage | This tab | No (an id only) | Until the tab closes | Closing the tab, sign-out |
| Display preferences, team-calendar choices | localStorage `…-device-prefs`, `speech-therapy-planner-team-*`, `tjs-workspace` | This browser | No (no patient data) | Indefinitely | Clearing browser data |
| Backups | Wherever the user saves them | Anyone with the file **and** the backup password; patients also need their key | Whole file (backup password) + each patient (own key) | User's choice | Patients become unreadable once their key and every older key file are destroyed |
| Key file | Wherever the user saves it | Anyone with the file | No: keep it in a safe place | User's choice | Replace after every erasure; destroy old copies |
| Clipboard | The device's clipboard (may sync or keep history) | Anyone using the device | No | Until overwritten | Copy something else. Affects: SMS/WhatsApp lists (phone numbers), full record copies, reports, consent receipt text |
| Printed receipts and forms, paper consent forms | Paper | Whoever holds them | No | Paper records policy | Shredding |
| Offline copy of the app's code | Service worker cache | – | – | No patient data | – |

## Clinic server version (`server/server.js`)

| What | Where | Who can read it | Encrypted | Kept | Erased by |
|---|---|---|---|---|---|
| All records (as above) | `clinic-data/clinic-data.json` on the server's disk | Server administrator; staff only through the app, filtered by role on the server | AES-256-GCM with `THERAPY_DATA_PASSPHRASE` (required before patients) + full-disk encryption | Until erased | Erase record (supervisor); retention rule on a supervisor's browser |
| Per-patient keys | `clinic-data/patient-keys.json` | Server administrator; supervisors through the app | Same passphrase | Until erased | Erasure deletes the key |
| Files | `clinic-data/files/*.bin` | Server administrator; staff through the app, by need-to-know | AES-256-GCM with the passphrase (required before files) | Until deleted or erased | Deleting the record or erasing the patient removes the file at once; unreferenced uploads after 15 minutes |
| Access log | `clinic-data/access.log` | Server administrator | No (no names or notes: ids, roles, actions, IP addresses) | Keep at least 1 year (DPDP Rules), 180 days minimum (CERT-In) | Rotate by hand after the retention period |
| Records in browsers | Browser memory only | The signed-in person | In transit: VPN/HTTPS | While signed in | Sign-out, tab close |
| Old copies of the data file | Disk blocks after a rewrite; any copy of the folder | Whoever has the disk or the copy | Yes, if the passphrase was set when written | Until overwritten | Full-disk encryption; don't copy the folder (use in-app backups) |
| Network metadata | VPN coordination service (e.g. Tailscale) | The provider | n/a | Provider's policy | Provider's policy |

## Hosted version (planned: Supabase Mumbai + Cloudflare Pages)

| What | Where | Encrypted | Notes |
|---|---|---|---|
| Records | Supabase Postgres, ap-south-1 | Identifying and clinical fields as ciphertext with per-patient keys; disk encryption by the provider | Row-level security |
| Wrapped patient keys | Separate key store, ap-south-1 (planned) | Wrapped by KMS | Short backup retention: sets the crypto-shredding window |
| Signatures, scans | Supabase Storage, ap-south-1 | Encrypted before upload | Removed by `erase_patient()` (to add) |
| Database backups | Supabase, same region | Ciphertext fields stay ciphertext | Retention per plan |
| Audit log | Postgres `audit_log` | No content in it | Append-only |
| Auth data (staff emails, password hashes, MFA factors) | Supabase Auth | Provider | Staff personal data |
| SMS / WhatsApp | Provider (after DLT approval) | Provider | Phone number + neutral text only |
| Front-end code | Cloudflare Pages | – | No patient data |
| Logs | Supabase and Cloudflare logs | – | Must never contain names or notes; check log drains and regions |
