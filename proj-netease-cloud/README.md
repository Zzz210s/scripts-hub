# NetEase Cloud Music daily check-in

English | [简体中文](README.zh-CN.md)

A minimal self-hosted check-in runner for NetEase Cloud Music. It completes the VIP sign-in and
reads the 云贝 numbers, for one account list, with WeCom notifications. Zero npm dependencies; the
only requests it makes are reads plus the sign-in call itself.

Read [Scope and risk](#scope-and-risk) before you deploy this. This is the one program in this
suite whose vendor terms explicitly forbid third-party clients.

## What it does

- Runs the VIP sign-in flow: one `task/sign` call, then reads the state back and only counts the day
  as done when the **business** field of that answer confirms it. The `checkin/history/detail` call
  that other clients make is not used: with a cookie-only request it answers HTTP 400, see `NOTICE`.
- Reads the 云贝 counters and renders them in the message. It does **not** claim 云贝.
- Sends a `start` message before a real run and a `result` message after it. Silent skips write to
  the run log only.
- Stops the day on auth or rate-limit responses: no retry, one request only, plus an `action`
  message telling you to refresh the cookie.

## Scope and risk

**Vendor terms.** The NetEase Cloud Music user agreement forbids third-party clients and
reverse engineering. Running this is a personal decision with a real, documented downside:
community projects of this shape have archived themselves with "do not keep using this", and their
issue trackers contain account bans and revoked musician accounts.

**What this program deliberately does not do** — none of it is implemented anywhere in this folder,
and there is no code path that could reach it:

- No listening/reporting (scrobble), no play-count upload.
- No comments, shares, follows, private messages, dynamic posts, MV actions.
- No musician / 云豆 / reward tasks, no 云贝 claim, no gift claiming.
- No login of any kind: no password, SMS or QR flow. Cookie only.

**What it does do**: read the sign state and the 云贝 counters, and call the VIP sign-in endpoint.
It stays serial, one request every three seconds or more, once per day per account.

**Where it runs.** The cookie is captured in a browser and then lives on the machine that runs it.
Changing the egress IP is itself a risk signal, so pick one location and keep it: the program does
not migrate, and it never uses a proxy.

## Architecture

```
config/schedule.json          when it runs · disabled by default until you verify on a real machine
scripts/linux/netease/        host-side runner, Dockerfile, container entrypoint
proj-netease-cloud/
  src/cli.js                  run / check / probe / report / help
  src/run.js                  one run: guards -> lock -> account probe -> sign -> read-back -> state -> notify
  src/crypto.js               weapi / eapi parameter encryption · all constants in one place
  src/verify.js               error classification matrix and baseline helpers
  src/*.js                    client, config, fields, pacing, vip, yunbei, guards, lock, state, messages
  src/notify.js               the shared wecom-core send block · one of the byte-identical copies
  test/*.test.js              offline tests · network, clock and send are all injected stubs
  scripts/windows/            lock-state and free-memory query entry · platform-agnostic · used by peer checks
```

## Requirements

- Node.js >= 20.11. Zero npm dependencies; the built-in test runner is enough.
- For a container deploy: Docker plus the suite compose file at `/srv/apps/automation`.

## Credentials

`.env` next to the program is the single source. Keys are read by `src/config.js`.

| Key | Required | Meaning |
| --- | --- | --- |
| `ACCOUNT_n_MUSIC_U` | yes | the `MUSIC_U` cookie value of account `n` |
| `ACCOUNT_n_NAME` | no | display name used in messages only · defaults to `账号 n` |

Log in at `music.163.com`, then copy the `MUSIC_U` cookie value from the browser. It is a full
login credential: treat it like a password. When it stops working the program reports auth failure
and asks you to refresh it; it never tries to log in by itself.

The webhook goes to `secrets/wecom-webhook.txt`, one line, mode 600. Without it the program still
runs, it just does not push.

## Configuration

All keys exist as environment variables too; an explicit variable overrides the matching `.env` key.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NETEASE_REQUEST_INTERVAL_MS` | `3000` | delay between requests · the flow's own floor is 3 seconds |
| `NETEASE_MAX_ATTEMPTS` | `3` | real runs per logical day |
| `NETEASE_QUIET_START` / `NETEASE_QUIET_END` | `20:00` / `23:00` | quiet hours · skipped without a push |
| `NETEASE_MIN_FREE_MB` | `800` | memory guard |
| `NETEASE_DAY_BOUNDARY_HOUR` | `4` | the logical day starts at 04:00, so a small-hours run counts for yesterday |
| `NETEASE_TIMEOUT_MS` | `10000` | per-request timeout |
| `NETEASE_WEBHOOK_FILE` | `secrets/wecom-webhook.txt` | WeCom channel |
| `NETEASE_STATE_DIR` / `NETEASE_LOCK_DIR` | `data` / `logs` | state and lock locations |
| `BUSY_PEERS` | empty | comma-separated peer lock files used for stagger checks |
| `NETEASE_DRY_RUN` | empty | `1` forces preview mode even for `report` |

## Deploy on the server

With the suite at `/srv/apps/automation`:

```
mkdir -p /srv/apps/automation/netease/{data,logs,secrets,deploy}
cp proj-netease-cloud/package.json        /srv/apps/automation/netease/package.json
cp -r proj-netease-cloud/src              /srv/apps/automation/netease/src
cp -r proj-netease-cloud/scripts          /srv/apps/automation/netease/scripts
cp scripts/linux/netease/deploy/run-once.sh /srv/apps/automation/netease/deploy/
cp scripts/linux/netease/Dockerfile       /srv/apps/automation/netease/Dockerfile

cd /srv/apps/automation/netease
docker build -f Dockerfile -t automation-netease:local .
```

Then place the credentials:

```
cat > /srv/apps/automation/netease/.env <<'EOF'
ACCOUNT_1_MUSIC_U=<MUSIC_U cookie value>
ACCOUNT_1_NAME=<account name>
EOF
chmod 600 /srv/apps/automation/netease/.env

printf '%s' '<your-wecom-webhook-url>' > /srv/apps/automation/netease/secrets/wecom-webhook.txt
chmod 600 /srv/apps/automation/netease/secrets/wecom-webhook.txt
```

The compose service is `netease-run` and its entrypoint passes arguments through to `src/cli.js`:

```
docker compose -f /srv/apps/automation/compose.yaml run --rm -T netease-run check
docker compose -f /srv/apps/automation/compose.yaml run --rm -T netease-run probe
```

`run-all.sh` calls `netease/run.sh` only when the schedule gate says the program is enabled. It is
disabled by default: verify with `check` and one `run` first, then set `enabled: true` for
`netease-cloud` in `config/schedule.json`.

## Verify

```
cd proj-netease-cloud
npm test                        # offline, no network and no subprocesses
node src/cli.js probe           # read-only: sign state, growth points and 云贝 counters · never signs
node src/cli.js check           # read-only health check for the deployment probe
node src/cli.js run --dry       # prints the messages it would send, sends nothing, writes nothing
node src/cli.js report --dry    # re-renders today's last result
```

`probe` exists for the first real-machine pass: it answers "which endpoints accept a cookie-only
request, and which fields carry the result" without changing any state. `run --dry` and
`NETEASE_DRY_RUN=1` do not go online and write no state; they still read `.env` and `data/state.json`.

From the repository root, `node scripts/check-wecom-drift.mjs` verifies the notification core is
byte-identical to the other five copies.

## Logs and state

| Path | Content |
| --- | --- |
| `logs/last-run.log` | host-side output of the last run · previous one in `logs/previous-run.log` |
| `logs/runner.log` | host runner bookkeeping · exit codes and watchdog notes |
| `logs/run.lock` | single-instance lock · the suite convention path peers look for |
| `data/state.json` | per-day completion, attempt counts, circuit-break flag, baseline |
| `data/history.jsonl` | one JSON line per run · the source for `report` |

## Messages

Titles follow the four-segment convention `<program> · <account or account count> · <date> · <action>`,
with `网易云音乐签到` as the program name. `done-today`, `peer-running` and `quiet-hours` skips are
silent; the remaining skip reasons push an `action` message because leaving them alone would mean
the program never runs. The send layer is governed by [../docs/wecom-rules.md](../docs/wecom-rules.md).

## Rollback

Remove the `netease-run` service from `scripts/linux/compose.yaml`, delete the `netease/run.sh` call
from `scripts/linux/run-all.sh`, and set `enabled: false` for `netease-cloud` in
`config/schedule.json`. `data/`, `logs/` and `secrets/` stay on the host.

## License

GPL-3.0-only, matching the rest of the repository. The implementation is written from scratch; no
third-party code was copied. The protocol facts it relies on, and the ones that still need a
real-machine check, are listed in `NOTICE`.
