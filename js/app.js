/* FoamSight UI — wires simulation to the dashboard. */
(function () {
  const params = new URLSearchParams(location.search);
  const sim = FoamSightSim.createSim({
    seed: params.get('seed') || 'live',
    paused: params.get('paused') === '1'
  });
  const cams = new FoamSightCameras.Cameras();
  const S = sim.state;

  const $ = function (id) { return document.getElementById(id); };
  const appEl = document.getElementById('app');

  const MM_IN = 25.4;
  function toDisp(mm, digits) {
    if (S.units === 'in') return (mm / MM_IN).toFixed(digits == null ? 3 : digits);
    return mm.toFixed(digits == null ? 3 : digits);
  }
  function fromDisp(val) {
    const n = parseFloat(val);
    if (!isFinite(n)) return null;
    return S.units === 'in' ? n * MM_IN : n;
  }
  function unit() { return S.units === 'in' ? 'in' : 'mm'; }
  function speedDisp() {
    return S.units === 'in' ? (S.lineSpeed * 3.28084).toFixed(2) : S.lineSpeed.toFixed(2);
  }
  function speedUnit() { return S.units === 'in' ? 'ft/min' : 'm/min'; }

  function fmtClock(ts) {
    const d = new Date(ts);
    const p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function fmtDur(ms) {
    const s = Math.floor(ms / 1000);
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }

  let lastBeep = 0;
  let audioCtx = null;
  function beep() {
    const now = Date.now();
    if (now - lastBeep < 900) return;
    lastBeep = now;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'square';
      o.frequency.value = 880;
      g.gain.value = 0.035;
      o.connect(g); g.connect(audioCtx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.14);
      o.stop(audioCtx.currentTime + 0.15);
    } catch (e) { /* ignore */ }
  }

  function alarmDetail() {
    if (S.status === 'PASS') return 'All gauges in specification';
    if (!S.reasons.length) return S.status === 'REJECT' ? 'Out of specification' : 'Approaching tolerance';
    const map = {
      THICK_HI: 'Thickness above USL',
      THICK_LO: 'Thickness below LSL',
      TOLERANCE: 'Thickness near tolerance limit',
      WIDTH_HI: 'Width above max',
      WIDTH_LO: 'Width below min',
      WARP: 'Flatness / warp limit',
      DENSITY: 'Density out of window',
      DEBRIS: 'Foreign material detected',
      SCRATCH: 'Surface scratch',
      PINHOLE: 'Pinhole detected',
      BLOWOUT: 'Cell blowout',
      DENT: 'Surface dent',
      DISCOLOR: 'Discoloration',
      EDGE: 'Edge chip',
      AREA: 'Defect area exceeds limit'
    };
    return S.reasons.map(function (c) { return map[c] || c; }).join(' · ');
  }

  let recipeSilent = false;
  function fillRecipeForm() {
    recipeSilent = true;
    const d = S.units === 'in' ? 4 : 2;
    $('r-thick').value = toDisp(S.recipe.targetThickness, d);
    $('r-tol').value = toDisp(S.recipe.thicknessTol, d);
    $('r-wmin').value = toDisp(S.recipe.widthMin, S.units === 'in' ? 3 : 1);
    $('r-wmax').value = toDisp(S.recipe.widthMax, S.units === 'in' ? 3 : 1);
    $('r-debris').value = toDisp(S.recipe.maxDebrisMm, S.units === 'in' ? 4 : 2);
    $('r-area').value = S.recipe.maxDefectAreaPct.toFixed(2);
    $('r-flat').value = toDisp(S.recipe.maxFlatness, S.units === 'in' ? 4 : 2);
    $('r-dentol').value = S.recipe.densityTol.toFixed(1);
    recipeSilent = false;
  }

  function readRecipeForm() {
    if (recipeSilent) return;
    const pick = function (id, fallback) {
      const v = fromDisp($(id).value);
      return v == null ? fallback : v;
    };
    const area = parseFloat($('r-area').value);
    const dens = parseFloat($('r-dentol').value);
    sim.setRecipe({
      targetThickness: pick('r-thick', S.recipe.targetThickness),
      thicknessTol: pick('r-tol', S.recipe.thicknessTol),
      widthMin: pick('r-wmin', S.recipe.widthMin),
      widthMax: pick('r-wmax', S.recipe.widthMax),
      maxDebrisMm: pick('r-debris', S.recipe.maxDebrisMm),
      maxDefectAreaPct: isFinite(area) ? area : S.recipe.maxDefectAreaPct,
      maxFlatness: pick('r-flat', S.recipe.maxFlatness),
      densityTol: isFinite(dens) ? dens : S.recipe.densityTol
    });
    paint(true);
  }

  function thickClass() {
    const r = S.recipe;
    if (S.thickness > r.targetThickness + r.thicknessTol || S.thickness < r.targetThickness - r.thicknessTol) return 'fail';
    if (Math.abs(S.thickness - r.targetThickness) > r.thicknessTol * 0.72) return 'warn';
    return 'ok';
  }

  function paintHistory() {
    const strip = $('history-strip');
    const boards = S.boards.slice(-24);
    $('hist-count').textContent = 'Last ' + boards.length;
    let html = '';
    for (let i = boards.length - 1; i >= 0; i--) {
      const b = boards[i];
      html += '<article class="hist-card ' + b.status + '" data-board="' + b.id + '">' +
        '<canvas width="140" height="40"></canvas>' +
        '<span class="hid">' + b.id + '</span>' +
        '<span class="hst">' + b.status + '</span></article>';
    }
    if (!boards.length) html = '<div class="muted" style="padding:8px">No boards completed this shift yet</div>';
    strip.innerHTML = html;
    const cards = strip.querySelectorAll('.hist-card');
    cards.forEach(function (card, idx) {
      const b = boards[boards.length - 1 - idx];
      const cv = card.querySelector('canvas');
      if (cv && b) FoamSightCameras.drawThumb(cv, b);
    });
  }

  let histDirty = true;
  let lastBoardSeq = -1;

  function paint(force) {
    const r = S.recipe;
    appEl.setAttribute('data-status', S.status);
    appEl.setAttribute('data-acked', S.alarmAcked ? '1' : '0');
    const tc = thickClass();
    appEl.setAttribute('data-thick-oos', tc === 'fail' ? '1' : '0');

    $('clock').textContent = fmtClock(S.now);
    $('speed-val').textContent = speedDisp();
    $('speed-unit').textContent = speedUnit();
    $('btn-pause').textContent = S.running ? 'Pause' : 'Resume';
    $('btn-pause').classList.toggle('on', !S.running);

    $('thick-val').textContent = toDisp(S.thickness, S.units === 'in' ? 4 : 3);
    $('thick-unit').textContent = unit();
    const dlt = S.thickness - r.targetThickness;
    const sign = dlt >= 0 ? '+' : '−';
    $('thick-delta').textContent = sign + toDisp(Math.abs(dlt), S.units === 'in' ? 4 : 3);
    $('thick-delta').parentElement.className = 'delta ' + tc;
    $('thick-status').textContent = tc === 'fail' ? 'OUT OF SPEC' : tc === 'warn' ? 'NEAR LIMIT' : 'IN SPEC';
    $('thick-status').className = 'pill ' + (tc === 'fail' ? 'fail' : tc === 'warn' ? 'warn' : 'pass');

    const span = r.thicknessTol * 2.4;
    const pct = 50 + ((S.thickness - r.targetThickness) / span) * 100;
    $('gauge-needle').style.left = Math.max(2, Math.min(98, pct)) + '%';
    $('gage-lo').textContent = toDisp(r.targetThickness - r.thicknessTol, 2);
    $('gage-tgt').textContent = toDisp(r.targetThickness, 2);
    $('gage-hi').textContent = toDisp(r.targetThickness + r.thicknessTol, 2);

    $('width-val').textContent = toDisp(S.width, S.units === 'in' ? 3 : 1);
    $('width-unit').textContent = unit();
    $('width-range').textContent = toDisp(r.widthMin, 1) + ' – ' + toDisp(r.widthMax, 1);
    $('edge-val').textContent = (S.edgeOffset >= 0 ? '+' : '') + toDisp(S.edgeOffset, 2);
    $('edge-unit').textContent = unit();
    $('edge-qual').textContent = 'Quality: ' + S.edgeQuality;
    $('flat-val').textContent = toDisp(S.flatness, 3);
    $('flat-unit').textContent = unit();
    $('flat-max').textContent = 'Max ' + toDisp(r.maxFlatness, 2);
    $('dens-val').textContent = S.density.toFixed(1);
    $('cell-val').textContent = 'Cell ' + toDisp(S.cellSize, 2) + ' ' + unit();

    const liveDebris = S.defects.filter(function (d) {
      return !d.exited && (d.type === 'DEBRIS' || d.type === 'EDGE_CHIP');
    }).length;
    $('debris-count').textContent = String(liveDebris + ' live / ' + S.debrisLog.length + ' shift');

    $('alarm-state').textContent = S.status;
    $('alarm-detail').textContent = alarmDetail();
    const rc = $('reason-codes');
    rc.innerHTML = S.reasons.map(function (c) {
      return '<span class="code" data-code="' + c + '">' + c + '</span>';
    }).join('');

    $('stat-insp').textContent = String(S.inspected);
    $('stat-pass').textContent = String(S.passed);
    $('stat-rej').textContent = String(S.rejected);
    const rpct = S.inspected ? (100 * S.rejected / S.inspected) : 0;
    $('stat-rpct').textContent = rpct.toFixed(1);
    $('shift-uptime').textContent = fmtDur(S.now - S.startedAt);

    const counts = Object.keys(S.defectCounts).map(function (k) {
      return { k: k, n: S.defectCounts[k] };
    }).sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
    const ol = $('top-defects');
    if (!counts.length) ol.innerHTML = '<li class="empty">No defects this shift</li>';
    else ol.innerHTML = counts.map(function (c) {
      return '<li><span>' + c.k + '</span><span>' + c.n + '</span></li>';
    }).join('');

    const means = S.boards.map(function (b) { return b.thickness; });
    let xbar = '—', sig = '—';
    if (means.length) {
      let s = 0;
      for (let i = 0; i < means.length; i++) s += means[i];
      const mu = s / means.length;
      let v = 0;
      for (let i = 0; i < means.length; i++) v += (means[i] - mu) * (means[i] - mu);
      xbar = toDisp(mu, 3);
      sig = toDisp(Math.sqrt(v / Math.max(1, means.length - 1 || 1)), 3);
    }
    $('spc-n').textContent = String(means.length);
    $('spc-xbar').textContent = xbar;
    $('spc-sigma').textContent = sig;

    if (S.boardSeq !== lastBoardSeq || force) {
      lastBoardSeq = S.boardSeq;
      paintHistory();
    }

    if (S.status === 'REJECT' && !S.alarmAcked) beep();
  }

  function drawAll() {
    cams.drawTop($('cv-top'), S);
    cams.drawBottom($('cv-bottom'), S);
    cams.drawEdge($('cv-edge'), S);
    FoamSightCameras.drawSpark($('cv-spark'), S);
    FoamSightCameras.drawHist($('cv-hist'), S);
    FoamSightCameras.drawSpc($('cv-spc'), S);
  }

  let acc = 0;
  let lastTs = performance.now();
  let uiAcc = 0;
  function loop(ts) {
    const raw = Math.min(0.08, (ts - lastTs) / 1000);
    lastTs = ts;
    if (S.running) sim.step(raw);
    else {
      S.now = Date.now();
      sim.evaluate();
    }
    drawAll();
    uiAcc += raw;
    if (uiAcc > 0.09 || !S.running) {
      uiAcc = 0;
      paint(false);
    }
    requestAnimationFrame(loop);
  }

  function downloadCsv() {
    const csv = sim.exportCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'foamsight-shift-' + (S.lotId || 'demo') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
    return csv;
  }

  function setUnits(u) {
    S.units = u === 'in' ? 'in' : 'mm';
    $('btn-mm').classList.toggle('on', S.units === 'mm');
    $('btn-in').classList.toggle('on', S.units === 'in');
    fillRecipeForm();
    paint(true);
  }

  $('btn-pause').addEventListener('click', function () {
    S.running = !S.running;
    paint(true);
  });
  $('btn-inject').addEventListener('click', function () {
    sim.injectDefect('DEBRIS', { forceReject: true, camera: 'top', yPct: 0.45, xPct: 0.58 });
    paint(true);
    drawAll();
  });
  $('btn-ack').addEventListener('click', function () {
    sim.ack();
    paint(true);
  });
  $('btn-export').addEventListener('click', function () { downloadCsv(); });
  $('btn-reset').addEventListener('click', function () {
    sim.resetShift();
    paint(true);
    drawAll();
  });
  $('btn-mm').addEventListener('click', function () { setUnits('mm'); });
  $('btn-in').addEventListener('click', function () { setUnits('in'); });

  ['fld-line', 'fld-lot', 'fld-shift', 'fld-recipe-name', 'fld-sku'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      if (id === 'fld-line') S.lineId = this.value;
      if (id === 'fld-lot') S.lotId = this.value;
      if (id === 'fld-shift') S.shift = this.value;
      if (id === 'fld-recipe-name') S.recipe.name = this.value;
      if (id === 'fld-sku') S.recipe.sku = this.value;
    });
  });

  $('recipe-form').addEventListener('input', readRecipeForm);

  window.FoamSight = {
    getState: function () {
      return {
        running: S.running,
        status: S.status,
        reasons: S.reasons.slice(),
        thickness: S.thickness,
        width: S.width,
        flatness: S.flatness,
        density: S.density,
        cellSize: S.cellSize,
        units: S.units,
        recipe: Object.assign({}, S.recipe),
        inspected: S.inspected,
        passed: S.passed,
        rejected: S.rejected,
        alarmAcked: S.alarmAcked,
        defects: sim.visibleDefects().map(function (d) {
          return { id: d.id, type: d.type, camera: d.camera, sizeMm: d.sizeMm, severity: d.severity };
        }),
        boards: S.boards.slice(),
        lotId: S.lotId,
        shift: S.shift,
        lineSpeed: S.lineSpeed
      };
    },
    injectDefect: function (type, opts) { const d = sim.injectDefect(type, opts); paint(true); drawAll(); return d; },
    setRecipe: function (p) { sim.setRecipe(p); fillRecipeForm(); paint(true); },
    setUnits: setUnits,
    pause: function () { S.running = false; paint(true); },
    resume: function () { S.running = true; paint(true); },
    resetShift: function () { sim.resetShift(); paint(true); drawAll(); },
    ackAlarm: function () { sim.ack(); paint(true); },
    exportCsv: downloadCsv,
    exportCsvText: function () { return sim.exportCsv(); },
    forceThickness: function (mm) { sim.setThickness(mm); paint(true); },
    fastForward: function (sec) { sim.fastForward(sec); paint(true); drawAll(); },
    sim: sim
  };

  fillRecipeForm();
  paint(true);
  drawAll();
  requestAnimationFrame(loop);

  if ('serviceWorker' in navigator && params.get('nosw') !== '1') {
    navigator.serviceWorker.register('./sw.js').catch(function () { /* mockup still runs */ });
  }
})();
