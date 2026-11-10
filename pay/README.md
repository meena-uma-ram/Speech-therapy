# TJS Pay

**Billing for independent speech and language therapists: log a session, and TJS Pay invoices it through PayPal, follows up, and records the payment however the family paid.**

Built for the PayPal AI Hackathon by Meenakshi Ramesh, a speech-language therapist. Part of [TJS](../README.md), an open-source workflow tool for speech therapy teams.

## The problem

Small practices lose hours a month to billing: invoices, checking who has paid, and awkward reminders. Real payments are messy too. Families pay monthly or in advance, councils and schools pay for some children, and plenty of money arrives by bank transfer or cash, which no payment platform can see.

## What it does

TJS Pay now runs a **hospital**: ten departments, each with a code (ENT-01, PAED-01, NEU-01, CARD-01, PT-01, OT-01, AVT-01, SLT-01, AUD-01, DX-01). Three kinds of user, as in a real hospital:

- **Billing office:** invoices patients and funders through PayPal, applies incoming payments to the right invoices (cash application), and tracks who has paid and who is overdue. One hospital PayPal account receives every payment; each invoice line carries its department code.
- **Finance department:** allocates each department a budget for the financial year (within the overall budget set by the hospital's leadership) and approves departments' money requests, paid with **PayPal Payouts** to the department's PayPal account or straight to a supplier.
- **Department staff:** log sessions, log what they spend, and ask Finance for money.

| | |
|---|---|
| **Billing assistant** | Ask in plain words: *"Who owes me money? Chase anyone more than two weeks late."* An AI agent looks up the invoices, **checks each one with PayPal live**, and proposes numbered actions (reminders, invoices, drafts to send, payments to confirm). The therapist ticks and approves; the billing code checks each action again and does it. |
| **Departments and codes** | Every service belongs to a department, and every invoice line carries the department code (on the PayPal invoice too: `SLT-01 · Therapy session`). A family's invoice can mix departments, e.g. an ENT consultation and a hearing test. |
| **Check-in & pay** | *Appointments* (billing office front desk): book a visit; send the family a **signed check-in link** (copy-ready text message and a **QR code** for the desk). Before the visit the family checks in on their phone. Families who pay for themselves choose a **sliding-scale price** (self-reported, no proof, so the desk never has to ask). For high-demand services (EEG, echo, hearing aid fitting, intensive day) a **deposit is held on their PayPal**, not taken. On **Arrived**, the hold is captured toward the visit's invoice (any unused part released) and the rest is invoiced through PayPal with the deposit already shown as paid. On **No-show**, the deposit is kept as a fee. On **Cancel**, the hold is released. |
| **Insurance claims** | For an insured patient, *Split with insurance* on the draft invoice splits every line: the family pays the **excess** through PayPal, the rest becomes a **claim** to the insurer (department codes kept on both). *Insurance claims* (billing office) tracks it: paid in full, part paid, or rejected. Anything the insurer doesn't cover becomes a draft invoice to the family. |
| **Outside providers** | Some services are done by a partner, e.g. a **PET-CT scan by Lakeside Imaging**: the family pays the hospital through PayPal, and the partner's agreed fee is tracked on the invoice line. Finance pays it with **PayPal Payouts**, only from money actually collected, never twice. |
| **Surgery payment plans** | On the patient's page: choose the surgery and date, a deposit (e.g. 30%) and up to 6 instalments. The deposit invoice goes through PayPal at once; each instalment is sent on its date (the last a week before surgery). The family pay page offers **PayPal Pay Later** where eligible. |
| **Budgets** | *Budgets and requests* (finance department): each department's budget for the financial year (April to March), what is used (spending logged + requests paid), what is left, requests waiting, and income from patients by department code (for reporting only). |
| **Money requests, paid with PayPal Payouts** | A department asks for an amount, says what it's for, and whether it goes to its own PayPal account or to a supplier's. Finance sees the budget left after it, then approves (PayPal Payouts sends the money) or rejects with a reason. Going over budget needs an explicit decision. Payout status comes back from PayPal (webhook and hourly check); a failed payout stops counting against the budget and can be approved again. Departments need only a PayPal account that can receive money, no PayPal app or keys. |
| **Roles** | *Signed in as* switches between the billing office, the finance department and each department (a demo switch; in real use each person signs in). The billing office sees Overview, Patients and Settings; Finance sees Budgets and requests, and Finances. Department staff get *My department*: their budget, used and left; ask for money; log spending; follow their requests; log a session with their department's services. |
| **Overview** | One list of what needs the therapist: drafts to send, sessions to invoice, and payments families say they've made. Plus every unpaid invoice with its next reminder. |
| **Patients** | Filter by *to invoice, waiting, overdue, paid up*. Each patient has sessions, invoices and payments. Flexible names ("known as"), several caregivers, and who pays (family, school, local authority, charity). |
| **Billing types** | Per session, monthly statement, or prepaid blocks. When a block reaches the session the clinic chooses (e.g. 8 of 10), the next block's invoice goes out automatically. |
| **PayPal invoices** | Every invoice is created and sent with the PayPal Invoicing API, in GBP. Families and funders pay by PayPal or card. |
| **Payments arrive by themselves** | A PayPal webhook, plus an hourly check, marks invoices paid as soon as PayPal has the money. |
| **Reminders** | Sent through PayPal on the days the clinic sets (3, 7 and 14 by default), one at a time and in order. The wording is editable for everyone in Settings, or for one invoice before it goes. |
| **Pay now on the family page** | Every invoice and reminder links to a signed family page with **PayPal Checkout** buttons (PayPal, card, and whatever PayPal offers the family). The payment is captured server-side for exactly the amount owed and recorded on the PayPal invoice. |
| **Paid another way** | The same page lets the family say they paid by bank transfer or cash instead. The therapist confirms it, and the payment is recorded on the PayPal invoice, so PayPal holds the complete record. |
| **Record a payment in plain words** | "Liam paid 135 cash" → the right invoice, split across invoices if needed, with any overpayment kept as credit. |
| **Finances** | Profit for the month (paid in, estimated PayPal fees, expenses), work done by service as a pie chart, who paid and how, plus a CSV for the accountant. |

## How AI is used (Anthropic Claude)

`src/ai.js` uses the official Anthropic SDK (`@anthropic-ai/sdk`). The AI has one agent and three small jobs, each with a safe fallback.

### The billing and finance assistants (an agent with tools)

Staff ask in plain words. The **billing office** gets billing tools and actions (reminders, invoices, confirming payments); the **finance department** gets budget tools and one action (pay a money request). Neither can use the other's tools: this is enforced in the code, not just the prompt. Claude (`AGENT_MODEL`, Claude Haiku 5.5 by default, to keep costs low; Sonnet 5.5 or Opus 5.5 can be set instead) runs a tool-use loop over tools that the billing code defines and runs (`src/practice.js`, *the billing assistant*):

| Tool | What it does |
|---|---|
| `list_unpaid_invoices` | Unpaid invoices: who, who pays, owed, days late, reminders sent, whether the family says they paid another way |
| `check_paypal` | Asks the PayPal Invoicing API right now whether invoices are paid, and records any payment found |
| `list_patients` | Billing facts only: billing type, payer, sessions waiting to be invoiced, owed, credit |
| `list_reported_payments` | Bank transfers and cash that families reported, waiting to be confirmed |
| `month_summary` | Paid in, PayPal fees, expenses, profit for a month |
| `department_budgets` | Budgets by department code (budget, used, left) and every money request with the budget left after it |
| `propose_action` | Adds a numbered proposal to the plan: `reminder`, `invoice`, `send_draft`, `confirm_payment` or `pay_request`. A request that would go over budget is refused here and left to the finance department. It does **not** do it. |

The agent is told to check PayPal before proposing a reminder, so nobody who has just paid is chased. The screen shows what it checked, its answer, and the proposals with tick boxes. **Approve selected** runs each one through the same tested code as the buttons, after checking it again (an invoice paid in the meantime is skipped). Tools use strict schemas; the request uses Anthropic's server-side refusal fallback. Without an AI key, past the daily limit, or on any AI error, the same tools are driven by built-in rules.

### Keeping AI calls down

- The example questions under the assistant are answered **instantly by the built-in rules** (no AI call). Typed questions go to Claude.
- Claude gets the current figures up front (and, for billing, a fresh PayPal check), so most questions take one or two calls; repeated instructions are cached.
- Invoice messages use **standard wording**; **Write with AI** in the draft asks Claude only when wanted.
- Payments typed in plain words are read by the built-in reader first; Claude is asked only when it can't tell who paid.
- *AI calls today: X of 150* shows at the top of the assistant.

### Three small jobs (`AI_MODEL`, Claude Haiku 5.5)

1. **Writes the message on an invoice when asked** (*Write with AI*): a short, friendly note for families, and businesslike wording for councils and schools.
2. **Reads payments typed in plain words** when the built-in reader can't tell who paid. It extracts who, how much, how and the reference. It may only choose a patient that exists.
3. **Rewrites a reminder** as warmer, shorter or firmer, while the therapist edits it.

**Design rules:**
- **The AI writes and reads words only.** Every amount, split, credit and date is plain, tested code (`src/practice.js`, `test/practice.test.js`).
- **The AI never sees clinical information:** billing facts only, never notes, goals or diagnoses.
- **Nothing is sent without a human.** The assistant only proposes; the therapist approves. Invoices are drafted for review. Reminders use the clinic's own wording.
- **A daily cap.** `AI_DAILY_LIMIT` (150 requests a day by default) stops a public demo link from running up the AI bill. Past it, the built-in rules and standard wording take over.
- **If the AI is unavailable,** standard wording and rule-based reading take over, so billing never stops.

## How PayPal is used

All calls are made server-side in the Worker (`src/paypal.js`). The secret never reaches the browser; the Checkout buttons use only the public client ID.

| Purpose | Endpoint |
|---|---|
| Sign in | `POST /v1/oauth2/token` |
| Create invoice | `POST /v2/invoicing/invoices` |
| Send invoice | `POST /v2/invoicing/invoices/{id}/send` |
| Send reminder | `POST /v2/invoicing/invoices/{id}/remind` |
| Record bank transfer, cash or cheque | `POST /v2/invoicing/invoices/{id}/payments` |
| Check status and amount paid | `GET /v2/invoicing/invoices/{id}` |
| Family pays now (PayPal Checkout) | `POST /v2/checkout/orders`, `POST /v2/checkout/orders/{id}/capture`, PayPal JS SDK buttons |
| Hold a no-show deposit at check-in | `POST /v2/checkout/orders` with `intent: AUTHORIZE`, `POST /v2/checkout/orders/{id}/authorize`, PayPal JS SDK buttons (`intent=authorize`) |
| Take the deposit on arrival or a no-show | `POST /v2/payments/authorizations/{id}/capture` (partial capture, `final_capture`, the rest released) |
| Release the deposit on a cancellation | `POST /v2/payments/authorizations/{id}/void` |
| Pay an outside provider its fee | `POST /v1/payments/payouts` |
| Pay an approved money request (to a department or a supplier) | `POST /v1/payments/payouts` |
| Payout status | `GET /v1/payments/payouts/{batch_id}` |
| Verify webhooks | `POST /v1/notifications/verify-webhook-signature` |
| Webhook events | `INVOICING.INVOICE.PAID`, `.UPDATED`, `.CANCELLED`; `PAYMENT.PAYOUTSBATCH.*` |

## Architecture

```
Therapist screen (public/)          Family page (public/paid.html, signed link)
          │                           │  PayPal Checkout buttons
          ▼                           ▼
   Cloudflare Worker (src/index.js) ──► Claude API: billing assistant (tools) + wording
     │  secrets stay here
     ├──► PayPal Invoicing + Orders APIs  ◄── webhook: invoice paid
     ├──► Cloudflare D1: the practice's billing data, versioned
     └──► Cron, hourly: check PayPal for payments. 09:00 UTC: send due reminders
```

The billing logic (`src/practice.js`) is one module with PayPal and AI passed in. The Worker uses it with the real PayPal sandbox and Claude. The single-file review copy uses the same code with a simulated PayPal.

## Run it

### 1. PayPal sandbox

1. At [developer.paypal.com](https://developer.paypal.com), go to **Testing tools → Sandbox accounts**. Create a **Business** account with country **United Kingdom** (the practice) and a **Personal** account (the families). Note the personal account's email and password.
2. Go to **Apps & Credentials → Sandbox → Create app**, linked to the UK business account. Copy the client ID and secret.
3. In the app's settings, make sure **Payouts** is ticked under features (needed to pay money requests).

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
npx wrangler secret put DEMO_PAYOUT_EMAIL      # optional: where payouts go in the sandbox (defaults to the one above)
npm run deploy
```

The first visit loads the demo practice and creates its unpaid invoices in the sandbox.

### 3. Webhook (optional: the hourly check works without it)

In the PayPal app, add a webhook to `https://<your-worker>.workers.dev/api/paypal/webhook` for *Invoicing invoice paid / updated / cancelled*. Then run `npx wrangler secret put PAYPAL_WEBHOOK_ID`.

### Local testing

```bash
npm run db:local
npm run dev:mock     # PayPal simulated: "Simulate PayPal payment" buttons appear
npm test             # 32 tests: billing logic, the assistants' checks and team separation, Checkout, check-in deposits and sliding scale, department budgets and requests
```

## Try the demo

**Judges and reviewers:** the demo is *Northern Voices Children’s Hospital*. Use **Signed in as** (top right) to switch between the billing office, the finance department and a department. As **Finance**, approve a money request (two fit the budget, one goes over). As the **billing office**, open **Appointments**, send yourself Freya's check-in link, check in as the family (choose a sliding-scale price, hold the deposit with the sandbox personal account), then press **Arrived**. Also start with the **Billing assistant** at the top of the Overview, for example *"Who owes me money? Chase anyone more than two weeks late."* Settings → **Reset demo data** puts everything back. AI use is capped per day; past it the app keeps working with built-in rules.

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

## Roadmap

Built: AI billing and finance assistants; PayPal Invoicing, Checkout, deposit holds (authorise and capture) and Payouts; department codes, budgets and money requests; check-in & pay with a sliding scale.

Next:
- **Card on file and family wallet** (PayPal Vault): save a parent's PayPal once, and send them an approval request when a child or an older relative is at the clinic.
- **Text-to-pay by SMS**: send the check-in and payment links straight from TJS (an SMS provider; links and messages are ready today).
- **Wallet pass and tap to check in**: an Apple Wallet / Google Wallet pass that checks in and takes the deposit at the door.
- **Shop and pharmacy cart**: hearing aid batteries, communication aids and supplies paid with Checkout, picked up at the desk.
- **Independent providers paid at the moment of payment**: PayPal multiparty payments, once the hospital is onboarded as a PayPal partner (today partners are paid afterwards with Payouts).
- **Insurance claims sent electronically** to insurers, instead of tracked by hand.

Not planned: paying doctors a percentage for referring patients. Commission for referrals is prohibited in India (NMC ethics rules) and the UK (GMC guidance, Bribery Act). Doctors who do work are paid a fee for that work, shown on the bill.
- **Hospital-scale ERP**: a proper ledger and tables instead of one document per hospital, real sign-in and approval limits, queues for PayPal calls, procurement, several hospitals.

## Privacy

- Billing data only: TJS Pay stores no diagnoses, goals or session notes, and never sends them to PayPal or the AI.
- Family links are signed (HMAC) and show only the period and amount. Check-in links show only the visit, its price choices and the deposit. The sliding-scale choice is self-reported and stored only as the price band.
- The demo uses made-up patients only. Before any real use: legal review, data processing agreements, and a code review.

## Licence

AGPL-3.0-or-later, as for the rest of TJS. See [LICENSE](../LICENSE) and [NOTICE](../NOTICE).
