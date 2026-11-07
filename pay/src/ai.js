// SPDX-License-Identifier: AGPL-3.0-or-later
// The AI's three jobs. It writes and reads words; it never calculates money.
// It only ever receives billing facts (names, dates, amounts): never notes, goals or diagnoses.
const RULES = `Write in UK English, plainly and kindly, like an independent therapist writing to a parent or a school.
Never mention diagnoses, conditions, therapy goals, progress or anything clinical: only sessions and payment.
Never invent amounts, dates or facts. Use only what you are given. No emojis.`;

export function claude(env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  async function ask(system, user, max = 400) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.AI_MODEL || 'claude-haiku-5-5', max_tokens: max, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error('AI request failed (' + res.status + ')');
    const data = await res.json();
    return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }
  const json = async (system, user, max) => JSON.parse((await ask(system + '\nReply with one JSON object only: no other text, no code fences.', user, max)).replace(/```json|```/g, '').trim());
  return {
    /** The message on a new invoice. */
    invoiceNote: (facts) => json(`You write the short message that goes with an invoice from a private speech and language therapy practice in the UK.\n${RULES}\nReturn {"subject": under 70 characters, "note": 2 or 3 sentences, under 380 characters}. Thank them, say what the invoice covers and the total, and say they can pay by PayPal or card with the button, or by bank transfer. If the payer is an organisation, be businesslike and do not use a first name.`, JSON.stringify(facts), 300),
    /** Read a payment typed in plain words. Returns facts only; the code checks them and does the sums. */
    parsePayment: ({ text, today, patients }) => json(`You read a short note a therapist typed about money they received outside PayPal, and pick out the facts.
Patients (use an id exactly as given): ${JSON.stringify(patients)}
Today is ${today}. People may be named by the child's name, a caregiver's name or role ("Liam's mum"), or the organisation.
Return {"patient_id": id or null if you cannot tell, "amount": number in pounds or null if no amount is written, "method": "cash" | "bank" | "cheque" | "other", "reference": string or null}.
Never guess an amount that is not written. Use "other" for phone apps.`, text, 200),
    /** Rewrite a reminder the therapist is editing: warmer, shorter or firmer. */
    rewriteReminder: async ({ text, style }) => {
      const out = await ask(`You help a speech and language therapist edit a payment reminder to a family.\n${RULES}\nRewrite it to be ${style === 'shorter' ? 'shorter (one or two sentences)' : style === 'firmer' ? 'a little firmer and clearer, still polite' : 'warmer and more personal'}. Keep every name, amount and period exactly as written, and keep any {placeholders} unchanged. Reply with the reminder text only.`, text, 300);
      return out.slice(0, 1200);
    },
  };
}
