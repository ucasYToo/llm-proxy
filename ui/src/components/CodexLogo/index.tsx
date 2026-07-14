interface CodexLogoProps {
  size?: number;
  className?: string;
}

/** A compact, code-native mark used only by the Codex dashboard. */
export function CodexLogo({ size = 32, className }: CodexLogoProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
    >
      <rect width="48" height="48" rx="13" fill="currentColor" />
      <path
        d="M16.2 13.5h15.6l7.8 10.5-7.8 10.5H16.2L8.4 24l7.8-10.5Z"
        stroke="white"
        strokeWidth="2.4"
        strokeLinejoin="round"
        opacity=".92"
      />
      <path
        d="m17.2 19.1 4.9 4.9-4.9 4.9M24.7 29h6.1"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="35.7" cy="14.9" r="2.7" fill="#A7F3D0" />
    </svg>
  );
}
