import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Menu, X } from "lucide-react";
import {
  SignedOutError,
  fetchMe,
  goToSignIn,
  signInUrl,
  watchForSignIn,
  type Me,
} from "@axis-suite/heimdall-client/browser";
import { displayName } from "../shared/contact.ts";
import {
  COLORS,
  DEFAULT_SETTINGS,
  type Contact,
  type ContactFields,
  type ContactSaved,
  type ContactSummary,
  type Group,
  type GroupFields,
  type Settings,
} from "../shared/protocol.ts";
import { BinView } from "./BinView.tsx";
import { Sidebar, type SidebarDialog } from "./Sidebar.tsx";
import { ApiFailure, api, describeError, query, setPageUser } from "./api.ts";
import { copy } from "./clipboard.ts";
import { ContactEditor, type SaveOutcome } from "./contact/ContactEditor.tsx";
import { ContactView } from "./contact/ContactView.tsx";
import { BackupDialog } from "./dialogs/BackupDialog.tsx";
import { GroupDialog } from "./dialogs/GroupDialog.tsx";
import { SettingsDialog } from "./dialogs/SettingsDialog.tsx";
import { download, fileName } from "./download.ts";
import { useToday } from "./hooks.ts";
import { writeVcard } from "./io/vcard.ts";
import { ContactList } from "./list/ContactList.tsx";
import { HOME, go, useRoute, withOpen, type Filter } from "./nav.ts";
import { AboutButton } from "./ui/About.tsx";
import { iconButton } from "./ui/buttons.ts";
import { upcoming } from "./upcoming/upcoming.ts";
import { UpcomingView } from "./upcoming/UpcomingView.tsx";

type DialogState = { kind: "group"; group?: Group } | { kind: "settings" } | { kind: "backup" };

interface Notice {
  text: string;
  tone: "info" | "error";
}

/** The open contact: loading, loaded, or not there (deleted, in the bin, someone else's). */
type Opened = { id: string; contact: Contact | null; missing: boolean };

