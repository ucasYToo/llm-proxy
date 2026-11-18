import { useEffect, useRef, useState } from "react";

export function LogIdButton({ id }: { id: string }) {
  const [feedback, setFeedback] = useState("");
  const label = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(id);
      if (!label.current) return;
      setFeedback("已复制");
      timer.current = setTimeout(() => setFeedback(""), 1500);
    } catch {
      if (!label.current) return;
      const range = document.createRange();
      range.selectNodeContents(label.current);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      setFeedback("请手动复制");
    }
  };
  return (
    <button
      type="button"
      className="btnGhost btnSm"
      title={id}
      aria-label={"复制日志 ID " + id}
      style={{
        minWidth: 0,
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
      }}
      onClick={copy}
    >
      {feedback || "ID"} <span ref={label}>{id}</span>
    </button>
  );
}
