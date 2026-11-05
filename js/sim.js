/* FoamSight process simulation — all values are synthetic. */
(function (global) {
  const DEFECT_TYPES = {
    PINHOLE: { id: 'PINHOLE', label: 'Pinhole', code: 'PINHOLE' },
    SCRATCH: { id: 'SCRATCH', label: 'Scratch', code: 'SCRATCH' },
    DENT: { id: 'DENT', label: 'Dent', code: 'DENT' },
    BLOWOUT: { id: 'BLOWOUT', label: 'Cell blowout', code: 'BLOWOUT' },
    DEBRIS: { id: 'DEBRIS', label: 'Debris / FM', code: 'DEBRIS' },
    DISCOLOR: { id: 'DISCOLOR', label: 'Discoloration', code: 'DISCOLOR' },
    EDGE_CHIP: { id: 'EDGE_CHIP', label: 'Edge chip', code: 'EDGE' }
  };

  function parseSeed(s) {
    if (s == null || s === '') return Date.now() % 1e9;
    const str = String(s);
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function defaultRecipe() {
    return {
      name: 'XPS-48-WHT',
      sku: 'FB-048-2440-WHT',
      targetThickness: 12.7,
      thicknessTol: 0.30,
      targetWidth: 1220,
      widthMin: 1214,
      widthMax: 1226,
      maxDebrisMm: 2.0,
      maxDefectAreaPct: 0.45,
      maxFlatness: 0.80,
      targetDensity: 32.0,
      densityTol: 3.0
    };
  }

  function createSim(opts) {
    opts = opts || {};
    const rng = mulberry32(parseSeed(opts.seed != null ? opts.seed : 'live'));
    const recipe = Object.assign(defaultRecipe(), opts.recipe || {});
    const viewMm = 480;

    const state = {
      running: !opts.paused,
      units: 'mm',
      lineId: 'LINE-3',
      extruder: 'XPS-A',
      lotId: 'L26-1105-A18',
      shift: 'B',
      lineSpeed: 12.4,
      recipe: recipe,
      t: 0,
      scrollMm: 0,
      viewMm: viewMm,
      thickness: recipe.targetThickness,
      thicknessWalk: 0,
      width: recipe.targetWidth,
      widthWalk: 0,
      edgeOffset: 0,
      edgeQuality: 'good',
      flatness: 0.12,
      density: recipe.targetDensity,
      cellSize: 0.42,
      encoder: 104220,
      defects: [],
      debrisLog: [],
      spark: [],
      samples: [],
      boards: [],
      boardSeq: 0,
      boardProgress: 0,
      boardLengthMm: 2440,
      inspected: 0,
      passed: 0,
      warned: 0,
      rejected: 0,
      defectCounts: {},
      status: 'PASS',
      reasons: [],
      alarmFresh: false,
      alarmAcked: true,
      lastBoard: null,
      startedAt: Date.now(),
      now: Date.now(),
      scrapRateBias: 0.10,
      fps: 30
    };

    function classifyDefect(d) {
      if (d.type === 'DEBRIS' || d.type === 'EDGE_CHIP') {
        if (d.sizeMm >= state.recipe.maxDebrisMm) return 'reject';
        if (d.sizeMm >= state.recipe.maxDebrisMm * 0.65) return 'warn';
        return 'info';
      }
      if (d.areaPct >= state.recipe.maxDefectAreaPct) return 'reject';
      if (d.areaPct >= state.recipe.maxDefectAreaPct * 0.55) return 'warn';
      return 'info';
    }

    function evaluate() {
      const r = state.recipe;
      const reasons = [];
      let status = 'PASS';
      const hi = r.targetThickness + r.thicknessTol;
      const lo = r.targetThickness - r.thicknessTol;
      const warnBand = r.thicknessTol * 0.72;
      if (state.thickness > hi) { reasons.push('THICK_HI'); status = 'REJECT'; }
      else if (state.thickness < lo) { reasons.push('THICK_LO'); status = 'REJECT'; }
      else if (Math.abs(state.thickness - r.targetThickness) > warnBand) {
        reasons.push('TOLERANCE');
        status = 'WARN';
      }
      if (state.width > r.widthMax) { reasons.push('WIDTH_HI'); status = 'REJECT'; }
      else if (state.width < r.widthMin) { reasons.push('WIDTH_LO'); status = 'REJECT'; }
      if (state.flatness > r.maxFlatness) { reasons.push('WARP'); status = 'REJECT'; }
      else if (state.flatness > r.maxFlatness * 0.75) {
        reasons.push('WARP');
        if (status === 'PASS') status = 'WARN';
      }
      if (Math.abs(state.density - r.targetDensity) > r.densityTol) {
        reasons.push('DENSITY');
        status = 'REJECT';
      }

      let defectArea = 0;
      const visible = visibleDefects();
      for (let i = 0; i < visible.length; i++) {
        const d = visible[i];
        d.severity = classifyDefect(d);
        defectArea += d.areaPct || 0;
        if (d.severity === 'reject') {
          reasons.push(DEFECT_TYPES[d.type].code);
          status = 'REJECT';
        } else if (d.severity === 'warn') {
          reasons.push(DEFECT_TYPES[d.type].code);
          if (status === 'PASS') status = 'WARN';
        }
      }
      if (defectArea > r.maxDefectAreaPct) {
        reasons.push('AREA');
        status = 'REJECT';
      }

      const uniq = [];
      for (let i = 0; i < reasons.length; i++) {
        if (uniq.indexOf(reasons[i]) === -1) uniq.push(reasons[i]);
      }
      const prev = state.status;
      state.reasons = uniq;
      state.status = status;
      if (status !== 'PASS' && status !== prev) {
        state.alarmFresh = true;
        state.alarmAcked = false;
      }
      if (status === 'PASS') state.alarmFresh = false;
    }

    function visibleDefects() {
      const out = [];
      for (let i = 0; i < state.defects.length; i++) {
        const d = state.defects[i];
        if (!d.exited && d.xMm >= state.scrollMm - 20 && d.xMm <= state.scrollMm + state.viewMm + 20) out.push(d);
      }
      return out;
    }

    function spawnDefect(forced) {
      forced = forced || {};
      const keys = Object.keys(DEFECT_TYPES);
      const type = forced.type && DEFECT_TYPES[forced.type] ? forced.type : keys[Math.floor(rng() * keys.length)];
      let camera;
      if (type === 'EDGE_CHIP') camera = 'edge';
      else if (forced.camera) camera = forced.camera;
      else camera = rng() < 0.62 ? 'top' : 'bottom';

      let sizeMm;
      if (forced.sizeMm != null) sizeMm = forced.sizeMm;
      else if (type === 'SCRATCH') sizeMm = 8 + rng() * 28;
      else if (type === 'DEBRIS') sizeMm = 0.6 + rng() * 3.2;
      else if (type === 'PINHOLE') sizeMm = 0.4 + rng() * 1.4;
      else if (type === 'BLOWOUT') sizeMm = 2.5 + rng() * 6;
      else if (type === 'DENT') sizeMm = 3 + rng() * 8;
      else if (type === 'DISCOLOR') sizeMm = 10 + rng() * 25;
      else sizeMm = 2 + rng() * 5;

      const lengthMm = type === 'SCRATCH' ? sizeMm : sizeMm * (0.6 + rng() * 0.8);
      const widthMm = type === 'SCRATCH' ? 0.4 + rng() * 0.8 : sizeMm * (0.5 + rng() * 0.7);
      const areaPct = Math.max(
        (lengthMm * widthMm) / (state.boardLengthMm * state.recipe.targetWidth) * 100,
        type === 'DISCOLOR' ? 0.08 + rng() * 0.25 : 0.012 + rng() * 0.18
      );
      const xMm = forced.xMm != null
        ? forced.xMm
        : state.scrollMm + (forced.xPct != null ? forced.xPct * state.viewMm : 70 + rng() * 320);

      const d = {
        id: 'D' + Math.floor(rng() * 1e9),
        type: type,
        camera: camera,
        xMm: xMm,
        yPct: forced.yPct != null ? forced.yPct : 0.14 + rng() * 0.72,
        sizeMm: sizeMm,
        lengthMm: lengthMm,
        widthMm: widthMm,
        areaPct: areaPct,
        rot: rng() * Math.PI,
        severity: 'info',
        born: state.t,
        exited: false
      };
      d.severity = classifyDefect(d);
      state.defects.push(d);
      if (type === 'DEBRIS' || type === 'EDGE_CHIP') state.debrisLog.push(sizeMm);
      if (state.debrisLog.length > 200) state.debrisLog.shift();
      return d;
    }

    function maybeSpawn(dt) {
      if (rng() < state.scrapRateBias * dt * 0.32) spawnDefect();
      if (rng() < 0.012 * dt) spawnDefect();
    }

    function completeBoard() {
      let mean = state.thickness;
      if (state.samples.length) {
        let s = 0;
        for (let i = 0; i < state.samples.length; i++) s += state.samples[i];
        mean = s / state.samples.length;
      }
      const status = state.status;
      const reasons = state.reasons.slice();
      state.boardSeq += 1;
      state.inspected += 1;
      if (status === 'REJECT') state.rejected += 1;
      else {
        state.passed += 1;
        if (status === 'WARN') state.warned += 1;
      }
      for (let i = 0; i < reasons.length; i++) {
        const c = reasons[i];
        state.defectCounts[c] = (state.defectCounts[c] || 0) + 1;
      }
      const vis = visibleDefects();
      const board = {
        id: 'B-' + String(state.boardSeq).padStart(4, '0'),
        t: state.now,
        thickness: mean,
        width: state.width,
        flatness: state.flatness,
        density: state.density,
        cellSize: state.cellSize,
        status: status,
        reasons: reasons,
        defectCount: vis.length,
        lotId: state.lotId,
        recipe: state.recipe.name,
        sku: state.recipe.sku
      };
      state.boards.push(board);
      if (state.boards.length > 64) state.boards.shift();
      state.lastBoard = board;
      state.samples = [];
      state.boardProgress = 0;
    }

    function step(dt) {
      state.now = Date.now();
      if (!state.running) {
        evaluate();
        return;
      }
      state.t += dt;
      const v = state.lineSpeed * 1000 / 60;
      state.scrollMm += v * dt;
      state.encoder += v * dt * 4.2;
      state.boardProgress += (v * dt) / state.boardLengthMm;

      const drift = 0.09 * Math.sin(state.t / 17.4) + 0.045 * Math.sin(state.t / 6.8 + 0.6);
      state.thicknessWalk += -0.065 * state.thicknessWalk * dt * 4 + 0.028 * gauss(rng) * Math.sqrt(Math.max(dt * 4, 1e-6));
      if (rng() < 0.012 * dt) state.thicknessWalk += (rng() < 0.5 ? -1 : 1) * (0.22 + rng() * 0.28);
      state.thickness = state.recipe.targetThickness + drift + state.thicknessWalk + 0.018 * gauss(rng);

      state.widthWalk += -0.05 * state.widthWalk * dt * 3 + 0.35 * gauss(rng) * Math.sqrt(Math.max(dt * 3, 1e-6));
      state.width = state.recipe.targetWidth + 0.55 * Math.sin(state.t / 22) + state.widthWalk;
      state.edgeOffset = 0.4 * Math.sin(state.t / 9.5) + 0.15 * gauss(rng);
      const edgeAmp = 0.08 + Math.abs(state.edgeOffset) * 0.04 + (rng() < 0.002 ? 0.3 : 0);
      state.edgeQuality = edgeAmp > 0.22 ? 'poor' : edgeAmp > 0.14 ? 'fair' : 'good';
      state.flatness = Math.max(0.02, 0.10 + 0.09 * Math.abs(Math.sin(state.t / 11.2)) + 0.03 * Math.abs(gauss(rng)));
      state.density = state.recipe.targetDensity
        - (state.thickness - state.recipe.targetThickness) * 0.55
        + 0.25 * Math.sin(state.t / 19) + 0.15 * gauss(rng);
      state.cellSize = 0.40 + 0.04 * Math.sin(state.t / 13) + 0.012 * gauss(rng);

      state.spark.push(state.thickness);
      if (state.spark.length > 180) state.spark.shift();
      state.samples.push(state.thickness);

      maybeSpawn(dt);

      for (let i = 0; i < state.defects.length; i++) {
        if (state.defects[i].xMm < state.scrollMm - 80) state.defects[i].exited = true;
      }
      if (state.defects.length > 48) {
        state.defects = state.defects.filter(function (d) { return !d.exited; });
      }

      if (state.boardProgress >= 1) completeBoard();
      evaluate();
    }

    function injectDefect(type, opts) {
      opts = opts || {};
      const t = type && DEFECT_TYPES[type] ? type : 'DEBRIS';
      const size = opts.sizeMm != null ? opts.sizeMm : Math.max(state.recipe.maxDebrisMm * 1.85, 3.8);
      const d = spawnDefect({
        type: t,
        sizeMm: size,
        camera: opts.camera || (t === 'EDGE_CHIP' ? 'edge' : 'top'),
        xMm: opts.xMm != null ? opts.xMm : state.scrollMm + state.viewMm * (opts.xPct != null ? opts.xPct : 0.55),
        yPct: opts.yPct != null ? opts.yPct : 0.42
      });
      if (opts.forceReject !== false) {
        d.sizeMm = Math.max(d.sizeMm, state.recipe.maxDebrisMm * 1.85);
        d.areaPct = Math.max(d.areaPct, state.recipe.maxDefectAreaPct * 1.25);
      }
      d.severity = classifyDefect(d);
      evaluate();
      if (state.status !== 'PASS') {
        state.alarmFresh = true;
        state.alarmAcked = false;
      }
      return d;
    }

    function setRecipe(partial) {
      Object.assign(state.recipe, partial);
      evaluate();
    }

    function ack() {
      state.alarmAcked = true;
      state.alarmFresh = false;
    }

    function resetShift() {
      state.boards = [];
      state.boardSeq = 0;
      state.inspected = 0;
      state.passed = 0;
      state.warned = 0;
      state.rejected = 0;
      state.defectCounts = {};
      state.samples = [];
      state.boardProgress = 0;
      state.lastBoard = null;
      state.startedAt = Date.now();
      state.defects = [];
      state.debrisLog = [];
      state.spark = [];
      state.status = 'PASS';
      state.reasons = [];
      state.alarmFresh = false;
      state.alarmAcked = true;
      state.thicknessWalk = 0;
      state.widthWalk = 0;
      evaluate();
    }

    function exportCsv() {
      const header = [
        'board_id', 'timestamp', 'lot', 'recipe', 'sku', 'thickness_mm', 'width_mm',
        'flatness_mm', 'density_kg_m3', 'cell_mm', 'status', 'reason_codes', 'defect_count'
      ];
      const rows = state.boards.map(function (b) {
        return [
          b.id,
          new Date(b.t).toISOString(),
          b.lotId,
          b.recipe,
          b.sku,
          b.thickness.toFixed(3),
          b.width.toFixed(2),
          b.flatness.toFixed(3),
          b.density.toFixed(2),
          b.cellSize.toFixed(3),
          b.status,
          b.reasons.join('|'),
          b.defectCount
        ].join(',');
      });
      return [header.join(',')].concat(rows).join('\n');
    }

    function fastForward(seconds, dt) {
      dt = dt || 1 / 30;
      const was = state.running;
      state.running = true;
      for (let t = 0; t < seconds; t += dt) step(dt);
      state.running = was;
    }

    function setThickness(mm) {
      state.thickness = mm;
      state.thicknessWalk = mm - state.recipe.targetThickness;
      evaluate();
    }

    evaluate();
    return {
      state: state,
      step: step,
      injectDefect: injectDefect,
      setRecipe: setRecipe,
      ack: ack,
      resetShift: resetShift,
      exportCsv: exportCsv,
      fastForward: fastForward,
      evaluate: evaluate,
      visibleDefects: visibleDefects,
      setThickness: setThickness,
      spawnDefect: spawnDefect
    };
  }

  global.FoamSightSim = {
    createSim: createSim,
    defaultRecipe: defaultRecipe,
    DEFECT_TYPES: DEFECT_TYPES,
    parseSeed: parseSeed
  };
})(typeof window !== 'undefined' ? window : global);
