import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { anniversaryDays, addDays, daysBetween, isDate } from "../shared/dates.ts";
import {
  BIN_DAYS,
  COLORS,
  LIMITS,
  type Color,
  type DaySummary,
  type ErrorCode,
  type ExportFile,
  type ExportJournal,
  type ExportPage,
  type ImportResult,
  type Journal,
  type Mood,
  type Page,
  type PageSaved,
  type SearchAnswer,
  type SearchHit,
  type Settings,
  type Streak,
  type TagCount,
  type Template,
  type WeekStart,
} from "../shared/protocol.ts";
import { parseQuery, type Term } from "../shared/query.ts";
import { tagsOf } from "../shared/tags.ts";
import { countWords, normalize, normalizeWithMap, preview } from "../shared/words.ts";

// The only place journals are read and written. Every query names the owner (a Heimdall
// username), so nobody reaches another user's journals; a row that belongs to someone else
// answers exactly like one that doesn't exist.

/** A request the store refuses, with the HTTP status to answer. */
export class StoreError extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  /** with "conflict": the page as it is now */
  readonly page: Page | undefined;
  constructor(status: number, message: string, code?: ErrorCode, page?: Page) {
    super(message);
    this.status = status;
    this.code = code;
    this.page = page;
  }
}

interface JournalRow {
  id: string;
  owner: string;
  name: string;
  color: Color;
  template_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  pages: number;
}

interface PageRow {
  id: number;
  owner: string;
  journal_id: string;
  date: string;
  text: string;
  mood: Mood | null;
  words: number;
  rev: number;
  created_at: string;
  updated_at: string;
}

interface TemplateRow {
  id: string;
  owner: string;
  name: string;
  text: string;
  created_at: string;
  updated_at: string;
}

interface SummaryRow {
  journal_id: string;
  date: string;
  mood: Mood | null;
  words: number;
  head: string;
  tags: string;
}

const DEFAULT_SETTINGS: Settings = { prompts: null, weekStart: null };
const EMPTY_SAVED: PageSaved = { rev: 0, words: 0, tags: [], updatedAt: null };
const PREVIEW_CHARS = 160;
const MEMORY_CHARS = 300;

function invalid(message: string): never {
  throw new StoreError(400, message, "invalid");
}

const notFound = (what: string): never => {
  throw new StoreError(404, `No such ${what}`, "not-found");
};

function objectBody(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    invalid("The request body must be a JSON object");
  }
  return input as Record<string, unknown>;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") invalid(`${name} must be text`);
  if (value.length > max) invalid(`${name} is longer than ${max} characters`);
  return value;
}

function nameText(value: unknown, what: string, max: number): string {
  const name = text(value, `The ${what} name`, max).trim();
  if (!name) invalid(`The ${what} name is empty`);
  return name;
}

const journalName = (value: unknown) => nameText(value, "journal", LIMITS.journalNameChars);
const templateName = (value: unknown) => nameText(value, "template", LIMITS.templateNameChars);

/** Names compare without case: "Work" and "work" are the same journal. */
const sameName = (a: string, b: string) => a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();

function color(value: unknown): Color {
  if (!COLORS.includes(value as Color)) invalid(`The colour must be one of ${COLORS.join(", ")}`);
  return value as Color;
}

function mood(value: unknown): Mood | null {
  if (value === null || value === undefined) return null;
  if (value !== 1 && value !== 2 && value !== 3 && value !== 4 && value !== 5) invalid("mood must be 1 to 5, or null");
  return value;
}

function date(value: unknown, name = "The date"): string {
  if (!isDate(value)) invalid(`${name} must be a day as YYYY-MM-DD`);
  return value;
}

const isEmpty = (pageText: string, pageMood: Mood | null) => pageText.trim() === "" && pageMood === null;

const isoOr = (value: unknown, fallback: string) =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : fallback;

