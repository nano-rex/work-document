/* Work Documents — unlock + render.
   Every page on the site is a stub. Its real content is in p/<page>.enc,
   encrypted with AES-256-GCM. The key comes from the password via PBKDF2-SHA256.
   The derived key (never the password) is kept in sessionStorage for this tab only. */
(function () {
  'use strict';
  var KEY_SLOT = 'wd-key';
  var page = document.documentElement.getAttribute('data-page') || 'index';
  var te = new TextEncoder();
  // Site root, worked out from this script's own URL (…/assets/lock.js), so the
  // site works at a domain root (Netlify) and under a subpath (GitHub Pages).
  var ROOT = new URL('../', document.currentScript.src).href;

  function b64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(buf) {
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function store(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }

  var vaultP = fetch(ROOT + 'vault.json', { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error('vault ' + r.status);
    return r.json();
  });
  var payloadP = fetch(ROOT + 'p/' + encodeURIComponent(page) + '.enc', { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error('page ' + r.status);
    return r.arrayBuffer();
  });
  // Avoid unhandled-rejection noise; errors are surfaced where awaited.
  vaultP.catch(function () {}); payloadP.catch(function () {});

  async function deriveKey(password) {
    var v = await vaultP;
    var base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64ToBytes(v.salt), iterations: v.iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }

  async function decrypt(key) {
    var buf = new Uint8Array(await payloadP);
    var pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf.subarray(0, 12), additionalData: te.encode(page) },
      key, buf.subarray(12));
    return new TextDecoder().decode(pt);
  }

  async function render(html) {
    // Point root-relative links (href="/…", src="/…") at the site root.
    html = html.replace(/(\s(?:href|src)=["'])\/(?!\/)/g, '$1' + ROOT);
    var doc = new DOMParser().parseFromString(html, 'text/html');
    document.title = doc.title || document.title;
    if (doc.documentElement.lang) document.documentElement.lang = doc.documentElement.lang;
    document.head.replaceWith(document.adoptNode(doc.head));
    document.body.replaceWith(document.adoptNode(doc.body));
    // Scripts from DOMParser are inert: recreate them so they run, in document order.
    var scripts = Array.prototype.slice.call(document.querySelectorAll('script'));
    for (var i = 0; i < scripts.length; i++) {
      var old = scripts[i], s = document.createElement('script');
      for (var j = 0; j < old.attributes.length; j++) s.setAttribute(old.attributes[j].name, old.attributes[j].value);
      if (old.src) {
        await new Promise(function (resolve) { s.onload = s.onerror = resolve; old.replaceWith(s); });
      } else {
        s.textContent = old.textContent;
        old.replaceWith(s);
      }
    }
  }

  function showForm(message, isError) {
    var main = document.querySelector('.lock');
    var form = document.getElementById('unlock');
    var pw = document.getElementById('pw');
    var msg = document.getElementById('msg');
    var btn = form.querySelector('button');
    main.hidden = false;
    msg.textContent = message || '';
    msg.className = 'lock-msg' + (isError ? ' error' : '');
    pw.focus();
    form.onsubmit = async function (e) {
      e.preventDefault();
      btn.disabled = true; pw.disabled = true;
      msg.className = 'lock-msg'; msg.textContent = 'Unlocking…';
      try {
        var key = await deriveKey(pw.value);
        var html = await decrypt(key);
        store(KEY_SLOT, bytesToB64(await crypto.subtle.exportKey('raw', key)));
        await render(html);
      } catch (err) {
        btn.disabled = false; pw.disabled = false;
        msg.className = 'lock-msg error';
        msg.textContent = (err && err.name === 'OperationError') ? 'Wrong password.' : 'Could not load the page. Check your connection and try again.';
        pw.select();
      }
    };
  }

  async function start() {
    if (!window.crypto || !crypto.subtle) {
      showForm('This browser cannot open encrypted pages (needs HTTPS and a modern browser).', true);
      return;
    }
    var saved = load(KEY_SLOT);
    if (saved) {
      try {
        var key = await crypto.subtle.importKey('raw', b64ToBytes(saved), 'AES-GCM', false, ['decrypt']);
        await render(await decrypt(key));
        return;
      } catch (err) {
        if (err && err.name === 'OperationError') store(KEY_SLOT, null); // site was rebuilt with a new password
        else { showForm('Could not load the page. Check your connection and try again.', true); return; }
      }
    }
    showForm('');
  }

  start();
})();
