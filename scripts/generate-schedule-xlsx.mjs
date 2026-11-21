import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'docs', 'rag', 'schedule.md');
const targetPath = path.join(root, 'docs', 'rag', 'teachers_schedule.xlsx');

const HEADERS = [
  'Преподаватель',
  'Направление',
  'День недели',
  'Время',
  'Занятие',
  'Формат и аудитория',
];

let crcTable;

const rows = parseSchedule(readFileSync(sourcePath, 'utf8'));
const xlsx = buildXlsx([HEADERS, ...rows], 'Расписание преподавателей');
writeFileSync(targetPath, xlsx);

console.log(
  `Generated ${path.relative(root, targetPath)}: ${rows.length} schedule rows.`
);

function parseSchedule(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const rows = [];
  let teacher = '';
  let role = '';

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const teacherMatch = line.match(/^###\s+\d+\.\s+(.+?)\s*$/);
    if (teacherMatch) {
      teacher = cleanInline(teacherMatch[1]);
      role = '';
      for (let lookahead = index + 1; lookahead < Math.min(index + 4, lines.length); lookahead++) {
        const roleMatch = lines[lookahead].match(/^\*(.+?)\*$/);
        if (roleMatch) {
          role = cleanInline(roleMatch[1]);
          break;
        }
      }
      continue;
    }

    if (!line.trim().startsWith('|')) continue;

    const tableLines = [];
    let cursor = index;
    while (cursor < lines.length && lines[cursor].trim().startsWith('|')) {
      tableLines.push(lines[cursor]);
      cursor++;
    }
    index = cursor - 1;

    if (tableLines.length < 3) continue;
    const header = splitRow(tableLines[0]);
    if (!/день/i.test(header[0] ?? '')) continue;

    for (const tableLine of tableLines.slice(2)) {
      const cells = splitRow(tableLine);
      const day = cleanInline(cells[0] ?? '');
      const hours = cells[1] ?? '';
      const format = cells[2] ?? '';
      if (!day && !hours) continue;

      const timeItems = hours
        .split(/<br\s*\/?>/i)
        .map(cleanInline)
        .filter(Boolean);
      const formatItems = format
        .split(/<br\s*\/?>/i)
        .map(cleanInline)
        .filter(Boolean);

      const items = timeItems.length > 0 ? timeItems : [cleanInline(hours)];
      items.forEach((item, itemIndex) => {
        const timeMatch = item.match(
          /^(\d{1,2}:\d{2})\s*[—–-]\s*(\d{1,2}:\d{2})\s*:?\s*(.*)$/
        );
        const time = timeMatch ? `${timeMatch[1]}–${timeMatch[2]}` : '';
        const lesson = timeMatch ? timeMatch[3].trim() : item;
        const formatValue =
          formatItems.length === 1
            ? formatItems[0]
            : formatItems[itemIndex] ??
              formatItems[formatItems.length - 1] ??
              '';

        rows.push([teacher, role, day, time, lesson, formatValue]);
      });
    }
  }

  return rows;
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) =>
      cell
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .trim()
    );
}

function cleanInline(value) {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildXlsx(tableRows, sheetName) {
  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: buildSheetXml(tableRows),
    },
  ];

  return createZip(files);
}

function buildSheetXml(tableRows) {
  const widths = [34, 44, 16, 14, 52, 34];
  const cols = widths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
    )
    .join('');

  const sheetRows = tableRows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const text = value == null ? '' : String(value);
          if (text === '') return '';
          const reference = `${columnLetter(columnIndex)}${rowIndex + 1}`;
          const style = rowIndex === 0 ? ' s="1"' : '';
          return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(
            text
          )}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols>
<sheetData>${sheetRows}</sheetData>
</worksheet>`;
}

function columnLetter(index) {
  let result = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const content = Buffer.from(file.data, 'utf8');
    const compressed = deflateRawSync(content);
    const crc = crc32(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0808, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0808, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const localSize = localParts.reduce((sum, part) => sum + part.length, 0);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localSize, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function crc32(buffer) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

function dosDateTime(dateValue) {
  const time =
    (dateValue.getHours() << 11) |
    (dateValue.getMinutes() << 5) |
    Math.floor(dateValue.getSeconds() / 2);
  const date =
    ((dateValue.getFullYear() - 1980) << 9) |
    ((dateValue.getMonth() + 1) << 5) |
    dateValue.getDate();
  return { time, date };
}
