// SPDX-License-Identifier: AGPL-3.0-or-later
// The AI's jobs. It writes and reads words, and the billing assistant plans actions; it never calculates money
// and never acts on its own. It only ever receives billing facts (names, dates, amounts): never notes, goals or diagnoses.
import Anthropic from '@anthropic-ai/sdk';

const RULES = `Write in UK English, plainly and kindly, like an independent therapist writing to a parent or a school.
Never mention diagnoses, conditions, therapy goals, progress or anything clinical: only sessions and payment.
Never invent amounts, dates or facts. Use only what you are given. No emojis.`;

/**
 * @param env   Worker environment (ANTHROPIC_API_KEY, AI_MODEL, AGENT_MODEL)
 * @param guard called before every model request; throws when the daily AI budget is used up
 */
export function claude(env, guard = () => {}) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
  const SMALL = env.AI_MODEL || 'claude-haiku-5-5';
  const AGENT = env.AGENT_MODEL || 'claude-opus-5-5';
  const textOf = (msg) => msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();

  async function ask(system, user, max = 1500) {
    guard();
    const msg = await client.messages.create({ model: SMALL, max_tokens: max, output_config: { effort: 'low' }, system, messages: [{ role: 'user', content: user }] });
    if (msg.stop_reason === 'refusal') throw new Error('AI declined');
    return textOf(msg);
  }
  const json = async (system, user, max) => JSON.parse((await ask(system + '\nReply with one JSON object only: no other text, no code fences.', user, max)).replace(/```json|```/g, '').trim());

  return {
    /** The message on a new invoice. */
    invoiceNote: (facts) => json(`You write the short message that goes with an invoice from a private speech and language therapy practice in the UK.\n${RULES}\nReturn {"subject": under 70 characters, "note": 2 or 3 sentences, under 380 characters}. Thank them, say what the invoice covers and the total, and say they can pay by PayPal or card with the button, or by bank transfer. If the payer is an organisation, be businesslike and do not use a first name.`, JSON.stringify(facts)),
    /** Read a payment typed in plain words. Returns facts only; the code checks them and does the sums. */
    parsePayment: ({ text, today, patients }) => json(`You read a short note a therapist typed about money they received outside PayPal, and pick out the facts.
Patients (use an id exactly as given): ${JSON.stringify(patients)}
Today is ${today}. People may be named by the child's name, a caregiver's name or role ("Liam's mum"), or the organisation.
Return {"patient_id": id or null if you cannot tell, "amount": number in pounds or null if no amount is written, "method": "cash" | "bank" | "cheque" | "other", "reference": string or null}.
Never guess an amount that is not written. Use "other" for phone apps.`, text),
    /** Rewrite a reminder the therapist is editing: warmer, shorter or firmer. */
    rewriteReminder: async ({ text, style }) => {
      const out = await ask(`You help a speech and language therapist edit a payment reminder to a family.\n${RULES}\nRewrite it to be ${style === 'shorter' ? 'shorter (one or two sentences)' : style === 'firmer' ? 'a little firmer and clearer, still polite' : 'warmer and more personal'}. Keep every name, amount and period exactly as written, and keep any {placeholders} unchanged. Reply with the reminder text only.`, text);
      return out.slice(0, 1200);
    },

    /**
     * The billing assistant: an agent loop over tools that the billing code defines and runs.
     * Read tools look things up (including live PayPal status). The only "action" tool records a
     * proposal; nothing is sent or recorded until the therapist approves it on screen.
     */
    async assistant(args) {
      try { return await agentLoop(args); }
      catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new Error('the AI key was not accepted');
        if (e instanceof Anthropic.RateLimitError) throw new Error('the AI is busy right now');
        if (e instanceof Anthropic.APIConnectionError) throw new Error('the AI could not be reached');
        if (e instanceof Anthropic.APIError) throw new Error(`the AI returned an error (${e.status})`);
        throw e;
      }
    },
  };

  async function agentLoop({ system, request, tools, run, maxTurns = 6 }) {
      const messages = [{ role: 'user', content: request }];
      let calls = 0;
      for (let turn = 0; turn < maxTurns; turn++) {
        guard(); calls++;
        const msg = await client.beta.messages.create({
          model: AGENT,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default', // if the model declines, the API retries on a fallback model in the same call
          output_config: { effort: 'medium' },
          cache_control: { type: 'ephemeral' }, // later steps reuse the instructions, tools and figures at a fraction of the cost
          system,
          tools,
          messages,
        });
        if (msg.stop_reason === 'refusal') throw new Error('The assistant declined this request.');
        messages.push({ role: 'assistant', content: msg.content }); // full content, thinking blocks included
        const uses = msg.content.filter((b) => b.type === 'tool_use');
        if (msg.stop_reason !== 'tool_use' || !uses.length) return { text: textOf(msg), calls };
        const results = [];
        for (const u of uses) {
          try { results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(await run(u.name, u.input || {})) }); }
          catch (e) { results.push({ type: 'tool_result', tool_use_id: u.id, content: String(e.message || e), is_error: true }); }
        }
        messages.push({ role: 'user', content: results }); // every result in one message
      }
      return { text: 'I stopped after several steps. The actions I proposed so far are below.', calls };
  }
}
