# Running the clinic server

One computer keeps the clinic's records. Everyone else opens the app in a browser and signs in. Why this setup was chosen: [SYNC-OPTIONS.md](SYNC-OPTIONS.md).

## 1. Choose the computer

- **Always on**, plugged in, ideally on a UPS. Turn off sleep in power settings.
- **Used for nothing else**, if you can: a small mini PC or an old desktop. The boss's laptop is fine for a trial, not for daily use.
- Owned by the clinic, with its own account and a strong password.
- **Full-disk encryption on**: BitLocker (Windows Pro), FileVault (macOS) or LUKS (Linux).
- Automatic operating-system updates on.

## 2. Install and create the first account

1. Install **Node.js 18 or newer** (the LTS version from nodejs.org).
2. Download this repository (Code → Download ZIP, or `git clone`) to a folder such as `C:\TherapyPlanner` or `/opt/therapy-planner`.
3. Choose a long **data passphrase** and keep it somewhere safe (a password manager or a sealed envelope in the clinic safe). If it is lost, the data is lost.
4. Create the first supervisor:

```
# Windows (PowerShell)
$env:THERAPY_DATA_PASSPHRASE = "your long passphrase"
node server/server.js --init-admin "Dr. Priya Nair" priya@yourclinic.in

# macOS / Linux
THERAPY_DATA_PASSPHRASE="your long passphrase" node server/server.js --init-admin "Dr. Priya Nair" priya@yourclinic.in
```

It prints a temporary password. The supervisor chooses their own at first sign-in, then creates everyone else's accounts under **Privacy → People & sign-in**.

To try it first with the demo clinic (password `demo1234`), use a separate folder: `npm run server:demo`.

## 3. Start the server

```
node server/server.js --host 127.0.0.1 --port 8080
```

With `THERAPY_DATA_PASSPHRASE` set as above. `--host 127.0.0.1` means only this computer can reach it directly; the VPN step below gives everyone else a secure address. Data is kept in `clinic-data/` next to the code (change it with `--data`).

| File in `clinic-data/` | What it is |
|---|---|
| `clinic-data.json` | All records (encrypted with the passphrase) |
| `patient-keys.json` | Per-patient keys for crypto-shredded backups, kept apart from the records |
| `access.log` | Sign-ins, records opened, changes made: who, when, from which address. No patient names or notes |

**Start it automatically**

- **Windows:** Task Scheduler → Create Task → *Run whether user is logged on or not*, trigger *At startup*, action `node.exe` with arguments `server\server.js --host 127.0.0.1` and *Start in* the app folder. Set the passphrase as a system environment variable that only administrators can read, or use a service wrapper such as NSSM.
- **macOS:** a `launchd` plist in `/Library/LaunchDaemons` with `RunAtLoad` and `KeepAlive`.
- **Linux (systemd):**

```
# /etc/systemd/system/therapy-planner.service
[Unit]
Description=TJS clinic server
After=network-online.target

[Service]
WorkingDirectory=/opt/therapy-planner
ExecStart=/usr/bin/node server/server.js --host 127.0.0.1 --port 8080
EnvironmentFile=/etc/therapy-planner.env
User=therapy
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`/etc/therapy-planner.env` holds `THERAPY_DATA_PASSPHRASE=...`, owned by root, mode 600. Then `systemctl enable --now therapy-planner`.

## 4. Let everyone reach it: Tailscale

1. Create a Tailscale account for the clinic (preferably with a clinic email, not a personal one).
2. Install Tailscale on the server computer and sign in.
3. Give it HTTPS: `tailscale serve --bg 8080`. It prints an address like `https://clinic-pc.your-tailnet.ts.net`. (Enable *HTTPS certificates* in the Tailscale admin console when asked. The machine name becomes publicly visible in certificate logs, so don't put patient or personal names in it.)
4. On each staff or student device: install Tailscale, sign in with the clinic's tailnet (invite them from the admin console), and open the address. Install it as an app from the browser if you like.
5. In the Tailscale admin console, under **Access controls**, allow devices to reach only the server, on port 443.
6. When someone leaves or a semester ends: remove their device from Tailscale **and** delete or disable their account in the app.

**Fully open source instead:** NetBird (self-hosted) or Headscale (a self-hosted Tailscale control server) work the same way, but you run the coordination server too. **Plain WireGuard** works if the clinic's internet line has a public IP: run WireGuard on the router or server, forward its UDP port, and give each device a key.

**Clinic network only, no VPN:** run with `--host 0.0.0.0` and open `http://<server-ip>:8080`. Add HTTPS with your own certificate (`--tls-cert`, `--tls-key`) so passwords and records are not sent in the clear over Wi-Fi.

## 5. Backups

Don't just copy `clinic-data/`: every copy would keep erased patients readable.

1. A supervisor opens **Privacy → Backups & keys → Create backup / Download backup** each week (or each day). Each patient in it is encrypted with their own key.
2. Copy the **key file** (*Copy key file*) to one separate safe place after every erasure.
3. Store backups away from the server (an encrypted USB drive kept elsewhere, or the clinic's cloud storage under a processing agreement).
4. Test a restore once a quarter on a spare computer.

Also back up the data passphrase (offline). Without it the server's files cannot be opened.

## 6. Day to day

- The pill at the top of the app shows **Live** when connected. **Offline** means the server can't be reached: keep the tab open and changes are sent when it's back.
- Update by replacing the code files and restarting the server. `clinic-data/` stays.
- Review `access.log` monthly, and keep it for at least a year (see [LEGAL.md](LEGAL.md)).

## Options

```
node server/server.js --help
```

| Option | Default | |
|---|---|---|
| `--port` | 8080 | env `PORT` |
| `--host` | 0.0.0.0 | `127.0.0.1` behind `tailscale serve`; env `HOST` |
| `--data` | `./clinic-data` | env `THERAPY_DATA_DIR` |
| `--tls-cert`, `--tls-key` | – | serve HTTPS directly; env `TLS_CERT`, `TLS_KEY` |
| `--source` | this repository | link shown to users for the source code (AGPL §13) |
| `--demo` | – | start with demo data if the folder is empty |
| `--init-admin "Name" email` | – | create a supervisor and exit |
