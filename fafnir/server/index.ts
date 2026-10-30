import express, { type ErrorRequestHandler, type Request } from "express";
import { heimdallAuth, knownUsers } from "@axis-suite/heimdall-client/server";
import { USER_HEADER, type ApiError, type Entry } from "../shared/protocol.ts";
import { DB_FILE, openDatabase } from "./db.ts";
import { StoreError } from "./errors.ts";
import { createLedger, isMonth } from "./ledger.ts";
import { createRates, monthSpan, today } from "./rates.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3013);

const db = openDatabase(DB_FILE);
console.log(`Books database: ${DB_FILE}`);
const rates = createRates(db);
const ledger = createLedger(db, rates.lookup);

// The books of users removed from Heimdall go for good at start-up; the installer restarts this
// service when Heimdall's list of users changes. VACUUM gives the space back to the disk.
const known = knownUsers();
if (known) {
  const removed = ledger.removeUnknownOwners(known);
  for (const { owner, entries } of removed) {
    console.log(`Deleted the ${entries} entries of ${owner}, who is no longer a Heimdall user`);
  }
  if (removed.length > 0) db.exec("VACUUM");
}

const stopRates = rates.start();

const auth = heimdallAuth();
const app = express();
app.disable("x-powered-by");

// Liveness check for the installer and monitoring. Every module answers it.
app.get("/healthz", (_req, res) => {
  res.type("text/plain").set("Cache-Control", "no-store").send("ok");
});

app.use("/api", auth.sameOriginWrites, auth.requireUser, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  // A page names the user whose money it shows. If someone else has signed in since (in another
  // tab), its changes must not land on their books: 409 makes it reload as the new user.
  const expected = req.get(USER_HEADER);
  if (expected !== undefined && expected !== auth.user(req).username) {
    return void res.status(409).json({ error: "Someone else is signed in now", code: "other-user" } satisfies ApiError);
  }
  next();
});
// Bodies are read only once the user is known.
app.use("/api", express.json({ limit: "100kb" }));

const owner = (req: Request) => auth.user(req).username;
const param = (value: unknown) => (typeof value === "string" ? value : undefined);
const bodyDate = (req: Request) => param((req.body as { date?: unknown } | undefined)?.date);

/** Before saving: the rate of the entry's day, if it isn't known yet and the sources answer. */
async function ensureRate(req: Request): Promise<void> {
  const date = bodyDate(req);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) await rates.ensure(date);
}

// The signed-in user
app.get("/api/me", auth.me);

app.get("/api/book", async (req, res) => {
  const month = param(req.query.month) ?? today().slice(0, 7);
  // Why what the user is worth changed takes the rates of the days the month runs between.
  if (isMonth(month)) {
    const { start, end } = monthSpan(month);
    await Promise.all([rates.ensure(start), rates.ensure(end)]);
  }
  res.json(ledger.load(owner(req), month));
});

// The rate a form is about to use.
app.get("/api/rate", async (req, res) => {
  const date = param(req.query.date) ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return void res.status(400).json({ error: "That date isn't valid" });
  await rates.ensure(date);
  res.json({ rate: rates.lookup(date) });
});

app.get("/api/entries", (req, res) => {
  const offset = Number(param(req.query.offset) ?? 0);
  res.json(
    ledger.listEntries(owner(req), {
      account: param(req.query.account),
      q: param(req.query.q)?.trim().slice(0, 100),
      offset: Number.isSafeInteger(offset) ? offset : 0,
    }),
  );
});
app.post("/api/entries", async (req, res) => {
  await ensureRate(req);
  res.status(201).json(ledger.addEntry(owner(req), req.body));
});
app.put("/api/entries/:id", async (req, res) => {
  await ensureRate(req);
  res.json(ledger.changeEntry(owner(req), req.params.id, req.body));
});
app.delete("/api/entries/:id", (req, res) => {
  ledger.removeEntry(owner(req), req.params.id);
  res.status(204).end();
});

app.post("/api/accounts", async (req, res) => {
  await ensureRate(req);
  ledger.addAccount(owner(req), req.body);
  res.status(201).json({ ok: true });
});
app.post("/api/categories", (req, res) => {
  ledger.addCategory(owner(req), req.body);
  res.status(201).json({ ok: true });
});
app.patch("/api/accounts/:id", (req, res) => {
  ledger.changeAccount(owner(req), req.params.id, req.body);
  res.json({ ok: true });
});
app.delete("/api/accounts/:id", (req, res) => {
  ledger.removeAccount(owner(req), req.params.id);
  res.status(204).end();
});
app.post("/api/accounts/:id/check", async (req, res) => {
  await ensureRate(req);
  res.json(ledger.checkBalance(owner(req), req.params.id, req.body));
});

// A spreadsheet starting a cell with one of these would run it as a formula.
const csvText = (text: string) => {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};
const decimal = (cents: number) => (cents / 100).toFixed(2);

app.get("/api/export.json", (req, res) => {
  res.set("Content-Disposition", `attachment; filename="fafnir-${today()}.json"`);
  res.json(ledger.exportAll(owner(req)));
});
app.get("/api/export.csv", (req, res) => {
  const me = owner(req);
  const { accounts, categories } = ledger.load(me, today().slice(0, 7));
  const names = new Map([...accounts, ...categories].map((a) => [a.id, a.name]));
  const row = (e: Entry) =>
    [
      e.date,
      e.kind,
      csvText(names.get(e.account) ?? ""),
      csvText(e.other ? (names.get(e.other) ?? "") : ""),
      e.currency,
      decimal(e.amount),
      decimal(e.usd),
      e.rate ? e.rate.value : "",
      (e.paid ?? e.arrived)?.currency ?? "",
      e.paid || e.arrived ? decimal((e.paid ?? e.arrived)!.amount) : "",
      csvText(e.memo),
    ].join(",");
  const header = "date,kind,account,category or destination,currency,amount,usd,rate,other currency,other amount,note";
  res.type("text/csv");
  res.set("Content-Disposition", `attachment; filename="fafnir-${today()}.csv"`);
  res.send([header, ...ledger.allEntries(me).map(row)].join("\r\n") + "\r\n");
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "No such API" } satisfies ApiError);
});

// Errors as JSON. StoreError is a refused request; express.json's own errors carry a status.
// Anything else is a bug: logged, and answered without details.
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof StoreError) {
    return void res.status(err.status).json({ error: err.message, code: err.code } satisfies ApiError);
  }
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return void res.status(status).json({ error: (err as Error).message } satisfies ApiError);
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" } satisfies ApiError);
};
app.use(onError);

// Express 5 hands a failure to listen (e.g. the port is taken) to this callback. Exiting with an
// error lets systemd see it (Restart=on-failure) instead of a quiet, successful exit.
const server = app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error(`Could not listen on ${HOST}:${PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`Listening on http://${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopRates();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
