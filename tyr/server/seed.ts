// Fills a development drawer with the UI pilot's example people, all of them made up:
//   pnpm --filter tyr seed [username]
// Only for the local data/ folder. It isn't built, so it never reaches a server.
import { randomUUID } from "node:crypto";
import type { CareLevel, Certainty, Outcome, Question, Setting, Source, Stamp } from "../shared/protocol.ts";
import { DB_FILE, openDatabase } from "./db.ts";
import { createStore } from "./dossier.ts";

if (process.env.NODE_ENV === "production" || process.env.STATE_DIRECTORY) {
  console.error("The example data is for development only.");
  process.exit(1);
}

const owner = process.argv[2] ?? "odin";
const db = openDatabase(DB_FILE);
let clock = new Date().toISOString();
const store = createStore(db, () => clock);
if (store.load(owner).people.length > 0) {
  console.error(`${owner} already has files in ${DB_FILE}. Delete it first to start over.`);
  process.exit(1);
}

function S(text: string): Stamp {
  if (text.startsWith("~")) return { d: text.slice(1), t: null, p: "around" };
  const [d = "", t] = text.split(" ");
  return { d, t: t ?? null, p: d.length === 4 ? "year" : d.length === 7 ? "month" : "date" };
}

const PLACES: Record<string, string> = {
  staff: "Staff room",
  cafe: "Cafeteria",
  lib: "School library",
  meet: "Department meeting room",
  sec: "Secretary’s office",
  court: "Courtyard",
  bakery: "Bakery on the corner",
  bus: "Bus 402",
  chess: "Chess club",
  champ: "Regional championship hall",
  pilates: "Pilates studio",
  espo: "Esperanto meetup",
  family: "Family Sunday lunch",
  news: "Newsstand by the station",
};

interface Seeded {
  name: string;
  role: string;
  opened: string;
  aliases?: string[];
  matters?: string[];
  closed?: { on: string; note: string };
}
const PEOPLE: Record<string, Seeded> = {
  sergio: { name: "Sérgio", role: "Former colleague · History", opened: "2025-05-12" },
  debora: {
    name: "Débora",
    role: "Chess club",
    opened: "2025-09-06",
    matters: ["Her grandfather’s openings", "Teaching beginners"],
  },
  claudio: { name: "Cláudio", role: "Runs the bakery on the corner", opened: "2025-11-18" },
  thiago: {
    name: "Thiago",
    role: "Chess club, until 2026",
    opened: "2025-12-01",
    closed: { on: "2026-06-30", note: "Left the club and the city. Nothing open." },
  },
  alvaro: {
    name: "Álvaro",
    role: "Colleague · Physical education",
    opened: "2026-02-09",
    matters: ["His Sunday runs"],
  },
  fernanda: {
    name: "Fernanda",
    aliases: ["Fê"],
    role: "Colleague · Portuguese",
    opened: "2026-03-02",
    matters: ["Her students", "The poetry anthology", "Her garden", "Samba de roda on Saturdays"],
  },
  beatriz: { name: "Beatriz", role: "Coordinator", opened: "2026-03-04" },
  helio: { name: "Hélio", aliases: ["Seu Hélio"], role: "Caretaker at school", opened: "2026-03-10" },
  camila: { name: "Camila", role: "School librarian", opened: "2026-03-16" },
  marcos: {
    name: "Marcos",
    role: "Colleague · Mathematics",
    opened: "2026-04-01",
    matters: ["His mother", "Botafogo", "The transfer"],
  },
  jussara: { name: "Jussara", role: "School secretary", opened: "2026-04-20" },
  lourdes: { name: "Lourdes", aliases: ["Tia Lourdes"], role: "Aunt · mother’s side", opened: "2026-05-03" },
  icaro: { name: "Ícaro", role: "Pilates instructor", opened: "2026-06-15" },
  rafaela: { name: "Rafaela", role: "Esperanto group", opened: "2026-07-11" },
  gustavo: { name: "Gustavo", role: "Met at the regional championship", opened: "2026-09-13" },
  ze: { name: "Zé", role: "Newsstand by the station", opened: "2026-10-02" },
};

