/* Work Documents — shared page behaviour.
   - Fits the fixed A4 .sheet to any screen width (Fit) or shows it at 100%.
   - Exports the sheet as PDF / PNG and prints it, replacing form fields with
     plain text first so the output looks like a finished document.
   - Pages can override any toolbar action via WD.handlers[action]. */
(function () {
  'use strict';
  var WD = window.WD = window.WD || {};
  WD.handlers = WD.handlers || {};

  var SHEET_W = 794;          // A4 width in CSS px (210mm @ 96dpi)
  var A4_RATIO = 297 / 210;
  var zoomMode = 'fit';
  try { zoomMode = localStorage.getItem('wd-zoom') || 'fit'; } catch (e) {}

  function sheet() { return document.querySelector('.sheet'); }
  function stage() { return document.querySelector('.stage'); }

  /* ---------- Fit to screen ---------- */
  function fit() {
    var sh = sheet(), st = stage();
    if (!sh || !st) return;
    var cs = getComputedStyle(st);
    var avail = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var s = zoomMode === 'fit' ? Math.min(1, avail / SHEET_W) : 1;
    sh.style.zoom = String(Math.round(s * 1000) / 1000);
    document.querySelectorAll('[data-action="fit"],[data-action="actual"]').forEach(function (b) {
      b.setAttribute('aria-pressed', String((b.dataset.action === 'fit') === (zoomMode === 'fit')));
    });
  }
  WD.fit = fit;
  function setZoom(mode) {
    zoomMode = mode;
    try { localStorage.setItem('wd-zoom', mode); } catch (e) {}
    fit();
  }

  /* ---------- Freeze fields into text ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  WD.formatDate = function (iso) {           // 2026-11-13 -> 13/11/2026
    if (!iso) return '';
    var p = iso.split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
  };
  WD.today = function () {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  function shownValue(el) {
    if (el.tagName === 'SELECT') return el.selectedIndex >= 0 ? el.options[el.selectedIndex].text : '';
    if (el.type === 'date') return WD.formatDate(el.value);
    return el.value;
  }
  function freeze(root) {
    var undo = [];
    root.querySelectorAll('[data-no-export]').forEach(function (el) {
      var prev = el.style.display;
      el.style.display = 'none';
      undo.push(function () { el.style.display = prev; });
    });
    root.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (el.type === 'file' || el.type === 'hidden' || el.offsetParent === null) return;
      var cs = getComputedStyle(el);
      var span = document.createElement('span');
      span.className = 'frozen' + (el.tagName === 'TEXTAREA' || el.dataset.block !== undefined ? ' block' : '');
      span.textContent = shownValue(el);
      span.style.fontWeight = cs.fontWeight;
      span.style.fontStyle = cs.fontStyle;
      span.style.fontFamily = cs.fontFamily;
      span.style.fontSize = cs.fontSize;
      span.style.textAlign = cs.textAlign;
      // Keep the field's width so the layout doesn't shift, unless the text is longer.
      if (el.tagName === 'INPUT' && el.type !== 'date' && el.type !== 'time' && el.scrollWidth <= el.clientWidth + 1) {
        span.style.width = el.offsetWidth + 'px';
      }
      el.insertAdjacentElement('afterend', span);
      var prev = el.style.display;
      el.style.display = 'none';
      undo.push(function () { span.remove(); el.style.display = prev; });
    });
    return function () { undo.reverse().forEach(function (f) { f(); }); };
  }
  WD.freeze = freeze;

  /* ---------- Export helpers ---------- */
  WD.download = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  };
  WD.filename = function (ext) {
    var sh = sheet();
    var base = (sh && sh.dataset.filename) || document.title || 'document';
    var from = sh && sh.dataset.filenameFrom && document.querySelector(sh.dataset.filenameFrom);
    if (from && from.value.trim()) base += '-' + from.value.trim();
    base = base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return base + '-' + WD.today() + '.' + ext;
  };

  async function captureSheet() {
    var sh = sheet();
    var y = window.scrollY;
    sh.style.zoom = '1';
    var unfreeze = freeze(sh);
    window.scrollTo(0, 0);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      return await window.html2canvas(sh, {
        scale: 2, backgroundColor: '#ffffff', logging: false,
        windowWidth: Math.max(1024, sh.offsetWidth + 64),
        scrollX: 0, scrollY: 0
      });
    } finally {
      unfreeze();
      fit();
      window.scrollTo(0, y);
    }
  }

  WD.canvasToPdf = function (canvas, opts) {
    opts = opts || {};
    var jsPDF = window.jspdf.jsPDF;
    if (opts.fitImage) {                    // one page, sized to the image
      var w = 210, h = 210 * canvas.height / canvas.width;
      var pdf1 = new jsPDF({ unit: 'mm', format: [w, h], orientation: h >= w ? 'portrait' : 'landscape' });
      pdf1.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, w, h);
      return pdf1;
    }
    var pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    var pageH = Math.round(canvas.width * A4_RATIO);
    var slice = document.createElement('canvas');
    slice.width = canvas.width; slice.height = pageH;
    var ctx = slice.getContext('2d');
    for (var y = 0, n = 0; canvas.height - y > 8; y += pageH, n++) {
      var h2 = Math.min(pageH, canvas.height - y);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, y, canvas.width, h2, 0, 0, canvas.width, h2);
      if (n > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
    }
    return pdf;
  };

  /* ---------- Default actions for .sheet pages ---------- */
  var defaults = {
    fit: function () { setZoom('fit'); },
    actual: function () { setZoom('actual'); },
    lock: function () {
      try { sessionStorage.removeItem('wd-key'); } catch (e) {}
      location.href = new URL('../', document.querySelector('script[src*="assets/doc.js"]').src).href;
    },
    pdf: async function () {
      var canvas = await captureSheet();
      WD.download(WD.canvasToPdf(canvas).output('blob'), WD.filename('pdf'));
    },
    png: async function () {
      var canvas = await captureSheet();
      var blob = await new Promise(function (r) { canvas.toBlob(r, 'image/png'); });
      WD.download(blob, WD.filename('png'));
    },
    print: function () { window.print(); }
  };

  // Printing from the button or the browser menu: plain text, real A4 size.
  var unfreezePrint = null;
  window.addEventListener('beforeprint', function () {
    if (WD.handlers.beforeprint) return WD.handlers.beforeprint();
    var sh = sheet();
    if (!sh || unfreezePrint) return;
    sh.style.zoom = '1';
    unfreezePrint = freeze(sh);
  });
  window.addEventListener('afterprint', function () {
    if (WD.handlers.afterprint) return WD.handlers.afterprint();
    if (unfreezePrint) { unfreezePrint(); unfreezePrint = null; }
    fit();
  });

  document.addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;
    var fn = WD.handlers[action] || defaults[action];
    if (!fn) return;
    e.preventDefault();
    var label = btn.textContent;
    var slow = action === 'pdf' || action === 'png' || action === 'image';
    if (slow) { btn.disabled = true; btn.textContent = 'Working…'; }
    try { await fn(btn); }
    catch (err) { console.error(err); alert('Sorry, that did not work: ' + (err && err.message ? err.message : err)); }
    finally { if (slow) { btn.disabled = false; btn.textContent = label; } }
  });

  window.addEventListener('resize', fit);
  if (window.ResizeObserver && stage()) new ResizeObserver(fit).observe(stage());
  fit();
})();
