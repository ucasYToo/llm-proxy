import { useState } from "react";
import styles from "./index.module.css";

/** 生成折叠时的单行摘要，例如 { role: "user", content: [3 items] } */
const buildObjectSummary = (obj: Record<string, unknown>): string => {
  const MAX_LEN = 80;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    let valStr: string;
    if (v === null) valStr = "null";
    else if (typeof v === "boolean") valStr = String(v);
    else if (typeof v === "number") valStr = String(v);
    else if (typeof v === "string") {
      const truncated = v.length > 20 ? v.slice(0, 20) + "…" : v;
      valStr = `"${truncated}"`;
    } else if (Array.isArray(v)) {
      valStr = `[${v.length} items]`;
    } else if (typeof v === "object") {
      valStr = `{${Object.keys(v as object).length} keys}`;
    } else {
      valStr = String(v);
    }
    parts.push(`${k}: ${valStr}`);
    // 超长就截断
    const current = "{ " + parts.join(", ") + " }";
    if (current.length > MAX_LEN) {
      // 去掉最后一个，加省略号
      parts.pop();
      parts.push("…");
      break;
    }
  }
  return "{ " + parts.join(", ") + " }";
};;

interface JsonViewerProps {
  data: unknown;
  /** 默认展开层数，默认 2 */
  defaultExpandDepth?: number;
}

export const JsonViewer = ({ data, defaultExpandDepth = 2 }: JsonViewerProps) => {
  return (
    <div className={styles.jsonViewer}>
      <JsonNode value={data} depth={0} defaultExpandDepth={defaultExpandDepth} />
    </div>
  );
};

/* ── 复制按钮 ── */
const CopyBtn = ({ value }: { value: unknown }) => {
  const [done, setDone] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    });
  };

  return (
    <button
      className={`${styles.copyBtn}${done ? ` ${styles.copyBtnDone}` : ""}`}
      onClick={handleCopy}
      title="复制值"
    >
      {done ? "✓" : "copy"}
    </button>
  );
};

/* ── 单个节点 ── */
interface JsonNodeProps {
  value: unknown;
  depth: number;
  defaultExpandDepth: number;
  propKey?: string;
}

const JsonNode = ({ value, depth, defaultExpandDepth, propKey }: JsonNodeProps) => {
  const [expanded, setExpanded] = useState(depth < defaultExpandDepth);

  const isObject = value !== null && typeof value === "object";
  const isArray = Array.isArray(value);

  const keyEl = propKey !== undefined ? (
    <>
      <span className={styles.key}>&quot;{propKey}&quot;</span>
      <span className={styles.colon}>:</span>
    </>
  ) : null;

  /* ── 基本类型 ── */
  if (!isObject) {
    return (
      <div className={styles.node}>
        <div className={styles.row}>
          <span className={styles.togglePlaceholder} />
          {keyEl}
          <PrimitiveValue value={value} />
          <CopyBtn value={value} />
        </div>
      </div>
    );
  }

  /* ── 对象 / 数组 ── */
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(value as Record<string, unknown>);

  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";
  const count = entries.length;

  if (count === 0) {
    return (
      <div className={styles.node}>
        <div className={styles.row}>
          <span className={styles.togglePlaceholder} />
          {keyEl}
          <span className={styles.valBracket}>{openBracket}{closeBracket}</span>
          <CopyBtn value={value} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.node}>
      <div className={styles.row} onClick={() => setExpanded((v) => !v)}>
        <span className={styles.toggle}>{expanded ? "▾" : "▸"}</span>
        {keyEl}
        {!expanded ? (
          isArray ? (
            <>
              <span className={styles.valBracket}>[</span>
              <span className={styles.valCollapsed}>{count} items</span>
              <span className={styles.valBracket}>]</span>
              <CopyBtn value={value} />
            </>
          ) : (
            <>
              <span className={styles.valCollapsed}>
                {buildObjectSummary(value as Record<string, unknown>)}
              </span>
              <CopyBtn value={value} />
            </>
          )
        ) : (
          <span className={styles.valBracket}>{openBracket}</span>
        )}
      </div>

      {expanded && (
        <>
          <div className={styles.children}>
            {entries.map(([k, v]) => (
              <JsonNode
                key={k}
                propKey={isArray ? undefined : k}
                value={v}
                depth={depth + 1}
                defaultExpandDepth={defaultExpandDepth}
              />
            ))}
          </div>
          <div className={styles.row}>
            <span className={styles.togglePlaceholder} />
            <span className={styles.valBracket}>{closeBracket}</span>
            <CopyBtn value={value} />
          </div>
        </>
      )}
    </div>
  );
};

/* ── 基本类型渲染 ── */
const PrimitiveValue = ({ value }: { value: unknown }) => {
  if (value === null) return <span className={styles.valNull}>null</span>;
  if (typeof value === "boolean")
    return <span className={styles.valBoolean}>{String(value)}</span>;
  if (typeof value === "number")
    return <span className={styles.valNumber}>{value}</span>;
  if (typeof value === "string")
    return <span className={styles.valString}>&quot;{value}&quot;</span>;
  return <span>{String(value)}</span>;
};
