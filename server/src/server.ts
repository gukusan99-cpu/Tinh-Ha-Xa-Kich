import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { AccountService, MemoryAccountStore, type AccountStore } from "./accounts.js";
import { realClock, type Clock } from "./clock.js";
import { loadGameData, type GameData, type Settings } from "./data.js";
import { Match } from "./match.js";
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  parseClientMessage,
  type Character,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from "./protocol.js";
import { World, type MonsterEntity, type PlayerEntity } from "./world.js";

/** Quá số lỗi này trong một kết nối thì đóng (spec: "quá 5"). */
const MAX_ERRORS = 5;
/** Mã đóng kết nối khi tài khoản đăng nhập ở nơi khác. */
export const CLOSE_REPLACED = 4001;
/** Một nhịp thế giới không bao giờ mô phỏng quá khoảng này (giây), dù timer bị trễ. */
const MAX_TICK_DT = 0.5;

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
export const SERVER_VERSION: string = pkg.version;

export interface ServerOptions {
  port: number;
  host?: string;
  /** Đồng hồ thay thế cho test. */
  clock?: Clock;
  /** Dữ liệu thay thế cho test; mặc định nạp từ data/. */
  data?: GameData;
  /** Ghi đè thời lượng pha / hồi sinh (giây). */
  timing?: Partial<Pick<Settings, "movePhaseSeconds" | "aimPhaseSeconds" | "replayPaddingSeconds" | "monsterRespawnSeconds">>;
  store?: AccountStore;
  random?: () => number;
  seed?: () => number;
}

export interface GameServer {
  /** Cổng thực sự đã bind (hữu ích khi tạo với port 0). */
  readonly port: number;
  /** Thế giới đang chạy; test dùng để đặt quái cạnh người chơi. */
  readonly world: World;
  /** Số trận đang chạy. */
  readonly matchCount: number;
  close(): Promise<void>;
}

const ERROR_TEXT: Record<ErrorCode, string> = {
  bad_json: "Thông điệp không phải JSON hợp lệ",
  bad_version: "Phiên bản giao thức không được hỗ trợ",
  bad_message: "Thông điệp sai định dạng hoặc sai trường",
  not_hello: "Thông điệp đầu tiên phải là hello",
  unknown_type: "Loại thông điệp không được hỗ trợ",
  too_large: "Thông điệp quá lớn",
  not_allowed: "Không được phép ở thời điểm hoặc quyền hiện tại",
};

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sendError(ws: WebSocket, code: ErrorCode, message = ERROR_TEXT[code]): void {
  send(ws, { v: PROTOCOL_VERSION, type: "error", code, message });
}

interface Session {
  ws: WebSocket;
  greeted: boolean;
  errors: number;
  closed: boolean;
  username: string | null;
  key: string | null;
  character: Character | null;
  entityId: number | null;
  match: Match | null;
  queue: Promise<void>;
}

/**
 * Quá kích thước: ws (maxPayload = 4 KB) tự đóng kết nối với mã 1009 trước khi
 * ta thấy thông điệp, nên máy chủ không gửi được error `too_large` ở đường này.
 * `too_large` chỉ còn dùng trong parser như lớp bảo vệ thứ hai.
 */
