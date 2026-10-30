/* =====================================================================
   TUNING — every balance number in one place
   ===================================================================== */
export const TUNE = {
  // Every progression needs base × level^curveExp to reach the next level: steep, never linear.
  curveExp: 1.8,
  curve: { comp: 20, mastery: 2, spell: 3, flee: 4, hero: 10 }, // flee: successful escapes led
  partySize: 5,
  noteMax: 500, // characters in a companion's note
  hp: [40, 10], // max HP = base + per level
  mp: [6, 2], // max MP = base + per level
  pointsPerLevel: 3, // attribute points a companion carries per level
  dmg: { base: 8, perLevel: 4, perPoint: 1, mastery: 0.06 }, // attack; mastery compounds +6% per level
  guardShare: 0.5, // damage a guarding member takes until the turn ends
  spell: { mpBase: 3, decay: 0.85 }, // cost = mpBase + spell level; strength fraction = 1 − decay^level
  // Tuned by simulation: a party that only attacks sees its first knockout within ~5 fights and falls by ~8;
  // potions, the Inn, Guard and spells are what carry it into tier 3 and beyond.
  enemyHp: { base: 140, growth: 1.75, perIndex: 0.15, perStar: 0.5 },
  enemyDmg: { base: 18, growth: 1.45, perStar: 0.5 },
  size: { small: 0.6, medium: 1, large: 1.6, heavy: 2.2 },
  reward: { xp: 60, growth: 1.9, perIndex: 0.15, perStar: 0.5, gold: 15 }, // paid only on victory
  share: { floor: 0.15, firstHit: 0.1, lastHit: 0.15 }, // floor split evenly; first/last hit bonus as share of foe max HP
  innPerTier: 15, // inn price × tier of the region the party is in
  ko: { first: 0.1, step: 0.05, cap: 0.3 }, // XP lost on knockout, as a share of the level's requirement
  status: { poison: 0.08, burn: 0.05, blindMiss: 0.5, wholeParty: 1 / 3 },
  vice: { cost: 10, drain: 2, heatGrowth: 1.25 }, // each log adds heat; each victory cools every vice by 1
  flee: {
    base: 0.85,
    perTier: 0.1,
    boss: 0.1,
    perStar: 0.05,
    perSkill: 0.04,
    min: 0.05,
    max: 0.95,
    drop: 0.6,
    dropPerSkill: 0.05,
    dropMin: 0.15,
    dropShare: [0.05, 0.15],
  }, // hidden from the player
  items: {
    potion: { price: 30, heal: 0.4 },
    ether: { price: 25, mp: 15 },
    feather: { price: 90 },
    eliteFeather: { price: 220, revive: 0.25 },
    antidote: { price: 20 },
    remedy: { price: 60 },
  },
};

/* =====================================================================
   DATA — attributes, schools, classes, tiers, 48 enemies and their attacks, items, statuses, sprite grids
   ===================================================================== */
export const ATTRS = [
  {
    id: "body",
    name: "BODY",
    color: "#C0392B",
    icon: "🏃",
    cls: "Brawler",
    school: "force",
    blurb: "What moves you: walking, Pilates, any exercise.",
  },
  {
    id: "vitality",
    name: "VITALITY",
    color: "#E8892B",
    icon: "🔥",
    cls: "Herbalist",
    school: "mend",
    blurb: "What keeps the body going: sleep, meals, water, rest.",
  },
  {
    id: "mind",
    name: "MIND",
    color: "#2E86C1",
    icon: "📚",
    cls: "Scholar",
    school: "insight",
    blurb: "What adds to what you know: books, courses, study.",
  },
  {
    id: "craft",
    name: "CRAFT",
    color: "#C2417B",
    icon: "🎸",
    cls: "Bard",
    school: "anthem",
    blurb: "What you make: music, art, writing.",
  },
  {
    id: "spirit",
    name: "SPIRIT",
    color: "#5D4E9C",
    icon: "🕯️",
    cls: "Mystic",
    school: "purge",
    blurb: "What deepens your practice: meditation, prayer, reflection.",
  },
  {
    id: "order",
    name: "ORDER",
    color: "#4F7A64",
    icon: "🧹",
    cls: "Warden",
    school: "ward",
    blurb: "What keeps the house and your affairs in hand.",
  },
  {
    id: "resolve",
    name: "RESOLVE",
    color: "#B8860B",
    icon: "⚓",
    cls: "Knight",
    school: "finish",
    blurb: "What goes past your limit: exceptional work, the extra effort, the thing you dodged.",
  },
  {
    id: "charisma",
    name: "CHARISMA",
    color: "#7FB3B3",
    icon: "🎭",
    cls: "Envoy",
    school: "charm",
    blurb: "What passes between people: calls, gatherings, sharing your work.",
  },
];
export const ATTR = Object.fromEntries(ATTRS.map((a) => [a.id, a]));

