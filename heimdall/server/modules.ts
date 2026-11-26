// What Bifrost says about each module. Which modules it lists, and at what address, comes from the
// RETURN_ORIGIN_<MODULE> variables the installer gives Heimdall, so only installed modules appear.

export interface ModuleInfo {
  /** The name users see. */
  name: string;
  /** What it is, in a few words. */
  what: string;
  /** A brief explanation, shown in the tooltip. */
  about: string;
}

export const MODULES: Readonly<Record<string, ModuleInfo>> = {
  loggbok: {
    name: "Loggbok",
    what: "Notes",
    about: "A notes manager. Your notes are yours alone, unless you share one with someone.",
  },
  yggdrasil: {
    name: "Yggdrasil",
    what: "Outliner",
    about:
      "One tree of bullets for everything, in the style of Workflowy and Dynalist. Zoom into any bullet to work on just that part.",
  },
  janus: {
    name: "Janus",
    what: "Password manager",
    about:
      "A vault of passwords in the style of KeePass: groups, entries with username, password, URL and notes, and two-factor (TOTP) codes.",
  },
  papyrus: {
    name: "Papyrus",
    what: "Journal",
    about:
      "One page for every day, in as many journals as you like (a diary, a work log, dreams…), with an optional mood and #tags.",
  },
  vinr: {
    name: "Vinr",
    what: "Contacts",
    about:
      "Your contacts: phones, emails, addresses, birthdays and other dates to remember, in groups. Vinr is Old Norse for “friend”.",
  },
  chronos: {
    name: "Chronos",
    what: "Calendar",
    about:
      "Any number of calendars, each with a colour, shown or hidden as you like. Events are made here or imported from .ics files.",
  },
  valkyrie: {
    name: "Valkyrie",
    what: "Kanban boards",
    about: "Boards with lists side by side, and cards that move along the lists as the work goes.",
  },
  althing: {
    name: "Althing",
    what: "Chat",
    about:
      "Real-time chat: a lobby, rooms anyone can open, and direct messages, under a nickname. Everything said there stays on record.",
  },
  mimir: {
    name: "Mimir",
    what: "Mind maps",
    about:
      "Maps that start from one idea in the middle and branch out to both sides, laid out by themselves as they grow.",
  },
  urd: {
    name: "Urd",
    what: "Time tracker",
    about:
      "One clock and one Play/Stop button, open all day. It tells you how much effective work you did and how often you were interrupted.",
  },
  star: {
    name: "Every Man is a Star",
    what: "People and their families",
    about:
      "The people you know and their families, charted as a night sky. Each bright star is someone you know, with their family around them.",
  },
  fafnir: {
    name: "Fafnir Personal Finances",
    what: "Personal finances",
    about:
      "What you have, what you owe and where your money goes, with crypto, loans and budgets, added up in US dollars.",
  },
  tyr: {
    name: "Tyr",
    what: "Dossier of people",
    about:
      "What people said, when and where, and how you came to know it: what matters to them, what they fear, how they treat others.",
  },
  valhalla2: {
    name: "Valhalla 2",
    what: "AI companions",
    about:
      "Companions you define, who talk with you through the Claude API and remember, or through Grok without memory.",
  },
};

/** The name and description of a module, or a plain one for a module Bifrost doesn't know. */
export function moduleInfo(key: string): ModuleInfo {
  return MODULES[key] ?? { name: key.charAt(0).toUpperCase() + key.slice(1), what: "", about: "" };
}

export interface OutsideLink extends ModuleInfo {
  url: string;
}

/** What else runs on the server without signing in through Heimdall, in the order shown. */
export const OUTSIDE_LINKS: readonly OutsideLink[] = [
  {
    name: "Habits Saga",
    what: "Habit tracker game",
    about:
      "A habit tracker played as a pixel-art fantasy game, with a public Hall of Fame. It has its own players, who join with an invite code.",
    url: "https://saga.gansoazul.com.br",
  },
  {
    name: "Roundcube",
    what: "Webmail",
    about: "The webmail of the mail server that shares this server. It has its own sign-in.",
    url: "https://roundcube.gansoazul.com.br",
  },
];
