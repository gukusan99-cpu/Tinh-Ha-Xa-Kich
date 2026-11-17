import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_BYTES, parseClientMessage } from "../src/protocol.js";

const err = (code: string) => ({ ok: false, code });

describe("parseClientMessage", () => {
  it("chấp nhận hello hợp lệ", () => {
    const r = parseClientMessage(JSON.stringify({ v: 1, type: "hello", clientVersion: "0.1.0" }));
    expect(r).toEqual({ ok: true, message: { v: 1, type: "hello", clientVersion: "0.1.0" } });
  });

  it("chấp nhận ping hợp lệ, kể cả seq = 0 và Buffer", () => {
    const r = parseClientMessage(Buffer.from(JSON.stringify({ v: 1, type: "ping", seq: 0 })));
    expect(r).toEqual({ ok: true, message: { v: 1, type: "ping", seq: 0 } });
  });

  it("JSON hỏng -> bad_json", () => {
    expect(parseClientMessage("{not json")).toEqual(err("bad_json"));
    expect(parseClientMessage("")).toEqual(err("bad_json"));
  });

  it("JSON không phải object -> bad_message", () => {
    for (const raw of ["[]", "null", "42", '"hi"', "true"]) {
      expect(parseClientMessage(raw)).toEqual(err("bad_message"));
    }
  });

  it("v sai hoặc thiếu -> bad_version", () => {
    expect(parseClientMessage('{"v":2,"type":"ping","seq":1}')).toEqual(err("bad_version"));
    expect(parseClientMessage('{"v":"1","type":"ping","seq":1}')).toEqual(err("bad_version"));
    expect(parseClientMessage('{"type":"ping","seq":1}')).toEqual(err("bad_version"));
  });

  it("thiếu hoặc sai kiểu type -> bad_message", () => {
    expect(parseClientMessage('{"v":1}')).toEqual(err("bad_message"));
    expect(parseClientMessage('{"v":1,"type":5}')).toEqual(err("bad_message"));
  });

  it("type lạ (kể cả type chiều S->C) -> unknown_type", () => {
    expect(parseClientMessage('{"v":1,"type":"dance"}')).toEqual(err("unknown_type"));
    expect(parseClientMessage('{"v":1,"type":"welcome"}')).toEqual(err("unknown_type"));
    expect(parseClientMessage('{"v":1,"type":"__proto__"}')).toEqual(err("unknown_type"));
  });

  it("hello sai trường -> bad_message", () => {
    const bad = [
      { v: 1, type: "hello" },
      { v: 1, type: "hello", clientVersion: 1 },
      { v: 1, type: "hello", clientVersion: "" },
      { v: 1, type: "hello", clientVersion: "x".repeat(33) },
    ];
    for (const m of bad) expect(parseClientMessage(JSON.stringify(m))).toEqual(err("bad_message"));
    expect(
      parseClientMessage(JSON.stringify({ v: 1, type: "hello", clientVersion: "x".repeat(32) })).ok,
    ).toBe(true);
  });

  it("ping sai seq -> bad_message", () => {
    const bad = ['"1"', "-1", "1.5", "null", "1e400", "9007199254740992"];
    for (const s of bad) {
      expect(parseClientMessage(`{"v":1,"type":"ping","seq":${s}}`)).toEqual(err("bad_message"));
    }
    expect(parseClientMessage('{"v":1,"type":"ping"}')).toEqual(err("bad_message"));
  });

  it("thông điệp quá 4 KB -> too_large", () => {
    const raw = JSON.stringify({ v: 1, type: "hello", clientVersion: "a", pad: "x".repeat(MAX_MESSAGE_BYTES) });
    expect(parseClientMessage(raw)).toEqual(err("too_large"));
  });
});
