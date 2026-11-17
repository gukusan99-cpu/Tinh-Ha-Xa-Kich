/**
 * CLI mô phỏng cân bằng: npx tsx scripts/simulate.ts [--n 1000] [--seed 1] [--sign <id>|all|none] [--monster <id>|all] [--sweep] [--override key=value ...]
 * PvP (docs/08): npx tsx scripts/simulate.ts --pvp [--n 400] [--seed 1]  (mọi cặp cung, hai bot gioi có né, đổi bên nửa số trận)
 * Loadout (docs/10): --loadout a,b = toàn bộ súng chung mang theo (thay mặc định thuoc_no_nho), áp dụng cho PvE và PvP.
 * So sánh: npx tsx scripts/simulate.ts --compare-loadouts [--n 200] [--sign <id>|all] [--seed 1] [--monster <id>]
 *   (mỗi cung, bot trung_binh: loadout mặc định so với thêm từng súng chung; in thắng% và chênh lệch theo điểm %)
 * Mặc định (không --sign): bảng theo từng cung. `--sign none` = chỉ súng chung, không nội tại.
 */
import {
  candidateGuns,
  compareLoadouts,
  getData,
  OVERRIDE_KEYS,
  POLICIES,
  pvpPairs,
  runMany,
  runPvpPair,
  type Overrides,
  type PvpPairSummary,
  type Summary,
} from "../src/sim/simulate.js";

const argv = process.argv.slice(2);
let n = 1000;
let seed = 1;
let sweep = false;
let pvp = false;
let compare = false;
let loadout: string[] | undefined;
let nGiven = false;
let signArg = "all";
/** "" = quái đầu tiên trong data/quai.json; "all" = bảng theo từng quái × cung; hoặc một id quái. */
let monsterArg = "";
const overrides: Overrides = {};

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === "--n") {
    n = Number(argv[++i]);
    nGiven = true;
  } else if (a === "--compare-loadouts") compare = true;
  else if (a === "--loadout") loadout = (argv[++i] ?? "").split(",").filter((x) => x !== "");
  else if (a === "--seed") seed = Number(argv[++i]);
  else if (a === "--sweep") sweep = true;
  else if (a === "--pvp") pvp = true;
  else if (a === "--sign") signArg = argv[++i] ?? "";
  else if (a === "--monster") monsterArg = argv[++i] ?? "";
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

const monsterIds = Object.keys(getData().monsters);
if (monsterArg !== "" && monsterArg !== "all" && !monsterIds.includes(monsterArg)) {
  throw new Error(`--monster không hợp lệ "${monsterArg}". Hợp lệ: all, ${monsterIds.join(", ")}`);
}
const monsterId = monsterArg === "" || monsterArg === "all" ? undefined : monsterArg;

