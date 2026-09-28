/** Short Arabic label for a session's user-agent: "Chrome على Windows", "Safari على iPhone". */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "جهاز غير معروف";
  const os = /iPhone/i.test(ua)
    ? "iPhone"
    : /iPad/i.test(ua)
      ? "iPad"
      : /Android/i.test(ua)
        ? "Android"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/i.test(ua)
            ? "Mac"
            : /Linux/i.test(ua)
              ? "Linux"
              : null;
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\/|Opera/i.test(ua)
      ? "Opera"
      : /SamsungBrowser/i.test(ua)
        ? "Samsung Internet"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Firefox\//i.test(ua)
            ? "Firefox"
            : /Safari\//i.test(ua)
              ? "Safari"
              : null;
  if (browser && os) return `${browser} على ${os}`;
  return browser ?? os ?? "جهاز غير معروف";
}
