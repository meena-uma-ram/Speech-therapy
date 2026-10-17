# Security, privacy and launch plan

Working plan for taking Therapy Planner from a single-device prototype to a hosted service for clinics in India. This is not legal advice: confirm retention periods, consent wording and children's-data handling with an Indian privacy lawyer.

## 1. What the prototype already does (this repository)

| Area | Status |
|---|---|
| Encryption at rest on the device | AES-256-GCM, key derived from a passphrase (PBKDF2), auto-lock |
| Per-patient keys and crypto-shredding | Each patient has their own key. Backups store each patient encrypted with it, and keys are never put in a backup. Erasure destroys the key, so the patient cannot be restored from any earlier backup |
| Deletion receipts | Receipt number, case code, date, who erased it and why. No personal data is kept |
| Automatic retention rule | Discharged records erased N years after therapy ends (daily check), each with a receipt |
| Deletion test | One click: creates a fake patient, backs it up, erases it, then checks live data, stored data, the key and the old backup |
| Access control | Individual sign-in; need-to-know by role; access log |

On a server, the same design carries over, with three changes:

1. **Envelope encryption, not one cloud key per patient.** Each patient gets a random *data key* (AES-256). One master key in a KMS (AWS KMS, Google Cloud KMS, Azure Key Vault) wraps all of them, and the wrapped data keys are stored in a small key table. Erasure deletes that patient's row. A KMS key per patient would cost money per key per month and run into quotas.
2. **The key table must not live in the same backups.** Give it its own short backup rotation (e.g. 7–30 days). Crypto-shredding is complete when the last key-table backup that held the key has aged out, so document that window.
3. **The server must be able to decrypt** to render reports and send reminders. Keys stay server-side, only the KMS can unwrap them, and every unwrap is logged.

**Claim you can make:**
> Patient data is erased from live systems on request or at the end of the retention period, and made permanently unreadable in backups through per-patient encryption keys.

## 2. Encryption checklist for the server version

| Layer | What to use |
|---|---|
| In transit | HTTPS only (TLS 1.2+), HSTS |
| At rest | Encrypted database and file storage (provider default) |
| Per-patient | Envelope encryption: data key per patient, wrapped by a KMS master key |
| Searchable fields | Keep only non-identifying fields unencrypted (case code, dates, status). Encrypt names, contact details, notes and reports |
| Key management | KMS only. No keys in code, environment files or the database in plain form. Rotate the master key yearly |
| Backups | Contain per-patient ciphertext only; key table backed up separately with short retention |
| Logs | Never log names, notes or report content. Logs are the classic leak, and they sit outside crypto-shredding |
| Staff sign-in | The four roles, plus MFA for staff and an idle timeout |
| Report links | Long random single-use token (stored hashed), OTP to the registered phone, short expiry, view-only, every view logged. No patient details in the URL |

## 3. Work plan

| Phase | Task |
|---|---|
| **Now** (no real patient data) | Show the prototype to 5–10 SLPs and 1–2 clinic heads; pick the first market (private paediatric clinics, hospital departments or solo practitioners) |
| | Write the data map: every place patient data lives (database, files, backups, logs, messages, email, exports) |
| | Decide retention: how long records are kept after therapy ends, per setting |
| **Before a pilot** | Developer or technical cofounder to build the server version |
| | Consent capture with timestamp (parent opt-in for reminders; student involvement; sharing) |
| | Secure report links (OTP, expiry, view-only, access log) |
| | Processing agreement template: the clinic is the Data Fiduciary, you are the Data Processor |
| | Indian privacy lawyer reviews the notice, consent and children's-data handling |
| | Independent security review of the code before any real data goes in. The code was AI-assisted, so this is essential |
| **Before scaling** | Breach response plan: who decides, who notifies the Data Protection Board and patients, and how fast |
| | Automated retention jobs, deletion receipts, quarterly deletion tests on every location in the data map |
| | Hosting agreement that states how fast the provider purges deleted data and backups |
| | ABDM/ABHA integration; other departments (OT, physiotherapy) |

## 4. Risks

| Risk | Type | Mitigation |
|---|---|---|
| Report link forwarded or screenshotted | Security | OTP, short expiry, access log. Screenshots cannot be prevented, so say so |
| Health details in a reminder message | Privacy | Neutral wording only: time + link |
| Children's data without proper consent | Legal | Parental consent up front, even where a healthcare exemption may apply |
| Data not truly deleted (backups, logs, exports) | Legal | Crypto-shredding, short backup rotation, no patient data in logs, deletion tests |
| Erasure clashes with record-keeping laws | Legal | Keep only what the law requires, for as long as it requires, with minimal access. Delete the rest on schedule |
| Hidden security flaws in AI-assisted code | Security | Professional review and penetration test before real data |
| Diagnostic features drift into medical-device regulation | Regulatory | Stay a planning and documentation tool: no automated diagnosis or treatment recommendations |
| Founder as single point of failure | Business | Technical partner, documented setup, managed hosting with support |
| Clinics content with WhatsApp + Excel | Market | Lead with time saved and DPDPA readiness, not features |

## 5. Messaging: if not WhatsApp, what else

Whatever the channel, it carries only a **neutral nudge and a link**, e.g. "Your appointment with Bright Steps Clinic is on Tue 10:30. Details: <link>". Health details stay on your server behind OTP sign-in.

| Channel | Good for | Watch out for |
|---|---|---|
| **WhatsApp Business Platform** (via a provider such as Gupshup, Interakt or AiSensy) | Highest reach in India; templates; delivery receipts | Opt-in required; pre-approved templates; per-conversation charges; Meta processes metadata. Never the personal WhatsApp app |
| **SMS** | Every phone, no app needed | TRAI DLT registration (entity, sender ID, pre-approved templates); cost per message; no rich content |
| **RCS Business Messaging** | Branded, rich messages on Android; can fall back to SMS | Verified sender setup; reach is mainly Android |
| **Email** | Free; good for report links and longer notices | Many parents don't check it; send links only, never attachments |
| **In-app / web push** (installed app or PWA) | No per-message cost; you control the channel | Parents must install and allow notifications; on iPhone, web push works only after "Add to Home Screen" |
| **Automated voice call / IVR** | Elderly patients, low literacy, regional languages | Cost per call; keep the content neutral |
| **Patient portal with OTP** | Where every channel should point: reports, homework, schedule | Needs the server version |

Avoid for patient communication: personal WhatsApp or SMS from staff phones, Telegram (chats aren't end-to-end encrypted by default), Signal (no business API), and email attachments with reports.

**Recommended stack for a pilot:** WhatsApp Business (via a provider) as the main channel, with SMS (DLT-registered) as fallback. Both only send a time plus a link to the OTP-protected portal.

## 6. India: DPDPA points to confirm with the lawyer

- The clinic is the **Data Fiduciary**; you are its **Data Processor**, under a written contract.
- **Children (under 18):** verifiable parental consent. The DPDP Rules include an exemption for healthcare providers to the extent needed to provide health services; confirm its scope for your use.
- **Breach:** notify the Data Protection Board and affected people without delay, with a detailed report to the Board within 72 hours.
- **Retention:** erasure must give way where another law requires records to be kept. Confirm the period for your setting (it varies by state and type of establishment).
- **Timeline:** most obligations under the DPDP Rules 2025 apply after a phase-in period. Check the current commencement dates.
