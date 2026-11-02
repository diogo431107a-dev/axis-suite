# Fafnir Personal Finances

What you have, what you owe and where your money goes, with crypto, loans and the things you own, added up in US dollars. Fafnir (FPF for short) is double-entry bookkeeping for people who have never heard of it: you say you spent, received or moved money, and the books are kept for you. It has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md), and whoever is signed in there sees their own money and nobody else's.

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
  currencies.ts      every currency, its decimals, and the arithmetic that depends on them
server/
  index.ts           routes, /healthz, removed users' books, exports, graceful shutdown
  db.ts              SQLite schema and migrations (PRAGMA user_version)
  ledger.ts          entries into postings that add up to zero; balances and monthly totals
  rates.ts           the rate and prices of each day: fetching, keeping and looking them up
  holdings.ts        what each coin cost, replayed from the entries
web/
  App.tsx            signing in, the sidebar, and which page and dialog are open
  api.ts             fetch for the API
  format.ts          reading and showing amounts and dates
  forms/             the dialogs: an entry, an account, a loan and its payments, something you own, its value
                     and its sale, Check balance, and the dollars line
  views/             the pages: Home, Activity, Accounts, Loans, Things I own, Crypto, Categories
  ui/                the dialog and the About box
deploy/
  fafnir.service     systemd unit (sandboxed)
  fafnir.caddy       Caddy site: /api to the service, everything else from dist/web
