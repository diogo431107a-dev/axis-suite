// Prints a password hash to paste into src/users.ts.
// Usage: npm run hash-password   (prompts twice, input hidden)
import { hashPassword } from "./password.js";

function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  stdout.write(question);

  // Piped input (e.g. `echo secret | npm run hash-password`): read one line.
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      let data = "";
      stdin.setEncoding("utf8");
      const onData = (chunk: string) => {
        data += chunk;
        const newline = data.indexOf("\n");
        if (newline !== -1) {
          stdin.off("data", onData);
          stdin.pause();
          stdout.write("\n");
          resolve(data.slice(0, newline).replace(/\r$/, ""));
        }
      };
      stdin.on("data", onData);
      stdin.once("end", () => resolve(data.replace(/\r?\n$/, "")));
    });
  }

  return new Promise((resolve) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdout.write("\n");
          process.exit(130);
        }
        value = ch === "\u007f" || ch === "\b" ? value.slice(0, -1) : value + ch;
      }
    };
    stdin.on("data", onData);
  });
}

const password = await promptHidden("Password: ");
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}
if (process.stdin.isTTY && (await promptHidden("Confirm:  ")) !== password) {
  console.error("Passwords do not match.");
  process.exit(1);
}
console.log(await hashPassword(password));
