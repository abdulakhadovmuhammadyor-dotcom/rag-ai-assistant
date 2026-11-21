import { inflateRawSync } from 'node:zlib';
import { googleFetch, hasGoogleCredentials } from './googleAuth';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const PUBLIC_DOWNLOAD_API = 'https://drive.usercontent.google.com/download';

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface GoogleSource {
  label: string;
  text: string;
  kind: 'google-doc' | 'docx' | 'google-sheet' | 'public-file';
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

interface ConfiguredFile {
  id: string;
  label: string;
}

export async function fetchGoogleSources(): Promise<GoogleSource[]> {
  const configured = getConfiguredFiles();

  if (!hasGoogleCredentials()) {
    return fetchPublicSources(configured);
  }

  const files = await resolveFiles(configured);
  const sources: GoogleSource[] = [];

  for (const file of files) {
    try {
      const loaded = await fileToSources(file);
      sources.push(...loaded);
    } catch (error) {
      console.warn(
        `[Google RAG] Failed to load "${file.name}":`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return sources.filter((source) => source.text.trim().length > 0);
}

function getConfiguredFiles(): ConfiguredFile[] {
  const candidates: ConfiguredFile[] = [
    {
      id: process.env.GOOGLE_FAQ_FILE_ID || process.env.GOOGLE_FAQ_DOC_ID || '',
      label: 'FAQ',
    },
    {
      id:
        process.env.GOOGLE_PRICE_FILE_ID ||
        process.env.GOOGLE_PRICE_DOC_ID ||
        '',
      label: 'Прайс-лист',
    },
    {
      id:
        process.env.GOOGLE_SCHEDULE_FILE_ID ||
        process.env.GOOGLE_SCHEDULE_SHEET_ID ||
        '',
      label:
        process.env.GOOGLE_SCHEDULE_SHEET_NAME || 'Расписание преподавателей',
    },
    {
      id: process.env.GOOGLE_SCHEDULE_DOC_ID || '',
      label:
        process.env.GOOGLE_SCHEDULE_DOC_NAME || 'График работы и контакты',
    },
  ];

  const seen = new Set<string>();
  return candidates.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function fetchPublicSources(
  configured: ConfiguredFile[]
): Promise<GoogleSource[]> {
  const sources: GoogleSource[] = [];

  for (const item of configured) {
    try {
      const buffer = await downloadPublicDriveFile(item.id);
      sources.push(...bufferToSources(buffer, item.label));
    } catch (error) {
      console.warn(
        `[Google RAG] Failed to load public file "${item.label}":`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return sources.filter((source) => source.text.trim().length > 0);
}

async function downloadPublicDriveFile(fileId: string): Promise<Buffer> {
  const params = new URLSearchParams({
    id: fileId,
    export: 'download',
    confirm: 't',
  });

  const response = await fetch(`${PUBLIC_DOWNLOAD_API}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(
      `Public Drive download error (${response.status}): ${await response.text()}`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html') && buffer.includes('drive.usercontent')) {
    throw new Error(
      'Google Drive returned a confirmation page instead of the file. Make sure the file is shared as "Anyone with the link".'
    );
  }
  if (buffer.length === 0) {
    throw new Error('Google Drive returned an empty file.');
  }
  return buffer;
}

function bufferToSources(buffer: Buffer, label: string): GoogleSource[] {
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (!isZip) {
    return [{ label, text: decodeTextBuffer(buffer), kind: 'public-file' }];
  }

  const entries = readZipEntries(buffer);
  const documentXml = entries.get('word/document.xml');
  if (documentXml) {
    return [{ label, text: docxXmlToText(documentXml), kind: 'docx' }];
  }

  if (entries.has('xl/workbook.xml')) {
    return sheetValuesToSources(label, xlsxToValues(entries));
  }

  throw new Error(
    `"${label}" is a binary Office file of an unsupported type. Use Google Docs, DOCX, Markdown or XLSX.`
  );
}

function decodeTextBuffer(buffer: Buffer): string {
  return buffer
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trim();
}

async function fileToSources(file: DriveFile): Promise<GoogleSource[]> {
  const label = stripExtension(file.name);

  if (file.mimeType === GOOGLE_DOC_MIME) {
    return [{ label, text: await exportGoogleDoc(file.id), kind: 'google-doc' }];
  }
  if (file.mimeType === DOCX_MIME) {
    return [
      {
        label,
        text: docxToText(await downloadDriveFile(file.id)),
        kind: 'docx',
      },
    ];
  }
  if (file.mimeType === GOOGLE_SHEET_MIME) {
    return fetchSheetSources(file.id, file.name);
  }

  const buffer = await downloadDriveFile(file.id);
  return bufferToSources(buffer, label);
}

async function resolveFiles(configured: ConfiguredFile[]): Promise<DriveFile[]> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (folderId) {
    return listFolderFiles(folderId);
  }

  const files: DriveFile[] = [];
  for (const item of configured) {
    const meta = await getFileMeta(item.id);
    files.push({
      id: item.id,
      name: meta?.name ? meta.name : item.label,
      mimeType: meta?.mimeType ?? '',
    });
  }
  return files;
}

async function listFolderFiles(folderId: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,modifiedTime)',
    pageSize: '100',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const response = await googleFetch(`${DRIVE_API}/files?${params.toString()}`);
  if (!response.ok) {
    throw new Error(
      `Google Drive list error (${response.status}): ${await response.text()}`
    );
  }
  const data = await response.json();
  return (data.files ?? []) as DriveFile[];
}

async function getFileMeta(fileId: string): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType',
    supportsAllDrives: 'true',
  });
  const response = await googleFetch(
    `${DRIVE_API}/files/${fileId}?${params.toString()}`
  );
  if (!response.ok) return null;
  return (await response.json()) as DriveFile;
}

async function exportGoogleDoc(fileId: string): Promise<string> {
  const response = await googleFetch(
    `${DRIVE_API}/files/${fileId}/export?mimeType=text%2Fplain`
  );
  if (!response.ok) {
    throw new Error(
      `Google Docs export error (${response.status}): ${await response.text()}`
    );
  }
  return response.text();
}

async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const response = await googleFetch(
    `${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`
  );
  if (!response.ok) {
    throw new Error(
      `Google Drive download error (${response.status}): ${await response.text()}`
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function getScheduleRows(): Promise<string[][]> {
  const spreadsheetId =
    process.env.GOOGLE_SCHEDULE_FILE_ID ||
    process.env.GOOGLE_SCHEDULE_SHEET_ID;
  if (!spreadsheetId) return [];

  if (hasGoogleCredentials()) {
    const range = process.env.GOOGLE_SCHEDULE_SHEET_RANGE || 'A1:Z1000';
    const params = new URLSearchParams({ valueRenderOption: 'FORMATTED_VALUE' });
    const response = await googleFetch(
      `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(
        range
      )}?${params.toString()}`
    );
    if (!response.ok) {
      throw new Error(
        `Google Sheets schedule read error (${response.status}): ${await response.text()}`
      );
    }
    const data = await response.json();
    return (data.values ?? []) as string[][];
  }

  const buffer = await downloadPublicDriveFile(spreadsheetId);
  return xlsxToValues(readZipEntries(buffer));
}

async function fetchSheetSources(
  spreadsheetId: string,
  label: string
): Promise<GoogleSource[]> {
  const range = process.env.GOOGLE_SCHEDULE_SHEET_RANGE || 'A1:Z1000';
  const params = new URLSearchParams({ valueRenderOption: 'FORMATTED_VALUE' });
  const response = await googleFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(
      range
    )}?${params.toString()}`
  );
  if (!response.ok) {
    throw new Error(
      `Google Sheets read error (${response.status}): ${await response.text()}`
    );
  }

  const data = await response.json();
  const values = (data.values ?? []) as string[][];
  return sheetValuesToSources(label, values);
}

function sheetValuesToSources(
  label: string,
  values: string[][]
): GoogleSource[] {
  if (values.length === 0) return [];

  const headers = values[0].map(
    (header, index) => header?.trim() || `Колонка ${index + 1}`
  );
  const rows = values
    .slice(1)
    .filter((row) => row.some((cell) => cell && cell.trim()));

  const describeRow = (row: string[]) =>
    headers
      .map((header, index) => {
        const value = row[index]?.trim();
        return value ? `${header}: ${value}` : null;
      })
      .filter(Boolean)
      .join(' | ');

  const teacherIndex = headers.findIndex((header) =>
    /препод|учител/i.test(header)
  );

  if (teacherIndex === -1) {
    return [
      {
        label,
        text: rows.map(describeRow).join('\n\n'),
        kind: 'google-sheet',
      },
    ];
  }

  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const teacher = row[teacherIndex]?.trim() || 'Без преподавателя';
    const lines = groups.get(teacher) ?? [];
    lines.push(describeRow(row));
    groups.set(teacher, lines);
  }

  return Array.from(groups, ([teacher, lines]) => ({
    label: `${label} — ${teacher}`,
    text: lines.join('\n\n'),
    kind: 'google-sheet' as const,
  }));
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.(docx?|md)$/i, '');
}

function docxToText(buffer: Buffer): string {
  const entries = readZipEntries(buffer);
  const documentXml = entries.get('word/document.xml');
  if (!documentXml) {
    throw new Error('DOCX does not contain word/document.xml');
  }
  return docxXmlToText(documentXml);
}

function docxXmlToText(documentXml: Buffer): string {
  const xml = documentXml
    .toString('utf8')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n');

  return decodeXmlEntities(xml.replace(/<[^>]+>/g, ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function xlsxToValues(entries: Map<string, Buffer>): string[][] {
  const sharedStrings = parseSharedStrings(
    entries.get('xl/sharedStrings.xml')
  );
  const sheetPath = resolveSheetPath(entries);
  const sheetXml = entries.get(sheetPath);
  if (!sheetXml) {
    throw new Error(`XLSX does not contain ${sheetPath}`);
  }

  const xml = sheetXml.toString('utf8');
  const rows: string[][] = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;

    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2];
      const reference = attrs.match(/\br="([A-Z]+)\d+"/);
      const columnIndex = reference
        ? columnIndexFromLetters(reference[1])
        : cells.length;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? '';

      let value = '';
      if (type === 's') {
        const index = Number(decodeXmlEntities(cellValue(inner)));
        value = Number.isFinite(index) ? sharedStrings[index] ?? '' : '';
      } else if (type === 'inlineStr') {
        value = extractTextRuns(inner);
      } else if (type === 'str') {
        value = decodeXmlEntities(cellValue(inner));
      } else {
        value = decodeXmlEntities(cellValue(inner));
      }

      cells[columnIndex] = value;
    }

    rows.push(cells);
  }

  return trimRows(rows);
}

function parseSharedStrings(buffer: Buffer | undefined): string[] {
  if (!buffer) return [];
  const xml = buffer.toString('utf8');
  const strings: string[] = [];
  const regex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    strings.push(extractTextRuns(match[1]));
  }
  return strings;
}

function extractTextRuns(xml: string): string {
  const texts: string[] = [];
  const regex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    texts.push(decodeXmlEntities(match[1]));
  }
  return texts.join('');
}

function cellValue(inner: string): string {
  const match = inner.match(/<v>([\s\S]*?)<\/v>/);
  return match ? match[1] : '';
}

function resolveSheetPath(entries: Map<string, Buffer>): string {
  const workbook = entries.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const relationshipId = workbook.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const relationships =
    entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';

  if (relationshipId) {
    const relRegex = /<Relationship\b[^>]*\/?>/g;
    let match: RegExpExecArray | null;
    while ((match = relRegex.exec(relationships)) !== null) {
      const attrs = match[0];
      if (!attrs.includes(`Id="${relationshipId}"`)) continue;

      const target = attrs.match(/Target="([^"]+)"/)?.[1];
      if (!target) continue;

      const normalized = target.replace(/^\/+/, '');
      return normalized.startsWith('xl/')
        ? normalized
        : `xl/${normalized}`;
    }
  }

  return 'xl/worksheets/sheet1.xml';
}

function columnIndexFromLetters(letters: string): number {
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function trimRows(rows: string[][]): string[][] {
  return rows
    .map((row) => {
      let end = row.length;
      while (end > 0 && !row[end - 1]?.trim()) end--;
      return row.slice(0, end);
    })
    .filter((row) => row.some((cell) => cell?.trim()));
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let pointer = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map<string, Buffer>();

  for (let index = 0; index < totalEntries; index++) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) break;

    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer
      .subarray(pointer + 46, pointer + 46 + nameLength)
      .toString('utf8');

    if (buffer.readUInt32LE(localOffset) === 0x04034b50) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const raw = buffer.subarray(dataStart, dataStart + compressedSize);
      entries.set(
        name,
        method === 0 ? Buffer.from(raw) : inflateRawSync(raw)
      );
    }

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const stop = Math.max(0, buffer.length - 66_000);
  for (let offset = buffer.length - 22; offset >= stop; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('DOCX file is not a valid ZIP archive');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&amp;/g, '&');
}
