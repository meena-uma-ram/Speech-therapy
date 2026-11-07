# TJS Pay

**Billing for independent speech and language therapists: log a session, and TJS Pay invoices it through PayPal, follows up, and records the payment however the family paid.**

Built for the PayPal AI Hackathon by Meenakshi Ramesh, a speech-language therapist. Part of [TJS](../README.md), an open-source workflow tool for speech therapy teams.

## The problem

Small practices lose hours a month to billing: invoices, checking who has paid, and awkward reminders. Real payments are messy too. Families pay monthly or in advance, councils and schools pay for some children, and plenty of money arrives by bank transfer or cash, which no payment platform can see.

## What it does

| | |
|---|---|
| **Overview** | One list of what needs the therapist: drafts to send, sessions to invoice, and payments families say they've made. Plus every unpaid invoice with its next reminder. |
| **Patients** | Filter by *to invoice, waiting, overdue, paid up*. Each patient has sessions, invoices and payments. Flexible names ("known as"), several caregivers, and who pays (family, school, local authority, charity). |
| **Billing types** | Per session, monthly statement, or prepaid blocks. When a block reaches the session the clinic chooses (e.g. 8 of 10), the next block's invoice goes out automatically. |
| **PayPal invoices** | Every invoice is created and sent with the PayPal Invoicing API, in GBP. Families and funders pay by PayPal or card. |
| **Payments arrive by themselves** | A PayPal webhook, plus an hourly check, marks invoices paid as soon as PayPal has the money. |
| **Reminders** | Sent through PayPal on the days the clinic sets (3, 7 and 14 by default), one at a time and in order. The wording is editable for everyone in Settings, or for one invoice before it goes. |
| **Paid another way** | Every invoice and reminder links to a signed page where the family says they paid by bank transfer or cash. The therapist confirms it, and the payment is recorded on the PayPal invoice, so PayPal holds the complete record. |
| **Record a payment in plain words** | "Liam paid 135 cash" → the right invoice, split across invoices if needed, with any overpayment kept as credit. |
| **Finances** | Profit for the month (paid in, estimated PayPal fees, expenses), work done by service as a pie chart, who paid and how, plus a CSV for the accountant. |

## How AI is used (Anthropic Claude)

`src/ai.js` gives the AI three small jobs, each with a safe fallback:

1. **Writes the message on each invoice:** a short, friendly note for families, and businesslike wording for councils and schools.
2. **Reads payments typed in plain words.** It extracts who, how much, how and the reference. It may only choose a patient that exists.
3. **Rewrites a reminder** as warmer, shorter or firmer, while the therapist edits it.

**Design rules:**
- **The AI writes and reads words only.** Every amount, split, credit and date is plain, tested code (`src/practice.js`, `test/practice.test.js`).
- **The AI never sees clinical information:** billing facts only, never notes, goals or diagnoses.
- **Nothing is sent without a human.** Invoices are drafted for review. Reminders use the clinic's own wording.
- **If the AI is unavailable,** standard wording and rule-based reading take over, so billing never stops.

## How PayPal is used

All calls are made server-side in the Worker (`src/paypal.js`). Credentials never reach the browser.

| Purpose | Endpoint |
|---|---|
| Sign in | `POST /v1/oauth2/token` |
| Create invoice | `POST /v2/invoicing/invoices` |
| Send invoice | `POST /v2/invoicing/invoices/{id}/send` |
| Send reminder | `POST /v2/invoicing/invoices/{id}/remind` |
| Record bank transfer, cash or cheque | `POST /v2/invoicing/invoices/{id}/payments` |
| Check status and amount paid | `GET /v2/invoicing/invoices/{id}` |
| Verify webhooks | `POST /v1/notifications/verify-webhook-signature` |
| Webhook events | `INVOICING.INVOICE.PAID`, `.UPDATED`, `.CANCELLED` |

## Architecture

```
Therapist screen (public/)          Family page (public/paid.html, signed link)
          │                                   │
          ▼                                   ▼
   Cloudflare Worker (src/index.js) ──► Claude API (words only)
     │  secrets stay here        ▲
     ├──► PayPal Invoicing API   │ webhook: invoice paid
     ├──► Cloudflare D1: the practice's billing data, versioned
     └──► Cron, hourly: check PayPal for payments. 09:00 UTC: send due reminders
```

The billing logic (`src/practice.js`) is one module with PayPal and AI passed in. The Worker uses it with the real PayPal sandbox and Claude. The single-file review copy uses the same code with a simulated PayPal.

## Run it

### 1. PayPal sandbox

1. At [developer.paypal.com](https://developer.paypal.com), go to **Testing tools → Sandbox accounts**. Create a **Business** account with country **United Kingdom** (the practice) and a **Personal** account (the families). Note the personal account's email and password.
2. Go to **Apps & Credentials → Sandbox → Create app**, linked to the UK business account. Copy the client ID and secret.

### 2. Deploy

```bash
cd pay
npm install
npx wrangler login
npx wrangler d1 create tjs-pay        # put the database_id in wrangler.jsonc
npm run db:remote
npx wrangler secret put PAYPAL_CLIENT_ID
npx wrangler secret put PAYPAL_CLIENT_SECRET
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put LINK_SECRET            # any long random string
npx wrangler secret put DEMO_RECIPIENT_EMAIL   # the sandbox personal account email
npm run deploy
```

The first visit loads the demo practice and creates its unpaid invoices in the sandbox.

### 3. Webhook (optional: the hourly check works without it)

In the PayPal app, add a webhook to `https://<your-worker>.workers.dev/api/paypal/webhook` for *Invoicing invoice paid / updated / cancelled*. Then run `npx wrangler secret put PAYPAL_WEBHOOK_ID`.

### Local testing

```bash
npm run db:local
npm run dev:mock     # PayPal simulated: "Simulate PayPal payment" buttons appear
npm test             # 13 tests for the billing logic
```

## Try the demo

Six made-up patients cover every case:

| Patient | Shows |
|---|---|
| Arjun | Per session, paid through PayPal: create, send, pay as the sandbox personal account |
| Amara | Monthly statement: four online sessions on one invoice |
| Freya | Invoice out. The family reports a bank transfer through the link, and the therapist confirms. |
| Liam | Overdue: edit his next reminder, or send it now |
| Zara | Prepaid block, 7 of 10 used: log a session, and the next block's invoice goes out at session 8 |
| Tomás | Funded by a council: the invoice goes to the council, not the foster carer |

To pay a sandbox invoice, open it with **Open in PayPal** and sign in as the sandbox personal account. Sandbox emails appear under **Sandbox accounts → Notifications**.

## Privacy

- Billing data only: TJS Pay stores no diagnoses, goals or session notes, and never sends them to PayPal or the AI.
- Family links are signed (HMAC) and show only the period and amount.
- The demo uses made-up patients only. Before any real use: legal review, data processing agreements, and a code review.

## Licence

AGPL-3.0-or-later, as for the rest of TJS. See [LICENSE](../LICENSE) and [NOTICE](../NOTICE).
