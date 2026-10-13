import { KEY_HELP } from "../board/keys.ts";
import { Dialog } from "../ui/Dialog.tsx";

/** The board's keyboard keys. */
export function KeysDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard" onClose={onClose} wide>
      <p className="mb-3 text-sm text-stone-500">
        Tab into the board, then use these on a card or a list's name. On a Mac, Cmd works where it says Ctrl.
      </p>
      <table className="w-full text-sm">
        <tbody>
          {KEY_HELP.map(([keys, what]) => (
            <tr key={keys} className="border-t border-stone-100 align-top">
              <td className="py-1.5 pr-4 font-mono text-xs whitespace-nowrap text-stone-800">{keys}</td>
              <td className="py-1.5 text-stone-600">{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
