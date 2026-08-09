/* Boxly — QR box inventory.
   Everything lives in localStorage; no server, no accounts.
   Sections: utils · store · toasts & dialogs · qr · scanner · views · router. */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ utils */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function uid() {
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function relTime(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    var mins = Math.round(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hrs / 24);
    if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
    return new Date(ts).toLocaleDateString();
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  var ICON = {
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    scan: '<svg viewBox="0 0 24 24"><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><path d="M7.5 12h9"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 19 8 12l7-7"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
    print: '<svg viewBox="0 0 24 24"><path d="M7 9V4h10v5M7 18H5a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M3 7.2 12 3l9 4.2v9.6L12 21l-9-4.2V7.2Z"/><path d="M3 7.2 12 11.4l9-4.2M12 11.4V21"/></svg>'
  };

  /* ------------------------------------------------------------------ store */

  var KEY = 'boxly.v1';

  var state = {
    version: 1,
    boxes: [],
    settings: { lastLocation: '', quickAssign: false, labelSize: 'm', theme: 'system', sort: 'updated' }
  };

  function load() {
    var raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.boxes)) {
        state.boxes = parsed.boxes.map(normalizeBox);
        if (parsed.settings) Object.assign(state.settings, parsed.settings);
      }
    } catch (e) {
      toast('Saved data could not be read — starting empty.', 'warn');
    }
  }

  var save = debounce(function () {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      toast('Could not save — device storage is full or blocked.', 'warn');
    }
  }, 150);

  function normalizeBox(b) {
    return {
      id: b.id || uid(),
      code: String(b.code || '').trim(),
      name: b.name || '',
      location: b.location || '',
      notes: b.notes || '',
      items: Array.isArray(b.items) ? b.items.map(function (it) {
        if (typeof it === 'string') return { id: uid(), name: it, qty: 1 };
        return { id: it.id || uid(), name: it.name || '', qty: Number(it.qty) > 0 ? Number(it.qty) : 1 };
      }) : [],
      // Only the references live here; the image data itself is in IndexedDB.
      photos: Array.isArray(b.photos) ? b.photos.map(function (p) {
        return { id: p.id || uid(), w: p.w || 0, h: p.h || 0, addedAt: p.addedAt || Date.now() };
      }) : [],
      createdAt: b.createdAt || Date.now(),
      updatedAt: b.updatedAt || b.createdAt || Date.now()
    };
  }

  function boxById(id) {
    for (var i = 0; i < state.boxes.length; i++) if (state.boxes[i].id === id) return state.boxes[i];
    return null;
  }

  function boxByCode(code) {
    var c = String(code || '').trim().toLowerCase();
    if (!c) return null;
    for (var i = 0; i < state.boxes.length; i++) {
      if (state.boxes[i].code.toLowerCase() === c) return state.boxes[i];
    }
    return null;
  }

  function touch(box) {
    box.updatedAt = Date.now();
    save();
  }

  function createBox(fields) {
    var box = normalizeBox(Object.assign({ code: nextCode(), createdAt: Date.now() }, fields || {}));
    state.boxes.push(box);
    save();
    return box;
  }

  function deleteBox(id) {
    var box = boxById(id);
    if (box && box.photos.length) {
      photos.remove(box.photos.map(function (p) { return p.id; }));
    }
    state.boxes = state.boxes.filter(function (b) { return b.id !== id; });
    save();
  }

  /* Short, human-readable code for boxes we label ourselves.
     Ambiguous characters (0/O, 1/I) are left out so codes can be typed by hand. */
  var ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  function nextCode() {
    for (var attempt = 0; attempt < 50; attempt++) {
      var s = 'BX-';
      for (var i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      if (!boxByCode(s)) return s;
    }
    return 'BX-' + Date.now().toString(36).toUpperCase();
  }

  function locations() {
    var map = Object.create(null);
    state.boxes.forEach(function (b) {
      var name = b.location.trim();
      if (!name) return;
      var k = name.toLowerCase();
      if (!map[k]) map[k] = { name: name, boxes: [] };
      map[k].boxes.push(b);
    });
    return Object.keys(map).sort().map(function (k) { return map[k]; });
  }

  function itemCount(box) {
    return box.items.reduce(function (n, it) { return n + (it.qty || 1); }, 0);
  }

  function boxTitle(box) {
    return box.name.trim() || box.code || 'Untitled box';
  }

  /* Search across code, name, location, notes and item names.
     Every term has to match somewhere — that makes "kitchen mugs" behave the way people expect. */
  function searchBoxes(query) {
    var q = query.trim().toLowerCase();
    if (!q) return state.boxes.slice();
    var terms = q.split(/\s+/);
    return state.boxes.filter(function (b) {
      var hay = [b.code, b.name, b.location, b.notes]
        .concat(b.items.map(function (i) { return i.name; }))
        .join('  ').toLowerCase();
      return terms.every(function (t) { return hay.indexOf(t) !== -1; });
    }).map(function (b) {
      var score = 0;
      if (b.code.toLowerCase() === q) score += 100;
      if (b.name.toLowerCase().indexOf(q) === 0) score += 40;
      if (b.name.toLowerCase().indexOf(q) !== -1) score += 20;
      if (b.items.some(function (i) { return i.name.toLowerCase().indexOf(q) !== -1; })) score += 12;
      if (b.location.toLowerCase().indexOf(q) !== -1) score += 8;
      return { box: b, score: score };
    }).sort(function (a, b) {
      return b.score - a.score || b.box.updatedAt - a.box.updatedAt;
    }).map(function (r) { return r.box; });
  }

  function sortBoxes(list, mode) {
    var copy = list.slice();
    if (mode === 'name') {
      copy.sort(function (a, b) { return boxTitle(a).localeCompare(boxTitle(b), undefined, { numeric: true }); });
    } else if (mode === 'location') {
      copy.sort(function (a, b) {
        var al = a.location || '￿', bl = b.location || '￿';
        return al.localeCompare(bl, undefined, { numeric: true }) || boxTitle(a).localeCompare(boxTitle(b));
      });
    } else {
      copy.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    }
    return copy;
  }

  /* Turns "3x mugs" or "mugs x3" into a quantity plus a name. */
  function parseItem(text) {
    var s = text.trim();
    var m = s.match(/^(\d+)\s*[x×*]\s*(.+)$/i) || s.match(/^(.+?)\s*[x×]\s*(\d+)$/i);
    if (m) {
      var qty = parseInt(/^\d/.test(m[1]) ? m[1] : m[2], 10);
      var name = /^\d/.test(m[1]) ? m[2] : m[1];
      if (qty > 0 && name.trim()) return { name: name.trim(), qty: qty };
    }
    return { name: s, qty: 1 };
  }

  function addItems(box, text) {
    var added = 0;
    text.split(/[\n,;]+/).forEach(function (part) {
      var t = part.trim();
      if (!t) return;
      var parsed = parseItem(t);
      box.items.push({ id: uid(), name: parsed.name, qty: parsed.qty });
      added++;
    });
    if (added) touch(box);
    return added;
  }

  /* ----------------------------------------------------------------- photos

     Photographs are far too big for localStorage — a handful of them would blow
     the quota and take the whole inventory down with them. The pictures live in
     IndexedDB instead, keyed by photo id, and each one is stored twice: a full
     size for looking at and a thumbnail so lists stay quick. */

  var photos = {
    DB: 'boxly-photos',
    STORE: 'photos',
    MAX_EDGE: 1600,
    THUMB_EDGE: 320,
    db: null,
    blocked: false,

    open: function () {
      var self = this;
      if (this.db) return Promise.resolve(this.db);
      if (this.blocked) return Promise.reject(new Error('unavailable'));
      return new Promise(function (resolve, reject) {
        var req;
        try { req = indexedDB.open(self.DB, 1); } catch (e) { self.blocked = true; return reject(e); }
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(self.STORE)) db.createObjectStore(self.STORE, { keyPath: 'id' });
        };
        req.onsuccess = function () { self.db = req.result; resolve(self.db); };
        req.onerror = function () { self.blocked = true; reject(req.error); };
        req.onblocked = function () { self.blocked = true; reject(new Error('blocked')); };
      });
    },

    tx: function (mode, fn) {
      var self = this;
      return this.open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(self.STORE, mode);
          var store = t.objectStore(self.STORE);
          var out = fn(store);
          t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
          t.onerror = function () { reject(t.error); };
          t.onabort = function () { reject(t.error || new Error('aborted')); };
        });
      });
    },

    put: function (record) {
      return this.tx('readwrite', function (store) { return store.put(record); });
    },

    get: function (id) {
      return this.tx('readonly', function (store) { return store.get(id); });
    },

    remove: function (ids) {
      var list = [].concat(ids);
      return this.tx('readwrite', function (store) {
        list.forEach(function (id) { store.delete(id); });
      }).catch(function () {});
    },

    all: function () {
      return this.tx('readonly', function (store) { return store.getAll(); });
    },

    clear: function () {
      return this.tx('readwrite', function (store) { return store.clear(); }).catch(function () {});
    },

    /* Phone cameras produce 4-12 megapixel files. Storing those as-is would fill
       the disk for no visible gain, so both sizes are re-encoded as JPEG. */
    ingest: function (file) {
      var self = this;
      return this.decode(file).then(function (img) {
        var full = self.render(img, self.MAX_EDGE, 0.82);
        var thumb = self.render(img, self.THUMB_EDGE, 0.72);
        if (img.close) img.close();
        return Promise.all([full.blob, thumb.blob]).then(function (blobs) {
          return { full: blobs[0], thumb: blobs[1], w: full.w, h: full.h };
        });
      });
    },

    decode: function (file) {
      if (window.createImageBitmap) {
        // Honours the EXIF rotation a phone writes instead of showing it sideways.
        return createImageBitmap(file, { imageOrientation: 'from-image' })
          .catch(function () { return createImageBitmap(file); })
          .catch(function () { return photos.decodeViaImg(file); });
      }
      return this.decodeViaImg(file);
    },

    decodeViaImg: function (file) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file is not an image we can read')); };
        img.src = url;
      });
    },

    render: function (img, maxEdge, quality) {
      var sw = img.width || img.naturalWidth;
      var sh = img.height || img.naturalHeight;
      var scale = Math.min(1, maxEdge / Math.max(sw, sh));
      var w = Math.max(1, Math.round(sw * scale));
      var h = Math.max(1, Math.round(sh * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      var blob = new Promise(function (resolve) {
        if (canvas.toBlob) canvas.toBlob(function (b) { resolve(b); }, 'image/jpeg', quality);
        else resolve(dataUrlToBlob(canvas.toDataURL('image/jpeg', quality)));
      });
      return { blob: blob, w: w, h: h };
    },

    /* Adds one file to a box: decode, shrink, store, then record the reference. */
    add: function (box, file) {
      var self = this;
      if (!/^image\//.test(file.type)) return Promise.reject(new Error('Only image files can be added'));
      return this.ingest(file).then(function (out) {
        var id = uid();
        return self.put({ id: id, full: out.full, thumb: out.thumb }).then(function () {
          box.photos.push({ id: id, w: out.w, h: out.h, addedAt: Date.now() });
          touch(box);
          return id;
        });
      });
    },

    detach: function (box, photoId) {
      box.photos = box.photos.filter(function (p) { return p.id !== photoId; });
      touch(box);
      return this.remove(photoId);
    }
  };

  /* Object URLs are handed out for display; every view that makes them registers
     them here so a re-render can hand the memory back. */
  var urlBag = {
    urls: [],
    make: function (blob) {
      var url = URL.createObjectURL(blob);
      this.urls.push(url);
      return url;
    },
    releaseAll: function () {
      this.urls.forEach(function (u) { URL.revokeObjectURL(u); });
      this.urls = [];
    }
  };

  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl).split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    var bin = atob(parts[1] || '');
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function photoCount() {
    return state.boxes.reduce(function (n, b) { return n + b.photos.length; }, 0);
  }

  /* ------------------------------------------------------- toasts & dialogs */

  function toast(msg, kind) {
    var host = $('#toasts');
    // Rapid-fire scanning can queue these up; two on screen is plenty.
    while (host.children.length >= 2) host.removeChild(host.firstChild);
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 320);
    }, 2400);
  }

  function confirmSheet(opts) {
    return new Promise(function (resolve) {
      var dlg = document.createElement('dialog');
      dlg.className = 'sheet';
      dlg.innerHTML =
        '<form method="dialog" class="sheet-inner">' +
          '<h2>' + esc(opts.title) + '</h2>' +
          '<p class="muted small">' + esc(opts.body || '') + '</p>' +
          (opts.input !== undefined
            ? '<label class="field" style="margin-top:14px"><span>' + esc(opts.inputLabel || 'Value') + '</span>' +
              '<input class="input" id="sheet-input" value="' + esc(opts.input) + '"></label>'
            : '') +
          '<div class="sheet-actions">' +
            '<button value="cancel" class="btn btn-ghost">Cancel</button>' +
            '<button value="ok" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '">' +
              esc(opts.confirm || 'Confirm') + '</button>' +
          '</div>' +
        '</form>';
      document.body.appendChild(dlg);
      dlg.addEventListener('close', function () {
        var val = dlg.returnValue === 'ok';
        var input = $('#sheet-input', dlg);
        var text = input ? input.value : null;
        dlg.remove();
        resolve(val ? (opts.input !== undefined ? text : true) : null);
      });
      dlg.showModal();
      var input = $('#sheet-input', dlg);
      if (input) { input.focus(); input.select(); }
    });
  }

  /* Full-size viewer. Also where a photo gets promoted to cover or thrown away. */
  function openPhotoViewer(box, photoId, onChange) {
    var index = box.photos.findIndex(function (p) { return p.id === photoId; });
    if (index < 0) return;

    var dlg = document.createElement('dialog');
    dlg.className = 'sheet viewer';
    dlg.innerHTML =
      '<div class="viewer-stage">' +
        '<img id="v-img" alt="">' +
        '<button class="viewer-nav prev" data-step="-1" aria-label="Previous photo">' +
          '<svg viewBox="0 0 24 24"><path d="M15 19 8 12l7-7"/></svg></button>' +
        '<button class="viewer-nav next" data-step="1" aria-label="Next photo">' +
          '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></button>' +
      '</div>' +
      '<div class="viewer-bar">' +
        '<span class="small muted" id="v-count"></span>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-sm" data-act="cover">Make cover</button>' +
        '<button class="btn btn-sm btn-danger" data-act="delete">' + ICON.trash + 'Delete</button>' +
        '<button class="btn btn-sm btn-ghost" data-act="close">Close</button>' +
      '</div>';
    document.body.appendChild(dlg);

    var shown = null;
    function paint() {
      if (!box.photos.length) { dlg.close(); return; }
      index = Math.max(0, Math.min(index, box.photos.length - 1));
      var photo = box.photos[index];
      $('#v-count', dlg).textContent = (index + 1) + ' of ' + box.photos.length +
        (index === 0 ? ' · cover' : '');
      $$('.viewer-nav', dlg).forEach(function (b) { b.hidden = box.photos.length < 2; });
      $('[data-act="cover"]', dlg).hidden = index === 0;  // already the cover
      photos.get(photo.id).then(function (rec) {
        if (!rec || !rec.full) return;
        if (shown) URL.revokeObjectURL(shown);
        shown = URL.createObjectURL(rec.full);
        var img = $('#v-img', dlg);
        img.src = shown;
        img.alt = 'Photo ' + (index + 1) + ' of ' + boxTitle(box);
      });
    }
    paint();

    dlg.addEventListener('click', function (e) {
      var step = e.target.closest('[data-step]');
      if (step) {
        index = (index + Number(step.getAttribute('data-step')) + box.photos.length) % box.photos.length;
        return paint();
      }
      var act = e.target.closest('[data-act]');
      if (!act) return;
      var which = act.getAttribute('data-act');
      if (which === 'close') return dlg.close();
      if (which === 'cover') {
        box.photos.unshift(box.photos.splice(index, 1)[0]);
        index = 0;
        touch(box);
        onChange();
        paint();
        toast('Cover photo set', 'ok');
      }
      if (which === 'delete') {
        photos.detach(box, box.photos[index].id);
        onChange();
        paint();
        toast('Photo deleted');
      }
    });

    dlg.addEventListener('keydown', function (e) {
      if (!box.photos.length || box.photos.length < 2) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        index = (index + (e.key === 'ArrowRight' ? 1 : -1) + box.photos.length) % box.photos.length;
        paint();
      }
    });

    dlg.addEventListener('close', function () {
      if (shown) URL.revokeObjectURL(shown);
      dlg.remove();
    });

    dlg.showModal();
  }

  /* --------------------------------------------------------------------- qr */

  if (window.qrcode && qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  }

  function qrSvg(text, cellSize, margin) {
    if (!window.qrcode || !text) return '';
    try {
      var qr = qrcode(0, 'M');
      qr.addData(String(text));
      qr.make();
      return qr.createSvgTag({ cellSize: cellSize || 4, margin: margin === undefined ? 8 : margin, scalable: true });
    } catch (e) {
      return '<div class="small muted">Code too long for a QR image</div>';
    }
  }

  /* ---------------------------------------------------------------- scanner */

  var scanner = {
    stream: null,
    video: null,
    canvas: null,
    ctx: null,
    detector: null,
    raf: 0,
    running: false,
    deviceIds: [],
    deviceIndex: 0,
    lastCode: '',
    lastAt: 0,
    onCode: null,
    onStatus: null,

    supported: function () {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    },

    start: function (video, onCode, onStatus) {
      var self = this;
      this.video = video;
      this.onCode = onCode;
      this.onStatus = onStatus || function () {};

      if (!this.supported()) {
        this.onStatus('This browser cannot open a camera. Serve the page over https:// or localhost, or type the code by hand.', 'error');
        return Promise.resolve(false);
      }

      var constraints = { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } };
      if (this.deviceIds.length && this.deviceIds[this.deviceIndex]) {
        constraints.video = { deviceId: { exact: this.deviceIds[this.deviceIndex] }, width: { ideal: 1280 }, height: { ideal: 720 } };
      }

      this.onStatus('Starting camera…');
      return navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
        self.stream = stream;
        video.srcObject = stream;
        video.setAttribute('playsinline', '');
        video.muted = true;
        return video.play();
      }).then(function () {
        if (window.BarcodeDetector) {
          try { self.detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { self.detector = null; }
        }
        if (!self.canvas) {
          self.canvas = document.createElement('canvas');
          self.ctx = self.canvas.getContext('2d', { willReadFrequently: true });
        }
        self.running = true;
        self.onStatus('Point the camera at the label on the box.');
        self.tick();
        return navigator.mediaDevices.enumerateDevices();
      }).then(function (devices) {
        self.deviceIds = devices.filter(function (d) { return d.kind === 'videoinput'; })
          .map(function (d) { return d.deviceId; }).filter(Boolean);
        return true;
      }).catch(function (err) {
        var msg = 'Camera unavailable.';
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
          msg = 'Camera permission was denied. Allow it in your browser settings, or type the code below.';
        } else if (err && err.name === 'NotFoundError') {
          msg = 'No camera found on this device. Type the code below instead.';
        } else if (!window.isSecureContext) {
          msg = 'Cameras only work on https:// or localhost. Type the code below instead.';
        }
        self.onStatus(msg, 'error');
        return false;
      });
    },

    tick: function () {
      var self = this;
      var last = 0;
      var step = function (now) {
        if (!self.running) return;
        self.raf = requestAnimationFrame(step);
        if (now - last < 90) return;
        last = now;
        self.scanFrame();
      };
      this.raf = requestAnimationFrame(step);
    },

    scanFrame: function () {
      var self = this;
      var video = this.video;
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      if (this.detector) {
        if (this.busy) return;
        this.busy = true;
        this.detector.detect(video).then(function (codes) {
          self.busy = false;
          if (codes && codes.length && codes[0].rawValue) self.hit(codes[0].rawValue);
        }).catch(function () {
          self.busy = false;
          self.detector = null; // fall back to jsQR for the rest of the session
        });
        return;
      }

      if (!window.jsQR) return;
      var w = 480;
      var h = Math.round(video.videoHeight * (w / video.videoWidth));
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx.drawImage(video, 0, 0, w, h);
      var img = this.ctx.getImageData(0, 0, w, h);
      var res = window.jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (res && res.data) this.hit(res.data);
    },

    /* Ignore repeats of the same code for a moment so one label is not read ten times. */
    hit: function (value) {
      var now = Date.now();
      if (value === this.lastCode && now - this.lastAt < 2200) return;
      this.lastCode = value;
      this.lastAt = now;
      if (navigator.vibrate) { try { navigator.vibrate(35); } catch (e) {} }
      if (this.onCode) this.onCode(value);
    },

    decodeImageFile: function (file) {
      return new Promise(function (resolve, reject) {
        if (!window.jsQR) return reject(new Error('decoder missing'));
        var img = new Image();
        var url = URL.createObjectURL(file);
        img.onload = function () {
          var max = 1000;
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          var cx = c.getContext('2d');
          cx.drawImage(img, 0, 0, w, h);
          var res = window.jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
          URL.revokeObjectURL(url);
          resolve(res && res.data ? res.data : null);
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad image')); };
        img.src = url;
      });
    },

    torchAvailable: function () {
      var track = this.stream && this.stream.getVideoTracks()[0];
      if (!track || !track.getCapabilities) return false;
      var caps = {};
      try { caps = track.getCapabilities(); } catch (e) {}
      return !!caps.torch;
    },

    setTorch: function (on) {
      var track = this.stream && this.stream.getVideoTracks()[0];
      if (!track) return Promise.resolve(false);
      return track.applyConstraints({ advanced: [{ torch: !!on }] }).then(function () { return true; })
        .catch(function () { return false; });
    },

    switchCamera: function () {
      if (this.deviceIds.length < 2) return Promise.resolve(false);
      this.deviceIndex = (this.deviceIndex + 1) % this.deviceIds.length;
      var video = this.video, onCode = this.onCode, onStatus = this.onStatus;
      this.stop();
      return this.start(video, onCode, onStatus);
    },

    stop: function () {
      this.running = false;
      this.busy = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (this.stream) {
        this.stream.getTracks().forEach(function (t) { t.stop(); });
        this.stream = null;
      }
      if (this.video) { try { this.video.srcObject = null; } catch (e) {} }
    }
  };

  /* ------------------------------------------------------------------- ui */

  var ui = { query: '', route: '', scanLog: [] };

  function locationDatalist(id) {
    return '<datalist id="' + id + '">' + locations().map(function (l) {
      return '<option value="' + esc(l.name) + '"></option>';
    }).join('') + '</datalist>';
  }

  function locChip(box) {
    if (box.location.trim()) {
      return '<span class="chip chip-loc">' + ICON.pin + esc(box.location) + '</span>';
    }
    return '<span class="chip chip-loc is-empty">' + ICON.pin + 'No location yet</span>';
  }

  function highlight(text, query) {
    var out = esc(text);
    var terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    terms.forEach(function (t) {
      var re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      out = out.replace(re, '<mark>$1</mark>');
    });
    return out;
  }

  function boxCard(box, query) {
    var items = box.items.slice(0, 6).map(function (i) {
      return (i.qty > 1 ? i.qty + '× ' : '') + i.name;
    }).join(' · ');
    var more = box.items.length > 6 ? ' +' + (box.items.length - 6) + ' more' : '';
    var cover = box.photos[0];
    return '<a class="box-card' + (cover ? ' has-cover' : '') + '" href="#/box/' + esc(box.id) + '">' +
      (cover
        ? '<span class="card-cover" data-photo="' + esc(cover.id) + '" data-alt="' + esc(boxTitle(box)) + '"></span>'
        : '') +
      '<span class="card-body">' +
        '<h3>' + highlight(boxTitle(box), query) + '</h3>' +
        '<span class="box-meta">' +
          locChip(box) +
          '<span class="chip chip-code">' + highlight(box.code, query) + '</span>' +
          '<span class="chip">' + box.items.length + (box.items.length === 1 ? ' item' : ' items') + '</span>' +
          (box.photos.length > 1 ? '<span class="chip">' + box.photos.length + ' photos</span>' : '') +
        '</span>' +
        (box.items.length
          ? '<span class="box-items">' + highlight(items, query) + esc(more) + '</span>'
          : '<span class="box-items muted">Nothing listed inside yet</span>') +
      '</span>' +
    '</a>';
  }

  /* Tiles and covers render empty, then fill in as their thumbnails come back
     from IndexedDB — a list of forty boxes never waits on disk to paint. */
  function hydratePhotos(root) {
    $$('[data-photo]', root).forEach(function (el) {
      if (el.dataset.hydrated) return;
      el.dataset.hydrated = '1';
      photos.get(el.getAttribute('data-photo')).then(function (rec) {
        if (!rec || !rec.thumb || !el.isConnected) return;
        var img = document.createElement('img');
        img.alt = el.getAttribute('data-alt') || '';
        img.decoding = 'async';
        img.src = urlBag.make(rec.thumb);
        el.appendChild(img);
        el.classList.add('is-loaded');
      }).catch(function () {});
    });
  }

  /* ------------------------------------------------------------ view: boxes */

  function viewBoxes(root) {
    var q = ui.query;
    // Searching sorts by relevance; browsing uses whatever sort the user picked.
    var list = q ? searchBoxes(q) : sortBoxes(state.boxes, state.settings.sort);

    root.innerHTML =
      '<div class="page-head">' +
        '<div>' +
          '<h1 class="page-title">' + (q ? 'Search' : 'Your boxes') + '</h1>' +
          '<div class="page-sub">' +
            (q
              ? list.length + (list.length === 1 ? ' box matches ' : ' boxes match ') + '“' + esc(q) + '”'
              : state.boxes.length + (state.boxes.length === 1 ? ' box' : ' boxes') + ' · ' +
                state.boxes.reduce(function (n, b) { return n + b.items.length; }, 0) + ' items packed') +
          '</div>' +
        '</div>' +
        '<div class="row-tight">' +
          '<a class="btn" href="#/scan">' + ICON.scan + 'Scan</a>' +
          '<button class="btn btn-primary" data-act="new-box">' + ICON.plus + 'New box</button>' +
        '</div>' +
      '</div>' +
      (!q && state.boxes.length > 1
        ? '<div class="list-toolbar"><div class="seg" role="group" aria-label="Sort boxes">' +
            ['updated:Recent', 'name:Name', 'location:Location'].map(function (pair) {
              var k = pair.split(':')[0], lbl = pair.split(':')[1];
              return '<button data-sort="' + k + '" class="' + (state.settings.sort === k ? 'active' : '') + '">' + lbl + '</button>';
            }).join('') +
          '</div></div>'
        : '') +
      (list.length
        ? '<div class="box-grid">' + list.map(function (b) { return boxCard(b, q); }).join('') + '</div>'
        : emptyState(q));

    hydratePhotos(root);

    $$('[data-sort]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.settings.sort = btn.getAttribute('data-sort');
        save();
        render();
      });
    });
  }

  function emptyState(q) {
    if (q) {
      return '<div class="empty"><h3>Nothing matches “' + esc(q) + '”</h3>' +
        '<p>Try one word instead of several — item names, a location, or part of a box code all work.</p></div>';
    }
    if (!state.boxes.length) {
      return '<div class="empty">' +
        '<h3>Start with a box in front of you</h3>' +
        '<p>Scan the QR code already stuck on it, tell Boxly where the box lives, and list what you put inside. ' +
        'Everything stays on this device.</p>' +
        '<div class="row" style="justify-content:center">' +
          '<a class="btn btn-primary btn-lg" href="#/scan">' + ICON.scan + 'Scan a box</a>' +
          '<button class="btn btn-lg" data-act="new-box">Add one by hand</button>' +
        '</div></div>';
    }
    return '';
  }

  /* ------------------------------------------------------- view: box detail */

  function viewBox(root, id) {
    var box = boxById(id);
    if (!box) {
      root.innerHTML = '<div class="empty"><h3>That box is gone</h3><p>It may have been deleted.</p>' +
        '<a class="btn" href="#/boxes">Back to boxes</a></div>';
      return;
    }

    root.innerHTML =
      '<div class="row-tight" style="margin-bottom:14px">' +
        '<a class="btn btn-ghost btn-sm" href="#/boxes">' + ICON.back + 'All boxes</a>' +
        '<span class="spacer"></span>' +
        '<span class="small muted" id="save-state">Updated ' + esc(relTime(box.updatedAt)) + '</span>' +
      '</div>' +

      '<div class="card detail-head">' +
        '<div class="detail-qr">' + qrSvg(box.code, 4, 2) + '</div>' +
        '<div style="flex:1 1 auto;min-width:0">' +
          '<div class="detail-title" id="detail-title">' + esc(boxTitle(box)) + '</div>' +
          '<div class="box-meta" style="margin-top:9px" id="detail-chips">' +
            locChip(box) + '<span class="chip chip-code">' + esc(box.code) + '</span>' +
          '</div>' +
          '<div class="row-tight" style="margin-top:12px">' +
            '<button class="btn btn-sm" data-act="print-one">' + ICON.print + 'Print label</button>' +
            '<button class="btn btn-sm btn-danger" data-act="delete">' + ICON.trash + 'Delete</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card section">' +
        '<h2>Where it is</h2>' +
        '<label class="field"><span>Location</span>' +
          '<input class="input" id="f-location" list="loc-list" placeholder="Garage — shelf B" value="' + esc(box.location) + '">' +
        '</label>' +
        locationDatalist('loc-list') +
        '<label class="field" style="margin-bottom:0"><span>Box name</span>' +
          '<input class="input" id="f-name" placeholder="Kitchen — pots and pans" value="' + esc(box.name) + '">' +
        '</label>' +
      '</div>' +

      '<div class="card section" id="photo-card">' +
        '<h2>Photos <span class="muted" id="photo-total"></span>' +
          '<label class="btn btn-sm head-action" id="photo-add-btn">' + ICON.plus + 'Add photo' +
            '<input type="file" accept="image/*" multiple class="sr-only" id="photo-file">' +
          '</label>' +
        '</h2>' +
        '<div class="photo-strip" id="photo-strip"></div>' +
        '<div class="small muted" style="margin-top:10px" id="photo-hint">' +
          'A picture of the open box beats a list you did not finish writing. The first one shows up in your box list.' +
        '</div>' +
      '</div>' +

      '<div class="card section">' +
        '<h2>What is inside <span class="muted" id="item-count"></span></h2>' +
        '<div id="items"></div>' +
        '<form class="add-item" id="add-item-form">' +
          '<input class="input" id="f-item" placeholder="Add an item — “4x dinner plates”" autocomplete="off">' +
          '<button class="btn btn-primary" type="submit">' + ICON.plus + 'Add</button>' +
        '</form>' +
        '<div class="small muted" style="margin-top:8px">Separate several things with commas to add them at once.</div>' +
      '</div>' +

      '<div class="card section">' +
        '<h2>Notes</h2>' +
        '<textarea class="textarea" id="f-notes" placeholder="Fragile, opened first, belongs to Sam…">' + esc(box.notes) + '</textarea>' +
      '</div>';

    var savedNote = $('#save-state', root);
    function noteSaved() {
      savedNote.textContent = 'Saved';
      savedNote.style.color = 'var(--accent)';
      clearTimeout(noteSaved.t);
      noteSaved.t = setTimeout(function () {
        savedNote.textContent = 'Updated ' + relTime(box.updatedAt);
        savedNote.style.color = '';
      }, 1600);
    }

    function renderItems() {
      var host = $('#items', root);
      $('#item-count', root).textContent = box.items.length ? '· ' + itemCount(box) + ' total' : '';
      if (!box.items.length) {
        host.innerHTML = '<p class="small muted">Nothing listed yet. Anything you add here becomes searchable.</p>';
        return;
      }
      host.innerHTML = box.items.map(function (it) {
        return '<div class="item-row" data-item="' + esc(it.id) + '">' +
          '<span class="item-name">' + esc(it.name) + '</span>' +
          (it.qty > 1 ? '<span class="item-qty">×' + it.qty + '</span>' : '') +
          '<button class="icon-btn" data-remove="' + esc(it.id) + '" aria-label="Remove ' + esc(it.name) + '">' +
            '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
          '</button>' +
        '</div>';
      }).join('');
    }
    renderItems();

    function renderPhotos() {
      var host = $('#photo-strip', root);
      $('#photo-total', root).textContent = box.photos.length ? '· ' + box.photos.length : '';
      // The strip scrolls, so the only always-reachable place for "add" is the header.
      // The dashed tile is the empty state, and points at that same input.
      host.innerHTML =
        box.photos.map(function (p, i) {
          return '<button type="button" class="photo-tile" data-open="' + esc(p.id) + '" ' +
            'data-photo="' + esc(p.id) + '" data-alt="Photo of ' + esc(boxTitle(box)) + '" ' +
            'aria-label="Open photo ' + (i + 1) + ' of ' + box.photos.length + '">' +
            (i === 0 && box.photos.length > 1 ? '<span class="photo-badge">Cover</span>' : '') +
          '</button>';
        }).join('') +
        (box.photos.length || photos.blocked
          ? ''
          : '<label class="photo-add" for="photo-file">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' +
              '<span>Add a photo</span>' +
            '</label>');
      hydratePhotos(host);

      if (photos.blocked) {
        $('#photo-add-btn', root).hidden = true;
        $('#photo-hint', root).textContent =
          'Photos need a browser that allows local file storage. Serving this page over http:// or https:// instead of opening the file directly usually fixes it.';
      }
    }
    renderPhotos();

    var busy = false;
    $('#photo-card', root).addEventListener('change', function (e) {
      var input = e.target.closest('#photo-file');
      if (!input || !input.files || !input.files.length || busy) return;
      var files = Array.prototype.slice.call(input.files);
      input.value = '';
      busy = true;
      toast(files.length === 1 ? 'Adding photo…' : 'Adding ' + files.length + ' photos…');

      // One at a time: a phone decoding six full-resolution frames at once runs out of memory.
      files.reduce(function (chain, file) {
        return chain.then(function () { return photos.add(box, file); });
      }, Promise.resolve()).then(function () {
        toast(files.length === 1 ? 'Photo added' : files.length + ' photos added', 'ok');
      }).catch(function (err) {
        toast(err && err.message ? err.message : 'That photo could not be saved', 'warn');
      }).then(function () {
        busy = false;
        renderPhotos();
        noteSaved();
      });
    });

    $('#photo-strip', root).addEventListener('click', function (e) {
      var tile = e.target.closest('[data-open]');
      if (tile) openPhotoViewer(box, tile.getAttribute('data-open'), renderPhotos);
    });

    var saveLocation = debounce(function (val) {
      box.location = val.trim();
      state.settings.lastLocation = box.location || state.settings.lastLocation;
      touch(box);
      $('#detail-chips', root).innerHTML = locChip(box) + '<span class="chip chip-code">' + esc(box.code) + '</span>';
      noteSaved();
    }, 350);

    var saveName = debounce(function (val) {
      box.name = val.trim();
      touch(box);
      $('#detail-title', root).textContent = boxTitle(box);
      noteSaved();
    }, 350);

    var saveNotes = debounce(function (val) {
      box.notes = val;
      touch(box);
      noteSaved();
    }, 400);

    $('#f-location', root).addEventListener('input', function (e) { saveLocation(e.target.value); });
    $('#f-name', root).addEventListener('input', function (e) { saveName(e.target.value); });
    $('#f-notes', root).addEventListener('input', function (e) { saveNotes(e.target.value); });

    $('#add-item-form', root).addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('#f-item', root);
      var n = addItems(box, input.value);
      if (n) { input.value = ''; renderItems(); noteSaved(); }
      input.focus();
    });

    $('#items', root).addEventListener('click', function (e) {
      var btn = e.target.closest('[data-remove]');
      if (!btn) return;
      var itemId = btn.getAttribute('data-remove');
      box.items = box.items.filter(function (i) { return i.id !== itemId; });
      touch(box);
      renderItems();
      noteSaved();
    });

    $('[data-act="print-one"]', root).addEventListener('click', function () {
      printLabels([box], state.settings.labelSize || 'm');
    });

    $('[data-act="delete"]', root).addEventListener('click', function () {
      confirmSheet({
        title: 'Delete this box?',
        body: boxTitle(box) + ' and its ' + box.items.length + ' listed items will be removed from this device.',
        confirm: 'Delete box',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        deleteBox(box.id);
        location.hash = '#/boxes';
        toast('Box deleted');
      });
    });
  }

  /* -------------------------------------------------------- view: new box */

  function viewNew(root, code) {
    var prefill = code || nextCode();
    var known = boxByCode(prefill);
    if (known) { location.replace('#/box/' + known.id); return; }

    root.innerHTML =
      '<div class="row-tight" style="margin-bottom:14px">' +
        '<a class="btn btn-ghost btn-sm" href="#/boxes">' + ICON.back + 'All boxes</a>' +
      '</div>' +
      '<div class="page-head"><div>' +
        '<h1 class="page-title">New box</h1>' +
        '<div class="page-sub">' + (code ? 'That code is not in your inventory yet.' : 'A fresh code was generated — print a label for it from the Labels tab.') + '</div>' +
      '</div></div>' +
      '<form class="card section" id="new-form">' +
        '<div class="row" style="gap:18px;align-items:flex-start">' +
          '<div class="detail-qr" style="width:110px;height:110px" id="new-qr">' + qrSvg(prefill, 4, 2) + '</div>' +
          '<div style="flex:1 1 240px;min-width:0">' +
            '<label class="field"><span>QR code on the box</span>' +
              '<input class="input mono" id="n-code" value="' + esc(prefill) + '"></label>' +
            '<label class="field"><span>Location</span>' +
              '<input class="input" id="n-location" list="loc-list" placeholder="Garage — shelf B" value="' + esc(state.settings.lastLocation) + '"></label>' +
            locationDatalist('loc-list') +
            '<label class="field"><span>Box name</span>' +
              '<input class="input" id="n-name" placeholder="Kitchen — pots and pans"></label>' +
            '<label class="field" style="margin-bottom:0"><span>What is inside <span class="muted" style="text-transform:none;letter-spacing:0">— commas separate items</span></span>' +
              '<textarea class="textarea" id="n-items" placeholder="4x dinner plates, cast iron pan, dish towels"></textarea></label>' +
          '</div>' +
        '</div>' +
        '<div class="sheet-actions">' +
          '<a class="btn btn-ghost" href="#/boxes">Cancel</a>' +
          '<button class="btn btn-primary" type="submit">' + ICON.plus + 'Create box</button>' +
        '</div>' +
      '</form>';

    var codeInput = $('#n-code', root);
    codeInput.addEventListener('input', debounce(function () {
      $('#new-qr', root).innerHTML = qrSvg(codeInput.value.trim(), 4, 2);
    }, 250));

    $('#n-name', root).focus();

    $('#new-form', root).addEventListener('submit', function (e) {
      e.preventDefault();
      var codeVal = codeInput.value.trim();
      if (!codeVal) { toast('Give the box a code first', 'warn'); return; }
      var dupe = boxByCode(codeVal);
      if (dupe) { toast('That code already belongs to ' + boxTitle(dupe), 'warn'); location.hash = '#/box/' + dupe.id; return; }
      var box = createBox({
        code: codeVal,
        name: $('#n-name', root).value.trim(),
        location: $('#n-location', root).value.trim()
      });
      addItems(box, $('#n-items', root).value);
      state.settings.lastLocation = box.location || state.settings.lastLocation;
      save();
      toast('Box created', 'ok');
      location.hash = '#/box/' + box.id;
    });
  }

  /* ------------------------------------------------------------ view: scan */

  function viewScan(root) {
    var qa = state.settings.quickAssign;

    root.innerHTML =
      '<div class="page-head"><div>' +
        '<h1 class="page-title">Scan a box</h1>' +
        '<div class="page-sub">Hold the QR label in the frame. Known boxes open straight away.</div>' +
      '</div></div>' +

      '<div class="quick-assign">' +
        '<label><span class="switch"><input type="checkbox" id="qa-toggle"' + (qa ? ' checked' : '') + '><span></span></span>' +
        'Quick-assign location</label>' +
        '<input class="input" id="qa-location" list="loc-list" placeholder="Garage — shelf B" value="' +
          esc(state.settings.lastLocation) + '"' + (qa ? '' : ' disabled') + '>' +
        locationDatalist('loc-list') +
        '<div class="small" style="flex-basis:100%;color:var(--accent)">' +
          'On: every scan drops that box at this location and keeps the camera running — good for unloading a van.' +
        '</div>' +
      '</div>' +

      '<div class="scanner" id="scanner">' +
        '<video id="cam" playsinline muted></video>' +
        '<div class="scanner-overlay"><div class="reticle"><i></i></div></div>' +
        '<div class="scanner-tools">' +
          '<button id="torch" title="Toggle light" aria-label="Toggle light" hidden>' +
            '<svg viewBox="0 0 24 24"><path d="M9 3h6l-.6 5.4 2.1 2.1L12 21l-4.5-10.5 2.1-2.1z"/></svg></button>' +
          '<button id="flip" title="Switch camera" aria-label="Switch camera" hidden>' +
            '<svg viewBox="0 0 24 24"><path d="M4 9V7a2 2 0 0 1 2-2h9M20 15v2a2 2 0 0 1-2 2H9"/><path d="m7 12-3-3-3 3M17 12l3 3 3-3"/></svg></button>' +
        '</div>' +
        '<div class="scanner-status" id="scan-status">Starting camera…</div>' +
      '</div>' +

      '<form class="row" id="manual-form" style="margin-top:14px">' +
        '<input class="input mono" id="manual-code" placeholder="…or type the code printed on the label" style="flex:1 1 220px">' +
        '<button class="btn" type="submit">Look up</button>' +
        '<label class="btn" for="photo-input" style="cursor:pointer">Scan a photo' +
          '<input id="photo-input" type="file" accept="image/*" class="sr-only"></label>' +
      '</form>' +

      '<div class="scan-log card" id="scan-log" hidden></div>';

    var statusEl = $('#scan-status', root);
    var scannerEl = $('#scanner', root);
    var qaToggle = $('#qa-toggle', root);
    var qaLocation = $('#qa-location', root);

    function setStatus(msg, kind) {
      statusEl.textContent = msg;
      statusEl.style.color = kind === 'error' ? '#ffb4a8' : '';
    }

    qaToggle.addEventListener('change', function () {
      state.settings.quickAssign = qaToggle.checked;
      qaLocation.disabled = !qaToggle.checked;
      save();
      if (qaToggle.checked) qaLocation.focus();
    });
    qaLocation.addEventListener('input', debounce(function () {
      state.settings.lastLocation = qaLocation.value.trim();
      save();
    }, 300));

    function renderLog() {
      var host = $('#scan-log', root);
      if (!ui.scanLog.length) { host.hidden = true; return; }
      host.hidden = false;
      host.innerHTML = ui.scanLog.slice(0, 8).map(function (entry) {
        return '<div class="scan-log-row">' +
          '<span class="chip chip-code">' + esc(entry.code) + '</span>' +
          '<a href="#/box/' + esc(entry.id) + '" style="flex:1 1 auto;min-width:0;color:var(--accent);font-weight:550">' +
            esc(entry.title) + '</a>' +
          '<span class="small muted">' + esc(entry.note) + '</span>' +
        '</div>';
      }).join('');
    }

    function flash() {
      scannerEl.classList.add('hit');
      setTimeout(function () { scannerEl.classList.remove('hit'); }, 500);
    }

    function handleCode(value) {
      var code = String(value).trim();
      if (!code) return;
      var box = boxByCode(code);
      var quick = state.settings.quickAssign && qaLocation.value.trim();

      if (quick) {
        var place = qaLocation.value.trim();
        // The code is already shown next to the entry, so unnamed boxes get a nudge instead.
        var label = function (b) { return b.name.trim() || 'Unnamed — add details'; };
        if (!box) {
          box = createBox({ code: code, location: place });
          ui.scanLog.unshift({ code: code, id: box.id, title: label(box), note: 'new box · ' + place });
          toast('New box logged at ' + place, 'ok');
        } else {
          box.location = place;
          touch(box);
          ui.scanLog.unshift({ code: code, id: box.id, title: label(box), note: 'moved to ' + place });
          toast(boxTitle(box) + ' → ' + place, 'ok');
        }
        state.settings.lastLocation = place;
        save();
        flash();
        renderLog();
        return;
      }

      scanner.stop();
      flash();
      if (box) {
        toast('Opened ' + boxTitle(box), 'ok');
        location.hash = '#/box/' + box.id;
      } else {
        location.hash = '#/new?code=' + encodeURIComponent(code);
      }
    }

    $('#manual-form', root).addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('#manual-code', root);
      var val = input.value.trim();
      if (!val) return;
      input.value = '';
      handleCode(val);
    });

    $('#photo-input', root).addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      scanner.decodeImageFile(file).then(function (value) {
        if (value) handleCode(value);
        else toast('No QR code found in that picture', 'warn');
      }).catch(function () { toast('Could not read that image', 'warn'); });
      e.target.value = '';
    });

    scanner.start($('#cam', root), handleCode, setStatus).then(function (ok) {
      if (!ok) return;
      var torchBtn = $('#torch', root);
      var flipBtn = $('#flip', root);
      if (scanner.torchAvailable()) {
        torchBtn.hidden = false;
        torchBtn.addEventListener('click', function () {
          var on = !torchBtn.classList.contains('on');
          scanner.setTorch(on).then(function (worked) {
            if (worked) torchBtn.classList.toggle('on', on);
          });
        });
      }
      if (scanner.deviceIds.length > 1) {
        flipBtn.hidden = false;
        flipBtn.addEventListener('click', function () { scanner.switchCamera(); });
      }
    });

    renderLog();
  }

  /* ------------------------------------------------------- view: locations */

  function viewLocations(root) {
    var groups = locations();
    var unplaced = state.boxes.filter(function (b) { return !b.location.trim(); });

    root.innerHTML =
      '<div class="page-head"><div>' +
        '<h1 class="page-title">Locations</h1>' +
        '<div class="page-sub">' + groups.length + (groups.length === 1 ? ' place' : ' places') +
          (unplaced.length ? ' · ' + unplaced.length + ' box' + (unplaced.length === 1 ? '' : 'es') + ' still unplaced' : '') +
        '</div>' +
      '</div></div>' +
      (unplaced.length
        ? '<div class="card loc-card" data-loc="">' +
            '<button class="loc-head"><svg class="loc-caret" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>' +
            '<h3 style="color:var(--amber)">Not placed yet</h3>' +
            '<span class="loc-count">' + unplaced.length + '</span></button>' +
            '<div class="loc-body">' + unplaced.map(locRow).join('') + '</div>' +
          '</div>'
        : '') +
      (groups.length
        ? groups.map(function (g) {
            var items = g.boxes.reduce(function (n, b) { return n + b.items.length; }, 0);
            return '<div class="card loc-card" data-loc="' + esc(g.name) + '">' +
              '<button class="loc-head"><svg class="loc-caret" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>' +
              '<h3>' + esc(g.name) + '</h3>' +
              '<span class="loc-count">' + g.boxes.length + ' box' + (g.boxes.length === 1 ? '' : 'es') +
                ' · ' + items + ' items</span></button>' +
              '<div class="loc-body">' +
                g.boxes.map(locRow).join('') +
                '<div class="row-tight" style="margin-top:12px">' +
                  '<button class="btn btn-sm" data-rename="' + esc(g.name) + '">Rename place</button>' +
                  '<button class="btn btn-sm" data-print-loc="' + esc(g.name) + '">' + ICON.print + 'Print these labels</button>' +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('')
        : (unplaced.length ? '' :
          '<div class="empty"><h3>No locations yet</h3>' +
          '<p>Scan a box and type where it lives — the places you use build up here on their own.</p>' +
          '<a class="btn btn-primary" href="#/scan">' + ICON.scan + 'Scan a box</a></div>'));

    $$('.loc-head', root).forEach(function (head) {
      head.addEventListener('click', function () { head.parentElement.classList.toggle('open'); });
    });
    var first = $('.loc-card', root);
    if (first && groups.length + (unplaced.length ? 1 : 0) <= 3) {
      $$('.loc-card', root).forEach(function (c) { c.classList.add('open'); });
    } else if (first) {
      first.classList.add('open');
    }

    $$('[data-rename]', root).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var oldName = btn.getAttribute('data-rename');
        confirmSheet({
          title: 'Rename location',
          body: 'Every box currently at “' + oldName + '” moves with it.',
          input: oldName,
          inputLabel: 'Location name',
          confirm: 'Rename'
        }).then(function (val) {
          if (val == null) return;
          var next = String(val).trim();
          if (!next) return;
          state.boxes.forEach(function (b) {
            if (b.location.toLowerCase() === oldName.toLowerCase()) { b.location = next; b.updatedAt = Date.now(); }
          });
          save();
          toast('Renamed to ' + next, 'ok');
          render();
        });
      });
    });

    $$('[data-print-loc]', root).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var name = btn.getAttribute('data-print-loc');
        printLabels(state.boxes.filter(function (b) {
          return b.location.toLowerCase() === name.toLowerCase();
        }), state.settings.labelSize || 'm');
      });
    });
  }

  function locRow(box) {
    return '<a class="loc-box-row" href="#/box/' + esc(box.id) + '">' +
      '<span class="chip chip-code">' + esc(box.code) + '</span>' +
      '<span style="flex:1 1 auto;min-width:0">' + esc(boxTitle(box)) + '</span>' +
      '<span class="small muted">' + box.items.length + ' items</span>' +
    '</a>';
  }

  /* ---------------------------------------------------------- view: labels */

  function viewLabels(root) {
    var size = state.settings.labelSize || 'm';

    root.innerHTML =
      '<div class="page-head"><div>' +
        '<h1 class="page-title">Print labels</h1>' +
        '<div class="page-sub">For boxes that do not have a QR sticker yet. Print, stick, then scan to fill in.</div>' +
      '</div></div>' +

      '<div class="card section">' +
        '<h2>Need blank boxes?</h2>' +
        '<form class="row" id="bulk-form">' +
          '<input class="input" id="bulk-n" type="number" min="1" max="60" value="6" style="width:96px">' +
          '<button class="btn" type="submit">' + ICON.plus + 'Create that many empty boxes</button>' +
        '</form>' +
        '<div class="small muted" style="margin-top:8px">Each gets its own code so you can label a stack in one go.</div>' +
      '</div>' +

      '<div class="card section">' +
        '<h2>Label size</h2>' +
        '<div class="seg" id="size-seg">' +
          ['s:Small 38mm', 'm:Medium 55mm', 'l:Large 88mm'].map(function (p) {
            var k = p.split(':')[0];
            return '<button data-size="' + k + '" class="' + (size === k ? 'active' : '') + '">' + p.split(':')[1] + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +

      (state.boxes.length
        ? '<div class="card section">' +
            '<h2>Choose boxes</h2>' +
            '<div class="row-tight" style="margin-bottom:12px">' +
              '<button class="btn btn-sm" data-pick="all">Select all</button>' +
              '<button class="btn btn-sm" data-pick="none">Select none</button>' +
              '<span class="spacer"></span>' +
              '<span class="small muted" id="pick-count"></span>' +
            '</div>' +
            '<div class="label-picker">' +
              sortBoxes(state.boxes, 'updated').map(function (b) {
                return '<label class="pick-row"><input type="checkbox" value="' + esc(b.id) + '">' +
                  '<span class="pick-main"><strong>' + esc(boxTitle(b)) + '</strong><br>' +
                  '<span class="small muted mono">' + esc(b.code) + '</span>' +
                  (b.location ? '<span class="small muted"> · ' + esc(b.location) + '</span>' : '') +
                  '</span></label>';
              }).join('') +
            '</div>' +
            '<div class="sheet-actions">' +
              '<button class="btn btn-primary" data-act="print">' + ICON.print + 'Print selected</button>' +
            '</div>' +
          '</div>'
        : '<div class="empty"><h3>No boxes yet</h3><p>Create a few above and their labels will show up here.</p></div>');

    $('#bulk-form', root).addEventListener('submit', function (e) {
      e.preventDefault();
      var n = Math.max(1, Math.min(60, parseInt($('#bulk-n', root).value, 10) || 1));
      var made = [];
      for (var i = 0; i < n; i++) made.push(createBox({}));
      toast(n + ' empty ' + (n === 1 ? 'box' : 'boxes') + ' created', 'ok');
      render();
      // Pre-select the ones we just made so the next click prints exactly those.
      var ids = made.map(function (b) { return b.id; });
      $$('.pick-row input', $('#view')).forEach(function (cb) { cb.checked = ids.indexOf(cb.value) !== -1; });
      updatePickCount();
    });

    $$('[data-size]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.settings.labelSize = btn.getAttribute('data-size');
        save();
        $$('[data-size]', root).forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });

    function updatePickCount() {
      var host = $('#pick-count', $('#view'));
      if (!host) return;
      var n = $$('.pick-row input:checked', $('#view')).length;
      host.textContent = n ? n + ' selected' : 'nothing selected';
      $$('.pick-row', $('#view')).forEach(function (row) {
        row.classList.toggle('selected', $('input', row).checked);
      });
    }

    $$('.pick-row input', root).forEach(function (cb) {
      cb.addEventListener('change', updatePickCount);
    });
    $$('[data-pick]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var on = btn.getAttribute('data-pick') === 'all';
        $$('.pick-row input', root).forEach(function (cb) { cb.checked = on; });
        updatePickCount();
      });
    });
    updatePickCount();

    var printBtn = $('[data-act="print"]', root);
    if (printBtn) {
      printBtn.addEventListener('click', function () {
        var ids = $$('.pick-row input:checked', root).map(function (cb) { return cb.value; });
        if (!ids.length) { toast('Pick at least one box first', 'warn'); return; }
        printLabels(ids.map(boxById).filter(Boolean), state.settings.labelSize || 'm');
      });
    }
  }

  function printLabels(boxes, size) {
    if (!boxes.length) return;
    var area = $('#print-area');
    area.innerHTML = '<div class="label-sheet">' + boxes.map(function (b) {
      return '<div class="qr-label sz-' + esc(size) + '">' +
        '<div class="qr-holder">' + qrSvg(b.code, 4, 1) + '</div>' +
        '<div class="l-name">' + esc(boxTitle(b)) + '</div>' +
        (b.location ? '<div class="l-loc">' + esc(b.location) + '</div>' : '') +
        '<div class="l-code">' + esc(b.code) + '</div>' +
      '</div>';
    }).join('') + '</div>';
    setTimeout(function () {
      window.print();
      setTimeout(function () { area.innerHTML = ''; }, 1000);
    }, 60);
  }

  /* ------------------------------------------------------------ view: data */

  function viewData(root) {
    var totalItems = state.boxes.reduce(function (n, b) { return n + b.items.length; }, 0);
    var placed = state.boxes.filter(function (b) { return b.location.trim(); }).length;

    root.innerHTML =
      '<div class="page-head"><div>' +
        '<h1 class="page-title">Your data</h1>' +
        '<div class="page-sub">Stored in this browser only. Export a copy before switching devices.</div>' +
      '</div></div>' +

      '<div class="stat-grid">' +
        '<div class="stat"><div class="n">' + state.boxes.length + '</div><div class="k">Boxes</div></div>' +
        '<div class="stat"><div class="n">' + totalItems + '</div><div class="k">Items</div></div>' +
        '<div class="stat"><div class="n">' + photoCount() + '</div><div class="k">Photos</div></div>' +
        '<div class="stat"><div class="n">' + locations().length + '</div><div class="k">Locations</div></div>' +
        '<div class="stat"><div class="n">' + (state.boxes.length - placed) + '</div><div class="k">Unplaced</div></div>' +
      '</div>' +

      '<div class="card section">' +
        '<h2>Backup</h2>' +
        '<div class="row">' +
          '<button class="btn" data-act="export">Export JSON</button>' +
          '<button class="btn" data-act="csv">Export CSV</button>' +
          '<label class="btn" for="import-file" style="cursor:pointer">Import JSON' +
            '<input id="import-file" type="file" accept="application/json,.json" class="sr-only"></label>' +
        '</div>' +
        (photoCount()
          ? '<label class="row-tight" style="margin-top:12px;cursor:pointer">' +
              '<input type="checkbox" id="with-photos" style="width:17px;height:17px;accent-color:var(--accent)" checked>' +
              '<span class="small">Include photos in the JSON backup — bigger file, but nothing is left behind</span>' +
            '</label>'
          : '') +
        '<div class="small muted" style="margin-top:10px">Importing merges by QR code: matching boxes are updated, new ones are added.</div>' +
        '<div class="small muted" style="margin-top:4px" id="storage-line"></div>' +
      '</div>' +

      '<div class="card section">' +
        '<h2>Appearance</h2>' +
        '<div class="seg" id="theme-seg">' +
          ['system:System', 'light:Light', 'dark:Dark'].map(function (p) {
            var k = p.split(':')[0];
            return '<button data-theme="' + k + '" class="' + (state.settings.theme === k ? 'active' : '') + '">' + p.split(':')[1] + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div class="card section">' +
        '<h2>Danger zone</h2>' +
        '<button class="btn btn-danger" data-act="wipe">' + ICON.trash + 'Erase everything</button>' +
      '</div>';

    var stamp = function () { return new Date().toISOString().slice(0, 10); };

    $('[data-act="export"]', root).addEventListener('click', function () {
      var withPhotos = $('#with-photos', root);
      var payload = JSON.parse(JSON.stringify(state));
      if (!withPhotos || !withPhotos.checked || !photoCount()) {
        download('boxly-' + stamp() + '.json', JSON.stringify(payload, null, 2));
        toast('Backup downloaded', 'ok');
        return;
      }
      toast('Packing photos…');
      photos.all().then(function (records) {
        var wanted = {};
        state.boxes.forEach(function (b) { b.photos.forEach(function (p) { wanted[p.id] = true; }); });
        var keep = (records || []).filter(function (r) { return wanted[r.id]; });
        return Promise.all(keep.map(function (r) {
          return Promise.all([blobToDataUrl(r.full), blobToDataUrl(r.thumb)]).then(function (pair) {
            return { id: r.id, full: pair[0], thumb: pair[1] };
          });
        }));
      }).then(function (photoData) {
        payload.photoData = photoData;
        download('boxly-' + stamp() + '.json', JSON.stringify(payload));
        toast(photoData.length + ' photos included', 'ok');
      }).catch(function () {
        toast('Photos could not be read — exported without them', 'warn');
        download('boxly-' + stamp() + '.json', JSON.stringify(payload, null, 2));
      });
    });

    // Browsers only report a rough figure, so this is a sanity check, not accounting.
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (est) {
        var line = $('#storage-line', root);
        if (!line || !est || !est.usage) return;
        line.textContent = 'Using about ' + (est.usage / 1048576).toFixed(1) + ' MB on this device' +
          (est.quota ? ' of roughly ' + (est.quota / 1048576).toFixed(0) + ' MB available.' : '.');
      }).catch(function () {});
    }

    $('[data-act="csv"]', root).addEventListener('click', function () {
      var rows = [['box_code', 'box_name', 'location', 'item', 'qty', 'notes']];
      state.boxes.forEach(function (b) {
        if (!b.items.length) rows.push([b.code, b.name, b.location, '', '', b.notes]);
        b.items.forEach(function (it) { rows.push([b.code, b.name, b.location, it.name, it.qty, b.notes]); });
      });
      var csv = rows.map(function (r) {
        return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
      }).join('\r\n');
      download('boxly-' + new Date().toISOString().slice(0, 10) + '.csv', csv, 'text/csv');
      toast('CSV downloaded', 'ok');
    });

    $('#import-file', root).addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try { data = JSON.parse(String(reader.result)); } catch (err) {
          toast('That file is not valid Boxly JSON', 'warn');
          return;
        }
        if (!data || !Array.isArray(data.boxes)) { toast('No boxes found in that file', 'warn'); return; }
        var added = 0, updated = 0;
        data.boxes.map(normalizeBox).forEach(function (incoming) {
          var existing = boxByCode(incoming.code);
          if (existing) {
            // The replaced box's own photos would otherwise sit in storage forever.
            var orphans = existing.photos.filter(function (p) {
              return !incoming.photos.some(function (q) { return q.id === p.id; });
            }).map(function (p) { return p.id; });
            if (orphans.length) photos.remove(orphans);
            incoming.id = existing.id;
            state.boxes[state.boxes.indexOf(existing)] = incoming;
            updated++;
          } else {
            state.boxes.push(incoming);
            added++;
          }
        });
        save();

        var pics = Array.isArray(data.photoData) ? data.photoData : [];
        if (!pics.length) {
          toast(added + ' added · ' + updated + ' updated', 'ok');
          render();
          return;
        }
        Promise.all(pics.map(function (rec) {
          return photos.put({ id: rec.id, full: dataUrlToBlob(rec.full), thumb: dataUrlToBlob(rec.thumb || rec.full) });
        })).then(function () {
          toast(added + ' added · ' + updated + ' updated · ' + pics.length + ' photos', 'ok');
        }).catch(function () {
          toast('Boxes imported, but the photos could not be stored', 'warn');
        }).then(function () { render(); });
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    $$('[data-theme]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.settings.theme = btn.getAttribute('data-theme');
        save();
        applyTheme();
        $$('[data-theme]', root).forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });

    $('[data-act="wipe"]', root).addEventListener('click', function () {
      confirmSheet({
        title: 'Erase everything?',
        body: 'All ' + state.boxes.length + ' boxes and ' + photoCount() + ' photos are removed from this device. Export a backup first if you might want them back.',
        confirm: 'Erase everything',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        state.boxes = [];
        save();
        photos.clear();
        toast('All boxes erased');
        render();
      });
    });
  }

  function applyTheme() {
    var t = state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }

  /* ------------------------------------------------------------- router */

  function parseRoute() {
    var hash = location.hash.replace(/^#/, '') || '/boxes';
    var qIndex = hash.indexOf('?');
    var path = qIndex === -1 ? hash : hash.slice(0, qIndex);
    var query = {};
    if (qIndex !== -1) {
      hash.slice(qIndex + 1).split('&').forEach(function (pair) {
        var kv = pair.split('=');
        query[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join('=') || '');
      });
    }
    return { path: path, parts: path.split('/').filter(Boolean), query: query };
  }

  function render() {
    var route = parseRoute();
    var root = $('#view');
    var section = route.parts[0] || 'boxes';

    if (section !== 'scan') scanner.stop();
    urlBag.releaseAll();

    root.innerHTML = '';
    if (section === 'scan') viewScan(root);
    else if (section === 'box') viewBox(root, route.parts[1]);
    else if (section === 'new') viewNew(root, route.query.code || '');
    else if (section === 'locations') viewLocations(root);
    else if (section === 'labels') viewLabels(root);
    else if (section === 'data') viewData(root);
    else viewBoxes(root);

    var tabFor = section === 'box' || section === 'new' ? 'boxes' : section;
    $$('[data-tab]').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-tab') === tabFor);
    });

    if (ui.route && ui.route !== route.path) window.scrollTo(0, 0);
    ui.route = route.path;
  }

  /* --------------------------------------------------------------- boot */

  function boot() {
    load();
    applyTheme();
    photos.open().catch(function () { photos.blocked = true; });

    var search = $('#global-search');
    search.addEventListener('input', debounce(function () {
      ui.query = search.value;
      // Typing anywhere jumps to the results list; hashchange re-renders for us.
      if ((parseRoute().parts[0] || 'boxes') !== 'boxes') location.hash = '#/boxes';
      else render();
    }, 160));
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { search.value = ''; ui.query = ''; search.blur(); render(); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
      var el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      search.focus();
      search.select();
    });

    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act="new-box"]');
      if (btn) location.hash = '#/new';
    });

    window.addEventListener('hashchange', render);
    window.addEventListener('pagehide', function () { scanner.stop(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) scanner.stop();
    });

    if (!location.hash) location.replace('#/boxes');
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
