/**
 * PingLater - Recurring Schedule Engine (Feature 1)
 * Handles calculating recurring occurrences (daily, weekdays, weekly),
 * date range constraints, cycle counters, and human-friendly descriptions.
 */

export const RECURRING_FREQUENCY = {
  DAILY: 'daily',
  WEEKDAYS: 'weekdays',
  WEEKLY: 'weekly'
};

/**
 * Calculates the next occurrence Date for a recurring configuration.
 *
 * @param {Object} config - Recurring configuration object
 * @param {string} config.frequency - 'daily' | 'weekdays' | 'weekly'
 * @param {string} config.timeOfDay - 'HH:mm' 24-hr format (e.g. '09:00')
 * @param {string} [config.startDate] - 'YYYY-MM-DD'
 * @param {string} [config.endDate] - 'YYYY-MM-DD'
 * @param {Date} [fromDate=new Date()] - Reference timestamp to advance from
 * @returns {Date|null} - Next scheduled Date or null if recurrence ended
 */
export function calculateNextRecurringDate(config, fromDate = new Date()) {
  if (!config) return null;

  const { frequency = RECURRING_FREQUENCY.DAILY, timeOfDay = '09:00', endDate } = config;
  const [targetHour, targetMin] = timeOfDay.split(':').map((num) => parseInt(num, 10) || 0);

  // Parse reference date
  const ref = new Date(fromDate);
  if (isNaN(ref.getTime())) return null;

  let candidate = new Date(ref);

  // If candidate is today and the target time is still in the future (at least 2 mins ahead):
  const todayTarget = new Date(ref);
  todayTarget.setHours(targetHour, targetMin, 0, 0);

  if (todayTarget.getTime() - ref.getTime() > 2 * 60 * 1000) {
    candidate = todayTarget;
  } else {
    // Advance to next eligible calendar day
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(targetHour, targetMin, 0, 0);
  }

  // Adjust for Weekdays or Weekly
  if (frequency === RECURRING_FREQUENCY.WEEKDAYS) {
    // Day 0 is Sunday, Day 6 is Saturday
    while (candidate.getDay() === 0 || candidate.getDay() === 6) {
      candidate.setDate(candidate.getDate() + 1);
    }
  } else if (frequency === RECURRING_FREQUENCY.WEEKLY) {
    // If we advanced past today's time, step forward 7 days
    if (candidate.getTime() <= ref.getTime()) {
      candidate.setDate(candidate.getDate() + 7);
    }
  }

  // Check against End Date if specified
  if (endDate) {
    const endBoundary = new Date(`${endDate}T23:59:59.999`);
    if (!isNaN(endBoundary.getTime()) && candidate.getTime() > endBoundary.getTime()) {
      return null; // Reached or exceeded end date
    }
  }

  return candidate;
}

/**
 * Calculates total occurrences between startDate and endDate for a frequency.
 *
 * @param {string} frequency - 'daily' | 'weekdays' | 'weekly'
 * @param {string} startDateStr - 'YYYY-MM-DD'
 * @param {string} endDateStr - 'YYYY-MM-DD'
 * @returns {number} Count of occurrences
 */
export function calculateTotalCycles(frequency, startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return 1;

  const start = new Date(`${startDateStr}T00:00:00`);
  const end = new Date(`${endDateStr}T23:59:59`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return 1;

  let count = 0;
  const cursor = new Date(start);

  while (cursor <= end) {
    const day = cursor.getDay();
    if (frequency === RECURRING_FREQUENCY.WEEKDAYS) {
      if (day !== 0 && day !== 6) count++;
    } else if (frequency === RECURRING_FREQUENCY.WEEKLY) {
      count++;
      cursor.setDate(cursor.getDate() + 6); // advance by week
    } else {
      // Daily
      count++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return Math.max(1, count);
}

/**
 * Generates a human-friendly sentence summarizing the recurrence.
 * E.g. "Daily at 09:00 AM from 11 Nov to 18 Nov (7 follow-ups total)"
 */
export function formatRecurrenceSummary(config) {
  if (!config) return '';

  const { frequency = 'daily', timeOfDay = '09:00', startDate, endDate } = config;

  // Format 12-hour time
  const [h, m] = (timeOfDay || '09:00').split(':').map((n) => parseInt(n, 10) || 0);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const timeStr = `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;

  let freqStr = 'Every day';
  if (frequency === 'weekdays') freqStr = 'Weekdays only (Mon-Fri)';
  if (frequency === 'weekly') freqStr = 'Every week';

  const startStr = startDate ? new Date(`${startDate}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Today';
  const endStr = endDate ? new Date(`${endDate}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Ongoing';

  const total = calculateTotalCycles(frequency, startDate, endDate);

  return `${freqStr} at ${timeStr} from ${startStr} to ${endStr} (${total} follow-up${total !== 1 ? 's' : ''} total).`;
}
