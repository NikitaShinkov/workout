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

// Every category starts here. 3 сен rather than 19 сен so the Date_pointer
// lands in the middle of a short list instead of below all of it.
//
// A default rather than a constant, because a start date is STORED as ISO and
// an ISO date needs a year. It used to be stored as "3 сен", which carries no
// year at all, so parseStartDate resolved it in whatever year it was read in -
// and every schedule in the app silently jumped twelve months on 1 January.
const DEFAULT_START_MONTH_DAY = '09-03';

export function defaultStartDate(now = new Date()) {
  return now.getFullYear() + '-' + DEFAULT_START_MONTH_DAY;
}

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

// A stored start date is ISO ("2026-09-03"); the display form ("3 сен") is what
// the toolbar field shows and what older saves hold. Both parse, so nothing has
// to know which one it is looking at. Null for anything unparseable, which the
// caller turns into the default rather than an error.
export function parseStartDate(text, now = new Date()) {
  const iso = parseIsoDate(text);
  if (iso) return iso;

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

// The STORED form. Local parts, not toISOString - that shifts across the UTC
// boundary and would move a date by a day for anyone east or west of Greenwich.
export function toIsoDate(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

export function parseIsoDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''));
  if (!match) return null;

  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  // Rejects 2026-02-31, which Date would roll into March.
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
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
    parseStartDate(category.scheduleStartDate, now) || parseIsoDate(defaultStartDate(now));
  const interval = parseInterval(category.intervalDays);
  // Off unless the checkbox says otherwise: a category that has never been
  // told carries no field, and that means weekends are left out.
  const includeWeekends = category.includeWeekends === true;

  const dates = new Map();
  let date = includeWeekends ? start : skipWeekend(start);
  let end = null;

  for (const complex of category.complexes || []) {
    if (!complex.enabled) continue;
    dates.set(complex.id, date);
    end = date;
    date = includeWeekends ? addDays(date, interval) : addWorkingDays(date, interval);
  }

  return { start, interval, includeWeekends, dates, end };
}

export function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

// A date that falls on Saturday or Sunday -> the Monday after it.
export function skipWeekend(date) {
  let next = date;
  while (isWeekend(next)) next = addDays(next, 1);
  return next;
}

// A date that falls on Saturday or Sunday -> the Friday before it.
function skipWeekendBack(date) {
  let previous = date;
  while (isWeekend(previous)) previous = addDays(previous, -1);
  return previous;
}

// With weekends left out the interval counts WORKING days, so an interval of
// 1 runs Mon..Fri and then Mon, and an interval of 2 runs Mon, Wed, Fri, Tue.
// A negative count walks backwards.
export function addWorkingDays(date, days) {
  const step = days < 0 ? -1 : 1;
  let next = date;
  for (let left = Math.abs(days); left > 0; ) {
    next = addDays(next, step);
    if (!isWeekend(next)) left -= 1;
  }
  return next;
}

// Whole days from `from` to `to`, by the calendar rather than by milliseconds,
// so a DST change in between cannot make it 0.96 of a day.
export function daysBetween(from, to) {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

// --- moving the schedule by dragging the Date_pointer -----------------------
//
// Both pages answer the same question: "which start date makes slot N land on
// <target>?" Slot N is the N-th ENABLED complex, counted from zero - and N may
// be one past the last, which is where the pointer sits when every complex is
// in the past.

// The date slot N falls on under the category's current settings, whether or
// not a complex occupies it.
export function slotDate(category, slot, now = new Date()) {
  const { start, interval, includeWeekends } = buildSchedule({ ...category, complexes: [] }, now);
  return includeWeekends
    ? addDays(start, slot * interval)
    : addWorkingDays(skipWeekend(start), slot * interval);
}

// The start date that puts slot N on `target` - or, with weekends left out and
// `target` on one, on the Monday after it: the first day the schedule can use.
export function startForSlot(category, slot, target) {
  const interval = parseInterval(category.intervalDays);
  if (category.includeWeekends === true) return addDays(target, -slot * interval);
  return addWorkingDays(skipWeekend(target), -slot * interval);
}

// How many ENABLED complexes come before `fullIndex` in the category's list -
// i.e. which slot the complex at that position (or the next enabled one after
// it) occupies.
export function slotBefore(category, fullIndex) {
  return (category.complexes || []).slice(0, fullIndex).filter((c) => c.enabled).length;
}

// Schedule page: the pointer dropped before the complex at `fullIndex` -> the
// start date that makes that complex today's.
export function startDateForPointer(category, fullIndex, now = new Date()) {
  return toIsoDate(startForSlot(category, slotBefore(category, fullIndex), startOfDay(now)));
}

// Calendar page: the pointer dropped before the day `boundary` (the first day
// that should now read as today). Every category moves by the same number of
// days, so the calendar keeps its shape and that day lands on today. A
// category that leaves weekends out moves its next complex to the first
// weekday on or after where the shift puts it.
// Returns { categoryId: isoStartDate } for every category whose start changes.
export function startDatesForCalendarPointer(state, boundary, now = new Date()) {
  const today = startOfDay(now);
  const delta = daysBetween(boundary, today);
  const out = {};

  for (const id of state.categoryOrder) {
    const category = state.categories[id];
    if (!category) continue;

    const { dates } = buildSchedule(category, now);
    let slot = 0;
    for (const complex of category.complexes || []) {
      const date = dates.get(complex.id);
      if (date && date < boundary) slot += 1;
    }

    let target = addDays(slotDate(category, slot, now), delta);
    if (category.includeWeekends !== true) {
      // Shifting by calendar days changes which weekday a date falls on, and
      // a schedule counted in working days then re-spaces around it - enough,
      // sometimes, to pull the complex BEFORE the boundary onto today. Keep
      // the boundary true: the next complex no later than the first weekday
      // the previous one can still be in the past for.
      target = skipWeekend(target);
      if (slot > 0) {
        const lastPast = skipWeekendBack(addDays(today, -1));
        const latest = addWorkingDays(lastPast, parseInterval(category.intervalDays));
        if (target > latest) target = latest;
      }
    }
    const iso = toIsoDate(startForSlot(category, slot, target));
    if (iso !== category.scheduleStartDate) out[id] = iso;
  }

  return out;
}

// --- the calendar -----------------------------------------------------------

// Local-date key, so two Dates for the same day group together whatever time
// they carry. Not toISOString: that shifts across the UTC boundary.
export function dayKey(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

// Every scheduled complex from every category, gathered by the day it falls on
// and sorted. A category switched out of the schedule contributes nothing - it
// has no schedule to place - and neither does a complex with its own switch
// off, which buildSchedule has already left undated.
export function buildCalendar(state, now = new Date()) {
  const days = new Map();

  for (const categoryId of state.categoryOrder) {
    const category = state.categories[categoryId];
    if (!category || !category.scheduleEnabled) continue;

    const { dates } = buildSchedule(category, now);

    for (const complex of category.complexes || []) {
      const date = dates.get(complex.id);
      if (!date) continue;

      const key = dayKey(date);
      if (!days.has(key)) days.set(key, { key, date, entries: [] });
      // Categories arrive in categoryOrder, which is the order the menu shows
      // them in - so the tabs inside a day read the same way as the menu.
      days.get(key).entries.push({ categoryId, name: category.name, complex });
    }
  }

  return Array.from(days.values()).sort((a, b) => a.date - b.date);
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