function settingsValue(input: unknown): Settings {
  const b = objectBody(input);
  let prompts: string[] | null = null;
  if (b.prompts !== null && b.prompts !== undefined) {
    if (!Array.isArray(b.prompts)) invalid("prompts must be a list of texts, or null");
    prompts = b.prompts.map((p, i) => text(p, `Prompt ${i + 1}`, LIMITS.promptChars).trim()).filter(Boolean);
    if (prompts.length > LIMITS.prompts) invalid(`At most ${LIMITS.prompts} prompts`);
    // No prompts of one's own: the built-in ones.
    if (prompts.length === 0) prompts = null;
  }
  const weekStart = b.weekStart ?? null;
  if (weekStart !== null && weekStart !== 0 && weekStart !== 1 && weekStart !== 6) {
    invalid("weekStart must be 0 (Sunday), 1 (Monday), 6 (Saturday) or null");
  }
  return { prompts, weekStart: weekStart as WeekStart };
}

/** Part of a page around the first place the search matched, with the matches marked. */
export function snippetOf(pageText: string, terms: readonly Term[], max = 220): Pick<SearchHit, "snippet" | "marks"> {
  const needles = terms.flatMap((t) => {
    if (t.negate) return [];
    if (t.kind === "word" || t.kind === "phrase") return [t.value];
    if (t.kind === "tag") return [`#${normalize(t.value)}`];
    return [];
  });
  const { text: plain, map } = normalizeWithMap(pageText);
  const found: [number, number][] = [];
  for (const needle of needles) {
    for (let i = plain.indexOf(needle); i !== -1 && found.length < 100; i = plain.indexOf(needle, i + needle.length)) {
      found.push([map[i]!, map[i + needle.length]!]);
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const ranges: [number, number][] = [];
  for (const r of found) {
    const last = ranges.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else ranges.push([...r]);
  }

  // A window from a little before the first match, starting and ending between words.
  let start = Math.max(0, (ranges[0]?.[0] ?? 0) - 60);
  if (start > 0) {
    const space = pageText.slice(start, start + 20).search(/\s/);
    if (space !== -1 && start + space < (ranges[0]?.[0] ?? 0)) start += space + 1;
  }
  let end = Math.min(pageText.length, start + max);
  if (end < pageText.length) {
    const space = pageText.slice(end - 20, end).search(/\s\S*$/);
    if (space !== -1) end = end - 20 + space;
  }
  // Same length, one line: the marks stay where they are.
  const prefix = start > 0 ? "…" : "";
  const snippet = prefix + pageText.slice(start, end).replace(/\s/g, " ") + (end < pageText.length ? "…" : "");
  const marks = ranges
    .filter(([a, b]) => b > start && a < end)
    .map(([a, b]): [number, number] => [
      Math.max(a, start) - start + prefix.length,
      Math.min(b, end) - start + prefix.length,
    ]);
  return { snippet, marks };
}

export function createStore(db: DatabaseSync) {
  const JOURNAL_COLUMNS = "j.*, (SELECT count(*) FROM pages p WHERE p.journal_id = j.id) AS pages";
  const selectJournals = db.prepare(
    `SELECT ${JOURNAL_COLUMNS} FROM journals j WHERE j.owner = ? ORDER BY j.position, j.created_at`,
  );
  const selectJournal = db.prepare(`SELECT ${JOURNAL_COLUMNS} FROM journals j WHERE j.id = ? AND j.owner = ?`);
  const insertJournal = db.prepare(
    `INSERT INTO journals (id, owner, name, color, template_id, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, (SELECT coalesce(max(position), -1) + 1 FROM journals WHERE owner = ?), ?, ?)`,
  );
  const updateJournalRow = db.prepare(
    "UPDATE journals SET name = ?, color = ?, template_id = ?, updated_at = ? WHERE id = ? AND owner = ?",
  );
  const setJournalDeleted = db.prepare("UPDATE journals SET deleted_at = ? WHERE id = ? AND owner = ?");
  const setJournalPosition = db.prepare("UPDATE journals SET position = ? WHERE id = ? AND owner = ?");
  const deleteJournalRow = db.prepare("DELETE FROM journals WHERE id = ? AND owner = ?");
  const purgeBin = db.prepare("DELETE FROM journals WHERE deleted_at IS NOT NULL AND deleted_at < ?");

  const selectPage = db.prepare("SELECT * FROM pages WHERE journal_id = ? AND date = ? AND owner = ?");
  const selectPages = db.prepare("SELECT * FROM pages WHERE journal_id = ? AND owner = ? ORDER BY date");
  const insertPage = db.prepare(
    `INSERT INTO pages (owner, journal_id, date, text, search, mood, words, rev, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const updatePage = db.prepare(
    "UPDATE pages SET text = ?, search = ?, mood = ?, words = ?, rev = ?, updated_at = ? WHERE id = ?",
  );
  const deletePage = db.prepare("DELETE FROM pages WHERE id = ?");
  const deleteTags = db.prepare("DELETE FROM page_tags WHERE page_id = ?");
  const insertTag = db.prepare("INSERT INTO page_tags (page_id, tag) VALUES (?, ?)");
  const nextRev = db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'rev' RETURNING value");

  const SUMMARY = `p.journal_id, p.date, p.mood, p.words, substr(p.text, 1, 400) AS head,
    (SELECT json_group_array(tag) FROM page_tags t WHERE t.page_id = p.id) AS tags`;
  const selectDays = db.prepare(
    `SELECT ${SUMMARY} FROM live_pages p
     WHERE p.owner = $owner AND p.date BETWEEN $from AND $to AND ($journal IS NULL OR p.journal_id = $journal)
     ORDER BY p.date`,
  );
  const selectMemories = db.prepare(
    `SELECT ${SUMMARY} FROM live_pages p
     WHERE p.owner = $owner AND substr(p.date, 6) IN (SELECT value FROM json_each($days)) AND p.date < $date
       AND ($journal IS NULL OR p.journal_id = $journal)
     ORDER BY p.date DESC`,
  );
  const selectWrittenDays = db.prepare(
    `SELECT DISTINCT date FROM live_pages
     WHERE owner = $owner AND date <= $today AND ($journal IS NULL OR journal_id = $journal)
     ORDER BY date DESC`,
  );
  const selectTags = db.prepare(
    `SELECT t.tag, count(*) AS count FROM page_tags t JOIN live_pages p ON p.id = t.page_id
     WHERE p.owner = ? GROUP BY t.tag ORDER BY t.tag`,
  );

  const selectTemplates = db.prepare("SELECT * FROM templates WHERE owner = ? ORDER BY created_at, id");
  const selectTemplate = db.prepare("SELECT * FROM templates WHERE id = ? AND owner = ?");
  const insertTemplate = db.prepare(
    "INSERT INTO templates (id, owner, name, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
  );
  const updateTemplateRow = db.prepare(
    "UPDATE templates SET name = ?, text = ?, updated_at = ? WHERE id = ? AND owner = ? RETURNING *",
  );
  const deleteTemplateRow = db.prepare("DELETE FROM templates WHERE id = ? AND owner = ?");

  const selectSettings = db.prepare("SELECT data FROM settings WHERE owner = ?");
  const upsertSettings = db.prepare(
    "INSERT INTO settings (owner, data) VALUES (?, ?) ON CONFLICT (owner) DO UPDATE SET data = excluded.data",
  );

  // $known: a JSON array of usernames.
  const UNKNOWN_OWNER = "owner NOT IN (SELECT value FROM json_each($known))";
  const countUnknownOwners = db.prepare(`
    SELECT owner, sum(journal) AS journals, sum(page) AS pages FROM (
      SELECT owner, 1 AS journal, 0 AS page FROM journals WHERE ${UNKNOWN_OWNER}
      UNION ALL SELECT owner, 0, 1 FROM pages WHERE ${UNKNOWN_OWNER}
      UNION ALL SELECT owner, 0, 0 FROM templates WHERE ${UNKNOWN_OWNER}
      UNION ALL SELECT owner, 0, 0 FROM settings WHERE ${UNKNOWN_OWNER}
    ) GROUP BY owner ORDER BY owner`);
  // Journals take their pages (and those their tags) with them; then the templates they named.
  const deleteUnknown = ["journals", "templates", "settings"].map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE ${UNKNOWN_OWNER}`),
  );

  /** Runs `fn` in one transaction. */
  function transaction<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  function toJournal(row: JournalRow): Journal {
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      templateId: row.template_id,
      pages: row.pages,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }

  function toPage(journalId: string, day: string, row: PageRow | undefined): Page {
    if (!row) return { journalId, date: day, text: "", mood: null, tags: [], words: 0, rev: 0, updatedAt: null };
    return {
      journalId,
      date: day,
      text: row.text,
      mood: row.mood,
      tags: tagsOf(row.text),
      words: row.words,
      rev: row.rev,
      updatedAt: row.updated_at,
    };
  }

  function toSummary(row: SummaryRow, chars: number): DaySummary {
    return {
      journalId: row.journal_id,
      date: row.date,
      mood: row.mood,
      words: row.words,
      tags: JSON.parse(row.tags) as string[],
      preview: preview(row.head, chars),
    };
  }

  const toTemplate = (row: TemplateRow): Template => ({
    id: row.id,
    name: row.name,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const journalRows = (owner: string) => selectJournals.all(owner) as unknown as JournalRow[];

  function journalRow(owner: string, id: string): JournalRow {
    return (selectJournal.get(id, owner) as JournalRow | undefined) ?? notFound("journal");
  }

  /** A journal outside the recycle bin: the only kind whose pages can be read or written. */
  function liveJournal(owner: string, id: string): JournalRow {
    const row = journalRow(owner, id);
    if (row.deleted_at) notFound("journal");
    return row;
  }

  /** A journal id from a request filter: undefined for all journals, else one of the owner's live ones. */
  function journalFilter(owner: string, value: unknown): string | null {
    if (value === undefined || value === "") return null;
    if (typeof value !== "string") invalid("journal must be a journal id");
    return liveJournal(owner, value).id;
  }

  function checkNameFree(owner: string, name: string, exceptId?: string): void {
    const clash = journalRows(owner).find((j) => !j.deleted_at && j.id !== exceptId && sameName(j.name, name));
    if (clash) throw new StoreError(409, `There is already a journal called ${clash.name}`, "exists");
  }

  function addJournal(owner: string, name: string, journalColor: Color, templateId: string | null): string {
    const rows = journalRows(owner);
    if (rows.length >= LIMITS.journals) {
      throw new StoreError(409, `At most ${LIMITS.journals} journals (the recycle bin counts too)`, "too-many");
    }
    checkNameFree(owner, name);
    const id = randomUUID();
    const now = new Date().toISOString();
    insertJournal.run(id, owner, name, journalColor, templateId, owner, now, now);
    return id;
  }

  function templateRef(owner: string, value: unknown): string | null {
    if (value === null) return null;
    if (typeof value !== "string" || !selectTemplate.get(value, owner)) invalid("No such template");
    return value;
  }

  function pageRow(owner: string, journalId: string, day: string): PageRow | undefined {
    return selectPage.get(journalId, day, owner) as PageRow | undefined;
  }

  /**
   * Writes a page as it is now, with a new rev, or deletes it if it's empty. The caller checked
   * everything else. Runs inside a transaction.
   */
  function storePage(
    owner: string,
    journalId: string,
    day: string,
    pageText: string,
    pageMood: Mood | null,
    row: PageRow | undefined,
    times?: { createdAt: string; updatedAt: string },
  ): PageSaved {
    if (isEmpty(pageText, pageMood)) {
      if (row) deletePage.run(row.id);
      return EMPTY_SAVED;
    }
    const { value: rev } = nextRev.get() as { value: number };
    const words = countWords(pageText);
    const tags = tagsOf(pageText);
    const search = normalize(pageText);
    const now = new Date().toISOString();
    const updatedAt = times?.updatedAt ?? now;
    let id: number;
    if (row) {
      updatePage.run(pageText, search, pageMood, words, rev, updatedAt, row.id);
      deleteTags.run(row.id);
      id = row.id;
    } else {
      const created = times?.createdAt ?? now;
      const values: SQLInputValue[] = [
        owner,
        journalId,
        day,
        pageText,
        search,
        pageMood,
        words,
        rev,
        created,
        updatedAt,
      ];
      id = Number((insertPage.get(...values) as { id: number | bigint }).id);
    }
    for (const tag of tags) insertTag.run(id, tag);
    return { rev, words, tags, updatedAt };
  }

  function getSettings(owner: string): Settings {
    const row = selectSettings.get(owner) as { data: string } | undefined;
    return row ? { ...DEFAULT_SETTINGS, ...(JSON.parse(row.data) as Partial<Settings>) } : { ...DEFAULT_SETTINGS };
  }

  /** The SQL condition for one search term, and its parameters. */
  function termSql(t: Term): [string, SQLInputValue[]] {
    switch (t.kind) {
      case "word":
      case "phrase":
        return ["instr(p.search, ?) > 0", [t.value]];
      case "tag":
        // The tag itself or one under it: "work", or "work/…" (the characters after "/" up to "0").
        return [
          "EXISTS (SELECT 1 FROM page_tags t WHERE t.page_id = p.id AND (t.tag = ? OR (t.tag > ? AND t.tag < ?)))",
          [t.value, `${t.value}/`, `${t.value}0`],
        ];
      case "mood":
        // A page without a mood matches no mood: coalesce turns NULL into false, so -mood:5 finds it.
        return [`coalesce(p.mood ${t.op} ?, 0)`, [t.value]];
      case "before":
        return ["p.date < ?", [t.value]];
      case "after":
        return ["p.date > ?", [t.value]];
    }
  }

  return {
    // ── Journals ──────────────────────────────────────────────────────────────────────────────

    /** Every journal of the owner, recycle bin included, in their order. */
    journals(owner: string): Journal[] {
      return journalRows(owner).map(toJournal);
    },

    createJournal(owner: string, input: unknown): Journal {
      const b = objectBody(input);
      const name = journalName(b.name);
      return transaction(() => {
        let journalColor: Color;
        if (b.color !== undefined) journalColor = color(b.color);
        else {
          // The first colour no journal has yet.
          const used = new Set(journalRows(owner).map((j) => j.color));
          journalColor = COLORS.find((c) => !used.has(c)) ?? COLORS[0];
        }
        return toJournal(journalRow(owner, addJournal(owner, name, journalColor, null)));
      });
    },

    /** Renames, recolours or sets the default template of a journal. */
    updateJournal(owner: string, id: string, input: unknown): Journal {
      const row = liveJournal(owner, id);
      const b = objectBody(input);
      const name = b.name === undefined ? row.name : journalName(b.name);
      if (b.name !== undefined) checkNameFree(owner, name, id);
      const journalColor = b.color === undefined ? row.color : color(b.color);
      const templateId = b.templateId === undefined ? row.template_id : templateRef(owner, b.templateId);
      updateJournalRow.run(name, journalColor, templateId, new Date().toISOString(), id, owner);
      return toJournal(journalRow(owner, id));
    },

    /** Puts the owner's journals in this order (a list of all their ids). */
    orderJournals(owner: string, input: unknown): Journal[] {
      if (!Array.isArray(input)) invalid("Expected the list of journal ids, in order");
      const ids = new Set(journalRows(owner).map((j) => j.id));
      if (input.length !== ids.size || !input.every((id) => ids.delete(id as string))) {
        invalid("The list must have each of your journals once");
      }
      transaction(() => input.forEach((id, i) => setJournalPosition.run(i, id as string, owner)));
      return journalRows(owner).map(toJournal);
    },

    /** Moves a journal, with its pages, to the recycle bin. */
    deleteJournal(owner: string, id: string): Journal {
      const row = journalRow(owner, id);
      if (!row.deleted_at) setJournalDeleted.run(new Date().toISOString(), id, owner);
      return toJournal(journalRow(owner, id));
    },

    /** Takes a journal out of the recycle bin. */
    restoreJournal(owner: string, id: string): Journal {
      const row = journalRow(owner, id);
      if (row.deleted_at) {
        checkNameFree(owner, row.name, id);
        setJournalDeleted.run(null, id, owner);
      }
      return toJournal(journalRow(owner, id));
    },

    /** Deletes a journal and its pages for good. Only from the recycle bin. */
    purgeJournal(owner: string, id: string): void {
      const row = journalRow(owner, id);
      if (!row.deleted_at) throw new StoreError(409, "Move the journal to the recycle bin first.", "not-in-bin");
      deleteJournalRow.run(id, owner);
    },

    /** Empties the recycle bin of journals deleted more than BIN_DAYS ago. Returns how many went. */
    purge(now: number = Date.now()): number {
      const before = new Date(now - BIN_DAYS * 24 * 60 * 60_000).toISOString();
      return Number(purgeBin.run(before).changes);
    },

    // ── Pages ─────────────────────────────────────────────────────────────────────────────────

    /** A day's page. A day without one answers an empty page with rev 0. */
    getPage(owner: string, journalId: string, day: string): Page {
      liveJournal(owner, journalId);
      date(day);
      return toPage(journalId, day, pageRow(owner, journalId, day));
    },

    /**
     * Saves a day's page: { text, mood, rev }. rev is the one the page edited (0: none yet); if
     * the page changed since, the answer is 409 "conflict" with the page as it is now. Sending
     * what is already stored always succeeds, so a retry after a lost answer is harmless.
     */
    putPage(owner: string, journalId: string, day: string, input: unknown): PageSaved {
      liveJournal(owner, journalId);
      date(day);
      const b = objectBody(input);
      const pageText = text(b.text, "text", LIMITS.pageChars);
      const pageMood = mood(b.mood);
      if (!Number.isSafeInteger(b.rev) || (b.rev as number) < 0) invalid("rev must be a whole number");
      return transaction(() => {
        const row = pageRow(owner, journalId, day);
        if (row ? row.text === pageText && row.mood === pageMood : isEmpty(pageText, pageMood)) {
          return row
            ? { rev: row.rev, words: row.words, tags: tagsOf(row.text), updatedAt: row.updated_at }
            : EMPTY_SAVED;
        }
        if (b.rev !== (row?.rev ?? 0)) {
          throw new StoreError(
            409,
            "This page was changed somewhere else since you opened it.",
            "conflict",
            toPage(journalId, day, row),
          );
        }
        return storePage(owner, journalId, day, pageText, pageMood, row);
      });
    },

    /** The pages from one day to another (both included), without their text. */
    days(owner: string, query: { from?: unknown; to?: unknown; journal?: unknown }): DaySummary[] {
      const from = date(query.from, "from");
      const to = date(query.to, "to");
      const span = daysBetween(from, to);
      if (span < 0) invalid("from must not be after to");
      if (span >= LIMITS.dayRange) invalid(`At most ${LIMITS.dayRange} days at once`);
      const $journal = journalFilter(owner, query.journal);
      const rows = selectDays.all({ $owner: owner, $from: from, $to: to, $journal }) as unknown as SummaryRow[];
      return rows.map((row) => toSummary(row, PREVIEW_CHARS));
    },

    /** The pages of the same day in earlier years, newest first. */
    onThisDay(owner: string, query: { date?: unknown; journal?: unknown }): DaySummary[] {
      const day = date(query.date);
      const $journal = journalFilter(owner, query.journal);
      const $days = JSON.stringify(anniversaryDays(day));
      const rows = selectMemories.all({ $owner: owner, $days, $date: day, $journal }) as unknown as SummaryRow[];
      return rows.map((row) => toSummary(row, MEMORY_CHARS));
    },

    /** Days in a row with a page (in any journal, or one), ending today or yesterday. */
    streak(owner: string, query: { today?: unknown; journal?: unknown }): Streak {
      const day = date(query.today, "today");
      const $journal = journalFilter(owner, query.journal);
      let expected: string | null = null;
      let days = 0;
      for (const row of selectWrittenDays.iterate({ $owner: owner, $today: day, $journal })) {
        const written = (row as { date: string }).date;
        // The streak may end yesterday: today isn't over yet.
        if (expected === null) expected = written === day ? day : addDays(day, -1);
        if (written !== expected) break;
        days++;
        expected = addDays(expected, -1);
      }
      return { days };
    },

    /** Every tag in the owner's pages, with how many pages have it. */
    tags(owner: string): TagCount[] {
      return selectTags.all(owner) as unknown as TagCount[];
    },

    /** Pages matching a search (see shared/query.ts), newest first. */
    search(owner: string, query: { q?: unknown; journal?: unknown }): SearchAnswer {
      const q = text(query.q ?? "", "The search", LIMITS.queryChars);
      const $journal = journalFilter(owner, query.journal);
      const terms = parseQuery(q);
      if (terms.length === 0) return { hits: [], more: false };
      const conditions = ["p.owner = ?"];
      const params: SQLInputValue[] = [owner];
      if ($journal) {
        conditions.push("p.journal_id = ?");
        params.push($journal);
      }
      for (const t of terms) {
        const [sql, values] = termSql(t);
        conditions.push(t.negate ? `NOT (${sql})` : sql);
        params.push(...values);
      }
      const rows = db
        .prepare(
          `SELECT p.journal_id, p.date, p.mood, p.text FROM live_pages p WHERE ${conditions.join(" AND ")}
           ORDER BY p.date DESC, p.journal_id LIMIT ${LIMITS.searchResults + 1}`,
        )
        .all(...params) as unknown as { journal_id: string; date: string; mood: Mood | null; text: string }[];
      return {
        hits: rows.slice(0, LIMITS.searchResults).map((row) => ({
          journalId: row.journal_id,
          date: row.date,
          mood: row.mood,
          ...snippetOf(row.text, terms),
        })),
        more: rows.length > LIMITS.searchResults,
      };
    },

    // ── Templates and settings ────────────────────────────────────────────────────────────────

    templates(owner: string): Template[] {
      return (selectTemplates.all(owner) as unknown as TemplateRow[]).map(toTemplate);
    },

    createTemplate(owner: string, input: unknown): Template {
      const b = objectBody(input);
      const name = templateName(b.name);
      const body = text(b.text ?? "", "The template", LIMITS.templateChars);
      if (selectTemplates.all(owner).length >= LIMITS.templates) {
        throw new StoreError(409, `At most ${LIMITS.templates} templates`, "too-many");
      }
      const now = new Date().toISOString();
      return toTemplate(insertTemplate.get(randomUUID(), owner, name, body, now, now) as unknown as TemplateRow);
    },

    updateTemplate(owner: string, id: string, input: unknown): Template {
      const row = (selectTemplate.get(id, owner) as TemplateRow | undefined) ?? notFound("template");
      const b = objectBody(input);
      const name = b.name === undefined ? row.name : templateName(b.name);
      const body = b.text === undefined ? row.text : text(b.text, "The template", LIMITS.templateChars);
      const now = new Date().toISOString();
      return toTemplate(updateTemplateRow.get(name, body, now, id, owner) as unknown as TemplateRow);
    },

    /** Deletes a template. Journals that offered it first no longer do. */
    deleteTemplate(owner: string, id: string): void {
      if (Number(deleteTemplateRow.run(id, owner).changes) === 0) notFound("template");
    },

    settings: getSettings,

    putSettings(owner: string, input: unknown): Settings {
      const settings = settingsValue(input);
      upsertSettings.run(owner, JSON.stringify(settings));
      return settings;
    },

    // ── Users, export and import ──────────────────────────────────────────────────────────────

    /**
     * Deletes for good everything (journals, pages, templates, settings, recycle bin included) of
     * every owner who isn't in `known` (Heimdall's usernames), i.e. of users removed from Heimdall.
     * Returns how much each of them had.
     */
    removeUnknownOwners(known: ReadonlySet<string>): { owner: string; journals: number; pages: number }[] {
      const $known = JSON.stringify([...known]);
      return transaction(() => {
        const removed = countUnknownOwners.all({ $known }) as { owner: string; journals: number; pages: number }[];
        for (const stmt of deleteUnknown) stmt.run({ $known });
        return removed;
      });
    },

    /** Every journal (recycle bin left out) with its pages, the templates and the settings. */
    exportAll(owner: string): ExportFile {
      const templates = (selectTemplates.all(owner) as unknown as TemplateRow[]).map(toTemplate);
      const templateName = new Map(templates.map((t) => [t.id, t.name]));
      const journals: ExportJournal[] = journalRows(owner)
        .filter((j) => !j.deleted_at)
        .map((j) => ({
          name: j.name,
          color: j.color,
          template: (j.template_id && templateName.get(j.template_id)) ?? null,
          pages: (selectPages.all(j.id, owner) as unknown as PageRow[]).map((p): ExportPage => ({
            date: p.date,
            text: p.text,
            mood: p.mood,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
          })),
        }));
      return {
        format: "papyrus",
        version: 1,
        exportedAt: new Date().toISOString(),
        journals,
        templates: templates.map(({ name, text: body }) => ({ name, text: body })),
        settings: getSettings(owner),
      };
    },

    /**
     * Adds an export file to the owner's journals. Journals are matched by name, templates by name
     * and text. A day that already has a page keeps it: the same text (or text it already holds)
     * is skipped, text that holds the page's replaces it, and anything else is added after it. So
     * importing the same file twice changes nothing. Everything is checked before anything is
     * written: a bad file changes nothing.
     */
    importAll(owner: string, input: unknown): ImportResult {
      const b = objectBody(input);
      if (b.format !== "papyrus" || b.version !== 1) {
        invalid("This is not a Papyrus export file (format papyrus, version 1)");
      }
      if (!Array.isArray(b.journals)) invalid("The file must have a journals list");
      const now = new Date().toISOString();
      let pageCount = 0;
      const within = <T>(where: string, fn: () => T): T => {
        try {
          return fn();
        } catch (err) {
          if (err instanceof StoreError) invalid(`${where}: ${err.message}`);
          throw err;
        }
      };
      const journals = b.journals.map((value, i) =>
        within(`Journal ${i + 1}`, () => {
          const j = objectBody(value);
          if (!Array.isArray(j.pages)) invalid("pages must be a list");
          pageCount += j.pages.length;
          if (pageCount > LIMITS.importPages) invalid(`At most ${LIMITS.importPages} pages can be imported at once`);
          return {
            name: journalName(j.name),
            color: COLORS.includes(j.color as Color) ? (j.color as Color) : COLORS[0],
            template: typeof j.template === "string" ? j.template : null,
            pages: j.pages.map((pv, k) =>
              within(`Page ${k + 1}`, () => {
                const p = objectBody(pv);
                return {
                  date: date(p.date),
                  text: text(p.text ?? "", "text", LIMITS.pageChars),
                  mood: mood(p.mood),
                  times: { createdAt: isoOr(p.createdAt, now), updatedAt: isoOr(p.updatedAt, now) },
                };
              }),
            ),
          };
        }),
      );
      const templates = (Array.isArray(b.templates) ? b.templates : []).map((value, i) =>
        within(`Template ${i + 1}`, () => {
          const t = objectBody(value);
          return { name: templateName(t.name), text: text(t.text ?? "", "The template", LIMITS.templateChars) };
        }),
      );
      const settings = b.settings === undefined ? null : within("Settings", () => settingsValue(b.settings));

      return transaction(() => {
        const result: ImportResult = { journals: 0, templates: 0, pages: 0, merged: 0, skipped: 0 };

        const existing = selectTemplates.all(owner) as unknown as TemplateRow[];
        for (const t of templates) {
          if (existing.some((e) => e.name === t.name && e.text === t.text)) continue;
          if (existing.length >= LIMITS.templates) {
            throw new StoreError(409, `At most ${LIMITS.templates} templates`, "too-many");
          }
          existing.push(insertTemplate.get(randomUUID(), owner, t.name, t.text, now, now) as unknown as TemplateRow);
          result.templates++;
        }
        const templateId = (name: string | null) => (name && existing.find((e) => e.name === name)?.id) ?? null;

        for (const j of journals) {
          let id = journalRows(owner).find((row) => !row.deleted_at && sameName(row.name, j.name))?.id;
          if (!id) {
            id = addJournal(owner, j.name, j.color, templateId(j.template));
            result.journals++;
          }
          for (const p of j.pages) {
            if (isEmpty(p.text, p.mood)) continue;
            const row = pageRow(owner, id, p.date);
            if (!row) {
              storePage(owner, id, p.date, p.text, p.mood, undefined, p.times);
              result.pages++;
              continue;
            }
            let merged = row.text;
            if (row.text.includes(p.text)) merged = row.text;
            else if (p.text.includes(row.text)) merged = p.text;
            else merged = `${row.text}\n\n${p.text}`;
            if (merged.length > LIMITS.pageChars) {
              invalid(`${j.name} ${p.date}: the page would be longer than ${LIMITS.pageChars} characters`);
            }
            const mergedMood = row.mood ?? p.mood;
            if (merged === row.text && mergedMood === row.mood) {
              result.skipped++;
              continue;
            }
            storePage(owner, id, p.date, merged, mergedMood, row, { createdAt: row.created_at, updatedAt: now });
            result.merged++;
          }
        }

        if (settings) {
          const current = getSettings(owner);
          const next: Settings = {
            prompts: current.prompts ?? settings.prompts,
            weekStart: current.weekStart ?? settings.weekStart,
          };
          if (next.prompts !== current.prompts || next.weekStart !== current.weekStart) {
            upsertSettings.run(owner, JSON.stringify(next));
          }
        }
        return result;
      });
    },
  };
}

export type Store = ReturnType<typeof createStore>;
