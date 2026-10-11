# Working on the Axis Suite

How the suite is built, installed and operated is in [README.md](README.md). This file holds the rules for working on it.

## One module at a time

Work happens on one module at a time, on its own branch (e.g. `odin`), merged into `main` when it is ready.

- Edit only that module's folder. Registering a new module in `deploy/modules.conf` and `pnpm-workspace.yaml` is part of adding it (see "Adding a module" in the README).
- Everything else needs the owner's explicit OK first: other modules (Heimdall, Loggbok, …), `packages/`, `deploy/`, and the shared root config (`package.json`, `tsconfig*.json`, `.oxlintrc.json`, `.prettierrc.json`, `.github/`).
- If a module needs a change to a shared part, stop and propose it. It goes in its own commit and is checked against every module.

## Environments

| Where                      | What it is                            | Rules                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This checkout (Windows)    | Development: `pnpm dev`               | Free to use.                                                                                                                                                                                               |
| WSL "Debian" distro        | Test install, the step before the VPS | Install, reconfigure and restart freely. Its data is disposable and needs no backup, unless the owner says it holds something worth keeping (e.g. a large database for profiling).                         |
| VPS (`*.gansoazul.com.br`) | Production, shared with a mail server | Never change it without asking first. Prefer step-by-step instructions the owner runs and pastes back, one step at a time, explaining what each does; take over only when asked. Be careful with its data. |

The VPS updates from its own clone in `~/axis-suite`: `git pull`, then `sudo bash deploy/install.sh <module>`.

## Git

The owner is new to Git, so Claude runs it: branches, commits, merges, and cleaning up merged branches. Explain the result in plain words. The repository is public: confirm before every push.

## Before committing

`pnpm check` and `pnpm build` from the root. On Windows, Prettier reports every file because the checkout has CRLF line endings (CI on Linux does not); check changed files with `npx prettier --check --end-of-line auto <files>` instead.
