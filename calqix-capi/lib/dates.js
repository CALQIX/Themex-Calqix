var AMSTERDAM_TZ = 'Europe/Amsterdam';

/**
 * Date formatting utilities — DD-MM-YYYY format everywhere.
 *
 * All dates in CALQIX use DD-MM-YYYY for display, Redis keys, and Telegram.
 * External APIs may return other formats; convert before storing/displaying.
 */

/**
 * Format a Date as DD-MM-YYYY.
 * @param {Date} [date] - defaults to now
 * @returns {string} e.g. "04-04-2026"
 */
function formatDate(date) {
  var d = date || new Date();
  var day = d.getDate().toString().padStart(2, '0');
  var month = (d.getMonth() + 1).toString().padStart(2, '0');
  var year = d.getFullYear();
  return day + '-' + month + '-' + year;
}

/**
 * Format a Date as DD-MM-YYYY HH:mm.
 * @param {Date} [date] - defaults to now
 * @returns {string} e.g. "04-04-2026 13:05"
 */
function formatDateTime(date) {
  var d = date || new Date();
  return formatDate(d) + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

/**
 * Format a Date as DD-MM-YYYY in Amsterdam timezone.
 * @param {Date} [date] - defaults to now
 * @returns {string}
 */
function formatDateAmsterdam(date) {
  return todayKey(date);
}

/**
 * Format a Date as DD-MM-YYYY HH:mm in Amsterdam timezone.
 * @param {Date} [date] - defaults to now
 * @returns {string}
 */
function formatDateTimeAmsterdam(date) {
  var d = date || new Date();
  try {
    var opts = { timeZone: AMSTERDAM_TZ, hour12: false };
    var parts = {};
    var fmt = new Intl.DateTimeFormat('en-GB', Object.assign({ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }, opts));
    var formatted = fmt.format(d);
    // en-GB gives "DD/MM/YYYY, HH:mm"
    var match = formatted.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2})/);
    if (match) {
      return match[1] + '-' + match[2] + '-' + match[3] + ' ' + match[4] + ':' + match[5];
    }
  } catch (e) { /* fallback below */ }
  return formatDateTime(d);
}

/**
 * Get Amsterdam hour from a Date.
 * @param {Date} [date]
 * @returns {number} 0-23
 */
function getAmsterdamHour(date) {
  var d = date || new Date();
  try {
    var fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: AMSTERDAM_TZ });
    return parseInt(fmt.format(d), 10);
  } catch (e) {
    return (d.getUTCHours() + 2) % 24;
  }
}

/**
 * Get today's date key in DD-MM-YYYY format (Amsterdam timezone).
 * @param {Date} [date]
 * @returns {string}
 */
function todayKey(date) {
  var d = date || new Date();
  try {
    var fmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: AMSTERDAM_TZ });
    var formatted = fmt.format(d);
    var match = formatted.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) return match[1] + '-' + match[2] + '-' + match[3];
  } catch (e) { /* fallback */ }
  return formatDate(d);
}

/**
 * Get YYYY-MM-DD for the Amsterdam business day.
 * Use this for dashboard labels and Redis day keys where "today" should
 * match the Shopify/Meta operator view instead of UTC.
 * @param {Date} [date]
 * @returns {string}
 */
function toISODateAmsterdam(date) {
  var d = date || new Date();
  try {
    var parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: AMSTERDAM_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(d).forEach(function (part) {
      if (part.type !== 'literal') parts[part.type] = part.value;
    });
    if (parts.year && parts.month && parts.day) {
      return parts.year + '-' + parts.month + '-' + parts.day;
    }
  } catch (e) {
    return toISODate(d);
  }
  return toISODate(d);
}

/**
 * Add whole Amsterdam calendar days to an ISO date.
 * Noon UTC avoids date-boundary drift around DST changes.
 * @param {string} isoDate - YYYY-MM-DD
 * @param {number} days
 * @returns {string}
 */
function addDaysISODateAmsterdam(isoDate, days) {
  var base;
  if (isoDate && /^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    base = new Date(isoDate + 'T12:00:00Z');
  } else {
    base = new Date();
  }
  var shifted = new Date(base.getTime() + (Number(days) || 0) * 86400000);
  return toISODateAmsterdam(shifted);
}

/**
 * Convert ISO date string (YYYY-MM-DD) to DD-MM-YYYY.
 * @param {string} isoStr
 * @returns {string}
 */
function isoToDisplay(isoStr) {
  if (!isoStr) return '';
  var parts = isoStr.split('T')[0].split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    return parts[2] + '-' + parts[1] + '-' + parts[0];
  }
  return isoStr;
}

/**
 * Get YYYY-MM-DD string for Meta API calls (they require ISO format).
 * @param {Date} [date]
 * @returns {string}
 */
function toISODate(date) {
  var d = date || new Date();
  return d.toISOString().split('T')[0];
}

module.exports = {
  formatDate: formatDate,
  formatDateTime: formatDateTime,
  formatDateAmsterdam: formatDateAmsterdam,
  formatDateTimeAmsterdam: formatDateTimeAmsterdam,
  getAmsterdamHour: getAmsterdamHour,
  todayKey: todayKey,
  isoToDisplay: isoToDisplay,
  toISODate: toISODate,
  toISODateAmsterdam: toISODateAmsterdam,
  addDaysISODateAmsterdam: addDaysISODateAmsterdam
};
