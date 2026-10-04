# scripts-hub

**English** | [简体中文](README.zh-CN.md)

A collection of isolated, self-contained projects for four unattended automation programs --
**Microsoft Rewards**, **Zhihuishu course playback** (Autovisor), **WeRead daily check-in** and
**Epic free games**. One folder per project, each with its own README, dependency manifest,
tests and license. The WeCom notification rules shared by the projects are in
[`docs/wecom-rules.md`](docs/wecom-rules.md); each project keeps its own implementation.

This is not an application you install and run. The programs come from upstream projects and
are installed separately; what lives here is how they are configured, scheduled, notified and
restored on a new machine. This repository is also the remote landing spot for two local
workspaces that have no origin of their own: `%REWARDS_DIR%` (Microsoft Rewards) and
`%WEREAD_DIR%` (WeRead). How code changes flow into this repository is in
[`docs/workspace-model.md`](docs/workspace-model.md). Everything is sanitized: no real
credentials.

> **Snapshots are publish-only.** `proj-microsoft-rewards/` and `proj-weread-signin/` are
> sanitized snapshots of two local workspaces (real paths -> placeholders, personal
> identifiers -> `sample`). They are **not** deployment artifacts: pushing them back into a
> workspace would overwrite real values with placeholders. Refresh the repository with
> `scripts/sync-*.sh` (workspace -> repo); `scripts/deploy-*.sh` exists for restoring a fresh
> machine and refuses to overwrite a same-source workspace unless you pass
> `--allow-authoritative` (preview + typed confirmation + automatic backup).

## 30-second map

```
scripts-hub/
├── proj-microsoft-rewards/   Microsoft Rewards: complete project (upstream source + local patches, runners, WeCom layer)
├── proj-autovisor/           Zhihuishu playback: the Autovisor config only (the program is an upstream Windows build)
├── proj-weread-signin/       WeRead check-in: the program itself (generated snapshot, do not edit here)
├── proj-epic-free-games/     Epic free games: vendored AGPL claim engine plus a probe/state/WeCom shell
├── docs/                     Cross-project conventions and overviews -- read docs/README.md first
├── config/                   schedule.json: when each program runs; drives the task/timer generation
├── patches/                  Every upstream patch, one folder per upstream project
├── scripts/                  Provisioning, sync and drift-check utilities -- see scripts/README.md
├── LICENSE                   GPL-3.0 for the repository; MIT inside proj-weread-signin/, AGPL-3.0 inside proj-epic-free-games/
└── README.md / README.zh-CN.md
```

## The four programs

| Program | What it does | Where |
| --- | --- | --- |
| **Microsoft Rewards** | Runs the daily Microsoft Rewards tasks and pushes the points result. | `proj-microsoft-rewards/` |
| **Zhihuishu playback** | Autovisor plays Zhihuishu / Zhida course videos automatically. | `proj-autovisor/` |
| **WeRead check-in** | Completes the daily reading challenge and verifies the counted minutes through the official read-only API. | `proj-weread-signin/` |
| **Epic free games** | Claims the weekly Epic Games Store free games, with a prefilled-checkout-link fallback when hCaptcha blocks checkout. | `proj-epic-free-games/` |

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
| `proj-epic-free-games/` | `npm test` + `node src/cli.js status`; a real claim needs `npm install`, `npx patchright install chromium` and one device-authorization login (`node src/cli.js login`) |

To rebuild the whole setup on a new machine:

1. Clone this repository.
2. Read `docs/README.md` for the conventions, then `docs/automation-overview.md` for the index.
3. Install the programs from upstream; copy this repo's config and runner scripts into the
   program directories as each program README describes.
4. Fill in the real credentials listed in `docs/credentials.md`.
5. Register the scheduled tasks; `docs/local-deployment.md` lists the names and the commands.

The cloud VM (deployed 2026-10-04): both programs run containerised on Tencent Cloud,
sequenced by a host systemd timer -- start with [`docs/docker-deployment.md`](docs/docker-deployment.md),
the files live in [`scripts/linux/`](scripts/linux/). Why a VM at all: [`docs/cloud-vm.md`](docs/cloud-vm.md).

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
| [`docs/docker-deployment.md`](docs/docker-deployment.md) | Containerised deployment on the cloud VM: layering, layout, sequential orchestration, guards, startup-time tuning, credentials and operations |
| [`docs/credentials.md`](docs/credentials.md) | Which file needs which value, where to get it, how to recover it |
| [`docs/local-deployment.md`](docs/local-deployment.md) | What is deployed on this machine: workspaces, scheduled tasks, runner guards, private local files |
| [`scripts/README.md`](scripts/README.md) | Wizards, snapshot syncs, project self-check scripts and checks (WeCom drift, privacy scan) |
