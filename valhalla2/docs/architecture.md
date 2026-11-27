# How it is built

One module holding both halves, like the rest of the suite. This page is for working on the code:
where each part lives, where data is kept, and how features and tests are laid out.

## Where everything lives

|                        |                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/protocol.ts`   | the wire format, the limits, the models and their prices; one file per area in `shared/protocol/` (`limits.ts`, `models.ts`, `companions.ts`, `chat.ts`, `memory.ts`, `pictures.ts`, `api.ts`), all re-exported here                                                                                                              |
| `shared/prompts.ts`    | Valhalla 2's own words and their defaults, and the fixed lines about a chat's mode                                                                                                                                                                                                                                                |
| `shared/sse.ts`        | how a reply travels while it is being written, and how it is read                                                                                                                                                                                                                                                                 |
| `server/index.ts`      | the database, the services, the routers and sign-in, put together                                                                                                                                                                                                                                                                 |
| `server/services.ts`   | everything the routes use, made once; `startup.ts` is the one-off work at boot                                                                                                                                                                                                                                                    |
| `server/routes/`       | the API, one router per area: `meta.ts`, `companions.ts`, `chats.ts`, `messages.ts`, `memory.ts`, `pictures.ts`, `speech.ts`                                                                                                                                                                                                      |
| `server/http/`         | a reply as it streams (`stream.ts`), a kept file sent to its owner (`sendStored.ts`), errors as JSON (`errors.ts`)                                                                                                                                                                                                                |
| `server/db.ts`         | the database, its migrations, transactions, removed users                                                                                                                                                                                                                                                                         |
| `server/companions.ts` | companions                                                                                                                                                                                                                                                                                                                        |
| `server/chat/`         | chats and their modes (`chats.ts`), the message tree (`tree.ts`), asking for replies (`turn.ts`), and sending each request to the companion's API, Claude or Grok (`write.ts`)                                                                                                                                                    |
| `server/memory/`       | memory: paths, files and versions (`store.ts`), the memory tool and its one-shot rules (`tool.ts`), what a chat sees (`inject.ts`), the window (`history.ts`), consolidation, tidy-ups and rebuilds (`consolidate.ts`, `cleanup.ts`, `rebuild.ts`, `run.ts`), one writer at a time (`lock.ts`) and when they run (`scheduler.ts`) |
| `server/prompt.ts`     | the system prompt and the messages. Deterministic, or the cache never hits                                                                                                                                                                                                                                                        |
| `server/pins.ts`       | pinned moments: kept word for word, sent after memory, and the chats that must look again                                                                                                                                                                                                                                         |
| `server/quiet.ts`      | topics to leave alone: sent after memory and pins, shown to the memory model, and every chat looks again                                                                                                                                                                                                                          |
| `server/likes.ts`      | liked replies: the words as they were liked, and the praise memory hasn't heard of yet, or must take back                                                                                                                                                                                                                         |
| `server/backup.ts`     | the daily backups                                                                                                                                                                                                                                                                                                                 |
| `server/grok/`         | the only folder that talks to the xAI API: the client and its errors (`client.ts`), its key (`key.ts`), chat replies (`reply.ts`), picture prompts (`pictures.ts`), context windows (`tokens.ts`)                                                                                                                                 |
| `server/key.ts`        | where the API key comes from: the systemd credential, or the env                                                                                                                                                                                                                                                                  |
| `server/files.ts`      | the folders of kept files, pictures and audio, written whole and swept of strays                                                                                                                                                                                                                                                  |
| `server/scene/`        | a moment worked out: what Claude reads of it (`context.ts`), a reply cut into lines (`lines.ts`), and the kept readings (`sheet.ts`)                                                                                                                                                                                              |
| `server/speech/`       | reading aloud: started in `feature.ts`, the only file that talks to Azure (`azure.ts`), what is read (`text.ts`), each line said its way (`direct.ts`), its key (`key.ts`), and the kept audio (`store.ts`)                                                                                                                       |
| `server/pictures/`     | pictures: started in `feature.ts`, the only file that talks to CivitAI (`civitai.ts`), its key (`key.ts`), what Claude reads to picture a scene (`scene.ts`), the rows (`store.ts`), and making them in the background (`painter.ts`)                                                                                             |
| `server/claude/`       | the only folder that talks to the Claude API: the client and its errors (`client.ts`), chat replies (`reply.ts`), memory runs (`memory.ts`), scenes (`scene.ts`), picture prompts (`pictures.ts`), counting (`tokens.ts`)                                                                                                         |
| `server/busy.ts`       | one reply at a time per chat                                                                                                                                                                                                                                                                                                      |
| `web/`                 | React, Vite and Tailwind; `useState` and one context, no router. The chat page is `views/chat/` (its state in `useChat.ts`), the memory page `views/memory/`; pieces any page uses are in `ui/`                                                                                                                                   |
| `deploy/`              | the systemd unit (sandboxed, with the key) and the Caddy site                                                                                                                                                                                                                                                                     |
| `docs/`                | these pages                                                                                                                                                                                                                                                                                                                       |

**Adding a feature** touches one file or folder per layer: its types in `shared/protocol/`, its code
in its own folder under `server/` (with a `feature.ts` if it is optional and needs a key, returning
null without one), its router in `server/routes/` with one line in `services.ts` and `index.ts`, and
its page or pieces under `web/`.

## Where data is kept

One SQLite file, `valhalla2.db`, in `/var/lib/valhalla2` on a server (`data/` in development). Every
companion belongs to a Heimdall username, and a chat and its messages belong to a companion. When
someone is removed from Heimdall, everything of theirs is deleted the next time Valhalla 2 starts.

A message is stored exactly as the API returned it, thinking blocks included. A delete only marks it
deleted, and an edit keeps the earlier words beside the new ones. A companion's memory files, every
version of them, every run of the memory model and every command it made are in the same file, and
go with the companion when it is deleted. The tables memory uses:

| Table             | What it holds                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `memory_files`    | the files, one row each, keyed by space (a companion's id, or a run's scratch copy) and path                         |
| `memory_versions` | every change to every file, with the file as it was afterwards and where the change came from                        |
| `memory_runs`     | every run of the memory model: kind, model, outcome, summary, and every request it made (for its cost)               |
| `memory_ops`      | every command a run made, done or refused                                                                            |
| `chats`           | among the rest: `mode`, `consolidated_mode` (the mode memory last filed it under), `memory_snapshot`, `window_start` |
| `messages`        | among the rest: `consolidated_at` (when memory read it) and `needs_correction`                                       |

Pictures are files beside it, in `pictures/` (`/var/lib/private/valhalla2/pictures` on a server), one
per picture; the database says whose each one is and how it was made. Replies read aloud are MP3
files in `speech/` beside them, one per reply. Files nothing refers to any more are deleted when
Valhalla 2 starts.

## Tests

Tests sit beside the code as `<name>.test.ts`, and none of them calls the real API: replies come
from a scripted writer, memory runs from a scripted memory model that issues tool commands, and the
refusal and fallback paths are driven through synthetic replies. `pnpm smoke` is the one thing that
spends money, and you run it by hand (see [Running it](../README.md#running-it)).