```

## How it works

**Words.** The page says what a person would say. Underneath, it is ordinary double entry:

| On the page                             | In the books                                |
| --------------------------------------- | ------------------------------------------- |
| What I have, What I owe, What I'm worth | Assets, liabilities, net worth              |
| Spent, Received                         | An expense or income posting                |
| Moved (also: paying a card's bill)      | A transfer between two accounts             |
| Exchanged                               | A transfer through a hidden trading account |
| Categories                              | Expense and income accounts                 |
| The balance when an account was added   | Opening balance, against hidden equity      |
| Check balance                           | Reconciliation, with an adjusting entry     |

**The rule of the books.** Every transaction is made of postings that add up to zero, in each currency and in dollars. `assertBalanced` checks that before anything is written, whatever made the transaction. Amounts are whole cents, never floating point.

**US dollars.** Reports and totals are always in US dollars. An account keeps its own currency, so R$ 100 spent from a Brazilian account takes R$ 100 from it. The entry's value in dollars is worked out from that day's rate when it is saved, and then stays, so past months' reports don't change. It is only worked out again if the entry's date or amount changes, or the user types the dollars. What an account is worth now, for What I have and What I owe, uses the latest rate.

**Exchange rates.** The server fetches USD/BRL from Banco Central's PTAX (the selling rate, published around midday on business days), or the same figures through Frankfurter if the bank is down, every hour and whenever a form needs a day it doesn't have. A day with no rate, like a weekend, uses the last one before it. Saving never depends on a source being up: without a known rate the form asks for the dollars. The browser never talks to the sources (the site's CSP wouldn't let it), and the server asks for the same pair whatever anyone holds, so they learn nothing about anyone's money. The rates are public figures, kept once for all users.

**Exchanging.** Exchanged takes one currency out of an account and puts another into a second one. Each currency goes through a hidden "Currency exchange" account, so each adds up to zero and no rate is needed for the books to balance: the two amounts say what happened. The form suggests what arrived from the day's rate, and shows the rate that the two amounts come to. The US dollar side is the entry's value.

**Prices in another currency.** A purchase or income can be in the other currency than its account: $20 charged as R$ 115 to a card in reais. The form suggests what was charged from the day's rate, for typing over from the statement. The account moves by what it was charged, the entry's value is the US dollar side, and the price is kept with it.

**Why what you're worth changed.** For each month Home gives what the user was worth at its start and its end, each at that day's rates and prices, with what lies between: money in less money out, starting balances and balance checks, and Price and exchange rate changes. That last one is what's left, so the sum always holds: reais and coins worth more or fewer dollars than before, and what exchanging cost beyond the reference rate. A month that needs a rate nobody knows shows none of it.

**Crypto.** Fafnir only keeps records. It never connects to a wallet or an exchange, never trades, and never stores seed phrases, private keys, API keys or a wallet's extended public key. A coin's amounts are in its smallest unit (8 decimals for BTC and ICP, 6 for USDC), and typing one, a lone `.` or `,` is always the decimal point, with the form saying what it read. "Set up Coinbase and Sparrow" makes Coinbase BTC, ICP and USDC, and Sparrow BTC. Sparrow only holds Bitcoin. Staked ICP is simply another account, and a staking reward is a Received entry.

**What a coin's worth.** Prices are the daily close from Coinbase, or from Kraken if Coinbase is down, every 15 minutes, in US dollars. USDC counts as exactly $1 unless Kraken's price is more than 1% away, and then the market's figure counts, with a notice. A trade takes its dollars from the first of USD, USDC, BRL, BTC, ICP it involves, so 20 ICP for 50 USDC is $50, and the user can always type the dollars instead.

**What a coin cost.** The Crypto page keeps an average cost in US dollars per coin, across all the user's accounts, so moving a coin between them doesn't change it. It's worked out from the entries each time and never stored. A reward costs its value on the day, and money already held costs what the user says, or the day's price. Selling or spending at more than the average is what "From coins sold" adds up; a balance check going down lowers the quantity without counting as a sale. If more goes out than ever came in, the rest counts as having cost nothing, and the page says so. These figures are for the user's own view, not a tax calculation.

**Fees.** Moved and Exchanged can have a fee, as part of what left. It's recorded as spending under Fees and isn't part of what a coin cost: its value is its share of the trade, so it needs no second rate. A move sends the amount and delivers it less the fee, which is how a network fee is recorded.

**Loans.** A loan is an account in USD or BRL: money borrowed sits below zero, money lent above it, so What I owe and What I have count them with no special rule. Taking one out is a move between it and one of the user's accounts, which is why it doesn't change what they're worth; a fee taken out of it does, as spending under Fees. An older loan is added with only what's left, as a starting balance. A payment is a total and how much of it was interest, always in the loan's own currency: interest goes to Interest paid or to Interest, and the rest comes off the loan. Add interest makes a balance grow with no money moving, so it can match a lender's statement. Check balance covers a loan that's forgiven or wrong. Fafnir doesn't work interest out or keep a schedule: the user types what happened. Paying more than what's left isn't refused, since entries are often typed out of order; the loan shows as overpaid. What was borrowed, what's come off and the interest so far are read from the entries each time, never stored.

**Things I own.** Something the user owns that isn't money but could be sold, like a car or a house, is an account in USD or BRL holding its value. Fafnir never looks a value up: the user types it, from a car's FIPE price or a valuation, and gives a new one whenever they like. Buying one is a move from the account or loan that paid, so it doesn't change what they're worth, and taxes or fees on top are ordinary spending. One already owned is added at its value today, as a starting balance. A new value is recorded as the difference, against a hidden "Value changes" account, so it shows on the month's walk as its own line, Value changes, and isn't spending or income; it can be deleted, not changed. Selling does three things in one transaction: the value becomes the price, the money moves to an account, and it closes. Savings need nothing of their own: a savings account is a kind of account, and its interest is a Received entry.

**Accounts.** Cash, bank account, savings or credit card, each in USD or BRL, or a crypto account holding one coin (BTC, ICP or USDC). Any of them can be in a group, which is how Coinbase's balances stay together. A card's balance is normally below zero: what is owed. An account with nothing in it can be closed, and one with no entries deleted.

**Check balance.** The user types what the bank shows; if it differs from what is recorded on that day, the difference is added as a balance check. It can be deleted, not changed.

**Changing the past.** Entries can be changed and deleted. The version before each change is kept in the `history` table, and it is included in the full backup.

**Saving.** Each entry is saved on the server before its dialog closes: it says "saved" by closing, or says why not and keeps what was typed. An entry's id is made by the browser, so sending it twice saves it once. Dates can't be in the future, as entries are things that happened.

**Signing out.** If the session ends, a notice asks to sign in again in a new tab, and an open form keeps what was typed. If a different user signs in (in another tab), the page starts over as that user: every request names the user the page belongs to, and the API refuses it (409) if someone else is signed in.

## Not yet

Phases 1 to 5 of the plan are done. Savings goals were left out on purpose: Fafnir records what you have, not what you plan. Still to come:

6. **Understanding your money:** net worth over time, budgets, recurring entries.

Later: bank, Coinbase and Sparrow file imports, card installments, loan schedules, and a report in reais for Brazilian tax returns (each entry keeps its reais and its rate, so one can be added).

## Installing and data

```bash
sudo bash deploy/install.sh fafnir
```

With a real domain, `fafnir.<domain>` needs a DNS record first, unless a wildcard covers it.

The database is `/var/lib/fafnir/fafnir.db`, readable only by the service. It is not encrypted beyond that, like the other modules (Janus excepted). Back it up as in the [suite README](../README.md#operating-it), and regularly: **removing or renaming a user in Heimdall deletes their books on the next deploy**, as it does with every module's data. Accounts has a link to download your own copy as a spreadsheet or a full backup.