interface Options {
  hap?: string;
  place?: string;
  setting?: Setting;
  q?: boolean;
  cat?: Question;
  cert?: Certainty;
  conf?: boolean;
  present?: string[];
  ctx?: string;
  fu?: { date: string; note: string; done?: boolean };
  amends?: string;
  contra?: string;
  incomplete?: boolean;
}

const fileIds = new Map<string, string>();
const placeLabel = (key?: string) => (key ? (PLACES[key] ?? null) : null);

/** Logs an entry as if it had been typed a little after it was told. */
function E(person: string, told: string, src: Source, body: string, o: Options = {}): string {
  const ts = S(told);
  const id = randomUUID();
  const fields = {
    told: ts,
    hap: o.hap ? S(o.hap) : ts,
    place: placeLabel(o.place),
    setting: o.setting ?? null,
    src,
    wording: o.q ? "quote" : "para",
    body,
    cat: o.cat ?? null,
    cert: o.cert ?? "sure",
    conf: o.conf ?? false,
    present: o.present ?? [],
    ctx: o.ctx ?? "",
    fu: o.fu ? { date: o.fu.date, note: o.fu.note } : null,
    contra: o.contra ?? null,
  };
  clock = new Date(new Date(`${ts.d}T${ts.t ?? "20:00"}:00`).getTime() + 95 * 60_000).toISOString();
  const seeded = PEOPLE[person]!;
  if (!fileIds.has(person)) {
    const fileId = randomUUID();
    fileIds.set(person, fileId);
    store.openFile(owner, {
      id: fileId,
      name: seeded.name,
      role: seeded.role,
      opened: seeded.opened,
      entry: { ...fields, id, incomplete: o.incomplete ?? false },
    });
    if (o.amends) throw new Error("A file's first entry can't amend anything");
  } else {
    store.addEntry(owner, {
      ...fields,
      id,
      person: fileIds.get(person),
      amends: o.amends ?? null,
      incomplete: o.incomplete ?? false,
    });
  }
  if (o.fu?.done) store.fileEntry(owner, id, { fuDone: o.fu.date });
  return id;
}

/* Sérgio: dormant, no contact since March */
E("sergio", "2025-05-12 10:05", "U", "Wants to finish his master’s on the 1930s strikes before he turns 40.", {
  place: "staff",
  cat: "wants",
});
E("sergio", "2025-11-20 12:15", "U", "Collects old school yearbooks from flea markets.", { place: "cafe", cat: "joy" });
E("sergio", "2026-03-05 18:20", "U", "Moving to Curitiba in April for his wife’s new job.", {
  place: "bakery",
  cat: "chapter",
  fu: { date: "2026-06-01", note: "Ask how Curitiba is treating him" },
});

/* Débora */
E(
  "debora",
  "2025-09-06 15:00",
  "U",
  "I play the Caro-Kann because my grandfather did. It’s the only thing of his I still have.",
  { q: true, place: "chess", cat: "shaped", ctx: "after our first game" },
);
E("debora", "2025-10-31 16:30", "U", "Her first rated tournament is in December and she is nervous about it.", {
  place: "chess",
  cat: "chapter",
  fu: { date: "2025-12-20", note: "Ask how the tournament went", done: true },
});
const d3 = E("debora", "2026-07-20 19:00", "N", "She is avoiding me.", {
  place: "chess",
  cat: "others",
  cert: "fair",
  ctx: "third Tuesday in a row without her",
});
E(
  "debora",
  "2026-08-03 18:45",
  "U",
  "Switched to the afternoon shift at work; that is why she stopped coming on Tuesdays.",
  { place: "chess", cat: "rhythms", amends: d3 },
);
E("debora", "2026-10-13 19:30", "O", "Stayed after club to teach two beginners the Lucena position.", {
  place: "chess",
  cat: "others",
});

/* Cláudio */
E("claudio", "2025-11-18 07:20", "U", "Came from Minas Gerais in 1994 with his father’s pão de queijo recipe.", {
  hap: "1994",
  place: "bakery",
  cat: "shaped",
});
E("claudio", "2026-05-22 18:10", "O", "Keeps the last broas aside for regulars after 18:00.", {
  place: "bakery",
  cat: "others",
});
E("claudio", "2026-10-17 07:15", "U", "Wants to open a second shop before his son finishes university.", {
  place: "bakery",
  cat: "wants",
});

