// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Meenakshi Ramesh
/*
 * Country settings: which privacy law applies, who patients complain to, who may decide for an adult who cannot,
 * which consent languages are offered, and where hosted data should live.
 * DRAFT: every entry must be confirmed by a lawyer in that country before a clinic there relies on it.
 * Pure data with no DOM or storage access, so it can be unit-tested in Node.
 */
(function (root) {
  'use strict';

  const REGIONS = {
    IN: {
      name: 'India',
      law: 'Digital Personal Data Protection Act 2023 and DPDP Rules 2025',
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
        'Give a notice and ask for consent per purpose, in English or a language of the Eighth Schedule on request.',
        'Get verifiable consent from a parent or lawful guardian for anyone under 18 (check the healthcare exemption with your lawyer).',
        'Keep logs for at least one year, and name a contact for privacy questions and grievances.',
        'Sign a contract with every processor (hosting, SMS, WhatsApp, email).',
        'Erase data when it is no longer needed, unless another law requires keeping it.'
      ]
    },
    SE: {
      name: 'Sweden',
      law: 'GDPR, the Swedish Data Protection Act (2018:218) and the Patient Data Act (2008:355)',
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
        'Health care records are kept under the Patient Data Act (patientdatalagen); the journal duty means some records cannot be deleted on request. Check the retention period.',
        'Have a lawful basis for each use: care itself is usually based on law (Art. 6(1)(c)/(e) with Art. 9(2)(h)), not consent. Use consent for the optional uses (students, teaching, reminders).',
        'Complete a DPIA (Art. 35) and keep a record of processing (Art. 30).',
        'Sign a data processing agreement (Art. 28) with every processor, and check transfers outside the EU (Chapter V).',
        'Staff access must be limited to what their work needs, and logged (patientdatalagen, chapter 4).'
      ]
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
        'Follow your country’s rules on health records, retention and children’s consent.'
      ]
    },
    UK: {
      name: 'United Kingdom',
      law: 'UK GDPR and the Data Protection Act 2018',
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
        'Follow professional record-keeping guidance (e.g. the Health and Care Professions Council and the RCSLT).',
        'Sign a data processing agreement with every processor, and check international transfers.'
      ]
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
      duties: ['Have a local lawyer confirm consent wording, retention periods, breach reporting and processor contracts before using TJS with real patients.']
    }
  };

  function region(code) { return REGIONS[code] || REGIONS.IN; }

  const api = { REGIONS: REGIONS, region: region };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Regions = api;
})(typeof window !== 'undefined' ? window : this);
