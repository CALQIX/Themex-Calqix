/* CALQIX — In-stock countdown ticker
 * Renders "order within Xhr | Ymin, receive: D mon" on the PDP.
 * Receive date = today + 3 business days (Mon–Fri).
 * Country exception: NL & BE count weekends as delivery days
 * (NL/BE postal services deliver on Saturday).
 *
 * Liquid renders the localised template into the [data-cx-template] attribute
 * with __H__ / __M__ / __D__ placeholders, and a comma-separated months list
 * into [data-cx-months]. We replace those tokens client-side every 30s.
 */
(function () {
  'use strict';

  var WEEKEND_DELIVERY_COUNTRIES = ['NL', 'BE'];
  var BUSINESS_DAY_OFFSET = 3;
  var TICK_MS = 30 * 1000;
  var FALLBACK_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function decodeEntities(str) {
    if (!str) return '';
    var t = document.createElement('textarea');
    t.innerHTML = str;
    return t.value;
  }

  function computeReceiveDate(country) {
    var date = new Date();
    var iso = (country || '').toUpperCase();
    var weekendCounts = WEEKEND_DELIVERY_COUNTRIES.indexOf(iso) >= 0;
    var added = 0;
    var safety = 0;
    while (added < BUSINESS_DAY_OFFSET && safety < 14) {
      date.setDate(date.getDate() + 1);
      var day = date.getDay(); // 0 = Sunday, 6 = Saturday
      if (weekendCounts || (day !== 0 && day !== 6)) {
        added++;
      }
      safety++;
    }
    return date;
  }

  function computeCountdown() {
    var now = new Date();
    var endOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23, 59, 0, 0
    );
    var diffMs = Math.max(0, endOfDay.getTime() - now.getTime());
    var totalMin = Math.max(1, Math.ceil(diffMs / 60000));
    return {
      hours: Math.floor(totalMin / 60),
      minutes: totalMin % 60
    };
  }

  function renderNode(node) {
    var detail = node.querySelector('[data-cx-stock-detail]');
    if (!detail) return;

    var template = decodeEntities(node.getAttribute('data-cx-template') || '');
    if (!template) return;

    var monthsRaw = decodeEntities(node.getAttribute('data-cx-months') || '');
    var months = monthsRaw
      ? monthsRaw.split(',').map(function (s) { return s.trim(); })
      : [];
    if (months.length !== 12) months = FALLBACK_MONTHS;

    var country = node.getAttribute('data-cx-country') || '';
    var cd = computeCountdown();
    var receive = computeReceiveDate(country);
    var dateStr = receive.getDate() + ' ' + months[receive.getMonth()];

    var output = template
      .replace(/__H__/g, String(cd.hours))
      .replace(/__M__/g, String(cd.minutes))
      .replace(/__D__/g, dateStr);

    if (detail.textContent !== output) {
      detail.textContent = output;
    }
  }

  function init() {
    var nodes = document.querySelectorAll('[data-cx-stock-countdown]');
    if (!nodes.length) return;
    var list = Array.prototype.slice.call(nodes);
    list.forEach(renderNode);
    setInterval(function () { list.forEach(renderNode); }, TICK_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
