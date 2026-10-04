# scripts-hub

**English** | [简体中文](README.zh-CN.md)

One public repository holding the scripts, configuration, deployment wizards and
machine-migration notes for three Windows automation programs: Microsoft Rewards,
Zhihuishu course playback, and WeRead check-in — one folder per project.

The remote repository is `Zzz210s/scripts-hub`; the local clone on this machine keeps the
older directory name `home-automation-configs` (so local paths in the reports still use it).

The programs themselves come from upstream projects and are installed separately; what
lives here is their configuration for one machine, the unattended-run layer, the WeCom
notification layer, the deployment/sync scripts, and the "how to restore this on a new
machine" guide. It is **not** a package you install and run. Everything is sanitized:
no real credentials.

There is one shared component, `wecom-notify/`: a standalone CLI and library for WeCom
group-robot notifications (zero dependencies), reusable from any script. Microsoft Rewards
and WeRead each currently embed their own thinner sender; the relationship is described
under [License and provenance](#license-and-provenance).

`docs/automation-overview.md` is the index — what each program is, where its code lives,
which machine it runs on, how it is scheduled and notified.

## Table of Contents

- [Repository layout](#repository-layout)
- [The three programs](#the-three-programs)
- [Deployment and maintenance scripts](#deployment-and-maintenance-scripts)
- [Path convention](#path-convention)
- [WeRead code](#weread-code)
- [Shared conventions](#shared-conventions)
- [Restoring on a new machine](#restoring-on-a-new-machine)
- [Credentials](#credentials)
- [License and provenance](#license-and-provenance)

## Repository layout

| Path | What it is |
| --- | --- |
| `docs/` | Cross-cutting notes: automation overview and index, why a cloud VM, the cloud scheduling convention, the notification convention |
| `scripts/` | Deployment / provisioning wizards (Oracle Cloud, public reset, WeRead code sync) |
| `microsoft-rewards/` | Config snapshot, Windows runner scripts, WeCom bridge, patch archive for the upstream source |
| `autovisor/` | Zhihuishu configuration (course URLs, **no account or password**) |
| `weread-signin/` | The complete WeRead program code (see [below](#weread-code)) |
| `wecom-notify/` | Standalone WeCom group-robot notification CLI + library (zero dependencies), reusable by any script |
| `patches/` | Archived patches kept for provenance only (not applied by this repo): currently the weread-bot upstream PR #53 diff and the fork notes |
| `tasks/` | Windows scheduled-task inventory plus the local staggering / notification / guard conventions |
| `secrets/README.md` | Credentials checklist: which value goes where and where to get it, never the value |

## The three programs

| Program | What it does | Program itself | Config in this repo |
| --- | --- | --- | --- |
| **Microsoft Rewards** | Runs the daily Microsoft Rewards tasks (searches, activities, read-to-earn) and pushes the points result to WeCom | Upstream [`TheNetsky/Microsoft-Rewards-Script`](https://github.com/TheNetsky/Microsoft-Rewards-Script) v4.3.2 plus this repo's patches, installed at `%REWARDS_DIR%` | `microsoft-rewards/` |
| **Zhihuishu playback** | Autovisor: plays Zhihuishu / Zhida course videos automatically | Upstream [`CXRunfree/Autovisor`](https://github.com/CXRunfree/Autovisor) v3.17.3, installed at `%AUTOVISOR_DIR%` | `autovisor/` |
| **WeRead check-in** | Completes the WeRead daily reading challenge (reads the minutes the day requires), then verifies the counted minutes through the official read-only API | Built on [`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot); the code itself lives in this repository at `weread-signin/`, developed in the local clone at `%WEREAD_DIR%` | `weread-signin/` (the code itself) |

One scheduled task is not a program: `AutoShutdown0200` powers the machine off
unconditionally at 02:00 every day (script at
`microsoft-rewards/scripts-windows/auto-shutdown.bat`). Each program registers its own
task through its own installer script.

## Deployment and maintenance scripts

| Script | What it does |
| --- | --- |
| `scripts/oracle-setup-wizard.sh` | Interactive wizard to register and provision the Oracle Cloud Always Free ARM VM, open both firewall layers, write SSH config and verify connectivity |
| `scripts/public-reset-wizard.sh` | Deletes `home-automation-configs` and recreates it under the name `scripts-hub` as a clean public repository (old objects really disappear only this way), then re-verifies the pushed history |
| `scripts/sync-weread-signin.sh` | Publishes `weread-signin/` from the local development clone, copying `git ls-files` only (`--dry-run` available) |

Machine-specific paths are never hard-coded. The scripts read
`~/.config/automation-suite/local-paths.env` (outside this repository, never committed)
and accept environment overrides (`WEREAD_SIGNIN_DIR`, `HOME_AUTOMATION_CONFIGS_DIR`, …).

`automation-suite` is a legacy local directory name (`~/.config/automation-suite/`,
`~/.local/state/automation-suite/`); it predates this repository and is unrelated to the
Git repository of the same name, which has been deleted.

## Path convention

The docs use three placeholders for the program install directories. **Replace them with
your own paths**; the repository hard-codes no drive letter.

| Placeholder | Meaning |
| --- | --- |
| `%REWARDS_DIR%` | Root of the Microsoft Rewards program (where the upstream release was unpacked) |
| `%AUTOVISOR_DIR%` | Autovisor install directory (it contains `app\`) |
| `%WEREAD_DIR%` | The WeRead development clone (a plain local git repository; its tracked files are what `scripts/sync-weread-signin.sh` publishes into `weread-signin/`) |

Every Microsoft Rewards runner script resolves paths relative to itself through `%~dp0`,
so a whole directory can be moved anywhere without edits.

## WeRead code

The WeRead code lives in `weread-signin/` in this repository — there is no separate
repository for it. Development happens in a local clone at `%WEREAD_DIR%` (a plain local
git repository with no remote); `scripts/sync-weread-signin.sh` publishes its tracked
files into `weread-signin/`.

- **Published source**: `weread-signin/` in this repository. The former standalone
  `Zzz210s/weread-signin` repository has been deleted, so this directory is the only copy
  that ships with the project.
- **Local development**: edit and commit in the clone at `%WEREAD_DIR%`. When you are done,
  run `bash scripts/sync-weread-signin.sh`, review `git status` here, and commit — that
  commit is what publishes the change.
- **This folder is generated** from the tracked files of that clone; the source commit is
  recorded in `weread-signin/SNAPSHOT.txt`.
- **How it is kept in sync**: `bash scripts/sync-weread-signin.sh` copies `git ls-files`
  from the development clone and rewrites the snapshot banner at the top of
  `weread-signin/README.md` and `README.zh-CN.md`. Do not edit files here directly —
  the next sync overwrites them.
- `weread-signin/LOCAL-DEPLOYMENT.md` is hand-written in this repository (machine-specific
  run notes) and is exempt from the sync.
- **Upstream contribution channel (an intentional fork)**: `Zzz210s/weread-bot` is a fork of
  the [base `funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot) and is **not in scope
  for this repository's merge**. Its `fix/cookie-persist-after-renewal` branch is the head of
  open PR [#53](https://github.com/funnyzak/weread-bot/pull/53); deleting or transferring the
  fork would invalidate that PR, so do not delete it. The patch and status notes are archived
  in `patches/weread-bot/`.

## Shared conventions

- **Credentials never enter git**: `.env`, cookies, webhooks and API keys stay in each
  program's own directory; only templates and instructions are here (`.gitignore`
  excludes the rest).
- **One scheduling shape**: Windows Task Scheduler + a hidden launcher (`wscript` calling
  a `.vbs`) + a single-instance lock + a once-per-day guard + retries on failure + a
  watchdog that kills a stalled run. The cloud version uses systemd timers instead
  (`docs/cloud-scheduling-convention.md`).
- **Staggering**: each program owns a 30-minute slot and shifts its logon delay by 7
  minutes; before running it checks the peers' lock files and skips if any peer is
  running (see `tasks/scheduling-convention.md`).
- **One notification channel**: a WeCom group robot webhook; message types and wording
  rules are fixed in `docs/notification-convention.md`.
- **One place for runtime data**: state and logs go to `logs/`, `data/` and `sessions/`
  inside each program directory, never into git.

## Restoring on a new machine

This repository doubles as a restore kit. The order that worked:

1. Clone this repository
2. Install the programs themselves: unpack the Microsoft Rewards upstream release into
   `%REWARDS_DIR%`; unpack Autovisor into `%AUTOVISOR_DIR%`; copy this repo's
   `weread-signin/` directory to `%WEREAD_DIR%` — it is the published source of the
   WeRead program (see `weread-signin/LOCAL-DEPLOYMENT.md`)
3. Copy this repo's templates and scripts into the program directories: for Microsoft
   Rewards that is `config.json`, `scripts-windows/`, `wechat-bridge/` and `patches/` from
   `microsoft-rewards/` (apply the patches in order after upgrading upstream)
4. Fill in the real credentials following `secrets/README.md`
5. Register the scheduled tasks: `%REWARDS_DIR%\scripts\windows\install-autostart.bat` for
   Microsoft Rewards, and `scripts\windows\install-autostart.ps1` from the WeRead code
6. Verify task state with the commands in `tasks/inventory.md`

For the cloud VM: provision it with `scripts/oracle-setup-wizard.sh`, then follow
`docs/cloud-vm.md` and `docs/cloud-scheduling-convention.md`.

## Credentials

See `secrets/README.md`: it lists, file by file, what has to be filled in and where to get
it. **No real value is stored here** — you can verify that against history: no `.env`,
cookie or webhook file has ever been committed.

## License and provenance

The repository as a whole is licensed under **GPL-3.0** (see `LICENSE`). The reason: parts
of what it redistributes are derivative works of GPL-3.0 upstream material — the Microsoft
Rewards patches are diffs against the upstream TypeScript source, `env.example` is the
upstream file verbatim, and `config.json` is adapted from the upstream config. Using
GPL-3.0 across the whole repository keeps it consistent with that upstream and avoids a
license conflict. The remaining files (runner scripts, notification layer, scripts,
documentation) ship under GPL-3.0 as well.

**One subdirectory is MIT, not GPL-3.0**: `weread-signin/` ships its own MIT `LICENSE`,
inherited from its upstream base [`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot),
and keeps that file. MIT is one-way compatible with GPL-3.0, so it can be redistributed
inside a GPL-3.0 repository; the files under `weread-signin/` retain their original MIT
terms. The same applies to `autovisor/configs.ini`, which comes from an MIT upstream.

Another MIT subdirectory is `wecom-notify/`: it was the standalone private repository
`Zzz210s/wecom-notify` (original to this project) and was merged here on 2026-10-04; that
repository has since been deleted, so this copy is the only one. It keeps its own MIT
`LICENSE`; the files inside are under MIT terms.

**Three notification senders.** The authoritative, most complete WeCom sender is
`wecom-notify/` (text and Markdown, timeout, exponential-backoff retry, webhook resolution
and masking). `microsoft-rewards/wechat-bridge/lib/wecom.js` and
`weread-signin/src/notify.js` are separate, thinner implementations of the same protocol;
neither imports `wecom-notify/`. This merge only archived and documented the relationship —
no program code was changed.

Upstream sources and their licenses:

| Path in this repo | Origin | License |
| --- | --- | --- |
| `microsoft-rewards/patches/*.patch` | Patches against the [`TheNetsky/Microsoft-Rewards-Script`](https://github.com/TheNetsky/Microsoft-Rewards-Script) v4.3.2 source | GPL-3.0 |
| `microsoft-rewards/env.example` | Upstream file, kept verbatim | GPL-3.0 |
| `microsoft-rewards/config.json` | Adapted from the upstream config example | GPL-3.0 |
| `microsoft-rewards/scripts-windows/`, `microsoft-rewards/wechat-bridge/` | Original to this repository (not from upstream) | GPL-3.0 |
| `autovisor/configs.ini` | Configuration template from [`CXRunfree/Autovisor`](https://github.com/CXRunfree/Autovisor) with local values filled in | MIT |
| `weread-signin/**` | Original to this repository (base: [`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot)) | MIT |
| `wecom-notify/**` | Original to this repository; formerly the standalone private repository `Zzz210s/wecom-notify` (deleted 2026-10-04 after the merge) | MIT |
| `patches/weread-bot/*.patch` | PR #53 diff against [`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot), archived and not applied | MIT |
| `docs/`, `scripts/`, `tasks/`, `secrets/README.md`, both READMEs | Original to this repository | GPL-3.0 |