/* Thiago: closed file */
E("thiago", "2026-01-15 19:00", "U", "Moving to Porto Alegre for a job in June.", { place: "chess", cat: "chapter" });

/* Álvaro */
const a1 = E("alvaro", "2026-02-09 09:40", "U", "Runs 10 km every Sunday morning, rain or not.", {
  place: "staff",
  cat: "rhythms",
});
const a2 = E("alvaro", "2026-05-05 12:20", "U", "I’m terrible at paperwork. I just copy whoever does it well.", {
  q: true,
  place: "cafe",
  cat: "self",
});
E("alvaro", "2026-09-12 16:00", "U", "Said he would bring back the projector cable on Monday.", { place: "staff" });
const a4 = E(
  "alvaro",
  "2026-10-09 15:30",
  "O",
  "Presented the interdisciplinary project outline as his own. It matched the draft I shared with him in August, section by section.",
  { place: "meet", setting: "group", cat: "others", present: ["Beatriz", "Marcos", "Fernanda"] },
);
const a5 = E(
  "alvaro",
  "2026-10-22 09:05",
  "O",
  "Covered my 4th period without being asked when I was stuck on bus 402.",
  { place: "staff", cat: "others" },
);
E(
  "alvaro",
  "2026-10-23 10:10",
  "P",
  "I asked about the project outline. He said Beatriz told him to “put a name on it”, and he put his.",
  { place: "staff", setting: "private", cat: "others" },
);

/* Fernanda: the full example file */
const f1 = E(
  "fernanda",
  "2026-03-02 10:15",
  "U",
  "I became a teacher because a teacher once read my poem aloud to the class. I never forgot it.",
  { q: true, hap: "~1998", place: "staff", cat: "drives", ctx: "first week back" },
);
const f2 = E(
  "fernanda",
  "2026-03-19 12:30",
  "U",
  "Wants to get the students’ poetry anthology printed before the end of the school year.",
  { place: "cafe", cat: "wants", fu: { date: "2026-11-20", note: "Ask how the anthology is going" } },
);
const f14 = E(
  "fernanda",
  "2026-03-26 08:10",
  "U",
  "Asked me to sit on her right in meetings; she hears better on that side.",
  { place: "meet", cat: "treat" },
);
const f3 = E(
  "fernanda",
  "2026-04-08 12:45",
  "O",
  "Gave her lunch to a student who had none, and didn’t mention it to anyone.",
  { place: "cafe", cat: "values" },
);
const f4 = E("fernanda", "2026-05-14 15:40", "U", "Hospitals are hard for her since her father’s last year.", {
  place: "bus",
  setting: "private",
  cat: "fears",
  conf: true,
});
const f5 = E(
  "fernanda",
  "2026-06-02 10:00",
  "P",
  "I asked whether she would apply for coordinator. She said no, she would rather stay in the classroom.",
  { place: "staff", setting: "group", cat: "values" },
);
const f6 = E("fernanda", "2026-08-14 14:05", "O", "Went quiet when money came up.", {
  place: "staff",
  setting: "group",
  cat: "stress",
  present: ["Álvaro", "Jussara"],
});
const f7 = E("fernanda", "2026-09-10 11:00", "U", "I don’t care what the coordinator thinks of my reports.", {
  q: true,
  place: "staff",
  cat: "self",
});
const f8 = E(
  "fernanda",
  "2026-09-18 19:05",
  "O",
  "Rewrote her bimonthly report three times after Beatriz’s comment; stayed until 19:00.",
  { place: "staff", cat: "stress", contra: f7 },
);
const f9 = E("fernanda", "2026-10-03 17:20", "I", "Mid-November is hard for her. It is when her father died.", {
  place: "bakery",
  setting: "private",
  cat: "shaped",
  ctx: "I asked how she was doing",
});
const f10 = E(
  "fernanda",
  "2026-10-03 17:35",
  "I",
  "Her garden is the one place her head goes quiet. She is growing pitangas.",
  { place: "bakery", setting: "private", cat: "joy" },
);
const f16 = E(
  "fernanda",
  "2026-10-15 12:40",
  "U",
  "The anthology moves to next year; the printer’s quote was too high.",
  { place: "cafe", cat: "wants", amends: f2 },
);
const f11 = E("fernanda", "2026-10-22 16:10", "U", "Samba de roda on Saturdays is my church.", {
  q: true,
  place: "lib",
  cat: "joy",
  present: ["Camila"],
});
const f12 = E("fernanda", "2026-10-28 18:40", "U", "Said she will bring me her copy of Vidas Secas next week.", {
  place: "bus",
  cat: "likes",
});
const f13 = E(
  "fernanda",
  "2026-10-28 22:10",
  "N",
  "She sees herself as the one who looks after others, and doesn’t let anyone look after her.",
  { cat: "self", cert: "fair" },
);

