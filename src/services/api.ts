import { invoke } from "@tauri-apps/api/core";

// Types matching the Rust backend definitions
export interface OcrConfig {
  mode: string;
  api_key: string;
  target_language: string;
}

export interface LlmConfig {
  provider: string;
  cloud_api_key: string;
  endpoint_url: string;
  model: string;
  system_prompt: string;
}

/**
 * Perform Optical Character Recognition on a base64-encoded PNG image using Google Cloud Vision API.
 */
export async function performOcr(base64Image: string, config: OcrConfig): Promise<string> {
  if (config.mode !== "cloud_vision") {
    throw new Error(`Unsupported OCR mode: ${config.mode}`);
  }

  if (!config.api_key || config.api_key === "YOUR_VISION_API_KEY") {
    throw new Error("Google Cloud Vision API Key is missing. Please set it in Settings.");
  }

  const base64Data = base64Image.split(",")[1] || base64Image;

  const url = `https://vision.googleapis.com/v1/images:annotate?key=${config.api_key}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          image: {
            content: base64Data,
          },
          features: [
            {
              type: "TEXT_DETECTION",
            },
          ],
          imageContext: {
            languageHints: [config.target_language || "ja"],
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Cloud Vision OCR failed: ${response.statusText}. Details: ${errorText}`);
  }

  const data = await response.json();
  const textAnnotations = data.requests?.[0]?.textAnnotations;
  if (!textAnnotations || textAnnotations.length === 0) {
    throw new Error("No text detected in the image.");
  }

  // The first annotation contains the entire transcription
  return textAnnotations[0].description || "";
}

/**
 * Sends a query to the configured LLM provider and streams the result back.
 */
export async function performLlmQuery(
  prompt: string,
  base64Image: string | null,
  config: LlmConfig,
  onChunk: (chunk: string) => void
): Promise<string> {
  const provider = config.provider.toLowerCase();

  if (provider === "ollama") {
    return streamOllama(prompt, base64Image, config, onChunk);
  } else if (provider === "gemini") {
    return streamGemini(prompt, base64Image, config, onChunk);
  } else if (provider === "openai" || provider === "custom" || provider === "deepseek") {
    return streamOpenAICompatible(prompt, base64Image, config, onChunk);
  } else {
    throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }
}

/**
 * Stream helper for Ollama endpoint
 */
async function streamOllama(
  prompt: string,
  base64Image: string | null,
  config: LlmConfig,
  onChunk: (chunk: string) => void
): Promise<string> {
  const baseUrl = config.endpoint_url || "http://localhost:11434";
  const url = `${baseUrl}/api/generate`;

  const bodyPayload: any = {
    model: config.model || "llama3",
    prompt: prompt,
    system: config.system_prompt,
    stream: true,
  };

  // Add multimodal image if available
  if (base64Image) {
    const base64Data = base64Image.split(",")[1] || base64Image;
    bodyPayload.images = [base64Data];
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyPayload),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Ollama response body is not readable");
  }

  const decoder = new TextDecoder();
  let fullText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunkStr = decoder.decode(value, { stream: true });
      const lines = chunkStr.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.response) {
            onChunk(json.response);
            fullText += json.response;
          }
        } catch (_) {
          // Ignore parse errors from incomplete stream lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}


/**
 * Brace-balanced JSON streaming helper for Gemini/OpenAI
 */
export function extractTextFromJSONChunks(buffer: string): { items: any[]; remaining: string } {
  const items: any[] = [];
  let braceCount = 0;
  let inString = false;
  let escape = false;
  let startIdx = -1;

  for (let i = 0; i < buffer.length; i++) {
    const char = buffer[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "{") {
        if (braceCount === 0) {
          startIdx = i;
        }
        braceCount++;
      } else if (char === "}") {
        braceCount--;
        if (braceCount === 0 && startIdx !== -1) {
          const chunkStr = buffer.slice(startIdx, i + 1);
          try {
            const obj = JSON.parse(chunkStr);
            items.push(obj);
          } catch (_) {
            // Invalid/incomplete JSON
          }
          startIdx = -1;
        }
      }
    }
  }

  const remaining = startIdx !== -1 ? buffer.slice(startIdx) : "";
  return { items, remaining };
}

