/**
 * CLI mô phỏng cân bằng: npx tsx scripts/simulate.ts [--n 1000] [--seed 1] [--sign <id>|all|none] [--sweep] [--override key=value ...]
 * Mặc định (không --sign): bảng theo từng cung. `--sign none` = chỉ súng chung, không nội tại.
 */
import { getData, OVERRIDE_KEYS, POLICIES, runMany, type Overrides, type Summary } from "../src/sim/simulate.js";

const argv = process.argv.slice(2);
let n = 1000;
let seed = 1;
let sweep = false;
let signArg = "all";
const overrides: Overrides = {};

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === "--n") n = Number(argv[++i]);
  else if (a === "--seed") seed = Number(argv[++i]);
  else if (a === "--sweep") sweep = true;
  else if (a === "--sign") signArg = argv[++i] ?? "";
  else if (a === "--override") {
    while (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) {
      const [k, v] = argv[++i]!.split("=");
      if (!OVERRIDE_KEYS.includes(k as keyof Overrides) || v === undefined || !Number.isFinite(Number(v))) {
        throw new Error(`override không hợp lệ "${k}=${v}". Khóa hợp lệ: ${OVERRIDE_KEYS.join(", ")}`);
      }
      (overrides as Record<string, number>)[k!] = Number(v);
    }
  } else throw new Error(`đối số lạ: ${a}`);
}

const pct = (x: number) => (x * 100).toFixed(1).padStart(5) + "%";
const allSigns = getData().character.signs;
if (signArg !== "all" && signArg !== "none" && !allSigns.includes(signArg)) {
  throw new Error(`--sign không hợp lệ "${signArg}". Hợp lệ: all, none, ${allSigns.join(", ")}`);
}

if (!sweep) {
  const signs: (string | undefined)[] = signArg === "all" ? allSigns : signArg === "none" ? [undefined] : [signArg];
  console.log(`n=${n} seed=${seed} overrides=${JSON.stringify(overrides)}`);
  console.log("sign        policy       win     lose    draw    avgTurns  avgHpOnWin");
  const t0 = Date.now();
  const winTable: Record<string, Record<string, Summary>> = {};
  for (const sign of signs) {
    for (const p of POLICIES) {
      const s = runMany(p, n, overrides, seed, sign);
      (winTable[sign ?? "none"] ??= {})[p] = s;
      console.log(
        `${(sign ?? "none").padEnd(11)} ${p.padEnd(12)} ${pct(s.win)} ${pct(s.lose)} ${pct(s.draw)}  ${s.avgTurns.toFixed(2).padStart(7)}  ${s.avgHpOnWin.toFixed(1).padStart(9)}`,
      );
    }
  }
  console.log("\nTóm tắt thắng% (gioi | trung_binh | ngau_nhien), số lượt TB của gioi");
  for (const [sign, t] of Object.entries(winTable)) {
    console.log(
      `${sign.padEnd(11)} ${pct(t["gioi"]!.win)} | ${pct(t["trung_binh"]!.win)} | ${pct(t["ngau_nhien"]!.win)}   turns=${t["gioi"]!.avgTurns.toFixed(2)}`,
    );
  }
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
} else {
  const sign = signArg === "all" || signArg === "none" ? undefined : signArg;
  const sn = argv.includes("--n") ? n : 500;
  const t0 = Date.now();
  const rows: { o: Overrides; g: Summary; t: Summary; r: Summary; len: number; score: number }[] = [];
  const range = (v: number, lo: number, hi: number) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  for (const playerBaseHp of [100, 150, 200])
    for (const monsterHp of [60, 80, 100])
      for (const aiErrorTiles of [4, 6, 8])
        for (const groupSize of [1, 2]) {
          const o: Overrides = { ...overrides, playerBaseHp, monsterHp, aiErrorTiles, groupSize };
          const g = runMany("gioi", sn, o, seed, sign);
          const t = runMany("trung_binh", sn, o, seed, sign);
          const r = runMany("ngau_nhien", sn, o, seed, sign);
          const len = (g.avgTurns + t.avgTurns + r.avgTurns) / 3;
          // điểm lệch khỏi mục tiêu (thấp = tốt); gioi lý tưởng 75-90%
          const score =
            range(g.win, 0.75, 0.9) + range(t.win, 0.45, 0.65) + range(r.win, 0, 0.15) + range(g.avgTurns, 4, 10) / 10;
          rows.push({ o, g, t, r, len, score });
        }
  rows.sort((a, b) => a.score - b.score);
  console.log(`sweep n=${sn}/ô, ${rows.length} tổ hợp, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log("hp  mHp aiErr grp | gioi   tbinh  ngau  | turnsG turnsAll | score");
  for (const x of rows) {
    console.log(
      `${String(x.o.playerBaseHp).padStart(3)} ${String(x.o.monsterHp).padStart(3)} ${String(x.o.aiErrorTiles).padStart(5)} ${String(x.o.groupSize).padStart(3)} | ` +
        `${pct(x.g.win)} ${pct(x.t.win)} ${pct(x.r.win)} | ${x.g.avgTurns.toFixed(1).padStart(6)} ${x.len.toFixed(1).padStart(8)} | ${x.score.toFixed(3)}`,
    );
  }
}
