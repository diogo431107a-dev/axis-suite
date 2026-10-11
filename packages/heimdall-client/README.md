# @axis-suite/heimdall-client

How a module of the suite uses [Heimdall](../../heimdall/README.md) for sign-in. Add it to a module with `"@axis-suite/heimdall-client": "workspace:*"` in `dependencies`.

## Server: `@axis-suite/heimdall-client/server`

```ts
import express from "express";
import { heimdallAuth } from "@axis-suite/heimdall-client/server";

const auth = heimdallAuth(); // reads HEIMDALL_INTERNAL_URL and HEIMDALL_PUBLIC_URL
const app = express();
app.use(express.json());
app.use("/api", auth.sameOriginWrites, auth.requireUser);
app.get("/api/me", auth.me);
app.get("/api/things", (req, res) => res.json(listThings(auth.user(req).username)));
```

| Export             | What it does                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requireUser`      | Asks Heimdall's `/whoami` about the request's cookie. Answers `401 { error, loginUrl }` if nobody is signed in, `503` if Heimdall can't be reached.   |
| `user(req)`        | The signed-in `{ username, name }`, in any handler after `requireUser`. Store `username`; `name` can change.                                          |
| `sameOriginWrites` | Refuses writes from another origin (`403`) and write bodies that aren't JSON (`415`). The cookie reaches every subdomain, so every module needs this. |
| `me`               | Handler for `GET /api/me`: `{ username, name, accountUrl }`.                                                                                          |

The middleware takes Node's own request and response, so it works with Express, Connect or plain `node:http`.

## Browser: `@axis-suite/heimdall-client/browser`

| Export                         | What it does                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiFetch(path, init)`         | `fetch` for the module's JSON API. Throws `SignedOutError` on `401`.                                                                        |
| `fetchMe()`                    | `GET /api/me`.                                                                                                                              |
| `goToSignIn(error)`            | Leaves the page for Heimdall's sign-in page, which sends the user back here afterwards.                                                     |
| `signInUrl(loginUrl)`          | That page's URL, for a link (e.g. "Sign in again", opened in a new tab so a draft is kept).                                                 |
| `watchForSignIn(user, onBack)` | After the session ended: when the user returns to the tab, calls `onBack` if they signed in again, or reloads the page if someone else did. |

A typical page start:

```ts
fetchMe()
  .then(showApp)
  .catch((e) => (e instanceof SignedOutError ? goToSignIn(e) : showError(e)));
```

## Development

The package's `exports` point to `src/*.ts` under the `development` condition (Vite's dev server, and `node --conditions=development` in each module's `dev` script), and to the compiled `dist/` otherwise. `pnpm build` at the suite's root compiles it before the modules that use it.