/* Beatriz */
E("beatriz", "2026-03-04 08:30", "O", "Reads every report herself, with a green pen.", {
  place: "meet",
  cat: "values",
});
E("beatriz", "2026-08-19 11:00", "U", "Wants the school in the state reading olympiad finals next year.", {
  place: "meet",
  setting: "group",
  cat: "wants",
});

/* Hélio */
E("helio", "2026-03-10 06:50", "U", "Thirty-one years in this building. I know every leak.", {
  q: true,
  place: "court",
  cat: "shaped",
});
E("helio", "2026-09-02 06:35", "O", "Feeds the courtyard cats every morning at 06:30.", { place: "court", cat: "joy" });

/* Camila */
E("camila", "2026-03-16 13:00", "U", "Restoring old books is what she would do all day if she could.", {
  place: "lib",
  cat: "joy",
});
E("camila", "2026-10-22 16:15", "U", "Wants the library open on Saturdays for the neighbourhood kids.", {
  place: "lib",
  cat: "wants",
  present: ["Fernanda"],
});

/* Marcos */
const m0 = E("marcos", "2026-07-08 12:30", "U", "Never misses a Botafogo home game. Lights up talking about it.", {
  place: "cafe",
  cat: "joy",
});
const m1 = E("marcos", "2026-09-23 07:10", "U", "My brother Rodrigo was arrested on Saturday. I’m only telling you.", {
  q: true,
  hap: "2026-09-19",
  place: "staff",
  setting: "private",
  conf: true,
  cat: "chapter",
});
const m2 = E("marcos", "2026-09-23 07:15", "U", "Rodrigo was released on Monday. The hearing is still pending.", {
  hap: "2026-09-21",
  place: "staff",
  setting: "private",
  cat: "chapter",
});
const m3 = E("marcos", "2026-10-06 07:40", "O", "Arrived late three days in a row; looked like he hadn’t slept.", {
  place: "staff",
  cat: "stress",
});
E("marcos", "2026-10-09 12:40", "P", "I asked how the family was holding up. He said his mother won’t talk about it.", {
  place: "cafe",
  setting: "private",
  cat: "chapter",
});
const m5 = E("marcos", "2026-10-20 12:35", "U", "Wants to transfer to a school closer to his mother.", {
  place: "cafe",
  cat: "wants",
  fu: { date: "2026-11-25", note: "Ask about the transfer, only if he brings up school" },
});
E(
  "marcos",
  "2026-10-27 08:00",
  "O",
  "Saw his transfer request in the coordination tray before he had mentioned filing it.",
  { place: "sec" },
);

/* Jussara */
E("jussara", "2026-04-20 10:00", "U", "Collects postcards from places she has never been.", {
  place: "sec",
  cat: "joy",
});
E("jussara", "2026-08-26 10:30", "I", "Plans to retire in 2028 and take the train across Argentina.", {
  place: "sec",
  cat: "wants",
});
E("jussara", "2026-10-30 09:50", "U", "Got a postcard from Lisbon.", { cat: "joy", incomplete: true });

