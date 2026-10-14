// Words for numbers on the page.

/** "1 card", "3 cards". */
export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
