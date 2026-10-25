import { Hash, Home, Plus } from "lucide-react";
import { LOBBY_ID, LOBBY_KEY, dmKey, roomKey, type Dm, type Person, type Room } from "../shared/protocol.ts";
import { Avatar } from "./Avatar.tsx";
import { badge } from "./format.ts";
import { nameOf } from "./people.ts";
import { AboutButton } from "./ui/About.tsx";
import { Link } from "./ui/Link.tsx";
import { iconButton } from "./ui/buttons.ts";

interface SidebarProps {
  me: Person;
  people: Map<string, Person>;
  online: Set<string>;
  rooms: Room[];
  dms: Dm[];
  unread: Record<string, number>;
  current: string;
  onProfile: () => void;
  onRooms: () => void;
  onPerson: (username: string) => void;
  /** a link was followed (closes the menu on a phone) */
  onNavigate: () => void;
}

const item =
  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-stone-700 hover:bg-stone-200/70 " +
  "aria-[current=page]:bg-white aria-[current=page]:font-medium aria-[current=page]:text-stone-900 aria-[current=page]:shadow-sm";
const heading =
  "mt-5 mb-1 flex items-center justify-between px-2 text-xs font-semibold tracking-wide text-stone-400 uppercase";

function Badge({ n }: { n: number | undefined }) {
  if (!n) return null;
  return (
    <span className="ml-auto rounded-full bg-emerald-600 px-1.5 text-xs leading-5 font-semibold text-white">
      {badge(n)}
    </span>
  );
}

export function Sidebar(props: SidebarProps) {
  const { me, people, online, rooms, dms, unread, current } = props;
  const myRooms = rooms.filter((r) => r.id !== LOBBY_ID && r.members.includes(me.username));
  const others = [...people.values()]
    .filter((p) => p.username !== me.username)
    .sort((a, b) => Number(online.has(b.username)) - Number(online.has(a.username)));

  return (
    <nav className="flex h-full flex-col overflow-y-auto p-3" aria-label="Conversations">
      <div className="mb-3 flex px-0.5">
        <AboutButton className="flex items-center gap-2 px-1">
          <img src="/favicon.svg" alt="" className="h-6 w-6" />
          <span className="text-lg font-semibold text-stone-800">Althing</span>
        </AboutButton>
      </div>
      <button
        type="button"
        onClick={props.onProfile}
        className="mb-2 flex items-center gap-2 rounded-lg p-1.5 text-left hover:bg-stone-200/70"
        title="Your profile"
      >
        <Avatar person={me} size="h-9 w-9" />
        <span className="min-w-0 truncate text-sm font-semibold text-stone-800">{me.nickname}</span>
      </button>

      <Link to={LOBBY_KEY} current={current === LOBBY_KEY} className={item} onClick={props.onNavigate}>
        <Home className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
        Lobby
        <Badge n={unread[LOBBY_KEY]} />
      </Link>

      <h2 className={heading}>
        Rooms
        <button
          type="button"
          className={`${iconButton} -my-1`}
          onClick={props.onRooms}
          aria-label="Browse or open rooms"
        >
          <Plus className="h-4 w-4" />
        </button>
      </h2>
      {myRooms.map((room) => {
        const key = roomKey(room.id);
        return (
          <Link key={key} to={key} current={current === key} className={item} onClick={props.onNavigate}>
            <Hash className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
            <span className="min-w-0 truncate">{room.name}</span>
            <Badge n={unread[key]} />
          </Link>
        );
      })}
      <button type="button" onClick={props.onRooms} className={`${item} text-stone-400`}>
        {rooms.length > 1 + myRooms.length ? `Browse ${rooms.length - 1 - myRooms.length} more…` : "Open a room…"}
      </button>

      {dms.length > 0 && <h2 className={heading}>Direct messages</h2>}
      {dms.map((dm) => {
        const key = dmKey(dm.id);
        const person = dm.with ? people.get(dm.with) : undefined;
        return (
          <Link key={key} to={key} current={current === key} className={item} onClick={props.onNavigate}>
            <Avatar person={person} size="h-6 w-6" online={!!dm.with && online.has(dm.with)} />
            <span className={`min-w-0 truncate ${person ? "" : "text-stone-400 italic"}`}>{nameOf(person)}</span>
            <Badge n={unread[key]} />
          </Link>
        );
      })}

      <h2 className={heading}>People</h2>
      {others.length === 0 && <p className="px-2 text-sm text-stone-400">Nobody else yet.</p>}
      {others.map((p) => (
        <button
          key={p.username}
          type="button"
          onClick={() => props.onPerson(p.username)}
          className={`${item} text-left ${online.has(p.username) ? "" : "opacity-50"}`}
          title={online.has(p.username) ? "Online" : "Offline"}
        >
          <Avatar person={p} size="h-6 w-6" online={online.has(p.username)} />
          <span className="min-w-0 truncate">{p.nickname}</span>
        </button>
      ))}
    </nav>
  );
}
