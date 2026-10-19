# Legal guide: licence, data protection and the shared setup

> **Not legal advice.** This is a working summary to help you prepare. Laws and commencement dates change. Before real patient data goes in, have an Indian lawyer who knows technology and health privacy review your setup, notices and contracts. If you serve patients in the EU or UK, a GDPR adviser too.

Contents
1. [The software licence (AGPL-3.0)](#1-the-software-licence-agpl-30)
2. [Who is responsible for the patient data](#2-who-is-responsible-for-the-patient-data)
3. [India: DPDP Act 2023 and DPDP Rules 2025](#3-india-dpdp-act-2023-and-dpdp-rules-2025)
4. [India: other laws that touch this setup](#4-india-other-laws-that-touch-this-setup)
5. [The data on one computer, the VPN, and remote access](#5-the-data-on-one-computer-the-vpn-and-remote-access)
6. [The team calendar: staff data](#6-the-team-calendar-staff-data)
7. [Students and universities](#7-students-and-universities)
8. [If you also serve the EU or UK (GDPR)](#8-if-you-also-serve-the-eu-or-uk-gdpr)
9. [Checklists](#9-checklists)

---

## 1. The software licence (AGPL-3.0)

TJS is licensed under the **GNU Affero General Public License, version 3 or (at your option) any later version** (`AGPL-3.0-or-later`). The full text is in [LICENSE](../LICENSE).

### Why this licence

You asked for a strong **copyleft** licence. Copyleft means anyone may use, study, change and share the software, but if they share it, or a changed version, they must pass on the same freedoms under the same licence. Nobody can take it, close it and sell it as their own proprietary product.

Among the common open-source licences, the AGPL is the strongest copyleft:

| Licence | Copyleft? | Closes the "SaaS loophole"? |
|---|---|---|
| MIT, BSD, Apache-2.0 | No (permissive: anyone may make closed versions) | – |
| MPL-2.0, LGPL | Weak (per file / per library) | No |
| GPL-3.0 | Strong | **No**: a company could change it and run it as a hosted service without ever sharing the code, because it never "distributes" it |
| **AGPL-3.0** | Strong | **Yes**: section 13 requires anyone who lets users interact with a modified version over a network to offer those users the source |

TJS is now network software (the clinic server), so the GPL would have left exactly that gap. The AGPL closes it.

### What it means in practice

| You want to… | Allowed? | Conditions |
|---|---|---|
| Use it in your clinic, unchanged | Yes | Keep the licence notices and the author credit |
| Change it for your own clinic | Yes | If staff or others use the changed version over a network, offer them the changed source (the **Licence & source code** card on the Privacy page links to it; point `--source` at your copy) |
| Give or sell copies to other clinics | Yes | Under AGPL-3.0, with source code, licence text and notices. You may charge for copies, setup, hosting and support |
| Run it as a paid hosted service for clinics | Yes | Offer every user the source of the version you run, including your changes |
| Make a closed, proprietary version | **No** | Unless you own all the copyright (see dual licensing below) |
| Remove or hide "Created by Meenakshi Ramesh" | **No** | Additional term 1 in [NOTICE](../NOTICE) (AGPL section 7(b)) |
| Use the name "TJS" or your logo for someone else's version | **No**, without written agreement | Additional terms 2–3 in NOTICE (section 7(c) and 7(e)). Also register a trademark if the name matters |

### Additional terms: the author's name stays on it

The AGPL lets the author add a few kinds of terms (section 7), and nobody who receives the software may remove them. TJS uses three, written out in [NOTICE](../NOTICE):

1. **Author credit (7(b)).** The copyright notices stay in the code, and "Created by Meenakshi Ramesh" stays visible on screen: in the footer of every screen, including sign-in, and in the *Licence & source code* card on the Privacy page.
2. **Changed versions say so (7(c)).** A modified version must say it is modified and by whom, and must not present itself as the original or as approved by her.
3. **The name (7(e)).** No right to use "TJS", its logo or her name to promote another product, beyond the required credit.

Breaking them ends the licence (section 8), as with any other breach.

**What these terms cannot do:** they do not make people ask permission before they use, copy or change TJS. The AGPL gives that permission to everyone, and under section 7 any stricter condition can be removed by the recipient. If you ever want "no use without my permission", that means leaving the AGPL for a proprietary licence. You can do that for future versions while you own all the copyright, but copies already given out under the AGPL keep their AGPL rights.

**Your clinic's records are not covered by the licence.** Patient data entered in the app stays the clinic's (and the patients'). The AGPL never requires anyone to publish data, only source code.

**No warranty** (sections 15–16). The software is provided "as is". That limits liability towards people who receive the software, but it does not reduce a clinic's own duties under data protection law, and it may not exclude every liability under Indian consumer law if you sell services. Put clear terms in any contract with paying clinics.

**Patents** (section 11). Each contributor grants users a licence to any of their patents the code uses.

### Copyright notice and contributors

- The copyright owner is **Meenakshi Ramesh**: `Copyright (C) 2026 Meenakshi Ramesh` is in the README, the server and every source file header. If you later form a company and assign the copyright to it, update these lines.
- **Accept outside contributions with a Developer Certificate of Origin (DCO):** contributors add `Signed-off-by:` to each commit, confirming they have the right to contribute it under the project's licence. They keep their copyright; the project gets clear permission.
- **Dual licensing.** Only someone who owns *all* the copyright can also sell the code under another licence. If you might want that later, ask contributors to sign a Contributor Licence Agreement (CLA) instead of a DCO. Most strong-copyleft projects don't, precisely so no one can close the code later.
- Put an SPDX line (`SPDX-License-Identifier: AGPL-3.0-or-later`) and the copyright line with the NOTICE reference in new files. `package.json` says `SEE LICENSE IN NOTICE`, because the licence is the AGPL plus the additional terms.

### AI-assisted code: a caution

Much of this code was written with an AI assistant. A licence can only be enforced by a copyright owner, so it matters who owns what:

- **United States:** the Copyright Office's position (its 2025 report on AI and copyrightability) is that material generated by AI without sufficient human authorship is not protected; human selection, arrangement and changes can be.
- **India:** section 2(d)(vi) of the Copyright Act 1957 says the author of a *computer-generated* work is the person who causes it to be created, which gives a better footing, but courts have not settled how it applies to AI tools.
- In practice: keep a record of your own design decisions, reviews and edits (the git history helps), and keep contributing your own work. The copyleft is strongest over the parts that are clearly human-authored.

---

## 2. Who is responsible for the patient data

| Role (DPDP Act / GDPR) | Who | Why |
|---|---|---|
| **Data Fiduciary / Controller** | The clinic, hospital department or university running the clinic | It decides why and how patient data is processed |
| **Data Principal / Data subject** | Each patient (for children, the parent or guardian acts) | Whose data it is |
| **Data Processor** | Anyone processing data *for* the clinic: a cloud host, a backup service, a messaging provider (SMS/WhatsApp), and **you**, if you run or support the server for clinics | Acts on the clinic's instructions |
| Not a processor | The authors of open-source software the clinic runs itself | They never see the data |

**"The data is on the boss's computer"** does not make the boss personally the fiduciary. The clinic is. If the boss is a sole proprietor, the clinic *is* the boss. Either way:
- The computer should belong to the clinic, and the records must stay with the clinic if the boss or anyone else leaves.
- Personal use of that computer, family members' accounts, and personal cloud sync (OneDrive/iCloud desktop sync of the app folder) must be kept away from the data folder.

---

## 3. India: DPDP Act 2023 and DPDP Rules 2025

The **Digital Personal Data Protection Act, 2023** applies to digital personal data processed in India. The **DPDP Rules, 2025** were notified on 13 November 2025 (G.S.R. 846(E)). The Data Protection Board provisions apply first, consent managers from about 13 November 2026, and most duties for fiduciaries after an **18-month phase-in** (about 13 May 2027). MeitY proposed shortening the window in January 2026; as of October 2026 no change had been notified. **Until then the IT Act s. 43A and SPDI Rules 2011 also apply** (section 4). Follow both now: the SPDI Rules are binding today, and the DPDP duties must be in place by May 2027 at the latest (sooner if the window is shortened). Where they differ, do what is stricter. TJS is built to the DPDP rules.

### What the law asks, and what the app and this setup do

| Duty | Where in the law | What TJS does | What the clinic must still do |
|---|---|---|---|
| **Lawful ground**: consent, or a "legitimate use" | ss. 4, 6, 7 | Records consent per patient (therapy, students, sharing reports, teaching) with date and who gave it | Decide the ground for each purpose. Treatment is often consent-based; medical emergencies and some employment uses are legitimate uses (s. 7) |
| **Notice** before or at consent, in clear language, in English or a scheduled language on request | s. 5, Rule 3 | – | Write a privacy notice: what is collected, why, who sees it (including students), how to withdraw consent and complain |
| **Children (under 18): verifiable parental consent**; no tracking or targeted advertising | s. 9, Rule 10 | Consent fields, parent/guardian recorded | Verify who the parent is. The Fourth Schedule exempts healthcare professionals and clinical establishments from parts of this *to the extent necessary to protect the child's health*; confirm the scope for your clinic with the lawyer |
| **Reasonable security safeguards** | s. 8(5), Rule 6 | Encryption at rest on the server (AES-256-GCM with the passphrase); encrypted transport via VPN/HTTPS; individual sign-in; role-based access **enforced on the server**; access log; per-patient keys; backups | Use the passphrase and full-disk encryption; keep devices updated; train staff; **keep logs for at least one year** (Rule 6 asks fiduciaries to retain logs and personal data needed to detect and investigate unauthorised access for a year); have processing contracts with providers |
| **Breach notification**: tell the Data Protection Board and each affected person without delay; detailed report to the Board within **72 hours** | s. 8(6), Rule 7 | `access.log` shows who opened and changed what, and from which address | Write a breach plan now: who decides, who calls whom, the template letters |
| **Accuracy and completeness** where data is used to make decisions | s. 8(3) | Records are edited in one shared copy, so no conflicting versions | Correct errors when patients point them out |
| **Erasure when no longer needed**, unless a law requires keeping it | s. 8(7), Rule 8 | Retention period setting, automatic erasure rule, crypto-shredding, deletion receipts | Set the retention period to what medical-record rules require for your setting |
| **Data Principal rights**: access, correction, erasure, grievance redress, nominee | ss. 11–14 | *Copy full record* (access), editing (correction), erasure with receipt | Publish how to make a request and respond within your stated time; name a contact person |
| **Contact person / Data Protection Officer** | s. 8(9), s. 10 | – | Publish the contact details of someone who answers privacy questions. A DPO is required only if the Government names you a Significant Data Fiduciary |
| **Processors under contract** | s. 8(2) | The app needs no third party in the recommended setup | Written contracts with any cloud host, SMS/WhatsApp provider, backup service, and with you if you support the server |
| **Cross-border transfer** | s. 16 | Data stays on the clinic computer | Transfers are allowed except to countries the Government restricts. Note that a VPN coordination service or cloud provider may be abroad (see section 5) |

**Penalties** (Schedule to the Act): up to ₹250 crore for failing to take reasonable security safeguards, up to ₹200 crore for failing to notify a breach or for breaching the children's provisions, and up to ₹50 crore for other breaches. The Board weighs the nature, gravity and steps taken to mitigate, so documented safeguards matter.

---

## 4. India: other laws that touch this setup

| Law | What it means here |
|---|---|
| **IT Act 2000, s. 43A and SPDI Rules 2011** | Until the DPDP Act's commencement repeals them, health information is "sensitive personal data". Bodies corporate must follow reasonable security practices (ISO 27001 is the named example) and get written consent. A company that negligently fails can be liable for compensation |
| **CERT-In Directions, 28 April 2022** (IT Act s. 70B) | Apply to service providers, intermediaries, data centres and **bodies corporate**. Report listed cyber incidents (e.g. ransomware, unauthorised access to systems or data) to CERT-In **within 6 hours** of noticing them; keep ICT system logs for **180 days** in India; synchronise system clocks with Indian NTP servers (NIC or NPL). VPN *service providers* must keep subscriber records for 5 years; CERT-In's FAQs indicate this does not cover an organisation's own internal VPN for its staff. Using a VPN is legal in India |
| **Rehabilitation Council of India Act 1992** | Speech-language pathologists and audiologists register with the RCI and follow its code of conduct, including confidentiality. Students practise under supervision |
| **Clinical establishments rules** (Clinical Establishments Act 2010 where a state has adopted it, or the state's own nursing-home/establishment law) | May set how long records are kept and require registration. The retention period in the app should follow them |
| **Medical device rules** (Medical Devices Rules 2017, CDSCO) | Software meant to diagnose or decide treatment can be a medical device. Keep TJS a planning and documentation tool: no automated diagnosis or treatment recommendations |
| **Consumer Protection Act 2019** | If you sell the software or hosting to clinics, your terms and the AGPL warranty disclaimer should be clear and fair |
| **Telecom / messaging (TRAI DLT)** | SMS reminders need DLT registration and approved templates (see SECURITY-PLAN.md §5) |

---

## 5. The data on one computer, the VPN, and remote access

| Topic | What to know |
|---|---|
| **Is a VPN legal?** | Yes, for an organisation connecting its own devices. The CERT-In record-keeping duties for VPN service providers are aimed at companies selling VPN services to the public |
| **Tailscale (or ZeroTier) as a service provider** | Its coordination service sees device names, IP addresses, operating systems and the accounts' email addresses, **not** the traffic, which is end-to-end encrypted with WireGuard. That is still personal data of your staff, handled by a company outside India (Tailscale Inc. is in Canada/USA). Read its privacy policy and data processing addendum, use a clinic account, and mention it in your staff privacy notice. To avoid it entirely, self-host **Headscale** or **NetBird**, or use plain WireGuard |
| **Tunnels and reverse proxies** (Cloudflare Tunnel, ngrok) | The provider decrypts the traffic, so it processes patient data. You would need a processing contract and a transfer assessment. Avoid for health records |
| **Cloud hosting** | The host is your processor. Choose an Indian region, sign its data processing terms, and make sure deleted data and backups are purged on a stated schedule |
| **Staff and students on their own laptops (BYOD)** | Records are held in browser memory only while signed in and cleared on sign-out. Still require: a screen lock and password, current updates, no shared accounts, no screenshots or downloads of patient records, and signing out on shared computers. Put this in a short device policy that everyone signs |
| **The server computer** | Clinic-owned, full-disk encryption, data passphrase set, automatic updates, nobody else's accounts, physically secure. It is the single place every record lives, so treat it like the clinic's filing cabinet with the only key |
| **Leavers** | Remove their VPN device and disable their app account on their last day. The access log shows what they opened |

---

## 6. The team calendar: staff data

The team calendar shows colleagues' working schedules. Staff and students are Data Principals too.

- **Lawful ground:** a legitimate use for employment purposes (DPDP s. 7(i)) for staff. For students, the placement agreement and the university's notice.
- **Minimum necessary, built in:** other people's sessions appear only as *Session* with the time and room. **Leave shows only as *Away*.** The reason (sick leave is health data) is visible only to the person and to supervisors. Meetings show their title only to the people invited.
- **Don't** put patient names or diagnoses in meeting titles or notes; use the case code. The form says so.
- Tell staff in their privacy notice that colleagues can see when they are busy or away.

---

## 7. Students and universities

- Patients must agree to student involvement. The app checks the *students* consent before a case can be allotted to a student.
- If the clinic belongs to a university, the university is usually the fiduciary. If students come from a university to a separate clinic, sign a **placement agreement** covering confidentiality, supervision, device rules and who is responsible for what.
- Coursework uses case codes and initials (pseudonymised). It is still personal data: keep it in the app, not in personal email or chat.
- Students' own data (grades, feedback, schedules) is personal data of the student.

---

## 8. If you also serve the EU or UK (GDPR)

| GDPR | Point |
|---|---|
| Art. 6 + Art. 9 | A lawful basis plus a condition for health data, usually Art. 9(2)(h) (health care by professionals under confidentiality) |
| Art. 13–14 | Privacy notice |
| Art. 25, 32 | Data protection by design; security appropriate to the risk |
| Art. 28 | Processing contract with every processor (host, Tailscale, messaging) |
| Art. 30 | Record of processing activities |
| Art. 33–34 | Report breaches to the supervisory authority within 72 hours; tell patients if the risk is high |
| Art. 35 | DPIA: required for large-scale health data, recommended for any clinic |
| Chapter V | Transfers outside the EU/UK (e.g. to a US VPN provider) need an adequacy decision (such as the EU–US Data Privacy Framework, if the provider is certified) or standard contractual clauses |

---

## 9. Checklists

**Before real patient data goes in**
- [x] Copyright line in README and headers names the legal owner (Meenakshi Ramesh)
- [ ] Independent security review of the code (AI-assisted, so essential)
- [ ] Server on a clinic-owned, always-on computer with full-disk encryption and `THERAPY_DATA_PASSPHRASE`
- [ ] Access through a VPN with HTTPS; no ports opened on the router
- [ ] Privacy notice for patients (and parents), and for staff and students
- [ ] Consent wording reviewed by an Indian lawyer, including children's consent and the healthcare exemption
- [ ] Retention period set to what your state's record-keeping rules require
- [ ] Processing contracts: VPN provider (or self-host), cloud host if any, SMS/WhatsApp provider, and you if you support the clinic
- [ ] Device policy signed by staff and students
- [ ] Placement agreement with the university, if students come from outside
- [ ] Named contact person for privacy requests and grievances

**Running**
- [ ] Weekly encrypted backup; key file kept separately and replaced after each erasure; quarterly restore test
- [ ] `access.log` reviewed monthly and kept at least one year
- [ ] Breach plan: CERT-In within 6 hours, Data Protection Board and patients without delay, Board report within 72 hours
- [ ] Leavers removed from the VPN and the app on their last day
- [ ] Software and operating system updates applied

**If you share or sell the software**
- [ ] Ship the LICENSE file and the source code (or a written offer) with every copy
- [ ] Hosted versions link to the exact source they run (`--source`)
- [ ] Contributions accepted with a DCO sign-off (or a CLA if you want to keep dual licensing open)
- [ ] Trademark for the name, if it matters to you
