import { useCallback, useEffect, useState } from "react";
import {
  Bitcoin,
  Car,
  CircleUser,
  HandCoins,
  Landmark,
  LayoutDashboard,
  ListTree,
  Menu,
  Plus,
  Receipt,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  SignedOutError,
  fetchMe,
  goToSignIn,
  signInUrl,
  watchForSignIn,
  type Me,
} from "@axis-suite/heimdall-client/browser";
import {
  hasOwnPage,
  type Book,
  type Entry,
  type AssetSummary,
  type LoanSummary,
  type MoneyAccount,
  type MoneyKind,
} from "../shared/protocol.ts";
import { api, describeError, setPageUser, setSignedOutHandler } from "./api.ts";
import { localDate } from "./format.ts";
import { AccountDialog } from "./forms/AccountDialog.tsx";
import { AssetDialog } from "./forms/AssetDialog.tsx";
import { CheckDialog } from "./forms/CheckDialog.tsx";
import { EntryDialog } from "./forms/EntryDialog.tsx";
import { InterestDialog } from "./forms/InterestDialog.tsx";
import { LoanDialog } from "./forms/LoanDialog.tsx";
import { PaymentDialog } from "./forms/PaymentDialog.tsx";
import { SellDialog } from "./forms/SellDialog.tsx";
import { ValueDialog } from "./forms/ValueDialog.tsx";
import { AboutButton } from "./ui/About.tsx";
import { Accounts } from "./views/Accounts.tsx";
import { Activity } from "./views/Activity.tsx";
import { Assets } from "./views/Assets.tsx";
import { Categories } from "./views/Categories.tsx";
import { Crypto } from "./views/Crypto.tsx";
import { Home } from "./views/Home.tsx";
import { Loans } from "./views/Loans.tsx";

type View = "home" | "activity" | "accounts" | "loans" | "assets" | "crypto" | "categories";

const NAV: { view: View; label: string; icon: LucideIcon }[] = [
  { view: "home", label: "Home", icon: LayoutDashboard },
  { view: "activity", label: "Activity", icon: Receipt },
  { view: "accounts", label: "Accounts", icon: Landmark },
  { view: "loans", label: "Loans", icon: HandCoins },
  { view: "assets", label: "Things I own", icon: Car },
  { view: "crypto", label: "Crypto", icon: Bitcoin },
  { view: "categories", label: "Categories", icon: ListTree },
];

const viewFromHash = (): View => {
  const name = location.hash.slice(1);
  return NAV.some((n) => n.view === name) ? (name as View) : "home";
};

type Open =
  | { what: "entry"; entry?: Entry }
  | { what: "account"; account?: MoneyAccount; startAs?: MoneyKind }
  | { what: "check"; account: MoneyAccount }
  | { what: "loan" }
  | { what: "asset" }
  | { what: "value"; asset: MoneyAccount }
  | { what: "sell"; asset: MoneyAccount }
  | { what: "payment"; loan: MoneyAccount; lastTotal?: number | null; entry?: Entry }
  | { what: "interest"; loan: MoneyAccount; entry?: Entry }
  | null;

