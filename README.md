# scripts-hub

**English** | [简体中文](README.zh-CN.md)

Configuration, runner scripts and documentation for three unattended Windows automation
programs: **Microsoft Rewards**, **Zhihuishu course playback** (Autovisor) and **WeRead
daily check-in**. One folder per program.

This is not an application you install and run. The programs themselves come from upstream
projects and are installed separately; what lives here is how they are configured, scheduled,
notified and restored on a new machine. Everything is sanitized: no real credentials.

## 30-second map

```
scripts-hub/
├── microsoft-rewards/   Microsoft Rewards: config, Windows runners, WeCom notification layer
├── autovisor/           Zhihuishu playback: the Autovisor config only
├── weread-signin/       WeRead check-in: the program itself (generated snapshot, do not edit here)
├── wecom-notify/        Reusable WeCom group-robot notification CLI + library (zero dependencies)
├── docs/                Cross-project conventions and overviews -- read docs/README.md first
├── machine/             What is deployed on the author's machine: scheduled tasks, local paths
├── patches/             Every upstream patch, one folder per upstream project
├── scripts/             Provisioning and sync wizards -- see scripts/README.md
├── LICENSE              GPL-3.0 for the repository; MIT inside weread-signin/ and wecom-notify/
└── README.md / README.zh-CN.md
```

## The three programs

| Program | What it does | Code | Runs on | Runs when | Notifies |
| --- | --- | --- | --- | --- | --- |
| **Microsoft Rewards** | Runs the daily Microsoft Rewards tasks (searches, activities, read-to-earn) and pushes the points result | Upstream [`TheNetsky/Microsoft-Rewards-Script`](https://github.com/TheNetsky/Microsoft-Rewards-Script) v4.3.2, installed at `%REWARDS_DIR%`; this repo holds `microsoft-rewards/` (config + runners) and `patches/microsoft-rewards/` | This machine, Windows | Task `MicrosoftRewardsScript`: 3 min after logon (retried every 10 min for an hour) plus every 2 hours for 14 hours from 08:00; at most 3 attempts a day | WeCom robot, via `microsoft-rewards/wechat-bridge/` |
| **Zhihuishu playback** | Autovisor plays Zhihuishu / Zhida course videos automatically | Upstream [`CXRunfree/Autovisor`](https://github.com/CXRunfree/Autovisor) v3.17.3, installed at `%AUTOVISOR_DIR%`; this repo holds `autovisor/configs.ini` | This machine, Windows (needs Chrome and a desktop session) | Manual: start `Autovisor.exe`. No scheduled task | None (its own UI and log files) |
| **WeRead check-in** | Completes the WeRead daily reading challenge, then verifies the counted minutes through the official read-only API | Base [`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot); the code itself is in `weread-signin/` (a generated snapshot of the development clone at `%WEREAD_DIR%`) | This machine, Windows | Task `WeReadSignIn`: 10 min after logon (retried every 10 min for an hour) plus every 60 minutes for 14 hours from 08:30 | WeCom robot, via `weread-signin/src/notify.js` |

One scheduled task is not a program: `AutoShutdown0200` powers the machine off at 02:00 every
day (`microsoft-rewards/scripts-windows/auto-shutdown.bat`). Each program registers its own
task through its own installer.

**Cloud migration is not done.** Everything above runs on this one Windows machine today.
Moving Microsoft Rewards and WeRead to an Oracle Cloud Always Free ARM VM is designed and
documented (`docs/cloud-vm.md`, the cloud section of `docs/scheduling-convention.md`) but
blocked at Oracle signup, so no cloud host exists yet.

## Quick start

To use one program, open its folder and read that folder's README -- the program is installed
from upstream, and the folder explains what to copy where.

To rebuild the whole setup on a new machine:

1. Clone this repository.
2. Read `docs/README.md` for the conventions, then `docs/automation-overview.md` for the index.
3. Install the programs from upstream; copy this repo's config and runner scripts into the
   program directories as each program README describes.
4. Fill in the real credentials listed in `docs/credentials.md`.
5. Register the scheduled tasks; `machine/scheduled-tasks.md` lists the names and the commands.

For the cloud VM (not yet provisioned): `scripts/oracle-setup-wizard.sh`, then
`docs/cloud-vm.md`.

## Documentation index

| Document | What is in it |
| --- | --- |
| [`docs/README.md`](docs/README.md) | Index of all documentation |
| [`docs/automation-overview.md`](docs/automation-overview.md) | The whole picture: programs, code, machines, schedules, repositories |
| [`docs/scheduling-convention.md`](docs/scheduling-convention.md) | Staggered slots and guards, for this machine and for the planned cloud host |
| [`docs/notification-convention.md`](docs/notification-convention.md) | The four WeCom message types and the wording rules |
| [`docs/cloud-vm.md`](docs/cloud-vm.md) | Why a cloud VM, and which options were rejected |
| [`docs/credentials.md`](docs/credentials.md) | Which file needs which value, where to get it, how to recover it |
| [`machine/scheduled-tasks.md`](machine/scheduled-tasks.md) | This machine's scheduled tasks and how to inspect or disable them |
| [`scripts/README.md`](scripts/README.md) | The three wizards and what each one does |

## Path convention

The docs never hard-code a drive letter. Three placeholders stand for the program install
directories; replace them with your own paths:

| Placeholder | Meaning |
| --- | --- |
| `%REWARDS_DIR%` | Root of the Microsoft Rewards program (where the upstream release was unpacked) |
| `%AUTOVISOR_DIR%` | Autovisor install directory (it contains `app\`) |
| `%WEREAD_DIR%` | The WeRead development clone -- a local git clone whose tracked files `scripts/sync-weread-signin.sh` publishes into `weread-signin/` |

The runner scripts resolve their own location through `%~dp0`, so a whole directory can be
moved anywhere without edits. Machine-specific paths that must not be committed live in the
private file `~/.config/automation-suite/local-paths.env` (outside this repository); the
`automation-suite` name there is a legacy local directory and has nothing to do with any git
repository.

## License and provenance

The repository as a whole is **GPL-3.0** (see `LICENSE`), because parts of it are derivative
works of GPL-3.0 upstream material: the Microsoft Rewards patches are diffs against the
upstream TypeScript source, `microsoft-rewards/env.example` is the upstream file verbatim and
`microsoft-rewards/config.json` is adapted from the upstream config.

Two subdirectories are **MIT** and keep their own `LICENSE`: `weread-signin/` (inherited from
its base `funnyzak/weread-bot`) and `wecom-notify/` (original to this project, formerly the
standalone private repository `Zzz210s/wecom-notify`). `autovisor/configs.ini` also comes from
an MIT upstream. MIT is one-way compatible with GPL-3.0, so they can ship inside this
repository while their own files stay MIT.

`patches/weread-bot/` documents an intentionally kept fork used to contribute a fix upstream;
it is not part of this repository's merge scope. Its README explains why the fork must not be
deleted while PR #53 is open.
