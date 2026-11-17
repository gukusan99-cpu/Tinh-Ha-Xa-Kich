/** Đồng hồ có thể thay thế để test chạy nhanh. Mọi timer trong máy chủ đi qua đây. */
export interface Clock {
  /** Mili giây (cùng hệ quy chiếu với `serverTime`/`deadline` gửi cho client). */
  now(): number;
  /** Trả về hàm hủy. */
  setTimeout(fn: () => void, ms: number): () => void;
  setInterval(fn: () => void, ms: number): () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
  setInterval(fn, ms) {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  },
};

/** Đồng hồ chạy nhanh `factor` lần so với giờ thật (dùng cho test tích hợp). */
export function scaledClock(factor: number): Clock {
  const t0 = Date.now();
  return {
    now: () => t0 + (Date.now() - t0) * factor,
    setTimeout(fn, ms) {
      const t = setTimeout(fn, ms / factor);
      return () => clearTimeout(t);
    },
    setInterval(fn, ms) {
      const t = setInterval(fn, ms / factor);
      return () => clearInterval(t);
    },
  };
}
