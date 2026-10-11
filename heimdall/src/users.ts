import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "./password.js";

export interface User {
  username: string;
  /** Display name shown after login. */
  name: string;
  /** Generate with `npm run hash-password`. Never store plain-text passwords here. */
  passwordHash: string;
}

// Hardcoded accounts. These are DEMO accounts — replace them before deploying.
//   odin  / allfather-demo
//   freya / folkvangr-demo
//   john  / john-demo
export const USERS: readonly User[] = [
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
