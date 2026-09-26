/*
 * Shared helpers: ids, dates (device local time), Indian money formatting,
 * text search, CSV export and file helpers.
 *
 * Date conventions used everywhere in the app:
 *   date      -> 'YYYY-MM-DD'        (e.g. expense date)
 *   datetime  -> 'YYYY-MM-DDTHH:mm'  (e.g. check-in / check-out, matches <input type="datetime-local">)
 * Both are interpreted in the device's local time zone.
 */
(function (App) {
  'use strict';

  const pad = (n, w = 2) => String(n).padStart(w, '0');

  // ---------------------------------------------------------------- ids
  function uid(prefix) {
    let rnd = '';
    try {
      const a = new Uint32Array(2);
      crypto.getRandomValues(a);
      rnd = a[0].toString(36) + a[1].toString(36);
    } catch (e) {
      rnd = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
    return (prefix ? prefix + '_' : '') + Date.now().toString(36) + rnd.slice(0, 8);
  }

  // ---------------------------------------------------------------- dates
  function parse(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return new Date(v.getTime());
    if (typeof v === 'number') return new Date(v);
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
    if (!m) {
      const d = new Date(v);
      return isNaN(d) ? null : d;
    }
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  const dateStr = (v = new Date()) => {
    const d = parse(v);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const dtStr = (v = new Date()) => {
    const d = parse(v);
    return `${dateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const timeStr = (v) => {
    const d = parse(v);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const today = () => dateStr(new Date());
  const now = () => dtStr(new Date());
  const datePart = (v) => (typeof v === 'string' ? v.slice(0, 10) : dateStr(v));

  function addDays(v, n) {
    const d = parse(v);
    d.setDate(d.getDate() + n);
    return dateStr(d);
  }
  function addDaysDT(v, n) {
    const d = parse(v);
    d.setDate(d.getDate() + n);
    return dtStr(d);
  }
  function addHours(v, h) {
    return dtStr(new Date(parse(v).getTime() + h * 36e5));
  }
  /** Whole calendar days from a to b (ignores time of day, DST-safe). */
  function diffDays(a, b) {
    const x = parse(a), y = parse(b);
    return Math.round(
      (Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) -
        Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 864e5
    );
  }
  const combine = (date, time) => `${datePart(date)}T${time || '12:00'}`;
  /** Dates in [start, end) as 'YYYY-MM-DD' strings. */
  function datesBetween(start, end) {
    const out = [];
    const n = diffDays(start, end);
    for (let i = 0; i < n; i++) out.push(addDays(start, i));
    return out;
  }
  function startOfWeek(v) {
    const d = parse(v);
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    return addDays(dateStr(d), -dow);
  }
  const startOfMonth = (v) => datePart(v).slice(0, 8) + '01';
  function endOfMonth(v) {
    const d = parse(startOfMonth(v));
    return dateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }
  /** Indian financial year (April - March), e.g. '2026-27'. */
  function fy(v = today()) {
    const d = parse(v);
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  }
  const fyShort = (v) => fy(v).slice(2);
  const fyStart = (v) => fy(v).slice(0, 4) + '-04-01';

  const fmtCache = {};
  function dtf(opts) {
    const k = JSON.stringify(opts);
    return fmtCache[k] || (fmtCache[k] = new Intl.DateTimeFormat('en-IN', opts));
  }
  const fmtDate = (v) => (v ? dtf({ day: 'numeric', month: 'short', year: 'numeric' }).format(parse(v)) : '—');
  const fmtDateShort = (v) => (v ? dtf({ day: 'numeric', month: 'short' }).format(parse(v)) : '—');
  const fmtWeekday = (v) => dtf({ weekday: 'short' }).format(parse(v));
  const fmtDayMonth = (v) => dtf({ weekday: 'short', day: 'numeric', month: 'short' }).format(parse(v));
  const fmtMonth = (v) => dtf({ month: 'long', year: 'numeric' }).format(parse(v));
  const fmtTime = (v) => (v ? dtf({ hour: 'numeric', minute: '2-digit', hour12: true }).format(parse(v)) : '—');
  const fmtDateTime = (v) => (v ? `${fmtDateShort(v)}, ${fmtTime(v)}` : '—');
  const fmtDateTimeFull = (v) => (v ? `${fmtDate(v)}, ${fmtTime(v)}` : '—');
  function relDate(v) {
    if (!v) return '—';
    const d = diffDays(today(), v);
    if (d === 0) return 'Today';
    if (d === 1) return 'Tomorrow';
    if (d === -1) return 'Yesterday';
    return fmtDateShort(v) + (parse(v).getFullYear() !== new Date().getFullYear() ? ' ' + parse(v).getFullYear() : '');
  }
  function timeAgo(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return fmtDate(ms);
  }
  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  // ---------------------------------------------------------------- numbers & money
  const round2 = (n) => Math.round(((+n || 0) + Number.EPSILON) * 100) / 100;
  const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0, minimumFractionDigits: 0 });
  const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const num2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
  /** ₹ formatting. decimals: undefined = auto (0 for whole rupees, else 2). */
  function money(n, decimals) {
    n = round2(n) || 0; // also turns -0 into 0
    if (decimals === 2 || (decimals === undefined && Math.round(n) !== n)) return inr2.format(n);
    return inr0.format(n);
  }
  const amount = (n) => num2.format(round2(n) || 0); // 1,234.50 (no symbol) for invoices
  const num = (n) => num0.format(+n || 0);
  const pct = (n) => num1.format(+n || 0) + '%';
  /** Compact ₹: 1.2L, 3.4Cr, 12.5K */
  function moneyShort(n) {
    n = +n || 0;
    const a = Math.abs(n);
    if (a >= 1e7) return '₹' + num1.format(n / 1e7) + 'Cr';
    if (a >= 1e5) return '₹' + num1.format(n / 1e5) + 'L';
    if (a >= 1e3) return '₹' + num1.format(n / 1e3) + 'K';
    return money(n, 0);
  }

  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
  function three(n) {
    const h = Math.floor(n / 100), r = n % 100;
    return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : '');
  }
  function intInWords(n) {
    if (n === 0) return 'Zero';
    const parts = [];
    const crore = Math.floor(n / 1e7); n %= 1e7;
    const lakh = Math.floor(n / 1e5); n %= 1e5;
    const thousand = Math.floor(n / 1e3); n %= 1e3;
    if (crore) parts.push(intInWords(crore) + ' Crore');
    if (lakh) parts.push(two(lakh) + ' Lakh');
    if (thousand) parts.push(two(thousand) + ' Thousand');
    if (n) parts.push(three(n));
    return parts.join(' ');
  }
  /** 4250.5 -> "Rupees Four Thousand Two Hundred Fifty and Fifty Paise Only" (Indian numbering) */
  function amountInWords(value) {
    const v = Math.abs(round2(value));
    const rupees = Math.floor(v);
    const paise = Math.round((v - rupees) * 100);
    let s = 'Rupees ' + intInWords(rupees);
    if (paise) s += ' and ' + two(paise) + ' Paise';
    return s + ' Only';
  }

  // ---------------------------------------------------------------- text
  const initials = (name) =>
    (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
  const norm = (s) => (s == null ? '' : String(s)).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  /** Every word of the query must appear somewhere in the fields. */
  function matches(query, ...fields) {
    const q = norm(query).trim();
    if (!q) return true;
    const list = fields.filter((f) => f != null && f !== '');
    const hay = norm(list.join(' ')) + ' ' + list.map((f) => digits(f)).filter(Boolean).join(' ');
    return q.split(/\s+/).every((t) => hay.includes(t));
  }
  const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');
  function phoneDisplay(p) {
    const d = digits(p);
    if (d.length === 10) return d.slice(0, 5) + ' ' + d.slice(5);
    if (d.length === 12 && d.startsWith('91')) return '+91 ' + d.slice(2, 7) + ' ' + d.slice(7);
    return p || '';
  }
  function waLink(phone, text) {
    let d = digits(phone);
    if (d.length === 10) d = '91' + d;
    return `https://wa.me/${d}` + (text ? `?text=${encodeURIComponent(text)}` : '');
  }
  const telLink = (phone) => 'tel:' + String(phone || '').replace(/[^\d+]/g, '');
  function maskId(v) {
    const s = String(v || '').replace(/\s+/g, '');
    if (s.length <= 4) return s;
    return '•'.repeat(Math.min(8, s.length - 4)) + s.slice(-4);
  }
  const cls = (...a) => a.filter(Boolean).join(' ');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const titleCase = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());

  // ---------------------------------------------------------------- arrays
  const sum = (arr, fn) => arr.reduce((t, x) => t + (+(fn ? fn(x) : x) || 0), 0);
  function groupBy(arr, fn) {
    const m = new Map();
    for (const x of arr) {
      const k = fn(x);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x);
    }
    return m;
  }
  function sortBy(arr, fn, dir = 1) {
    return [...arr].sort((a, b) => {
      const x = fn(a), y = fn(b);
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
  }
  const uniq = (arr) => [...new Set(arr)];
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }
  /** Natural room-number sort: 9 < 10 < 101 < A1 */
  const natCmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

  // ---------------------------------------------------------------- files
  function download(filename, data, mime = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  /** rows -> CSV (with BOM so Excel shows ₹ correctly). cols: [{label, value: row => any}] */
  function toCSV(rows, cols) {
    const esc = (v) => {
      if (v == null) v = '';
      if (typeof v === 'number') return String(v);
      v = String(v);
      // neutralise spreadsheet formula injection
      if (/^[=+@\t\r]/.test(v) || (/^-/.test(v) && isNaN(+v))) v = "'" + v;
      return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const head = cols.map((c) => esc(c.label)).join(',');
    const body = rows.map((r) => cols.map((c) => esc(c.value(r))).join(','));
    return '\ufeff' + [head, ...body].join('\r\n');
  }
  const readText = (file) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsText(file);
    });
  /** Downscale an image file to fit max x max and return a PNG data URL. */
  function resizeImage(file, max = 320) {
    return new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * s));
        c.height = Math.max(1, Math.round(img.height * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/png'));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        rej(new Error('Could not read image'));
      };
      img.src = url;
    });
  }
  const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

  App.U = {
    pad, uid,
    parse, dateStr, dtStr, timeStr, today, now, datePart, addDays, addDaysDT, addHours, diffDays, combine, datesBetween,
    startOfWeek, startOfMonth, endOfMonth, fy, fyShort, fyStart,
    fmtDate, fmtDateShort, fmtWeekday, fmtDayMonth, fmtMonth, fmtTime, fmtDateTime, fmtDateTimeFull, relDate, timeAgo, greeting,
    round2, money, moneyShort, amount, num, pct, amountInWords,
    initials, norm, matches, digits, phoneDisplay, waLink, telLink, maskId, cls, plural, titleCase,
    sum, groupBy, sortBy, uniq, clamp, debounce, natCmp,
    download, toCSV, readText, resizeImage, clone,
  };
})(window.App = window.App || {});
