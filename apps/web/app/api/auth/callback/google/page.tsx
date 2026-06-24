"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../../../lib/auth";

export default function GoogleCallbackPage() {
  const router = useRouter();
  const { loginWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) {
      setError("No authorization code provided from Google");
      return;
    }

    loginWithGoogle(code)
      .then(() => {
        router.replace("/dashboard");
      })
      .catch((err: any) => {
        setError(err instanceof Error ? err.message : "Authentication failed");
      });
  }, [loginWithGoogle, router]);

  return (
    <main className="login-shell" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#070c08", color: "#ffffff" }}>
      {error ? (
        <div style={{ textAlign: "center", padding: "20px" }}>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: "24px", color: "var(--red)", marginBottom: "16px" }}>Authentication Error</h2>
          <p style={{ color: "#b8d2c4", marginBottom: "24px" }}>{error}</p>
          <button
            onClick={() => router.replace("/")}
            style={{
              background: "#1b4332",
              color: "#ffffff",
              border: "1px solid #2d6a4f",
              padding: "8px 16px",
              borderRadius: "6px",
              cursor: "pointer"
            }}
          >
            Return to Sign In
          </button>
        </div>
      ) : (
        <div style={{ textAlign: "center" }}>
          <div className="skeleton-loader" style={{ width: "80px", height: "80px", borderRadius: "50%", margin: "0 auto 24px" }} />
          <p style={{ color: "#b8d2c4" }}>Verifying your Google identity...</p>
        </div>
      )}
    </main>
  );
}