/** Signs in and loads the books; everything after that is BookPage's. */
export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((user) => {
        setPageUser(user.username);
        if (!cancelled) setMe(user);
      })
      .catch((err: unknown) => {
        if (err instanceof SignedOutError) goToSignIn(err);
        else if (!cancelled) setLoadError("Could not load your money. Try again in a moment.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (me) return <BookPage me={me} />;
  return (
    <div className="screen" role={loadError ? "alert" : "status"}>
      {loadError || "Opening your books…"}
    </div>
  );
}

function BookPage({ me }: { me: Me }) {
  const [view, setView] = useState<View>(viewFromHash);
  const [navOpen, setNavOpen] = useState(false);
  const [month, setMonth] = useState(() => localDate().slice(0, 7));
  const [book, setBook] = useState<Book | null>(null);
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<Open>(null);
  const [activityAccount, setActivityAccount] = useState("");
  // Raised after every save, so the activity list loads again.
  const [version, setVersion] = useState(0);
  // Set when the session ends mid-use. Holds the sign-in URL.
  const [signedOut, setSignedOut] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api<Book>(`/api/book?month=${month}`)
      .then((loaded) => {
        setBook(loaded);
        setNotice("");
      })
      .catch((err: unknown) => setNotice(describeError(err)));
  }, [month]);

  useEffect(refresh, [refresh]);

  // Catches up with changes made elsewhere (another tab or device).
  useEffect(() => {
    const onFocus = () => {
      refresh();
      setVersion((v) => v + 1);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useEffect(() => {
    setSignedOutHandler(setSignedOut);
  }, []);
  useEffect(() => {
    if (!signedOut) return;
    return watchForSignIn(me.username, () => {
      setSignedOut(null);
      refresh();
    });
  }, [signedOut, me.username, refresh]);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (next: View) => {
    location.hash = next;
    setView(next);
    setNavOpen(false);
  };

  const saved = () => {
    setOpen(null);
    refresh();
    setVersion((v) => v + 1);
  };

  const addEntry = () =>
    setOpen(
      book && book.accounts.some((a) => !a.closed && !hasOwnPage(a.kind)) ? { what: "entry" } : { what: "account" },
    );

  /** An entry opens in the form that made it. */
  const openEntry = (entry: Entry) => {
    const find = (id: string | null) => book?.accounts.find((a) => a.id === id);
    const loan = find(entry.kind === "interest" ? entry.account : entry.other);
    if (loan && (entry.kind === "repaid" || entry.kind === "collected")) setOpen({ what: "payment", loan, entry });
    else if (loan && entry.kind === "interest") setOpen({ what: "interest", loan, entry });
    else setOpen({ what: "entry", entry });
  };

  /** The account behind a line on the Loans page, then what to do with it. */
  const withLoan = (summary: LoanSummary | AssetSummary, then: (loan: MoneyAccount) => void) => {
    const loan = book?.accounts.find((a) => a.id === summary.id);
    if (loan) then(loan);
  };

  if (!book) {
    return (
      <div className="screen" role={notice ? "alert" : "status"}>
        {notice || "Opening your books…"}
      </div>
    );
  }

  return (
    <div className="layout">
      {navOpen && <div className="backdrop" onClick={() => setNavOpen(false)} aria-hidden />}
      <aside className={`sidebar ${navOpen ? "open" : ""}`}>
        <div className="brand-row">
          <AboutButton>
            <span className="brand">
              <img src="/favicon.svg" alt="" />
              <span>
                <span className="brand-name">Fafnir</span>
                <span className="brand-sub">Personal Finances</span>
              </span>
            </span>
          </AboutButton>
          <button
            type="button"
            className="icon-btn close-nav"
            onClick={() => setNavOpen(false)}
            aria-label="Close menu"
          >
            <X aria-hidden />
          </button>
        </div>
        <button
          type="button"
          className="btn primary add"
          onClick={() => {
            setNavOpen(false);
            addEntry();
          }}
        >
          <Plus aria-hidden /> Add an entry
        </button>
        <nav aria-label="Main">
          {NAV.map(({ view: v, label, icon: Icon }) => (
            <button
              type="button"
              key={v}
              className={view === v ? "on" : ""}
              aria-current={view === v ? "page" : undefined}
              onClick={() => go(v)}
            >
              <Icon aria-hidden /> {label}
            </button>
          ))}
        </nav>
        <a className="who" href={me.accountUrl}>
          <CircleUser aria-hidden /> {me.name}
        </a>
      </aside>

      <div className="content">
        <header className="topbar">
          <button type="button" className="icon-btn" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <Menu aria-hidden />
          </button>
          <span className="brand-name">Fafnir</span>
          <button type="button" className="icon-btn add-small" onClick={addEntry} aria-label="Add an entry">
            <Plus aria-hidden />
          </button>
        </header>

        <main>
          {signedOut && (
            <p className="banner" role="alert">
              Your session has ended.{" "}
              <a href={signInUrl(signedOut)} target="_blank" rel="noreferrer">
                Sign in again in a new tab
              </a>
              , then come back. Nothing you typed is lost.
            </p>
          )}
          {notice && (
            <p className="banner" role="alert">
              {notice}
            </p>
          )}
          {view === "home" && (
            <Home
              book={book}
              month={month}
              onMonth={setMonth}
              onAddAccount={() => setOpen({ what: "account" })}
              onOpenAccount={(a) => {
                setActivityAccount(a.id);
                go("activity");
              }}
            />
          )}
          {view === "activity" && (
            <Activity
              book={book}
              version={version}
              account={activityAccount}
              onAccount={setActivityAccount}
              onOpen={openEntry}
            />
          )}
          {view === "accounts" && (
            <Accounts
              book={book}
              onAdd={() => setOpen({ what: "account" })}
              onEdit={(account) => setOpen({ what: "account", account })}
              onCheck={(account) => setOpen({ what: "check", account })}
              onActivity={(a) => {
                setActivityAccount(a.id);
                go("activity");
              }}
            />
          )}
          {view === "loans" && (
            <Loans
              version={version}
              onAdd={() => setOpen({ what: "loan" })}
              actions={{
                onPayment: (s) => withLoan(s, (loan) => setOpen({ what: "payment", loan, lastTotal: s.lastTotal })),
                onInterest: (s) => withLoan(s, (loan) => setOpen({ what: "interest", loan })),
                onCheck: (s) => withLoan(s, (account) => setOpen({ what: "check", account })),
                onEdit: (s) => withLoan(s, (account) => setOpen({ what: "account", account })),
                onActivity: (s) => {
                  setActivityAccount(s.id);
                  go("activity");
                },
              }}
            />
          )}
          {view === "assets" && (
            <Assets
              version={version}
              onAdd={() => setOpen({ what: "asset" })}
              actions={{
                onValue: (s) => withLoan(s, (asset) => setOpen({ what: "value", asset })),
                onSell: (s) => withLoan(s, (asset) => setOpen({ what: "sell", asset })),
                onEdit: (s) => withLoan(s, (account) => setOpen({ what: "account", account })),
                onActivity: (s) => {
                  setActivityAccount(s.id);
                  go("activity");
                },
              }}
            />
          )}
          {view === "crypto" && (
            <Crypto
              book={book}
              version={version}
              onChanged={saved}
              onAddAccount={() => setOpen({ what: "account", startAs: "crypto" })}
              onOpenAccount={(id) => {
                setActivityAccount(id);
                go("activity");
              }}
            />
          )}
          {view === "categories" && <Categories book={book} onChanged={saved} />}
        </main>
      </div>

      {open?.what === "entry" && (
        <EntryDialog
          book={book}
          {...(open.entry ? { entry: open.entry } : {})}
          onClose={() => setOpen(null)}
          onSaved={saved}
        />
      )}
      {open?.what === "account" && (
        <AccountDialog
          book={book}
          {...(open.account ? { account: open.account } : {})}
          {...(open.startAs ? { startAs: open.startAs } : {})}
          onClose={() => setOpen(null)}
          onSaved={saved}
        />
      )}
      {open?.what === "loan" && <LoanDialog book={book} onClose={() => setOpen(null)} onSaved={saved} />}
      {open?.what === "asset" && <AssetDialog book={book} onClose={() => setOpen(null)} onSaved={saved} />}
      {open?.what === "value" && <ValueDialog asset={open.asset} onClose={() => setOpen(null)} onSaved={saved} />}
      {open?.what === "sell" && (
        <SellDialog book={book} asset={open.asset} onClose={() => setOpen(null)} onSaved={saved} />
      )}
      {open?.what === "payment" && (
        <PaymentDialog
          book={book}
          loan={open.loan}
          lastTotal={open.lastTotal}
          entry={open.entry}
          onClose={() => setOpen(null)}
          onSaved={saved}
        />
      )}
      {open?.what === "interest" && (
        <InterestDialog loan={open.loan} entry={open.entry} onClose={() => setOpen(null)} onSaved={saved} />
      )}
      {open?.what === "check" && (
        <CheckDialog
          account={open.account}
          onClose={() => setOpen(null)}
          // The dialog stays open to say what it found; only the numbers behind it reload.
          onSaved={() => {
            refresh();
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
