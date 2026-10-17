# GDPR position: you as a processor based in Sweden (5.10) – for the lawyer ⚖️

**Facts:** the clinics (controllers / Data Fiduciaries) are in India, the patients are in India, the data will be stored in India (Supabase Mumbai). You run the service from Sweden and may access it remotely for support.

## Likely position (to confirm)

1. **GDPR applies to you as a processor.** Art. 3(1) covers processing "in the context of the activities of an establishment" in the EU, of a controller *or a processor*, regardless of where the processing takes place. The EDPB's Guidelines 3/2018 on territorial scope say an EU processor of a non-EU controller must meet the *processor* obligations itself: Art. 28(2)–(5) (contract terms, sub-processors), 29, 30(2) (records), 32 (security), 33(2) (tell the controller about breaches), 37 (DPO, if required), and Chapter V for transfers.
2. **The Indian clinics do not become subject to GDPR** merely because they use an EU processor (same guidelines). They follow the DPDP Act.
3. **Transfers.** If the data is processed under your EU establishment's responsibility and then made available to the controller in India, the EDPB treats that as a transfer to a third country. The European Commission's standard contractual clauses have a **Module 4 (processor to controller)** for this case. Ask the lawyer whether your setup (data never leaves India; you access it remotely from Sweden) counts as a transfer and whether Module 4 is needed.
4. **Your sub-processors** (Supabase, Cloudflare, AWS) must have GDPR-compliant contracts with you (Art. 28(4)). Supabase and Cloudflare offer DPAs with SCCs.
5. **Supervisory authority:** IMY (Integritetsskyddsmyndigheten), Sweden.
6. **DPDP Act:** applies to processing in India, and to processing outside India connected with offering goods or services to people in India (s. 3(b)). Most duties fall on the clinics; you are bound through the DPA.

## Practical steps

- Keep a record of processing activities as a processor (Art. 30(2)).
- Minimise your own access: support access with MFA, logged, only when the clinic asks.
- Breach notice to the clinic within 24 hours (DPA), which also satisfies Art. 33(2).
- Consider whether you need a DPO (Art. 37: core activities of large-scale processing of health data). Probably yes once you serve many clinics.

## Questions for the lawyer

1. Does remote access from Sweden to data stored in India make you an "establishment" processing the data, and is it a transfer needing SCC Module 4?
2. Which law governs your contracts with Indian clinics, and how do GDPR processor duties interact with the DPDP processor contract?
3. Do you need a DPO, and when?
4. Swedish company or Indian entity: which is better as the contracting party?
