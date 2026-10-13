import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Hash, LogOut, X } from "lucide-react";
import {
  SignedOutError,
  fetchMe,
  goToSignIn,
  signInUrl,
  watchForSignIn,
  type Me,
} from "@axis-suite/heimdall-client/browser";
import {
  LOBBY_ID,
  LOBBY_KEY,
  dmKey,
  parseKey,
  type ChatState,
  type Dm,
  type Message,
  type Person,
} from "../shared/protocol.ts";
import { Avatar } from "./Avatar.tsx";
import { Conversation } from "./Conversation.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { api, describeError, setPageUser } from "./api.ts";
import { PersonDialog } from "./dialogs/PersonDialog.tsx";
import { ProfileDialog } from "./dialogs/ProfileDialog.tsx";
import { RoomsDialog } from "./dialogs/RoomsDialog.tsx";
import { listen } from "./live.ts";
import { go, useRoute } from "./nav.ts";
import { nameOf } from "./people.ts";
import { iconButton, primaryButton, secondaryButton } from "./ui/buttons.ts";
import { Link } from "./ui/Link.tsx";

interface Notice {
  text: string;
  tone: "info" | "error";
}

type OpenDialog = { kind: "profile"; welcome: boolean } | { kind: "rooms" } | { kind: "person"; username: string };

