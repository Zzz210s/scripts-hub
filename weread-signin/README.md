> **Generated snapshot — do not edit here.** This directory is published from the local
> development clone at `%WEREAD_DIR%` by `scripts/sync-weread-signin.sh`; the commit it
> was taken from is recorded in `SNAPSHOT.txt`. To change the code, edit and commit in
> that clone, then run the script and commit the result here. The program has no separate
> repository: this directory is its published copy. `LOCAL-DEPLOYMENT.md` is
> hand-written and exempt from the sync. The files in this directory are MIT-licensed
> (see `LICENSE`); the rest of this repository is GPL-3.0.

# WeRead Daily Sign-in

Automate the WeRead (微信读书) daily reading challenge and verify the counted minutes via the official read-only API.

[中文文档](README.zh-CN.md)

The reporting layer is reused from [funnyzak/weread-bot](https://github.com/funnyzak/weread-bot) (MIT); this project adds the three pieces it does not have:

1. **Read-back verification** — after a run, query the official API and check whether today's minutes actually grew, instead of trusting a "request succeeded" response.
2. **Progress planning** — derive how long to read today from remaining days and remaining minutes, then split it into sections no longer than 30 minutes.
3. **Unattended scheduling** — Windows Task Scheduler plus a single-instance lock, watchdog, quota guard and shutdown avoidance.

## Background

The web reading endpoint returns an empty JSON body, so it is impossible to tell whether a session was actually credited to the challenge. The official read-only API (`/readdata/detail`) returns per-day reading seconds:

```
before  official today = 30 seconds
after   official today = 352 seconds   # this session was 6m05s and was credited
```

The unit is seconds. The official `readDays` counter means "at least 1 minute on that day", which differs from the challenge rule of "at least 5 minutes" — so whether today qualifies must be decided from today's bucket in seconds.

## How it works

```
src/
  cli.js / index.js       command line: plan / run / status / verify / auth / report / pause / resume
  run.js                  one full run: read stats -> plan -> guards -> patch target -> call vendor -> read back
  guards.js / clock.js    local-only guards: quiet hours, shutdown avoidance, attempts, daily window
  plan.js                 daily target and section split
  peer.js                 yield to a peer process (e.g. another automation holding the lock)
  auth.js                 credential health check and rolling cookie renewal
  stats.js                official read-only stats (per-day seconds)
  notify.js               WeCom webhook push: masking, UTF-8 byte truncation, retry
  notify-policy.js        notification policy: plain-language reasons and per-day rate limiting
  welfare*.js / rewards*.js / balance.js / member-card.js / weekly.js
                          welfare coins, weekly reward tiers, wallet balance, trial cards
  app-*.js                optional App-channel credentials, reporting and login (QR scan)
  state.js / atomic.js    run state and history as JSON, atomically written
scripts/windows/          Task Scheduler entry points, single-instance lock, watchdog, installer
test/                     unit tests (node --test, no network)
tools/                    one-off read-only probes (DEX inspection, stats/time diagnostics)
```

Each run is two-stage. The first stage is purely local — paused, already done, attempts exhausted, peer running, quiet hours, less than 30 minutes to shutdown — and any hit returns without touching the network. The second stage performs the credential health check (renewing if needed), reads the official stats, then computes today's target and sections.

## Requirements

- Node.js >= 20.11 (uses `import.meta.dirname` and the built-in test runner)
- Python 3.9+ with the vendor dependencies (`requests`, `httpx`, `PyYAML`, `urllib3`, `croniter`, `apprise`) — needed by the bundled `weread-bot` reporting layer
- A WeRead account (web cookies) and an official read-only API key
- No npm dependencies; the Node side depends only on the standard library

## Install

```bash
# 1. Vendor base, pinned to the commit in VENDOR_COMMIT.txt
mkdir -p vendor && cd vendor
git clone https://github.com/funnyzak/weread-bot.git
cd weread-bot && git checkout 0cc9b5c309d1ede76b60f7fd453f6eb403b6307b
pip install -r requirements.txt
cd ../..

# 2. Credentials directory
mkdir -p secrets
# secrets/read-request.curl      full "Copy as cURL (bash)" of a https://weread.qq.com/web/book/read request
# secrets/weread-api-key.txt     official API key from https://weread.qq.com/r/weread-skills (wrk-...)
# secrets/wecom-webhook.txt      WeCom group bot webhook (optional; if absent nothing is pushed)
# secrets/app-credentials.json   App-channel credentials (needed for welfare coins):
#                                run `node src/app-login.js qr` then `node src/app-login.js wait`

# 3. Configuration
cp .env.example .env                 # challenge start/end dates and other parameters
cp config.yaml.example config.yaml   # target_duration is rewritten automatically by plan/run
```

`config.yaml` and `secrets/` are gitignored and never committed.

## Usage

```bash
node src/index.js plan            # how long to read today (compute only)
node src/index.js run             # run once (respects quiet hours and shutdown)
node src/index.js run --force     # run now, ignoring quiet hours
node src/index.js status          # today's state, recent history, official stats
node src/index.js verify          # official read-back only
node src/index.js report          # print and push the current summary
node src/index.js auth            # credential check (renews automatically when expired)
node src/index.js auth --force    # force renewal to push the server-side validity window
node src/index.js pause / resume  # pause / resume unattended runs
npm test                          # unit tests, no network required
```

## Configuration

`.env` holds the challenge window and reading parameters; `config.yaml` is the vendor base's configuration and is rewritten by `plan`/`run` as the challenge progresses. Common keys (see [.env.example](.env.example) for the full list):

| Key | Default | Meaning |
| --- | --- | --- |
| `CHALLENGE_START` / `CHALLENGE_ENDS_ON` | empty | challenge window; if unset, falls back to "30 days from today" and says so in the report |
| `REQUIRED_MINUTES` | 1800 | total minutes required by the challenge (30 hours) |
| `REQUIRED_VALID_DAYS` | 29 | number of valid days required |
| `MIN_VALID_MINUTES` | 5 | a day counts only when reading exceeds this |
| `SLACK_MINUTES` | 6 | margin for under-counting in the official stats |
| `DAILY_CAP_MINUTES` | 120 | daily cap to avoid over-long sessions not being credited |
| `SECTION_MINUTES` | 30 | maximum length of one section |
| `QUIET_START` / `QUIET_END` | 20:00 / 23:00 | hours in which real reading is not disturbed |
| `SHUTDOWN_TIME` / `SHUTDOWN_GUARD_MINUTES` | 02:00 / 30 | shutdown time and avoidance margin |
| `RUN_TIMEOUT_MINUTES` | 100 | maximum length of one session (aborted by the watchdog) |
| `MAX_ATTEMPTS_PER_DAY` | 3 | maximum attempts per day |

### How the two daily numbers are derived

- **Today's target** = `ceil(remaining minutes / remaining days) + 6` margin, clamped to 5-120 minutes; when the total is already met it reads only 5 minutes to keep the streak alive.
- The target is then capped by today's window (remaining runs × `RUN_TIMEOUT_MINUTES`, until quiet hours, until the shutdown guard). The shortfall is pushed to later days, never below the 5-minute valid-day floor.
- What is written to the vendor base is **this session** (target − already read today, capped at `RUN_TIMEOUT_MINUTES`), not the whole day.
- **Days you can still miss** is the smaller of a time allowance and a valid-day allowance; the challenge requires 29/30 valid days, so even on day one you can only miss one day.

### Login lifetime (rolling renewal)

Measured on 2026-10-01, `POST /web/login/renewal` returns:

| Cookie | Lifetime | Note |
| --- | --- | --- |
| `wr_skey` | 1.5 hours | short-lived, refreshed on every renewal |
| `wr_rt` / `wr_vid` / `wr_pf` | 360 days | long-lived, also rolled forward |

The vendor base renews once per session in memory; this project performs a credential health check before each run (`GET /web/user?userVid=…`), renews on failure, and pushes a "needs re-login" notice instead of wasting a day. If renewal returns new cookie values they are written back into `secrets/read-request.curl` atomically.

### Notification policy

- At most two messages per run: one at the start, one at the end.
- Skip notices for the same reason are sent once per day, and always answer what happened / why / what happens next.
- Cases requiring human action (invalid credentials, unreadable stats) are not rate-limited.
- `--dry` only previews the text; it does not send or consume the daily quota.

## Unattended runs (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
```

This registers the `WeReadSignIn` scheduled task: 3 minutes after logon (retried every 10 minutes for an hour) plus every 60 minutes for 14 hours from 08:00. Every trigger passes through the guards. See `scripts/windows/README-autostart.md` for details.

## Testing

```bash
npm test          # node --test test/*.test.js
```

The suite is 215 tests and runs without network access.

## Known limitations

- The unattended scheduler scripts are Windows-only (Task Scheduler, PowerShell, VBS).
- The project depends on undocumented endpoints; the vendor base and the official read-only API can change without notice.
- `report` and the welfare steps need the App-channel credentials; without them those steps are skipped rather than failing.
- Automated reading may violate the WeRead terms of service and carries account risk.

## Disclaimer

This project is provided for personal use and learning. Automated reading may violate the WeRead terms of service and put your account at risk. The defaults deliberately read in several short sections, only just past the threshold, and keep quiet hours. Use at your own discretion.

## License

MIT — see [LICENSE](LICENSE) for details. The reporting base [funnyzak/weread-bot](https://github.com/funnyzak/weread-bot) is MIT-licensed as well.
