interface GenerateOptions {
  system: string;
  userMessage: string;
  proxyBaseUrl: string;
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

export async function generateWithLLM(options: GenerateOptions): Promise<string> {
  const { system, userMessage, proxyBaseUrl } = options;
  const url = `${proxyBaseUrl}/v1/messages`;

  const body = {
    system,
    messages: [{ role: "user", content: userMessage }],
    max_tokens: 1024,
    stream: false,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as AnthropicResponse;

  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("Unexpected response format: no text content block");
  }

  return textBlock.text.trim();
}
