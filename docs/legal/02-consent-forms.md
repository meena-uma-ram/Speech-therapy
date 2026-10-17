# Consent form wording (5.2) – DRAFT

👩 clinical wording, ⚖️ legal review, translator for each language. The live wording is in `js/consent.js` (notice v1.0); change it there, give it a new version, and mark the language "approved" only after review.

## Rules the form follows (built into the app)

- **Two kinds of consent, kept apart.** Clinical consent to assessment and therapy; separate consents for each use of personal data. Saying no to a data use never changes care.
- **Nothing pre-ticked.** Every item needs an explicit Yes or No. No date is filled in: the app stamps the moment of sealing.
- **One purpose per question,** in plain language, with a simple-language version for the accessible mode.
- **Who consents:** the patient, a parent, a guardian of a child, a legal guardian of an adult (with the legal basis and a reference), or a nominated representative.
- **How they confirm:** signature on screen; one-time code to their phone (online version); a photo of a signed paper form; a thumbprint on paper with a witness.
- **Witness** for thumbprints and for the accessible mode: someone independent of the treating clinician.
- **Receipt** for the person who consented, with what they agreed to, the notice version and language, and how to withdraw.

## Standard form (English, v1.0)

> **[Clinic name] – consent**
> Patient: [name] · Case code: [code]
>
> We ask what you agree to. You can say yes to some things and no to others. Saying no to the optional uses does not change your care.
>
> **Consent to assessment and therapy**
> A speech and language therapist assesses and treats the patient. They will explain each step, and you can ask questions or stop at any time. ☐ Yes ☐ No
>
> **How we use your information**
> 1. Keeping records to provide care: notes, goals, session records and reports, seen only by those caring for the patient, kept [N] years after therapy ends. ☐ Yes ☐ No
> 2. Student clinicians, supervised by a qualified therapist. ☐ Yes ☐ No
> 3. Progress reports sent to you through a secure link. ☐ Yes ☐ No
> 4. Appointment reminders by SMS or WhatsApp Business (clinic name, date, time and a link only). ☐ Yes ☐ No
> 5. Pseudonymised use in teaching and coursework (name replaced by a case code and initials). ☐ Yes ☐ No
>
> You can withdraw any of these at any time by telling us. Questions or complaints: [contact]. You can also complain to the Data Protection Board of India.
>
> I have read or been told this information, and my answers above are my choice.
> Name: ________ Relationship to the patient: ________ [If legal guardian: legal basis and reference ________]
> Signature or thumbprint: ________ Date and time: ________
> Witness (for thumbprint or assisted consent): name ________ role ________ signature ________
> Explained by (clinician): ________ Language: ________ Notice version: 1.0

## Accessible form (aphasia, dementia, low literacy, low vision)

👩 designs the pictures; the app has placeholders. Principles (based on aphasia-friendly communication practice):
- One idea per page or card, short sentences, large print (at least 16 pt; the app enlarges text), lots of white space.
- A picture for each purpose, the same picture every time. Key word in bold.
- Big Yes 👍 / No 👎 answers. Allow pointing, nodding, or a thumbprint.
- Read aloud in the person's language (the app's "Read aloud" uses the device's voice; check a voice exists).
- Check understanding: ask the person to show or tell back one point.
- A witness confirms the information was explained and the answers were the person's own.
- If the person cannot decide even with support: a legal guardian or nominated representative decides, and the basis is recorded. Note the person's own wishes anyway.

Simple wording (in the app, `simple` text):

| Purpose | Simple sentence |
|---|---|
| Treatment | We will check speech and language and help with therapy. You can stop any time. |
| Records | We write notes about therapy. Only your therapists see them. |
| Students | A student may help, with a teacher watching. |
| Reports | We may send you short reports. |
| Reminders | We may send a message to remind you of the time. |
| Teaching | Students may learn from this case. We hide the name. |
