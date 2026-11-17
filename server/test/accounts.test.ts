import { describe, expect, it } from "vitest";
import {
  AccountService,
  MemoryAccountStore,
  applyExp,
  hashPassword,
  verifyPassword,
} from "../src/accounts.js";

const rules = { signs: ["bach_duong", "kim_nguu", "xu_nu", "bao_binh"], startingGunId: "g",
  expPerLevel: 100,
  startingOwnedGunIds: ["thuoc_no_nho"],
  defaultLoadout: ["thuoc_no_nho"],
  extraGunSlots: 2,
  loadoutGunIds: ["thuoc_no_nho", "ba_tia", "lien_thanh", "laser"],
};
const mk = () => new AccountService(new MemoryAccountStore(), rules);

describe("băm mật khẩu", () => {
  it("scrypt, salt ngẫu nhiên, xác minh đúng/sai", async () => {
    const a = await hashPassword("matkhau1");
    const b = await hashPassword("matkhau1");
    expect(a).not.toBe(b);
    expect(a).not.toContain("matkhau1");
    expect(await verifyPassword("matkhau1", a)).toBe(true);
    expect(await verifyPassword("matkhau2", a)).toBe(false);
    expect(await verifyPassword("x", "rac")).toBe(false);
  });
});

describe("AccountService", () => {
  it("đăng ký hợp lệ rồi trùng tên (không phân biệt hoa thường) -> taken", async () => {
    const s = mk();
    const r = await s.register("Alice_1", "secret1");
    expect(r).toMatchObject({ ok: true, account: { username: "Alice_1", character: null } });
    expect(await s.register("alice_1", "secret2")).toEqual({ ok: false, code: "taken" });
  });

  it("đăng ký sai luật -> invalid", async () => {
    const s = mk();
    expect(await s.register("ab", "secret1")).toEqual({ ok: false, code: "invalid" });
    expect(await s.register("abc", "12345")).toEqual({ ok: false, code: "invalid" });
    expect(await s.register("a b c", "secret1")).toEqual({ ok: false, code: "invalid" });
  });

  it("đăng nhập đúng, sai mật khẩu, tài khoản lạ", async () => {
    const s = mk();
    await s.register("bob", "secret1");
    expect(await s.login("BOB", "secret1")).toMatchObject({ ok: true, account: { username: "bob" } });
    expect(await s.login("bob", "wrong!!")).toEqual({ ok: false, code: "bad_credentials" });
    expect(await s.login("nobody", "secret1")).toEqual({ ok: false, code: "bad_credentials" });
    expect(await s.login("", "")).toEqual({ ok: false, code: "bad_credentials" });
  });

  it("tạo nhân vật: một lần, khóa vĩnh viễn", async () => {
    const s = mk();
    await s.register("bob", "secret1");
    const c = await s.createCharacter("bob", "Sao Băng", "kim_nguu");
    expect(c).toEqual({
      ok: true,
      character: { name: "Sao Băng", sign: "kim_nguu", level: 1, exp: 0, gunId: "g", ownedGunIds: ["thuoc_no_nho"], loadout: ["thuoc_no_nho"], pvp: { wins: 0, losses: 0, draws: 0 } },
    });
    expect(await s.createCharacter("bob", "Khác", "xu_nu")).toEqual({ ok: false, code: "exists" });
    const again = await s.login("bob", "secret1");
    expect(again.ok && again.account.character?.sign).toBe("kim_nguu");
  });

  it("tạo nhân vật sai sign hoặc tên -> invalid", async () => {
    const s = mk();
    await s.register("bob", "secret1");
    expect(await s.createCharacter("bob", "Ok", "ma_ket")).toEqual({ ok: false, code: "invalid" });
    expect(await s.createCharacter("bob", "x", "xu_nu")).toEqual({ ok: false, code: "invalid" });
  });

  it("cộng exp và lên cấp", async () => {
    const s = mk();
    await s.register("bob", "secret1");
    await s.createCharacter("bob", "Bob", "xu_nu");
    expect((await s.awardExp("bob", 40))?.exp).toBe(40);
    const c = await s.awardExp("bob", 60);
    expect(c).toMatchObject({ level: 2, exp: 0 });
    expect(await s.awardExp("nobody", 5)).toBeNull();
  });
});

describe("recordPvp", () => {
  it("cộng thắng/thua/hòa, không đổi exp, null nếu không có nhân vật", async () => {
    const s = mk();
    await s.register("bob", "secret1");
    await s.createCharacter("bob", "Bob", "xu_nu");
    expect((await s.recordPvp("bob", "win"))?.pvp).toEqual({ wins: 1, losses: 0, draws: 0 });
    await s.recordPvp("bob", "lose");
    await s.recordPvp("bob", "lose");
    const c = await s.recordPvp("bob", "draw");
    expect(c).toMatchObject({ exp: 0, level: 1, pvp: { wins: 1, losses: 2, draws: 1 } });
    const again = await s.login("bob", "secret1");
    expect(again.ok && again.account.character?.pvp).toEqual({ wins: 1, losses: 2, draws: 1 });
    expect(await s.recordPvp("nobody", "win")).toBeNull();
  });
});

describe("applyExp", () => {
  const base = { name: "n", sign: "xu_nu", level: 1, exp: 0, gunId: "g", ownedGunIds: ["thuoc_no_nho"], loadout: ["thuoc_no_nho"], pvp: { wins: 0, losses: 0, draws: 0 } };
  it("lên cấp khi exp ≥ expPerLevel × level, phần dư giữ lại", () => {
    expect(applyExp(base, 99, 100)).toMatchObject({ level: 1, exp: 99 });
    expect(applyExp(base, 100, 100)).toMatchObject({ level: 2, exp: 0 });
    expect(applyExp(base, 130, 100)).toMatchObject({ level: 2, exp: 30 });
  });
  it("lên nhiều cấp một lúc: cấp 2 cần 200, cấp 3 cần 300", () => {
    expect(applyExp(base, 100 + 200 + 5, 100)).toMatchObject({ level: 3, exp: 5 });
  });
  it("không sửa đầu vào, exp 0 không đổi", () => {
    const c = Object.freeze({ ...base });
    expect(applyExp(c, 0, 100)).toEqual(base);
  });
});
