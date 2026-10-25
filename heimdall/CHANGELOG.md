# Changelog

What changed in Heimdall, newest first. Each version is tagged in git as `heimdall-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

- Development only: signing in on the development server (`pnpm dev`) can send you back to Mimir's, at 127.0.0.1:5181. Nothing changes on a server, so this alone needs no new install.
- Development only: the same for Urd's, at 127.0.0.1:5182.
- Clicking the logo on the sign-in and account pages opens an About box with Heimdall's version and the Axis Suite version it was built with. Every module of the suite opens its About box the same way.

## 0.0.17 — 2026-10-13

- Althing can ask Heimdall who is signed in anywhere in the suite, for its "online" list. Asking doesn't keep anyone's session open.

## 0.0.15 — 2026-10-13

The first numbered version: Heimdall as it runs in production on this date. Its 15 commits so far, this one included, give the number.

- The suite's sign-in service. Users are listed in the code (`server/users.ts`), with hashed passwords.
- Every other module asks Heimdall who is signed in, so none of them has a login of its own. The session cookie covers every module's subdomain.
- Three wrong attempts lock that client out for 5 minutes.
- The installer hands Heimdall's usernames to every module, and a user's data is deleted from every module once they are removed.
