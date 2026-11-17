import { describe, expect, it } from "vitest";
import { ChallengeBook, type Challenge } from "../src/challenges.js";
import { ManualClock } from "./util.js";

function setup() {
  const clock = new ManualClock();
  const expired: Challenge[] = [];
  let n = 0;
  const book = new ChallengeBook(clock, 20_000, 15_000, (c) => expired.push(c), () => `c${++n}`);
  return { clock, book, expired };
}

describe("ChallengeBook", () => {
  it("mở lời mời với hạn chót theo giờ máy chủ", () => {
    const { clock, book } = setup();
    const c = book.open("a", "b")!;
    expect(c).toMatchObject({ id: "c1", fromKey: "a", toKey: "b", expiresAt: clock.now() + 20_000 });
    expect(book.get("c1")).toBe(c);
    expect(book.ofPlayer("a")).toBe(c);
    expect(book.ofPlayer("b")).toBe(c);
  });

  it("mỗi người một lời mời đang chờ (gửi hoặc nhận)", () => {
    const { book } = setup();
    book.open("a", "b");
    expect(book.open("a", "c")).toBeNull(); // a đã gửi
    expect(book.open("c", "a")).toBeNull(); // a đang có lời mời
    expect(book.open("c", "b")).toBeNull(); // b đã nhận
    expect(book.open("b", "c")).toBeNull(); // b đang có lời mời
    expect(book.open("c", "d")).not.toBeNull();
  });

  it("hết hạn sau timeout: gỡ lời mời và gọi onExpire", () => {
    const { clock, book, expired } = setup();
    book.open("a", "b");
    clock.advance(19_999);
    expect(expired).toHaveLength(0);
    clock.advance(1);
    expect(expired.map((c) => c.id)).toEqual(["c1"]);
    expect(book.get("c1")).toBeUndefined();
    expect(book.ofPlayer("a")).toBeUndefined();
    expect(book.open("a", "b")).not.toBeNull(); // hết hạn không chặn mời lại
  });

  it("close dừng timer và trả lời mời; đóng hai lần trả null", () => {
    const { clock, book, expired } = setup();
    book.open("a", "b");
    expect(book.close("c1", "cancelled")?.id).toBe("c1");
    expect(book.close("c1", "cancelled")).toBeNull();
    expect(clock.pending()).toBe(0);
    clock.advance(60_000);
    expect(expired).toHaveLength(0);
  });

  it("bị từ chối: chờ retry mới mời lại đúng người đó, người khác thì được", () => {
    const { clock, book } = setup();
    book.open("a", "b");
    book.close("c1", "declined");
    expect(book.open("a", "b")).toBeNull();
    expect(book.open("a", "c")).not.toBeNull();
    book.close("c2", "cancelled");
    clock.advance(14_999);
    expect(book.open("a", "b")).toBeNull();
    clock.advance(1);
    expect(book.open("a", "b")).not.toBeNull();
  });

  it("chiều ngược lại (b mời a) không bị cooldown", () => {
    const { book } = setup();
    book.open("a", "b");
    book.close("c1", "declined");
    expect(book.open("b", "a")).not.toBeNull();
  });

  it("các lý do đóng khác không đặt cooldown", () => {
    const { book } = setup();
    for (const reason of ["cancelled", "unavailable", "accepted"] as const) {
      const c = book.open("a", "b")!;
      book.close(c.id, reason);
      expect(book.open("a", "b")).not.toBeNull();
      book.close(book.ofPlayer("a")!.id, "cancelled");
    }
  });
});
