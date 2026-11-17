import { describe, expect, it } from "vitest";
import {
  normalizeCharacterName,
  parseClientMessage,
  validatePassword,
  validateUsername,
} from "../src/protocol.js";

const msg = (o: Record<string, unknown>) => JSON.stringify({ v: 1, ...o });
const bad = (o: Record<string, unknown>) =>
  expect(parseClientMessage(msg(o))).toEqual({ ok: false, code: "bad_message" });

describe("quy tắc username / password / tên", () => {
  it("username 3-16 ký tự [A-Za-z0-9_]", () => {
    expect(validateUsername("abc")).toBe(true);
    expect(validateUsername("A_b_9".repeat(3))).toBe(true);
    expect(validateUsername("ab")).toBe(false);
    expect(validateUsername("a".repeat(17))).toBe(false);
    expect(validateUsername("có dấu")).toBe(false);
    expect(validateUsername("a b c")).toBe(false);
  });
  it("password 6-64 ký tự", () => {
    expect(validatePassword("123456")).toBe(true);
    expect(validatePassword("x".repeat(64))).toBe(true);
    expect(validatePassword("12345")).toBe(false);
    expect(validatePassword("x".repeat(65))).toBe(false);
  });
  it("tên nhân vật: trim, 2-16 ký tự, không ký tự điều khiển", () => {
    expect(normalizeCharacterName("  Sao Băng ")).toBe("Sao Băng");
    expect(normalizeCharacterName("a")).toBeNull();
    expect(normalizeCharacterName("  a  ")).toBeNull();
    expect(normalizeCharacterName("x".repeat(17))).toBeNull();
    expect(normalizeCharacterName("x".repeat(16))).toBe("x".repeat(16));
    expect(normalizeCharacterName("ab\ncd")).toBeNull();
  });
});

describe("parse register / login", () => {
  it("chấp nhận chuỗi, kiểm tra luật ở tầng máy chủ", () => {
    const r = parseClientMessage(msg({ type: "register", username: "ab", password: "x" }));
    expect(r).toEqual({ ok: true, message: { v: 1, type: "register", username: "ab", password: "x" } });
    expect(parseClientMessage(msg({ type: "login", username: "bob", password: "secret1" })).ok).toBe(true);
  });
  it("sai kiểu / thiếu -> bad_message", () => {
    bad({ type: "register", username: 1, password: "x" });
    bad({ type: "register", username: "abc" });
    bad({ type: "login", password: "abcdef" });
    bad({ type: "login", username: "abc", password: null });
    bad({ type: "login", username: "a".repeat(300), password: "abcdef" });
  });
});

describe("parse create_character", () => {
  it("trim tên, giữ sign", () => {
    const r = parseClientMessage(msg({ type: "create_character", name: "  Ngân  ", sign: "xu_nu" }));
    expect(r).toEqual({ ok: true, message: { v: 1, type: "create_character", name: "Ngân", sign: "xu_nu" } });
  });
  it("tên hoặc sign sai -> bad_message", () => {
    bad({ type: "create_character", name: "a", sign: "xu_nu" });
    bad({ type: "create_character", name: "x".repeat(17), sign: "xu_nu" });
    bad({ type: "create_character", name: "Ngân" });
    bad({ type: "create_character", name: "Ngân", sign: 5 });
    bad({ type: "create_character", name: 5, sign: "xu_nu" });
  });
});

describe("parse enter_world / move_to", () => {
  it("enter_world không trường", () => {
    expect(parseClientMessage(msg({ type: "enter_world" }))).toEqual({
      ok: true,
      message: { v: 1, type: "enter_world" },
    });
  });
  it("move_to cần x,y hữu hạn", () => {
    expect(parseClientMessage(msg({ type: "move_to", x: 3.5, y: -2 }))).toEqual({
      ok: true,
      message: { v: 1, type: "move_to", x: 3.5, y: -2 },
    });
    bad({ type: "move_to", x: "3", y: 2 });
    bad({ type: "move_to", x: 3 });
    expect(parseClientMessage('{"v":1,"type":"move_to","x":1e400,"y":2}')).toEqual({
      ok: false,
      code: "bad_message",
    });
    bad({ type: "move_to", x: null, y: 2 });
  });
});

describe("parse battle_move / battle_shot", () => {
  it("battle_move: col nguyên", () => {
    expect(parseClientMessage(msg({ type: "battle_move", col: 7 })).ok).toBe(true);
    expect(parseClientMessage(msg({ type: "battle_move", col: -1 })).ok).toBe(true);
    bad({ type: "battle_move", col: 1.5 });
    bad({ type: "battle_move", col: "7" });
    bad({ type: "battle_move" });
    expect(parseClientMessage('{"v":1,"type":"battle_move","col":1e400}').ok).toBe(false);
  });
  it("battle_shot: angle hữu hạn, power 0..100, facing ±1, gunId chuỗi", () => {
    const g = "thuoc_no_nho";
    const ok = parseClientMessage(msg({ type: "battle_shot", angle: 45.5, power: 100, facing: -1, gunId: g }));
    expect(ok).toEqual({ ok: true, message: { v: 1, type: "battle_shot", gunId: g, angle: 45.5, power: 100, facing: -1 } });
    expect(parseClientMessage(msg({ type: "battle_shot", angle: -30, power: 0, facing: 1, gunId: g })).ok).toBe(true);
    bad({ type: "battle_shot", angle: 45, power: 101, facing: 1, gunId: g });
    bad({ type: "battle_shot", angle: 45, power: -1, facing: 1, gunId: g });
    bad({ type: "battle_shot", angle: 45, power: 50, facing: 0, gunId: g });
    bad({ type: "battle_shot", angle: 45, power: 50, facing: 2, gunId: g });
    bad({ type: "battle_shot", angle: "45", power: 50, facing: 1, gunId: g });
    bad({ type: "battle_shot", power: 50, facing: 1, gunId: g });
    expect(parseClientMessage(`{"v":1,"type":"battle_shot","angle":1e400,"power":5,"facing":1,"gunId":"${g}"}`).ok).toBe(false);
  });
  it("battle_shot thiếu hoặc sai gunId -> bad_message", () => {
    bad({ type: "battle_shot", angle: 45, power: 50, facing: 1 });
    bad({ type: "battle_shot", angle: 45, power: 50, facing: 1, gunId: "" });
    bad({ type: "battle_shot", angle: 45, power: 50, facing: 1, gunId: 7 });
    bad({ type: "battle_shot", angle: 45, power: 50, facing: 1, gunId: "x".repeat(65) });
  });
  it("aim_preview: cùng luật trường với battle_shot", () => {
    const ok = parseClientMessage(msg({ type: "aim_preview", gunId: "sung_bang", angle: 30, power: 60, facing: 1 }));
    expect(ok).toEqual({ ok: true, message: { v: 1, type: "aim_preview", gunId: "sung_bang", angle: 30, power: 60, facing: 1 } });
    bad({ type: "aim_preview", angle: 30, power: 60, facing: 1 });
    bad({ type: "aim_preview", gunId: "g", angle: 30, power: 160, facing: 1 });
    bad({ type: "aim_preview", gunId: "g", angle: 30, power: 60, facing: 3 });
  });
  it("angle ngoài khoảng cực đoan bị từ chối; khoảng hợp lý để máy chủ kẹp", () => {
    expect(parseClientMessage(msg({ type: "battle_shot", angle: 170, power: 5, facing: 1, gunId: "g" })).ok).toBe(true);
    bad({ type: "battle_shot", angle: 100000, power: 5, facing: 1, gunId: "g" });
  });
});
