"use client";

/** Last-resort error page (the root layout itself failed). Self-contained: its own <html>, no app CSS. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ margin: 0, fontFamily: "IBM Plex Sans Arabic, Tahoma, Arial, sans-serif", background: "#F3F6F4", color: "#0C211C" }}>
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 32, maxWidth: 420, width: "100%", textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>تعذر تحميل دارك</h2>
            <p style={{ marginTop: 8, fontSize: 14, color: "#405A51" }}>حدث خطأ غير متوقع. حاول مرة أخرى بعد لحظات.</p>
            {error.digest && <p style={{ fontSize: 11, color: "#8FA099", direction: "ltr" }}>ref: {error.digest}</p>}
            <button type="button" onClick={reset} style={{ marginTop: 16, background: "#123C32", color: "#fff", border: 0, borderRadius: 10, padding: "10px 18px", fontSize: 14, cursor: "pointer" }}>
              حاول مرة أخرى
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
