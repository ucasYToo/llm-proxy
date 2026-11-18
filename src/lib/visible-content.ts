/** Strip private model content from stored payloads. The upstream wire payload is untouched. */
export function visibleContent(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(visibleContent).filter((v) => v !== undefined);
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  if (
    [
      "thinking",
      "redacted_thinking",
      "thinking_delta",
      "signature_delta",
      "reasoning",
      "reasoning_delta",
    ].includes(String(obj.type))
  )
    return undefined;
  return Object.fromEntries(
    Object.entries(obj)
      .filter(
        ([key]) =>
          !["thinking", "signature", "reasoning_content", "reasoning"].includes(
            key,
          ),
      )
      .map(([key, item]) => [key, visibleContent(item)]),
  );
}
