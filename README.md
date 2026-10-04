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
├── scripts/             Provisioning, sync and drift-check utilities -- see scripts/README.md
├── LICENSE              GPL-3.0 for the repository; MIT inside weread-signin/ and wecom-notify/
└── README.md / README.zh-CN.md
```

## The three programs

| Program | What it does | Where |
| --- | --- | --- |
| **Microsoft Rewards** | Runs the daily Microsoft Rewards tasks and pushes the points result. | `microsoft-rewards/` |
| **Zhihuishu playback** | Autovisor plays Zhihuishu / Zhida course videos automatically. | `autovisor/` |
| **WeRead check-in** | Completes the daily reading challenge and verifies the counted minutes through the official read-only API. | `weread-signin/` |

One scheduled task is not a program: `AutoShutdown0200` powers the machine off at 02:00 every
day. Code sources, install paths, machines, schedules, notification channels, credentials, the
cloud-migration status, the path convention and the license details are all in
[`docs/automation-overview.md`](docs/automation-overview.md).

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
| [`docs/automation-overview.md`](docs/automation-overview.md) | Everything: programs, code, machines, schedules, repositories, path convention, license and provenance |
| [`docs/scheduling-convention.md`](docs/scheduling-convention.md) | Staggered slots and guards, for this machine and for the planned cloud host |
| [`docs/notification-convention.md`](docs/notification-convention.md) | The four WeCom message types and the wording rules |
| [`docs/cloud-vm.md`](docs/cloud-vm.md) | Why a cloud VM, and which options were rejected |
| [`docs/credentials.md`](docs/credentials.md) | Which file needs which value, where to get it, how to recover it |
| [`machine/scheduled-tasks.md`](machine/scheduled-tasks.md) | This machine's scheduled tasks and how to inspect or disable them |
| [`scripts/README.md`](scripts/README.md) | The wizards, the snapshot sync and the WeCom drift check |
