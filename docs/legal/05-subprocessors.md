# Sub-processors (5.5) – DRAFT 👩 🏢 ⚖️

For the **hosted** version. (A clinic running its own clinic server has no sub-processors from TJS, except any VPN coordination service it chooses.) Before each one goes live: sign its data processing terms, record where it processes data, and list it here and in the clinic's privacy notice.

| Provider | What for | Data | Where | Agreement | Status |
|---|---|---|---|---|---|
| Supabase Inc. (USA) | Database, auth, storage, functions | All service data (identifying fields as ciphertext) | AWS ap-south-1, Mumbai; check support access, logs and function regions | Supabase DPA | To sign |
| Amazon Web Services (via Supabase; and directly for KMS / key store) | Infrastructure; key management | Wrapped keys, ciphertext | ap-south-1 | AWS DPA (GDPR addendum) | To decide (key store, see BACKEND-PLAN condition 2) |
| Cloudflare, Inc. | Hosting the app's code (Pages) | No patient data; visitors' IP addresses and request logs | Global edge network | Cloudflare DPA | To sign |
| [SMS provider, e.g. MSG91 / Gupshup] | OTP and reminders | Phone numbers, neutral text | India | Provider DPA + DLT registration | After DLT |
| [WhatsApp Business provider (BSP), e.g. Gupshup / Interakt / AiSensy] and Meta | Reminders | Phone numbers, template text; Meta processes metadata | India / Meta | BSP DPA; WhatsApp Business terms | To decide |
| The clinic's email provider (Google Workspace / Microsoft 365 / Zoho) | Sending reports, thank-you letters, reminders from the clinic's own account | Recipients' addresses, report text and attachments | Provider's regions (check data residency options) | The clinic's own agreement with the provider (the clinic's processor, not yours) | In use from the clinic server |
| [Email provider for the hosted version] | Sign-in emails, alerts | Staff emails | [ ] | [ ] | To decide |
| GitHub, Inc. | Source code | No patient data | USA | – | In use |
| Tailscale Inc. (only if you use it for support access) | VPN coordination | Device names, IPs, staff emails | Canada/USA | Tailscale DPA | Optional |
