import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";

/**
 * Configuration schema for the Character Recognition (OCR) engine.
 */
export interface OcrConfig {
  /** OCR pipeline mode ('cloud_vision' or 'llm_multimodal') */
  mode: string;
  /** Google Cloud Vision API Key */
  api_key: string;
  /** Primary target language code (e.g. 'ja', 'en') */
  target_language: string;
}

/**
 * Configuration schema for the Large Language Model provider.
 */
export interface LlmConfig {
  /** Targeted provider engine (e.g., 'ollama', 'gemini', 'openai') */
  provider: string;
  /** API key for cloud models (Gemini/OpenAI) */
  cloud_api_key: string;
  /** Targeted endpoint connection URL */
  endpoint_url: string;
  /** Model identifier name (e.g., 'llama3', 'gpt-4o') */
  model: string;
  /** Custom instructions prompt for Japanese tutoring analysis */
  system_prompt: string;
}

/**
 * Defines a single message turn in a conversational history.
 */
export interface ChatMessage {
  /** The author of the message ('user' or 'assistant') */
  role: "user" | "assistant";
  /** The text content of the message */
  content: string;
}

/**
 * Performs Optical Character Recognition on a base64-encoded PNG image using Google Cloud Vision API.
 * 
 * @param base64Image - The raw screenshot image data as base64.
 * @param config - OCR configuration options containing the API key and target language.
 * @returns The extracted text description.
 * @throws Error if the key is missing or the vision request fails.
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
 * Sends a query (including conversation history) to the configured LLM provider and streams the result.
 *
 * @param messages - An array of ChatMessage turns representing the conversation history.
 * @param base64Image - Optional base64-encoded PNG screenshot (sent only on the first turn if OCR failed/bypassed).
 * @param config - Large Language Model provider settings.
 * @param onChunk - Callback triggered whenever a new text chunk is streamed back from the model.
 * @returns A promise resolving to the fully concatenated response string.
 */
export async function performLlmQuery(
  messages: ChatMessage[],
  base64Image: string | null,
  config: LlmConfig,
  onChunk: (chunk: string) => void
): Promise<string> {
  const provider = config.provider.toLowerCase();

  if (provider === "ollama") {
    return streamOllama(messages, base64Image, config, onChunk);
  } else if (provider === "gemini") {
    return streamGemini(messages, base64Image, config, onChunk);
  } else if (provider === "openai" || provider === "custom" || provider === "deepseek") {
    return streamOpenAICompatible(messages, base64Image, config, onChunk);
  } else {
    throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }
}

/**
 * Helper to query Ollama's /api/chat streaming endpoint.
 */
