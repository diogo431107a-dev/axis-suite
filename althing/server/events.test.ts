import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createEvents } from "./events.ts";

/** A request and response pair, enough for subscribe(). Writing after end() throws, as in Node. */
function tab(cookie: string) {
  const req = Object.assign(new EventEmitter(), { headers: { cookie } }) as unknown as IncomingMessage;
  const written: string[] = [];
  const res = {
    writableEnded: false,
    writeHead() {},
    write(chunk: string) {
      if (this.writableEnded) throw new Error("write after end");
      written.push(chunk);
    },
    end() {
      this.writableEnded = true;
    },
  };
  return { req, res: res as unknown as ServerResponse, written, close: () => req.emit("close") };
}

describe("event streams", () => {
  it("know who is connected, across tabs", () => {
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const events = createEvents({ onConnect, onDisconnect });
    const a = tab("sid=1");
    const b = tab("sid=1");
    events.subscribe("odin", a.req, a.res);
    events.subscribe("odin", b.req, b.res);
    expect(onConnect).toHaveBeenCalledTimes(1);
    a.close();
    expect(events.isConnected("odin")).toBe(true);
    b.close();
    expect(onDisconnect).toHaveBeenCalledWith("odin");
    expect(events.connected()).toEqual([]);
    events.closeAll();
  });

  it("send only to the people named, or everyone", () => {
    const events = createEvents();
    const odin = tab("sid=1");
    const freya = tab("sid=2");
    events.subscribe("odin", odin.req, odin.res);
    events.subscribe("freya", freya.req, freya.res);
    events.send(["freya"], "online", ["freya"]);
    events.send("everyone", "online", ["odin", "freya"]);
    expect(odin.written.filter((w) => w.startsWith("event:"))).toHaveLength(1);
    expect(freya.written.filter((w) => w.startsWith("event:"))).toHaveLength(2);
    events.closeAll();
  });

  it("end a signed-out session's streams, and never write to them again", () => {
    const onDisconnect = vi.fn();
    const events = createEvents({ onDisconnect });
    const old = tab("sid=old");
    events.subscribe("john", old.req, old.res);
    events.endStreams("sid=old");
    expect(onDisconnect).toHaveBeenCalledWith("john");
    expect(events.cookies()).toEqual([]);
    // The connection closes a moment later; meanwhile the server goes on sending.
    expect(() => events.send("everyone", "online", [])).not.toThrow();
    old.close();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    events.closeAll();
  });
});
