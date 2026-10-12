# Baidu Tieba daily sign-in

English | [简体中文](README.zh-CN.md)

A multi-account daily sign-in runner for Baidu Tieba. It signs every forum the account already
follows, then reads the followed-forum list back and checks that every forum really shows as
signed today. Zero npm dependencies; the only network traffic is the sign-in protocol itself.

## What it does

- Reads the followed-forum list for each configured account and signs every forum in it.
- Verifies the result by reading the list back: a forum counts as done only when the API reports
  `is_sign` for it. A run is marked complete for the day only when this read-back agrees.
- Optionally narrows the run to a whitelist of forums with `TIEBA_FORUMS`.
- Sends at most a `start` message before a real run and a `result` message after it. A silent skip
  writes only to the run log.
- Keeps accounts serial. Each account carries a unique id, so two accounts with the same display
  name can never be mixed up.

## Scope and risk

The program performs exactly two kinds of request against Tieba:

- **Reads**: fetch `tbs` and the followed-forum list.
- **One write**: the sign-in call `POST c.tieba.baidu.com/c/c/forum/sign`.

It never posts, replies, follows or unfollows, likes, sends messages, or spends anything. Those
actions are not implemented anywhere in this folder; there is no code path that could reach them.
The sign-in call itself is the only state-changing request, and it is idempotent per forum per day.

Community scripts of this shape have no documented ban record for the sign-in call alone. That is
not a guarantee, and it is not a reason to widen the boundary: this project stays read-and-sign
only. If you want a broader Tieba bot, build it as a separate program so this boundary stays
auditable.

## Architecture

```
config/schedule.json        when it runs · default disabled until you verify on a real machine
scripts/linux/tieba/        host-side runner, Dockerfile, container entrypoint
proj-baidu-tieba/
  src/cli.js                run / check / report / help
  src/run.js                one run: guards -> lock -> per-account sign -> read-back -> state -> notify
  src/*.js                  pure modules: client, sign, verify, guards, lock, state, messages, notify
  src/notify.js             the shared wecom-core send block · one of the byte-identical copies
  test/*.test.js            offline tests · network, clock and send are all injected stubs
  scripts/windows/          lock-state and free-memory query entry · platform-agnostic · used by peer checks
```

- The runner owns: guards, single-instance lock, per-account signing, read-back reconciliation,
  local state, and notifications.
- All network, clock, memory, peer and send dependencies are injected from `deps`, so the whole
  run can be exercised offline.

## Requirements

- Node.js >= 20.11. The runner has zero npm dependencies and uses the built-in test runner.
- For a container deploy: Docker plus the suite compose file at `/srv/apps/automation`.

## Credentials

Everything lives in `.env` next to the program. Keys are read by `src/config.js`.

| Key | Required | Meaning |
| --- | --- | --- |
| `ACCOUNT_n_BDUSS` | yes | the `BDUSS` cookie value of account `n` |
| `ACCOUNT_n_STOKEN` | no | the `STOKEN` cookie value; added to the cookie string when present |
| `ACCOUNT_n_NAME` | no | display name used in messages only · defaults to `账号 n` |

Grab `BDUSS` from your browser after logging into `tieba.baidu.com`: open the site cookies and copy
the value of the `BDUSS` entry. Treat it like a password; it is a full login credential. It expires,
and when every account has expired the program pushes a `需要你处理` message asking you to refresh it.

The webhook address goes to `secrets/wecom-webhook.txt`, one line, mode 600. The program runs fine
without it; it just does not push anything.

## Configuration

