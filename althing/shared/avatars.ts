// The profile pictures people choose from, in althing/public/avatars/. A new profile gets one at
// random. Taking a file out of this list is safe: whoever had it gets another at the next start.
export const AVATARS = [
  "hamster-pilot.webp",
  "goose.webp",
  "pearl-plush.webp",
  "professor.webp",
  "macaque.webp",
  "lazy-frog.webp",
  "smirk.webp",
  "doodle.webp",
  "roof.webp",
  "dreamy-blob.svg",
  "grumpy-fish.svg",
  "waving-lizard.svg",
] as const;

export function isAvatar(name: string): boolean {
  return (AVATARS as readonly string[]).includes(name);
}

export function randomAvatar(random = Math.random): string {
  return AVATARS[Math.floor(random() * AVATARS.length)]!;
}