// Spell schools, one per class. f is the strength fraction for the caster's spell level (grows toward 1).
export const sfrac = (L) => 1 - Math.pow(TUNE.spell.decay, L);
export const SCHOOLS = {
  force: { name: "Force", attr: "body", lore: "What strength says when words run out." },
  mend: { name: "Mend", attr: "vitality", lore: "What rest gives back." },
  insight: { name: "Insight", attr: "mind", lore: "Knowing what is coming takes the force out of it." },
  anthem: { name: "Anthem", attr: "craft", lore: "A song for the ones beside you." },
  purge: { name: "Purge", attr: "spirit", lore: "What the debt left behind, drawn out." },
  ward: { name: "Ward", attr: "order", lore: "A house in order holds against the bad week." },
  finish: { name: "Finish", attr: "resolve", lore: "The last push is worth more than the first." },
  charm: { name: "Charm", attr: "charisma", lore: "Some fights are won by not having them." },
};

export const CLASSES = {
  Brawler: { hair: "#3b2416", prop: "fists" },
  Herbalist: { hair: "#5f7f32", prop: "leafstaff" },
  Scholar: { hair: "#d9d2c3", prop: "book" },
  Bard: { hair: "#e0a030", prop: "lute" },
  Mystic: { hair: "#2a2440", prop: "candle" },
  Warden: { hair: "#6b4a2a", prop: "broom" },
  Knight: { hair: "#9aa3ad", prop: "sword" },
  Envoy: { hair: "#c25a2a", prop: "mask" },
};
export const SKINS = ["#f1c7a0", "#c98e62", "#8d5a3b"];

// Each tier is a region you can travel back to.
export const TIERS = [
  {
    roman: "I",
    name: "Crawlers",
    region: "Cellar Meadows",
    bg: "meadow",
    lore: "Where the crawlers live, and where you learn that you can win.",
  },
  { roman: "II", name: "Beasts", region: "Greywood", bg: "forest", lore: "The beasts run you down in the dark here." },
  {
    roman: "III",
    name: "Tricksters",
    region: "Twilight Grove",
    bg: "grove",
    lore: "Nothing here is what it looks like.",
  },
  {
    roman: "IV",
    name: "Restless Dead",
    region: "Hollow Crypts",
    bg: "crypt",
    lore: "What is left of everything you started and dropped. It knows your name.",
  },
  {
    roman: "V",
    name: "Elementals & Constructs",
    region: "Sunken Ruins",
    bg: "ruins",
    lore: "Old machinery still ticks, keeping time for no one.",
  },
  {
    roman: "VI",
    name: "Giants",
    region: "Highland Pass",
    bg: "highlands",
    lore: "The giants charge a toll for the first step.",
  },
  {
    roman: "VII",
    name: "Drakes",
    region: "Ember Cliffs",
    bg: "cliffs",
    lore: "The drakes strike from high ledges. Only those who have climbed are worth striking.",
  },
  {
    roman: "VIII",
    name: "Dragons",
    region: "The Ember Peaks",
    bg: "lair",
    lore: "The dragons. The oldest one is at the top, and it remembers you.",
  },
];

