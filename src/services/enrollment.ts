import { randomUUID } from 'node:crypto';
import { googleFetch, hasGoogleCredentials } from './googleAuth';
import { getScheduleRows } from './googleDrive';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const GROUP_CAPACITY = Math.max(1, Number(process.env.BOOKING_GROUP_CAPACITY) || 12);

const BOOKING_HEADERS = [
  'ID',
  'Дата создания',
  'ФИО',
  'Телефон',
  'Направление',
  'Преподаватель',
  'Дата занятия',
  'Время',
  'Статус',
  'Группа',
  'Место',
];

const WEEKDAYS = [
  'Воскресенье',
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
];

export interface Booking {
  id: string;
  createdAt: string;
  name: string;
  phone: string;
  direction: string;
  teacher: string;
  date: string;
  time: string;
  status: string;
  groupId: string;
  seatNumber: number;
}

export interface FreeSlot {
  teacher: string;
  direction: string;
  day: string;
  date: string;
  start: string;
  end: string;
  lesson: string;
  capacity: number;
  seatsTaken: number;
  seatsLeft: number;
}

export interface FreeSlotQuery {
  date?: string;
  teacher?: string;
  direction?: string;
  limit?: number;
}

export interface EnrollInput {
  name: string;
  phone: string;
  direction?: string;
  teacher?: string;
  date: string;
  time: string;
}

export interface GroupStudentInput {
  name: string;
  phone: string;
  direction?: string;
}

export interface GroupEnrollInput {
  students: GroupStudentInput[];
  date: string;
  time: string;
  teacher?: string;
  direction?: string;
}

export function getGroupCapacity(): number {
  return GROUP_CAPACITY;
}

export function isEnrollmentConfigured(): boolean {
  return Boolean(process.env.GOOGLE_BOOKINGS_SHEET_ID) && hasGoogleCredentials();
}

export async function findFreeSlots(
  query: FreeSlotQuery = {}
): Promise<FreeSlot[]> {
  const dates = query.date
    ? [query.date]
    : Array.from({ length: 14 }, (_, index) => {
        const date = new Date();
        date.setDate(date.getDate() + index);
        return toDateKey(date);
      });

  const limit = Math.max(1, Math.min(query.limit ?? 8, 30));
  const schedule = await loadScheduleSlots();
  const bookings = isEnrollmentConfigured() ? await getBookings() : [];

  const slots: FreeSlot[] = [];
  for (const date of dates) {
    const day = WEEKDAYS[new Date(`${date}T12:00:00`).getDay()];

    for (const slot of schedule) {
      if (slot.day.toLowerCase() !== day.toLowerCase()) continue;
      if (
        query.teacher &&
        !includesText(slot.teacher, query.teacher)
      ) {
        continue;
      }
      if (
        query.direction &&
        !includesText(slot.direction, query.direction) &&
        !includesText(slot.lesson, query.direction)
      ) {
        continue;
      }

      const slotBookings = bookings.filter(
        (booking) =>
          booking.status.toLowerCase() !== 'отменено' &&
          booking.date === date &&
          sameTeacher(booking.teacher, slot.teacher) &&
          parseTime(booking.time)?.start === slot.start
      );
      const seatsTaken = slotBookings.length;
      if (seatsTaken >= GROUP_CAPACITY) continue;

      slots.push({
        teacher: slot.teacher,
        direction: slot.direction,
        day,
        date,
        start: slot.start,
        end: slot.end,
        lesson: slot.lesson,
        capacity: GROUP_CAPACITY,
        seatsTaken,
        seatsLeft: GROUP_CAPACITY - seatsTaken,
      });
    }
  }

  const unique = new Map<string, FreeSlot>();
  for (const slot of slots) {
    const key = `${slot.date}|${slot.teacher}|${slot.start}|${slot.end}|${slot.lesson}`;
    if (!unique.has(key)) unique.set(key, slot);
  }

  return Array.from(unique.values()).slice(0, limit);
}

export async function getBookings(): Promise<Booking[]> {
  const rows = await readValues('A1:Z10000');
  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim());
  const column = (name: string) => headers.indexOf(name);

  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell?.trim()))
    .map((row) => ({
      id: row[column('ID')] ?? '',
      createdAt: row[column('Дата создания')] ?? '',
      name: row[column('ФИО')] ?? '',
      phone: row[column('Телефон')] ?? '',
      direction: row[column('Направление')] ?? '',
      teacher: row[column('Преподаватель')] ?? '',
      date: row[column('Дата занятия')] ?? '',
      time: row[column('Время')] ?? '',
      status: row[column('Статус')] ?? 'Записан',
      groupId: row[column('Группа')] ?? '',
      seatNumber: Number(row[column('Место')]) || 0,
    }));
}

