# Sharing one set of records across everyone's computers

**The question:** staff and students sign in from different computers (at the clinic, at home, at university), but the clinic's records must exist in one place, for example on the boss's computer, and everyone must see the same, up-to-date schedule.

**Short answer:** the syncing is done by the **clinic server** that now ships with the app (`server/server.js`). It runs on one computer and keeps the only full copy of the records. A **VPN** (your idea) is how the other computers reach that computer safely. The two are separate problems:

| Problem | Solved by |
|---|---|
| Keeping one correct copy, merging everyone's changes, live updates, who may see what | The clinic server in this repository |
| Letting a laptop at home reach the clinic computer, privately and encrypted | A VPN, or hosting the server in the cloud |

## How the sync works

- The server keeps the records in `clinic-data/` on its disk (encrypted if you set `THERAPY_DATA_PASSPHRASE`).
- Each browser signs in to the server. The server sends that person **only what their role may see**. A student gets their own cases; colleagues' other sessions arrive as "Session, 10:00–10:30, Room 2", with no patient details.
- Each change is sent as a change to **one record** (one goal, one session, one message), not a whole copy of the database. Two people editing different records never overwrite each other. If two people edit the *same* record at the same moment, the later save wins.
- The server checks every change against the role rules and refuses the rest (a student cannot edit someone else's patient, even with a modified browser).
- Everyone signed in gets changes **live** (server-sent events). The status pill at the top shows *Live*, *Saving…* or *Offline*.
- If the connection drops, the browser keeps the changes in memory and sends them when the server is back. Keep the tab open until the pill shows *Live* again.
- Nothing is stored on the laptops. Signing out or closing the tab clears the records from that device.

## Ways for the other computers to reach the server

| # | Option | How it works | Good | Problems | Verdict |
|---|---|---|---|---|---|
| 1 | **Clinic Wi-Fi / LAN only** | Server on a clinic computer; others open `http://clinic-pc:8080` on the same network | Free, simple, data never leaves the building | Works only on site. Plain HTTP on shared Wi-Fi unless you add HTTPS | Fine for a single site with no home access |
| 2 | **Open a port on the router to the internet** | Router forwards port 8080 to the clinic computer | Reachable from anywhere | The sign-in page is exposed to the whole internet and to automated attacks. Needs HTTPS, updates and monitoring. Many Indian broadband lines sit behind CGNAT, so it often doesn't even work | **Avoid** for health data |
| 3 | **Classic VPN** (WireGuard or OpenVPN on the router or the clinic computer) – *your suggestion* | Each laptop connects to the clinic network, then uses option 1 | Strong encryption, open source, nothing exposed except the VPN port | Needs a public IP or dynamic DNS and a forwarded port. Fails behind CGNAT. Key management by hand for each device | Good if your line has a public IP and someone is comfortable setting up WireGuard |
| 4 | **Mesh VPN** (Tailscale; or the fully open-source, self-hostable **NetBird** or **Headscale**; or ZeroTier) | A small app on each device. Devices find each other and talk directly over WireGuard, even behind CGNAT. Nothing is opened on the router | Ten-minute setup. Works from home and university. Per-person sign-in, remove a device in one click, access rules. Can add HTTPS (`tailscale serve`) | The coordination service (Tailscale Inc., unless you self-host Headscale/NetBird) sees device names, IP addresses and account emails, **not** the traffic. It is a service provider: check its terms and where it is based | **Recommended now** |
| 5 | **Tunnel service** (Cloudflare Tunnel, ngrok) | The clinic computer dials out to the service, which gives it a public web address | No router changes, HTTPS included, can put a login in front | The provider decrypts the traffic, so it sees patient data in transit. It becomes a processor abroad. Still exposed to the internet | Not for health records without a processing agreement |
| 6 | **Cloud server** in an Indian region (AWS Mumbai/Hyderabad, Azure Pune, Google Cloud Mumbai/Delhi, or an Indian provider) | The same `server/server.js` runs on a rented server with HTTPS | Always on, no dependency on one office PC, proper backups, power and uptime | Monthly cost; someone must patch it. The host is your data processor (contract needed). Exposed to the internet, so HTTPS, updates and monitoring are a must | **Best next step** when you have more than one site or a pilot with real patients |
| 7 | **Shared file in Google Drive / Dropbox / OneDrive / Syncthing** | Everyone opens the same exported file | No server | Two people saving at once overwrite each other; files corrupt; every copy holds every patient; no role rules; a third-party cloud holds health data | **Reject** |
| 8 | **Peer-to-peer sync** (CRDTs, no server) | Every device holds a full copy and syncs with the others | Works offline | Every laptop holds every patient's record, which breaks need-to-know and makes erasure nearly impossible to prove. Complex | **Reject** for this use |
| 9 | **Hosted database** (Firebase, Supabase) | Rewrite the app on a vendor's backend | Managed sync | Full rewrite, vendor lock-in, a processor that may be abroad | Not needed |

## The choice

**Now:** run the clinic server on **one always-on clinic computer** and connect everyone through a **mesh VPN**.

- Use a **dedicated machine**, such as a small mini PC or an old desktop that does nothing else. The boss's everyday laptop works for a trial, but it sleeps, travels, gets lost, and is shared with family and personal apps. When it is off, nobody can work.
- Use **Tailscale** if you want the easiest setup. Use **NetBird** or **Headscale** if you want everything open source and under your control (you then run the coordination server yourself, which takes more effort).
- Turn on **HTTPS** with `tailscale serve`, set `THERAPY_DATA_PASSPHRASE`, and turn on the computer's full-disk encryption (BitLocker, FileVault or LUKS).
- Step-by-step instructions: [SERVER-SETUP.md](SERVER-SETUP.md).

**Why not a plain VPN?** It is a sound idea and it would work. A mesh VPN *is* a VPN (it uses WireGuard underneath), but it also works behind CGNAT, needs no router changes, and makes adding and removing people's devices easy. That matters when students change every semester.

**Later (pilot with real patients, or a second site):** move the same server to a cloud server in an Indian region, with HTTPS, managed backups and a processing agreement with the host. Nothing in the app changes. See [SECURITY-PLAN.md](SECURITY-PLAN.md).

**What this setup does not do:** the server keeps one copy, so it needs a backup routine (the in-app encrypted backup plus a separate key file, see SERVER-SETUP.md). It handles a clinic, not a hospital chain: one process, one data file, no replication. And the code was AI-assisted: have it reviewed by a security professional before real patient data goes in.
