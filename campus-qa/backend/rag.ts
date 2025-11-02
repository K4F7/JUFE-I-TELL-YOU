import { getEmbeddingModel, getGenerativeModel, firestore } from './gcloud.js';
import { DocumentChunk } from './types.js';

const COLLECTION = process.env.FIRESTORE_COLLECTION || 'chunks';
const TOPK = Number.parseInt(process.env.TOPK || '5', 10);
const MAX_CONTEXT = Number.parseInt(process.env.RAG_MAX_CONTEXT || '2500', 10);

export function chunkText(text: string, minChars = 300, maxChars = 600): string[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buffer = '';

  const pushBuffer = () => {
    const content = buffer.trim();
    if (content.length > 0) {
      chunks.push(content);
    }
    buffer = '';
  };

  for (const paragraph of paragraphs) {
    if ((buffer + '\n' + paragraph).trim().length <= maxChars) {
      buffer = buffer ? `${buffer}\n${paragraph}` : paragraph;
      continue;
    }
    if (buffer.length >= minChars) {
      pushBuffer();
    } else if (paragraph.length > maxChars) {
      for (let i = 0; i < paragraph.length; i += maxChars) {
        const slice = paragraph.slice(i, i + maxChars);
        chunks.push(slice.trim());
      }
      buffer = '';
      continue;
    } else {
      buffer = buffer ? `${buffer}\n${paragraph}` : paragraph;
      pushBuffer();
      continue;
    }
  }

  if (buffer.length > 0) {
    pushBuffer();
  }

  return chunks;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  const model = getEmbeddingModel();
  const embeddings = await model.getEmbeddings(texts);
  return embeddings.map((item: any) => item.values || item.embedding || item.vector || []);
}

export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  if (!vector) {
    throw new Error('Failed to generate embedding');
  }
  return vector;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB) + 1e-8;
  return denom === 0 ? 0 : dot / denom;
}

export function searchTopK(questionEmbedding: number[], chunks: DocumentChunk[], topK = TOPK): Array<DocumentChunk & { score: number }> {
  const scored = chunks.map((chunk) => ({
    ...chunk,
    score: cosineSimilarity(questionEmbedding, chunk.embedding || []),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

export function buildPrompt(question: string, contextChunks: Array<DocumentChunk & { score: number }>): string {
  const header = '你是校园事务问答助手。结合提供的参考资料回答学生的问题。若无法从资料中得到答案，请说明需要联系线下部门确认。回复需使用中文，并在答案末尾列出引用的编号。';
  const contextParts: string[] = [];
  let remaining = MAX_CONTEXT;
  contextChunks.forEach((chunk, index) => {
    if (remaining <= 0) return;
    const entry = `[${index + 1}] 标题：${chunk.title}\n来源：${chunk.source_url}\n内容：${chunk.chunk_text.trim()}`;
    if (entry.length <= remaining) {
      contextParts.push(entry);
      remaining -= entry.length;
    }
  });
  const context = contextParts.join('\n\n');
  return `${header}\n\n问题：${question}\n\n参考资料：\n${context}`;
}

export async function fetchAllChunks(): Promise<DocumentChunk[]> {
  const snapshot = await firestore.collection(COLLECTION).get();
  return snapshot.docs.map((doc) => doc.data() as DocumentChunk);
}

export async function generateAnswer(prompt: string): Promise<string> {
  const model = getGenerativeModel();
  const response = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
  });
  const candidates = response?.response?.candidates || [];
  const first = candidates[0];
  if (!first?.content?.parts) {
    return '未从资料中检索到答案，请联系相关部门进一步确认。';
  }
  return first.content.parts.map((part: any) => part.text || '').join('\n').trim();
}
