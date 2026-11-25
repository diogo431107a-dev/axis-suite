// Valhalla 2's server: the database, what the routes use (services.ts), the routes (routes/), and
// sign-in through Heimdall.
import express from "express";
import { keySource } from "./claude/client.ts";
import { DB_FILE, openDatabase } from "./db.ts";
import { apiNotFound, onError } from "./http/errors.ts";
import { chatRoutes } from "./routes/chats.ts";
import { companionRoutes } from "./routes/companions.ts";
import { memoryRoutes } from "./routes/memory.ts";
import { messageRoutes } from "./routes/messages.ts";
import { metaRoutes } from "./routes/meta.ts";
import { pictureRoutes } from "./routes/pictures.ts";
import { sceneRoutes } from "./routes/scene.ts";
import { speechRoutes } from "./routes/speech.ts";
import { createServices } from "./services.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3016);

const db = openDatabase(DB_FILE);
console.log(`Everyone's companions, chats and memory: ${DB_FILE}`);
console.log(`Claude API key: ${keySource()}`);

const services = createServices(db);

const app = express();
app.disable("x-powered-by");

// Liveness check, for whatever starts this.
app.get("/healthz", (_req, res) => {
  res.type("text/plain").set("Cache-Control", "no-store").send("ok");
});

// Every API call is someone signed in to Heimdall, writing from Valhalla 2's own page.
app.use("/api", services.auth.sameOriginWrites, services.auth.requireUser, (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
// A profile can be long: 60,000 characters plus settings and prompt texts.
app.use("/api", express.json({ limit: "1mb" }));

for (const routes of [
  metaRoutes,
  companionRoutes,
  chatRoutes,
  messageRoutes,
  memoryRoutes,
  sceneRoutes,
  pictureRoutes,
  speechRoutes,
]) {
  app.use("/api", routes(services));
}

app.use("/api", apiNotFound);
app.use(onError);

const server = app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error(`Could not listen on ${HOST}:${PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`Listening on http://${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    services.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
