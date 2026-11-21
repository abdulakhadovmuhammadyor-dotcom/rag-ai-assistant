/**
 * Google AI Studio Vector RAG Engine (zero external dependencies).
 * Docs: https://aistudio.google.com/docs/embeddings
 */

const API_KEY = process.env.GEMINI_API_KEY || '';
const EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const CHAT_MODEL =
  process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash-lite';

export interface KnowledgeChunk {
  id: string;
  title?: string;
  text: string;
  vector?: number[];
}

export interface RetrievedChunk extends KnowledgeChunk {
  similarity: number;
  similarityPercent: number;
}

export interface RagAnswer {
  answer: string;
  retrievedChunks: RetrievedChunk[];
  model: string;
  embeddingModel: string;
  toolCalls: string[];
}

export interface GeminiTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  error?: { message?: string };
}

const vectorCache = new Map<string, number[]>();

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function getEmbedding(
  text: string,
  taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' | 'SEMANTIC_SIMILARITY' = 'RETRIEVAL_DOCUMENT'
): Promise<number[]> {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not defined in .env');

  const cacheKey = `${taskType}:${text}`;
  const cached = vectorCache.get(cacheKey);
  if (cached) return cached;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Google AI Studio Embedding Error (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  const vector = data?.embedding?.values;
  if (!vector || !Array.isArray(vector)) {
    throw new Error(
      'Invalid embedding vector structure received from Google AI Studio.'
    );
  }

  vectorCache.set(cacheKey, vector);
  return vector;
}

export async function indexKnowledgeChunks<T extends KnowledgeChunk>(
  chunks: T[]
): Promise<T[]> {
  const missing = chunks.filter((c) => !c.vector);
  if (missing.length === 0) return chunks;

  const BATCH_SIZE = 10;
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (chunk) => {
        try {
          chunk.vector = await getEmbedding(chunk.text, 'RETRIEVAL_DOCUMENT');
        } catch (err) {
          console.warn(
            `[Google RAG] Failed to embed chunk ${chunk.id}:`,
            err instanceof Error ? err.message : err
          );
        }
      })
    );
  }
  return chunks;
}

export async function retrieveRelevantChunks<T extends KnowledgeChunk>(
  userQuery: string,
  chunks: T[],
  topK = 3
): Promise<(T & RetrievedChunk)[]> {
  const queryVector = await getEmbedding(userQuery, 'RETRIEVAL_QUERY');

  const scored = chunks
    .filter((c) => c.vector && Array.isArray(c.vector))
    .map((chunk) => {
      const similarity = cosineSimilarity(queryVector, chunk.vector as number[]);
      return {
        ...chunk,
        similarity,
        similarityPercent: Math.round(similarity * 100),
      };
    });

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}

export async function askGeminiWithRAG({
  userMessage,
  knowledgeBase,
  systemPrompt = 'You are a helpful assistant. Answer the user question strictly using the provided context chunks.',
  topK = 5,
  history = [],
  tools,
  onToolCall,
}: {
  userMessage: string;
  knowledgeBase: KnowledgeChunk[];
  systemPrompt?: string;
  topK?: number;
  history?: ChatHistoryItem[];
  tools?: GeminiTool[];
  onToolCall?: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<unknown>;
}): Promise<RagAnswer> {
  await indexKnowledgeChunks(knowledgeBase);

  const retrievedChunks = await retrieveRelevantChunks(
    userMessage,
    knowledgeBase,
    topK
  );

  const contextText = retrievedChunks
    .map(
      (c, i) =>
        `[Source ${i + 1}: ${c.title || c.id} (Relevance: ${c.similarityPercent}%)]\n${c.text}`
    )
    .join('\n\n---\n\n');

  const prompt = `${systemPrompt}

  --- RELEVANT KNOWLEDGE CONTEXT (RETRIEVED VIA GOOGLE VECTOR EMBEDDINGS) ---
  ${contextText}
  --------------------------------------------------------------------------

  User Question: ${userMessage}${
    tools?.length
      ? '\n\nIMPORTANT: For requests about free slots or student enrollment you MUST call the provided tools instead of answering from this context.'
      : ''
  }`;

  const contents = buildDialogueContents(history, prompt);
  let answer = 'No response generated.';
  const toolCalls: string[] = [];

  for (let round = 0; round < 4; round++) {
    const genData = await generateWithGemini(contents, tools);
    const parts = genData?.candidates?.[0]?.content?.parts ?? [];
    answer = parts
      .map((part) => part.text || '')
      .join('')
      .trim() || answer;

    const calls = parts
      .map((part) => part.functionCall)
      .filter((call): call is NonNullable<GeminiPart['functionCall']> =>
        Boolean(call)
      );
    if (calls.length === 0) break;

    contents.push({ role: 'model', parts });
    const responses: GeminiPart[] = [];
    for (const call of calls) {
      toolCalls.push(call.name);
      let result: unknown = { error: 'Tool handler is not configured.' };
      if (onToolCall) {
        try {
          result = await onToolCall(call.name, call.args ?? {});
        } catch (error) {
          result = {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      responses.push({
        functionResponse: {
          name: call.name,
          response: { result },
        },
      });
    }
    contents.push({ role: 'user', parts: responses });
  }

  return {
    answer,
    retrievedChunks,
    model: CHAT_MODEL,
    embeddingModel: EMBEDDING_MODEL,
    toolCalls,
  };
}

function buildDialogueContents(
  history: ChatHistoryItem[],
  prompt: string
): GeminiContent[] {
  const contents: GeminiContent[] = [];

  for (const item of history) {
    const content = item.content.trim();
    if (!content) continue;

    const role = item.role === 'assistant' ? 'model' : 'user';
    if (contents.length === 0 && role !== 'user') continue;
    if (contents.length === 0) {
      contents.push({ role, parts: [{ text: content }] });
      continue;
    }

    const last = contents[contents.length - 1];
    if (last.role === role) {
      last.parts.push({ text: content });
    } else {
      contents.push({ role, parts: [{ text: content }] });
    }
  }

  contents.push({ role: 'user', parts: [{ text: prompt }] });
  return contents;
}

async function generateWithGemini(
  contents: GeminiContent[],
  tools?: GeminiTool[]
): Promise<GeminiResponse> {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not defined in .env');

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
  };
  if (tools && tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      },
    ];
  }

  const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${API_KEY}`;
  const genResponse = await fetch(genUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!genResponse.ok) {
    const errorText = await genResponse.text();
    throw new Error(
      `Google AI Studio Generation Error (${genResponse.status}): ${errorText}`
    );
  }

  return (await genResponse.json()) as GeminiResponse;
}
