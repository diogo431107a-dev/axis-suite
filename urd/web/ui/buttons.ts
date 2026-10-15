// The page's button styles, as Tailwind class lists.

export const primaryButton =
  "inline-flex items-center justify-center gap-2 bg-sky-700 text-white text-sm font-medium px-4 py-2 rounded-lg " +
  "hover:bg-sky-800 active:bg-sky-900 transition-colors disabled:bg-zinc-200 disabled:text-zinc-400 " +
  "disabled:cursor-not-allowed";

export const secondaryButton =
  "inline-flex items-center justify-center gap-2 border border-zinc-200 bg-white text-zinc-700 text-sm px-3 py-2 " +
  "rounded-lg hover:bg-zinc-50 hover:border-zinc-300 transition-colors disabled:text-zinc-300 disabled:cursor-not-allowed";

export const dangerButton =
  "inline-flex items-center justify-center gap-2 border border-red-200 bg-white text-red-700 text-sm px-3 py-2 " +
  "rounded-lg hover:bg-red-50 hover:border-red-300 transition-colors disabled:text-red-200 disabled:cursor-not-allowed";

/** A small square button holding only an icon (give it an aria-label). */
export const iconButton =
  "inline-flex items-center justify-center p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 " +
  "transition-colors disabled:text-zinc-200 disabled:hover:bg-transparent";

export const textInput =
  "w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg bg-white text-zinc-800 placeholder-zinc-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent";

export const label = "block text-xs font-medium text-zinc-500 mb-1";