if (compare) {
  const signs = signArg === "all" || signArg === "none" ? allSigns : [signArg];
  const nc = nGiven ? n : 200;
  const t0 = Date.now();
  const guns = candidateGuns(getData());
  console.log(`--compare-loadouts n=${nc} seed=${seed} monster=${monsterId ?? "am_thach_nho"} policy=trung_binh (thắng% và chênh lệch so với loadout mặc định, điểm %)`);
  const cmp = signs.map((s) => compareLoadouts(s, nc, "trung_binh", seed, monsterId ?? "am_thach_nho"));
  console.log("gun".padEnd(12) + cmp.map((c) => c.sign.padStart(14)).join(""));
  console.log("(mặc định)".padEnd(12) + cmp.map((c) => pct(c.baseline).padStart(14)).join(""));
  for (const g of guns) {
    console.log(
      g.padEnd(12) +
        cmp
          .map((c) => {
            const r = c.rows.find((x) => x.gunId === g)!;
            return `${pct(r.win)} ${(r.deltaPoints >= 0 ? "+" : "") + r.deltaPoints.toFixed(1)}`.padStart(14);
          })
          .join(""),
    );
  }
  const avg = guns.map((g) => ({ g, d: cmp.reduce((s, c) => s + c.rows.find((x) => x.gunId === g)!.deltaPoints, 0) / cmp.length }));
  console.log("\nTB theo súng (điểm %): " + avg.map((x) => `${x.g} ${x.d >= 0 ? "+" : ""}${x.d.toFixed(1)}`).join(", "));
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
} else if (monsterArg === "all" && !pvp && !sweep) {
  const signs: (string | undefined)[] = signArg === "all" ? allSigns : signArg === "none" ? [undefined] : [signArg];
  const t0 = Date.now();
  console.log(`n=${n} seed=${seed} overrides=${JSON.stringify(overrides)}`);
  console.log("monster          sign        gioi    | trung_binh | turns(gioi)");
  for (const mid of monsterIds) {
    for (const sign of signs) {
      const g = runMany("gioi", n, overrides, seed, sign, mid, loadout);
      const t = runMany("trung_binh", n, overrides, seed, sign, mid, loadout);
      console.log(
        `${mid.padEnd(16)} ${(sign ?? "none").padEnd(11)} ${pct(g.win)} | ${pct(t.win)}     | ${g.avgTurns.toFixed(2)}`,
      );
    }
  }
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
} else if (pvp) {
  const nPvp = argv.includes("--n") ? n : 400;
  const t0 = Date.now();
  const signs = getData().character.signs;
  const res = new Map<string, PvpPairSummary>();
  for (const [a, b] of pvpPairs(signs)) res.set(`${a}|${b}`, runPvpPair(a, b, nPvp, seed, undefined, { a: loadout, b: loadout }));
  const cell = (row: string, col: string): string => {
    const direct = res.get(`${row}|${col}`);
    if (direct) {
      // cùng cung: chỉ có thể đo thiên vị bên (đội 0 thắng), vì thắng của "hàng" và "cột" là một
      return row === col ? pct(direct.team0Wins / direct.n) + "*" : pct(direct.aWins / direct.n) + " ";
    }
    const rev = res.get(`${col}|${row}`)!;
    return pct(rev.bWins / rev.n) + " ";
  };
  const drawCell = (row: string, col: string): string => {
    const r = res.get(`${row}|${col}`) ?? res.get(`${col}|${row}`)!;
    return pct(r.draws / r.n) + " ";
  };
  const head = "".padEnd(11) + signs.map((s) => s.padStart(11)).join("");
  console.log(`PvP n=${nPvp}/cặp seed=${seed} (gioi + né, bản đồ ${getData().settings.pvpBattleMapId}, tối đa ${getData().settings.pvpMaxTurns} lượt)`);
  console.log("\nThắng% của cung HÀNG trước cung CỘT (* = cùng cung: thắng% của bên trái, kỳ vọng ~50%)");
  console.log(head);
  for (const r of signs) console.log(r.padEnd(11) + signs.map((c) => cell(r, c).padStart(11)).join(""));
  console.log("\nHòa%");
  console.log(head);
  for (const r of signs) console.log(r.padEnd(11) + signs.map((c) => drawCell(r, c).padStart(11)).join(""));
  const all = [...res.values()];
  const total = all.reduce((s, x) => s + x.n, 0);
  console.log(
    `\nBên trái (đội 0) thắng ${pct(all.reduce((s, x) => s + x.team0Wins, 0) / total)} tổng; ` +
      `lượt TB ${(all.reduce((s, x) => s + x.avgTurns * x.n, 0) / total).toFixed(2)}`,
  );
  const worst = all.filter((x) => x.a !== x.b).map((x) => ({ x, w: Math.max(x.aWins, x.bWins) / x.n }));
  worst.sort((p, q) => q.w - p.w);
  const top = worst[0];
  if (top) console.log(`Cặp lệch nhất: ${top.x.a} vs ${top.x.b}, bên mạnh thắng ${pct(top.w)} (mục tiêu ≤ 60%)`);
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
} else if (!sweep) {
  const signs: (string | undefined)[] = signArg === "all" ? allSigns : signArg === "none" ? [undefined] : [signArg];
  console.log(`n=${n} seed=${seed} monster=${monsterId ?? monsterIds[0]} overrides=${JSON.stringify(overrides)}`);
  console.log("sign       policy       win     lose    draw    avgTurns  avgHpOnWin");
  const t0 = Date.now();
  const winTable: Record<string, Record<string, Summary>> = {};
  for (const sign of signs) {
    for (const p of POLICIES) {
      const s = runMany(p, n, overrides, seed, sign, monsterId, loadout);
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