// Foe moves. Turn moves land when the party's turn ends; a counter lands right after the foe is hit.
export const MOVES = {
  bite: { name: "Bite", target: "one", hits: [1, 3], size: "small" },
  savage: { name: "Savage bite", target: "one", hits: [1, 2], size: "medium" },
  maul: { name: "Maul", target: "one", hits: [3, 5], size: "small" },
  swipe: { name: "Swipe", target: "all", hits: [1, 1], size: "small" },
  sweep: { name: "Sweep", target: "all", hits: [1, 1], size: "medium" },
  slam: { name: "Slam", target: "all", hits: [1, 1], size: "large" },
  breath: { name: "Breath", target: "all", hits: [1, 1], size: "heavy" },
  snap: { name: "Bite back", target: "actor", hits: [1, 1], size: "small" },
  lash: { name: "Lash", target: "actor", hits: [1, 2], size: "medium" },
  storm: { name: "Backlash", target: "all", hits: [1, 1], size: "small" },
};
export const FAMILY_ATK = {
  rat: { turn: ["bite"] },
  beetle: { turn: ["swipe"] },
  slug: { turn: ["swipe"] },
  centipede: { turn: ["maul"] },
  spider: { turn: ["bite"], counter: "snap" },
  beast: { turn: ["savage"] },
  bat: { turn: ["maul"] },
  serpent: { turn: ["bite"], counter: "snap" },
  imp: { turn: ["bite", "swipe"], pick: true },
  mushroom: { turn: ["swipe"] },
  mimic: { turn: ["savage"] },
  ghost: { turn: ["sweep"] },
  skeleton: { turn: ["maul"] },
  slime: { turn: ["sweep"] },
  giant: { turn: ["slam"] },
  dragon: { turn: ["breath"] },
};
// The last foe of each tier is a boss with a combination, and some dragons have their own temper.
export const BOSS_ATK = {
  "pale-grub": { turn: ["swipe", "bite"] },
  "cave-bear": { turn: ["savage", "swipe"], counter: "snap" },
  "hungry-chest": { turn: ["savage", "maul"], counter: "lash" },
  banshee: { turn: ["sweep"], counter: "storm" },
  clockwork: { turn: ["maul", "sweep"], counter: "snap" },
  minotaur: { turn: ["savage", "slam"], counter: "lash" },
  chimera: { turn: ["slam", "savage"], counter: "storm" },
  "venom-dragon": { turn: ["breath"], counter: "snap" },
  "storm-dragon": { turn: ["breath"], counter: "storm" },
  "shadow-dragon": { turn: ["maul", "breath"], counter: "storm" },
  "elder-dragon": { turn: ["breath", "maul"], counter: "storm" },
};

