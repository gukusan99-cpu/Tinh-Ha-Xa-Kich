import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../src/protocol.js";

const parse = (o: Record<string, unknown>) => parseClientMessage(JSON.stringify({ v: 1, ...o }));

describe("parse: thách đấu", () => {
  it("challenge cần targetEntityId nguyên", () => {
    expect(parse({ type: "challenge", targetEntityId: 7 })).toEqual({
      ok: true,
      message: { v: 1, type: "challenge", targetEntityId: 7 },
    });
    for (const bad of [1.5, "7", null, undefined, -1, Number.NaN]) {
      expect(parse({ type: "challenge", targetEntityId: bad })).toEqual({ ok: false, code: "bad_message" });
    }
  });

  it("challenge_reply cần challengeId chuỗi và accept boolean", () => {
    expect(parse({ type: "challenge_reply", challengeId: "abc", accept: true })).toEqual({
      ok: true,
      message: { v: 1, type: "challenge_reply", challengeId: "abc", accept: true },
    });
    expect(parse({ type: "challenge_reply", challengeId: "abc", accept: "yes" })).toEqual({ ok: false, code: "bad_message" });
    expect(parse({ type: "challenge_reply", challengeId: "", accept: false })).toEqual({ ok: false, code: "bad_message" });
    expect(parse({ type: "challenge_reply", accept: false })).toEqual({ ok: false, code: "bad_message" });
  });

  it("challenge_cancel cần challengeId", () => {
    expect(parse({ type: "challenge_cancel", challengeId: "abc" })).toEqual({
      ok: true,
      message: { v: 1, type: "challenge_cancel", challengeId: "abc" },
    });
    expect(parse({ type: "challenge_cancel", challengeId: 5 })).toEqual({ ok: false, code: "bad_message" });
    expect(parse({ type: "challenge_cancel", challengeId: "x".repeat(100) })).toEqual({ ok: false, code: "bad_message" });
  });
});
