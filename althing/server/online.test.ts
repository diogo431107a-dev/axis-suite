import { describe, expect, it, vi } from "vitest";
import type { Events } from "./events.ts";
import { createOnline } from "./online.ts";

/** Just enough of the event streams: who is connected, with which cookies. */
function fakeEvents(streams: Record<string, string>) {
  const ended: string[] = [];
  const events = {
    connected: () => [...new Set(Object.values(streams))],
    cookies: () => Object.keys(streams),
    endStreams: (cookie: string) => {
      ended.push(cookie);
      delete streams[cookie];
    },
    endStreamsOf: (username: string) => {
      for (const [cookie, u] of Object.entries(streams)) if (u === username) events.endStreams(cookie);
    },
  } as unknown as Events;
  return { events, ended };
}

function heimdall(answers: Record<string, string[] | null>) {
  return vi.fn(async (_url: URL | string | Request, init?: RequestInit) => {
    const cookie = (init!.headers as Record<string, string>).cookie ?? "";
    const usernames = answers[cookie];
    return usernames ? Response.json({ usernames }) : Response.json({ error: "Not signed in" }, { status: 401 });
  });
}

describe("who is online", () => {
  it("is Heimdall's list", async () => {
    const { events } = fakeEvents({ "sid=a": "odin" });
    const onChange = vi.fn();
    const online = createOnline({
      internalUrl: "http://heimdall",
      events,
      onChange,
      fetch: heimdall({ "sid=a": ["freya", "john", "odin"] }) as unknown as typeof fetch,
    });
    await online.refresh();
    expect(online.current()).toEqual(["freya", "john", "odin"]);
    expect(onChange).toHaveBeenCalledTimes(1);
    await online.refresh();
    expect(onChange).toHaveBeenCalledTimes(1);
    online.stop();
  });

  it("moves on from a cookie whose session ended, and closes its streams", async () => {
    const { events, ended } = fakeEvents({ "sid=old": "john", "sid=b": "freya" });
    const online = createOnline({
      internalUrl: "http://heimdall",
      events,
      onChange: () => {},
      fetch: heimdall({ "sid=b": ["freya"] }) as unknown as typeof fetch,
    });
    await online.refresh();
    expect(ended).toEqual(["sid=old"]);
    expect(online.current()).toEqual(["freya"]);
    online.stop();
  });

  it("closes the tabs of someone Heimdall no longer lists (they signed out)", async () => {
    const { events, ended } = fakeEvents({ "sid=a": "odin", "sid=j": "john" });
    const online = createOnline({
      internalUrl: "http://heimdall",
      events,
      onChange: () => {},
      fetch: heimdall({ "sid=a": ["odin"], "sid=j": ["odin"] }) as unknown as typeof fetch,
    });
    await online.refresh();
    expect(ended).toEqual(["sid=j"]);
    expect(online.current()).toEqual(["odin"]);
    online.stop();
  });

  it("falls back to who has Althing open when Heimdall can't say", async () => {
    const { events } = fakeEvents({ "sid=a": "odin" });
    const online = createOnline({
      internalUrl: "http://heimdall",
      events,
      onChange: () => {},
      fetch: (async () => new Response("Not found", { status: 404 })) as unknown as typeof fetch,
    });
    await online.refresh();
    expect(online.current()).toEqual(["odin"]);
    online.stop();
  });
});