export function createServer(opts: ServerOptions): Promise<GameServer> {
  const clock = opts.clock ?? realClock;
  const base = opts.data ?? loadGameData();
  const data: GameData = { ...base, settings: { ...base.settings, ...opts.timing } };
  const accounts = new AccountService(opts.store ?? new MemoryAccountStore(), {
    signs: data.character.signs,
    startingGunId: data.character.commonGunIds[0]!,
    expPerLevel: data.character.expPerLevel,
  });

  const sessionsByKey = new Map<string, Session>();
  const matches = new Set<Match>();
  /** Tài khoản đang trong trận (kể cả khi kết nối đã rớt). */
  const matchKeys = new Set<string>();
  const inMatch = (key: string): boolean => matchKeys.has(key);
  const sessionOfEntity = (p: PlayerEntity): Session | undefined => sessionsByKey.get(p.ownerKey);

  function sendWorldState(s: Session, p: PlayerEntity): void {
    const map = world.mapDef(p.mapId);
    send(s.ws, {
      v: PROTOCOL_VERSION,
      type: "world_state",
      mapId: map.id,
      width: map.width,
      height: map.height,
      rows: map.rows,
      you: p.id,
      entities: world.entities(map.id),
    });
  }

  function startMatch(player: PlayerEntity, monster: MonsterEntity, mapId: string): void {
    const s = sessionOfEntity(player);
    if (!s || !s.character || !s.username || !s.key) return;
    s.entityId = null;
    const key = s.key;
    const username = s.username;
    const def = data.monsters[monster.monsterId]!;
    let latest: Character = s.character;
    const match: Match = new Match({
      id: randomUUID(),
      data,
      clock,
      seed: opts.seed,
      player: {
        name: s.character.name,
        sign: s.character.sign,
        gunId: s.character.gunId,
        send: (m) => send(s.ws, m),
        isConnected: () => !s.closed && s.ws.readyState === s.ws.OPEN,
      },
      monster: def,
      settle: async (_result, exp) => {
        latest = (await accounts.awardExp(username, exp)) ?? latest;
        return latest;
      },
      onDone: () => {
        matches.delete(match);
        matchKeys.delete(key);
        s.match = null;
        // trả người chơi về điểm xuất phát vùng săn, trên kết nối hiện tại của tài khoản (nếu có)
        const cur = sessionsByKey.get(key);
        if (!cur || cur.closed) return;
        cur.character = latest;
        if (cur !== s) send(cur.ws, { v: PROTOCOL_VERSION, type: "character", character: latest });
        if (cur.entityId !== null) return;
        const p = world.addPlayer(key, latest.name, mapId);
        cur.entityId = p.id;
        sendWorldState(cur, p);
      },
    });
    s.match = match;
    matches.add(match);
    matchKeys.add(key);
    match.start();
  }

  const world = new World({
    data,
    random: opts.random,
    events: {
      onTransfer: (p, _to) => {
        const s = sessionOfEntity(p);
        if (s) sendWorldState(s, p);
      },
      onContact: (p, m, mapId) => startMatch(p, m, mapId),
    },
  });

  function cleanup(s: Session): void {
    s.closed = true;
    if (s.key !== null && sessionsByKey.get(s.key) === s) sessionsByKey.delete(s.key);
    if (s.entityId !== null) world.removePlayer(s.entityId);
    s.entityId = null;
  }

  async function handle(s: Session, msg: ClientMessage, fail: (code: ErrorCode, text?: string) => void): Promise<void> {
    switch (msg.type) {
      case "hello":
        return fail("bad_message"); // hello lần hai
      case "ping":
        send(s.ws, { v: PROTOCOL_VERSION, type: "pong", seq: msg.seq, serverTime: Date.now() });
        return;
      case "register":
      case "login": {
        if (s.username !== null) return fail("not_allowed");
        const res =
          msg.type === "register"
            ? await accounts.register(msg.username, msg.password)
            : await accounts.login(msg.username, msg.password);
        if (s.closed) return;
        if (!res.ok) {
          send(s.ws, { v: PROTOCOL_VERSION, type: "auth_error", code: res.code });
          return;
        }
        if (s.username !== null) return fail("not_allowed"); // hai lệnh đăng nhập chồng nhau
        const key = res.account.username.toLowerCase();
        const old = sessionsByKey.get(key);
        if (old && old !== s) {
          sendError(old.ws, "not_allowed", "Tài khoản đăng nhập ở nơi khác");
          old.ws.close(CLOSE_REPLACED, "replaced");
          cleanup(old);
        }
        s.username = res.account.username;
        s.key = key;
        s.character = res.account.character;
        sessionsByKey.set(key, s);
        send(s.ws, { v: PROTOCOL_VERSION, type: "auth_ok", username: s.username, character: s.character });
        return;
      }
      case "create_character": {
        if (s.username === null || s.character !== null) return fail("not_allowed");
        const res = await accounts.createCharacter(s.username, msg.name, msg.sign);
        if (s.closed) return;
        if (!res.ok) return fail(res.code === "exists" ? "not_allowed" : "bad_message");
        s.character = res.character;
        send(s.ws, { v: PROTOCOL_VERSION, type: "character", character: res.character });
        return;
      }
      case "enter_world": {
        if (s.key === null || s.character === null || s.entityId !== null || inMatch(s.key)) return fail("not_allowed");
        const p = world.addPlayer(s.key, s.character.name, data.startMapId);
        s.entityId = p.id;
        sendWorldState(s, p);
        return;
      }
      case "move_to": {
        if (s.entityId === null) return fail("not_allowed");
        world.setTarget(s.entityId, msg.x, msg.y);
        return;
      }
      case "battle_move": {
        if (!s.match || s.match.handleMove(msg.col) !== "ok") return fail("not_allowed");
        return;
      }
      case "battle_shot": {
        if (!s.match || s.match.handleShot(msg.angle, msg.power, msg.facing, msg.gunId) !== "ok") return fail("not_allowed");
        return;
      }
      case "aim_preview": {
        const r = s.match?.handlePreview(msg.angle, msg.power, msg.facing, msg.gunId);
        if (r === undefined || r === "not_allowed") return fail("not_allowed");
        return; // "dropped": bỏ qua lặng lẽ
      }
    }
  }

  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: opts.port, host: opts.host, maxPayload: MAX_MESSAGE_BYTES });

    wss.on("connection", (ws) => {
      const s: Session = {
        ws,
        greeted: false,
        errors: 0,
        closed: false,
        username: null,
        key: null,
        character: null,
        entityId: null,
        match: null,
        queue: Promise.resolve(),
      };

      const reject_ = (code: ErrorCode, text?: string): void => {
        sendError(ws, code, text);
        // not_allowed thường do lệch thời điểm (pha vừa hết giờ), không phải dữ liệu xấu: không tính.
        if (code === "not_allowed") return;
        s.errors++;
        if (s.errors > MAX_ERRORS) ws.close(1008, "too many errors");
      };

      function notHello(): void {
        sendError(ws, "not_hello");
        ws.close(1008, "not_hello");
      }

      ws.on("message", (raw: RawData, isBinary: boolean) => {
        try {
          if (isBinary || Array.isArray(raw)) {
            if (!s.greeted) return notHello();
            return reject_("bad_message");
          }
          const buf = raw instanceof ArrayBuffer ? Buffer.from(raw) : raw;
          const res = parseClientMessage(buf);

          if (!s.greeted) {
            if (res.ok && res.message.type === "hello") {
              s.greeted = true;
              send(ws, {
                v: PROTOCOL_VERSION,
                type: "welcome",
                sessionId: randomUUID(),
                serverVersion: SERVER_VERSION,
                serverTime: Date.now(),
              });
              return;
            }
            return notHello();
          }

          if (!res.ok) return reject_(res.code);
          const msg = res.message;
          // xử lý tuần tự theo kết nối để thứ tự lệnh được giữ dù có bước bất đồng bộ (băm mật khẩu)
          s.queue = s.queue
            .then(() => handle(s, msg, reject_))
            .catch((e) => {
              console.error("lỗi xử lý thông điệp", e);
              ws.close(1011, "internal error");
            });
        } catch (e) {
          console.error("lỗi xử lý thông điệp", e);
          ws.close(1011, "internal error");
        }
      });

      ws.on("close", () => cleanup(s));
      ws.on("error", () => ws.terminate());
    });

    wss.once("error", reject);
    wss.once("listening", () => {
      wss.off("error", reject);
      wss.on("error", (e) => console.error("lỗi máy chủ", e));
      const port = (wss.address() as AddressInfo).port;

      let last = clock.now();
      const stopTick = clock.setInterval(() => {
        const now = clock.now();
        const dt = Math.min(MAX_TICK_DT, Math.max(0, (now - last) / 1000));
        last = now;
        world.step(dt);
        const sent = new Map<string, string>();
        for (const s of sessionsByKey.values()) {
          if (s.entityId === null) continue;
          const p = world.getPlayer(s.entityId);
          if (!p) continue;
          let text = sent.get(p.mapId);
          if (text === undefined) {
            text = JSON.stringify({ v: PROTOCOL_VERSION, type: "world_tick", entities: world.entities(p.mapId) });
            sent.set(p.mapId, text);
          }
          if (s.ws.readyState === s.ws.OPEN) s.ws.send(text);
        }
      }, 1000 / data.settings.worldTickHz);

      resolve({
        port,
        world,
        get matchCount() {
          return matches.size;
        },
        close: () =>
          new Promise<void>((res) => {
            stopTick();
            for (const m of matches) m.abort();
            matches.clear();
            for (const c of wss.clients) c.terminate();
            wss.close(() => res());
          }),
      });
    });
  });
}
