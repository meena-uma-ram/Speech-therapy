# Countries (multi-market) – DRAFT for local lawyers ⚖️

TJS's privacy design (consent per purpose, minimum data, need-to-know access, per-patient encryption, provable erasure, access log) is the same everywhere. What changes per country is set under **Privacy → Settings → Country** (`js/regions.js`):

| | India | Sweden | Other EU/EEA | UK | Other |
|---|---|---|---|---|---|
| Law | DPDP Act 2023 + Rules 2025 | GDPR, Data Protection Act (2018:218), Patient Data Act (2008:355) | GDPR + national laws | UK GDPR + DPA 2018 | Local law |
| Patients complain to | Data Protection Board of India | IMY | National authority | ICO | Local authority |
| Consent languages in the app | English, Tamil, Hindi, Malayalam, Kannada | Swedish, English | English | English | English |
| Who may decide for an adult who cannot | Court guardian, RPwD Act limited guardian, National Trust Act guardian, MHCA nominated representative | God man / förvaltare / framtidsfullmakt, with a note that these usually do **not** give a right to consent to care | Varies | LPA (health and welfare), Court of Protection deputy; best interests under the MCA 2005 | Local |
| Breach | Board + people without delay, report within 72 h; CERT-In 6 h | IMY within 72 h | Authority within 72 h | ICO within 72 h | Local |
| Hosting (hosted version) | India (Mumbai) | EU (Stockholm/Frankfurt) | EU | UK or EU | Near the country |
| SMS | TRAI DLT registration | Provider with an EU DPA | Provider with an EU DPA | Provider with a UK DPA | Local rules |
| AI | No AI law; IndiaAI guidelines voluntary | EU AI Act | EU AI Act | No AI Act; UK GDPR, MHRA | Local |
| Retention minimum in the app | – | 10 years (journal) | National law | Guidance: adults 8 years, children to 25th birthday | Local |
| Also in force | SPDI Rules 2011 until the DPDP duties start | HSLF-FS 2016:40; Cybersäkerhetslagen (NIS2) for ≥50 staff | National NIS2 law for ≥50 staff | Complaints duty (DUAA, 19 June 2026) | Local |

Last checked against the law: **October 2026**. Check again at least once a year (the date is `CHECKED` in `js/regions.js` and shows in the app).

## Current and upcoming law, by date

| Date | Where | What | What it means for a TJS clinic |
|---|---|---|---|
| In force | India | IT Act s. 43A + SPDI Rules 2011 | Health data is sensitive personal data: written consent, a privacy policy, documented security practices (ISO 27001 or equivalent) |
| 13 Nov 2025 | India | DPDP Rules 2025 notified | Data Protection Board set up first |
| ~13 Nov 2026 | India | Consent managers can register | Optional for clinics |
| ~13 May 2027 | India | Most DPDP duties apply; s. 43A/SPDI end | Notice, consent, Rule 6 security and one-year logs, Rule 7 breach (72 h), rights, erasure. MeitY proposed a 12-month window; not notified as of Oct 2026 |
| 2 Feb 2025 | EU/Sweden | AI Act: prohibitions and AI literacy (Art. 4, 5) | Staff using AI tools; no emotion recognition of staff or students. The AI Omnibus (Regulation (EU) 2026/1744) softened Art. 4 to "take measures to support" AI literacy |
| 2 Aug 2026 | EU/Sweden | AI Act: transparency (Art. 50) | Tell people when they deal with an AI or AI-generated content |
| 2 Dec 2027 | EU/Sweden | AI Act: high-risk, Annex III (moved by the Omnibus) | E.g. AI deciding access to public health care |
| 2 Aug 2028 | EU/Sweden | AI Act: high-risk, Annex I (moved by the Omnibus) | AI that is a medical device (MDR) |
| 15 Jan 2026 | Sweden | Cybersäkerhetslagen (2025:1506), NIS2 | Health providers with ≥50 staff or ≥€10 m turnover: register, risk management, incident reporting |
| 26 Mar 2027 / 2029 / 2031 | EU/Sweden | European Health Data Space (Regulation (EU) 2025/327) | General rules 2027; patient summaries and e-prescriptions 2029; images, lab results, discharge reports 2031. Requirements for EHR software follow these dates |
| Proposal | EU | Digital Omnibus (GDPR changes) | Would move breach reports to 96 h and high-risk breaches only. **Not law**: 72 h applies |
| 5 Feb 2026 | UK | Data (Use and Access) Act 2025, most of Part 5 | Recognised legitimate interests, "reasonable and proportionate" searches for access requests |
| 19 Jun 2026 | UK | DUAA complaints duty (DPA 2018 s. 164A) | A complaints procedure; acknowledge within 30 days |

