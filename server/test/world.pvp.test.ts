import { describe, expect, it } from "vitest";
import { World } from "../src/world.js";
import { testData } from "./util.js";

describe("World: dấu hiệu cung và cấp của người chơi", () => {
  it("entities() của người chơi mang sign và level khi đã đặt hồ sơ", () => {
    const world = new World({ data: testData(), events: { onTransfer: () => {}, onContact: () => {} } });
    const a = world.addPlayer("a", "An", "thanh");
    const b = world.addPlayer("b", "Bình", "thanh");
    world.setProfile(a.id, "xu_nu", 3);
    const list = world.entities("thanh");
    expect(list.find((e) => e.id === a.id)).toMatchObject({ kind: "player", name: "An", sign: "xu_nu", level: 3 });
    const eb = list.find((e) => e.id === b.id)!;
    expect(eb.sign).toBeUndefined(); // chưa đặt hồ sơ thì không có trường
    expect(eb.level).toBeUndefined();
  });
});
