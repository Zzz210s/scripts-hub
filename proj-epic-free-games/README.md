# Epic Free Games Claimer

Claim the Epic Games Store weekly free games unattended, notify the result over WeCom, and
fall back to a prefilled checkout link when hCaptcha blocks the automatic checkout.

[中文文档](README.zh-CN.md)

The claim engine is [vogler/free-games-claimer](https://github.com/vogler/free-games-claimer)
(AGPL-3.0), vendored byte-for-byte under `vendor/free-games-claimer/`. This project adds the
four things that project does not have:

1. **Probe before claiming** — the free-games list needs no login and never touches the purchase
   path, so the browser only starts when there is something not yet claimed. Running the probe a
   few times a day costs almost nothing.
2. **Local dedup state** — what was already claimed, how many attempts today, what was already
   notified; a game already claimed or already in the library is never touched again.
3. **WeCom notifications per the shared rules** — the same `wecom-core` sender as the other two
   projects, pinned byte-for-byte by `scripts/check-wecom-drift.mjs`.
4. **A degradation path** — if hCaptcha appears, push a prefilled checkout link instead of
   retrying into a wall. Epic's weekly freebie cannot be claimed after it expires, so retrying
   later is pointless.

## Background

- The batch changes **every Thursday at 11:00 ET**. Because of US daylight saving that is
  `15:00Z` in summer and `16:00Z` in winter — Beijing time is 23:00 Thursday in summer and 00:00
  Friday in winter. Nothing here hardcodes a Beijing time; the switch is derived from the
  `America/New_York` wall clock and verified against the API's own `startDate`/`endDate`.
- During the annual **Holiday Sale** (roughly Dec 10 – Jan 7) a new game appears every day and
  only stays free for 24 hours. `config/schedule.json` has an interval you can shorten for that
  window.
- The checkout step is protected by hCaptcha (`errors.com.epicgames.purchase.purchase.captcha.challenge`).
  That is why the fallback exists and why the upstream engine deliberately runs a visible browser.

## How it works

```
src/
  cli.js        command line: run / probe / status / link / login / auth / report / pause / resume
  run.js        one run: guards -> probe -> dedup -> notify start -> ensure session -> engine -> classify -> notify
  auth.js       ensure a live login: reuse the token, auto-refresh it, inject it, or ask for a login
  oauth.js      Epic OAuth endpoints and the device-code / refresh grants             (IO, injectable)
  tokens.js     secrets/epic-tokens.json: read/write, expiry checks, masking
  login.js      device-authorization login, with the browser profile as fallback
  inject.js     write EPIC_BEARER_TOKEN into the persistent profile for the engine
  probe.js      the only outbound HTTP call: fetch the free-games list and parse it
  promo.js      free/upcoming detection, store slug, prefilled checkout URL   (pure)
  clock.js      Eastern-time switch point and Holiday Sale window             (pure)
  state.js      claimed games, attempts today, notified-once keys, pruning
  classify.js   vendor lowdb status + stdout markers -> per-game verdicts     (pure)
  messages.js   the four message bodies                                       (pure)
  policy.js     which skip reasons stay silent, which need a human            (pure)
  guards.js     local-only guards: paused, attempts, peer, quiet hours, shutdown, memory (pure)
  notify.js     WeCom sender: wecom-core block + masking + webhook loading
  engine.js     run the vendored engine as a child process; read its lowdb result
  lock.js       single-instance lock and peer check
scripts/windows/  scheduled-task entry points (run-daily.bat/.vbs, run-state.js, installer)
test/             offline unit tests, no network, no browser
vendor/free-games-claimer/  the upstream engine, unmodified
```

A run is two stages. The first stage is purely local: paused, attempts used up, a peer running,
quiet hours, less than 30 minutes to the 02:00 shutdown, or too little free memory — any hit
returns without touching the network. The second stage fetches the free-games list (no login),
diffs it against the local state, and only then starts the browser engine.

## Requirements

- Node.js >= 20.11 (uses `import.meta.dirname` and the built-in test runner)
- An Epic Games account, logged in once through the device-authorization flow; no password is stored
  (the login state renews itself; see `docs/auth.md`)
- The engine's own dependencies for real runs: `patchright` and its Chromium build
  (`npm install` + `npx patchright install chromium`)
- A WeCom group-bot webhook (optional; without it nothing is pushed)
- A logged-in graphical desktop session (the engine forces a visible browser on purpose)

## Install

```bash
# 1. Engine dependencies (tests do not need them)
npm install
npx patchright install chromium

# 2. Persistent login: one device authorization, then it renews itself. No password is saved.
node src/cli.js login            # print a URL and a code; confirm in a browser once
node src/cli.js login --browser  # fallback: log in by hand in the opened browser
node src/cli.js auth             # show token expiry and validity

# 3. Optional: WeCom webhook
mkdir -p secrets
# secrets/wecom-webhook.txt   the group bot URL

# 4. Register the scheduled task (from the repository root)
node scripts/apply-schedule.mjs --apply --yes
```

`config/schedule.json` ships `epic-free-games.enabled: false`; turn it on after the manual login.

## Usage

```bash
node src/cli.js probe            # what is free now and what is coming, no login
node src/cli.js status           # local state and today's attempt count
node src/cli.js link 1           # prefilled checkout link for the first current game
node src/cli.js login            # device authorization; renews itself afterwards
node src/cli.js login --browser  # fallback: log in by hand in the opened browser
node src/cli.js auth             # token status and expiry
node src/cli.js run              # one run, honouring the guards
node src/cli.js run --dry-run    # print what would be sent, no network, no browser
node src/cli.js report           # print the state summary
node src/cli.js pause / resume   # pause / resume unattended runs
npm test                         # offline unit tests
```

## Persistent login

`node src/cli.js login` uses Epic's device-code flow: it prints a link and a short code, you
confirm once in any browser, and the program saves a long-lived `refresh_token` to
`secrets/epic-tokens.json` (gitignored). Every run then refreshes the access token, writes the
token back where Epic puts it (`EPIC_BEARER_TOKEN`) into the persistent profile, and starts the
engine already signed in. The token file is written with tight permissions and tokens are masked
in logs and notifications. The browser-profile login stays as a fallback via `login --browser`.

You only need to log in again if Epic revokes the refresh token — changed password, revoked
device, or the refresh window lapsed after a very long idle period (observed around 23 days).
`node src/cli.js auth` shows both expiry times. The research, sources and what is still unverified
live in `docs/auth.md`.

## Configuration

Environment variables, all optional:

| Variable | Default | Meaning |
| --- | --- | --- |
| `EPIC_DIR` | this directory | project root; only needed if the project is moved out of the repository |
| `EPIC_LOCALE` / `EPIC_COUNTRY` | `zh-CN` / `CN` | store locale and region used for the probe |
| `EPIC_MAX_ATTEMPTS` | `2` | real runs per day before further triggers go silent |
| `EPIC_ENGINE_TIMEOUT_MINUTES` | `30` | hard limit for one browser engine run; the process tree is killed after it |
| `EPIC_BUSY_PEERS` | empty | comma-separated lock files of peer programs; a lock written in the last 90 minutes makes this run yield |
| `EPIC_DRY_RUN` | `0` | same as `--dry-run` |
| `WECOM_WEBHOOK_FILE` | `secrets/wecom-webhook.txt` | where the group-bot webhook is read from |

## Notification policy

At most two messages per run: one `start` when a claim is about to happen, one `result` or
`action` at the end. Skips that need no human are logged only; skips that might cost today's
game are pushed once per reason per day. When hCaptcha or an expired login gets in the way, the
`action` message lists one prefilled checkout link per game. Wording rules live in
`docs/notification-convention.md`; the sender rules in `docs/wecom-rules.md`.

## Unattended runs (Windows)

`scripts/windows/run-daily.bat` is the entry point: single-instance lock, daily quota, memory
gate, then `node src/cli.js run`. It is launched hidden by `run-daily.vbs`. Registration goes
through `config/schedule.json` (see `scripts/windows/README-autostart.md` for the guards table).

## Testing

```bash
npm test          # node --test test/*.test.js
```

The suite is fully offline: the free-games API, the browser engine and the WeCom sender are all
injected, so no account, no network and no browser are needed. DST edges, byte-safe truncation
and retry/errcode handling are pinned by assertions.

## Known limitations

- The engine runs a **visible** browser window (upstream: headless triggers hCaptcha more often).
  A scheduled run will pop a window on the desktop.
- Automated checkout may violate the Epic Games terms of service and carries account risk.
- The device-code login still needs one human confirmation; it is not a password-less unattended bootstrap.
- hCaptcha can still block the checkout; that is a fallback case, not a bug.
- Region-locked games stay unclaimable; the project reports them instead of trying to route
  around the region.
- The Windows runner scripts are Windows-only.

## License and provenance

This directory is **AGPL-3.0-only** (`LICENSE`, `NOTICE`) because it vendors and derives from
`vogler/free-games-claimer` (AGPL-3.0). The upstream snapshot, with its commit, is recorded in
`VENDOR_COMMIT.txt` and `vendor/free-games-claimer/UPSTREAM.md`. The rest of this repository is
GPL-3.0; GPLv3 §13 allows the combination.