All keys are environment variables and override the same key in `.env`. Common ones:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TIEBA_FORUMS` | empty | comma-separated forum whitelist; empty means every followed forum |
| `TIEBA_INTERVAL_MS` | `2000` | delay between accounts, keeps the request rate low |
| `TIEBA_MAX_ATTEMPTS` | `3` | real runs per logical day |
| `TIEBA_QUIET_START` / `TIEBA_QUIET_END` | `20:00` / `23:00` | quiet hours · skipped without a push |
| `TIEBA_MIN_FREE_MB` | `800` | memory guard |
| `TIEBA_DAY_BOUNDARY_HOUR` | `4` | the logical day starts at 04:00, so a small-hours run counts for yesterday |
| `TIEBA_WEBHOOK_FILE` | `secrets/wecom-webhook.txt` | WeCom channel |
| `TIEBA_STATE_DIR` / `TIEBA_LOCK_DIR` | `data` / `logs` | state and lock locations |
| `BUSY_PEERS` | empty | comma-separated peer lock files used for stagger checks |
| `TIEBA_DRY_RUN` | empty | `1` forces preview mode even for `report` |

## Deploy on the server

With the suite at `/srv/apps/automation`:

```
mkdir -p /srv/apps/automation/tieba/{data,logs,secrets,deploy}
cp proj-baidu-tieba/package.json      /srv/apps/automation/tieba/package.json
cp -r proj-baidu-tieba/src            /srv/apps/automation/tieba/src
cp -r proj-baidu-tieba/scripts        /srv/apps/automation/tieba/scripts
cp scripts/linux/tieba/deploy/run-once.sh /srv/apps/automation/tieba/deploy/
cp scripts/linux/tieba/Dockerfile     /srv/apps/automation/tieba/Dockerfile

cd /srv/apps/automation/tieba
docker build -f Dockerfile -t automation-tieba:local .
```

Then place the credentials:

```
cat > /srv/apps/automation/tieba/.env <<'EOF'
ACCOUNT_1_BDUSS=<account 1 BDUSS>
ACCOUNT_1_NAME=<account 1 name>
EOF
chmod 600 /srv/apps/automation/tieba/.env

printf '%s' '<your-wecom-webhook-url>' > /srv/apps/automation/tieba/secrets/wecom-webhook.txt
chmod 600 /srv/apps/automation/tieba/secrets/wecom-webhook.txt
```

The compose service is `tieba-run`. The container entrypoint passes its arguments through to
`src/cli.js`, so any subcommand is written directly after the service name:

```
docker compose -f /srv/apps/automation/compose.yaml run --rm -T tieba-run check
docker compose -f /srv/apps/automation/compose.yaml run --rm -T tieba-run report
```

`run-all.sh` calls `tieba/run.sh` only when the schedule gate says the program is enabled. The
program is disabled by default: verify with `check` and a single `run` first, then set
`enabled: true` for `baidu-tieba` in `config/schedule.json`. On Linux the suite reads
`linuxEnabled`, which falls back to `enabled` when absent.

## Verify

```
cd proj-baidu-tieba
npm test                       # offline, no network and no subprocesses
node src/cli.js check          # read-only: tbs, followed-forum count, already-signed count, reconciliation
node src/cli.js run --dry      # prints the messages it would send, sends nothing, writes nothing
node src/cli.js report --dry   # re-renders today's last result
```

`check` exits 1 when an account cannot fetch `tbs` or the followed-forum list, so a deployment probe can gate on it.
`run --dry` and `TIEBA_DRY_RUN=1` do not go online and write no state; they still read `.env` and `data/state.json`.

From the repository root, `node scripts/check-wecom-drift.mjs` verifies the notification core is
byte-identical to the other four copies.

## Logs and state

| Path | Content |
| --- | --- |
| `logs/last-run.log` | host-side output of the last run · previous one in `logs/previous-run.log` |
| `logs/runner.log` | host runner bookkeeping · exit codes and watchdog notes |
| `logs/run.lock` | single-instance lock · the suite convention path peers look for |
| `data/state.json` | per-day completion, attempt counts, pause flag |
| `data/history.jsonl` | one JSON line per run · the source for `report` |

## Messages

Titles follow the four-segment convention `<program> · <account or account count> · <date> · <action>`,
with `百度贴吧签到` as the program name. `start` goes out before a real run and `result` after it.
`done-today`, `peer-running` and `quiet-hours` skips are silent; the remaining skip reasons push an
`action` message because leaving them alone would mean the program never runs. The send layer is
governed by [../docs/wecom-rules.md](../docs/wecom-rules.md).

## Rollback

Remove the `tieba-run` service from `scripts/linux/compose.yaml`, delete the `tieba/run.sh` call
from `scripts/linux/run-all.sh`, and set `enabled: false` for `baidu-tieba` in
`config/schedule.json`. `data/`, `logs/` and `secrets/` stay on the host, so re-enabling does not
require another setup step.

## License

GPL-3.0-only, matching the rest of the repository. The implementation is written from scratch; no
third-party code was copied. The protocol facts it relies on and their sources are listed in
`NOTICE`.
