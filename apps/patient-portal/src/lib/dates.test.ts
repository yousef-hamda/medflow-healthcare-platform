import { describe, expect, it } from "vitest";
import { dateBucketKey, groupByDate, formatDate } from "./dates";

interface Item {
  id: string;
  when?: string;
}

describe("dateBucketKey", () => {
  it("buckets a datetime to its YYYY-MM-DD", () => {
    expect(dateBucketKey("2026-03-04T09:30:00Z")).toBe("2026-03-04");
  });
  it("returns 'unknown' for missing/invalid input", () => {
    expect(dateBucketKey(undefined)).toBe("unknown");
    expect(dateBucketKey("not-a-date")).toBe("unknown");
  });
});

describe("groupByDate", () => {
  const items: Item[] = [
    { id: "a", when: "2026-03-04T09:00:00Z" },
    { id: "b", when: "2026-03-04T18:00:00Z" },
    { id: "c", when: "2026-03-01T08:00:00Z" },
    { id: "d", when: undefined },
  ];

  it("buckets items by calendar day", () => {
    const groups = groupByDate(items, (i) => i.when);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.items.map((i) => i.id)]));
    expect(byKey["2026-03-04"]).toEqual(["a", "b"]);
    expect(byKey["2026-03-01"]).toEqual(["c"]);
    expect(byKey["unknown"]).toEqual(["d"]);
  });

  it("orders buckets newest-first with unknown last", () => {
    const groups = groupByDate(items, (i) => i.when);
    expect(groups.map((g) => g.key)).toEqual(["2026-03-04", "2026-03-01", "unknown"]);
  });

  it("handles an empty list", () => {
    expect(groupByDate([], (i: Item) => i.when)).toEqual([]);
  });
});

describe("formatDate", () => {
  it("returns a dash for empty input", () => {
    expect(formatDate(undefined)).toBe("—");
  });
  it("formats a valid date", () => {
    expect(formatDate("2026-03-04", "en")).toMatch(/2026/);
  });
});
