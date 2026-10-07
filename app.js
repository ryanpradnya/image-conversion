'use strict';

/* ---------- Codecs ---------- */

// Decoders/encoders the browser lacks, fetched only when a format needs them.
const CDN = {
  heic: 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/+esm',
  utif: 'https://cdn.jsdelivr.net/npm/utif@3.1.0/+esm',
  gif: 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm',
  pdf: 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/+esm',
  avif: 'https://esm.sh/@jsquash/avif@2.1.1/encode',
  webp: 'https://esm.sh/@jsquash/webp@1.5.0/encode',
};

const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height);
const toBlob = (c, type, q) => new Promise((resolve, reject) =>
  c.toBlob(b => (b ? resolve(b) : reject(new Error('the browser refused to encode this size'))), type, q));
const toDataURL = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

const nativeCache = {};
function canEncode(type) {
  if (!(type in nativeCache)) nativeCache[type] = canvas(1, 1).toDataURL(type).startsWith(`data:${type}`);
  return nativeCache[type];
}

// Native canvas encoder when available, WebAssembly (jSquash) otherwise — Safari has no WebP encoder, most browsers no AVIF one.
async function nativeOrWasm(c, q, type, lib) {
  if (canEncode(type)) return toBlob(c, type, q);
  const { default: encode } = await import(CDN[lib]);
  return new Blob([await encode(pixels(c), { quality: Math.round(q * 100) })], { type });
}

function encodeBmp(c) {
  const { width: w, height: h, data } = pixels(c);
  const row = (w * 3 + 3) & ~3;
  const buf = new ArrayBuffer(54 + row * h);
  const v = new DataView(buf);
  const out = new Uint8Array(buf);
  v.setUint16(0, 0x424d);               // "BM"
  v.setUint32(2, buf.byteLength, true);
  v.setUint32(10, 54, true);            // pixel data offset
  v.setUint32(14, 40, true);            // BITMAPINFOHEADER
  v.setInt32(18, w, true);
  v.setInt32(22, h, true);              // positive = bottom-up rows
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, row * h, true);
  v.setInt32(38, 2835, true);           // 72 dpi
  v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * row;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      out[o++] = data[i + 2]; out[o++] = data[i + 1]; out[o++] = data[i];
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

// ICO with a single PNG payload (Vista+ format).
async function encodeIco(c) {
  const png = await toBlob(c, 'image/png');
  const v = new DataView(new ArrayBuffer(22));
  v.setUint16(2, 1, true);                       // type: icon
  v.setUint16(4, 1, true);                       // one image
  v.setUint8(6, c.width >= 256 ? 0 : c.width);   // 0 means 256
  v.setUint8(7, c.height >= 256 ? 0 : c.height);
  v.setUint16(10, 1, true);                      // colour planes
  v.setUint16(12, 32, true);                     // bits per pixel
  v.setUint32(14, png.size, true);
  v.setUint32(18, 22, true);                     // payload offset
  return new Blob([v.buffer, png], { type: 'image/x-icon' });
}

async function encodeGif(c) {
  const { GIFEncoder, quantize, applyPalette } = await import(CDN.gif);
  const { data, width, height } = pixels(c);
  let alpha = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { alpha = true; break; }
  const format = alpha ? 'rgba4444' : 'rgb565';
  const palette = quantize(data, 256, { format, oneBitAlpha: alpha });
  const index = applyPalette(data, palette, format);
  const t = alpha ? palette.findIndex(p => p[3] === 0) : -1;
  const gif = GIFEncoder();
  gif.writeFrame(index, width, height, { palette, transparent: t >= 0, transparentIndex: Math.max(t, 0) });
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

async function encodeTiff(c) {
  const UTIF = (await import(CDN.utif)).default;
  return new Blob([UTIF.encodeImage(pixels(c).data.buffer, c.width, c.height)], { type: 'image/tiff' });
}

async function encodePdf(c, q) {
  const { jsPDF } = await import(CDN.pdf);
  const { width: w, height: h } = c;
  const doc = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'pt', format: [w, h], compress: true });
  doc.addImage(c.toDataURL('image/jpeg', q), 'JPEG', 0, 0, w, h);
  return doc.output('blob');
}

