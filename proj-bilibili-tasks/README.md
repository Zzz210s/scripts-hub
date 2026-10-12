# Bilibili daily tasks

English | [简体中文](README.zh-CN.md)

An unattended runner for the Bilibili daily-experience tasks, wrapped in a thin Node shell around
the upstream [BiliBiliToolPro](https://github.com/RayWangQvQ/BiliBiliToolPro) console, with
WeCom notifications and the same guard chain as the other programs in this repository.

## What it does

- Runs the daily experience tasks: login, watch, share, and coin donation capped at 5 coins per day.
- Claims the annual-VIP B-coin voucher from the thin shell: checks the state first, receives only
  when it should, verifies the result, and folds it into the result notification.
- Also runs the purely additive tasks: VIP big points, manga check-in, and manga reading coupons.
- Never performs consuming or destructive actions. The tasks that spend coins, spend silver
  shells, mass-unfollow, send live danmaku, or change follow groups are explicitly disabled.
- One notification per run: `start` before the run and `result` after it; a `skip` writes only to
  the run log.

Everything else in this folder is documented in the repository conventions, not here.

## Architecture

```
config/schedule.json        when it runs (default disabled until you log in)
scripts/linux/bilibili/     host-side runner, Dockerfile, container entrypoint
proj-bilibili-tasks/
  src/cli.js                run / login / status / cookies / check / pause / resume
  src/run.js                one run: guards -> voucher -> console -> classify -> notify -> state
  src/*.js                  pure modules (member, voucher, donate, classify, messages, guards, ...)
  src/notify.js             the shared wecom-core send block (4th copy, drift-checked)
  test/*.test.js            offline tests; network and subprocesses are stubbed
  scripts/windows/          standby Windows runner
```

- The thin shell owns: guards, the voucher flow, coin policy, exit-code/stdout classification,
  notifications, and local state.
- The upstream console owns: the actual Bilibili API calls for the enabled tasks. It is invoked as a
  subprocess with a fixed task list and an explicit enable/disable matrix for every task.
- The upstream source is not vendored here. The image build pulls exactly the commit recorded in
  `VENDOR_COMMIT.txt` and `scripts/linux/bilibili/Dockerfile`.

## Requirements

- Node.js >= 20.11 for the shell (zero npm dependencies; the built-in test runner is used).
- .NET 10 runtime inside the container image for the upstream console.
- Network access at image build time to fetch the upstream source and the base images.

## Deploy

On the server, with the suite at `/srv/apps/automation`:

```
mkdir -p /srv/apps/automation/bilibili/{data,logs,logs/console,secrets,deploy}
cp -r proj-bilibili-tasks/src            /srv/apps/automation/bilibili/src
cp scripts/linux/bilibili/deploy/run-once.sh /srv/apps/automation/bilibili/deploy/
cp scripts/linux/bilibili/Dockerfile     /srv/apps/automation/bilibili/Dockerfile

cd /srv/apps/automation/bilibili
docker build -f Dockerfile -t automation-bilibili:local .
```

Then put the credentials in place and run the QR-code login once:

```
printf '%s' '<your-wecom-webhook-url>' > /srv/apps/automation/bilibili/secrets/wecom-webhook.txt
chmod 600 /srv/apps/automation/bilibili/secrets/wecom-webhook.txt

docker compose -f /srv/apps/automation/compose.yaml run --rm -T bilibili-run login
```

The console prints a QR-code block and a `https://tool.lu/qrcode/basic.html?text=...` link. Open that
link and scan it with the mobile Bilibili app. The upstream polls 10 times with roughly 20 seconds
between polls, so you have about 3 minutes (measured on the server, 2026-10-11); re-run the command
if it times out. The login result is written to
`secrets/cookies.json`; `node src/cli.js check` then prints the membership tier, coin balance, and
voucher state.

Once `cookies.json` exists, the container reports into the suite queue. `run-all.sh` calls the
runner on every trigger; the program exits silently the first time with `no-credentials` if you have
not logged in yet, and after a successful run the `done-today` guard skips the second trigger.

Windows is a standby entry point only: enable `bilibili-tasks` in `config/schedule.json` and run
`node scripts/apply-schedule.mjs --apply --yes`.

## Configuration

All keys are environment variables and are read by `src/config.js`. A run needs no configuration
beyond the credentials file. The most useful keys:

| Variable | Default | Meaning |
| --- | --- | --- |
| `BILIBILI_COOKIES_FILE` | `<root>/secrets/cookies.json` | login result |
| `BILIBILI_WEBHOOK_FILE` | `<root>/secrets/wecom-webhook.txt` | WeCom channel |
| `BILIBILI_COIN_KEEP` | `20` | coins to keep; donation stops at or below this balance |
| `BILIBILI_COIN_MAX` | `5` | maximum coins donated per day |
| `BILIBILI_MAX_ATTEMPTS` | `2` | real runs per day |
| `BILIBILI_CONSOLE_TIMEOUT_MINUTES` | `20` | thin-shell timeout for the console subprocess |
| `BILIBILI_FREE_MEM_MB` | `800` | memory guard |
| `BILIBILI_BUSY_PEERS` | empty | comma-separated peer lock files |

The upstream task matrix is built in `src/console-runner.js`: only `Daily`, `VipBigPoint`, `Manga`,
and `MangaPrivilege` are enabled, and every other task is explicitly disabled with
`Ray_*TaskConfig__IsEnable=false`.

## Verify

```
cd proj-bilibili-tasks
npm test                       # offline, no network and no subprocesses
node src/cli.js run --dry-run  # prints the messages it would send
node src/cli.js status         # local state
node src/cli.js cookies        # account ids only, never the cookie value
```

From the repository root: `bash scripts/setup-bilibili-tasks.sh` runs the offline self-check, and
`node scripts/check-wecom-drift.mjs` verifies the notification core is byte-identical to the other
three copies.

## Diagnostics

| Path | Content |
| --- | --- |
| `logs/last-run.log` | host-side output of the last run (previous one in `previous-run.log`) |
| `logs/console/log<date>.txt` | the upstream Console's own Verbose log |

`logs/console` is mounted onto the container's `/app/Logs` (the Serilog File sink of the upstream
console, `rollingInterval: Day`), so it outlives the one-shot container. The host runner prunes
files older than 30 days. When a task silently did nothing, read this log first: the upstream
`CookieTaskGuard` used to abort a whole run on a 15-second nav timeout while still exiting 0, so
the thin shell now sets `Ray_CookieCheck__AutoCheckEnabled=false` and also classifies that abort as
`guard-skipped` instead of success.