/* Lourdes */
E("lourdes", "2026-05-03 13:30", "U", "Still keeps my grandmother’s sewing box, untouched.", {
  place: "family",
  cat: "values",
});
E("lourdes", "2026-07-05 15:00", "O", "Argued with cousin Paulo about selling the old house, and left the table.", {
  place: "family",
  setting: "group",
});
E("lourdes", "2026-08-30 14:10", "O", "Changed the subject twice when I mentioned travelling.", {
  place: "family",
  setting: "group",
  cat: "others",
});

/* Ícaro, Rafaela, Gustavo, Zé */
E("icaro", "2026-06-15 07:00", "U", "Danced professionally until 24, then moved to teaching Pilates.", {
  place: "pilates",
  cat: "shaped",
});
E("icaro", "2026-09-17 07:55", "U", "Can’t stand people checking their phones mid-class.", {
  place: "pilates",
  cat: "irks",
});
E("rafaela", "2026-07-11 20:00", "U", "Esperanto is the first place I felt I wasn’t foreign.", {
  q: true,
  place: "espo",
  cat: "shaped",
});
E("rafaela", "2026-10-24 20:30", "U", "Wants to attend the next Universala Kongreso in person.", {
  place: "espo",
  cat: "wants",
});
E("gustavo", "2026-09-13 15:20", "U", "Plays blitz online most nights after 23:00; says it is how he unwinds.", {
  place: "champ",
  cat: "rhythms",
  ctx: "between rounds 3 and 4",
});
E("ze", "2026-10-02 07:05", "O", "Calls everyone “professor”, students included.", { place: "news", cat: "treat" });

/* A file's own details */
for (const [key, p] of Object.entries(PEOPLE)) {
  const id = fileIds.get(key)!;
  store.changeFile(owner, id, { aliases: p.aliases ?? [], matters: p.matters ?? [] });
  if (p.closed) store.changeFile(owner, id, { closed: p.closed });
}

/* Profile answers, written by me, each pointing back to entries */
const ANSWERS: [string, Question, string, string, string[]][] = [
  [
    "fernanda",
    "drives",
    "Being for her students what one teacher once was for her: someone who notices.",
    "2026-10-20",
    [f1, f3],
  ],
  [
    "fernanda",
    "wants",
    "To get the students’ poetry anthology printed. Now planned for next year.",
    "2026-10-15",
    [f2, f16],
  ],
  ["fernanda", "values", "Quiet generosity, done without an audience.", "2026-04-10", [f3, f5]],
  ["fernanda", "fears", "Hospitals, and what they stand for since her father’s last year.", "2026-05-14", [f4]],
  [
    "fernanda",
    "self",
    "Says the coordinator’s judgement doesn’t touch her. My reading: she looks after others and won’t be looked after.",
    "2026-10-28",
    [f7, f13],
  ],
  ["fernanda", "others", "Generous with students. Careful, a little guarded, with colleagues.", "2026-09-01", [f3, f6]],
  [
    "fernanda",
    "shaped",
    "A teacher who read her poem aloud. Her father’s death, in a mid-November.",
    "2026-10-03",
    [f1, f9],
  ],
  [
    "fernanda",
    "stress",
    "Under stress she goes quiet and redoes the work until it is flawless. Confused: not seen yet. At her best: in the library with students, or at samba on Saturdays.",
    "2026-10-22",
    [f6, f8, f11],
  ],
  [
    "fernanda",
    "contra",
    "Says the coordinator’s opinion doesn’t matter, then rewrites a report three times after one comment.",
    "2026-09-18",
    [f7, f8],
  ],
  ["fernanda", "joy", "Her garden and its pitangas, samba de roda, her students’ poems.", "2026-10-22", [f10, f11]],
  [
    "fernanda",
    "likes",
    "Graciliano Ramos, pitanga, samba de roda. Gift idea: good pruning shears.",
    "2026-10-28",
    [f10, f11, f12],
  ],
  ["fernanda", "treat", "Sit on her right. Direct, no fuss; she shrugs off praise.", "2026-03-26", [f14]],
  ["fernanda", "chapter", "Reworking the anthology plan, heading into a hard November.", "2026-10-15", [f9, f16]],
  ["fernanda", "rhythms", "Mornings at school. Usually on bus 402 after the late shift.", "2026-10-28", [f12]],
  ["marcos", "wants", "A transfer to a school closer to his mother.", "2026-10-20", [m5]],
  ["marcos", "joy", "Botafogo. Never misses a home game.", "2026-07-08", [m0]],
  ["marcos", "chapter", "A family crisis around his brother; thinking of moving schools.", "2026-10-20", [m1, m2, m5]],
  ["marcos", "stress", "Sleeps badly and runs late, but keeps showing up.", "2026-10-06", [m3]],
  ["alvaro", "self", "Calls himself bad at paperwork; copies whoever does it well.", "2026-05-05", [a2]],
  [
    "alvaro",
    "others",
    "Steps in for people without being asked. Loose about whose work is whose.",
    "2026-10-23",
    [a4, a5],
  ],
  ["alvaro", "rhythms", "Sunday mornings: 10 km, rain or not.", "2026-02-09", [a1]],
];
for (const [person, q, text, revised, ev] of ANSWERS) {
  store.addAnswer(owner, { id: randomUUID(), person: fileIds.get(person), q, text, ev, revised });
}

