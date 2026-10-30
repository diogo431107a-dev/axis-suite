# Changelog

What changed in Fafnir, newest first. Each version is tagged in git as `fafnir-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

- Exchanged: change money between an account in reais and one in dollars. Fafnir suggests what arrives from the day's rate, you type what actually did, and it shows the rate you really got.
- Spent and Received can be in the other currency: $20 charged as R$ 115 to a card in reais. The entry keeps both amounts, and its value is the dollars.
- Home shows why what you're worth changed each month, from start to end, including a new line for Exchange rate changes: your reais worth more or fewer dollars, and what exchanging cost.
- The spreadsheet download has two new columns for the other currency and amount.

## 0.0.2 — 2026-10-30

- Fafnir Personal Finances: what you have, what you owe and where your money goes, at `fafnir.<domain>`. Sign in with Heimdall; each user has their own private books, saved in Fafnir's own database.
- Add your accounts (cash, bank, savings, credit card) in reais or dollars, and record what you spent, received or moved. Every total and report is in US dollars.
- Write an amount in reais and Fafnir records what it was worth in dollars that day, using Banco Central's exchange rate. That figure stays, so past months don't change. If no rate is available, you type the dollars.
- Check balance: type what your bank shows and Fafnir records any difference.
- Home shows what you're worth and each month's money in, money out and where it went. Activity finds any entry, and you can change or delete it.
- Download your own copy from Accounts, as a spreadsheet or a full backup.
- **By hand:** before the first install on a server, make sure `fafnir.<domain>` points at it (a DNS record, unless a wildcard already covers it). Fafnir fetches exchange rates from Banco Central and Frankfurter, so if the server limits outgoing connections, allow HTTPS to `olinda.bcb.gov.br` and `api.frankfurter.dev`.