const matchesFilter = (c: ContactSummary, filter: Filter) =>
  filter.kind === "all" || (filter.kind === "favorites" ? c.favorite : c.groupIds.includes(filter.id));

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [groups, setGroups] = useState<Group[]>([]);
  // Every contact outside the bin: the list, its counts and Upcoming come from here.
  const [all, setAll] = useState<ContactSummary[] | null>(null);
  const [binned, setBinned] = useState<ContactSummary[] | null>(null);
  const [found, setFound] = useState<ContactSummary[] | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  // Goes up after every change: the open contact and the search follow.
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Set when the session ends mid-use. Holds the sign-in URL.
  const [signedOut, setSignedOut] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const route = useRoute();
  const today = useToday();

  const handleError = useCallback((err: unknown) => {
    if (err instanceof SignedOutError) setSignedOut(signInUrl(err.loginUrl));
    else setNotice({ text: describeError(err), tone: "error" });
  }, []);

  /** Runs a change; on failure, says why and answers null. */
  const attempt = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (err) {
        handleError(err);
        return null;
      }
    },
    [handleError],
  );

  /** Fetches the contacts, groups and bin again. */
  const reload = useCallback(async () => {
    const [c, g, b] = await Promise.all([
      api<ContactSummary[]>("/api/contacts"),
      api<Group[]>("/api/groups"),
      api<ContactSummary[]>("/api/contacts?bin=1"),
    ]);
    setAll(c);
    setGroups(g);
    setBinned(b);
    setRevision((r) => r + 1);
  }, []);

  useEffect(() => {
    fetchMe()
      .then(async (user) => {
        setPageUser(user.username);
        setMe(user);
        setSettings(await api<Settings>("/api/settings"));
        await reload();
      })
      .catch((err: unknown) => {
        if (err instanceof SignedOutError) goToSignIn(err);
        else setLoadError("Could not load your contacts. Try again in a moment.");
      });
  }, [reload]);

  // While signed out, check again whenever the user comes back to this tab (e.g. after signing
  // in from the banner's link). Someone else signing in gets a fresh page.
  useEffect(() => {
    if (!signedOut || !me) return;
    return watchForSignIn(me.username, () => {
      setSignedOut(null);
      reload().catch(handleError);
    });
  }, [signedOut, me, reload, handleError]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // A search asks the server, which looks in every field.
  const filter = route.kind === "contacts" ? route.filter : null;
  const q = route.kind === "contacts" ? route.q.trim() : "";
  const groupId = filter?.kind === "group" ? filter.id : null;
  const favorites = filter?.kind === "favorites";
  useEffect(() => {
    if (!me || !q) return setFound(null);
    let stale = false;
    const params = { q, group: groupId, favorites: favorites ? "1" : null };
    api<ContactSummary[]>(`/api/contacts${query(params)}`).then(
      (list) => !stale && setFound(list),
      (err: unknown) => !stale && handleError(err),
    );
    return () => {
      stale = true;
    };
  }, [me, q, groupId, favorites, revision, handleError]);

  // The open contact, fetched whole.
  const openId = route.kind === "contacts" && route.open?.kind === "contact" ? route.open.id : null;
  useEffect(() => {
    if (!me || !openId) return setOpened(null);
    let stale = false;
    setOpened((o) => (o?.id === openId ? o : { id: openId, contact: null, missing: false }));
    api<Contact>(`/api/contacts/${openId}`).then(
      (contact) => !stale && setOpened({ id: openId, contact, missing: false }),
      (err: unknown) => {
        if (stale) return;
        if (err instanceof ApiFailure && err.status === 404) setOpened({ id: openId, contact: null, missing: true });
        else handleError(err);
      },
    );
    return () => {
      stale = true;
    };
  }, [me, openId, revision, handleError]);

  const shown = useMemo(() => {
    if (!filter) return null;
    if (q) return found;
    return all?.filter((c) => matchesFilter(c, filter)) ?? null;
  }, [all, found, filter, q]);

  const group = filter?.kind === "group" ? (groups.find((g) => g.id === filter.id) ?? null) : null;
  const title =
    filter?.kind === "favorites"
      ? "Favourites"
      : filter?.kind === "group"
        ? (group?.name ?? "No such group")
        : "All contacts";
  const counts = useMemo(
    () => ({
      all: all?.length ?? 0,
      favorites: all?.filter((c) => c.favorite).length ?? 0,
      soon: all ? upcoming(all, today, 7).length : 0,
      bin: binned?.length ?? 0,
    }),
    [all, binned, today],
  );

  useEffect(() => {
    const name = opened?.contact ? displayName(opened.contact) : null;
    document.title = name ? `${name} · Vinr` : "Vinr";
  }, [opened]);

  // Keys, when nobody is typing: / searches, N makes a contact, E edits the open one.
  const routeRef = useRef(route);
  routeRef.current = route;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || target.closest("input, textarea, select, dialog, [contenteditable]"))
        return;
      const r = routeRef.current;
      if (e.key === "/") {
        e.preventDefault();
        if (r.kind !== "contacts") go(HOME);
        setTimeout(() => document.querySelector<HTMLInputElement>("[data-search]")?.focus());
      } else if (e.key.toLowerCase() === "n" && !(r.kind === "contacts" && r.open?.kind === "new")) {
        go(withOpen(r, { kind: "new" }));
      } else if (e.key.toLowerCase() === "e" && r.kind === "contacts" && r.open?.kind === "contact" && !r.open.edit) {
        go(withOpen(r, { ...r.open, edit: true }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Changes ──────────────────────────────────────────────────────────────────────────────────

  async function saveContact(id: string | null, fields: ContactFields, rev: number): Promise<SaveOutcome> {
    try {
      const saved = id
        ? await api<ContactSaved>(`/api/contacts/${id}`, { method: "PUT", body: { ...fields, rev } })
        : await api<ContactSaved>("/api/contacts", { method: "POST", body: fields });
      go(withOpen(route, { kind: "contact", id: saved.id, edit: false }));
      await reload().catch(handleError);
      return { kind: "saved" };
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "conflict" && err.body?.contact) {
        return { kind: "conflict", theirs: err.body.contact };
      }
      handleError(err);
      if (err instanceof SignedOutError) {
        return { kind: "error", message: "Your session has ended. Sign in again (see above), then save." };
      }
      return { kind: "error", message: describeError(err) };
    }
  }

  async function star(id: string, favorite: boolean) {
    // Shown at once; put back if it fails.
    const flip = (on: boolean) =>
      setAll((list) => list?.map((c) => (c.id === id ? { ...c, favorite: on } : c)) ?? null);
    flip(favorite);
    setFound((list) => list?.map((c) => (c.id === id ? { ...c, favorite } : c)) ?? null);
    setOpened((o) => (o?.contact?.id === id ? { ...o, contact: { ...o.contact, favorite } } : o));
    const done = await attempt(() => api<Contact>(`/api/contacts/${id}`, { method: "PATCH", body: { favorite } }));
    if (!done) flip(!favorite);
  }

  async function binContact(contact: Contact) {
    const done = await attempt(() => api(`/api/contacts/${contact.id}`, { method: "DELETE" }));
    if (done === null) return;
    go(withOpen(route, null), true);
    await reload().catch(handleError);
    setNotice({ text: `${displayName(contact)} is in the recycle bin.`, tone: "info" });
  }

  async function restoreContact(contact: ContactSummary) {
    const done = await attempt(() => api<Contact>(`/api/contacts/${contact.id}/restore`, { method: "POST" }));
    if (!done) return;
    await reload().catch(handleError);
    setNotice({ text: `${displayName(contact)} is back.`, tone: "info" });
  }

  async function purgeContact(contact: ContactSummary) {
    if (!window.confirm(`Delete ${displayName(contact)} for good? This can't be undone.`)) return;
    const done = await attempt(() => api(`/api/contacts/${contact.id}?purge=1`, { method: "DELETE" }));
    if (done !== null) await reload().catch(handleError);
  }

  async function saveGroup(existing: Group | undefined, fields: GroupFields): Promise<boolean> {
    const saved = await attempt(() =>
      existing
        ? api<Group>(`/api/groups/${existing.id}`, { method: "PATCH", body: fields })
        : api<Group>("/api/groups", { method: "POST", body: fields }),
    );
    if (!saved) return false;
    await reload().catch(handleError);
    if (!existing) go({ kind: "contacts", filter: { kind: "group", id: saved.id }, q: "", open: null });
    return true;
  }

  async function deleteGroup(existing: Group): Promise<boolean> {
    const done = await attempt(() => api(`/api/groups/${existing.id}`, { method: "DELETE" }));
    if (done === null) return false;
    if (filter?.kind === "group" && filter.id === existing.id) go(HOME, true);
    await reload().catch(handleError);
    return true;
  }

  async function saveSettings(next: Settings): Promise<boolean> {
    const saved = await attempt(() => api<Settings>("/api/settings", { method: "PUT", body: next }));
    if (saved) setSettings(saved);
    return saved !== null;
  }

  async function afterImport() {
    const s = await attempt(() => api<Settings>("/api/settings"));
    if (s) setSettings(s);
    await reload().catch(handleError);
  }

  function downloadVcard(c: Contact) {
    const names = new Map(groups.map((g) => [g.id, g.name]));
    const card = writeVcard({ ...c, groups: c.groupIds.map((id) => names.get(id)!).filter(Boolean) });
    download(fileName(displayName(c), "vcf"), "text/vcard", `${card}\r\n`);
  }

  async function copyText(text: string, what: string) {
    const ok = await copy(text);
    setNotice(
      ok ? { text: `Copied ${what}.`, tone: "info" } : { text: "The browser didn't allow copying.", tone: "error" },
    );
  }

  // ── Page ─────────────────────────────────────────────────────────────────────────────────────

  if (loadError) return <p className="p-8 text-sm text-red-600">{loadError}</p>;
  if (!me || !all) return <p className="p-8 text-sm text-stone-400">Opening your contacts…</p>;

  const openDialog = (kind: SidebarDialog, g?: Group) => {
    setNavOpen(false);
    setDialog(kind === "group" ? { kind, group: g } : { kind });
  };

  let main;
  if (route.kind === "upcoming") {
    main = (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <UpcomingView contacts={all} today={today} />
      </div>
    );
  } else if (route.kind === "bin") {
    main = (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <BinView binned={binned} onRestore={restoreContact} onPurge={purgeContact} />
      </div>
    );
  } else {
    const open = route.open;
    const back = () => go(withOpen(route, null));
    let detail;
    if (open?.kind === "new") {
      detail = (
        <ContactEditor
          key="new"
          contact={null}
          groups={groups}
          startGroups={group ? [group.id] : []}
          here={route}
          onSave={(fields, rev) => saveContact(null, fields, rev)}
          onCancel={back}
        />
      );
    } else if (open?.kind === "contact") {
      const contact = opened?.id === open.id ? opened.contact : null;
      if (opened?.id === open.id && opened.missing) {
        detail = (
          <p className="mx-auto max-w-xl px-6 py-16 text-center text-sm text-stone-500">
            This contact doesn't exist, or it is in the recycle bin.
          </p>
        );
      } else if (!contact) {
        detail = <p className="p-8 text-sm text-stone-400">Loading…</p>;
      } else if (open.edit) {
        detail = (
          <ContactEditor
            key={contact.id}
            contact={contact}
            groups={groups}
            here={route}
            onSave={(fields, rev) => saveContact(contact.id, fields, rev)}
            onCancel={() => go(withOpen(route, { ...open, edit: false }))}
          />
        );
      } else {
        detail = (
          <ContactView
            contact={contact}
            groups={groups}
            countryCode={settings.countryCode}
            today={today}
            onBack={back}
            onEdit={() => go(withOpen(route, { ...open, edit: true }))}
            onStar={() => void star(contact.id, !contact.favorite)}
            onDelete={() => void binContact(contact)}
            onVcard={() => downloadVcard(contact)}
            onCopy={(text, what) => void copyText(text, what)}
          />
        );
      }
    } else {
      detail = (
        <p className="m-auto px-6 text-center text-sm text-stone-400">
          {all.length === 0
            ? "No contacts yet. Make one with New contact, or import a vCard file from your phone or Google Contacts (Export and import)."
            : "Pick someone from the list."}
        </p>
      );
    }

    main = (
      <div className="flex min-h-0 flex-1">
        <div
          className={`min-h-0 w-full flex-col border-stone-200 bg-stone-50 lg:flex lg:w-80 lg:shrink-0 lg:border-r ${
            open ? "hidden" : "flex"
          }`}
        >
          <ContactList
            route={route}
            contacts={shown}
            title={title}
            sortBy={settings.sortBy}
            onStar={(c) => void star(c.id, !c.favorite)}
          />
        </div>
        <div className={`min-h-0 min-w-0 flex-1 overflow-y-auto ${open ? "flex" : "hidden lg:flex"}`}>{detail}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-stone-50 text-stone-800">
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-stone-900/30 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-stone-200 bg-stone-100 transition-transform md:static md:z-auto
          md:w-60 md:shrink-0 md:translate-x-0 ${navOpen ? "translate-x-0 shadow-xl" : "-translate-x-full"}`}
      >
        <button
          type="button"
          className={`${iconButton} absolute top-3 right-3 md:hidden`}
          aria-label="Close the menu"
          onClick={() => setNavOpen(false)}
        >
          <X className="h-5 w-5" />
        </button>
        <Sidebar
          me={me}
          route={route}
          groups={groups}
          counts={counts}
          onDialog={openDialog}
          onNavigate={() => setNavOpen(false)}
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-stone-200 bg-stone-50/95 px-3 py-2 md:hidden">
          <button type="button" className={iconButton} aria-label="Menu" onClick={() => setNavOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <AboutButton className="px-1 font-semibold text-stone-800">Vinr</AboutButton>
        </div>

        {signedOut && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-x-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            Your session has ended. What you are editing stays here;
            <a href={signedOut} target="_blank" rel="noopener" className="font-medium underline">
              sign in again
            </a>
            (in a new tab), then save.
          </div>
        )}

        {main}
      </main>

      {notice && (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg ${
            notice.tone === "error" ? "bg-red-700 text-white" : "bg-stone-800 text-white"
          }`}
        >
          {notice.text}
        </div>
      )}

      {dialog?.kind === "group" && (
        <GroupDialog
          group={dialog.group}
          suggestedColor={COLORS.find((c) => !groups.some((g) => g.color === c))}
          onSave={(fields) => saveGroup(dialog.group, fields)}
          onDelete={dialog.group ? () => deleteGroup(dialog.group!) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "settings" && (
        <SettingsDialog settings={settings} onSave={saveSettings} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "backup" && (
        <BackupDialog
          group={group}
          onImported={() => void afterImport()}
          onError={handleError}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
