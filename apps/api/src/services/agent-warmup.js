import { config } from "../config.js";

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureAgentReady(onProgress) {
  if (!config.agentUrl) {
    return;
  }
  const delays = [3000, 5000, 10000];
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${config.agentUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        return;
      }
    } catch (err) {
      if (attempt === 3) {
        throw new Error("Agent service is starting up, please retry in 30 seconds");
      }
    }
    if (attempt < 3) {
      if (onProgress) {
        await onProgress(`Agent service starting up... (attempt ${attempt + 1}/3)`);
      }
      await delay(delays[attempt]);
    }
  }
}