export const P = (a, b, c, e, extra) => Object.assign({ a, b, c, e }, extra || {});
// [key, name, base sprite, palette, lore]
export const ENEMY_TIERS = [
  [
    [
      "cellar-rat",
      "Cellar Rat",
      "rat",
      P("#8a7f72", "#5e554c", "#b3a796", "#e8313a"),
      "Takes a crumb and a morning, and comes back for both.",
    ],
    [
      "dung-beetle",
      "Dung Beetle",
      "beetle",
      P("#4a3b6b", "#2e2546", "#7e6aa8", "#f5d742", { d: "#1e1830" }),
      "Rolls yesterday's excuses into a ball.",
    ],
    [
      "garden-slug",
      "Garden Slug",
      "slug",
      P("#9bb85a", "#6b8a3a", "#cfe08a", "#1b1424"),
      "Slow, but it never stops showing up.",
    ],
    [
      "thousandfoot",
      "Thousandfoot",
      "centipede",
      P("#b5532e", "#7a3420", "#e0814f", "#ffe066"),
      "Every leg is a reason to wait.",
    ],
    [
      "web-weaver",
      "Web Weaver",
      "spider",
      P("#3a3340", "#241f29", "#6d6378", "#ff3355"),
      "Spins its web across the door you meant to open later.",
    ],
    [
      "pale-grub",
      "Pale Grub",
      "slug",
      P("#e9dfc4", "#c2b48f", "#fff7e0", "#3b2a1a"),
      "Grows fat in the warm hour you meant to give away.",
    ],
  ],
  [
    [
      "grey-wolf",
      "Grey Wolf",
      "beast",
      P("#8d93a0", "#5f6573", "#c3c8d2", "#ffd23f"),
      "Hunts alone and howls at plans.",
    ],
    [
      "bristle-boar",
      "Bristle Boar",
      "beast",
      P("#7a4e33", "#52331f", "#a8714c", "#ff5a36", { t: "#f4ecd8" }),
      "Charges straight through good intentions.",
    ],
    [
      "dusk-bat",
      "Dusk Bat",
      "bat",
      P("#4b3a5a", "#2f2340", "#7a6390", "#ff4060"),
      "Wakes when the lamps should have been put out.",
    ],
    [
      "moss-viper",
      "Moss Viper",
      "serpent",
      P("#4f8a3c", "#33602a", "#8cc46a", "#ffde4a"),
      'Its bite is a quiet "just this once".',
    ],
    [
      "storm-hawk",
      "Storm Hawk",
      "bat",
      P("#7b6a52", "#54473a", "#c9b38f", "#ffcc00", { w: "#e8a33a" }),
      "Circles high. Dives the moment you look away from the road.",
    ],
    [
      "cave-bear",
      "Cave Bear",
      "beast",
      P("#5a4232", "#3d2c21", "#84634c", "#ffb000"),
      "Sleeps all winter and wants you to as well.",
    ],
  ],
  [
    [
      "hearth-imp",
      "Hearth Imp",
      "imp",
      P("#d4533f", "#6e2b2b", "#f0846a", "#ffe14d", { h: "#2b1d1d" }),
      "Hides your keys, your shoes, your focus.",
    ],
    [
      "pickpocket",
      "Goblin Pickpocket",
      "imp",
      P("#6f9a3e", "#5b4630", "#9cc561", "#ff3b3b", { h: "#6f9a3e" }),
      "Steals minutes one at a time.",
    ],
    [
      "kobold",
      "Kobold Digger",
      "imp",
      P("#b0743a", "#4a4a52", "#d69a5c", "#fff04a", { h: "#8a5a2a" }),
      "Tunnels under everything you had written down.",
    ],
    [
      "marsh-wisp",
      "Marsh Wisp",
      "ghost",
      P("#8fe3ff", "#4aa8d8", "#e6fbff", "#ffffff", { k: "#1a3a5a" }),
      "A light that leads you off the path.",
    ],
    [
      "toadstool",
      "Toadstool Folk",
      "mushroom",
      P("#c8382f", "#e9dcc0", "#ef6f62", "#2a1a12", { d: "#f8f1e0" }),
      "Mutters spores of doubt.",
    ],
    [
      "hungry-chest",
      "Hungry Chest",
      "mimic",
      P("#8a5a2e", "#5e3b1c", "#b07a45", "#ff3030", { d: "#d4a83a", f: "#d6455d", k: "#1b0f0f" }),
      "Looks like a reward. It isn't.",
    ],
  ],
  [
    [
      "skeleton",
      "Rattling Skeleton",
      "skeleton",
      P("#e6dcc4", "#a89d85", "#ffffff", "#48d1ff", { k: "#1c1a22" }),
      "All bones, no follow-through.",
    ],
    [
      "ghoul",
      "Grave Ghoul",
      "skeleton",
      P("#7f9a72", "#566b4c", "#a7c29a", "#ffef5a", { k: "#1c2418" }),
      "Feeds on work left half-done.",
    ],
    [
      "wraith",
      "Hollow Wraith",
      "ghost",
      P("#6a6a8a", "#44445e", "#9b9bc0", "#ffffff", { k: "#0a0a12" }),
      "A shape left behind by someone you stopped being.",
    ],
    ["bone-hound", "Bone Hound", "beast", P("#ddd2b8", "#a89d85", "#fffaf0", "#4bd1ff"), "Fetches old regrets."],
    [
      "lich-acolyte",
      "Lich Acolyte",
      "skeleton",
      P("#b9a7d8", "#7d6aa0", "#e0d4f5", "#7dff7d", { k: "#1a1428" }),
      "Studies the art of putting things off.",
    ],
    [
      "banshee",
      "Weeping Banshee",
      "ghost",
      P("#cfd8e8", "#8f9bb3", "#ffffff", "#ffffff", { k: "#2a2f45" }),
      "Wails at three in the morning.",
    ],
  ],
  [
    [
      "slime-lord",
      "Slime Lord",
      "slime",
      P("#5fc46b", "#3a8a46", "#a6f0ae", "#ffffff", { k: "#12321a", q: "#f2c230" }),
      "Absorbs whatever you leave lying around.",
    ],
    [
      "rubble-golem",
      "Rubble Golem",
      "giant",
      P("#8e8676", "#635d52", "#b5ad9c", "#ffb347", { k: "#2a2620", d: "#4e4a42" }),
      "Built from clutter, held together by dust.",
    ],
    [
      "gargoyle",
      "Cathedral Gargoyle",
      "giant",
      P("#6c7380", "#4a505b", "#99a1ae", "#ff4040", { g: "#555b66", h: "#3e434c", k: "#22252b", d: "#3e434c" }),
      "Watches. Judges. Never moves first.",
    ],
    [
      "ember-spirit",
      "Ember Spirit",
      "ghost",
      P("#ff8a2b", "#d1451b", "#ffe07a", "#ffffff", { k: "#5a1a08" }),
      "Burns hot and burns out.",
    ],
    [
      "frost-shade",
      "Frost Shade",
      "ghost",
      P("#9fd8f0", "#5b9fc4", "#effbff", "#ffffff", { k: "#0e3550" }),
      "Freezes you mid-start.",
    ],
    [
      "clockwork",
      "Clockwork Sentinel",
      "giant",
      P("#b08d3c", "#7a6128", "#e3c46e", "#4dfcff", { k: "#3a2f12", d: "#5c4a1e" }),
      "Ticks louder the longer you wait.",
    ],
  ],
  [
    [
      "bridge-troll",
      "Bridge Troll",
      "giant",
      P("#6e8f5a", "#5a4a36", "#94b87c", "#ffd84a", { k: "#2b2016", d: "#3e3226" }),
      "Charges a toll for every first step.",
    ],
    [
      "brute-ogre",
      "Brute Ogre",
      "giant",
      P("#b98a5e", "#6a4b30", "#dcae7e", "#c01818", { k: "#3a2214", d: "#4a3320" }),
      "Strong, stubborn, and very comfortable.",
    ],
    [
      "cyclops",
      "One-Eyed Cyclops",
      "giant",
      P("#a7b3c9", "#5a5f72", "#cdd6e6", "#a7b3c9", { y: "#ff3a3a", k: "#2a2d38", d: "#3a3d4a" }),
      "Sees only the one thing you're avoiding.",
    ],
    [
      "hill-giant",
      "Hill Giant",
      "giant",
      P("#c49a6c", "#6b7a3a", "#e3be92", "#2a5aff", { k: "#3a2a1a", d: "#4a5528" }),
      "Each stride is a week you lost.",
    ],
    [
      "frost-giant",
      "Frost Giant",
      "giant",
      P("#b9d9ea", "#4f7aa0", "#e6f5ff", "#2fe0ff", { h: "#f5f5f5", k: "#1a3550", d: "#2f4f70" }),
      "Brings the long, cold stillness.",
    ],
    [
      "minotaur",
      "Labyrinth Minotaur",
      "giant",
      P("#6b3e26", "#8a2a1e", "#94593a", "#ff2a2a", { h: "#e8dcc0", k: "#2a160c", d: "#5a1a12" }),
      "Guards a maze of doors you opened and never went through.",
    ],
  ],
  [
    [
      "cliff-wyvern",
      "Cliff Wyvern",
      "dragon",
      P("#7a8f4e", "#4f5e32", "#c8c890", "#ffef3a", { g: "#5b6b3a" }),
      "Strikes from the high ledge of ambition.",
    ],
    [
      "salamander",
      "Lava Salamander",
      "dragon",
      P("#e05a1e", "#a3360f", "#ffb04a", "#fff07a"),
      "Thrives where the fire has outrun the fuel.",
    ],
    [
      "sea-serpent",
      "Sea Serpent",
      "serpent",
      P("#2e7d9a", "#1d5468", "#7fd0d8", "#ffde3a", { r: "#ff6b8a" }),
      "Drags you under, and it's very pleasant on the way down.",
    ],
    [
      "rock-drake",
      "Rock Drake",
      "dragon",
      P("#8a7a6a", "#5f5348", "#c4b49a", "#ff8a1a"),
      "Hard-scaled and set in its ways.",
    ],
    [
      "basilisk",
      "Basilisk",
      "serpent",
      P("#4a6b3a", "#2f4625", "#9dbb6a", "#ff2020", { q: "#ffcc00" }),
      "One look and you stop moving.",
    ],
    [
      "chimera",
      "Chimera",
      "dragon",
      P("#c49a3e", "#8a6a28", "#ead08a", "#ff3030", { g: "#8b3b2e" }),
      "Three heads, three competing plans.",
    ],
  ],
  [
    [
      "ember-dragon",
      "Ember Dragon",
      "dragon",
      P("#c0392b", "#7e2219", "#f0a03a", "#ffe03a", { g: "#8a2a20" }),
      "Hoards half-finished things and guards them with fire.",
    ],
    [
      "frost-dragon",
      "Frost Dragon",
      "dragon",
      P("#8ec5e6", "#4f86b0", "#eaf7ff", "#1f4fff", { g: "#5d93c0" }),
      "Its breath is the cold of quitting.",
    ],
    [
      "storm-dragon",
      "Storm Dragon",
      "dragon",
      P("#4b5fa8", "#2d3a70", "#a8b8ff", "#fff35a", { g: "#7d6ad0" }),
      "Roars with a hundred voices, and none of them need you.",
    ],
    [
      "venom-dragon",
      "Venom Dragon",
      "dragon",
      P("#5b9a3a", "#3a6625", "#c5e85a", "#ff2fd0", { g: "#6a3a8a" }),
      "Poisons the well of good days.",
    ],
    [
      "shadow-dragon",
      "Shadow Dragon",
      "dragon",
      P("#2e2840", "#1a1626", "#6a5a9a", "#ff2a5a", { g: "#3d3456", o: "#000000" }),
      "Lives in the gap between intention and action.",
    ],
    [
      "elder-dragon",
      "Elder Dragon",
      "dragon",
      P("#c9a24a", "#8a6a22", "#f6e6a8", "#ff5a1a", { g: "#e8e0c8" }),
      "The oldest habit of all. It remembers you.",
    ],
  ],
];
export const ENEMIES = [];
ENEMY_TIERS.forEach((list, ti) =>
  list.forEach(([key, name, base, pal, lore], i) => {
    const H = TUNE.enemyHp;
    const hp = Math.round((H.base * Math.pow(H.growth, ti) * (1 + H.perIndex * i)) / 5) * 5;
    ENEMIES.push({ key, name, base, pal, lore, tier: ti + 1, idx: i, hp, atk: BOSS_ATK[key] || FAMILY_ATK[base] });
  }),
);
export const ENEMY_BY_KEY = Object.fromEntries(ENEMIES.map((e) => [e.key, e]));