export async function enrollStudent(input: EnrollInput): Promise<Booking> {
  if (!isEnrollmentConfigured()) {
    throw new Error(
      'Запись студентов недоступна: задайте GOOGLE_BOOKINGS_SHEET_ID и сервисный аккаунт с правом Editor на таблицу.'
    );
  }
  if (!input.name?.trim() || !input.phone?.trim()) {
    throw new Error('Для записи нужны ФИО и телефон студента.');
  }
  if (!isValidDate(input.date)) {
    throw new Error('Укажите дату занятия в формате ГГГГ-ММ-ДД.');
  }

  const requestedStart = parseTime(input.time)?.start;
  if (!requestedStart) {
    throw new Error('Укажите время занятия, например 15:00 или 15:00–16:30.');
  }

  const freeSlots = await findFreeSlots({
    date: input.date,
    teacher: input.teacher,
    limit: 100,
  });
  const matching = freeSlots.filter((slot) => slot.start === requestedStart);
  if (matching.length === 0) {
    throw new Error(
      'Это окно уже занято или его нет в расписании. Выберите свободное окно через find_free_slots.'
    );
  }
  if (!input.teacher && matching.length > 1) {
    throw new Error(
      'На это время подходит несколько преподавателей. Уточните преподавателя.'
    );
  }

  const slot = matching[0];
  const bookings = await getBookings();
  const slotBookings = bookings.filter(
    (booking) =>
      booking.status.toLowerCase() !== 'отменено' &&
      booking.date === slot.date &&
      sameTeacher(booking.teacher, slot.teacher) &&
      parseTime(booking.time)?.start === slot.start
  );
  const groupId = slotBookings[0]?.groupId || randomUUID();

  const booking: Booking = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    name: input.name.trim(),
    phone: input.phone.trim(),
    direction: input.direction?.trim() || slot.direction || slot.lesson,
    teacher: slot.teacher,
    date: slot.date,
    time: `${slot.start}–${slot.end}`,
    status: 'Записан',
    groupId,
    seatNumber: slotBookings.length + 1,
  };

  await ensureHeaders();
  await appendValues('A:Z', [bookingToRow(booking)]);

  return booking;
}

export async function enrollGroup(
  input: GroupEnrollInput
): Promise<{ groupId: string; bookings: Booking[] }> {
  if (!isEnrollmentConfigured()) {
    throw new Error(
      'Запись студентов недоступна: задайте GOOGLE_BOOKINGS_SHEET_ID и сервисный аккаунт с правом Editor на таблицу.'
    );
  }
  if (!Array.isArray(input.students) || input.students.length === 0) {
    throw new Error('Передайте список студентов для групповой записи.');
  }
  if (!isValidDate(input.date)) {
    throw new Error('Укажите дату занятия в формате ГГГГ-ММ-ДД.');
  }

  const requestedStart = parseTime(input.time)?.start;
  if (!requestedStart) {
    throw new Error('Укажите время занятия, например 15:00 или 15:00–16:30.');
  }

  const freeSlots = await findFreeSlots({
    date: input.date,
    teacher: input.teacher,
    limit: 100,
  });
  const matching = freeSlots.filter((slot) => slot.start === requestedStart);
  if (matching.length === 0) {
    throw new Error(
      'Это окно недоступно или его нет в расписании. Выберите окно через find_free_slots.'
    );
  }
  if (!input.teacher && matching.length > 1) {
    throw new Error(
      'На это время подходит несколько преподавателей. Уточните преподавателя.'
    );
  }

  const slot = matching[0];
  if (input.students.length > slot.seatsLeft) {
    throw new Error(
      `В этом окне ${slot.seatsLeft} свободных мест, а студентов ${input.students.length}.`
    );
  }

  const bookings = await getBookings();
  const slotBookings = bookings.filter(
    (booking) =>
      booking.status.toLowerCase() !== 'отменено' &&
      booking.date === slot.date &&
      sameTeacher(booking.teacher, slot.teacher) &&
      parseTime(booking.time)?.start === slot.start
  );
  const groupId = slotBookings[0]?.groupId || randomUUID();
  const createdAt = new Date().toISOString();

  const newBookings = input.students.map((student, index) => {
    if (!student.name?.trim() || !student.phone?.trim()) {
      throw new Error('У каждого студента должны быть ФИО и телефон.');
    }
    return {
      id: randomUUID(),
      createdAt,
      name: student.name.trim(),
      phone: student.phone.trim(),
      direction:
        student.direction?.trim() ||
        input.direction?.trim() ||
        slot.direction ||
        slot.lesson,
      teacher: slot.teacher,
      date: slot.date,
      time: `${slot.start}–${slot.end}`,
      status: 'Записан',
      groupId,
      seatNumber: slotBookings.length + index + 1,
    };
  });

  await ensureHeaders();
  await appendValues('A:Z', newBookings.map(bookingToRow));

  return { groupId, bookings: newBookings };
}

