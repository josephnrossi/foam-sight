/* FoamSight canvas cameras and charts. */
(function (global) {
  const TYPES = (global.FoamSightSim && global.FoamSightSim.DEFECT_TYPES) || {};

  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeFoamTile(w, h, seed, tone) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = tone.base;
    ctx.fillRect(0, 0, w, h);
    const rng = mulberry32(seed);
    for (let i = 0; i < 2800; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const rx = 0.7 + rng() * 2.1;
      const ry = rx * (0.65 + rng() * 0.55);
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fillStyle = rng() > 0.55 ? tone.hi : tone.lo;
      ctx.globalAlpha = 0.22 + rng() * 0.35;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (let x = 0; x < w; x += 2) {
      ctx.fillStyle = 'rgba(70,52,28,' + (0.015 + rng() * 0.03) + ')';
      ctx.fillRect(x, 0, 1, h);
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = 'rgba(40,30,16,' + (0.04 + rng() * 0.08) + ')';
      ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
    }
    return c;
  }

  function Cameras() {
    this.tiles = {
      top: makeFoamTile(512, 256, 1201, { base: '#e6d9be', hi: '#fff6e4', lo: '#c4b292' }),
      bottom: makeFoamTile(512, 256, 7743, { base: '#cbb896', hi: '#e8d7b4', lo: '#a89472' })
    };
    this._last = { w: 0, h: 0 };
  }

  function fitCanvas(cv) {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.floor(r.width * dpr));
    const h = Math.max(2, Math.floor(r.height * dpr));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    return { w: w, h: h, dpr: dpr, cssW: r.width, cssH: r.height };
  }

  function hud(ctx, w, h, title, extra) {
    ctx.save();
    ctx.strokeStyle = 'rgba(78,200,232,.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    const cx = w / 2, cy = h / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy); ctx.lineTo(cx + 18, cy);
    ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy + 18);
    ctx.stroke();
    ctx.fillStyle = 'rgba(78,200,232,.85)';
    ctx.font = '11px ui-monospace, SF Mono, Menlo, monospace';
    ctx.fillText(title, 12, 20);
    if (extra) ctx.fillText(extra, 12, h - 12);
    ctx.restore();
  }

  function screenX(state, xMm, w) {
    return ((xMm - state.scrollMm) / state.viewMm) * w;
  }

  function drawDefectBlob(ctx, d, x, y, sx, sy) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(d.rot || 0);
    if (d.type === 'PINHOLE') {
      ctx.fillStyle = '#2a1c10';
      ctx.beginPath();
      ctx.ellipse(0, 0, sx * 0.45, sy * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,10,0,.6)';
      ctx.stroke();
    } else if (d.type === 'SCRATCH') {
      ctx.strokeStyle = 'rgba(50,32,16,.85)';
      ctx.lineWidth = Math.max(1.2, sy * 0.15);
      ctx.beginPath();
      ctx.moveTo(-sx, -sy * 0.2);
      ctx.quadraticCurveTo(0, sy * 0.35, sx, sy * 0.1);
      ctx.stroke();
    } else if (d.type === 'DENT') {
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, sx);
      g.addColorStop(0, 'rgba(90,70,40,.75)');
      g.addColorStop(1, 'rgba(90,70,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, sx, sy * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.type === 'BLOWOUT') {
      ctx.fillStyle = '#5a3a22';
      ctx.beginPath();
      ctx.ellipse(0, 0, sx, sy * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1c120a';
      ctx.beginPath();
      ctx.ellipse(0, 0, sx * 0.55, sy * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,160,.25)';
      ctx.stroke();
    } else if (d.type === 'DEBRIS') {
      ctx.fillStyle = d.camera === 'bottom' ? '#3a342c' : '#1a1612';
      ctx.beginPath();
      ctx.moveTo(-sx * 0.7, 0);
      ctx.lineTo(-sx * 0.2, -sy * 0.8);
      ctx.lineTo(sx * 0.6, -sy * 0.3);
      ctx.lineTo(sx * 0.5, sy * 0.55);
      ctx.lineTo(-sx * 0.35, sy * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#6a5a40';
      ctx.fillRect(-sx * 0.15, -sy * 0.15, sx * 0.3, sy * 0.2);
    } else if (d.type === 'DISCOLOR') {
      ctx.fillStyle = 'rgba(196, 110, 58, .38)';
      ctx.beginPath();
      ctx.ellipse(0, 0, sx * 1.1, sy * 0.7, 0.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.type === 'EDGE_CHIP') {
      ctx.fillStyle = '#2c2418';
      ctx.beginPath();
      ctx.moveTo(-sx, 0);
      ctx.lineTo(0, -sy);
      ctx.lineTo(sx, sy * 0.2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function overlayColor(sev) {
    if (sev === 'reject') return '#ef5b4a';
    if (sev === 'warn') return '#f0c14b';
    return '#4ec8e8';
  }

  function drawOverlays(ctx, state, camera, sheet) {
    const vis = state.defects;
    const w = sheet.w, h = sheet.h;
    for (let i = 0; i < vis.length; i++) {
      const d = vis[i];
      if (d.exited) continue;
      if (d.camera !== camera && !(camera === 'edge' && d.camera === 'edge')) continue;
      if (camera !== 'edge' && d.camera !== camera) continue;
      const x = sheet.x0 + screenX(state, d.xMm, sheet.sw);
      if (x < sheet.x0 - 20 || x > sheet.x0 + sheet.sw + 20) continue;
      const y = camera === 'edge'
        ? sheet.y0 + sheet.sh * 0.5
        : sheet.y0 + d.yPct * sheet.sh;
      const sx = Math.max(8, (d.lengthMm / state.viewMm) * sheet.sw * (d.type === 'SCRATCH' ? 1 : 0.55) + 10);
      const sy = Math.max(6, (d.widthMm / 40) * sheet.sh + 6);
      drawDefectBlob(ctx, d, x, y, sx, sy);
      const col = overlayColor(d.severity);
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      const bw = Math.max(sx * 2 + 8, 36);
      const bh = Math.max(sy * 2 + 8, 22);
      ctx.strokeRect(x - bw / 2, y - bh / 2, bw, bh);
      const label = (TYPES[d.type] ? TYPES[d.type].label : d.type) + '  ' + d.sizeMm.toFixed(1) + ' mm';
      ctx.font = '10px ui-monospace, SF Mono, Menlo, monospace';
      const tw = ctx.measureText(label).width + 10;
      const lx = Math.min(Math.max(x - tw / 2, sheet.x0 + 4), sheet.x0 + sheet.sw - tw - 4);
      const ly = Math.max(y - bh / 2 - 16, sheet.y0 + 4);
      ctx.fillStyle = 'rgba(8,12,16,.82)';
      ctx.fillRect(lx, ly, tw, 14);
      ctx.fillStyle = col;
      ctx.fillText(label, lx + 5, ly + 11);
      ctx.restore();
    }
  }

  function drawSurface(ctx, w, h, state, camera, tile) {
    ctx.fillStyle = '#070b10';
    ctx.fillRect(0, 0, w, h);
    const x0 = Math.floor(w * 0.015);
    const y0 = Math.floor(h * 0.13);
    const sw = Math.floor(w * 0.97);
    const sh = Math.floor(h * 0.72);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, sw, sh);
    ctx.clip();
    const view = state.viewMm;
    const off = ((state.scrollMm % view) / view) * sw;
    const tileW = (tile.width / tile.height) * sh;
    for (let px = x0 - (off % tileW) - tileW; px < x0 + sw + tileW; px += tileW) {
      ctx.drawImage(tile, px, y0, tileW, sh);
    }
    // slight center vignette / lighting
    const g = ctx.createLinearGradient(x0, y0, x0, y0 + sh);
    g.addColorStop(0, 'rgba(0,0,0,.28)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.32)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, sw, sh);

    drawOverlays(ctx, state, camera, { x0: x0, y0: y0, sw: sw, sh: sh, w: w, h: h });

    // laser inspection line
    const lx = x0 + sw * 0.62;
    ctx.strokeStyle = 'rgba(63,212,154,.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lx, y0);
    ctx.lineTo(lx, y0 + sh);
    ctx.stroke();
    ctx.fillStyle = 'rgba(63,212,154,.8)';
    ctx.font = '10px ui-monospace, SF Mono, Menlo, monospace';
    ctx.fillText('LASER', lx + 6, y0 + 14);
    ctx.restore();

    // rulers
    ctx.strokeStyle = 'rgba(78,200,232,.4)';
    ctx.fillStyle = 'rgba(78,200,232,.7)';
    ctx.font = '9px ui-monospace, SF Mono, Menlo, monospace';
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) {
      const x = x0 + (sw * i) / 8;
      ctx.moveTo(x, y0 + sh);
      ctx.lineTo(x, y0 + sh + 6);
    }
    ctx.stroke();
    ctx.fillText('0 mm', x0, y0 + sh + 16);
    ctx.fillText(Math.round(view) + ' mm', x0 + sw - 40, y0 + sh + 16);

    const extra = 'POS ' + state.scrollMm.toFixed(0) + ' mm   ENC ' + Math.floor(state.encoder);
    hud(ctx, w, h, camera.toUpperCase() + '  ·  XPS SHEET', extra);
  }

  function drawEdge(ctx, w, h, state) {
    ctx.fillStyle = '#070b10';
    ctx.fillRect(0, 0, w, h);
    const mid = h * 0.5;
    const scale = (h * 0.42) / 40; // 40 mm full scale
    const th = state.thickness * scale;
    const tgt = state.recipe.targetThickness * scale;
    const tol = state.recipe.thicknessTol * scale;
    const yTop = mid - th / 2;
    const len = w;

    // machine bed
    ctx.fillStyle = '#151b22';
    ctx.fillRect(0, mid + th / 2 + 8, w, h);

    // moving foam slab
    const view = state.viewMm;
    const off = ((state.scrollMm % view) / view) * w;
    ctx.fillStyle = '#e2d4b6';
    ctx.fillRect(-20, yTop, len + 40, th);
    // cell texture on edge
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, yTop, w, th);
    ctx.clip();
    ctx.strokeStyle = 'rgba(90,70,40,.25)';
    for (let x = -off; x < w + 20; x += 6) {
      ctx.beginPath();
      ctx.moveTo(x, yTop);
      ctx.lineTo(x + 3, yTop + th);
      ctx.stroke();
    }
    // surface roughness
    ctx.strokeStyle = 'rgba(60,45,24,.55)';
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const n = Math.sin((x + state.scrollMm) * 0.08) * 1.4 + Math.sin((x + state.scrollMm) * 0.31) * 0.7;
      ctx.lineTo(x, yTop + n);
    }
    ctx.stroke();
    ctx.restore();

    // edge chips on profile
    for (let i = 0; i < state.defects.length; i++) {
      const d = state.defects[i];
      if (d.exited || d.camera !== 'edge') continue;
      const x = screenX(state, d.xMm, w);
      drawDefectBlob(ctx, d, x, yTop, 10, 8);
    }
    drawOverlays(ctx, state, 'edge', { x0: 0, y0: yTop - 20, sw: w, sh: th + 40, w: w, h: h });

    // tolerance bands
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(240,193,75,.7)';
    ctx.beginPath();
    ctx.moveTo(0, mid - (tgt + tol) / 1 - 0); // keep simple
    const up = mid - (tgt + tol);
    const dn = mid + (tgt + tol);
    // target band around center? thickness is the slab height, so USL/LSL as slab outer
    const uslTop = mid - (state.recipe.targetThickness + state.recipe.thicknessTol) * scale / 1 - ( (state.recipe.targetThickness + state.recipe.thicknessTol) * scale - th ) / 2;
    // clearer: draw USL/LSL as horizontal lines relative to slab top/bottom from target
    const targetTop = mid - tgt / 2;
    const targetBot = mid + tgt / 2;
    ctx.beginPath();
    ctx.moveTo(0, targetTop - tol); ctx.lineTo(w, targetTop - tol);
    ctx.moveTo(0, targetBot + tol); ctx.lineTo(w, targetBot + tol);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(63,212,154,.85)';
    ctx.beginPath();
    ctx.moveTo(0, targetTop); ctx.lineTo(w, targetTop);
    ctx.moveTo(0, targetBot); ctx.lineTo(w, targetBot);
    ctx.stroke();

    // caliper bracket
    const cx = w * 0.72;
    ctx.strokeStyle = '#4ec8e8';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx - 16, yTop);
    ctx.lineTo(cx + 16, yTop);
    ctx.moveTo(cx - 16, yTop + th);
    ctx.lineTo(cx + 16, yTop + th);
    ctx.moveTo(cx, yTop);
    ctx.lineTo(cx, yTop + th);
    ctx.stroke();
    ctx.fillStyle = '#4ec8e8';
    ctx.font = '12px ui-monospace, SF Mono, Menlo, monospace';
    ctx.fillText(state.thickness.toFixed(3) + ' mm', cx + 10, mid);

    hud(ctx, w, h, 'EDGE PROFILE  ·  THICKNESS CALIPER',
      'USL ' + (state.recipe.targetThickness + state.recipe.thicknessTol).toFixed(2) +
      '   LSL ' + (state.recipe.targetThickness - state.recipe.thicknessTol).toFixed(2) + ' mm');
  }

  Cameras.prototype.drawTop = function (cv, state) {
    const s = fitCanvas(cv);
    drawSurface(cv.getContext('2d'), s.w, s.h, state, 'top', this.tiles.top);
  };
  Cameras.prototype.drawBottom = function (cv, state) {
    const s = fitCanvas(cv);
    drawSurface(cv.getContext('2d'), s.w, s.h, state, 'bottom', this.tiles.bottom);
  };
  Cameras.prototype.drawEdge = function (cv, state) {
    const s = fitCanvas(cv);
    drawEdge(cv.getContext('2d'), s.w, s.h, state);
  };

  function drawSpark(cv, state) {
    const s = fitCanvas(cv);
    const ctx = cv.getContext('2d');
    const w = s.w, h = s.h;
    ctx.fillStyle = '#0b1118';
    ctx.fillRect(0, 0, w, h);
    const data = state.spark;
    if (data.length < 2) return;
    const tgt = state.recipe.targetThickness;
    const tol = state.recipe.thicknessTol;
    const lo = tgt - tol * 1.6;
    const hi = tgt + tol * 1.6;
    const yOf = function (v) { return h - ((v - lo) / (hi - lo)) * (h - 4) - 2; };
    ctx.fillStyle = 'rgba(22,56,44,.55)';
    ctx.fillRect(0, yOf(tgt + tol), w, yOf(tgt - tol) - yOf(tgt + tol));
    ctx.strokeStyle = 'rgba(63,212,154,.45)';
    ctx.beginPath();
    ctx.moveTo(0, yOf(tgt));
    ctx.lineTo(w, yOf(tgt));
    ctx.stroke();
    ctx.strokeStyle = '#4ec8e8';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * w;
      const y = yOf(data[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function debrisBuckets(state) {
    const buckets = [0, 0, 0, 0, 0];
    for (let i = 0; i < state.debrisLog.length; i++) {
      const s = state.debrisLog[i];
      if (s < 0.5) buckets[0]++;
      else if (s < 1) buckets[1]++;
      else if (s < 2) buckets[2]++;
      else if (s < 3) buckets[3]++;
      else buckets[4]++;
    }
    return buckets;
  }

  function drawHist(cv, state) {
    const s = fitCanvas(cv);
    const ctx = cv.getContext('2d');
    const w = s.w, h = s.h;
    ctx.fillStyle = '#0b1118';
    ctx.fillRect(0, 0, w, h);
    const buckets = debrisBuckets(state);
    const max = Math.max(1, Math.max.apply(null, buckets));
    const n = buckets.length;
    const gap = 6;
    const bw = (w - gap * (n + 1)) / n;
    for (let i = 0; i < n; i++) {
      const bh = (buckets[i] / max) * (h - 8);
      const x = gap + i * (bw + gap);
      const over = i >= 3;
      ctx.fillStyle = over ? 'rgba(239,91,74,.8)' : 'rgba(78,200,232,.8)';
      ctx.fillRect(x, h - 4 - bh, bw, bh);
    }
  }

  function drawSpc(cv, state) {
    const s = fitCanvas(cv);
    const ctx = cv.getContext('2d');
    const w = s.w, h = s.h;
    ctx.fillStyle = '#0b1118';
    ctx.fillRect(0, 0, w, h);
    const boards = state.boards;
    const tgt = state.recipe.targetThickness;
    const ucl = tgt + state.recipe.thicknessTol;
    const lcl = tgt - state.recipe.thicknessTol;
    const padL = 36, padR = 12, padT = 10, padB = 16;
    const pw = w - padL - padR, ph = h - padT - padB;
    const lo = lcl - state.recipe.thicknessTol * 0.5;
    const hi = ucl + state.recipe.thicknessTol * 0.5;
    const yOf = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * ph; };
    ctx.fillStyle = 'rgba(22,56,44,.45)';
    ctx.fillRect(padL, yOf(ucl), pw, yOf(lcl) - yOf(ucl));
    ctx.strokeStyle = 'rgba(63,212,154,.7)';
    ctx.beginPath(); ctx.moveTo(padL, yOf(tgt)); ctx.lineTo(padL + pw, yOf(tgt)); ctx.stroke();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(240,193,75,.75)';
    ctx.beginPath(); ctx.moveTo(padL, yOf(ucl)); ctx.lineTo(padL + pw, yOf(ucl)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padL, yOf(lcl)); ctx.lineTo(padL + pw, yOf(lcl)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#8b99a8';
    ctx.font = '10px ui-monospace, SF Mono, Menlo, monospace';
    ctx.fillText(ucl.toFixed(2), 4, yOf(ucl) + 3);
    ctx.fillText(lcl.toFixed(2), 4, yOf(lcl) + 3);
    ctx.fillText('CL', padL + pw - 16, yOf(tgt) - 4);
    if (!boards.length) {
      ctx.fillStyle = '#5c6b7a';
      ctx.fillText('Collecting board means…', padL + 12, padT + ph / 2);
      return;
    }
    const n = boards.length;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = padL + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
      const y = yOf(boards[i].thickness);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#4ec8e8';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      const x = padL + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
      const y = yOf(boards[i].thickness);
      const oos = boards[i].thickness > ucl || boards[i].thickness < lcl || boards[i].status === 'REJECT';
      ctx.fillStyle = oos ? '#ef5b4a' : '#3fd49a';
      ctx.beginPath();
      ctx.arc(x, y, 3.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawThumb(cv, board) {
    const ctx = cv.getContext('2d');
    const w = cv.width = 140;
    const h = cv.height = 40;
    ctx.fillStyle = board.status === 'REJECT' ? '#3a1814' : board.status === 'WARN' ? '#2a220e' : '#123028';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d7c7a4';
    ctx.fillRect(6, 10, w - 12, h - 18);
    ctx.fillStyle = board.status === 'REJECT' ? '#ef5b4a' : board.status === 'WARN' ? '#f0c14b' : '#3fd49a';
    const p = Math.max(0.15, Math.min(0.85, (board.thickness - 12.2) / 1.0));
    ctx.fillRect(6, h - 7, (w - 12) * p, 3);
    if (board.defectCount) {
      ctx.fillStyle = '#1a1612';
      for (let i = 0; i < Math.min(board.defectCount, 4); i++) {
        ctx.fillRect(16 + i * 22, 14, 6, 6);
      }
    }
  }

  global.FoamSightCameras = {
    Cameras: Cameras,
    drawSpark: drawSpark,
    drawHist: drawHist,
    drawSpc: drawSpc,
    drawThumb: drawThumb,
    debrisBuckets: debrisBuckets
  };
})(typeof window !== 'undefined' ? window : global);
