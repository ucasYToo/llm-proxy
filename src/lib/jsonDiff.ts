export interface DiffEntry {
  path: string;
  type: "added" | "removed" | "changed";
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Shallow-ish diff between two JSON-serializable objects.
 * Recursively walks both objects and returns a flat list of differences.
 */
export function jsonDiff(
  original: unknown,
  modified: unknown,
  prefix = ""
): DiffEntry[] {
  const diffs: DiffEntry[] = [];

  if (original === modified) return diffs;

  // Both are null / undefined / primitives
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

  // Arrays
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

  // Objects
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
}

/**
 * Collect all diff paths into a Set for quick lookup.
 */
export function getDiffPaths(
  original: unknown,
  modified: unknown
): Set<string> {
  const entries = jsonDiff(original, modified);
  return new Set(entries.map((e) => e.path));
}
