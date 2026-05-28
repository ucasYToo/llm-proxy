import { useEffect, useState } from "react";
import { fetchLogs } from "../../../lib/api";
import type { LogEntry } from "../../../lib/api";
import Sparkline from "../../shared/Sparkline";
import { formatCost, formatTokens } from "../types";
import styles from "./index.module.css";

interface SessionCost {
  sessionId: string;
  totalCost: number;
  totalTokens: number;
  requestCount: number;
  trend: number[];
}

const TopSessions = () => {
  const [sessions, setSessions] = useState<SessionCost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetchLogs(500);
        const sessionMap = new Map<string, SessionCost>();

        for (const entry of res.entries) {
          const sid = entry.sessionId ?? "unknown";
          const cost = estimateCost(entry);
          const tokens = entry.tokenUsage?.totalTokens ?? 0;

          const existing = sessionMap.get(sid);
          if (existing) {
            existing.totalCost += cost;
            existing.totalTokens += tokens;
            existing.requestCount += 1;
            existing.trend.push(cost);
          } else {
            sessionMap.set(sid, {
              sessionId: sid,
              totalCost: cost,
              totalTokens: tokens,
              requestCount: 1,
              trend: [cost],
            });
          }
        }

        const sorted = Array.from(sessionMap.values())
          .sort((a, b) => b.totalCost - a.totalCost)
          .slice(0, 10);

        setSessions(sorted);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  if (loading) {
    return (
      <div className={styles.card}>
        <h3 className={styles.title}>费用最高会话</h3>
        <div className={styles.loading}>加载中…</div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className={styles.card}>
        <h3 className={styles.title}>费用最高会话</h3>
        <div className={styles.empty}>暂无会话数据</div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <h3 className={styles.title}>费用最高会话</h3>
      <div className={styles.list}>
        {sessions.map((session, i) => (
          <div key={session.sessionId} className={styles.row}>
            <span className={styles.rank}>{i + 1}</span>
            <div className={styles.info}>
              <span className={styles.sessionId}>
                {session.sessionId.slice(0, 12)}…
              </span>
              <div className={styles.meta}>
                <span>{session.requestCount} 请求</span>
                <span>{formatTokens(session.totalTokens)} tokens</span>
              </div>
            </div>
            <div className={styles.sparkWrap}>
              {session.trend.length >= 2 && (
                <Sparkline data={session.trend} width={60} height={20} />
              )}
            </div>
            <span className={styles.cost}>{formatCost(session.totalCost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Simple cost estimation based on token usage
const estimateCost = (entry: LogEntry): number => {
  const tokens = entry.tokenUsage?.totalTokens ?? 0;
  // Rough estimate: $3 per 1M tokens (Claude Sonnet average)
  return (tokens / 1_000_000) * 3;
};

export default TopSessions;
