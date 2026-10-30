# Fafnir Personal Finances

What you have, what you owe and where your money goes, added up in US dollars. Fafnir (FPF for short) is double-entry bookkeeping for people who have never heard of it: you say you spent, received or moved money, and the books are kept for you. It has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is signed in there sees their own money and nobody else's.

| Layer    | Technology                                                                        |
| -------- | --------------------------------------------------------------------------------- |
| Frontend | React 19, Vite 8                                                                  |
| Backend  | Express 5, SQLite through Node's built-in `node:sqlite`                           |
| Database | `/var/lib/fafnir/fafnir.db` on a server, `data/fafnir.db` in development          |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                                   |
| Address  | `https://fafnir.<domain>`; https://localhost:8455 in WSL; port 5185 in `pnpm dev` |

```
shared/
  protocol.ts        API types and limits: the wire format, used by the server and the page
server/
  index.ts           routes, /healthz, removed users' books, exports, graceful shutdown
  db.ts              SQLite schema and migrations (PRAGMA user_version)
  ledger.ts          entries into postings that add up to zero; balances and monthly totals
  rates.ts           the USD/BRL rate of each day: fetching, keeping and looking it up
web/
  App.tsx            signing in, the sidebar, and which page and dialog are open
  api.ts             fetch for the API
  format.ts          reading and showing amounts and dates
  forms/             the dialogs: an entry, an account, Check balance, and the dollars line
  views/             the pages: Home, Activity, Accounts, Categories
  ui/                the dialog and the About box
deploy/
  fafnir.service     systemd unit (sandboxed)
  fafnir.caddy       Caddy site: /api to the service, everything else from dist/web
```

## How it works

**Words.** The page says what a person would say. Underneath, it is ordinary double entry:

| On the page                             | In the books                            |
| --------------------------------------- | --------------------------------------- |
| What I have, What I owe, What I'm worth | Assets, liabilities, net worth          |
| Spent, Received                         | An expense or income posting            |
| Moved (also: paying a card's bill)      | A transfer between two accounts         |
| Categories                              | Expense and income accounts             |
| The balance when an account was added   | Opening balance, against hidden equity  |
| Check balance                           | Reconciliation, with an adjusting entry |

**The rule of the books.** Every transaction is made of postings that add up to zero, in each currency and in dollars. `assertBalanced` checks that before anything is written, whatever made the transaction. Amounts are whole cents, never floating point.

**US dollars.** Reports and totals are always in US dollars. An account keeps its own currency, so R$ 100 spent from a Brazilian account takes R$ 100 from it. The entry's value in dollars is worked out from that day's rate when it is saved, and then stays, so past months' reports don't change. It is only worked out again if the entry's date or amount changes, or the user types the dollars. What an account is worth now, for What I have and What I owe, uses the latest rate.

**Exchange rates.** The server fetches USD/BRL from Banco Central's PTAX (the selling rate, published around midday on business days), or the same figures through Frankfurter if the bank is down, every hour and whenever a form needs a day it doesn't have. A day with no rate, like a weekend, uses the last one before it. Saving never depends on a source being up: without a known rate the form asks for the dollars. The browser never talks to the sources (the site's CSP wouldn't let it), and the server asks for the same pair whatever anyone holds, so they learn nothing about anyone's money. The rates are public figures, kept once for all users.

**Accounts.** Cash, bank account, savings or credit card, each in USD or BRL, optionally in a group (the way to keep Coinbase's or Sparrow's balances together later). A card's balance is normally below zero: what is owed. An account with nothing in it can be closed, and one with no entries deleted.

**Check balance.** The user types what the bank shows; if it differs from what is recorded on that day, the difference is added as a balance check. It can be deleted, not changed.

**Changing the past.** Entries can be changed and deleted. The version before each change is kept in the `history` table, and it is included in the full backup.

**Saving.** Each entry is saved on the server before its dialog closes: it says "saved" by closing, or says why not and keeps what was typed. An entry's id is made by the browser, so sending it twice saves it once. Dates can't be in the future, as entries are things that happened.

**Signing out.** If the session ends, a notice asks to sign in again in a new tab, and an open form keeps what was typed. If a different user signs in (in another tab), the page starts over as that user: every request names the user the page belongs to, and the API refuses it (409) if someone else is signed in.

## Not yet

Phase 1 of the plan. Still to come, in order:

2. **Exchanging currencies:** Exchanged, purchases in another currency, and an "Exchange rate changes" line in reports. Until then a move stays in one currency.
3. **Crypto:** BTC, ICP and USDC, on Coinbase and in a self-custody Sparrow wallet (BTC only). Values given in BTC or USDC become dollars; average cost in dollars; transfers with network fees that keep their cost; staking rewards. Prices from Coinbase's public API, with Kraken as a fallback. USDC counts as exactly $1 unless the market is more than 1% away. Fafnir only keeps records: it never stores seed phrases, private keys, Coinbase API keys or a wallet's extended public key.
4. **Loans:** money owed and owed to you, payments split into principal and interest.
5. **Assets and savings:** a house or car with a value updated by hand; savings goals.
6. **Understanding your money:** net worth over time, budgets, recurring entries.

Later: bank, Coinbase and Sparrow file imports, card installments, loan schedules, and a report in reais for Brazilian tax returns (each entry keeps its reais and its rate, so one can be added).

## Installing and data

```bash
sudo bash deploy/install.sh fafnir
```

With a real domain, `fafnir.<domain>` needs a DNS record first, unless a wildcard covers it.

The database is `/var/lib/fafnir/fafnir.db`, readable only by the service. It is not encrypted beyond that, like the other modules (Janus excepted). Back it up as in the [suite README](../README.md#operating-it), and regularly: **removing or renaming a user in Heimdall deletes their books on the next deploy**, as it does with every module's data. Accounts has a link to download your own copy as a spreadsheet or a full backup.