## Known upstream issues

| Symptom | Cause | Our handling |
| --- | --- | --- |
| `VipBigPoint` claim fails with `6007000 请将客户端更新至最新版本` | open upstream issue [#1195](https://github.com/RayWangQvQ/BiliBiliToolPro/issues/1195), not fixed as of 4.2.0 | tolerated as a known issue: it never flips the run to failed, and the message references the issue id |
| The watch/share flow fails with `HttpClient.Timeout of 30 seconds` (share experience not earned) | the upstream default `Security.IntervalSecondsBetweenRequestApi=20` sleeps 10-20s before **every** GET/POST, and that delay counts against the 30s HttpClient timeout; reported upstream as [#1141](https://github.com/RayWangQvQ/BiliBiliToolPro/issues/1141) | the thin shell pins the interval to 5s (`Ray_Security__IntervalSecondsBetweenRequestApi`), leaving a 4x margin; measured latency to `api.bilibili.com` is 0.12-0.16s, so the delay was the problem, not the network |

## Rollback

Remove the `bilibili-run` service from `scripts/linux/compose.yaml`, delete the `bilibili/run.sh`
call from `scripts/linux/run-all.sh`, and set `enabled: false` in `config/schedule.json`. The
`data/` and `secrets/` directories stay on the host, so re-enabling does not require another login.

## License

GPL-3.0-only. The image is built from the upstream project at the fixed commit recorded in
`VENDOR_COMMIT.txt`; see `NOTICE` for the upstream source, the license, and what this project
changed. The image is used privately and is not distributed.