## AI: where TJS stands

- **TJS contains no AI system.** Reports, suggested goals, cover picks and reminders follow fixed rules written in the code. Under the Commission's guidelines on the AI system definition, rule-based software like this is not an AI system. **Keep it that way, or classify any AI feature before adding it** (could it be a medical device, or high-risk under Annex III?).
- **The risk is the tools around it.** Zoom AI Companion, Google Meet "take notes for me" (Gemini) and Teams Copilot / Facilitator transcribe and summarise a therapy session: that is health data going to an AI service. In the EU it makes the clinic an AI Act *deployer*, and under GDPR/DPDP it needs a lawful basis, a DPIA and a processor contract. The app's country card tells clinics to switch these off unless all three are in place.
- **University clinics (EU):** AI emotion recognition of students or staff is prohibited (Art. 5(1)(f)), outside medical or safety reasons.

## Gaps in TJS against these rules (to fix in the software)

| Gap | Rule | Status |
|---|---|---|
| Sign-in is a password only; no second factor | Sweden: HSLF-FS 2016:40 15 § (strong authentication over open networks). Also good practice under GDPR Art. 32, DPDP Rule 6 | **Open.** Until built: clinic server only inside the clinic network or behind a VPN/gateway with two-factor sign-in |
| "Erase record" deletes on request | Sweden: the journal can only be destroyed after an IVO decision (patientdatalagen 8 kap. 4 §) | **Open.** Sweden needs a "legal hold, refer to IVO" flow instead of erasure on request |
| No patient-facing "who opened my record" extract | Sweden: patientdatalagen 8 kap. 1 § | **Open.** The access log has the data; an extract per patient is needed |
| No complaints log | UK: DPA 2018 s. 164A (acknowledge within 30 days) | **Open.** Clinics can use their own process meanwhile |
| Retention default 8 years | Sweden: at least 10; UK children: to the 25th birthday | **Partly fixed:** the country card warns when the period is shorter than Sweden's minimum. Age-based retention (UK children) not yet supported |
| Access log only for supervisors | All | **Done** (October 2026) |

## Points that differ in substance (confirm locally)

- **Lawful basis.** In India, consent is the main ground. In Sweden and the EU, care itself usually rests on law or public interest with Art. 9(2)(h), not consent: TJS still records the clinical consent to treatment, and the *data* consents are for the optional uses (students, teaching, reminders, reports). The notice wording may need to change so it doesn't suggest care depends on data consent.
- **Erasure vs. record-keeping.** Sweden's Patient Data Act requires keeping the journal for at least 10 years after the last entry (3 kap. 17 §); only IVO can decide to destroy it at the patient's request (8 kap. 4 §). Set the retention period to match, and use legal hold.
- **Access logging.** Sweden requires that access to health records is logged and checked systematically. The clinic server's access log helps; check whether it meets the national requirement.
- **Children.** Ages differ: in the UK, 16–17-year-olds can usually consent to their own treatment; in Sweden, a child's maturity counts. The app asks again at the country's adult age (18 by default).
- **The USA (HIPAA) is not covered.** It needs business associate agreements and specific security rules. Don't market TJS there before US legal advice.

## Questions for each local lawyer

1. Is the notice wording right for our lawful basis, and in the local language?
2. Who may consent for a child, and for an adult who cannot decide? Are the guardianship options right?
3. Retention periods for speech therapy records (adults, children).
4. Breach deadlines and authorities.
5. Hosting: is the suggested region acceptable, and what do processor contracts need?
6. AI: do any AI features in the clinic's video, email or note tools need switching off, a DPIA or a contract? (EU: AI Act deployer duties.)
7. Sweden: does a VPN with two-factor sign-in in front of TJS meet HSLF-FS 2016:40 15 § strong authentication?
8. India: until May 2027, does the consent ledger meet the SPDI Rules' written consent? Does the Fourth Schedule exemption cover student clinicians under supervision?
