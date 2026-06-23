"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GitPullRequest, ArrowRight, ShieldCheck } from "lucide-react";

export default function LandingPage() {
  const router = useRouter();
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistAgreed, setWaitlistAgreed] = useState(false);
  const [waitlistSuccess, setWaitlistSuccess] = useState(false);

  const handleWaitlistSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!waitlistEmail || !waitlistAgreed) return;
    setWaitlistSuccess(true);
  };

  const handleDashboardRedirect = () => {
    router.push("/dashboard");
  };

  return (
    <div className="landing-root">
      <header className="landing-header">
        <div className="brand"><ShieldCheck size={20} />CodeReviewAI</div>
        <button className="signin-link" onClick={handleDashboardRedirect}>
          Sign in to Dashboard →
        </button>
      </header>

      <section className="landing-hero" id="hero">
        <div className="hero-visual">
          <div className="hero-logo-mark">✱</div>
          <svg className="hero-svg" viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="forest-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#070c08" />
                <stop offset="50%" stopColor="#0f2319" />
                <stop offset="100%" stopColor="#030504" />
              </linearGradient>
              <linearGradient id="line-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#1b4332" stopOpacity="0" />
                <stop offset="50%" stopColor="#52b788" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#1b4332" stopOpacity="0" />
              </linearGradient>
            </defs>
            <rect width="800" height="600" fill="url(#forest-grad)" />
            <path d="M-100 150 C 200 300, 400 100, 900 250" fill="none" stroke="url(#line-grad)" strokeWidth="3" />
            <path d="M-100 250 C 300 100, 500 450, 900 350" fill="none" stroke="url(#line-grad)" strokeWidth="2" strokeDasharray="10, 5" />
            <path d="M-100 350 C 150 450, 600 150, 900 450" fill="none" stroke="url(#line-grad)" strokeWidth="4" />
            <circle cx="200" cy="200" r="6" fill="#1b4332" stroke="#52b788" strokeWidth="2" />
            <circle cx="450" cy="180" r="8" fill="#1b4332" stroke="#52b788" strokeWidth="2" />
            <circle cx="350" cy="380" r="6" fill="#1b4332" stroke="#52b788" strokeWidth="2" />
            <circle cx="600" cy="320" r="10" fill="#1b4332" stroke="#52b788" strokeWidth="2" />
            <line x1="200" y1="200" x2="450" y2="180" stroke="#1b4332" strokeWidth="1.5" strokeDasharray="5, 5" />
            <line x1="350" y1="380" x2="450" y2="180" stroke="#1b4332" strokeWidth="1.5" />
            <line x1="450" y1="180" x2="600" y2="320" stroke="#1b4332" strokeWidth="1.5" />
          </svg>
          <div className="hero-text-overlay">
            <h1 className="hero-overlay-title">Catch what humans miss in pull requests.</h1>
            <p className="hero-overlay-sub">Speed, depth, and parallel multi-agent codebase review.</p>
          </div>
        </div>

        <div className="hero-panel">
          <div className="panel-content">
            <h2 className="panel-title">Connect your repo</h2>
            <p className="panel-desc">Install the CodeReviewAI GitHub App to begin receiving automated, context-aware PR review comments instantly.</p>
            
            <a className="primary-github-btn" href="https://github.com/apps/codereviewai/installations/new">
              <GitPullRequest size={18} />Install GitHub App
            </a>

            <div className="panel-divider">
              <span>or join the waitlist</span>
            </div>

            {waitlistSuccess ? (
              <div className="waitlist-success-banner">
                <h3>You are on the list.</h3>
                <p>We will notify you as soon as new multi-agent review slots open up.</p>
              </div>
            ) : (
              <form className="waitlist-form" onSubmit={handleWaitlistSubmit}>
                <label className="waitlist-input-wrapper">
                  <input
                    type="email"
                    required
                    placeholder="Enter your email address"
                    className="waitlist-input"
                    value={waitlistEmail}
                    onChange={(e) => setWaitlistEmail(e.target.value)}
                  />
                </label>
                <label className="waitlist-checkbox-wrapper">
                  <input
                    type="checkbox"
                    required
                    className="waitlist-checkbox"
                    checked={waitlistAgreed}
                    onChange={(e) => setWaitlistAgreed(e.target.checked)}
                  />
                  <span className="checkbox-text">I agree to receive codebase updates and analytics notifications.</span>
                </label>
                <div className="form-action-row">
                  <button type="submit" className="waitlist-arrow-btn" disabled={!waitlistAgreed}>
                    Request access <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            )}

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
            <h2 className="cta-title">Upgrade your review process today</h2>
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
            <a href="https://github.com/karteeksai/CodeReviewAI" className="footer-link">GitHub Repository</a>
            <a href="#how-it-works" className="footer-link">How it Works</a>
            <a href="#features" className="footer-link">Features</a>
            <a href="/login" className="footer-link">Sign In</a>
          </div>
          <div className="footer-copy">
            &copy; 2026 CodeReviewAI. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