async function encodeSvg(c) {
  const { width: w, height: h } = c;
  const href = await toDataURL(await toBlob(c, 'image/png'));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image width="${w}" height="${h}" href="${href}"/></svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

const FORMATS = {
  png:  { label: 'PNG',  ext: 'png',  encode: c => toBlob(c, 'image/png') },
  jpeg: { label: 'JPEG', ext: 'jpg',  lossy: true, opaque: true, encode: (c, q) => toBlob(c, 'image/jpeg', q) },
  webp: { label: 'WebP', ext: 'webp', lossy: true, encode: (c, q) => nativeOrWasm(c, q, 'image/webp', 'webp') },
  avif: { label: 'AVIF', ext: 'avif', lossy: true, encode: (c, q) => nativeOrWasm(c, q, 'image/avif', 'avif'),
          hint: () => (canEncode('image/avif') ? '' : 'Encoded with WebAssembly — large images take a few seconds.') },
  gif:  { label: 'GIF',  ext: 'gif',  encode: encodeGif, hint: () => 'Reduced to a 256-colour palette.' },
  bmp:  { label: 'BMP',  ext: 'bmp',  opaque: true, encode: encodeBmp, hint: () => 'Uncompressed 24-bit — files get large.' },
  ico:  { label: 'ICO',  ext: 'ico',  maxSide: 256, encode: encodeIco, hint: () => 'Icons are capped at 256 × 256 px.' },
  tiff: { label: 'TIFF', ext: 'tiff', encode: encodeTiff, hint: () => 'Uncompressed RGBA — files get large.' },
  pdf:  { label: 'PDF',  ext: 'pdf',  lossy: true, opaque: true, encode: encodePdf, hint: () => 'One page, sized to the image.' },
  svg:  { label: 'SVG',  ext: 'svg',  encode: encodeSvg, hint: () => 'Embeds the image inside an SVG. It is not traced into vectors.' },
};

/* ---------- Decoding ---------- */

// Rasterise any blob the browser can read into a canvas.
// ponytail: whole image in one canvas; iOS Safari caps canvases near 16.7 MP, tile if huge photos must work there.
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      // SVGs without width/height report 0 — give them a sensible raster size.
      const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
      const c = canvas(w, h);
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });
}

async function decode(file, onSlow) {
  try {
    return await loadImage(file);
  } catch {
    const name = file.name.toLowerCase();
    if (/\.(heic|heif)$/.test(name) || /hei[cf]/.test(file.type)) {
      onSlow('Decoding HEIC…');
      const heic2any = (await import(CDN.heic)).default;
      const out = await heic2any({ blob: file, toType: 'image/png' });
      return loadImage(Array.isArray(out) ? out[0] : out);
    }
    if (/\.tiff?$/.test(name) || file.type === 'image/tiff') {
      onSlow('Decoding TIFF…');
      const UTIF = (await import(CDN.utif)).default;
      const buf = await file.arrayBuffer();
      const [page] = UTIF.decode(buf);
      UTIF.decodeImage(buf, page);
      const rgba = UTIF.toRGBA8(page);
      const c = canvas(page.width, page.height);
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), page.width, page.height), 0, 0);
      return c;
    }
    throw new Error(`Can't read “${file.name}”. Try PNG, JPEG, WebP, AVIF, GIF, BMP, ICO, SVG, HEIC or TIFF.`);
  }
}

/* ---------- Adjustments (same maths as CSS filter, so preview matches export) ---------- */

const ADJ_DEFAULT = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0 };

function adjustPixels(img, { brightness, contrast, saturate, grayscale }) {
  const b = brightness / 100, k = contrast / 100, s = (saturate / 100) * (1 - grayscale / 100);
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    const x = Math.min(1, (v / 255) * b);
    lut[v] = Math.min(1, Math.max(0, (x - 0.5) * k + 0.5)) * 255;
  }
  const p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = lut[p[i]], g = lut[p[i + 1]], bl = lut[p[i + 2]];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    p[i] = l + s * (r - l); p[i + 1] = l + s * (g - l); p[i + 2] = l + s * (bl - l); // Uint8ClampedArray clamps
  }
  return img;
}

const cssFilter = a =>
  `brightness(${a.brightness}%) contrast(${a.contrast}%) saturate(${a.saturate}%) grayscale(${a.grayscale}%)`;

const fmtBytes = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
const escapeHtml = s => String(s).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

window.Recast = { FORMATS, adjustPixels };

/* ---------- UI ---------- */

