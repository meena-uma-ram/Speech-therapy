# Data Processing Agreement (5.4) – OUTLINE for the lawyer ⚖️

Clinic = **Data Fiduciary** (DPDP Act) / controller. [Your legal entity] = **Data Processor**. Required by DPDP Act s. 8(2) (processing only under a valid contract). Because you are based in Sweden, GDPR Art. 28(3) also applies to you as a processor, so write it to meet both (see [10-gdpr-position.md](10-gdpr-position.md)).

| Clause | Content |
|---|---|
| Subject, duration, nature, purpose | Hosting and operating TJS for the clinic's speech-language services, for the term of the Service Agreement |
| Categories of data and people | Patients (including children and adults lacking capacity), parents/guardians, staff and students. Health data |
| Instructions | Process only on the clinic's documented instructions; tell the clinic if an instruction seems unlawful |
| Confidentiality | Everyone with access is bound by confidentiality; access only as needed |
| Security measures | Annex: encryption at rest and in transit, per-patient keys, MFA, row-level access, audit log, backups, retention jobs, logging without patient content, security reviews (from [../BACKEND-PLAN.md](../BACKEND-PLAN.md)) |
| Sub-processors | Listed in Annex ([05-subprocessors.md](05-subprocessors.md)); [30] days' notice of changes; clinic may object; same obligations flow down |
| Location and transfers | Data stored in India (Mumbai). Remote support access from [Sweden]: describe it, and the safeguards (MFA, logging, minimal access). No other transfers without the clinic's written agreement |
| Assistance | Help with patients' requests, security, breach notices, impact assessments, consultations |
| **Breach notice** | Tell the clinic **without undue delay and within [24] hours** of becoming aware, with what is known, so the clinic can meet the Board's 72-hour report and CERT-In's 6-hour report |
| Deletion and return | At the end, return (export) and delete all data within [30] days; backups purged by [date]; deletion receipt |
| Audits | Information needed to show compliance; audits with reasonable notice, or independent reports |
| Records | Record of processing (GDPR Art. 30(2)) |
| Liability | Cross-reference the Service Agreement |
| Governing law | [As in the Service Agreement] |
