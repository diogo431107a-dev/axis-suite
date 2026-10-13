// A bullet's text without its markup, for breadcrumbs, the page title and the sidebar.

export function plainText(source: string): string {
  return source
    .replace(/!\[([^\]]*)\]\(\/api\/files\/[^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)(.+?)\1/g, "$2")
    .replace(/!\((\d{4}-\d{2}-\d{2})(?: \d{2}:\d{2})?\)/g, "$1")
    .trim();
}
