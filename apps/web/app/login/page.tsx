"use client";

import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useAuth } from "../../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { login, user, loading } = useAuth();
  const [email, setEmail] = useState("admin@codereviewai.local");
  const [password, setPassword] = useState("changeme");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) {
    router.replace("/dashboard");
    return null;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand login-brand"><ShieldCheck size={24} />CodeReviewAI</div>
        <h1 className="login-title">Sign in</h1>
        <p className="login-subtitle">Use your dashboard credentials to fetch review data from the API.</p>
        <form className="login-form" onSubmit={onSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <p className="login-error">{error}</p> : null}
          <button type="submit" disabled={submitting || loading}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
