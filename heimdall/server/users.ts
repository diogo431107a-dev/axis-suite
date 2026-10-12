import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "./password.ts";

export interface User {
  username: string;
  /** Display name shown after login. */
  name: string;
  /** Generate with `pnpm hash-password`. Never store plain-text passwords here. */
  passwordHash: string;
}

// Hardcoded accounts. These are DEMO accounts — replace them before deploying.
//   odin  / allfather-demo
//   freya / folkvangr-demo
//   john  / john-demo
export const USERS: readonly User[] = [
  {
    username: "diro",
    name: "Diro",
    passwordHash:
      "scrypt$e59cf387f82d791e1a040c71ea4c7be5$562c2fdec57ea561024a67cbe533ab9b6b4ee1fb4e6661673c66a88b569fb5634d4f6f4c3c7135997e0ed6ef41eb66559e38a2f18a25111c29679429def00ecc",
  },
  {
    username: "prefsbs",
    name: "prefsbs",
    passwordHash:
      "scrypt$e5225bea3c4bc30dd5fc675bf9e23479$936134b1c4ba393abfa94afc6d12af90e29bb5f35feef05b1c20788bb73b04ee7f2f67dc777bd279442d19f32b0b6886939d709391e72e7d8bb6c89c7c04162a",
  },
];

// Unknown usernames are checked against this hash so they take as long as known
// ones, which keeps response timing from revealing which usernames exist.
const dummyHash = hashPassword(randomBytes(16).toString("hex"));

export async function authenticate(username: string, password: string): Promise<User | null> {
  const user = USERS.find((u) => u.username === username);
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  return user && ok ? user : null;
}
