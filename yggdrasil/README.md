# Yggdrasil

An outliner in the style of Workflowy and Dynalist. Each signed-in user has one tree of bullets, and any bullet can be zoomed into. Yggdrasil has no login of its own: it uses the sessions of [Heimdall](../heimdall/README.md).

| Layer    | Technology                                                              |
| -------- | ----------------------------------------------------------------------- |
| Frontend | React 19, Vite 8, Tailwind CSS 4                                        |
| Backend  | Express 5, SQLite through Node's built-in `node:sqlite`                 |
| Database | `/var/lib/yggdrasil/tree.db` on a server, `data/tree.db` in development |
| Sign-in  | Heimdall, through `@axis-suite/heimdall-client`                         |

## Local development

From the suite's root, `pnpm dev` starts every module. Open **http://127.0.0.1:5174** (not `localhost`; see the [suite README](../README.md#development)).

`pnpm --filter yggdrasil dev` starts only Yggdrasil: the frontend on 127.0.0.1:5174 and the API on 127.0.0.1:3002. It still needs Heimdall on 127.0.0.1:3000.

```bash
pnpm --filter yggdrasil test    # the server and browser tests (Vitest)
```