/**
 * Robust stream helper for Gemini
 */
async function streamGemini(
  prompt: string,
  base64Image: string | null,
  config: LlmConfig,
  onChunk: (chunk: string) => void
): Promise<string> {
  if (!config.cloud_api_key) {
    throw new Error("Gemini API key is missing. Please set it in Settings.");
  }

  const model = config.model || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${config.cloud_api_key}`;

  const parts: any[] = [];
  if (base64Image) {
    const base64Data = base64Image.split(",")[1] || base64Image;
    parts.push({
      inlineData: {
        mimeType: "image/png",
        data: base64Data,
      },
    });
  }

  // Combine instructions with request text
  const fullPromptText = `${config.system_prompt}\n\nInput Japanese Text / Screen Segment:\n${prompt}`;
  parts.push({ text: fullPromptText });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini failed: ${response.statusText}. Details: ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Gemini response is not readable");

  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  try {
    await invoke("write_debug_log", { log: `\n=== GEMINI STREAM STARTED FOR ${model} ===` });
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      await invoke("write_debug_log", { log: `--- RAW CHUNK RECEIVED ---\n${chunk}` });

      buffer += chunk;
      const { items, remaining } = extractTextFromJSONChunks(buffer);
      buffer = remaining;

      for (const item of items) {
        await invoke("write_debug_log", { log: `--- PARSED ITEM OBJECT ---\n${JSON.stringify(item)}` });
        const text = item.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          await invoke("write_debug_log", { log: `--- EXTRACTED TEXT CHUNK ---\n${text}` });
          onChunk(text);
          fullText += text;
        }
      }
    }
  } catch (err: any) {
    await invoke("write_debug_log", { log: `--- STREAM ITERATION ERROR ---\n${err.message || err}` });
    throw err;
  } finally {
    reader.releaseLock();
    await invoke("write_debug_log", { log: `=== GEMINI STREAM FINISHED (Full text length: ${fullText.length}) ===\n` });
  }

  return fullText;
}

/**
 * Stream helper for OpenAI-compatible endpoints
 */
async function streamOpenAICompatible(
  prompt: string,
  base64Image: string | null,
  config: LlmConfig,
  onChunk: (chunk: string) => void
): Promise<string> {
  const isCloudOpenAI = config.provider.toLowerCase() === "openai";
  const defaultEndpoint = isCloudOpenAI ? "https://api.openai.com" : "http://localhost:11434";
  let baseUrl = (config.endpoint_url || defaultEndpoint).trim().replace(/\/+$/, "");
  
  let url = "";
  if (baseUrl.endsWith("/v1/chat/completions")) {
    url = baseUrl;
  } else if (baseUrl.endsWith("/v1")) {
    url = `${baseUrl}/chat/completions`;
  } else {
    url = `${baseUrl}/v1/chat/completions`;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.cloud_api_key) {
    headers["Authorization"] = `Bearer ${config.cloud_api_key}`;
  }

  const messages: any[] = [
    { role: "system", content: config.system_prompt },
  ];

  // OpenAI Multimodal support (if image is present and using compatible model)
  if (base64Image) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: prompt || "Analyze this Japanese text segment." },
        {
          type: "image_url",
          image_url: {
            url: base64Image, // OpenAI accepts data URLs natively
          },
        },
      ],
    });
  } else {
    messages.push({ role: "user", content: prompt });
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model || (isCloudOpenAI ? "gpt-4o" : "llama3"),
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.statusText}. Details: ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("OpenAI response body is not readable");
  }

  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Save the last incomplete line

      for (const line of lines) {
        const cleanLine = line.trim();
        if (!cleanLine) continue;

        if (cleanLine.startsWith("data: ")) {
          const dataStr = cleanLine.slice(6);
          if (dataStr === "[DONE]") continue;

          try {
            const json = JSON.parse(dataStr);
            const content = json.choices?.[0]?.delta?.content || "";
            if (content) {
              onChunk(content);
              fullText += content;
            }
          } catch (_) {
            // Ignore incomplete stream lines parse errors
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}
