"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { GitPullRequest, ArrowRight, ShieldCheck } from "lucide-react";
import { useAuth } from "../lib/auth";
import { fetchAuthConfig } from "../lib/api";

declare global {
  interface Window {
    google: any;
  }
}

export default function LandingPage() {
  const router = useRouter();
  const { user, login, signup, loginWithGoogle, loading } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) {
      router.replace("/dashboard");
    }
  }, [user, loading, router]);

  useEffect(() => {
    fetchAuthConfig()
      .then((cfg) => {
        setGoogleClientId(cfg.googleClientId);
      })
      .catch(() => {});
  }, []);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !agreedToTerms) return;
    setSubmitting(true);
    setError(null);
    try {
      if (isSignUp) {
        await signup(email, password);
      } else {
        await login(email, password);
      }
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = () => {
    if (!googleClientId) {
      setError("Google Sign-In is not configured. Please set GOOGLE_CLIENT_ID in the .env file.");
      return;
    }
    const redirectUri = `${window.location.origin}/api/auth/callback/google`;
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${googleClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile`;
    window.location.href = url;
  };

  const handleDashboardRedirect = () => {
    router.push("/dashboard");
  };

  if (loading || user) {
    return null;
  }

  return (
    <div className="landing-root">
      <header className="landing-header">
        <div className="brand"><ShieldCheck size={20} />CodeReviewAI</div>
      </header>

      <section className="landing-hero" id="hero">
        <div className="hero-visual">
          <div className="hero-logo-mark">✱</div>
          <svg
            style={{
              position: "absolute",
              top: -1,
              left: -1,
              right: -1,
              bottom: -1,
              width: "calc(100% + 2px)",
              height: "calc(100% + 2px)",
              opacity: 0.75,
              zIndex: 1,
              pointerEvents: "none"
            }}
            viewBox="0 0 800 600"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#030c05" />
                <stop offset="100%" stopColor="#0c2314" />
              </linearGradient>
              <filter id="motionBlur" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="40" />
              </filter>
            </defs>
            <rect width="800" height="600" fill="url(#bgGrad)" />
            <g className="animated-streaks" filter="url(#motionBlur)">
              <path d="M 950 -50 L 250 750" stroke="#081c10" strokeWidth="240" opacity="0.9" strokeLinecap="round" />
              <path d="M 800 -200 L 150 700" stroke="#1b4332" strokeWidth="180" opacity="0.7" strokeLinecap="round" />
              <path d="M 1150 50 L 350 850" stroke="#030c05" strokeWidth="300" opacity="0.95" strokeLinecap="round" />
              <path d="M 750 -100 L 400 600" stroke="#52b788" strokeWidth="100" opacity="0.55" strokeLinecap="round" />
              <path d="M 850 100 L 500 800" stroke="#74c69d" strokeWidth="50" opacity="0.45" strokeLinecap="round" />
              <path d="M 650 -180 L 200 550" stroke="#d8f3dc" strokeWidth="20" opacity="0.35" strokeLinecap="round" />
              <path d="M 720 -50 L 380 620" stroke="#ffffff" strokeWidth="6" opacity="0.5" strokeLinecap="round" />
              <path d="M 1000 200 L 500 800" stroke="#2d6a4f" strokeWidth="140" opacity="0.4" strokeLinecap="round" />
              <path d="M 550 -250 L 150 550" stroke="#1b4332" strokeWidth="110" opacity="0.5" strokeLinecap="round" />
              <path d="M 600 -80 L 100 520" stroke="#ffffff" strokeWidth="8" opacity="0.4" strokeLinecap="round" />
              <path d="M 900 0 L 400 750" stroke="#52b788" strokeWidth="75" opacity="0.3" strokeLinecap="round" />
            </g>
            <g className="animated-streaks">
              <path d="M 900 -50 L 400 700" stroke="#ffffff" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
              <path d="M 800 -100 L 300 650" stroke="#74c69d" strokeWidth="4" opacity="0.2" strokeLinecap="round" />
              <path d="M 1100 150 L 600 900" stroke="#1b4332" strokeWidth="32" opacity="0.35" strokeLinecap="round" />
              <path d="M 750 -150 L 250 600" stroke="#52b788" strokeWidth="12" opacity="0.15" strokeLinecap="round" />
              <path d="M 650 -50 L 150 700" stroke="#ffffff" strokeWidth="1.5" opacity="0.3" strokeLinecap="round" />
              <path d="M 1000 50 L 500 800" stroke="#2d6a4f" strokeWidth="18" opacity="0.2" strokeLinecap="round" />
              <path d="M 700 -200 L 200 550" stroke="#d8f3dc" strokeWidth="1" opacity="0.4" strokeLinecap="round" />
              <path d="M 850 100 L 350 850" stroke="#ffffff" strokeWidth="6" opacity="0.15" strokeLinecap="round" />
              <path d="M 550 -250 L 50 500" stroke="#52b788" strokeWidth="24" opacity="0.12" strokeLinecap="round" />
            </g>
          </svg>
          <div className="hero-text-overlay">
            <h1 className="hero-overlay-title">Catch what humans miss.</h1>
          </div>
        </div>

        <div className="hero-panel">
          <div className="panel-content">
            <h2 className="panel-title">
              {isSignUp ? "Create your account" : "Sign in to CodeReviewAI"}
            </h2>
            {isSignUp && (
              <p className="panel-desc">
                Sign up to track agent runs, inspect security issues, and audit review queue load.
              </p>
            )}

            {error && <div className="auth-error-banner">{error}</div>}

            <form className="auth-panel-form" onSubmit={handleAuthSubmit}>
              <label className="auth-input-wrapper">
                <input
                  type="email"
                  required
                  placeholder="Email address"
                  className="auth-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              
              <label className="auth-input-wrapper">
                <input
                  type="password"
                  required
                  placeholder="Password"
                  className="auth-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>

              <label className="auth-checkbox-wrapper">
                <input
                  type="checkbox"
                  required
                  className="auth-checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                />
                <span className="checkbox-text">
                  I agree to the terms of service and codebase processing privacy policy.
                </span>
              </label>

              <button type="submit" className="primary-auth-btn" disabled={submitting || !agreedToTerms}>
                {isSignUp ? "Sign Up" : "Sign In"}
              </button>
            </form>

            <div className="auth-toggle-row">
              {isSignUp ? "Already have an account? " : "Don't have an account? "}
              <button
                type="button"
                className="auth-toggle-btn"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError(null);
                }}
              >
                {isSignUp ? "Sign In" : "Sign Up"}
              </button>
            </div>

            <div className="panel-divider">
              <span>or</span>
            </div>

            <button
              type="button"
              className="google-auth-btn"
              onClick={handleGoogleLogin}
              disabled={submitting}
            >
              <svg className="google-icon" viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
              </svg>
              Continue with Google
            </button>


            <div className="hero-footer-hint">
              <a href="#how-it-works" className="scroll-hint-link">See how it works ↓</a>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section light-bg" id="how-it-works">
        <div className="section-container">
          <div className="section-title-area">
            <span className="section-eyebrow">Pipeline Architecture</span>
            <h2 className="section-heading">How multi-agent review works</h2>
            <p className="section-description">From pull request trigger to interactive summary comment, CodeReviewAI processes changes in parallel.</p>
          </div>

          <div className="flow-diagram">
            <div className="flow-step">
              <div className="step-number">01</div>
              <h4 className="step-title">Webhook Trigger</h4>
              <p className="step-desc">GitHub webhooks notify the Express queue worker of new commits and PR changes.</p>
            </div>
            <div className="flow-divider">→</div>
            <div className="flow-step">
              <div className="step-number">02</div>
              <h4 className="step-title">Supervisor Routing</h4>
              <p className="step-desc">LangGraph supervisor analyzes files to plan routing actions.</p>
            </div>
            <div className="flow-divider">→</div>
            <div className="flow-step">
              <div className="step-number">03</div>
              <h4 className="step-title">Parallel Analysis</h4>
              <p className="step-desc">Security, performance, and style agents inspect the diff concurrently.</p>
            </div>
            <div className="flow-divider">→</div>
            <div className="flow-step">
              <div className="step-number">04</div>
              <h4 className="step-title">Hybrid RAG Retrieval</h4>
              <p className="step-desc">BM25 and dense embeddings retrieve context chunks to prevent hallucinations.</p>
            </div>
            <div className="flow-divider">→</div>
            <div className="flow-step">
              <div className="step-number">05</div>
              <h4 className="step-title">PR Summary Posted</h4>
              <p className="step-desc">Aggregated findings, severity alerts, and explainable risk scores write back to the PR.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section dark-bg" id="features">
        <div className="section-container">
          <div className="section-title-area">
            <span className="section-eyebrow">Engine Features</span>
            <h2 className="section-heading">Built for depth and reliability</h2>
            <p className="section-description">CodeReviewAI uses a specialized architecture that goes beyond simple static analysis to understand intent.</p>
          </div>

          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">RAG</div>
              <h3 className="feature-title">Hybrid retrieval (RAG)</h3>
              <p className="feature-text">Dense embeddings and keyword queries query the vector store, reranked for exact codebase grounding.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">NODE</div>
              <h3 className="feature-title">LangGraph supervisor</h3>
              <p className="feature-text">Orchestrates parallel agent dispatches based on scope, keeping feedback targeted and prompt.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">QUEUE</div>
              <h3 className="feature-title">Async worker queue</h3>
              <p className="feature-text">BullMQ schedules and executes reviews off the HTTP path so API and CI threads never block.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">RISK</div>
              <h3 className="feature-title">Rubric-based scoring</h3>
              <p className="feature-text">Calculates PR risk scores out of 100 based on open severity metrics for absolute transparency.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">GITHUB</div>
              <h3 className="feature-title">Native GitHub App</h3>
              <p className="feature-text">Deep-links dashboard connect screens directly to authorized repository installation workflows.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">AUDIT</div>
              <h3 className="feature-title">Postgres audit log</h3>
              <p className="feature-text">All review cycles, timelines, durations, and LLM token usage details store in Neon Postgres.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section light-bg" id="preview">
        <div className="section-container">
          <div className="section-title-area">
            <span className="section-eyebrow">Product Preview</span>
            <h2 className="section-heading">The developer dashboard</h2>
            <p className="section-description">Track recent agent performance, inspect code findings, view queue load, and manage connected repositories.</p>
          </div>

          <div className="preview-container">
            <div className="preview-metrics">
              <div className="metric">
                <div className="metric-label">Reviews</div>
                <div className="metric-value-row">
                  <div className="metric-value">42</div>
                  <span className="metric-trend" style={{ color: "var(--green)" }}>▲ +8 today</span>
                </div>
              </div>
              <div className="metric">
                <div className="metric-label">Findings</div>
                <div className="metric-value-row">
                  <div className="metric-value">128</div>
                  <span className="metric-trend" style={{ color: "var(--green)" }}>▲ +24 today</span>
                </div>
              </div>
              <div className="metric">
                <div className="metric-label">High risk</div>
                <div className="metric-value-row">
                  <div className="metric-value">14</div>
                  <span className="metric-trend" style={{ color: "var(--green)" }}>▲ +2 today</span>
                </div>
              </div>
              <div className="metric">
                <div className="metric-label">Latest risk</div>
                <div className="metric-value-row">
                  <div className="metric-value">84.5</div>
                  <span className="metric-trend" style={{ color: "var(--red)" }}>▲ +12.3</span>
                </div>
              </div>
            </div>
            
            <div className="preview-window">
              <div className="preview-window-header">
                <div className="preview-window-dots">
                  <span className="window-dot" />
                  <span className="window-dot" />
                  <span className="window-dot" />
                </div>
                <div className="preview-window-title">codereview.ai/dashboard</div>
              </div>
              <div className="preview-window-content">
                <div className="preview-row">
                  <span className="badge">completed</span>
                  <div>
                    <strong>facebook/react #28442</strong>
                    <div className="findings">Refactored scheduler scheduling loop performance.</div>
                  </div>
                  <div>12 findings</div>
                  <div>risk score 25</div>
                </div>
                <div className="preview-row">
                  <span className="badge failed">failed</span>
                  <div>
                    <strong>vercel/next.js #64811</strong>
                    <div className="findings">Add custom middleware runtime handler context.</div>
                  </div>
                  <div>0 findings</div>
                  <div>failed connection</div>
                </div>
                <div className="preview-row">
                  <span className="badge running">running</span>
                  <div>
                    <strong>langchain-ai/langgraph #1042</strong>
                    <div className="findings">Parallel supervisor loop routing implementation.</div>
                  </div>
                  <div>-</div>
                  <div>-</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section final-cta" id="cta">
        <div className="section-container">
          <div className="cta-box">
            <h2 className="cta-title">Bugs don't take coffee breaks.<br />Upgrade your review process today</h2>
            <p className="cta-desc">Integrate parallel, context-grounded agent reviews directly into your pull requests. Set up in less than 5 minutes.</p>
            <div className="cta-action-group">
              <a className="primary-github-btn text-lg" href="https://github.com/apps/codereviewai/installations/new">
                <GitPullRequest size={20} />Install GitHub App
              </a>
              <button className="cta-secondary-btn" onClick={handleDashboardRedirect}>
                Open Dashboard →
              </button>
            </div>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="footer-container">
          <div className="footer-brand">
            <div className="brand"><ShieldCheck size={18} />CodeReviewAI</div>
            <p className="muted text-xs">Multi-agent async pull request reviewer.</p>
          </div>
          <div className="footer-links">
            <a href="https://github.com/karteeksai1/CodeReviewAI" className="footer-link">GitHub Repository</a>
            <a href="#how-it-works" className="footer-link">How it Works</a>
            <a href="#features" className="footer-link">Features</a>
            <a href="#hero" className="footer-link">Sign In</a>
          </div>
          <div className="footer-copy">
            &copy; 2026 CodeReviewAI. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
