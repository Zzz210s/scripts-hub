# scripts-hub

**English** | [简体中文](README.zh-CN.md)

A collection of isolated, self-contained projects for three unattended Windows automation
programs -- **Microsoft Rewards**, **Zhihuishu course playback** (Autovisor) and **WeRead
daily check-in**. One folder per project, each with its own README, dependency manifest,
tests and license. The WeCom notification rules shared by the projects are in
[`docs/wecom-rules.md`](docs/wecom-rules.md); each project keeps its own implementation.

This is not an application you install and run. The programs come from upstream projects and
are installed separately; what lives here is how they are configured, scheduled, notified and
restored on a new machine. This repository is also the remote landing spot for two local
workspaces that have no origin of their own: `%REWARDS_DIR%` (Microsoft Rewards) and
`%WEREAD_DIR%` (WeRead). How code changes flow into this repository is in
[`docs/workspace-model.md`](docs/workspace-model.md). Everything is sanitized: no real
credentials.

## 30-second map

```
scripts-hub/
├── proj-microsoft-rewards/   Microsoft Rewards: complete project (upstream source + local patches, runners, WeCom layer)
├── proj-autovisor/           Zhihuishu playback: the Autovisor config only (the program is an upstream Windows build)
├── proj-weread-signin/       WeRead check-in: the program itself (generated snapshot, do not edit here)
├── docs/                     Cross-project conventions and overviews -- read docs/README.md first
├── machine/                  What is deployed on the author's machine: scheduled tasks, local paths
├── patches/                  Every upstream patch, one folder per upstream project
├── scripts/                  Provisioning, sync and drift-check utilities -- see scripts/README.md
├── LICENSE                   GPL-3.0 for the repository; MIT inside proj-weread-signin/
└── README.md / README.zh-CN.md
```

## The three programs

| Program | What it does | Where |
| --- | --- | --- |
| **Microsoft Rewards** | Runs the daily Microsoft Rewards tasks and pushes the points result. | `proj-microsoft-rewards/` |
| **Zhihuishu playback** | Autovisor plays Zhihuishu / Zhida course videos automatically. | `proj-autovisor/` |
| **WeRead check-in** | Completes the daily reading challenge and verifies the counted minutes through the official read-only API. | `proj-weread-signin/` |

One scheduled task is not a program: `AutoShutdown0200` powers the machine off at 02:00 every
day. Code sources, install paths, machines, schedules, notification channels, credentials, the
cloud-migration status, the path convention and the license details are all in
[`docs/automation-overview.md`](docs/automation-overview.md).

## Quick start

To use one program, open its folder and read that folder's `QUICKSTART.md` -- prerequisites, three
commands, credentials to fill, how to verify, common failures -- then the `README` for the details.
The program itself is installed from upstream, and the folder explains what to copy where. To have
it check itself, run `bash scripts/setup-<project>.sh` (offline self-check: no login, no real run).

Minimum steps from a fresh clone to something that runs:

| Project | Fresh clone to running |
| --- | --- |
| `proj-weread-signin/` | `npm test` + `node src/index.js status`; a real run needs credentials and the Python vendor |
| `proj-microsoft-rewards/` | `npm ci` + patchright chromium + `npm run build`; the offline tests skip the first two |
| `proj-autovisor/` | nothing executable here, config only; the program comes from upstream |

To rebuild the whole setup on a new machine:

1. Clone this repository.
2. Read `docs/README.md` for the conventions, then `docs/automation-overview.md` for the index.
3. Install the programs from upstream; copy this repo's config and runner scripts into the
   program directories as each program README describes.
4. Fill in the real credentials listed in `docs/credentials.md`.
5. Register the scheduled tasks; `machine/scheduled-tasks.md` lists the names and the commands.

For the cloud VM (not yet provisioned): `scripts/wizard-oracle.sh`, then
`docs/cloud-vm.md`.

## Documentation index

| Document | What is in it |
| --- | --- |
| [`docs/README.md`](docs/README.md) | Index of all documentation |
| [`docs/workspace-model.md`](docs/workspace-model.md) | Where each project's authoritative workspace is, how code changes land here, and why not submodules |
| [`docs/automation-overview.md`](docs/automation-overview.md) | Everything: programs, code, machines, schedules, repositories, path convention, license and provenance |
| [`docs/scheduling-convention.md`](docs/scheduling-convention.md) | Staggered slots and guards, for this machine and for the planned cloud host |
| [`docs/notification-convention.md`](docs/notification-convention.md) | The four WeCom message types and the wording rules |
| [`docs/wecom-rules.md`](docs/wecom-rules.md) | The shared WeCom webhook rules: byte limits, timeout/retry, errcode handling, rate limits |
| [`docs/cloud-vm.md`](docs/cloud-vm.md) | Why a cloud VM, and which options were rejected |
| [`docs/credentials.md`](docs/credentials.md) | Which file needs which value, where to get it, how to recover it |
| [`machine/scheduled-tasks.md`](machine/scheduled-tasks.md) | This machine's scheduled tasks and how to inspect or disable them |
| [`scripts/README.md`](scripts/README.md) | Wizards, snapshot syncs, project self-check scripts and checks (WeCom drift, privacy scan) |