/* What the entries above left out: credit, care, word given, concerns, corrections, reports, incidents */
const logged = () => store.load(owner).entries;
const byBody = (text: string) => {
  const found = logged().find((e) => e.body.startsWith(text));
  if (!found) throw new Error(`No entry starting ${text}`);
  return found.id;
};
const file = (key: string) => fileIds.get(key)!;
for (const text of [
  "Stayed after club",
  "Keeps the last broas",
  "Covered my 4th period",
  "Gave her lunch",
  "Feeds the courtyard cats",
]) {
  store.fileEntry(owner, byBody(text), { credit: true });
}

const CARE: [string, CareLevel, string, string, string | null, string, string?][] = [
  ["fernanda", "never", "Don’t bring up hospitals.", "2026-05-14", f4, "2026-10-03"],
  ["fernanda", "ifthey", "Her divorce. Only if she raises it.", "2026-06-10", null, "2026-09-01"],
  [
    "fernanda",
    "watch",
    "Money. She went quiet when it came up; an observation until it repeats.",
    "2026-08-14",
    f6,
    "2026-08-14",
  ],
  ["fernanda", "practical", "Sit on her right in meetings.", "2026-03-26", f14, "2026-10-09"],
  ["fernanda", "welcome", "Her garden, samba de roda, the anthology.", "2026-10-03", f10, "2026-10-22"],
  [
    "fernanda",
    "careful",
    "Mid-November is hard for her. Be gentle this week.",
    "2026-10-03",
    f9,
    "2026-10-03",
    "11-15",
  ],
  ["marcos", "ifthey", "His brother. Only if he raises it, and never in a group.", "2026-09-23", m1, "2026-10-20"],
  [
    "marcos",
    "welcome",
    "Botafogo; the chess problem he leaves on the staff-room board.",
    "2026-07-08",
    m0,
    "2026-10-20",
  ],
  [
    "lourdes",
    "watch",
    "My travel plans. She changes the subject.",
    "2026-08-30",
    byBody("Changed the subject"),
    "2026-08-30",
  ],
  ["icaro", "practical", "Phone away before class starts.", "2026-09-17", null, "2026-09-17"],
  ["alvaro", "welcome", "Running; anything about the Sunday 10 km.", "2026-02-09", a1, "2026-10-22"],
];
for (const [person, level, text, since, source, confirmed, date] of CARE) {
  const id = randomUUID();
  store.addCare(owner, { id, person: file(person), level, text, since, source, date: date ?? null });
  store.changeCare(owner, id, { confirmed });
}

