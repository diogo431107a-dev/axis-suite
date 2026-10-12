// The page's button styles, as Tailwind class lists.

export const primaryButton =
  "inline-flex items-center justify-center gap-2 bg-amber-800 text-white text-sm font-medium px-4 py-2 rounded-lg " +
  "hover:bg-amber-900 active:bg-amber-950 transition-colors disabled:bg-gray-200 disabled:text-gray-400 " +
  "disabled:cursor-not-allowed";

export const secondaryButton =
  "inline-flex items-center justify-center gap-2 border border-gray-200 bg-white text-gray-700 text-sm px-3 py-2 " +
  "rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors disabled:text-gray-300 disabled:cursor-not-allowed";

export const dangerButton =
  "inline-flex items-center justify-center gap-2 border border-red-200 bg-white text-red-700 text-sm px-3 py-2 " +
  "rounded-lg hover:bg-red-50 hover:border-red-300 transition-colors";

/** A small square button holding only an icon (give it an aria-label). */
export const iconButton =
  "inline-flex items-center justify-center p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 " +
  "transition-colors disabled:text-gray-200 disabled:hover:bg-transparent";

export const textInput =
  "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-800 placeholder-gray-300 " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent";

export const label = "block text-xs font-medium text-gray-500 mb-1";
