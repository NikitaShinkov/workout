// Turning a category's schedule settings into one date per complex.
//
// Only complexes with their switch on take a slot: the dates run
// start, start + interval, start + 2*interval ... over the ENABLED complexes in
// list order. Switching one off therefore shifts every later complex one slot
// earlier rather than leaving a hole - "19 сен, 20 сен, 21 сен" with the middle
// one disabled reads "19 сен, —, 20 сен".

// Figma writes dates as "22 сен": no trailing dot, and three letters. That is
// not what Intl produces for ru (it gives "22 сент."), so the names are ours.
export const MONTHS_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

// Both spellings of May are accepted on input: "3 мая" is what a date reads
// like, "май" is what someone typing the month's name reaches for.
const MONTH_INDEX = { май: 4 };
MONTHS_SHORT.forEach((name, index) => { MONTH_INDEX[name] = index; });

// The schedule is not configurable yet, so every category starts here. 3 сен
// rather than 19 сен so the Date_pointer lands in the middle of a short list
// instead of below all of it.
export const DEFAULT_START_DATE = '3 сен';
export const DEFAULT_INTERVAL_DAYS = 1;

export function formatDate(date) {
  return date.getDate() + ' ' + MONTHS_SHORT[date.getMonth()];
}

export function addDays(date, days) {
  // Local midnight arithmetic: Date normalises the overflow across months and
  // years, and the day-of-month constructor is DST-safe in a way that adding
  // 86400000ms is not.
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function startOfDay(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// "3 сен" -> Date, in the current year. Returns null for anything unparseable,
// which the caller turns into the default rather than an error.
export function parseStartDate(text, now = new Date()) {
  const match = /^\s*(\d{1,2})\s+([а-яё]+)\.?\s*$/i.exec(String(text || ''));
  if (!match) return null;

  const day = Number(match[1]);
  const month = MONTH_INDEX[match[2].toLowerCase()];
  if (month === undefined || day < 1) return null;

  const date = new Date(now.getFullYear(), month, day);
  // Rejects 31 фев, which Date would silently roll into March.
  return date.getMonth() === month ? date : null;
}

// The editing form of a start date: "19 сен" is what the field shows, "19.09"
// is what it becomes while it is being typed into.
function pad2(number) {
  return String(number).padStart(2, '0');
}

export function toNumericDate(date) {
  return pad2(date.getDate()) + '.' + pad2(date.getMonth() + 1);
}

// Strict: the mask always hands over five characters, and a date the calendar
// does not have (31.02, 39.09, 12.19) comes back null so the field can put the
// last good value back.
export function parseNumericDate(text, now = new Date()) {
  const match = /^(\d{2})\.(\d{2})$/.exec(String(text || ''));
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11 || day < 1) return null;

  const date = new Date(now.getFullYear(), month, day);
  return date.getMonth() === month && date.getDate() === day ? date : null;
}

export function parseInterval(value) {
  const days = Math.floor(Number(value));
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_INTERVAL_DAYS;
}

// Dates are assigned over the category's WHOLE complex list, not over whatever
// the view_options filter is currently showing - hiding a complex must not
// renumber the ones around it.
export function buildSchedule(category, now = new Date()) {
  const start =
    parseStartDate(category.scheduleStartDate, now) || parseStartDate(DEFAULT_START_DATE, now);
  const interval = parseInterval(category.intervalDays);

  const dates = new Map();
  let slot = 0;

  for (const complex of category.complexes || []) {
    if (!complex.enabled) continue;
    dates.set(complex.id, addDays(start, slot * interval));
    slot += 1;
  }

  return { start, interval, dates, end: slot > 0 ? addDays(start, (slot - 1) * interval) : null };
}

// Index in `complexes` where the Date_pointer goes: before the first complex
// scheduled today or later, or after the last one if they are all in the past.
// Disabled complexes carry no date and are simply skipped over.
export function pointerIndex(complexes, dates, today) {
  for (let i = 0; i < complexes.length; i += 1) {
    const date = dates.get(complexes[i].id);
    if (date && date.getTime() >= today.getTime()) return i;
  }
  return complexes.length;
}
