import { useCallback, useEffect, useState } from "react";
import { getProjects, updateProjectRemarkApi } from "../../lib/api";
import type { Project } from "../../lib/api";
import styles from "./index.module.css";

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} 天前`;
  return d.toLocaleDateString();
};

const ProjectsTab = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [remarks, setRemarks] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const data = await getProjects();
      setProjects(data);
      const r: Record<string, string> = {};
      for (const p of data) {
        r[p.cwd] = p.remark ?? "";
      }
      setRemarks(r);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleRemarkBlur = async (cwd: string) => {
    const current = remarks[cwd] ?? "";
    const original = projects.find((p) => p.cwd === cwd)?.remark ?? "";
    if (current === original) return;
    try {
      await updateProjectRemarkApi(cwd, current);
      await load();
    } catch (e) {
      alert("保存备注失败：" + String(e));
    }
  };

  const handleRemarkKeyDown = (e: React.KeyboardEvent, cwd: string) => {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>项目管理</span>
      </div>

      {loading ? (
        <div className={styles.loading}>加载中...</div>
      ) : projects.length === 0 ? (
        <div className={styles.empty}>暂无项目记录。代理收到请求后会自动记录项目目录。</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>项目目录</th>
              <th>备注</th>
              <th>最后活跃</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.cwd}>
                <td className={styles.cwdPath}>{p.cwd}</td>
                <td>
                  <input
                    className={styles.remarkInput}
                    value={remarks[p.cwd] ?? ""}
                    placeholder="添加备注..."
                    onChange={(e) => setRemarks((prev) => ({ ...prev, [p.cwd]: e.target.value }))}
                    onBlur={() => handleRemarkBlur(p.cwd)}
                    onKeyDown={(e) => handleRemarkKeyDown(e, p.cwd)}
                  />
                </td>
                <td className={styles.lastSeen}>{formatTime(p.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default ProjectsTab;
