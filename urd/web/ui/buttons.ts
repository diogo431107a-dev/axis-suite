// The page's button styles, as Tailwind class lists.

export const primaryButton =
  "inline-flex items-center justify-center gap-2 bg-sky-700 text-white text-sm font-medium px-4 py-2 rounded-lg " +
  "hover:bg-sky-800 active:bg-sky-900 transition-colors disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-500 " +
  "disabled:cursor-not-allowed";

export const secondaryButton =
  "inline-flex items-center justify-center gap-2 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 text-sm px-3 py-2 " +
  "rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/60 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors disabled:text-zinc-300 dark:disabled:text-zinc-600 disabled:cursor-not-allowed";

export const dangerButton =
  "inline-flex items-center justify-center gap-2 border border-red-200 dark:border-red-900 bg-white dark:bg-zinc-900 text-red-700 dark:text-red-400 text-sm px-3 py-2 " +
  "rounded-lg hover:bg-red-50 dark:hover:bg-red-950 hover:border-red-300 dark:hover:border-red-800 transition-colors disabled:text-red-200 dark:disabled:text-red-900 disabled:cursor-not-allowed";

/** A small square button holding only an icon (give it an aria-label). */
export const iconButton =
  "inline-flex items-center justify-center p-1.5 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 " +
  "transition-colors disabled:text-zinc-200 dark:disabled:text-zinc-700 disabled:hover:bg-transparent";

export const textInput =
  "w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent";

export const label = "block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1";
