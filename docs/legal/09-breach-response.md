# Breach response plan (5.9) – DRAFT 👩 ⚖️

A personal data breach is any unauthorised access, disclosure, change, loss or destruction of personal data, including losing a laptop with unencrypted records, a misdirected report, or ransomware.

## Who

| Role | Clinic | You (processor) |
|---|---|---|
| Decides and notifies | [Clinic owner / medical director] | – |
| Investigates the system | [IT contact] | Meenakshi Ramesh [backup person] |
| Talks to families | [Supervisor] | – |
| Legal advice | [Lawyer] | [Lawyer] |

## Clock (from the moment someone notices)

| When | What |
|---|---|
| At once | Contain: disable the account, revoke sessions, take the device offline, change passphrases. Preserve logs (`access.log`, audit log). Write down times and actions |
| Within 6 hours | **CERT-In** report for listed cyber incidents (unauthorised access, ransomware, data breach…), if the clinic is a body corporate or service provider: incident@cert-in.org.in, CERT-In's format |
| Processor → clinic | You tell the clinic **within 24 hours** of becoming aware (DPA) |
| Without delay | **Data Protection Board of India**: initial intimation (DPDP Rules, Rule 7) |
| Without delay | **Each affected person**: what happened, likely consequences, what you are doing, what they can do, contact (Rule 7) |
| Within 72 hours | **Detailed report to the Board**: facts, cause, people affected, measures, findings |
| If GDPR applies | Supervisory authority within 72 hours (Art. 33); people if high risk (Art. 34). You, as an EU processor, notify the controller without undue delay (Art. 33(2)) |

## Evidence TJS gives you

- Clinic server: `clinic-data/access.log` (who signed in, opened records, changed what, from which IP).
- In the app: Privacy → Access log; deletion receipts.
- Hosted: `audit_log`, `access_alerts`.

## After

Root cause, fix, lessons learned, update the risk assessment, and run a drill once a year.

## Templates

**To families (short):** "On [date] we found that [what happened]. It involved [what information]. We have [actions]. You may want to [advice]. If you have questions, contact [name, phone]. You can also contact the Data Protection Board of India."
