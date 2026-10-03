# home-automation-configs

**English** | [简体中文](README.zh-CN.md)

Configuration, scheduling scripts, and machine-migration notes for three Windows automation programs: Microsoft Rewards, Zhihuishu course playback, and WeRead check-in.

This repository is **not runnable software**. The programs themselves come from upstream projects and live in their own directories; what is here is their configuration for one machine, the unattended-run scripts, the WeCom notification layer, and a "how to restore this on a new machine" guide. Everything is sanitized: no real credentials are stored here.

## Table of Contents

- [What is in here](#what-is-in-here)
- [The three programs](#the-three-programs)
- [Path convention](#path-convention)
- [Layout](#layout)
- [Shared conventions](#shared-conventions)
- [Restoring on a new machine](#restoring-on-a-new-machine)
- [Credentials](#credentials)
- [License and provenance](#license-and-provenance)

## What is in here

| Content | Location | Nature |
| --- | --- | --- |
| Runner scripts: guards, single-instance lock, watchdog, memory gate, shutdown task, task registration | `microsoft-rewards/scripts-windows/` | Original to this repo, usable as-is |
| WeCom notification layer: start / end / skip / action-needed, plus low-score attribution and result layout | `microsoft-rewards/wechat-bridge/` | Original to this repo |
| Microsoft Rewards configuration | `microsoft-rewards/config.json`, `microsoft-rewards/env.example` | Actual config + upstream template |
| Patch archive for the upstream source (apply in order after upgrading upstream) | `microsoft-rewards/patches/` | Original to this repo |
| Zhihuishu configuration (course URLs, **no account or password**) | `autovisor/configs.ini` | Upstream template with local values |
| WeRead check-in: local deployment notes | `weread-signin/README.md` | Original to this repo (the program lives in another repo) |
| Scheduled-task inventory, staggering and notification conventions | `tasks/` | Original to this repo |
| Credentials checklist (where to get each value, never the value) | `secrets/README.md` | Original to this repo |

## The three programs

| Program | What it does | Program itself | Config in this repo |
| --- | --- | --- | --- |
| **Microsoft Rewards** | Runs the daily Microsoft Rewards tasks (searches, activities, read-to-earn) and pushes the points result to WeCom | Upstream [`TheNetsky/Microsoft-Rewards-Script`](https://github.com/TheNetsky/Microsoft-Rewards-Script) v4.3.2 plus this repo's patches, installed at `%REWARDS_DIR%` | `microsoft-rewards/` |
| **Zhihuishu playback** | Autovisor: plays Zhihuishu / Zhida course videos automatically | Upstream [`CXRunfree/Autovisor`](https://github.com/CXRunfree/Autovisor) v3.17.3, installed at `%AUTOVISOR_DIR%` | `autovisor/` |
| **WeRead check-in** | Completes the WeRead daily reading challenge (reads the minutes the day requires), then verifies the counted minutes through the official read-only API | [`Zzz210s/weread-signin`](https://github.com/Zzz210s/weread-signin), built on [`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot), checked out at `%WEREAD_DIR%` | `weread-signin/` |

One scheduled task is not a program: `AutoShutdown0200` powers the machine off unconditionally at 02:00 every day (script at `microsoft-rewards/scripts-windows/auto-shutdown.bat`). Each program registers its own task through its own installer script.

## Path convention

The docs use three placeholders for the program install directories. **Replace them with your own paths**; the repository hard-codes no drive letter.

| Placeholder | Meaning |
| --- | --- |
| `%REWARDS_DIR%` | Root of the Microsoft Rewards program (where the upstream release was unpacked) |
| `%AUTOVISOR_DIR%` | Autovisor install directory (it contains `app\`) |
| `%WEREAD_DIR%` | The `Zzz210s/weread-signin` checkout |

Every Microsoft Rewards runner script in this repo resolves paths relative to itself through `%~dp0`, so a whole directory can be moved anywhere without edits.

## Layout

```
microsoft-rewards/    Microsoft Rewards: config.json snapshot, env.example, runner scripts, patch archive, WeCom bridge
autovisor/            Zhihuishu: configs.ini (course URLs, no credentials)
weread-signin/        WeRead: local deployment notes only (program and config templates live in Zzz210s/weread-signin)
tasks/                Scheduled-task inventory plus the staggering / notification / guard conventions
secrets/              Which value goes where and where to get it (instructions only, never values)
```

## Shared conventions

- **Credentials never enter git**: `.env`, cookies, webhooks and API keys stay in each program's own directory; only templates and instructions are here (`.gitignore` excludes the rest).
- **One scheduling shape**: Windows Task Scheduler + a hidden launcher (`wscript` calling a `.vbs`) + a single-instance lock at `logs/run.lock` + a once-per-day guard + retries on failure + a watchdog that kills a stalled run.
- **Staggering**: each program owns a 30-minute slot and staggers its logon delay by 7 minutes; before running it checks the peers' lock files and skips if any peer is running (see `tasks/scheduling-convention.md`).
- **One notification channel**: a WeCom group robot webhook.
- **One place for runtime data**: state and logs go to `logs/`, `data/` and `sessions/` inside each program directory, never into git.

## Restoring on a new machine

This repository doubles as a restore kit. The order that worked:

1. Clone this repository
2. Install the programs themselves: unpack the upstream release into `%REWARDS_DIR%`; unpack Autovisor into `%AUTOVISOR_DIR%`; clone `Zzz210s/weread-signin` into `%WEREAD_DIR%`
3. Copy this repo's templates and scripts into the program directories: for Microsoft Rewards that is `config.json`, `scripts-windows/`, `wechat-bridge/` and `patches/` from `microsoft-rewards/` (apply the patches in order after upgrading upstream)
4. Fill in the real credentials following `secrets/README.md`
5. Register the scheduled tasks: `%REWARDS_DIR%\scripts\windows\install-autostart.bat` for Microsoft Rewards, and `scripts\windows\install-autostart.ps1` from the authoritative WeRead repo
6. Verify task state with the commands in `tasks/inventory.md`

## Credentials

See `secrets/README.md`: it lists, file by file, what has to be filled in and where to get it. **No real value is stored here** — you can verify that against history: no `.env`, cookie or webhook file has ever been committed.

## License and provenance

The repository as a whole is licensed under **GPL-3.0** (see `LICENSE`). The reason: parts of what it redistributes are derivative works of GPL-3.0 upstream material — the Microsoft Rewards patches are diffs against the upstream TypeScript source, `env.example` is the upstream file verbatim, and `config.json` is adapted from the upstream config. Using GPL-3.0 across the whole repository keeps it consistent with that upstream and avoids a license conflict. The remaining files (runner scripts, notification layer, documentation) ship under GPL-3.0 as well.

Upstream sources and their licenses:

| Path in this repo | Origin | License |
| --- | --- | --- |
| `microsoft-rewards/patches/*.patch` | Patches against the [`TheNetsky/Microsoft-Rewards-Script`](https://github.com/TheNetsky/Microsoft-Rewards-Script) v4.3.2 source | GPL-3.0 |
| `microsoft-rewards/env.example` | Upstream file, kept verbatim | GPL-3.0 |
| `microsoft-rewards/config.json` | Adapted from the upstream config example | GPL-3.0 |
| `microsoft-rewards/scripts-windows/`, `microsoft-rewards/wechat-bridge/` | Original to this repository (not from upstream) | GPL-3.0 |
| `autovisor/configs.ini` | Configuration template from [`CXRunfree/Autovisor`](https://github.com/CXRunfree/Autovisor) with local values filled in | MIT |
| `weread-signin/README.md` | Original to this repository; the program and its config templates come from [`Zzz210s/weread-signin`](https://github.com/Zzz210s/weread-signin), whose base is [`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot) | This file GPL-3.0; both of those codebases are MIT |
| `tasks/`, `secrets/README.md`, both READMEs | Original to this repository | GPL-3.0 |

MIT-licensed material is compatible with GPL-3.0 and may be redistributed under it; the files marked MIT above keep their original terms.