async function loadScheduleSlots(): Promise<
  { teacher: string; direction: string; day: string; start: string; end: string; lesson: string }[]
> {
  const rows = await getScheduleRows();
  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const column = (name: string) => headers.indexOf(name);

  return rows
    .slice(1)
    .map((row) => {
      const parsed = parseTime(row[column('время')] ?? '');
      if (!parsed) return null;

      return {
        teacher: row[column('преподаватель')] ?? '',
        direction: row[column('направление')] ?? '',
        day: row[column('день недели')] ?? '',
        start: parsed.start,
        end: parsed.end,
        lesson: row[column('занятие')] ?? '',
      };
    })
    .filter(
      (slot): slot is NonNullable<typeof slot> =>
        slot !== null && Boolean(slot.teacher && slot.day)
    );
}

async function ensureHeaders(): Promise<void> {
  const rows = await readValues('A1:Z1');
  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  if (headers.length === 0) {
    await appendValues('A:Z', [BOOKING_HEADERS]);
    return;
  }

  const hasAllHeaders = BOOKING_HEADERS.every((header) =>
    headers.includes(header)
  );
  if (!hasAllHeaders) {
    await updateValues('A1', [BOOKING_HEADERS]);
  }
}

function bookingToRow(booking: Booking): string[] {
  return [
    booking.id,
    booking.createdAt,
    booking.name,
    booking.phone,
    booking.direction,
    booking.teacher,
    booking.date,
    booking.time,
    booking.status,
    booking.groupId,
    String(booking.seatNumber),
  ];
}

function sameTeacher(bookingTeacher: string, slotTeacher: string): boolean {
  if (!bookingTeacher || !slotTeacher) return false;
  return (
    bookingTeacher.toLowerCase().includes(slotTeacher.toLowerCase()) ||
    slotTeacher.toLowerCase().includes(bookingTeacher.toLowerCase())
  );
}

async function readValues(range: string): Promise<string[][]> {
  const response = await googleFetch(
    `${SHEETS_API}/${process.env.GOOGLE_BOOKINGS_SHEET_ID}/values/${encodeURIComponent(
      sheetRange(range)
    )}`
  );
  if (!response.ok) {
    throw new Error(
      `Bookings sheet read error (${response.status}): ${await response.text()}`
    );
  }
  const data = await response.json();
  return (data.values ?? []) as string[][];
}

async function appendValues(range: string, rows: string[][]): Promise<void> {
  const params = new URLSearchParams({
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
  });
  const response = await googleFetch(
    `${SHEETS_API}/${process.env.GOOGLE_BOOKINGS_SHEET_ID}/values/${encodeURIComponent(
      sheetRange(range)
    )}:append?${params.toString()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Bookings sheet write error (${response.status}): ${await response.text()}`
    );
  }
}

async function updateValues(range: string, rows: string[][]): Promise<void> {
  const params = new URLSearchParams({ valueInputOption: 'USER_ENTERED' });
  const response = await googleFetch(
    `${SHEETS_API}/${process.env.GOOGLE_BOOKINGS_SHEET_ID}/values/${encodeURIComponent(
      sheetRange(range)
    )}?${params.toString()}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Bookings sheet header update error (${response.status}): ${await response.text()}`
    );
  }
}

function sheetRange(range: string): string {
  const sheetName = process.env.GOOGLE_BOOKINGS_SHEET_NAME || 'Лист1';
  return `'${sheetName.replace(/'/g, "''")}'!${range}`;
}

function parseTime(
  value: string
): { start: string; end: string } | null {
  const match = value.trim().match(/^(\d{1,2}:\d{2})(?:\s*[—–-]\s*(\d{1,2}:\d{2}))?/);
  if (!match) return null;

  const duration = Number(process.env.BOOKING_SLOT_MINUTES) || 90;
  return {
    start: normalizeTime(match[1]),
    end: normalizeTime(match[2] ?? addMinutes(match[1], duration)),
  };
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function addMinutes(time: string, minutes: number): string {
  const total = toMinutes(time) + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(
    total % 60
  ).padStart(2, '0')}`;
}

function normalizeTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function includesText(value: string, search: string): boolean {
  return value.toLowerCase().includes(search.toLowerCase().trim());
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && toDateKey(date) === value;
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}
