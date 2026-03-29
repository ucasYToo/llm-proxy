export interface DiffEntry {
  path: string;
  type: "added" | "removed" | "changed";
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * 对两个 JSON 可序列化对象进行浅层递归 diff，返回扁平的差异列表
 */
export const jsonDiff = (
  original: unknown,
  modified: unknown,
  prefix = "",
): DiffEntry[] => {
  const diffs: DiffEntry[] = [];

  if (original === modified) return diffs;

  // 两者都是 null / undefined / 原始类型
  if (
    original === null ||
    original === undefined ||
    modified === null ||
    modified === undefined ||
    typeof original !== "object" ||
    typeof modified !== "object"
  ) {
    if (original !== modified) {
      diffs.push({
        path: prefix || "(root)",
        type: "changed",
        oldValue: original,
        newValue: modified,
      });
    }
    return diffs;
  }

  // 数组
  if (Array.isArray(original) || Array.isArray(modified)) {
    const origArr = Array.isArray(original) ? original : [];
    const modArr = Array.isArray(modified) ? modified : [];
    const maxLen = Math.max(origArr.length, modArr.length);
    for (let i = 0; i < maxLen; i++) {
      const key = prefix ? `${prefix}[${i}]` : `[${i}]`;
      if (i >= origArr.length) {
        diffs.push({ path: key, type: "added", newValue: modArr[i] });
      } else if (i >= modArr.length) {
        diffs.push({ path: key, type: "removed", oldValue: origArr[i] });
      } else {
        diffs.push(...jsonDiff(origArr[i], modArr[i], key));
      }
    }
    return diffs;
  }

  // 对象
  const origObj = original as Record<string, unknown>;
  const modObj = modified as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(origObj), ...Object.keys(modObj)]);

  for (const key of allKeys) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (!(key in origObj)) {
      diffs.push({ path: fullPath, type: "added", newValue: modObj[key] });
    } else if (!(key in modObj)) {
      diffs.push({ path: fullPath, type: "removed", oldValue: origObj[key] });
    } else {
      diffs.push(...jsonDiff(origObj[key], modObj[key], fullPath));
    }
  }

  return diffs;
};

/**
 * 收集所有 diff 路径到 Set 中，用于快速查找
 */
export const getDiffPaths = (
  original: unknown,
  modified: unknown,
): Set<string> => {
  const entries = jsonDiff(original, modified);
  return new Set(entries.map((e) => e.path));
};