const WORDS: [string, "me" | "they", string, string, string | null, Outcome, string | null, string | null][] = [
  [
    "fernanda",
    "they",
    "I’ll bring you my copy of Vidas Secas next week.",
    "2026-10-28",
    "2026-11-06",
    "pending",
    null,
    f12,
  ],
  [
    "fernanda",
    "me",
    "I’ll help with the anthology budget spreadsheet.",
    "2026-09-30",
    "2026-10-20",
    "kept",
    "2026-10-15",
    null,
  ],
  [
    "alvaro",
    "they",
    "I’ll bring the projector cable back on Monday.",
    "2026-09-12",
    "2026-09-14",
    "pending",
    null,
    byBody("Said he would bring back"),
  ],
  ["marcos", "me", "I’ll cover your 2nd period on the hearing day.", "2026-10-14", "2026-11-12", "pending", null, null],
  ["marcos", "they", "I’ll tell you myself if I file for the transfer.", "2026-10-20", null, "pending", null, null],
  ["debora", "me", "I’ll bring the endgame book to club.", "2026-10-13", "2026-10-20", "kept", "2026-10-20", null],
  [
    "sergio",
    "me",
    "I’ll send you scans of the 1932 yearbook.",
    "2026-03-05",
    "2026-03-31",
    "released",
    "2026-04-02",
    null,
  ],
];
for (const [person, dir, words, made, due, outcome, on, source] of WORDS) {
  const id = randomUUID();
  store.addWord(owner, { id, person: file(person), dir, words, made, due, source });
  if (on) store.settleWord(owner, id, { outcome, on });
}

const addConcern = (person: string, text: string, opened: string, review: string, ev: string[]) => {
  const id = randomUUID();
  store.addConcern(owner, { id, person: file(person), text, opened, review, ev });
  return id;
};
addConcern(
  "alvaro",
  "He may have presented my project draft as his own at the department meeting.",
  "2026-10-10",
  "2026-10-24",
  [a4, byBody("I asked about the project outline")],
);
addConcern(
  "marcos",
  "He said he would tell me himself if he filed for the transfer. I found out from the tray.",
  "2026-10-27",
  "2026-11-27",
  [byBody("Saw his transfer request")],
);
store.reviewConcern(
  owner,
  addConcern("sergio", "He seemed to leave without saying goodbye to the department.", "2026-03-20", "2026-04-20", []),
  {
    state: "dismissed",
    on: "2026-04-20",
    note: "He had a farewell lunch I wasn’t told about. Nothing to hold.",
  },
);
store.addCorrection(owner, {
  id: randomUUID(),
  person: file("debora"),
  on: "2026-08-03",
  text: "I read her absence as avoidance. She had changed shifts.",
  entry: d3,
});
store.addReport(owner, {
  id: randomUUID(),
  person: file("alvaro"),
  text: "Told the coordinator I’m hard to work with on shared projects.",
  by: "Jussara",
  told: S("2026-10-20 10:15"),
  hap: S("2026-10"),
  place: PLACES.sec,
});

const arrest = randomUUID();
store.addIncident(owner, {
  id: arrest,
  title: "Rodrigo’s arrest",
  status: "one",
  people: [file("marcos")],
  mentions: ["Rodrigo, Marcos’s brother", "Their mother"],
  opened: "2026-09-23",
});
for (const entry of [m1, m2]) store.fileEntry(owner, entry, { incident: arrest });
store.addIncidentNote(owner, arrest, {
  id: randomUUID(),
  text: "The hearing is set for mid-November.",
  by: "Jussara",
  told: S("2026-10-14 10:20"),
  hap: S("2026-10-14"),
  place: PLACES.sec,
});

const house = randomUUID();
store.addIncident(owner, {
  id: house,
  title: "Argument over the old house",
  status: "confirmed",
  people: [file("lourdes")],
  mentions: ["Cousin Paulo"],
  opened: "2026-07-05",
});
store.fileEntry(owner, byBody("Argued with cousin Paulo"), { incident: house });
const made = E("lourdes", "2026-08-30 14:00", "O", "They sat together at the August lunch and joked about it.", {
  place: "family",
  setting: "group",
});
store.fileEntry(owner, made, { incident: house, credit: true });
store.changeIncident(owner, house, {
  closed: { on: "2026-08-30", note: "Settled between them. Nothing for me to carry." },
});

const loaded = store.load(owner);
db.close();
console.log(`${owner}: ${loaded.people.length} files, ${loaded.entries.length} entries, in ${DB_FILE}`);
