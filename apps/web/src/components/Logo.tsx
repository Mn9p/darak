export function LogoMark({ size = 32, inverse = false, className = "" }: { size?: number; inverse?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-label="شعار دارك" className={className}>
      <path
        d="M23 99V51C23 29 39 16 60 16h37v20H62c-11 0-19 7-19 18v25h24c10 0 17-6 17-16V53h20v13c0 22-14 33-36 33H23Z"
        fill={inverse ? "#FFFFFF" : "#123C32"}
      />
      <path d="M43 79h24c10 0 17-6 17-16V53h-17v9c0 3-2 5-5 5H43v12Z" fill="#C8A66A" />
    </svg>
  );
}

export function Logo({ inverse = false, size = 30, wordmark = true }: { inverse?: boolean; size?: number; wordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} inverse={inverse} />
      {wordmark && (
        <b style={{ fontSize: size * 0.75, letterSpacing: "-0.5px", color: inverse ? "#fff" : "#0C211C", lineHeight: 1 }}>دارك</b>
      )}
    </span>
  );
}