if (document.getElementById('app')) {
  const $ = id => document.getElementById(id);
  const el = {
    stage: $('stage'), drop: $('drop'), file: $('file'), viewport: $('viewport'), frame: $('frame'), view: $('view'),
    crop: $('crop'), shade: $('shade'), stageBar: $('stageBar'), meta: $('meta'), replace: $('replace'), status: $('status'),
    panel: $('panel'), controls: $('controls'), fmtList: $('formats-list'), hint: $('fmtHint'),
    qualityRow: $('qualityRow'), quality: $('quality'), qualityOut: $('qualityOut'), bgRow: $('bgRow'), bg: $('bg'),
    cropOut: $('cropOut'), cropReset: $('cropReset'), outW: $('outW'), outH: $('outH'), lock: $('lock'),
    adjReset: $('adjReset'), go: $('go'), result: $('result'),
  };
  const MAX_SIDE = 16384;
  const MIN_CROP = 8;

  const S = {
    file: null, src: null,
    m: [1, 0, 0, 1],          // display-space rotation/flip matrix, canvas (a, b, c, d) order
    crop: null, aspect: null,
    out: { w: 0, h: 0 }, sizeAuto: true, lock: true,
    fmt: 'webp', adj: { ...ADJ_DEFAULT }, url: null,
  };

  const setStatus = (msg, isError = false) => {
    el.status.textContent = msg;
    el.status.style.color = isError ? '' : 'var(--color-graphite)';
  };
  function showResult(html, isError = false) {
    el.result.innerHTML = html;
    el.result.classList.toggle('is-error', isError);
  }

  /* Formats */
  el.fmtList.innerHTML = Object.entries(FORMATS).map(([key, f]) =>
    `<label class="chip"><input type="radio" name="fmt" value="${key}"${key === S.fmt ? ' checked' : ''}><span>${f.label}</span></label>`).join('');
  function syncFormat() {
    const f = FORMATS[S.fmt];
    el.qualityRow.hidden = !f.lossy;
    el.bgRow.hidden = !f.opaque;
    el.hint.textContent = f.hint ? f.hint() : '';
  }
  el.fmtList.addEventListener('change', e => { S.fmt = e.target.value; syncFormat(); });
  el.quality.addEventListener('input', () => { el.qualityOut.textContent = el.quality.value; });
  syncFormat();

  /* Loading */
  async function open(file) {
    if (!file) return;
    el.result.textContent = '';
    setStatus('');
    try {
      const src = await decode(file, msg => setStatus(msg));
      setStatus('');
      Object.assign(S, { file, src, m: [1, 0, 0, 1], sizeAuto: true });
      el.meta.textContent = `${file.name} · ${src.width} × ${src.height} · ${fmtBytes(file.size)}`;
      el.drop.hidden = true;
      el.viewport.hidden = false;
      el.stageBar.hidden = false;
      el.controls.disabled = false;
      el.go.disabled = false;
      render();
    } catch (err) {
      setStatus(err.message.startsWith('Can') ? err.message : `Couldn't open that file: ${err.message}`, true);
    } finally {
      el.file.value = '';
    }
  }

  el.file.addEventListener('change', () => open(el.file.files[0]));
  el.replace.addEventListener('click', () => el.file.click());
  el.stage.addEventListener('dragover', e => { e.preventDefault(); el.drop.classList.add('is-over'); });
  el.stage.addEventListener('dragleave', e => { if (!el.stage.contains(e.relatedTarget)) el.drop.classList.remove('is-over'); });
  el.stage.addEventListener('drop', e => {
    e.preventDefault();
    el.drop.classList.remove('is-over');
    open(e.dataTransfer.files[0]);
  });
  document.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.kind === 'file' && i.type.startsWith('image/'));
    if (!item) return;
    const blob = item.getAsFile();
    open(new File([blob], `pasted.${blob.type.split('/')[1] || 'png'}`, { type: blob.type }));
  });

  /* Rotate + flip: draw the source through S.m into the visible canvas */
  function render() {
    const { src, m } = S;
    const swap = m[0] === 0;
    const c = el.view;
    c.width = swap ? src.height : src.width;
    c.height = swap ? src.width : src.height;
    const x = c.getContext('2d');
    x.setTransform(m[0], m[1], m[2], m[3], c.width / 2, c.height / 2);
    x.drawImage(src, -src.width / 2, -src.height / 2);
    x.setTransform(1, 0, 0, 1, 0, 0);
    S.crop = fitCrop();
    drawCrop();
  }
  const OPS = { rotR: [0, 1, -1, 0], rotL: [0, -1, 1, 0], flipX: [-1, 0, 0, 1], flipY: [1, 0, 0, -1] };
  const compose = (p, m) => [p[0] * m[0] + p[2] * m[1], p[1] * m[0] + p[3] * m[1], p[0] * m[2] + p[2] * m[3], p[1] * m[2] + p[3] * m[3]];
  document.querySelector('.tools').addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || !S.src) return;
    S.m = compose(OPS[act], S.m);
    if (S.aspectKey === 'orig' && act.startsWith('rot')) S.aspect = 1 / S.aspect;
    render();
  });

  /* Crop */
  function fitCrop() {
    const W = el.view.width, H = el.view.height;
    if (!S.aspect) return { x: 0, y: 0, w: W, h: H };
    let w = W, h = W / S.aspect;
    if (h > H) { h = H; w = H * S.aspect; }
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }
  function drawCrop() {
    const W = el.view.width, H = el.view.height, { x, y, w, h } = S.crop;
    const [l, t, r, b] = [(x / W) * 100, (y / H) * 100, ((x + w) / W) * 100, ((y + h) / H) * 100];
    Object.assign(el.crop.style, { left: `${l}%`, top: `${t}%`, width: `${r - l}%`, height: `${b - t}%` });
    // Scrim with a hole where the crop is.
    el.shade.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l}% ${t}%, ${r}% ${t}%, ${r}% ${b}%, ${l}% ${b}%, ${l}% ${t}%)`;
    el.cropOut.textContent = `${Math.round(w)} × ${Math.round(h)} px`;
    if (S.sizeAuto) setOut(Math.round(w), Math.round(h));
    else if (S.lock) setOut(S.out.w, Math.max(1, Math.round((S.out.w * h) / w)));
  }
  $('aspects').addEventListener('change', e => {
    const v = e.target.value;
    S.aspectKey = v;
    S.aspect = v === 'free' ? null : v === 'orig' ? el.view.width / el.view.height : +v;
    S.crop = fitCrop();
    drawCrop();
  });
  el.cropReset.addEventListener('click', () => { S.crop = fitCrop(); drawCrop(); });

  // Screen px → image px.
  const scale = () => el.view.width / el.frame.getBoundingClientRect().width;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  el.crop.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.crop.focus({ preventScroll: true });
    const mode = e.target.closest('.h')?.dataset.h || 'move';
    const start = { ...S.crop }, sx = e.clientX, sy = e.clientY, k = scale();
    const W = el.view.width, H = el.view.height;
    el.crop.setPointerCapture(e.pointerId);
    el.crop.classList.add('is-dragging');

    const move = ev => {
      const dx = (ev.clientX - sx) * k, dy = (ev.clientY - sy) * k;
      let { x, y, w, h } = start;
      if (mode === 'move') {
        x = clamp(x + dx, 0, W - w);
        y = clamp(y + dy, 0, H - h);
      } else {
        if (mode.includes('w')) { const nx = clamp(x + dx, 0, x + w - MIN_CROP); w += x - nx; x = nx; }
        if (mode.includes('e')) w = clamp(w + dx, MIN_CROP, W - x);
        if (mode.includes('n')) { const ny = clamp(y + dy, 0, y + h - MIN_CROP); h += y - ny; y = ny; }
        if (mode.includes('s')) h = clamp(h + dy, MIN_CROP, H - y);
        if (S.aspect) {
          const r = S.aspect;
          if (mode === 'n' || mode === 's') w = h * r; else h = w / r;
          // Keep the edge opposite the dragged handle fixed; centre on the free axis.
          x = mode.includes('w') ? start.x + start.w - w : mode === 'n' || mode === 's' ? start.x + (start.w - w) / 2 : start.x;
          y = mode.includes('n') ? start.y + start.h - h : mode === 'e' || mode === 'w' ? start.y + (start.h - h) / 2 : start.y;
          if (x < -0.5 || y < -0.5 || x + w > W + 0.5 || y + h > H + 0.5 || w < MIN_CROP || h < MIN_CROP) return;
        }
      }
      S.crop = { x, y, w, h };
      drawCrop();
    };
    const up = () => {
      el.crop.classList.remove('is-dragging');
      el.crop.removeEventListener('pointermove', move);
      el.crop.removeEventListener('pointerup', up);
      el.crop.removeEventListener('pointercancel', up);
    };
    el.crop.addEventListener('pointermove', move);
    el.crop.addEventListener('pointerup', up);
    el.crop.addEventListener('pointercancel', up);
  });

  el.crop.addEventListener('keydown', e => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) * scale();
    const { x, y, w, h } = S.crop;
    S.crop = { x: clamp(x + d[0] * step, 0, el.view.width - w), y: clamp(y + d[1] * step, 0, el.view.height - h), w, h };
    drawCrop();
  });

  /* Resize */
  function setOut(w, h) {
    S.out = { w, h };
    el.outW.value = w;
    el.outH.value = h;
    el.outW.removeAttribute('aria-invalid');
    el.outH.removeAttribute('aria-invalid');
  }
  const ratio = () => S.crop.w / S.crop.h;
  function sizeInput(input, other, key, otherKey, toOther) {
    input.addEventListener('input', () => {
      const v = Math.round(+input.value);
      if (!(v >= 1)) return;
      S.sizeAuto = false;
      S.out[key] = v;
      if (S.lock) { S.out[otherKey] = Math.max(1, Math.round(toOther(v))); other.value = S.out[otherKey]; }
    });
  }
  sizeInput(el.outW, el.outH, 'w', 'h', w => w / ratio());
  sizeInput(el.outH, el.outW, 'h', 'w', h => h * ratio());
  el.lock.addEventListener('click', () => {
    S.lock = !S.lock;
    el.lock.setAttribute('aria-pressed', S.lock);
    if (S.lock) setOut(S.out.w, Math.max(1, Math.round(S.out.w / ratio())));
  });
  $('scales').addEventListener('click', e => {
    const s = +e.target.closest('[data-scale]')?.dataset.scale;
    if (!s || !S.crop) return;
    S.sizeAuto = s === 1;
    setOut(Math.max(1, Math.round(S.crop.w * s)), Math.max(1, Math.round(S.crop.h * s)));
  });

  /* Adjust */
  const adjInputs = [...el.panel.querySelectorAll('[data-adj]')];
  function syncAdjust() {
    for (const i of adjInputs) { S.adj[i.id] = +i.value; $(`${i.id}Out`).textContent = i.value; }
    el.view.style.filter = cssFilter(S.adj);
  }
  adjInputs.forEach(i => i.addEventListener('input', syncAdjust));
  el.adjReset.addEventListener('click', () => {
    for (const i of adjInputs) i.value = ADJ_DEFAULT[i.id];
    syncAdjust();
  });

  /* Export */
  el.panel.addEventListener('submit', async e => {
    e.preventDefault();
    if (!S.src || el.go.hasAttribute('aria-busy')) return;
    const f = FORMATS[S.fmt];
    let { w, h } = S.out;
    const bad = [[el.outW, w], [el.outH, h]].filter(([, v]) => !(v >= 1 && v <= MAX_SIDE));
    if (bad.length) {
      bad.forEach(([input]) => input.setAttribute('aria-invalid', 'true'));
      showResult(`Width and height must be between 1 and ${MAX_SIDE} px.`, true);
      bad[0][0].focus();
      return;
    }
    if (f.maxSide && Math.max(w, h) > f.maxSide) {
      const k = f.maxSide / Math.max(w, h);
      w = Math.max(1, Math.round(w * k));
      h = Math.max(1, Math.round(h * k));
    }

    el.go.setAttribute('aria-busy', 'true');
    el.go.firstChild.textContent = 'Converting ';
    try {
      // ponytail: single-pass downscale; add stepped halving if big reductions look soft.
      const c = canvas(w, h);
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      const { x: cx, y: cy, w: cw, h: ch } = S.crop;
      x.drawImage(el.view, cx, cy, cw, ch, 0, 0, w, h);
      if (Object.keys(ADJ_DEFAULT).some(k => S.adj[k] !== ADJ_DEFAULT[k])) x.putImageData(adjustPixels(pixels(c), S.adj), 0, 0);
      if (f.opaque) {
        x.globalCompositeOperation = 'destination-over';
        x.fillStyle = el.bg.value;
        x.fillRect(0, 0, w, h);
      }
      const blob = await f.encode(c, +el.quality.value / 100);
      const name = `${S.file.name.replace(/\.[^.]+$/, '') || 'image'}.${f.ext}`;
      if (S.url) URL.revokeObjectURL(S.url);
      S.url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: S.url, download: name }).click();
      const pct = Math.max(-99, Math.round((blob.size / S.file.size - 1) * 100));
      showResult(`<b>${escapeHtml(name)}</b> · ${w} × ${h} · ${fmtBytes(blob.size)} (${pct > 0 ? '+' : ''}${pct}%) · <a href="${S.url}" download="${escapeHtml(name)}">Download again</a>`);
    } catch (err) {
      showResult(`Couldn't convert to ${f.label}: ${escapeHtml(err?.message || err)}. If this format loads an encoder, check your connection and try again.`, true);
    } finally {
      el.go.removeAttribute('aria-busy');
      el.go.firstChild.textContent = 'Convert & download ';
    }
  });
}
