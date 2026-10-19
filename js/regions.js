// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Meenakshi Ramesh. Additional terms under AGPL section 7 (author credit): see NOTICE.
/*
 * Country settings: which privacy law applies, who patients complain to, who may decide for an adult who cannot,
 * which consent languages are offered, and where hosted data should live.
 * DRAFT: every entry must be confirmed by a lawyer in that country before a clinic there relies on it.
 * Pure data with no DOM or storage access, so it can be unit-tested in Node.
 */
(function (root) {
  'use strict';

  // The EU AI Act (Regulation (EU) 2024/1689, as amended by the AI Omnibus, Regulation (EU) 2026/1744). Same for every EU/EEA country.
  const EU_AI = [
    'TJS itself contains no AI system: its reports, suggestions and cover picks follow fixed rules. Any AI tool you add needs its own check.',
    'If staff use AI tools, such as AI notes, transcripts or summaries in Zoom, Google Meet or Teams, or speech-analysis apps, the clinic is a "deployer". Take steps to build staff AI literacy (Art. 4, since 2 February 2025).',
    'Never use AI emotion recognition on staff or students, for example in a university clinic. It has been banned since 2 February 2025, except for medical or safety reasons (Art. 5(1)(f)).',
    'Tell people when they are talking to an AI or seeing AI-generated content, where Art. 50 requires it (since 2 August 2026).',
    'AI that is a medical device is high-risk from 2 August 2028. AI used to decide who gets public health care is high-risk from 2 December 2027 (Annex III). Both dates come from the AI Omnibus.',
    'An AI note-taker in a therapy session also processes health data under GDPR: it needs a lawful basis, a DPIA and a processor agreement. Switch it off unless all three are in place.'
  ];
  const EU_UPCOMING = [
    'European Health Data Space (Regulation (EU) 2025/327): general rules apply from 26 March 2027. Patients\u2019 rights to access and share patient summaries and e-prescriptions apply from 26 March 2029, and images, lab results and discharge reports from 26 March 2031. Requirements for electronic health record software follow the same dates.',
    'Digital Omnibus (a proposal, not yet law): would give 96 hours to report a breach, and only breaches likely to be high-risk. Until it is adopted, 72 hours and the current test apply.'
  ];

  const REGIONS = {
    IN: {
      name: 'India',
      law: 'the Digital Personal Data Protection Act 2023 and DPDP Rules 2025, together with the IT Act 2000 and SPDI Rules 2011 until the DPDP duties replace them',
      authority: 'the Data Protection Board of India',
      adultAge: 18,
      languages: ['en', 'ta', 'hi', 'ml', 'kn'],
      guardianBasis: [
        'Court order appointing a guardian',
        'Limited guardianship under the Rights of Persons with Disabilities Act 2016',
        'Legal guardian under the National Trust Act 1999',
        'Nominated representative under the Mental Healthcare Act 2017',
        'Other (describe in the reference)'
      ],
      guardianNote: '',
      hosting: 'India (e.g. Mumbai region)',
      sms: 'SMS needs TRAI DLT registration: entity, 6-character sender ID and approved templates.',
      breach: 'Tell the Data Protection Board and each affected person without delay; detailed report to the Board within 72 hours. Listed cyber incidents to CERT-In within 6 hours.',
      duties: [
        'Follow both laws now. The DPDP Act is in force, and its duties for clinics apply from about 13 May 2027, or earlier if the government shortens the phase-in; TJS already works to them. Until then the SPDI Rules 2011 are binding too: health information is sensitive personal data, so get consent in writing (a signed form or its electronic equivalent), publish a privacy policy, and follow a documented security standard such as ISO 27001. Where the two differ, do what is stricter.',
        'Give a notice and ask for consent per purpose, in English or a language of the Eighth Schedule on request.',
        'For anyone under 18, get verifiable consent from a parent or lawful guardian. The DPDP Rules (Fourth Schedule) exempt clinical establishments and healthcare professionals, including allied healthcare professionals such as speech-language pathologists, only as far as needed to give the child health services. Teaching use and other uses beyond the child\u2019s care still need the parent\u2019s verifiable consent.',
        'Keep logs for at least one year, and name a contact for privacy questions and grievances.',
        'Sign a contract with every processor (hosting, SMS, WhatsApp, email).',
        'Erase data when it is no longer needed, unless another law requires keeping it.'
      ],
      ai: [
        'India has no AI law yet; the IndiaAI Governance Guidelines (November 2025) are voluntary. TJS itself contains no AI system.',
        'AI tools that process patient data, such as AI notes or transcripts in video calls, still fall under the IT Act today and the DPDP Act from 2027: they need consent or another ground, a processor contract and security safeguards.',
        'Software that diagnoses or recommends treatment can be a medical device under the Medical Devices Rules 2017.'
      ],
      upcoming: [
        'About 13 November 2026: consent managers can register with the Data Protection Board.',
        'About 13 May 2027: most DPDP duties apply (notice, consent, security, breach reporting, rights, erasure, one-year logs), and the IT Act s. 43A and SPDI Rules end. MeitY proposed a shorter window; no change had been notified as of October 2026.'
      ]
    },
    SE: {
      name: 'Sweden',
      law: 'GDPR, the Swedish Data Protection Act (2018:218), the Patient Data Act (2008:355), Socialstyrelsen\u2019s regulations HSLF-FS 2016:40 and the EU AI Act',
      authority: 'Integritetsskyddsmyndigheten (IMY)',
      adultAge: 18,
      languages: ['sv', 'en'],
      guardianBasis: [
        'Guardian (god man) appointed by the district court',
        'Administrator (förvaltare) appointed by the district court',
        'Future power of attorney (framtidsfullmakt)',
        'Other (describe in the reference)'
      ],
      guardianNote: 'In Sweden a god man, förvaltare or framtidsfullmakt does not usually give the right to consent to health care for someone. Care for a person who cannot decide is based on their presumed wishes, after talking with those close to them. Record who you talked with, and check with your lawyer.',
      hosting: 'EU (e.g. Stockholm or Frankfurt region)',
      sms: 'SMS reminders: no registration like India’s DLT, but use a provider with an EU data processing agreement.',
      breach: 'Report a personal data breach to IMY within 72 hours; tell the people affected without undue delay if the risk to them is high.',
      duties: [
        'Keep the patient record (journal) for at least 10 years after the last entry (patientdatalagen 3 kap. 17 §). The clinic cannot simply delete it on request: a patient who wants it destroyed applies to IVO, which decides (8 kap. 4 §).',
        'Have a lawful basis for each use: care itself is usually based on law (Art. 6(1)(c)/(e) with Art. 9(2)(h)), not consent. Use consent for the optional uses (students, teaching, reminders).',
        'Complete a DPIA (Art. 35) and keep a record of processing (Art. 30).',
        'Sign a data processing agreement (Art. 28) with every processor, and check transfers outside the EU (Chapter V). Video and messaging services from the USA (Zoom, Google, Microsoft) need a business or healthcare plan with a processor agreement and a transfer basis (the EU–US Data Privacy Framework or standard contractual clauses).',
        'Access over open networks, such as the internet or home Wi-Fi, must start with strong authentication: two different ways of proving who you are (HSLF-FS 2016:40, 15 §). TJS signs in with a password only, so put the clinic server behind a VPN or gateway that requires two-factor sign-in (for example BankID or a security key).',
        'Limit each person\u2019s access to what their work needs (patientdatalagen 4 kap. 2 §), check the access logs regularly and systematically (4 kap. 3 §), and on request tell patients who has opened their record (8 kap. 1 §).',
        'Larger providers (at least 50 staff or €10 million turnover) fall under Cybersäkerhetslagen (2025:1506, NIS2) since 15 January 2026: register with the supervisory authority, manage cyber risks and report significant incidents.'
      ],
      minRetentionYears: 10,
      ai: EU_AI,
      upcoming: EU_UPCOMING
    },
    EU: {
      name: 'Another EU or EEA country',
      law: 'GDPR and the national data protection and patient records laws',
      authority: 'your national data protection authority',
      adultAge: 18,
      languages: ['en'],
      guardianBasis: ['Legal guardian appointed by a court', 'Power of attorney or advance directive recognised for health decisions', 'Other (describe in the reference)'],
      guardianNote: 'Who may consent to care for an adult who cannot decide differs between countries. Check with a local lawyer.',
      hosting: 'EU (e.g. Frankfurt or Stockholm region)',
      sms: 'Use an SMS provider with an EU data processing agreement.',
      breach: 'Report a personal data breach to your data protection authority within 72 hours; tell the people affected if the risk is high.',
      duties: [
        'Have a lawful basis for each use (Art. 6) and a condition for health data (Art. 9), usually 9(2)(h) for care.',
        'Give a privacy notice (Art. 13–14), complete a DPIA (Art. 35) and keep a record of processing (Art. 30).',
        'Sign a data processing agreement (Art. 28) with every processor, and check transfers outside the EU.',
        'Follow your country’s rules on health records, retention and children’s consent.',
        'Larger providers (at least 50 staff or €10 million turnover) fall under your country\u2019s NIS2 law: register, manage cyber risks and report significant incidents.'
      ],
      ai: EU_AI,
      upcoming: EU_UPCOMING
    },
    UK: {
      name: 'United Kingdom',
      law: 'UK GDPR, the Data Protection Act 2018 and the Data (Use and Access) Act 2025',
      authority: 'the Information Commissioner’s Office (ICO)',
      adultAge: 18,
      languages: ['en'],
      guardianBasis: ['Lasting power of attorney for health and welfare', 'Deputy appointed by the Court of Protection', 'Other (describe in the reference)'],
      guardianNote: 'Where an adult lacks capacity and no one holds authority, decisions are made in their best interests under the Mental Capacity Act 2005 (England and Wales). Scotland and Northern Ireland have their own laws. Young people of 16 and 17 can usually consent to their own treatment.',
      hosting: 'UK or EU',
      sms: 'Use an SMS provider with a UK data processing agreement.',
      breach: 'Report a personal data breach to the ICO within 72 hours; tell the people affected if the risk is high.',
      duties: [
        'Have a lawful basis and a condition for health data (UK GDPR Art. 6 and 9; DPA 2018 Schedule 1).',
        'Complete a DPIA and keep a record of processing.',
        'Have a data protection complaints procedure. Since 19 June 2026, people can complain to you first, for example through an electronic form. Acknowledge each complaint within 30 days and answer without undue delay (DPA 2018 s. 164A, added by the Data (Use and Access) Act 2025).',
        'Follow professional record-keeping guidance (e.g. the Health and Care Professions Council and the RCSLT). The NHS Records Management Code of Practice suggests 8 years after the last treatment for adults, and for children until their 25th birthday (26th if they were 17 when treatment ended).',
        'Sign a data processing agreement with every processor, and check international transfers.'
      ],
      ai: [
        'The UK has no AI Act; UK GDPR covers AI that uses personal data. TJS itself contains no AI system.',
        'An AI note-taker or transcript in a therapy session processes health data: it needs a lawful basis, a DPIA and a processor contract. Switch it off unless all three are in place.',
        'Software that diagnoses or recommends treatment can be a medical device regulated by the MHRA.'
      ],
      upcoming: []
    },
    OTHER: {
      name: 'Another country',
      law: 'your country’s privacy and health records laws',
      authority: 'your data protection authority',
      adultAge: 18,
      languages: ['en'],
      guardianBasis: ['Legal guardian', 'Power of attorney recognised for health decisions', 'Other (describe in the reference)'],
      guardianNote: 'Check with a local lawyer who may consent for an adult who cannot decide.',
      hosting: 'In or near your country',
      sms: 'Check your country’s rules for SMS reminders.',
      breach: 'Check your country’s breach reporting rules and deadlines.',
      duties: ['Have a local lawyer confirm consent wording, retention periods, breach reporting and processor contracts before using TJS with real patients.'],
      ai: ['TJS itself contains no AI system. Check whether an AI law applies in your country before adding any AI tool, such as meeting transcripts. If you serve people in the EU, the EU AI Act may apply.'],
      upcoming: []
    }
  };

  function region(code) { return REGIONS[code] || REGIONS.IN; }

  // When these entries were last checked against the law. Laws change: check again at least once a year.
  const CHECKED = 'October 2026';

  const api = { REGIONS: REGIONS, region: region, CHECKED: CHECKED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Regions = api;
})(typeof window !== 'undefined' ? window : this);
