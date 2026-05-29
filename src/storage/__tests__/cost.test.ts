import os from "os";
import fs from "fs";
import path from "path";
import type { CostRecord, SessionCostSummary } from "../cost";

// 把数据目录指向临时 HOME，再动态 require（db.ts 在加载时按 HOME 计算路径）
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "clp-cost-test-"));

let insertCostRecord: (record: CostRecord) => void;
let aggregateCostBySession: (sessionId: string) => SessionCostSummary | null;

beforeAll(() => {
  process.env.HOME = tmpHome;
  jest.resetModules();
  const mod = require("../cost") as typeof import("../cost");
  insertCostRecord = mod.insertCostRecord;
  aggregateCostBySession = mod.aggregateCostBySession;
});

afterAll(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

let seq = 0;
const rec = (
  sessionId: string,
  o: { outputTokens: number; durationMs: number; firstChunkMs: number | null },
): CostRecord => ({
  id: `r${seq++}`,
  logId: null,
  timestamp: new Date().toISOString(),
  sessionId,
  targetId: "t1",
  targetName: "T1",
  model: "m",
  inputTokens: 10,
  outputTokens: o.outputTokens,
  totalTokens: 10 + o.outputTokens,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
  durationMs: o.durationMs,
  firstChunkMs: o.firstChunkMs,
  status: "completed",
});

describe("aggregateCostBySession — decode TPS 指标", () => {
  it("只统计有效流式请求，排除非流式/0时长/异常", () => {
    const sid = "sess-tps";
    insertCostRecord(rec(sid, { outputTokens: 300, durationMs: 2000, firstChunkMs: 500 })); // decode 1500
    insertCostRecord(rec(sid, { outputTokens: 100, durationMs: 1000, firstChunkMs: 200 })); // decode 800
    insertCostRecord(rec(sid, { outputTokens: 999, durationMs: 50, firstChunkMs: null })); // 非流式 → 排除
    insertCostRecord(rec(sid, { outputTokens: 999, durationMs: 100, firstChunkMs: 100 })); // duration==firstChunk → 排除

    const s = aggregateCostBySession(sid)!;
    expect(s).not.toBeNull();
    expect(s.decodeOutputTokens).toBe(400); // 300 + 100
    expect(s.totalDecodeMs).toBe(2300); // 1500 + 800
    expect(s.requestCount).toBe(4); // 计数仍含全部
    // TPS = 400 / 2300 * 1000 ≈ 173.9
    const tps = (s.decodeOutputTokens / s.totalDecodeMs) * 1000;
    expect(tps).toBeCloseTo(173.9, 1);
  });

  it("全是非流式请求时 decode 指标为 0（前端会显示 —）", () => {
    const sid = "sess-nostream";
    insertCostRecord(rec(sid, { outputTokens: 500, durationMs: 80, firstChunkMs: null }));
    const s = aggregateCostBySession(sid)!;
    expect(s.decodeOutputTokens).toBe(0);
    expect(s.totalDecodeMs).toBe(0);
  });

  it("不存在的会话返回 null", () => {
    expect(aggregateCostBySession("nope")).toBeNull();
  });
});
