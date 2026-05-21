import { useMemo, useState } from "react";
import type { Target, TargetAuth, TargetAuthType } from "../../lib/api";
import styles from "./index.module.css";

interface TargetFormProps {
  initial?: Target;
  onSave: (target: Omit<Target, "id"> & { id?: string }) => void;
  onCancel: () => void;
}

interface KVPair {
  key: string;
  value: string;
}

const SENSITIVE_KEY_PATTERN = /^(authorization|x-api-key|api-key|x-goog-api-key|openai-api-key)$/i;

const kvFromRecord = (record: Record<string, string>): KVPair[] => {
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

const detectLegacyAuth = (headers: Record<string, string>): TargetAuth | null => {
  const entry = Object.entries(headers).find(([k]) => SENSITIVE_KEY_PATTERN.test(k));
  if (!entry) return null;
  const [key, value] = entry;
  const lower = key.toLowerCase();
  if (lower === "authorization") {
    const m = value.match(/^Bearer\s+(.+)$/i);
    return m ? { type: "bearer", value: m[1].trim() } : { type: "custom", headerName: key, value };
  }
  if (lower === "x-api-key") return { type: "x-api-key", value };
  return { type: "custom", headerName: key, value };
};

const TargetForm = ({ initial, onSave, onCancel }: TargetFormProps) => {
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [anthropicModel, setAnthropicModel] = useState(initial?.anthropicModel ?? "");
  const [auth, setAuth] = useState<TargetAuth | undefined>(initial?.auth);
  const [revealAuth, setRevealAuth] = useState(false);
  const [headers, setHeaders] = useState<KVPair[]>(
    initial?.headers
      ? kvFromRecord(initial.headers as Record<string, string>)
      : [{ key: "", value: "" }],
  );
  const [bodyParams, setBodyParams] = useState<KVPair[]>(
    initial?.bodyParams
      ? kvFromRecord(initial.bodyParams as Record<string, string>)
      : [{ key: "", value: "" }],
  );

  const legacyAuth = useMemo(() => {
    if (auth) return null;
    return detectLegacyAuth(recordFromKV(headers));
  }, [auth, headers]);

  const handleAuthTypeChange = (type: TargetAuthType) => {
    setAuth({
      type,
      value: auth?.value ?? "",
      headerName: type === "custom" ? (auth?.headerName ?? "") : undefined,
    });
  };

  const handleAuthValueChange = (value: string) => {
    setAuth({
      type: auth?.type ?? "bearer",
      headerName: auth?.headerName,
      value,
    });
  };

  const handleAuthHeaderNameChange = (headerName: string) => {
    setAuth({
      type: "custom",
      headerName,
      value: auth?.value ?? "",
    });
  };

  const handleClearAuth = () => {
    setAuth(undefined);
    setRevealAuth(false);
  };

  const handleMigrateLegacyAuth = () => {
    if (!legacyAuth) return;
    setAuth(legacyAuth);
    const matchKey =
      legacyAuth.type === "bearer"
        ? "authorization"
        : legacyAuth.type === "x-api-key"
          ? "x-api-key"
          : legacyAuth.headerName?.toLowerCase();
    if (matchKey) {
      setHeaders((prev) => prev.filter((p) => p.key.trim().toLowerCase() !== matchKey));
    }
  };

  const handleCopyAuth = async () => {
    if (!auth?.value) return;
    try {
      await navigator.clipboard.writeText(auth.value);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSave = () => {
    if (!name.trim() || !url.trim()) return;
    const headersRecord = recordFromKV(headers);
    const bodyParamsRecord = recordFromKV(bodyParams);
    const parsedBody: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(bodyParamsRecord)) {
      try {
        parsedBody[k] = JSON.parse(v);
      } catch {
        parsedBody[k] = v;
      }
    }
    const finalAuth = auth?.value
      ? auth.type === "custom"
        ? auth.headerName?.trim()
          ? { type: "custom" as const, headerName: auth.headerName.trim(), value: auth.value }
          : undefined
        : { type: auth.type, value: auth.value }
      : undefined;
    onSave({
      ...(initial?.id ? { id: initial.id } : {}),
      name: name.trim(),
      url: url.trim().replace(/\/$/, ""),
      headers: headersRecord,
      bodyParams: parsedBody,
      anthropicModel: anthropicModel.trim() || undefined,
      auth: finalAuth,
    });
  };

  return (
    <div
      className={styles.modalBackdrop}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className={styles.modal}>
        <h2>{initial ? "编辑目标" : "添加目标"}</h2>

        <div className={styles.formGroup}>
          <label>名称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="OpenAI"
          />
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
          <label>认证（Token）</label>
          <div className={styles.authRow}>
            <select
              className={styles.authTypeSelect}
              value={auth?.type ?? "bearer"}
              onChange={(e) => handleAuthTypeChange(e.target.value as TargetAuthType)}
            >
              <option value="bearer">Bearer</option>
              <option value="x-api-key">x-api-key</option>
              <option value="custom">自定义 Header</option>
            </select>
            <input
              type={revealAuth ? "text" : "password"}
              className={styles.authValueInput}
              value={auth?.value ?? ""}
              onChange={(e) => handleAuthValueChange(e.target.value)}
              placeholder={
                auth?.type === "bearer" || !auth?.type
                  ? "sk-xxx（不要包含 Bearer 前缀）"
                  : "Token 值"
              }
              autoComplete="off"
            />
            <button
              type="button"
              className="btnGhost btnSm"
              onClick={() => setRevealAuth((v) => !v)}
              title={revealAuth ? "隐藏" : "显示"}
            >
              {revealAuth ? "隐藏" : "显示"}
            </button>
            <button
              type="button"
              className="btnGhost btnSm"
              onClick={handleCopyAuth}
              disabled={!auth?.value}
              title="复制 Token 值"
            >
              复制
            </button>
            {auth && (
              <button
                type="button"
                className="btnGhost btnSm"
                onClick={handleClearAuth}
                title="清除认证"
              >
                清除
              </button>
            )}
          </div>
          {auth?.type === "custom" && (
            <input
              type="text"
              className={styles.authHeaderNameInput}
              value={auth.headerName ?? ""}
              onChange={(e) => handleAuthHeaderNameChange(e.target.value)}
              placeholder="Header 名称（如 x-goog-api-key）"
            />
          )}
          <p className={styles.formHint}>
            发送请求时会自动拼成：
            {auth?.type === "x-api-key"
              ? "x-api-key: <token>"
              : auth?.type === "custom" && auth.headerName
                ? `${auth.headerName}: <token>`
                : "Authorization: Bearer <token>"}
            。请直接填纯 Token，无需 Bearer 前缀。
          </p>
          {legacyAuth && (
            <div className={styles.legacyAuthNotice}>
              检测到 Headers 里有
              {" "}
              <code>
                {legacyAuth.type === "bearer"
                  ? "Authorization: Bearer …"
                  : legacyAuth.type === "x-api-key"
                    ? "x-api-key: …"
                    : `${legacyAuth.headerName}: …`}
              </code>
              ，建议改用 Token 字段。
              <button
                type="button"
                className="btnGhost btnSm"
                onClick={handleMigrateLegacyAuth}
              >
                一键迁移
              </button>
            </div>
          )}
        </div>

        <div className={styles.formGroup}>
          <label>请求头（Headers）</label>
          <KVEditor
            pairs={headers}
            onChange={setHeaders}
            keyPlaceholder="x-custom-header"
            valuePlaceholder="value"
            quickKeys={["user-agent"]}
          />
        </div>

        <div className={styles.formGroup}>
          <label>Body 追加参数</label>
          <KVEditor
            pairs={bodyParams}
            onChange={setBodyParams}
            keyPlaceholder="model"
            valuePlaceholder="gpt-4o"
            quickKeys={["model"]}
          />
          <p className={styles.formHint}>
            值支持 JSON 格式（如 true、123、"字符串"）
          </p>
        </div>

        <div className={styles.formGroup}>
          <label>ANTHROPIC_MODEL（Claude Code 接入时同步写入）</label>
          <input
            type="text"
            value={anthropicModel}
            onChange={(e) => setAnthropicModel(e.target.value)}
            placeholder="claude-sonnet-4-6"
          />
          <p className={styles.formHint}>
            接入 Claude Code 时会将该值写入 ~/.claude/settings.json 的 ANTHROPIC_MODEL 字段
          </p>
        </div>

        <div className={styles.modalFooter}>
          <button className="btnGhost" onClick={onCancel}>
            取消
          </button>
          <button
            className="btnPrimary"
            onClick={handleSave}
            disabled={!name.trim() || !url.trim()}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

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
  const [revealMap, setRevealMap] = useState<Record<number, boolean>>({});
  const existingKeys = new Set(pairs.map((p) => p.key.trim().toLowerCase()));

  const handleQuickAdd = (key: string) => {
    const emptyIndex = pairs.findIndex((p) => !p.key.trim());
    if (emptyIndex >= 0) {
      onChange(pairs.map((p, i) => (i === emptyIndex ? { ...p, key } : p)));
    } else {
      onChange([...pairs, { key, value: "" }]);
    }
  };

  const availableQuickKeys = quickKeys?.filter(
    (k) => !existingKeys.has(k.toLowerCase()),
  );

  return (
    <>
      {availableQuickKeys && availableQuickKeys.length > 0 && (
        <div className={styles.quickKeys}>
          {availableQuickKeys.map((key) => (
            <button
              key={key}
              className={styles.quickKeyBtn}
              onClick={() => handleQuickAdd(key)}
            >
              + {key}
            </button>
          ))}
        </div>
      )}
      <div className={styles.kvList}>
        {pairs.map((pair, idx) => {
          const isSensitive = SENSITIVE_KEY_PATTERN.test(pair.key.trim());
          const revealed = !!revealMap[idx];
          return (
            <div key={idx} className={styles.kvRow}>
              <input
                type="text"
                value={pair.key}
                placeholder={keyPlaceholder}
                onChange={(e) =>
                  onChange(
                    pairs.map((p, i) =>
                      i === idx ? { ...p, key: e.target.value } : p,
                    ),
                  )
                }
              />
              <input
                type={isSensitive && !revealed ? "password" : "text"}
                value={pair.value}
                placeholder={valuePlaceholder}
                autoComplete="off"
                onChange={(e) =>
                  onChange(
                    pairs.map((p, i) =>
                      i === idx ? { ...p, value: e.target.value } : p,
                    ),
                  )
                }
              />
              {isSensitive && (
                <button
                  type="button"
                  className="btnGhost btnSm"
                  onClick={() =>
                    setRevealMap((m) => ({ ...m, [idx]: !m[idx] }))
                  }
                  title={revealed ? "隐藏" : "显示"}
                >
                  {revealed ? "隐藏" : "显示"}
                </button>
              )}
              <button
                className="btnGhost btnSm"
                onClick={() => onChange(pairs.filter((_, i) => i !== idx))}
              >
                ✕{" "}
              </button>
            </div>
          );
        })}
      </div>
      <button
        className="btnGhost btnSm"
        onClick={() => onChange([...pairs, { key: "", value: "" }])}
      >
        + 添加
      </button>
    </>
  );
};

export default TargetForm;
