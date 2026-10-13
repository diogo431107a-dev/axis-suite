import { expect, it } from "vitest";
import { nearestBox, slotAt } from "./dnd.ts";

it("finds the slot among midpoints", () => {
  expect(slotAt([10, 30, 50], 5)).toBe(0);
  expect(slotAt([10, 30, 50], 31)).toBe(2);
  expect(slotAt([10, 30, 50], 99)).toBe(3);
  expect(slotAt([], 99)).toBe(0);
});

it("finds the nearest column", () => {
  const boxes = [
    { left: 0, right: 100 },
    { left: 110, right: 210 },
  ];
  expect(nearestBox(boxes, 50)).toBe(0);
  expect(nearestBox(boxes, 106)).toBe(1);
  expect(nearestBox(boxes, 500)).toBe(1);
  expect(nearestBox([], 5)).toBe(-1);
});
