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

The editor of choice is `vim`. When a step means editing a file by hand (e.g. `sudo vim /etc/caddy/sites.d/mail.caddy`), use it, not `nano`.

## Git

The owner is new to Git, so Claude runs it: branches, commits, merges, and cleaning up merged branches. Explain the result in plain words. The repository is public: confirm before every push.

## Versions and changelogs

Each module, and the suite as a whole, has its own version and `CHANGELOG.md` (see "Versions and changelogs" in the README).

- Every change adds a line to its module's changelog under **Unreleased** before it is merged into `main`. Write it for the owner, not for a programmer: what they will notice, and **By hand:** before any step they must take besides the installer.
- **Remind the owner to classify.** For a module at 1.0.0 or later (Yggdrasil), ask the owner before merging whether the change is **Major**, **Minor** or a **Fix**, with a suggestion and why, and start its changelog line with that word. A module still at 0.0.N needs no classification.
- A version is made only when the owner deploys, in one release commit:
  - A module at 0.0.N: N = `git rev-list --count --no-merges main -- <module>` plus one (the release commit), counted just before it.
  - A module at 1.0.0 or later: the largest kind in **Unreleased** decides (Major → x+1.0.0, Minor → x.y+1.0, Fix → x.y.z+1). Say which version it will be, and why, before tagging.
  - The suite: 0.0.N, N = `git rev-list --count --no-merges main` plus one. Add its entry to the root `CHANGELOG.md` with every module's version.
  - **Unreleased** becomes `## <version> — <date>`, both `package.json` files match, and the commit is tagged `<module>-v<version>` and `axis-suite-v<version>`, then pushed with `git push origin main --follow-tags`. Name the versions in the VPS steps.
- Only the owner moves a module to 1.0.0 (when its development map is complete) or the suite past 0.0. Never invent a number.
- Never move or delete a tag that has been pushed. A mistake gets a new version.

## Before committing

`pnpm check` and `pnpm build` from the root. On Windows, Prettier reports every file because the checkout has CRLF line endings (CI on Linux does not); check changed files with `npx prettier --check --end-of-line auto <files>` instead.
