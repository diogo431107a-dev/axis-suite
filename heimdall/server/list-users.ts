// Prints every username in users.ts, one per line. deploy/install.sh hands the list to the other
// modules (AXIS_USERS in suite.env), which delete the data of anyone not on it.
// Usage: node dist/server/list-users.js
import { USERS } from "./users.ts";

for (const { username } of USERS) console.log(username);
