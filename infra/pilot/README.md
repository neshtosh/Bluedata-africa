# Pilot on this laptop (ADR-019)

The pilot runs at zero cost on the founder's Windows laptop, reached from the internet through
Cloudflare quick tunnels. It is a **separate copy** of the platform: its own database, Valkey,
API, worker and web apps, in Docker, with nothing shared with the development services. Resetting
the development database never touches pilot data.

```
Phone / browser ──HTTPS──► Cloudflare ──tunnel──► proxy (Caddy) ─┬─ /v1/*  → API
                                                                  └─ other  → SamakiOS / BlueData
```

- People sign in with **phone number and password**. SMS is switched off (`SMS_PROVIDER=none`)
  until it is funded.
- New people get their first password from a **one-time setup link**, shared by hand (e.g. on
  WhatsApp). Links work once, for 72 hours; a new link replaces the old one.
- Use **synthetic or consented data only** until the data-protection opinion is in.

## Before you start

- Docker Desktop running.
- Turn on **BitLocker / Device encryption** (Settings → Privacy & security → Device encryption).
  The pilot database holds people's names and phone numbers.
- Power settings: plugged in, **sleep: never**. The pilot is down whenever the laptop sleeps.

All commands run from the repository folder in PowerShell.

## First time

```powershell
.\infra\pilot\pilot.ps1 init
```

Creates `infra/pilot/.env.pilot` with fresh random passwords and secrets. **Back this file up
somewhere private** (a password manager is ideal): the backups can't be used without it.

Edit `.env.pilot` and set `OFFSITE_BACKUP_DIR` to a folder that leaves the laptop, for example
your OneDrive folder (`C:\Users\<you>\OneDrive\BluePilotBackups`).

```powershell
.\infra\pilot\pilot.ps1 up
```

Builds and starts everything (the first build takes several minutes), then prints the two public
addresses, e.g. `https://some-random-words.trycloudflare.com`.

Then schedule the nightly backup (02:00, or as soon as the laptop is on):

```powershell
.\infra\pilot\pilot.ps1 schedule-backup
```

## Giving someone access

**The first owner of an organisation** (you create the link):

```powershell
.\infra\pilot\pilot.ps1 link -Phone +254712345678 -Name "Achieng Otieno"
```

It prints the full link. Send it to that person only. They open it, choose a password, and land
in SamakiOS, where they register their organisation.

**Their staff** (the owner does this in the app): Members → invite by phone → **Setup link** next
to the invited person → copy or share on WhatsApp. Opening it sets their password and joins them
to the organisation.

**Forgotten password:** run the same `link` command for that phone number. Owners can only create
links for people who have never signed in, so an owner of one organisation can never take over
an account that also belongs to another.

## Day to day

| Task                              | Command                                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| Current public addresses          | `.\infra\pilot\pilot.ps1 urls`                                                                |
| Is everything running?            | `.\infra\pilot\pilot.ps1 status`                                                              |
| Recent logs (all, or one service) | `.\infra\pilot\pilot.ps1 logs` / `... logs -Service api`                                      |
| Back up now                       | `.\infra\pilot\pilot.ps1 backup`                                                              |
| Stop (keeps data)                 | `.\infra\pilot\pilot.ps1 down`                                                                |
| Start again                       | `.\infra\pilot\pilot.ps1 up`                                                                  |
| Update to the latest code         | pull the code, then `.\infra\pilot\pilot.ps1 update` (backs up, rebuilds, migrates, restarts) |

On this laptop you can also open <http://localhost:8080> (SamakiOS) and <http://localhost:8082>
(BlueData). Browsers treat `localhost` as secure, so signing in works there too.

**The public addresses change** every time the tunnels restart (laptop reboot, `up`, Docker
restart). Run `urls` and send people the new address. A domain added to Cloudflare later
(around 10 USD a year) gives fixed addresses and one sign-in for both apps.

## Backups and restore

- `backup` writes `pilot-<date>-<time>.dump` to `infra/pilot/backups` (the 14 newest are kept)
  and copies it to `OFFSITE_BACKUP_DIR` (the 30 newest are kept there).
- A backup that has not left the laptop does not protect against losing the laptop. The command
  warns if `OFFSITE_BACKUP_DIR` is empty.
- Restore (replaces all pilot data; asks you to type RESTORE):

  ```powershell
  .\infra\pilot\pilot.ps1 restore -File pilot-20261126-020000.dump
  ```

  The file must be in `infra/pilot/backups` (copy it back from the offsite folder first). Restore
  needs the same `.env.pilot` the backup was made with.

- Try a restore once early on, so you know it works before you need it.

## Limits of this setup

- One machine: no failover. If the laptop is off, the pilot is off.
- Cloudflare quick tunnels are meant for testing: no uptime guarantee, random addresses, and
  limits on simultaneous requests. Fine for a small pilot; move to a named tunnel with a domain
  (or to the AWS setup in `infra/terraform`) when people depend on it daily.
- Backups are nightly: up to a day of records can be lost. There is no point-in-time recovery.
- Setup links prove identity only as well as the person who sends them. That is acceptable while
  everyone in the pilot is known personally; SMS sign-in returns when it is funded.
