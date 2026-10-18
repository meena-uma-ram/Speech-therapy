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

## Points that differ in substance (confirm locally)

- **Lawful basis.** In India, consent is the main ground. In Sweden and the EU, care itself usually rests on law or public interest with Art. 9(2)(h), not consent: TJS still records the clinical consent to treatment, and the *data* consents are for the optional uses (students, teaching, reminders, reports). The notice wording may need to change so it doesn't suggest care depends on data consent.
- **Erasure vs. record-keeping.** Sweden's Patient Data Act requires keeping the health record (journal) for a set time, so erasure requests are often refused for the record itself. Set the retention period to match, and use legal hold.
- **Access logging.** Sweden requires that access to health records is logged and checked systematically. The clinic server's access log helps; check whether it meets the national requirement.
- **Children.** Ages differ: in the UK, 16–17-year-olds can usually consent to their own treatment; in Sweden, a child's maturity counts. The app asks again at the country's adult age (18 by default).
- **The USA (HIPAA) is not covered.** It needs business associate agreements and specific security rules. Don't market TJS there before US legal advice.

## Questions for each local lawyer

1. Is the notice wording right for our lawful basis, and in the local language?
2. Who may consent for a child, and for an adult who cannot decide? Are the guardianship options right?
3. Retention periods for speech therapy records (adults, children).
4. Breach deadlines and authorities.
5. Hosting: is the suggested region acceptable, and what do processor contracts need?
