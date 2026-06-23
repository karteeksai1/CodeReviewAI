import { config } from "../config.js";

export async function requestAgentReview(context, requestId) {
  const response = await fetch(`${config.agentUrl.replace(/\/$/, "")}/review`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(requestId ? { "x-request-id": requestId } : {})
    },
    body: JSON.stringify(context)
  });
  if (!response.ok) throw new Error(`Agent review failed (${response.status}): ${await response.text()}`);
  return response.json();
}
