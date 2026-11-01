# Changelog

What changed in Fafnir, newest first. Each version is tagged in git as `fafnir-v<version>`. How versions are numbered and released is in the [suite README](../README.md#versions-and-changelogs).

## Unreleased

- Loans: a new page for money you've borrowed and money you've lent, with what's left, what you've paid off and what the interest has come to.
- Taking out a loan doesn't change what you're worth, since you have the money and you owe it. A fee taken out of it does, and shows in your spending.
- Record a payment as a total and how much of it was interest. The interest counts as spending or income, the rest comes off the loan, and the form starts from your last payment. You type the interest: Fafnir doesn't work it out.
- Add interest makes a loan's balance grow with no payment made, so it can match your statement.
- There's a new Interest paid category, and the spreadsheet download has a new interest column.

- Crypto: keep track of Bitcoin, ICP and USDC. Set up Coinbase and Sparrow with one button, or add your own crypto accounts. What I'm worth now includes your coins at the latest price.
- The new Crypto page shows how much of each coin you have, where it sits, what it cost you on average and what it's worth, all in US dollars. Moving a coin between your accounts doesn't change what it cost.
- Exchanged works between any two currencies, reading as Bought BTC or Sold BTC. A trade takes its US dollar value from the USDC, reais or BTC side, and you can always type it yourself.
- Moved and Exchanged can have a fee: a network fee means less arrives. Fees show in your spending, under a new Fees category, and aren't part of what a coin cost.
- A staking reward is a Received entry in the new Staking rewards category, valued at the day's price.
- Amounts in a coin keep all their decimals. Typing `0,005` or `1.234` means what it looks like, and the form tells you what it read.
- The line on Home is now called Price and exchange rate changes, and the spreadsheet download has two new columns for fees.
- Fafnir only keeps records: it never connects to a wallet or an exchange, and never asks for a seed phrase, private key or API key.
- **By hand:** back up `fafnir.db` before installing, since this version changes the database's layout. If the server limits outgoing connections, also allow HTTPS to `api.exchange.coinbase.com` and `api.kraken.com`.

## 0.0.4 — 2026-10-30

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
