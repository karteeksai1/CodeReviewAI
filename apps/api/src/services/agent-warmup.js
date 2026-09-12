import { config } from "../config.js";


export async function ensureAgentReady(onProgress) {
  if (!config.agentUrl) {
    return;
  }

  const normalizedAgentUrl = config.agentUrl.replace(/\/$/, "");
  console.log(`[agent-warmup] readiness check: GET ${normalizedAgentUrl}/health`);

  try {
    const response = await fetch(`${normalizedAgentUrl}/health`, {
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      console.log(`[agent-warmup] agent ready`);
      return;
    }
    throw new Error(`Agent service responded with status ${response.status}`);
  } catch (err) {
    console.log(`[agent-warmup] readiness check failed: ${err.message}`);
    throw new Error(`Agent service is not available: ${err.message}`);
  }
}
