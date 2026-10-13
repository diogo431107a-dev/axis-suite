import { KEY_HELP } from "../map/keys.ts";
import { Dialog } from "../ui/Dialog.tsx";

/** The map's keyboard keys, and what the mouse and a finger do. */
export function KeysDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard" onClose={onClose} wide>
      <p className="mb-3 text-sm text-stone-500">
        Tab into the map, then use these on the selected node. On a Mac, Cmd works where it says Ctrl.
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
      <p className="mt-4 text-sm text-stone-500">
        With the mouse: drag the map to move around, Ctrl+wheel (or pinch) to zoom, drag a node onto another one or
        between two, double-click to edit, right-click for the node's menu. With a finger: hold a node to drag it,
        double-tap to edit, pinch to zoom.
      </p>
    </Dialog>
  );
}
