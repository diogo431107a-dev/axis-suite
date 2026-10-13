import { useState, type FormEvent } from "react";
import { ShieldAlert } from "lucide-react";
import { AVATARS } from "../../shared/avatars.ts";
import { LIMITS, type Person } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { label, primaryButton, secondaryButton, textInput } from "../ui/buttons.ts";
import { closeDialog } from "../ui/closeDialog.ts";

/** The rule about personal information, and what happens to what people write. */
export function Rules() {
  return (
    <div
      role="note"
      className="mb-5 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="font-semibold">Personal information is forbidden.</p>
        <p>
          In Althing everyone goes by a nickname. Don't put your real name, a photo of yourself, your address, phone
          number, email, workplace or anything else that identifies you in your profile or in your messages.
        </p>
        <p>Messages can't be edited or deleted. Everything said here is kept on record.</p>
      </div>
    </div>
  );
}

interface ProfileDialogProps {
  me: Person;
  /** the first visit: the dialog says hello */
  welcome: boolean;
  onSaved: (me: Person) => void;
  onClose: () => void;
}

export function ProfileDialog({ me, welcome, onSaved, onClose }: ProfileDialogProps) {
  const [nickname, setNickname] = useState(me.nickname);
  const [about, setAbout] = useState(me.about);
  const [avatar, setAvatar] = useState(me.avatar);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setSaving(true);
    setError("");
    try {
      onSaved(await api<Person>("/api/profile", { method: "PUT", body: { nickname, about, avatar } }));
      closeDialog(form);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title={welcome ? "Welcome to Althing" : "Your profile"} onClose={onClose} wide>
      <form onSubmit={(e) => void save(e)}>
        {welcome && (
          <p className="mb-4 text-sm text-stone-600">
            Althing is the suite's chat: the lobby, rooms anyone can open, and direct messages. You got a picture at
            random; pick another or a nickname if you like.
          </p>
        )}
        <Rules />

        <fieldset className="mb-4">
          <legend className={label}>Picture</legend>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {AVATARS.map((name) => (
              <label key={name} className="cursor-pointer">
                <input
                  type="radio"
                  name="avatar"
                  value={name}
                  checked={avatar === name}
                  onChange={() => setAvatar(name)}
                  className="peer sr-only"
                />
                <img
                  src={`/avatars/${name}`}
                  alt={name.replace(/\.\w+$/, "").replace(/-/g, " ")}
                  className="aspect-square w-full rounded-full object-cover opacity-80 ring-offset-2 transition
                             peer-checked:opacity-100 peer-checked:ring-4 peer-checked:ring-emerald-600
                             peer-focus-visible:ring-4 peer-focus-visible:ring-emerald-300 hover:opacity-100"
                />
              </label>
            ))}
          </div>
        </fieldset>

        <label className="mb-4 block">
          <span className={label}>Nickname</span>
          <input
            className={textInput}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            minLength={LIMITS.nicknameMinChars}
            maxLength={LIMITS.nicknameChars}
            required
            data-autofocus
          />
        </label>

        <label className="mb-1 block">
          <span className={label}>About me</span>
          <textarea
            className={`${textInput} resize-y`}
            rows={4}
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            maxLength={LIMITS.aboutChars}
            placeholder="Hobbies, favourite things, a motto… nothing that identifies you."
          />
        </label>
        <p className="mb-4 text-right text-xs text-stone-400">
          {[...about].length} / {LIMITS.aboutChars}
        </p>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={(e) => closeDialog(e.currentTarget)}>
            {welcome ? "Later" : "Cancel"}
          </button>
          <button type="submit" className={primaryButton} disabled={saving}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
