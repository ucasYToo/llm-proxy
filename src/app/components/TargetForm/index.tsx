"use client";
import { useState } from "react";
import type { Target } from "@/lib/types";
import styles from "./index.module.css";

interface KVPair {
  key: string;
  value: string;
}

const kvFromRecord = (record: Record<string, string | unknown>): KVPair[] => {
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
};

const recordFromKV = (pairs: KVPair[]): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const { key, value } of pairs) {
    if (key.trim()) result[key.trim()] = value;
  }
  return result;
};

interface Props {
  initial?: Target;
  onSave: (target: Omit<Target, "id"> & { id?: string }) => void;
  onCancel: () => void;
}

const TargetForm = ({ initial, onSave, onCancel }: Props) => {
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [headers, setHeaders] = useState<KVPair[]>(
    initial?.headers ? kvFromRecord(initial.headers) : [{ key: "", value: "" }]
  );
  const [bodyParams, setBodyParams] = useState<KVPair[]>(
    initial?.bodyParams ? kvFromRecord(initial.bodyParams as Record<string, string>) : [{ key: "", value: "" }]
  );

  const handleSave = () => {
    if (!name.trim() || !url.trim()) return;
    const headersRecord = recordFromKV(headers);
    const bodyParamsRecord = recordFromKV(bodyParams);
    // 尝试将 body 参数值解析为 JSON
    const parsedBody: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(bodyParamsRecord)) {
      try { parsedBody[k] = JSON.parse(v); } catch { parsedBody[k] = v; }
    }
    onSave({
      ...(initial?.id ? { id: initial.id } : {}),
      name: name.trim(),
      url: url.trim().replace(/\/$/, ""),
      headers: headersRecord,
      bodyParams: parsedBody,
    });
  };

  return (
    <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={styles.modal}>
        <h2>{initial ? "编辑目标" : "添加目标"}</h2>

        <div className={styles.formGroup}>
          <label>名称</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="OpenAI" />
        </div>

        <div className={styles.formGroup}>
          <label>Base URL</label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
          />
          <p className={styles.formHint}>请求路径将直接拼接到此 URL 后面</p>
        </div>

        <div className={styles.formGroup}>
          <label>请求头（Headers）</label>
          <KVEditor pairs={headers} onChange={setHeaders} keyPlaceholder="Authorization" valuePlaceholder="Bearer sk-xxx" quickKeys={["user-agent", "authorization"]} />
        </div>

        <div className={styles.formGroup}>
          <label>Body 追加参数</label>
          <KVEditor pairs={bodyParams} onChange={setBodyParams} keyPlaceholder="model" valuePlaceholder="gpt-4o" quickKeys={["model"]} />
          <p className={styles.formHint}>值支持 JSON 格式（如 true、123、"字符串"）</p>
        </div>

        <div className={styles.modalFooter}>
          <button className="btnGhost" onClick={onCancel}>取消</button>
          <button className="btnPrimary" onClick={handleSave} disabled={!name.trim() || !url.trim()}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default TargetForm;

const KVEditor = ({
  pairs,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  quickKeys,
}: {
  pairs: KVPair[];
  onChange: (v: KVPair[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  quickKeys?: string[];
}) => {
  const existingKeys = new Set(pairs.map((p) => p.key.trim().toLowerCase()));

  const handleQuickAdd = (key: string) => {
    // 如果已有空行，填入 key；否则新增一行
    const emptyIndex = pairs.findIndex((p) => !p.key.trim());
    if (emptyIndex >= 0) {
      onChange(pairs.map((p, i) => i === emptyIndex ? { ...p, key } : p));
    } else {
      onChange([...pairs, { key, value: "" }]);
    }
  };

  const availableQuickKeys = quickKeys?.filter((k) => !existingKeys.has(k.toLowerCase()));

  return (
    <>
      {availableQuickKeys && availableQuickKeys.length > 0 && (
        <div className={styles.quickKeys}>
          {availableQuickKeys.map((key) => (
            <button key={key} className={styles.quickKeyBtn} onClick={() => handleQuickAdd(key)}>
              + {key}
            </button>
          ))}
        </div>
      )}
      <div className={styles.kvList}>
        {pairs.map((pair, idx) => (
          <div key={idx} className={styles.kvRow}>
            <input
              type="text"
              value={pair.key}
              placeholder={keyPlaceholder}
              onChange={(e) => onChange(pairs.map((p, i) => i === idx ? { ...p, key: e.target.value } : p))}
            />
            <input
              type="text"
              value={pair.value}
              placeholder={valuePlaceholder}
              onChange={(e) => onChange(pairs.map((p, i) => i === idx ? { ...p, value: e.target.value } : p))}
            />
            <button className="btnGhost btnSm" onClick={() => onChange(pairs.filter((_, i) => i !== idx))}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <button className="btnGhost btnSm" onClick={() => onChange([...pairs, { key: "", value: "" }])}>
        + 添加
      </button>
    </>
  );
};
