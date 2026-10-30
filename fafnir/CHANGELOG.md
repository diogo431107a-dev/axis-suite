# Changelog

What changed in Fafnir, newest first. Each version is tagged in git as `fafnir-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

- Fafnir Personal Finances: what you have, what you owe and where your money goes, at `fafnir.<domain>`. Sign in with Heimdall; each user has their own private books, saved in Fafnir's own database.
- Add your accounts (cash, bank, savings, credit card) in reais or dollars, and record what you spent, received or moved. Every total and report is in US dollars.
- Write an amount in reais and Fafnir records what it was worth in dollars that day, using Banco Central's exchange rate. That figure stays, so past months don't change. If no rate is available, you type the dollars.
- Check balance: type what your bank shows and Fafnir records any difference.
- Home shows what you're worth and each month's money in, money out and where it went. Activity finds any entry, and you can change or delete it.
- Download your own copy from Accounts, as a spreadsheet or a full backup.
- **By hand:** before the first install on a server, make sure `fafnir.<domain>` points at it (a DNS record, unless a wildcard already covers it). Fafnir fetches exchange rates from Banco Central and Frankfurter, so if the server limits outgoing connections, allow HTTPS to `olinda.bcb.gov.br` and `api.frankfurter.dev`.