/** People sorted by nickname, as the server sends them. */
function upsertPerson(people: Person[], person: Person): Person[] {
  return [...people.filter((p) => p.username !== person.username), person].sort((a, b) =>
    a.nickname.localeCompare(b.nickname, undefined, { sensitivity: "base" }),
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [chat, setChat] = useState<ChatState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Set when the session ends mid-use. Holds the sign-in URL.
  const [signedOut, setSignedOut] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const current = useRoute();

  // For the live connection's handlers, which outlive renders.
  const currentRef = useRef(current);
  currentRef.current = current;
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const listeners = useRef(new Set<(m: Message) => void>());
  /** the last message id sent to /api/read, per conversation */
  const readSent = useRef(new Map<string, number>());

  const handleError = useCallback((err: unknown) => {
    if (err instanceof SignedOutError) setSignedOut(signInUrl(err.loginUrl));
    else setNotice({ text: describeError(err), tone: "error" });
  }, []);

  const loadState = useCallback(async () => {
    setChat(await api<ChatState>("/api/state"));
  }, []);
  const refresh = useCallback(() => void loadState().catch(handleError), [loadState, handleError]);

  useEffect(() => {
    fetchMe()
      .then(async (user) => {
        setPageUser(user.username);
        setMe(user);
        await loadState();
      })
      .catch((err: unknown) => {
        if (err instanceof SignedOutError) goToSignIn(err);
        else setLoadError("Could not open Althing. Try again in a moment.");
      });
  }, [loadState]);

  // The live connection.
  const username = me?.username;
  useEffect(() => {
    if (!username || signedOut) return;
    return listen(username, {
      onEvent: (e) => {
        switch (e.name) {
          case "message": {
            const m = e.data;
            for (const fn of listeners.current) fn(m);
            const conv = parseKey(m.conv);
            // A new direct conversation: the list comes from the server.
            if (conv?.kind === "dm" && !chatRef.current?.dms.some((d) => d.id === conv.id)) {
              refresh();
              return;
            }
            const seen =
              m.author === username || (m.conv === currentRef.current && document.visibilityState === "visible");
            setChat((c) => {
              if (!c) return c;
              const dms =
                conv?.kind === "dm"
                  ? [
                      ...c.dms.filter((d) => d.id === conv.id).map((d) => ({ ...d, lastId: m.id })),
                      ...c.dms.filter((d) => d.id !== conv.id),
                    ]
                  : c.dms;
              const unread = seen ? c.unread : { ...c.unread, [m.conv]: (c.unread[m.conv] ?? 0) + 1 };
              return { ...c, dms, unread };
            });
            break;
          }
          case "rooms":
            setChat((c) => c && { ...c, rooms: e.data });
            break;
          case "online":
            setChat((c) => c && { ...c, online: e.data });
            break;
          case "person":
            setChat(
              (c) =>
                c && {
                  ...c,
                  people: upsertPerson(c.people, e.data),
                  me: e.data.username === c.me.username ? e.data : c.me,
                },
            );
            break;
        }
      },
      onReconnect: () => {
        refresh();
        setReloadToken((t) => t + 1);
      },
      onSignedOut: (loginUrl) => setSignedOut(signInUrl(loginUrl)),
      onOtherUser: () => location.reload(),
    });
  }, [username, signedOut, refresh]);

  // While signed out, check again whenever the user comes back to this tab (e.g. after signing
  // in from the banner's link). Someone else signing in gets a fresh page.
  useEffect(() => {
    if (!signedOut || !username) return;
    return watchForSignIn(username, () => {
      setSignedOut(null);
      refresh();
      setReloadToken((t) => t + 1);
    });
  }, [signedOut, username, refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // The first visit: the welcome, with the rules.
  const welcomed = chat?.welcomed;
  useEffect(() => {
    if (welcomed === false) setDialog({ kind: "profile", welcome: true });
  }, [welcomed]);

  const subscribe = useCallback((fn: (m: Message) => void) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  const markRead = useCallback(
    (key: string, id: number) => {
      setChat((c) => {
        if (!c || !c.unread[key]) return c;
        const unread = { ...c.unread };
        delete unread[key];
        return { ...c, unread };
      });
      if ((readSent.current.get(key) ?? 0) >= id) return;
      readSent.current.set(key, id);
      api("/api/read", { method: "POST", body: { conv: key, id } }).catch(handleError);
    },
    [handleError],
  );

  const people = useMemo(() => new Map((chat?.people ?? []).map((p) => [p.username, p])), [chat?.people]);
  const online = useMemo(() => new Set(chat?.online ?? []), [chat?.online]);

  async function startDm(other: string) {
    try {
      const dm = await api<Dm>("/api/dms", { method: "POST", body: { with: other } });
      setChat((c) => (c && !c.dms.some((d) => d.id === dm.id) ? { ...c, dms: [dm, ...c.dms] } : c));
      setNavOpen(false);
      go(dmKey(dm.id));
    } catch (err) {
      handleError(err);
    }
  }

  const roomAction = useCallback(
    async (id: number, action: "join" | "leave") => {
      try {
        await api(`/api/rooms/${id}/${action}`, { method: "POST" });
        if (action === "leave") go(LOBBY_KEY);
      } catch (err) {
        handleError(err);
      }
    },
    [handleError],
  );

  // What the open conversation is, and whether the user can be in it.
  const view = useMemo(() => {
    if (!chat) return null;
    const conv = parseKey(current);
    let title = "Lobby";
    let header: ReactNode = null;
    let blocked: ReactNode | null = null;
    let readOnly: string | null = null;
    const empty = (text: string, action?: ReactNode) => (
      <div className="m-auto max-w-sm p-8 text-center text-sm text-stone-600">
        <p className="mb-4">{text}</p>
        {action}
      </div>
    );
    if (conv?.kind === "room") {
      const room = chat.rooms.find((r) => r.id === conv.id);
      if (conv.id === LOBBY_ID) {
        header = (
          <div className="min-w-0">
            <h1 className="font-semibold text-stone-800">Lobby</h1>
            <p className="text-xs text-stone-400">Everyone · {chat.online.length} online</p>
          </div>
        );
      } else if (!room) {
        title = "Closed room";
        header = <h1 className="font-semibold text-stone-800">Closed room</h1>;
        blocked = empty(
          "This room has closed: everyone left.",
          <Link to={LOBBY_KEY} className={primaryButton}>
            Go to the lobby
          </Link>,
        );
      } else {
        title = `#${room.name}`;
        const inside = room.members.includes(chat.me.username);
        header = (
          <>
            <Hash className="h-5 w-5 shrink-0 text-stone-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-semibold text-stone-800">{room.name}</h1>
              <p className="truncate text-xs text-stone-400">
                {room.members.map((u) => nameOf(people.get(u))).join(", ") || "Nobody is here"}
              </p>
            </div>
            {inside && (
              <button type="button" className={secondaryButton} onClick={() => void roomAction(room.id, "leave")}>
                <LogOut className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Leave</span>
              </button>
            )}
          </>
        );
        if (!inside) {
          blocked = empty(
            `${room.members.length === 1 ? "1 person is" : `${room.members.length} people are`} in this room. Join to read and write.`,
            <button type="button" className={primaryButton} onClick={() => void roomAction(room.id, "join")}>
              Join #{room.name}
            </button>,
          );
        }
      }
    } else if (conv?.kind === "dm") {
      const dm = chat.dms.find((d) => d.id === conv.id);
      const person = dm?.with ? people.get(dm.with) : undefined;
      title = dm ? nameOf(person) : "Not found";
      header = dm ? (
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left"
          onClick={() => dm.with && person && setDialog({ kind: "person", username: dm.with })}
        >
          <Avatar person={person} size="h-8 w-8" online={!!dm.with && online.has(dm.with)} />
          <span className="min-w-0">
            <span className={`block truncate font-semibold ${person ? "text-stone-800" : "text-stone-400 italic"}`}>
              {nameOf(person)}
            </span>
            <span className="block text-xs text-stone-400">
              {person ? (online.has(dm.with!) ? "Online" : "Offline") : "Removed from the suite"}
            </span>
          </span>
        </button>
      ) : (
        <h1 className="font-semibold text-stone-800">Not found</h1>
      );
      if (!dm) blocked = empty("There is no such conversation.");
      else if (!person) readOnly = "This person is no longer in Althing. The conversation stays on record.";
    }
    return { title, header, blocked, readOnly };
  }, [chat, current, people, online, roomAction]);

  // The tab's title: unread messages first, then where the user is.
  const unreadTotal = Object.values(chat?.unread ?? {}).reduce((a, b) => a + b, 0);
  useEffect(() => {
    document.title = `${unreadTotal > 0 ? `(${unreadTotal}) ` : ""}${view ? `${view.title} · ` : ""}Althing`;
  }, [unreadTotal, view]);

  if (loadError) return <p className="p-8 text-sm text-red-600">{loadError}</p>;
  if (!me || !chat || !view) return <p className="p-8 text-sm text-stone-400">Opening Althing…</p>;

  const person = dialog?.kind === "person" ? people.get(dialog.username) : undefined;

  return (
    <div className="flex h-full bg-stone-50 text-stone-800">
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-stone-900/30 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-stone-200 bg-stone-100 transition-transform md:static md:z-auto
          md:w-64 md:shrink-0 md:translate-x-0 ${navOpen ? "translate-x-0 shadow-xl" : "-translate-x-full"}`}
      >
        <button
          type="button"
          className={`${iconButton} absolute top-4 right-3 md:hidden`}
          aria-label="Close the menu"
          onClick={() => setNavOpen(false)}
        >
          <X className="h-5 w-5" />
        </button>
        <Sidebar
          me={chat.me}
          people={people}
          online={online}
          rooms={chat.rooms}
          dms={chat.dms}
          unread={chat.unread}
          current={current}
          onProfile={() => {
            setNavOpen(false);
            setDialog({ kind: "profile", welcome: false });
          }}
          onRooms={() => {
            setNavOpen(false);
            setDialog({ kind: "rooms" });
          }}
          onPerson={(u) => setDialog({ kind: "person", username: u })}
          onNavigate={() => setNavOpen(false)}
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {signedOut && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-x-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            Your session has ended.
            <a href={signedOut} target="_blank" rel="noopener" className="font-medium underline">
              Sign in again
            </a>
            (in a new tab), then come back.
          </div>
        )}
        <Conversation
          key={current}
          convKey={current}
          header={view.header}
          blocked={view.blocked}
          readOnly={view.readOnly}
          me={chat.me.username}
          people={people}
          reloadToken={reloadToken}
          subscribe={subscribe}
          onRead={markRead}
          onPerson={(u) => setDialog({ kind: "person", username: u })}
          onError={handleError}
          onMenu={() => setNavOpen(true)}
        />
      </main>

      {notice && (
        <div
          role="status"
          className={`fixed bottom-20 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg ${
            notice.tone === "error" ? "bg-red-700 text-white" : "bg-stone-800 text-white"
          }`}
        >
          {notice.text}
        </div>
      )}

      {dialog?.kind === "profile" && (
        <ProfileDialog
          me={chat.me}
          welcome={dialog.welcome}
          onSaved={(p) => setChat((c) => c && { ...c, me: p, people: upsertPerson(c.people, p) })}
          onClose={() => {
            setDialog(null);
            if (dialog.welcome) {
              setChat((c) => c && { ...c, welcomed: true });
              api("/api/welcomed", { method: "POST" }).catch(handleError);
            }
          }}
        />
      )}
      {dialog?.kind === "rooms" && (
        <RoomsDialog me={chat.me.username} rooms={chat.rooms} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "person" && person && (
        <PersonDialog
          person={person}
          online={online.has(person.username)}
          isMe={person.username === chat.me.username}
          onMessage={() => void startDm(person.username)}
          onEditProfile={() => setDialog({ kind: "profile", welcome: false })}
          // Its buttons open something else first; closing must not shut that.
          onClose={() => setDialog((d) => (d?.kind === "person" ? null : d))}
        />
      )}
    </div>
  );
}
