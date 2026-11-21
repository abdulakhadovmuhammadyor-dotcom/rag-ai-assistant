import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { KnowledgeChunk } from './googleRagEngine';
import { fetchGoogleSources } from './googleDrive';
import { isGoogleConfigured } from './googleAuth';

const DOCS_DIR = path.join(process.cwd(), 'docs', 'rag');
const MAX_CHUNK_CHARS = 1800;
const DEFAULT_CACHE_TTL_MS = 5000;

const DOC_LABELS: Record<string, string> = {
  'faq.md': 'FAQ',
  'price_list.md': 'Прайс-лист',
  'schedule.md': 'График работы и контакты',
};

interface KnowledgeCache {
  chunks: KnowledgeChunk[];
  fetchedAt: number;
}

let cache: KnowledgeCache | null = null;
let inFlight: Promise<KnowledgeChunk[]> | null = null;

function getCacheTtlMs(): number {
  const value = Number(process.env.RAG_CACHE_TTL_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_CACHE_TTL_MS;
}

export function getRagSourceMode(): 'google' | 'local' {
  return isGoogleConfigured() ? 'google' : 'local';
}

export async function getKnowledgeBase(): Promise<KnowledgeChunk[]> {
  if (cache && Date.now() - cache.fetchedAt < getCacheTtlMs()) {
    return cache.chunks;
  }

  if (!inFlight) {
    inFlight = loadKnowledgeBase()
      .then((chunks) => {
        cache = { chunks, fetchedAt: Date.now() };
        return chunks;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
}

async function loadKnowledgeBase(): Promise<KnowledgeChunk[]> {
  if (isGoogleConfigured()) {
    try {
      const sources = await fetchGoogleSources();
      const chunks = sources.flatMap((source) =>
        chunkPlainText(source.label, source.text)
      );
      if (chunks.length > 0) return chunks;

      console.warn(
        '[RAG] Google Drive returned no readable documents, falling back to local docs.'
      );
    } catch (error) {
      console.warn(
        '[RAG] Google Drive sync failed, falling back to local docs:',
        error instanceof Error ? error.message : error
      );
    }
  }

  return loadLocalKnowledgeBase();
}

async function loadLocalKnowledgeBase(): Promise<KnowledgeChunk[]> {
  const entries = await readdir(DOCS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();

  const chunks: KnowledgeChunk[] = [];
  for (const fileName of files) {
    const markdown = await readFile(path.join(DOCS_DIR, fileName), 'utf8');
    chunks.push(...chunkMarkdown(fileName, markdown));
  }

  if (chunks.length === 0) {
    throw new Error(`No knowledge base documents found in ${DOCS_DIR}`);
  }

  return chunks;
}

function chunkPlainText(
  label: string,
  text: string,
  maxChars = MAX_CHUNK_CHARS
): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  const baseId = toId(label);
  let buffer: string[] = [];
  let bufferLength = 0;

  const flush = () => {
    const body = buffer.join('\n').trim();
    buffer = [];
    bufferLength = 0;
    if (!body) return;

    const firstLine =
      body
        .split('\n')
        .find((line) => line.trim())
        ?.trim()
        .replace(/^#{1,6}\s*/, '')
        .slice(0, 90) || label;
    const isTeacherRow = /^Преподаватель\s*:/i.test(firstLine);
    const title = isTeacherRow ? label : `${label} — ${firstLine}`;
    const parts =
      body.length > maxChars ? splitLongBlock(body, maxChars) : [body];

    for (const part of parts) {
      chunks.push({
        id: `${baseId}-${chunks.length + 1}`,
        title,
        text: `## ${title}\n\n${part}`,
      });
    }
  };

  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (/^-{3,}$/.test(line.trim())) continue;

    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      if (headingMatch[1].length === 1) continue;
      if (bufferLength > 0) flush();
    } else if (/^\s*Вопрос\s+\d+/i.test(line) && bufferLength > 0) {
      flush();
    }

    buffer.push(line);
    bufferLength += line.length + 1;
    if (bufferLength >= maxChars) flush();
  }

  flush();
  return chunks;
}

function chunkMarkdown(
  fileName: string,
  markdown: string,
  maxChars = MAX_CHUNK_CHARS
): KnowledgeChunk[] {
  const label = DOC_LABELS[fileName] ?? fileName.replace(/\.md$/, '');
  const baseId = fileName.replace(/\.md$/, '');

  const chunks: KnowledgeChunk[] = [];
  let currentTitle = label;
  let buffer: string[] = [];
  let bufferLength = 0;

  const flush = () => {
    const body = buffer.join('\n').trim();
    buffer = [];
    bufferLength = 0;
    if (!body) return;

    const parts =
      body.length > maxChars ? splitLongBlock(body, maxChars) : [body];
    for (const part of parts) {
      chunks.push({
        id: `${baseId}-${chunks.length + 1}`,
        title: currentTitle,
        text: `## ${currentTitle}\n\n${part}`,
      });
    }
  };

  for (const rawLine of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (/^-{3,}$/.test(line.trim())) continue;

    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      flush();
      const heading = headingMatch[2].trim();
      currentTitle =
        headingMatch[1].length === 1 ? label : `${label} — ${heading}`;
      continue;
    }

    buffer.push(line);
    bufferLength += line.length + 1;
    if (bufferLength >= maxChars) flush();
  }

  flush();
  return chunks;
}

function splitLongBlock(block: string, maxChars: number): string[] {
  const lines = block.split('\n');
  const parts: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    if (currentLength + line.length + 1 > maxChars && current.length > 0) {
      parts.push(current.join('\n'));
      current = [];
      currentLength = 0;
    }
    current.push(line);
    currentLength += line.length + 1;
  }

  if (current.length > 0) parts.push(current.join('\n'));
  return parts;
}

function toId(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9\u0400-\u04ff]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'document'
  );
}
