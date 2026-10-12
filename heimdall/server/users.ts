import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "./password.ts";

export interface User {
  username: string;
  /** Display name shown after login. */
  name: string;
  /** Generate with `pnpm hash-password`. Never store plain-text passwords here. */
  passwordHash: string;
}

// Hardcoded accounts: the real ones first, then DEMO accounts for testing during development.
// The demo passwords are public (this repository is public), so anyone can sign in with them
// wherever Heimdall runs, the server included. Remove them before anything real is kept there.
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
  {
    username: "odin",
    name: "Odin Allfather",
    passwordHash:
      "scrypt$d9601f8c9c7a7ff172551dcceab54886$be6b67e8cb1bade1798fd3a6d628cd4daea4aab75a2d0c4ce7b518e17c465b7e23916ff6f704c01f960ff305b1e6f7df1202b67849284c8b120ef74eaef17992",
  },
  {
    username: "freya",
    name: "Freya",
    passwordHash:
      "scrypt$2934b1047b2d6a565650c796660ca403$f1acd9ac4e73801a5aeecfaf39343cc268374733882ae10e3c8ba3b2d68a443170ad91196b606f94b8fa446b6dc1b056faaed60654d3d1f64ae01c1cc8363372",
  },
  {
    username: "john",
    name: "John",
    passwordHash:
      "scrypt$5801dd387e67cf4c0ef0495dccaf24b5$3f680e5e955b4d21efc883defc7d71d7a77e136f99e5567cbbf38cba17c9bdeb596eca88e085d39ba00b4221b90b4fe0e4565b5e88de53b99d06acd01f90b059",
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