export const TITLE_LADDER = [
  [0, "Not Even Your Mother Likes You"],
  [1, "Village Nuisance"],
  [3, "Rat Botherer"],
  [6, "Mildly Tolerated"],
  [10, "The One Who Showed Up"],
  [16, "Errand-Runner of Some Note"],
  [25, "Hedge Knight"],
  [36, "Tavern-Song Material"],
  [50, "Gravewalker"],
  [75, "Breaker of Golems"],
  [100, "Giantsbane"],
  [140, "Drake Hunter"],
];

// Hero looks for character creation. Cosmetic only: each is the hero grid with its own colours and prop.
export const AVATARS = [
  {
    id: "knight",
    name: "Knight",
    prop: "sword",
    d: "#e9b949",
    pal: { h: "#2a1a12", s: "#f1c7a0", a: "#d8d4cc", c: "#ffffff", b: "#5a5f6e", g: "#8e2430" },
  },
  {
    id: "ranger",
    name: "Ranger",
    prop: "leafstaff",
    pal: { h: "#6b4a2a", s: "#c98e62", a: "#6f8f4a", c: "#9cc06a", b: "#3e4a2a", g: "#3f6b2a" },
  },
  {
    id: "sage",
    name: "Sage",
    prop: "book",
    d: "#8a2a2a",
    pal: { h: "#d9d2c3", s: "#f1c7a0", a: "#3a5f9a", c: "#6f95cf", b: "#26385a", g: "#26385a" },
  },
  {
    id: "minstrel",
    name: "Minstrel",
    prop: "lute",
    pal: { h: "#e0a030", s: "#f1c7a0", a: "#b0442e", c: "#e07a5a", b: "#5a2a1e", g: "#d4a83a" },
  },
  {
    id: "mystic",
    name: "Mystic",
    prop: "candle",
    pal: { h: "#2a2440", s: "#c98e62", a: "#5d4e9c", c: "#8a7ac8", b: "#2e2650", g: "#3d3266" },
  },
  {
    id: "envoy",
    name: "Envoy",
    prop: "mask",
    pal: { h: "#c25a2a", s: "#8d5a3b", a: "#d8c8a8", c: "#f4ecd8", b: "#5a4a3a", g: "#3f8f8f" },
  },
];
export const ITEMS = {
  potion: {
    name: "Health Potion",
    grid: "potion",
    pal: { a: "#d23a4a", b: "#7a5230", c: "#ff9aa6" },
    desc: "Restores 40% of max HP to a member who is still standing.",
  },
  ether: {
    name: "Ether",
    grid: "potion",
    pal: { a: "#4f8ad8", b: "#d4a83a", c: "#b8d4ff" },
    desc: "Restores 15 MP to a member who is still standing.",
  },
  feather: {
    name: "Phoenix Feather",
    grid: "feather",
    pal: { a: "#ff8a2b", c: "#ffd23f" },
    desc: "Revives a knocked-out member with 1 HP.",
  },
  eliteFeather: {
    name: "Elite Phoenix Feather",
    grid: "feather",
    pal: { a: "#fff1c2", c: "#ffb43a", o: "#7a4a10" },
    desc: "Revives a knocked-out member with 25% of max HP.",
  },
  antidote: {
    name: "Antidote",
    grid: "potion",
    pal: { a: "#4fae4a", b: "#7a5230", c: "#bff0a0" },
    desc: "Cures Poison.",
  },
  remedy: {
    name: "Remedy",
    grid: "potion",
    pal: { a: "#9a5ad0", b: "#d4a83a", c: "#e0c4ff" },
    desc: "Cures every ailment: Poison, Burn, Freeze, Shock, Blind and Curse.",
  },
};

// Ailments. turns: null means it lasts until cured.
export const STATUSES = {
  poison: {
    name: "Poison",
    color: "#7ccf5a",
    turns: null,
    text: "loses 8% of max HP at the end of each turn until cured",
  },
  burn: { name: "Burn", color: "#f08a3a", turns: 3, text: "loses 5% of max HP each time it acts" },
  freeze: { name: "Freeze", color: "#8fdcff", turns: 1, text: "cannot act" },
  shock: { name: "Shock", color: "#ffd84a", turns: 2, text: "deals half damage" },
  blind: { name: "Blind", color: "#b8b2c8", turns: 2, text: "attacks may miss" },
  curse: { name: "Curse", color: "#c08ae8", turns: 3, text: "gets no share of victory XP" },
};
