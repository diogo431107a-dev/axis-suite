import { useMemo, useState } from "react";
import { LIMITS, type Group } from "../../shared/protocol.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { label, primaryButton, secondaryButton, textInput } from "../ui/buttons.ts";
import { compareText, groupPaths } from "../util.ts";

interface GroupDialogProps {
  groups: Group[];
  /** the group to rename or move; none to make a new one */
  group?: Group;
  /** where a new group goes */
  parentId: string | null;
  onSave: (name: string, parentId: string | null) => Promise<boolean>;
  onClose: () => void;
}

/** Makes a group, or renames and moves one. */
export function GroupDialog({ groups, group, parentId: initialParent, onSave, onClose }: GroupDialogProps) {
  const [name, setName] = useState(group?.name ?? "");
  const [parentId, setParentId] = useState(group ? group.parentId : initialParent);
  const [saving, setSaving] = useState(false);

  // Where it may go: anywhere but inside itself.
  const parents = useMemo(() => {
    const paths = groupPaths(groups);
    const inside = (id: string): boolean => {
      for (let g = groups.find((x) => x.id === id); g; g = groups.find((x) => x.id === g!.parentId)) {
        if (g.id === group?.id) return true;
      }
      return false;
    };
    return groups
      .filter((g) => !inside(g.id))
      .map((g) => ({ id: g.id, path: (paths.get(g.id) ?? [g.name]).join(" › ") }))
      .sort((a, b) => compareText(a.path, b.path));
  }, [groups, group]);

  return (
    <Dialog title={group ? "Rename or move group" : "New group"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setSaving(true);
          const saved = await onSave(name.trim(), parentId);
          setSaving(false);
          if (saved) closeDialog(form);
        }}
      >
        <div>
          <label htmlFor="group-name" className={label}>
            Name
          </label>
          <input
            id="group-name"
            data-autofocus
            required
            maxLength={LIMITS.groupNameChars}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={textInput}
          />
        </div>
        <div>
          <label htmlFor="group-parent" className={label}>
            Inside
          </label>
          <select
            id="group-parent"
            value={parentId ?? ""}
            onChange={(e) => setParentId(e.target.value || null)}
            className={textInput}
          >
            <option value="">Top level</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.path}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={(e) => closeDialog(e.currentTarget)}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={saving || !name.trim()}>
            {group ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