async function streamOllama(
  messages: ChatMessage[],
  base64Image: string | null,
  config: LlmConfig,
  onChunk: (chunk: string) => void
): Promise<string> {
  const baseUrl = config.endpoint_url || "http://localhost:11434";
  const url = `${baseUrl}/api/chat`;

  const mappedMessages = messages.map((msg, idx) => {
    const item: any = {
      role: msg.role,
      content: msg.content,
    };
    if (idx === 0 && base64Image) {
      const base64Data = base64Image.split(",")[1] || base64Image;
      item.images = [base64Data];
    }
    return item;
  });

  if (config.system_prompt) {
    mappedMessages.unshift({
      role: "system",
      content: config.system_prompt,
    });
  }

  const bodyPayload = {
    model: config.model || "llama3",
    messages: mappedMessages,
    stream: true,
  };

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
          const content = json.message?.content;
          if (content) {
            onChunk(content);
            fullText += content;
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
 * Extracts individual brace-balanced JSON objects from a stream buffer chunk.
 * Used to parse fragmented streaming payloads from Google Gemini and OpenAI.
 *
 * @param buffer - The raw concatenated JSON stream characters.
 * @returns An object containing array of parsed JSON objects and the remaining unparsed buffer.
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
 * Helper to query Google Gemini's streamGenerateContent endpoint.
 */
async function streamGemini(
  messages: ChatMessage[],
  base64Image: string | null,
  config: LlmConfig,
  onChunk: (chunk: string) => void
): Promise<string> {
  if (!config.cloud_api_key) {
    throw new Error("Gemini API key is missing. Please set it in Settings.");
  }

  const model = config.model || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${config.cloud_api_key}`;

  const contents: any[] = [];

  messages.forEach((msg, idx) => {
    const role = msg.role === "assistant" ? "model" : "user";
    const parts: any[] = [];

    if (idx === 0 && base64Image) {
      const base64Data = base64Image.split(",")[1] || base64Image;
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: base64Data,
        },
      });
    }

    parts.push({ text: msg.content });
    contents.push({ role, parts });
  });

  const bodyPayload: any = {
    contents,
  };

  if (config.system_prompt) {
    bodyPayload.systemInstruction = {
      parts: [{ text: config.system_prompt }],
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyPayload),
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
 * Helper to query OpenAI-compatible Chat Completions API streaming endpoint.
 */
async function streamOpenAICompatible(
  messages: ChatMessage[],
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

  const mappedMessages: any[] = [];

  if (config.system_prompt) {
    mappedMessages.push({ role: "system", content: config.system_prompt });
  }

  messages.forEach((msg, idx) => {
    if (idx === 0 && base64Image) {
      mappedMessages.push({
        role: "user",
        content: [
          { type: "text", text: msg.content || "Analyze this Japanese text segment." },
          {
            type: "image_url",
            image_url: {
              url: base64Image.startsWith("data:") ? base64Image : `data:image/png;base64,${base64Image}`,
            },
          },
        ],
      });
    } else {
      mappedMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }
  });

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model || (isCloudOpenAI ? "gpt-4o" : "llama3"),
      messages: mappedMessages,
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

/**
 * Queries the selected LLM provider API in the background to fetch all active available models.
 * If the request fails, returns standard fallback model names for that provider.
 *
 * @param config - The active LLM configuration parameters.
 * @returns A promise resolving to an array of model identifier strings.
 */
export async function fetchAvailableModels(config: LlmConfig): Promise<string[]> {
  const provider = config.provider.toLowerCase();

  try {
    if (provider === "ollama") {
      const baseUrl = config.endpoint_url || "http://localhost:11434";
      const response = await fetch(`${baseUrl}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        if (data.models && Array.isArray(data.models)) {
          return data.models.map((m: any) => m.name);
        }
      }
    } else if (provider === "gemini") {
      if (config.cloud_api_key) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${config.cloud_api_key}`
        );
        if (response.ok) {
          const data = await response.json();
          if (data.models && Array.isArray(data.models)) {
            // Filter only models that support content generation and strip the "models/" prefix
            return data.models
              .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
              .map((m: any) => m.name.replace(/^models\//, ""));
          }
        }
      }
    } else if (provider === "openai") {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config.cloud_api_key) {
        headers["Authorization"] = `Bearer ${config.cloud_api_key}`;
      }
      const response = await fetch("https://api.openai.com/v1/models", { headers });
      if (response.ok) {
        const data = await response.json();
        if (data.data && Array.isArray(data.data)) {
          return data.data.map((m: any) => m.id);
        }
      }
    } else if (provider === "custom" || provider === "deepseek") {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config.cloud_api_key) {
        headers["Authorization"] = `Bearer ${config.cloud_api_key}`;
      }
      let baseUrl = (config.endpoint_url || "").trim().replace(/\/+$/, "");
      if (!baseUrl) return [];
      
      let url = "";
      if (baseUrl.endsWith("/v1/models") || baseUrl.endsWith("/models")) {
        url = baseUrl;
      } else if (baseUrl.endsWith("/v1")) {
        url = `${baseUrl}/models`;
      } else {
        url = `${baseUrl}/v1/models`;
      }
      
      const response = await fetch(url, { headers });
      if (response.ok) {
        const data = await response.json();
        if (data.data && Array.isArray(data.data)) {
          return data.data.map((m: any) => m.id);
        }
      }
    }
  } catch (e) {
    // Fail silently to return fallbacks
  }

  // Fallback lists if API requests fail or are unauthenticated/offline
  if (provider === "ollama") {
    return ["llama3", "llama3.1", "mistral", "phi3", "gemma2", "qwen2"];
  } else if (provider === "gemini") {
    return ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-1.0-pro"];
  } else if (provider === "openai") {
    return ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"];
  } else if (provider === "deepseek") {
    return ["deepseek-chat", "deepseek-coder"];
  }
  return [];
}
