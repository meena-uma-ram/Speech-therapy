# Risk assessment, DPIA-style (5.7) – DRAFT 👩 ⚖️

**Processing:** speech-language assessment and therapy records for children and adults, including people with communication disabilities, in clinics and university teaching clinics in India. **Why a DPIA:** large amounts of health data, children, vulnerable adults, students involved, new technology. Under the DPDP Act a DPIA is mandatory only for Significant Data Fiduciaries, but doing one is good practice and GDPR Art. 35 expects it of the controller where GDPR applies.

Likelihood and severity: 1 (low) – 3 (high). Residual risk after the measures.

| # | Risk to people | L | S | Measures in TJS | Still to do | Residual |
|---|---|---|---|---|---|---|
| 1 | Records seen by staff who don't need them | 2 | 3 | Role-based access enforced by the clinic server / RLS; need-to-know; access log; alerts on many records opened | Review the log monthly; train staff | Low |
| 2 | On a shared single device, anyone with the browser can read all records | 3 | 3 | Passphrase encryption, auto-lock, honest warnings; clinic server recommended | Use the server for multi-user clinics | Medium |
| 3 | Lost or stolen laptop | 2 | 3 | Server mode keeps nothing on laptops; single-device mode encrypted | Full-disk encryption policy | Low |
| 4 | Consent not valid (wrong person, not informed, pre-ticked, language not understood) | 2 | 3 | Ledger with who, relationship, legal basis, language, notice version, method, witness; nothing pre-ticked; accessible mode | Approve translations; train staff in supported decision-making | Low–medium |
| 5 | Children's data without verifiable parental consent | 2 | 3 | Parent/guardian recorded; turns-18 trigger | Lawyer confirms the healthcare exemption scope; identity check practice | Medium |
| 6 | Erased data still in backups or old key files | 2 | 2 | Crypto-shredding, key-file versioning, receipts that say when old key files still matter, encrypted backups | Key store outside DB backups (hosted); destroy old key files | Low |
| 7 | Health details leak through reminders or the clipboard | 2 | 2 | Neutral templates with checks; clipboard warning | Provider contracts | Low |
| 8 | Breach not detected or reported in time | 2 | 3 | Access log, alerts view | Breach plan, drills, CERT-In 6 h / Board 72 h | Medium |
| 9 | Student coursework identifies a patient | 2 | 2 | Pseudonymised, teaching consent gate on copying out | Supervisor check of coursework | Low |
| 10 | Bugs in AI-assisted code | 2 | 3 | Tests (app, server, RLS) | Independent security review and pentest before real data | Medium until reviewed |
| 11 | Provider abroad accesses data | 1 | 3 | India region, ciphertext fields, keys under your control | Sub-processor DPAs; region pinning checks | Low |
| 12 | Software treated as a medical device | 1 | 2 | No automated diagnosis or treatment recommendations | Lawyer confirms | Low |

**Consultation:** ask 2–3 clinicians, a parent, and (for accessibility) a person with aphasia or their carer to try the consent flow. **Sign-off:** [clinic], [date]. Review every year or when something major changes.
