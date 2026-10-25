// The owner's commands, run on the server itself:
//
//   sudo node /opt/saga/dist/server/admin.js <command> [arguments]     (on a server)
//   pnpm --filter saga admin <command> [arguments]                     (in development)
//
// They ask the running service, which alone writes the database. The service writes a fresh
// token to admin.token in its state folder on every start; reading it takes root on a server.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const USAGE = `Commands:
  invite [note]                    a new invite code (valid 30 days); the note says who it is for
  invites                          every invite code, and who used it
  players                          every player, with their hero, level and fame
  reset-password <username>        a temporary password, which the player must change after signing in
  rename-hero <username> <name>    a new hero name, e.g. for a name that shouldn't be in the ranking
  remove <username>                deletes the player, their game and their place in the ranking`;

function stateDir(): string {
  if (process.env.STATE_DIRECTORY) return process.env.STATE_DIRECTORY;
  return existsSync("/var/lib/saga/admin.token") ? "/var/lib/saga" : "data";
}

// The service's port, from the installer's /etc/axis-suite/saga.env on a server.
function port(): string {
  if (process.env.PORT) return process.env.PORT;
  try {
    const env = readFileSync("/etc/axis-suite/saga.env", "utf8");
    const found = /^PORT=(\d+)$/m.exec(env);
    if (found) return found[1]!;
  } catch {
    // not installed here: development
  }
  return "3011";
}

async function call(method: "GET" | "POST", path: string, body?: object): Promise<unknown> {
  let token: string;
  try {
    token = readFileSync(join(stateDir(), "admin.token"), "utf8").trim();
  } catch {
    throw new Error("Can't read Saga's admin.token. Is the service running, and did you use sudo?");
  }
  const res = await fetch(`http://127.0.0.1:${port()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `The service answered ${res.status}`);
  return data;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "-");

async function main(args: string[]) {
  const [command, ...rest] = args;
  switch (command) {
    case "invite": {
      const invite = (await call("POST", "/admin/invite", { note: rest.join(" ") })) as {
        code: string;
        expiresAt: string;
      };
      console.log(`${invite.code}   (valid until ${day(invite.expiresAt)})`);
      return;
    }
    case "invites": {
      const list = (await call("GET", "/admin/invites")) as {
        code: string;
        note: string;
        expiresAt: string;
        usedBy: string | null;
        usedAt: string | null;
      }[];
      for (const i of list) {
        // A code stays used when its player is removed later; only usedBy is cleared then.
        const status = i.usedAt
          ? `used by ${i.usedBy ?? "a player since removed"}`
          : i.expiresAt <= new Date().toISOString()
            ? `expired on ${day(i.expiresAt)}`
            : `unused, valid until ${day(i.expiresAt)}`;
        console.log(`${i.code}  ${status}${i.note ? `  (${i.note})` : ""}`);
      }
      if (list.length === 0) console.log("No invite codes yet.");
      return;
    }
    case "players": {
      const list = (await call("GET", "/admin/players")) as {
        username: string;
        heroName: string;
        lastSeenAt: string | null;
        level: number | null;
        fame: number | null;
      }[];
      for (const p of list) {
        console.log(
          `${p.username}  "${p.heroName}"  level ${p.level ?? 0}, fame ${p.fame ?? 0}, last seen ${day(p.lastSeenAt)}`,
        );
      }
      if (list.length === 0) console.log("No players yet.");
      return;
    }
    case "reset-password": {
      if (!rest[0]) break;
      const { password } = (await call("POST", "/admin/reset-password", { username: rest[0] })) as {
        password: string;
      };
      console.log(`Temporary password for ${rest[0]}: ${password}`);
      console.log("They are asked for a new one when they sign in.");
      return;
    }
    case "rename-hero": {
      if (!rest[0] || rest.length < 2) break;
      const p = (await call("POST", "/admin/rename-hero", { username: rest[0], name: rest.slice(1).join(" ") })) as {
        heroName: string;
      };
      console.log(`${rest[0]}'s hero is now called ${p.heroName}.`);
      return;
    }
    case "remove": {
      if (!rest[0]) break;
      await call("POST", "/admin/remove", { username: rest[0] });
      console.log(`Removed ${rest[0]}, with their game.`);
      return;
    }
  }
  console.log(USAGE);
  process.exitCode = command ? 1 : 0;
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
