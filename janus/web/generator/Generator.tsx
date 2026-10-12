import { useCallback, useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import {
  CHARSETS,
  DEFAULT_PASSPHRASE,
  DEFAULT_PASSWORD,
  PASSPHRASE_WORDS,
  PASSWORD_LENGTH,
  generatePassphrase,
  generatePassword,
  parseWordlist,
  passphraseBits,
  passwordBits,
  strength,
  type Charset,
  type PassphraseOptions,
  type PasswordOptions,
} from "./generate.ts";
import { iconButton, label, primaryButton } from "../ui/buttons.ts";

type Mode = "password" | "passphrase";

interface Settings {
  mode: Mode;
  password: PasswordOptions;
  passphrase: PassphraseOptions;
}

// The options last used, remembered in this browser only (a convenience; nothing secret).
const STORAGE_KEY = "janus.generator";

function loadSettings(): Settings {
  const defaults: Settings = { mode: "password", password: DEFAULT_PASSWORD, passphrase: DEFAULT_PASSPHRASE };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Settings> | null;
    if (!saved) return defaults;
    return {
      mode: saved.mode === "passphrase" ? "passphrase" : "password",
      password: { ...DEFAULT_PASSWORD, ...saved.password, sets: { ...DEFAULT_PASSWORD.sets, ...saved.password?.sets } },
      passphrase: { ...DEFAULT_PASSPHRASE, ...saved.passphrase },
    };
  } catch {
    return defaults;
  }
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // private window or storage blocked: the options just aren't remembered
  }
}

// The EFF's large word list (7,776 words), fetched with the generator's code the first time a
// passphrase is made.
let wordlist: Promise<string[]> | undefined;
const loadWordlist = () => (wordlist ??= import("./eff_large_wordlist.txt?raw").then((m) => parseWordlist(m.default)));

const STRENGTH_STYLE = {
  weak: "bg-red-500 w-1/4",
  fair: "bg-amber-500 w-1/2",
  strong: "bg-green-500 w-3/4",
  "very strong": "bg-green-600 w-full",
} as const;

const SET_NAMES: Record<Charset, string> = { lower: "a–z", upper: "A–Z", digits: "0–9", symbols: "!#$…" };

interface GeneratorProps {
  /** With it, a "Use" button hands the result over (the entry editor). */
  onUse?: (password: string) => void;
  onCopy: (password: string) => void;
}

/** Makes random passwords and passphrases. */
export function Generator({ onUse, onCopy }: GeneratorProps) {
  const [settings, setSettings] = useState(loadSettings);
  const [words, setWords] = useState<string[] | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (settings.mode !== "passphrase" || words) return;
    loadWordlist()
      .then(setWords)
      .catch(() => setError("The word list couldn't be loaded. Try again in a moment."));
  }, [settings.mode, words]);

  const generate = useCallback(() => {
    try {
      if (settings.mode === "password") setValue(generatePassword(settings.password));
      else if (words) setValue(generatePassphrase(settings.passphrase, words));
      setError("");
    } catch (err) {
      setValue("");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [settings, words]);

  useEffect(generate, [generate]);

  function update(next: Settings) {
    setSettings(next);
    saveSettings(next);
  }
  const setPassword = (p: Partial<PasswordOptions>) =>
    update({ ...settings, password: { ...settings.password, ...p } });
  const setPassphrase = (p: Partial<PassphraseOptions>) =>
    update({ ...settings, passphrase: { ...settings.passphrase, ...p } });

  const bits =
    settings.mode === "password"
      ? passwordBits(settings.password)
      : passphraseBits(settings.passphrase, words?.length ?? 7776);
  const rating = strength(bits);

  return (
    <div className="space-y-4">
      <div role="tablist" className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
        {(["password", "passphrase"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={settings.mode === mode}
            onClick={() => update({ ...settings, mode })}
            className={`px-3 py-1 text-sm rounded-md capitalize ${
              settings.mode === mode ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-800"
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      <div>
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 pl-3 pr-1 py-1">
          <output className="flex-1 min-w-0 font-mono text-base text-gray-900 break-all py-1.5" aria-label="Generated">
            {value || "…"}
          </output>
          <button
            type="button"
            className={iconButton}
            onClick={generate}
            aria-label="Make another"
            title="Make another"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            className={iconButton}
            onClick={() => value && onCopy(value)}
            disabled={!value}
            aria-label="Copy"
            title="Copy"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full rounded-full ${STRENGTH_STYLE[rating]}`} />
          </div>
          <span className="text-xs text-gray-500 tabular-nums">
            {rating}, about {Math.floor(bits)} bits
          </span>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {settings.mode === "password" ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="gen-length" className={label}>
              Length: {settings.password.length}
            </label>
            <input
              id="gen-length"
              type="range"
              min={PASSWORD_LENGTH.min}
              max={64}
              value={Math.min(settings.password.length, 64)}
              onChange={(e) => setPassword({ length: Number(e.target.value) })}
              className="w-full accent-blue-700"
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {(Object.keys(CHARSETS) as Charset[]).map((set) => (
              <label key={set} className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={settings.password.sets[set]}
                  onChange={(e) => setPassword({ sets: { ...settings.password.sets, [set]: e.target.checked } })}
                  className="accent-blue-700"
                />
                <span className="font-mono">{SET_NAMES[set]}</span>
              </label>
            ))}
            <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={settings.password.avoidAmbiguous}
                onChange={(e) => setPassword({ avoidAmbiguous: e.target.checked })}
                className="accent-blue-700"
              />
              No look-alikes (I l 1 O 0 o |)
            </label>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label htmlFor="gen-words" className={label}>
              Words: {settings.passphrase.words}
            </label>
            <input
              id="gen-words"
              type="range"
              min={PASSPHRASE_WORDS.min}
              max={PASSPHRASE_WORDS.max}
              value={settings.passphrase.words}
              onChange={(e) => setPassphrase({ words: Number(e.target.value) })}
              className="w-full accent-blue-700"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              Separator
              <input
                value={settings.passphrase.separator}
                maxLength={3}
                onChange={(e) => setPassphrase({ separator: e.target.value })}
                className="w-14 px-2 py-1 text-sm font-mono text-center border border-gray-200 rounded-lg bg-white
                           focus:outline-none focus:ring-2 focus:ring-blue-400"
                aria-label="Separator"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={settings.passphrase.capitalize}
                onChange={(e) => setPassphrase({ capitalize: e.target.checked })}
                className="accent-blue-700"
              />
              Capitalize
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={settings.passphrase.number}
                onChange={(e) => setPassphrase({ number: e.target.checked })}
                className="accent-blue-700"
              />
              Add a digit
            </label>
          </div>
          <p className="text-xs text-gray-400">
            Words from the{" "}
            <a
              href="https://www.eff.org/dice"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              EFF's long word list
            </a>{" "}
            (CC BY 3.0).
          </p>
        </div>
      )}

      {onUse && (
        <div className="flex justify-end">
          <button type="button" className={primaryButton} disabled={!value} onClick={() => onUse(value)}>
            Use this {settings.mode}
          </button>
        </div>
      )}
    </div>
  );
}
