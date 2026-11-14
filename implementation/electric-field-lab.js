/*
THESIS: A high-school electric-field bench where each slider changes the physics in front of the learner, not a decorative animation.
OWN-WORLD: Inherit the app's paper-white, ink-blue and yellow-cat doodle system; keep the field canvas calm, legible and equation-led.
STORY: Choose a source, predict the field, then compare E, force, potential and a test charge's motion.
FIRST VIEWPORT: Source presets and a large field canvas share the first screen; the primary controls sit directly below the canvas on mobile.
FORM: An operational experiment bench extending the existing learning-course surface; no new brand system or backend dependency.
*/
(function () {
  const MODES = {
    points: { title: '点电荷与叠加', desc: '库仑定律：各点电荷产生的电场矢量逐点叠加。', formula: 'E = kq / r²；F = q₀E', tag: '自由摆放点电荷' },
    uniform: { title: '平行板匀强电场', desc: '忽略边缘效应，板间电场近似匀强；带电粒子做类平抛运动。', formula: 'E = U / d；a = qE / m', tag: '高中常见模型' },
    ring: { title: '带电圆环（轴对称剖面）', desc: '纵轴 y 为圆环轴线，横轴 x 为径向距离；场由环上微元叠加。', formula: 'E轴 = kQy / (y² + R²)^(3/2)', tag: '轴线上精确' },
    shell: { title: '均匀带电球壳', desc: '薄球壳的内部场强为 0；外部等效于电荷集中在球心。', formula: 'r < R：E = 0；r ≥ R：E = kQ / r²', tag: '高斯定理' },
    solid: { title: '均匀带电实心球', desc: '体电荷均匀分布；球内场强随 r 线性增加，球外按平方反比减小。', formula: 'r < R：E = kQr / R³；r ≥ R：E = kQ / r²', tag: '高斯定理' }
  };
  const INITIAL = {
    mode: 'points', activeLab: 'electric', activeSection: 'textbook', charges: [{ x: -1.15, y: 0, q: 1 }, { x: 1.15, y: 0, q: -1 }],
    q: 1, radius: 1.05, field: 1, testQ: 1, specificCharge: 1, vx: 0.45, testX: 0, testY: -1.15,
    showLines: true, showPotential: false, showMotion: false, showForce: true, playing: false, t: 0, zoom: 1
  };
  const state = Object.assign({}, INITIAL, readState());
  if (!['textbook', 'tools', 'courses', 'trials'].includes(state.activeSection)) state.activeSection = 'textbook';
  if (!MODES[state.mode]) state.mode = 'points';
  if (!['electric', 'chemistry', 'analytic'].includes(state.activeLab)) state.activeLab = 'electric';
  if (!Array.isArray(state.charges)) state.charges = INITIAL.charges.map(c => ({ ...c }));
  state.zoom = Math.max(.65, Math.min(1.6, Number(state.zoom) || 1));
  if (!Array.isArray(state.testCharges) || !state.testCharges.length) state.testCharges = [{ x: state.testX, y: state.testY, q: state.testQ }];
  state.activeTestCharge = Math.max(0, Math.min(state.testCharges.length - 1, Number(state.activeTestCharge) || 0));
  Object.assign(state, { testX: Number(state.testCharges[state.activeTestCharge].x) || 0, testY: Number(state.testCharges[state.activeTestCharge].y) || 0, testQ: Number(state.testCharges[state.activeTestCharge].q) || 1 });
  state.editPotential = Boolean(state.editPotential);
  state.editField = Boolean(state.editField);
  if (!Array.isArray(state.profileV) || state.profileV.length !== 81) state.profileV = null;
  if (!Array.isArray(state.profileE) || state.profileE.length !== 81) state.profileE = null;
  state.profileRange = Math.max(.5, Number(state.profileRange) || 1);
  state.profileERange = Math.max(.5, Number(state.profileERange) || 1);
  state.playing = false;
  // Preview question: which learner entry point is clearest — field, E/V relationships, or motion?
  // Layout selection is URL-only and appears only in local doodle previews.
  const prototypeParams = new URLSearchParams(location.search);
  const prototypeEnabled = prototypeParams.has('doodlePreview');
  const variants = [
    {key:'field', label:'A · 场图优先'},
    {key:'relation', label:'B · 电势/场强关系优先'},
    {key:'motion', label:'C · 运动与时间优先'}
  ];
  let variant = variants.some(item => item.key === prototypeParams.get('variant')) ? prototypeParams.get('variant') : 'field';
  document.head.insertAdjacentHTML('beforeend', `<style>
  .ef-hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.7fr);gap:18px;align-items:center;background:#fff7db;border:1px solid #e8d18c;position:relative;overflow:hidden}
  .ef-hero h2,.ef-home h2{margin:8px 0}.ef-equation{padding:18px 20px;border:1px solid #d5dfed;border-radius:18px;background:#f6f9ff;color:#18345d;font-size:18px;font-weight:750;text-align:center}
  .ef-bench{padding:16px}.ef-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px}.ef-toolbar p{margin:5px 0}.ef-modes{display:flex;gap:7px;overflow:auto;padding:8px 0}.ef-modes button{flex:0 0 auto;min-height:42px;color:#29415e;border-color:#cbd8ea}.ef-modes button.active{background:#3369e8;color:white;border-color:#3369e8;box-shadow:0 3px 0 #a7c2fa}
  .ef-legend{display:flex;gap:14px;flex-wrap:wrap;padding:4px 0 10px;font-size:12px;color:#58687e}.ef-legend span{display:inline-flex;align-items:center;gap:5px}.ef-legend i{font-style:normal;display:inline-grid;place-items:center;width:21px;height:21px;border-radius:50%;font-weight:800}.ef-plus{background:#d94949;color:#fff}.ef-minus{background:#386bd5;color:#fff}.ef-e{color:#167253;background:#e6f5ef}.ef-f{color:#ca641d;background:#fff0e4}
  .ef-canvas-wrap{position:relative;border:1px solid #ced9e8;border-radius:17px;overflow:hidden;background:#fbfdff;min-height:clamp(500px,68vh,760px)}.ef-canvas{display:block;width:100%;height:clamp(500px,68vh,760px);touch-action:none;cursor:grab}.ef-canvas.dragging{cursor:grabbing}.ef-canvas-note{position:absolute;left:10px;bottom:8px;padding:4px 8px;border-radius:9px;background:#ffffffd9;color:#66768c;font-size:11px;pointer-events:none}.ef-readout{margin:8px 0 2px;color:#1d4e86;font-size:13px;font-weight:700;min-height:20px}
  .ef-lines-toggle{position:absolute;top:10px;right:10px;z-index:2;min-height:34px;padding:6px 11px;border:1px solid #9eb7df;border-radius:999px;background:#fff;color:#234b86;font-size:12px;font-weight:750;box-shadow:0 2px 8px #24466a20;cursor:pointer}.ef-lines-toggle[aria-pressed="true"]{background:#eaf1ff;border-color:#6d91d7}
  .ef-controls{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}.ef-controls>section{padding:13px;border:1px solid #e1e8f1;border-radius:15px;background:#fbfcff}.ef-controls>section>b{display:block;margin-bottom:9px;color:#203753}.ef-controls label{display:grid;grid-template-columns:1fr auto;gap:7px;align-items:center;margin:10px 0;color:#465a73;font-size:13px}.ef-controls label input[type=range]{grid-column:1/-1;padding:0;accent-color:#3369e8}.ef-controls label select{width:auto;min-width:140px}.ef-controls output{font-variant-numeric:tabular-nums;color:#2f5eaa}.ef-control-row{display:flex;gap:6px;flex-wrap:wrap;margin:7px 0}.ef-control-row button{padding:7px 10px;font-size:12px}.ef-source-row{display:grid;grid-template-columns:25px minmax(0,1fr) 30px;gap:8px;align-items:center;padding:7px 0;border-top:1px solid #e8edf4}.ef-source-row label{margin:0}.ef-source-row label input[type=range]{margin-top:1px}.ef-source-row>button{min-width:30px;padding:3px;color:#9b4c4c}.ef-charge-dot{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;color:white;font-weight:800}.ef-charge-dot.positive{background:#d94949}.ef-charge-dot.negative{background:#386bd5}.ef-toggles{display:grid;grid-template-columns:1fr 1fr;gap:4px 8px}.ef-controls .ef-toggles label{display:flex;justify-content:flex-start;gap:6px;margin:4px 0}.ef-controls input[type=checkbox]{width:17px;height:17px;accent-color:#3369e8}.ef-insight{position:relative;display:flex;gap:12px;align-items:flex-start;margin-top:12px;padding:13px 14px;border:1px solid #edd98f;border-radius:15px;background:#fff9e4;color:#51441e;overflow:hidden}.ef-insight p{margin:5px 0;line-height:1.55}.ef-insight .muted{color:#746c56}.ef-cat{font-size:27px}.ef-scope{border-left:4px solid #3369e8}.ef-scope h3{margin:2px 0 7px}.ef-scope p{line-height:1.65;margin:7px 0}.ef-home{display:flex;align-items:center;justify-content:space-between;gap:12px;border-style:dashed}.ef-home p{margin:5px 0}.ef-problem-intake{margin-top:12px;padding:11px;border:1px dashed #b9cbed;border-radius:14px;background:#f7faff}.ef-problem-intake label{display:block;font-weight:700;color:#29415e}.ef-problem-intake textarea{display:block;box-sizing:border-box;width:100%;min-height:72px;margin-top:6px}.ef-problem-intake .row{display:flex;gap:8px;align-items:center;margin-top:8px}.ef-problem-result{margin:8px 0 0;color:#48627e;font-size:13px}.ef-problem-result.warn{color:#8a5b14}.ef-problem-intake details{margin-top:7px;color:#536985;font-size:12px}
  @media(max-width:720px){.ef-hero{grid-template-columns:1fr}.ef-equation{font-size:15px}.ef-controls{grid-template-columns:1fr}.ef-toolbar{align-items:flex-start}.ef-home{align-items:flex-start;flex-direction:column}.ef-home button{width:100%}.ef-canvas-wrap{min-height:clamp(460px,62vh,680px)}.ef-canvas{height:clamp(460px,62vh,680px)}.ef-modes button{font-size:12px;padding:8px 10px}}
  @media(prefers-reduced-motion:reduce){.ef-bench *{scroll-behavior:auto!important;transition:none!important}}
  </style>`);
  document.head.insertAdjacentHTML('beforeend', '<style>.ef-source-row{display:grid;grid-template-columns:25px minmax(0,1fr) 30px;gap:8px;align-items:center;padding:7px 0;border-top:1px solid #e8edf4}.ef-source-row label{margin:0}.ef-source-row label input[type=range]{margin-top:1px}.ef-source-row>button{min-width:30px;padding:3px;color:#9b4c4c}.ef-charge-dot{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;color:white;font-weight:800}.ef-charge-dot.positive{background:#d94949}.ef-charge-dot.negative{background:#386bd5}</style>');
  document.head.insertAdjacentHTML('beforeend', '<style>.ef-canvas-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.ef-motion-actions{display:flex;gap:8px;flex-wrap:wrap;margin:9px 0 7px}.ef-motion-actions button{min-height:42px;padding:8px 13px;font-size:13px;font-weight:750}.ef-motion-actions [data-ef-play]{background:#3369e8;color:#fff;border-color:#2857c5;box-shadow:0 3px 0 #aac5ff}.ef-motion-actions [data-ef-layout]{min-height:30px;padding:4px 8px;font-size:11px;font-weight:650}.ef-motion-actions [data-ef-clear-trace]{margin-left:auto}.ef-canvas-note{font-size:12px}</style>');
  document.head.insertAdjacentHTML('beforeend', '<style>.ef-scope{border:1px solid #d5dfed;background:#f7f9fd}</style>');
  document.head.insertAdjacentHTML('beforeend', `<style>
  .ef-profile-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:10px 0}
  .ef-profile{min-width:0;border:1px solid #d7e1ef;border-radius:13px;background:#fff;padding:8px 9px}
  .ef-profile b{font-size:12px;color:#27415f}.ef-profile small{display:block;color:#687990;font-size:10px;margin-top:2px}
  .ef-profile canvas{display:block;width:100%;height:104px;touch-action:none;cursor:crosshair}.ef-profile[data-profile="time"] canvas{height:104px}
  .ef-variant-bar{display:none!important}
  .ef-variant-bar button{border:0;border-radius:50%;width:30px;height:30px;background:#fff;color:#17385d;font-size:17px;cursor:pointer}.ef-variant-bar span{min-width:165px;text-align:center}.ef-variant-bar em{font-style:normal;color:#f5ce5a;font-size:10px;margin-right:5px}
  @media(max-width:760px){.ef-variant-bar{bottom:calc(82px + env(safe-area-inset-bottom));max-width:calc(100vw - 16px);gap:5px;padding:5px 7px}.ef-variant-bar span{min-width:0;white-space:nowrap;font-size:11px}.ef-variant-bar button{flex:0 0 30px}}
  .ef-bench.ef-variant-relation{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(300px,.8fr);grid-template-areas:"toolbar toolbar" "modes modes" "legend legend" "actions actions" "scene profiles" "readout readout" "controls controls" "insight insight";align-items:start}
  .ef-variant-relation .ef-toolbar{grid-area:toolbar}.ef-variant-relation .ef-modes{grid-area:modes}.ef-variant-relation .ef-legend{grid-area:legend}.ef-variant-relation .ef-motion-actions{grid-area:actions}.ef-variant-relation .ef-canvas-wrap{grid-area:scene}.ef-variant-relation .ef-profile-grid{grid-area:profiles;grid-template-columns:1fr}.ef-variant-relation .ef-readout{grid-area:readout}.ef-variant-relation .ef-controls{grid-area:controls}.ef-variant-relation .ef-insight{grid-area:insight}
  .ef-bench.ef-variant-motion{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(280px,.9fr);grid-template-areas:"toolbar toolbar" "modes modes" "legend legend" "actions actions" "scene time" "readout readout" "controls controls" "insight insight";align-items:start}
  .ef-variant-motion .ef-toolbar{grid-area:toolbar}.ef-variant-motion .ef-modes{grid-area:modes}.ef-variant-motion .ef-legend{grid-area:legend}.ef-variant-motion .ef-motion-actions{grid-area:actions}.ef-variant-motion .ef-canvas-wrap{grid-area:scene}.ef-variant-motion .ef-profile-grid{grid-area:time;grid-template-columns:1fr}.ef-variant-motion .ef-profile:not([data-profile="time"]){display:none}.ef-variant-motion .ef-profile[data-profile="time"] canvas{height:300px}.ef-variant-motion .ef-readout{grid-area:readout}.ef-variant-motion .ef-controls{grid-area:controls}.ef-variant-motion .ef-insight{grid-area:insight}
  @media(max-width:820px){.ef-profile-grid{grid-template-columns:1fr}.ef-variant-relation,.ef-variant-motion{grid-template-columns:1fr!important;grid-template-areas:"toolbar" "modes" "legend" "actions" "scene" "profiles" "time" "readout" "controls" "insight"!important}.ef-variant-motion .ef-profile[data-profile="time"] canvas{height:150px}}
  </style>`);
  document.head.insertAdjacentHTML('beforeend', `<style>
  .lab-switcher{padding:14px 16px;background:#fffdf8}.lab-switcher-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.lab-switcher-head h2{margin:6px 0}.lab-switcher-head p{margin:4px 0}.lab-mark{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:#fff2c8;color:#a37312;font-size:22px}
  .lab-toolbar{display:flex;gap:7px;overflow-x:auto;padding:10px 1px 2px;scrollbar-width:thin}.lab-toolbar button{display:flex;align-items:center;justify-content:center;gap:7px;min-height:44px;flex:1 0 auto;border-radius:13px;border-color:#d8e1ed;color:#29415e;white-space:nowrap}.lab-toolbar button.active{background:#3369e8;color:#fff;border-color:#3369e8;box-shadow:0 3px 0 #b2c8f5}.lab-toolbar button:focus-visible,.tabs button:focus-visible{outline:3px solid #f0bd36;outline-offset:2px}.lab-content{min-width:0}.tabs.has-lab-tab{grid-template-columns:repeat(6,minmax(0,1fr))}
  @media(max-width:560px){.tabs.has-lab-tab{display:flex;overflow-x:auto;justify-content:flex-start}.tabs.has-lab-tab button{flex:0 0 62px}.lab-switcher{padding:12px}.lab-toolbar button{padding:8px 11px;font-size:13px}}
  </style>`);
  let stopAnimation = null, disposeElectric = null, manualTrace = [], manualTraceIndex = 0, traceStartedAt = 0, scrubMotion = false, persistEnabled = true, sharedMountElectricLab = null;
  function readState() { try { return JSON.parse(localStorage.getItem('educompanion:electric-lab:v1') || '{}'); } catch (_) { return {}; } }
  function persist() { if (!persistEnabled) return; try { localStorage.setItem('educompanion:electric-lab:v1', JSON.stringify(state)); } catch (_) {} }
  async function compressGraphPhoto(file) {
    const imageUrl=URL.createObjectURL(file);
    try {
      const image=new Image();
      image.src=imageUrl;
      await image.decode();
      const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/jpeg',.84);
    } finally { URL.revokeObjectURL(imageUrl); }
  }
  function canvasScale(width, height) { return Math.min((width - 56) / 5.4, (height - 56) / 4) * state.zoom; }
  function esc(text) { return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function draw(canvas, fast = false) {
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = rect.width, h = rect.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = canvasScale(w, h), ox = w / 2, oy = h / 2;
    const px = x => ox + x * s, py = y => oy - y * s, mode = state.mode;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#fbfdff'; ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1; ctx.strokeStyle = '#e5ecf5';
    for (let x = Math.ceil(-ox / s); x <= (w - ox) / s; x++) { ctx.beginPath(); ctx.moveTo(px(x), 0); ctx.lineTo(px(x), h); ctx.stroke(); }
    for (let y = Math.ceil((oy - h) / s); y <= oy / s; y++) { ctx.beginPath(); ctx.moveTo(0, py(y)); ctx.lineTo(w, py(y)); ctx.stroke(); }
    ctx.strokeStyle = '#7488a4'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(20, oy); ctx.lineTo(w - 18, oy); ctx.moveTo(ox, h - 18); ctx.lineTo(ox, 18); ctx.stroke();
    ctx.fillStyle = '#60738d'; ctx.font = '12px system-ui'; ctx.fillText('x', w - 19, oy - 8); ctx.fillText('y', ox + 8, 20);
    function field(x, y) {
      if (mode === 'uniform') return { x: state.field, y: 0 };
      if (mode === 'shell' || mode === 'solid') {
        const r = Math.hypot(x, y) || 1e-4, R = state.radius;
        const e = mode === 'shell' ? (r < R ? 0 : state.q / (r * r)) : (r < R ? state.q * r / (R * R * R) : state.q / (r * r));
        return { x: e * x / r, y: e * y / r };
      }
      if (mode === 'ring') {
        // Axisymmetric 3D ring in an (radial distance, axial distance) cross-section.
        let ex = 0, ey = 0, R = state.radius;
        for (let i = 0; i < 48; i++) { let a = i * Math.PI * 2 / 48, dx = x - R * Math.cos(a), dy = y; let d2 = dx * dx + dy * dy + (R * Math.sin(a)) ** 2 + .008; let d3 = d2 * Math.sqrt(d2); ex += dx / d3; ey += dy / d3; }
        return { x: ex * state.q / 48, y: ey * state.q / 48 };
      }
      let ex = 0, ey = 0;
      for (const c of state.charges) { let dx = x - c.x, dy = y - c.y, d2 = dx * dx + dy * dy + .025; let d3 = d2 * Math.sqrt(d2); ex += c.q * dx / d3; ey += c.q * dy / d3; }
      return { x: ex, y: ey };
    }
    const physicalField = field;
    const profileSample = x => { const values = state.profileV; if (!values) return null; const position = Math.max(0, Math.min(80, (x + 2.6) / .065)), index = Math.floor(position), next = Math.min(80, index + 1), fraction = position - index; return values[index] * (1 - fraction) + values[next] * fraction; };
    const profileDerivative = x => { const left = profileSample(Math.max(-2.6, x - .0325)), right = profileSample(Math.min(2.6, x + .0325)); return left === null || right === null ? null : -(right - left) / Math.max(.001, Math.min(2.6, x + .0325) - Math.max(-2.6, x - .0325)); };
    const fieldSample = x => { const values = state.profileE; if (!values) return null; const position = Math.max(0, Math.min(80, (x + 2.6) / .065)), index = Math.floor(position), next = Math.min(80, index + 1), fraction = position - index; return values[index] * (1 - fraction) + values[next] * fraction; };
    if (state.profileV || state.profileE) field = (x, y) => { const base = physicalField(x, y), derived = state.editField ? fieldSample(x) : profileDerivative(x); if (derived !== null) base.x = derived; return base; };
    function potential(x, y) {
      if (state.profileV) return profileSample(x);
      if (mode === 'uniform') return -state.field * x;
      if (mode === 'shell' || mode === 'solid') { let r = Math.hypot(x, y), R = state.radius, q = state.q; if (mode === 'shell') return q * (r < R ? 1 / R : 1 / Math.max(r, .03)); return q * (r < R ? (3 * R * R - r * r) / (2 * R ** 3) : 1 / Math.max(r, .03)); }
      if (mode === 'ring') { let sum = 0; for (let i = 0; i < 64; i++) { let a = i * Math.PI * 2 / 64, dx = x - state.radius * Math.cos(a), dy = y, dz = state.radius * Math.sin(a); sum += 1 / Math.sqrt(dx * dx + dy * dy + dz * dz + .025); } return state.q * sum / 64; }
      return state.charges.reduce((sum, c) => sum + c.q / Math.sqrt((x - c.x) ** 2 + (y - c.y) ** 2 + .025), 0);
    }
    if (state.showPotential && !fast) {
      const levels = [-2, -1.2, -.7, -.35, .35, .7, 1.2, 2];
      ctx.lineWidth = 1; ctx.strokeStyle = '#d88941aa';
      const nx = Math.ceil(w / 15), ny = Math.ceil(h / 15), values = Array.from({ length: nx + 1 }, (_, i) => Array.from({ length: ny + 1 }, (_, j) => potential((i * 15 - ox) / s, (oy - j * 15) / s)));
      for (const level of levels) for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const x = i * 15, y = j * 15, v = [values[i][j], values[i + 1][j], values[i + 1][j + 1], values[i][j + 1]], pts = [];
        const edges = [[0, 1, x, y, x + 15, y], [1, 2, x + 15, y, x + 15, y + 15], [2, 3, x + 15, y + 15, x, y + 15], [3, 0, x, y + 15, x, y]];
        for (const [a, b, x1, y1, x2, y2] of edges) if ((v[a] < level) !== (v[b] < level)) { const t = (level - v[a]) / (v[b] - v[a]); pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]); }
        if (pts.length >= 2) { ctx.beginPath(); ctx.moveTo(...pts[0]); ctx.lineTo(...pts[1]); ctx.stroke(); }
      }
    }
    if (mode === 'uniform') {
      ctx.fillStyle = '#e9eef7'; ctx.fillRect(px(-2.15), py(1.65), 8, 3.3 * s); ctx.fillRect(px(2.15) - 8, py(1.65), 8, 3.3 * s);
      ctx.fillStyle = '#3d65a8'; ctx.font = '13px system-ui'; ctx.fillText('+', px(-2.15) - 16, py(0)); ctx.fillText('−', px(2.15) + 7, py(0));
      if (state.showLines) for (let y = -1.3; y <= 1.31; y += .55) arrow(ctx, px(-1.9), py(y), px(1.9), py(y), '#3b74e8', 1.7);
    }
    if (mode === 'shell' || mode === 'solid') {
      ctx.beginPath(); ctx.arc(ox, oy, state.radius * s, 0, Math.PI * 2); ctx.fillStyle = mode === 'solid' ? '#ffe49b55' : '#fff1c555'; ctx.fill(); ctx.strokeStyle = '#d69c30'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#7e5c1a'; ctx.font = '12px system-ui'; ctx.fillText(mode === 'shell' ? '薄球壳' : '均匀体电荷', px(-state.radius) + 6, py(state.radius) + 17);
    }
    if (mode === 'ring') {
      ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#c5ccd8'; ctx.beginPath(); ctx.moveTo(ox, 22); ctx.lineTo(ox, h - 22); ctx.stroke(); ctx.restore();
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(px(side * state.radius), oy, 8, 0, Math.PI * 2); ctx.fillStyle = state.q >= 0 ? '#d94949' : '#386bd5'; ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(state.q >= 0 ? '+' : '−', px(side * state.radius), oy); }
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#765417'; ctx.font = '12px system-ui'; ctx.fillText('圆环在轴对称剖面中的两个截点', 12, h - 12);
    }
    if (state.showLines && mode !== 'uniform' && mode !== 'shell' && mode !== 'solid') {
      let sources = mode === 'points' ? state.charges : mode === 'ring' ? [{ x: -state.radius, y: 0, q: state.q / 2 }, { x: state.radius, y: 0, q: state.q / 2 }] : [];
      const positiveSources = sources.filter(source => source.q > 0), lineSources = positiveSources.length ? positiveSources : sources.filter(source => source.q < 0);
      for (const source of lineSources) for (let i = 0; i < (fast ? 5 : 8); i++) {
        const polarity = source.q > 0 ? 1 : -1;
        let a = i * Math.PI * 2 / 8, x = source.x + .07 * Math.cos(a), y = source.y + .07 * Math.sin(a), arrowPoint = null; ctx.beginPath(); ctx.moveTo(px(x), py(y));
        for (let step = 0; step < (fast ? 90 : 250); step++) { let f = field(x, y), mag = Math.hypot(f.x, f.y); if (mag < 1e-6) break; let ds = .035 / Math.max(1, mag * .13); x += polarity * f.x / mag * ds; y += polarity * f.y / mag * ds; if (Math.abs(x) > 3 || Math.abs(y) > 2.1) break; if (!arrowPoint && step > 40) arrowPoint = [x, y, polarity * f.x / mag, polarity * f.y / mag]; if (mode === 'points' && state.charges.some(c => c.q * polarity < 0 && Math.hypot(c.x - x, c.y - y) < .09)) break; ctx.lineTo(px(x), py(y)); }
        ctx.strokeStyle = '#3d74dd9c'; ctx.lineWidth = 1.35; ctx.stroke();
        if (arrowPoint) { const [ax, ay, dx, dy] = arrowPoint; arrow(ctx, px(ax), py(ay), px(ax) + dx * 12, py(ay) - dy * 12, '#3d74dd', 1.4); }
      }
    }
    if (state.showLines && (mode === 'shell' || mode === 'solid')) {
      for (let i = 0; i < 20; i++) { const a = i * Math.PI * 2 / 20, direction = state.q >= 0 ? 1 : -1, start = mode === 'solid' ? .04 : state.radius, end = Math.max(3.1, start + .1), low = direction > 0 ? start : end, high = direction > 0 ? end : start; ctx.beginPath(); ctx.moveTo(px(Math.cos(a) * low), py(Math.sin(a) * low)); for (let r = low + .045; r <= high; r += .045) ctx.lineTo(px(Math.cos(a) * r), py(Math.sin(a) * r)); ctx.strokeStyle = state.q > 0 ? '#3d74dd9c' : '#df68689c'; ctx.lineWidth = 1.4; ctx.stroke(); const mid = (low + high) / 2, d = direction * .12; arrow(ctx, px(Math.cos(a) * mid), py(Math.sin(a) * mid), px(Math.cos(a) * mid + Math.cos(a) * d), py(Math.sin(a) * mid + Math.sin(a) * d), state.q > 0 ? '#3d74dd' : '#df6868', 1.4); }
      if (mode === 'shell') { ctx.beginPath(); ctx.arc(ox, oy, state.radius * s * .72, 0, 2 * Math.PI); ctx.strokeStyle = '#c7d1df'; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]); }
    }
    if (mode === 'points') for (const c of state.charges) { ctx.beginPath(); ctx.arc(px(c.x), py(c.y), 17, 0, Math.PI * 2); ctx.fillStyle = c.q > 0 ? '#d94949' : '#386bd5'; ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 17px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(c.q > 0 ? '+' : '−', px(c.x), py(c.y)); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; }
    if (mode !== 'points') { ctx.beginPath(); ctx.arc(ox, oy, 5, 0, Math.PI * 2); ctx.fillStyle = '#a1650b'; ctx.fill(); ctx.fillStyle = '#765417'; ctx.font = '12px system-ui'; ctx.fillText(`Q=${state.q > 0 ? '+' : ''}${state.q}`, ox + 8, oy - 8); }
    state.testCharges.forEach((probe, index) => { if (index === state.activeTestCharge) return; const x = px(probe.x), y = py(probe.y), f = field(probe.x, probe.y), mag = Math.hypot(f.x, f.y); ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fillStyle = probe.q > 0 ? '#f4b63e' : '#c18ae8'; ctx.strokeStyle = '#614a1e'; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke(); ctx.fillStyle = '#3d3150'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(probe.q > 0 ? '+' : '−', x, y); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; if (state.showForce && mag > 1e-6) arrow(ctx, x, y, x + f.x / mag * 38 * Math.sign(probe.q), y - f.y / mag * 38 * Math.sign(probe.q), probe.q > 0 ? '#e46d28' : '#914dbb', 2); });
    const px0 = state.testX, py0 = state.testY;
    const f = field(px0, py0), mag = Math.hypot(f.x, f.y), dir = state.testQ >= 0 ? 1 : -1;
    if (state.showForce && mag > 1e-6) arrow(ctx, px(px0), py(py0), px(px0) + f.x / mag * 48 * dir, py(py0) - f.y / mag * 48 * dir, state.testQ > 0 ? '#e46d28' : '#914dbb', 3);
    const trajectory = [];
    {
      let x = state.testX, y = state.testY, vx = state.vx, vy = 0, dt = .015, scale = .11 * state.specificCharge;
      if (state.showMotion) { ctx.beginPath(); ctx.moveTo(px(x), py(y)); }
      trajectory.push({ x, y, vx, vy });
      for (let i = 0; i < (fast ? 160 : 500); i++) { let f0 = field(x, y); vx += dir * f0.x * scale * dt; vy += dir * f0.y * scale * dt; x += vx * dt; y += vy * dt; trajectory.push({ x, y, vx, vy }); if (state.showMotion) ctx.lineTo(px(x), py(y)); if (Math.abs(x) > 3.2 || Math.abs(y) > 1.9) break; }
      if (state.showMotion) { ctx.strokeStyle = '#da7b37'; ctx.lineWidth = 2.5; ctx.stroke(); }
    }
    if (manualTrace.length > 1) {
      ctx.beginPath(); manualTrace.forEach((point, index) => { if (index === 0) ctx.moveTo(px(point.x), py(point.y)); else ctx.lineTo(px(point.x), py(point.y)); });
      ctx.strokeStyle = '#8b50bd'; ctx.lineWidth = 3; ctx.setLineDash([7, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    canvas.__trajectory = trajectory;
    if (!state.playing) { ctx.beginPath(); ctx.arc(px(px0), py(py0), 9, 0, Math.PI * 2); ctx.fillStyle = state.testQ > 0 ? '#f4b63e' : '#c18ae8'; ctx.strokeStyle = '#614a1e'; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke(); ctx.fillStyle = '#3d3150'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(state.testQ > 0 ? '+' : '−', px(px0), py(py0)); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; }
    if (mag > 1e-6) arrow(ctx, px(px0), py(py0), px(px0) + f.x / mag * 38, py(py0) - f.y / mag * 38, '#22765c', 2.2);
    ctx.fillStyle = '#426b5c'; ctx.font = '11px system-ui'; ctx.fillText('E', px(px0) + 10, py(py0) - 15); if (state.showForce) ctx.fillText('F', px(px0) + f.x / mag * 48 * dir + 4, py(py0) - f.y / mag * 48 * dir);
    const force = Math.abs(state.testQ) * mag;
    const fieldLabel = mode === 'uniform' ? `匀强场 E = ${Math.abs(state.field).toFixed(2)} 相对单位（方向 ${state.field >= 0 ? '→' : '←'}）` : `相对场强指标 |E| = ${mag.toFixed(2)}`;
    const v = potential(px0, py0);
    canvas.dataset.readout = `${fieldLabel}　·　相对电势指标 V = ${v.toFixed(2)}　·　相对受力指标 |q₀E| = ${force.toFixed(2)}　·　${state.testQ > 0 ? '正' : '负'}试探电荷（Q、长度按相对单位显示）`;
    canvas.__profileData = Array.from({length:81}, (_, index) => { const x = -2.6 + index * .065, f = field(x, state.testY); return {x, potential:potential(x, state.testY), field:f.x}; });
  }
  function arrow(ctx, x1, y1, x2, y2, color, width) { const angle = Math.atan2(y2 - y1, x2 - x1); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - 8 * Math.cos(angle - .48), y2 - 8 * Math.sin(angle - .48)); ctx.lineTo(x2 - 8 * Math.cos(angle + .48), y2 - 8 * Math.sin(angle + .48)); ctx.closePath(); ctx.fill(); }
  function activate(api) {
    const { state: appState, render, renderHome } = api;
    let activeRender = render;
    sharedMountElectricLab = mountElectricLab;
    if (prototypeEnabled && prototypeParams.has('variant')) appState.tab = 'labs';
    window.__eduSetLab = key => { if (['electric', 'chemistry', 'analytic'].includes(key)) { state.activeLab = key; state.activeSection = 'tools'; } persist(); };
    window.__openElectricProblem = (question,imageRef) => { state.pendingElectricQuestion=String(question||'').trim();state.pendingElectricImage=imageRef&&imageRef.hash?{hash:imageRef.hash,mimeType:imageRef.mimeType||'image/jpeg'}:null;state.activeLab='electric';state.activeSection='tools';persist();appState.tab='labs';api.render(); };
    const tabs = document.querySelector('.tabs');
    tabs?.classList.add('has-lab-tab');
    tabs?.querySelectorAll('[data-tab="electric"],[data-tab="chem"],[data-tab="analytic"]').forEach(button => button.remove());
    if (tabs && !tabs.querySelector('[data-tab="labs"]')) tabs.insertAdjacentHTML('beforeend', '<button data-tab="labs">🧰<span>工具箱</span></button>');
    let variantBar = null;
    function selectVariant(step) {
      const index = variants.findIndex(item => item.key === variant);
      variant = variants[(index + step + variants.length) % variants.length].key;
      const params = new URLSearchParams(location.search); params.set('variant', variant);
      history.replaceState(null, '', location.pathname + '?' + params.toString() + location.hash);
      api.render();
    }
    function showVariantBar() {
      if (!prototypeEnabled) return;
      if (!variantBar) {
        variantBar = document.createElement('div'); variantBar.className = 'ef-variant-bar';
        variantBar.setAttribute('aria-label', '电场实验台布局原型切换');
        document.body.appendChild(variantBar);
        variantBar.addEventListener('click', event => {
          if (event.target.closest('[data-variant-prev]')) selectVariant(-1);
          if (event.target.closest('[data-variant-next]')) selectVariant(1);
        });
        window.addEventListener('keydown', event => {
          if (!prototypeEnabled || !variantBar?.isConnected || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
          if (event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
          event.preventDefault(); selectVariant(event.key === 'ArrowRight' ? 1 : -1);
        });
      }
      const index = variants.findIndex(item => item.key === variant);
      variantBar.innerHTML = `<button type="button" data-variant-prev aria-label="上一个布局">‹</button><span><em>原型布局</em>${variants[index].label}</span><button type="button" data-variant-next aria-label="下一个布局">›</button>`;
    }
    function electricPage(view) {
      if (disposeElectric) { disposeElectric(); disposeElectric = null; }
      if (stopAnimation) { stopAnimation(); stopAnimation = null; }
      state.playing = false;
      const compileIntoBench = async (question,imageData='') => {
        const resultNode=view.querySelector('[data-ef-problem-result]');
        const normalized=String(question||'').trim();
        if(!normalized){if(resultNode)resultNode.textContent='请先粘贴或输入电场题干。';return;}
        if(resultNode){resultNode.className='ef-problem-result';resultNode.textContent='正在把题目转换为可核对的实验参数…';}
        try {
          const token=window.__eduAuthSessionToken||'';
          const response=await fetch('/v1/electric-field/compile',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify({question:normalized,...(imageData?{imageData}:{})})});
          const payload=await response.json();
          if(!response.ok)throw new Error(payload.message||payload.error||'题目编译未完成');
          if(!payload.bench)throw new Error(payload.notice||'这道题还不能生成实验参数');
          Object.assign(state,payload.bench,{compiledElectricProblem:{question:normalized,status:payload.status,notice:payload.notice,spec:payload.spec,confirmation:payload.confirmation||[],graphAnalysis:payload.graphAnalysis||null,motionPrinciple:payload.motionPrinciple||null}});
          if(!Array.isArray(state.testCharges)||!state.testCharges.length)state.testCharges=[{x:state.testX||0,y:state.testY||-1.15,q:state.testQ||1}];
          state.activeTestCharge=0;state.testCharges[0]={x:state.testX||0,y:state.testY||-1.15,q:state.testQ||1};
          persist();activeRender();
        }catch(error){if(resultNode){resultNode.className='ef-problem-result warn';resultNode.textContent='题目暂未载入：'+error.message+'。原实验台没有改变，可继续手动操作。';}}
      };
      const meta = MODES[state.mode] || MODES.points;
      view.className = 'work';
      view.innerHTML = `<section class="panel ef-hero"><div><span class="pill">高中物理 · 电场实验台</span><h2>把电场画出来，再用受力和运动验证</h2><p class="muted">切换电荷模型，观察场线、电势、试探电荷受力和轨迹如何联动。</p></div><div class="ef-equation">${esc(meta.formula)}</div></section><section class="panel ef-bench"><div class="ef-toolbar"><div><b>${esc(meta.title)}</b><p class="muted">${esc(meta.desc)}</p></div><span class="pill good">${esc(meta.tag)}</span></div><div class="ef-modes">${Object.entries(MODES).map(([key, value]) => `<button data-ef-mode="${key}" class="${state.mode === key ? 'active' : ''}">${esc(value.title)}</button>`).join('')}</div><div class="ef-legend"><span><i class="ef-plus">+</i>正电荷</span><span><i class="ef-minus">−</i>负电荷</span><span><i class="ef-e">E</i>场强方向</span><span><i class="ef-f">F</i>受力方向</span></div><div class="ef-canvas-wrap"><canvas class="ef-canvas" aria-label="可交互电场剖面图" role="img"></canvas><div class="ef-canvas-note">拖动图中的试探电荷调整位置；点电荷模式可拖动电荷</div></div><div class="ef-readout" aria-live="polite"></div><div class="ef-controls"><section><b>场源参数</b>${state.mode === 'points' ? `<p class="muted">拖动电荷改变位置；也可以增删电荷。</p><div class="ef-control-row"><button data-ef-add="1">＋ 添加正电荷</button><button data-ef-add="-1">− 添加负电荷</button><button data-ef-reset>恢复电偶极</button></div><div class="ef-source-list">${state.charges.map((c, i) => `<div class="ef-source-row"><span class="ef-charge-dot ${c.q > 0 ? 'positive' : 'negative'}">${c.q > 0 ? '+' : '−'}</span><label>q${i + 1} <output data-ef-charge-output="${i}">${c.q > 0 ? '+' : ''}${Number(c.q).toFixed(1)}</output><input data-ef-charge-q="${i}" type="range" min="-3" max="3" step="0.1" value="${c.q}"></label><button data-ef-remove="${i}" aria-label="删除电荷 ${i + 1}">×</button></div>`).join('')}</div>` : `<label>总电荷 Q：<output data-ef-q-output>${state.q > 0 ? '+' : ''}${state.q}</output><input data-ef-q type="range" min="-3" max="3" step="0.1" value="${state.q}"></label>${state.mode !== 'uniform' ? `<label>半径 R：<output data-ef-r-output>${state.radius.toFixed(2)}</output><input data-ef-r type="range" min="0.45" max="1.5" step="0.05" value="${state.radius}"></label>` : `<label>场强 E（方向由正负号表示）：<output data-ef-field-output>${state.field.toFixed(2)}</output><input data-ef-field type="range" min="-2" max="2" step="0.1" value="${state.field}"></label>`}`}</section><section><b>试探电荷与观察</b><label>试探电荷符号：<select data-ef-testq><option value="1" ${state.testQ > 0 ? 'selected' : ''}>正电荷 +q₀</option><option value="-1" ${state.testQ < 0 ? 'selected' : ''}>负电荷 −q₀</option></select></label><label>初速度 v₀（向右）：<output data-ef-v-output>${state.vx.toFixed(2)}</output><input data-ef-v type="range" min="0" max="1.4" step="0.05" value="${state.vx}"></label><div class="ef-toggles"><label><input type="checkbox" data-ef-lines ${state.showLines ? 'checked' : ''}>电场线</label><label><input type="checkbox" data-ef-potential ${state.showPotential ? 'checked' : ''}>等势线</label><label><input type="checkbox" data-ef-force ${state.showForce ? 'checked' : ''}>E / F 向量</label><label><input type="checkbox" data-ef-motion ${state.showMotion ? 'checked' : ''}>运动轨迹</label></div></section></div><div class="ef-insight"><span class="ef-cat" aria-hidden="true">🐈</span><div><b>先观察，再说规律</b><p data-ef-prompt>${state.testQ > 0 ? '正试探电荷的受力方向与 E 同向；换成负电荷后会怎样？' : '负试探电荷受力方向与 E 相反；轨迹方向还会和受力方向相同吗？'}</p><p class="muted">${esc(meta.formula)}。当前图为理想化二维剖面/模型；圆环显示轴对称截面，点电荷近旁数值作了有限化以便可视化。</p></div></div></section><section class="panel ef-scope"><h3>适用范围与边界</h3><p>当前互动覆盖高中常见的库仑定律、电场叠加、匀强电场、圆环轴线、带电球壳与均匀带电实心球，以及试探电荷的受力方向和定性轨迹。球形分布使用球对称理想模型；圆环图是轴对称剖面，不是完整三维流场。</p><p class="muted">它是学习可视化，不会自动替代题意识别或证明。平行板边缘效应、非均匀材料、复杂连续分布和真实装置需另建模型。要把“80%题目适配”说成结果，还需要拿高中电场题集逐题评测。</p></section>`;
      const problemBox=document.createElement('section');
      problemBox.className='ef-problem-intake';
      const savedProblem=state.compiledElectricProblem;
      const graph=savedProblem?.graphAnalysis;
      const axisLabel=axis=>[axis?.label,axis?.symbol,axis?.unit].filter(Boolean).join(' · ')||'未能识别';
      const graphPanel=graph?`<section class="ef-graph-review"><b>AI 电场图初步识别 · ${Math.round((graph.confidence||0)*100)}% 置信度</b><p>横轴：${esc(axisLabel(graph.horizontalAxis))}；范围 ${esc(graph.horizontalAxis?.min??'未读出')}～${esc(graph.horizontalAxis?.max??'未读出')}</p><p>纵轴：${esc(axisLabel(graph.verticalAxis))}；范围 ${esc(graph.verticalAxis?.min??'未读出')}～${esc(graph.verticalAxis?.max??'未读出')}</p><p>${esc(graph.summary||'未识别走势描述')}</p>${graph.segments?.length?'<ul>'+graph.segments.map(item=>`<li>x=${esc(item.fromX??'?')} 到 ${esc(item.toX??'?')}：${({increasing:'上升',decreasing:'下降',constant:'基本不变',unknown:'待判断'})[item.trend]||'待判断'}</li>`).join('')+'</ul>':''}${graph.uncertainItems?.length?`<p class="muted">待核对：${graph.uncertainItems.map(esc).join('；')}</p>`:''}<p class="muted">AI 识别是初步候选，先核对题图。只有横纵轴刻度与关键点明确时，才导入数值曲线。</p></section>`:'';
      const principle=savedProblem?.motionPrinciple;
      problemBox.innerHTML=`<label>从电场题生成实验台<textarea data-ef-problem placeholder="粘贴题干；也可以选择包含电场示意图或坐标图的题目照片">${esc(savedProblem?.question||'')}</textarea></label><div class="row"><button type="button" class="primary" data-ef-compile>按题目载入模型</button><label class="ef-image-pick">选择题图<input type="file" accept="image/*" data-ef-image hidden></label><span class="muted">自动预填基础面板，再由学生核对和微调。</span></div><p class="ef-problem-result ${savedProblem?.status==='needs_curve_confirmation'?'warn':''}" data-ef-problem-result>${esc(savedProblem?.notice||'基础面板支持点电荷、平行板、带电圆环、球壳和实心球；图像曲线先分析坐标轴和走势。')}</p>${graphPanel}${principle?`<details class="ef-principle" open><summary>本题运动原理</summary><p>${esc(principle.summary)}</p><p class="muted">${principle.formula.map(esc).join('；')}</p></details>`:''}${savedProblem?.confirmation?.length?`<details open><summary>请核对</summary><ul>${savedProblem.confirmation.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></details>`:''}`;
      view.querySelector('.ef-hero > div')?.appendChild(problemBox);
      let selectedImageData='';
      const imageInput=problemBox.querySelector('[data-ef-image]');
      if(imageInput)imageInput.onchange=async()=>{const file=imageInput.files?.[0];if(!file)return;const result=problemBox.querySelector('[data-ef-problem-result]');try{selectedImageData=await compressGraphPhoto(file);if(selectedImageData.length>10_000_000)throw new Error('压缩后图片仍过大，请裁剪题图后重试');if(result)result.textContent='题图已压缩并选中。点击“按题目载入模型”分析横纵轴与走势。'}catch(error){selectedImageData='';if(result)result.textContent='题图处理失败：'+error.message;}};
      problemBox.querySelector('[data-ef-compile]')?.addEventListener('click',()=>compileIntoBench(problemBox.querySelector('[data-ef-problem]')?.value,selectedImageData));
      if(state.pendingElectricQuestion){const pending=state.pendingElectricQuestion,imageRef=state.pendingElectricImage;delete state.pendingElectricQuestion;delete state.pendingElectricImage;persist();setTimeout(async()=>{let data='';if(imageRef?.hash){try{const token=window.__eduAuthSessionToken||'',response=await fetch('/v1/wrong-questions/images/'+encodeURIComponent(imageRef.hash),{headers:token?{authorization:'Bearer '+token}:{}});if(!response.ok)throw new Error('原题图片无法读取');const blob=await response.blob();data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=reject;reader.readAsDataURL(blob)})}catch(error){const target=problemBox.querySelector('[data-ef-problem-result]');if(target)target.textContent=error.message+'；仍可根据题干载入基础电场面板。'}}await compileIntoBench(pending,data)},0);}
      const oldProbeSelector = view.querySelector('[data-ef-testq]')?.closest('label');
      if (oldProbeSelector) {
        const probeControls = document.createElement('div'); probeControls.className = 'ef-probe-controls';
        probeControls.innerHTML = `<div class="ef-control-row"><button type="button" data-ef-probe-add="1">＋ 添加正试探电荷</button><button type="button" data-ef-probe-add="-1">− 添加负试探电荷</button></div><div class="ef-probe-list">${state.testCharges.map((probe, index) => `<div class="ef-source-row"><button type="button" data-ef-probe-select="${index}" aria-pressed="${index === state.activeTestCharge}">${index === state.activeTestCharge ? '● 当前' : '○'} ${probe.q > 0 ? '+' : '−'}q₀</button><span class="muted">${index === state.activeTestCharge ? '当前运动对象' : '可拖动'}</span><button type="button" data-ef-probe-remove="${index}" aria-label="删除试探电荷 ${index + 1}" ${state.testCharges.length <= 1 ? 'disabled' : ''}>×</button></div>`).join('')}</div>`;
        oldProbeSelector.replaceWith(probeControls);
      }
      const canvas = view.querySelector('.ef-canvas');
      view.querySelector('.ef-canvas-note').textContent = '拖动黄色试探电荷；紫色线条和 x(t) 曲线会记录你的手绘路径';
      const fieldLineToggle=document.createElement('button');
      fieldLineToggle.type='button';fieldLineToggle.className='ef-lines-toggle';
      fieldLineToggle.setAttribute('aria-pressed',String(Boolean(state.showLines)));
      fieldLineToggle.textContent=state.showLines?'电场线：显示':'电场线：已隐藏';
      fieldLineToggle.setAttribute('aria-label','切换电场线显示');
      view.querySelector('.ef-canvas-wrap').appendChild(fieldLineToggle);
      fieldLineToggle.onclick=()=>{state.showLines=!state.showLines;fieldLineToggle.setAttribute('aria-pressed',String(state.showLines));fieldLineToggle.textContent=state.showLines?'电场线：显示':'电场线：已隐藏';const checkbox=view.querySelector('[data-ef-lines]');if(checkbox)checkbox.checked=state.showLines;persist();repaint();};
      const bench = canvas.closest('.ef-bench');
      bench.classList.add(`ef-variant-${variant}`);
      view.querySelector('.ef-hero h2').textContent = '把电势、场强和运动放进同一张实验台';
      view.querySelector('.ef-hero p.muted').textContent = '拖动试探电荷或改变场源；比较 V-x、E-x 曲线，再播放粒子运动观察 x-t 变化。';
      const equation = view.querySelector('.ef-equation');
      equation.innerHTML = `${esc(meta.formula)}<br><small>沿 x 方向：Eₓ = − dV/dx</small>`;
      const profileGrid = document.createElement('div');
      profileGrid.className = 'ef-profile-grid';
      profileGrid.innerHTML = '<div class="ef-profile" data-profile="potential"><b>电势随位置 V(x)</b><small data-profile-hint>橙线；开启编辑后可上下拖动曲线波形</small><div class="ef-profile-tools"><button type="button" data-ef-edit-potential>编辑 V(x) 曲线</button><button type="button" data-ef-reset-potential>恢复原曲线</button></div><canvas aria-label="电势随位置变化曲线，可上下拖动编辑"></canvas></div><div class="ef-profile" data-profile="field"><b>场强随位置 Eₓ(x)</b><small data-field-hint>绿线；Eₓ = −dV/dx，编辑任一曲线都会联动</small><div class="ef-profile-tools"><button type="button" data-ef-edit-field>编辑 Eₓ(x) 曲线</button></div><canvas aria-label="场强随位置变化曲线，可上下拖动编辑"></canvas></div><div class="ef-profile" data-profile="time"><b>位置随时间 x(t)</b><small>播放或拖动进度；V(x) / Eₓ(x) 改变后按新场强重新模拟</small><canvas aria-label="粒子位置随时间变化曲线，可拖动查看运动"></canvas></div>';
      view.querySelector('.ef-readout').after(profileGrid);
      const overlay = document.createElement('canvas'); overlay.className = 'ef-canvas-overlay'; overlay.setAttribute('aria-hidden', 'true'); view.querySelector('.ef-canvas-wrap').appendChild(overlay);
      const toggleRow = document.createElement('div'); toggleRow.className = 'ef-motion-actions'; toggleRow.innerHTML = `<button type="button" data-ef-play>${state.playing ? '暂停理论运动' : '▶ 播放理论运动'}</button><button type="button" data-ef-restart>重播理论运动</button><button type="button" data-ef-zoom-out aria-label="缩小实验图">− 缩小</button><output data-ef-zoom-output aria-live="polite">${Math.round(state.zoom * 100)}%</output><button type="button" data-ef-zoom-in aria-label="放大实验图">＋ 放大</button><button type="button" data-ef-zoom-fit>适合窗口</button>${prototypeEnabled ? `<button type="button" data-ef-layout title="当前：${variants.find(item => item.key === variant)?.label || ''}">布局 ${String.fromCharCode(65 + variants.findIndex(item => item.key === variant))}</button>` : ''}<button type="button" data-ef-clear-trace>清除手绘轨迹</button>`; view.querySelector('.ef-canvas-wrap').before(toggleRow);
      const layoutButton = toggleRow.querySelector('[data-ef-layout]'); if (layoutButton) layoutButton.onclick = () => selectVariant(1);
      const ratioControl = document.createElement('label'); ratioControl.innerHTML = `比荷 |q₀|/m：<output data-ef-ratio-output>${state.specificCharge.toFixed(2)}</output><input data-ef-ratio type="range" min="0.2" max="2" step="0.05" value="${state.specificCharge}">`; view.querySelector('.ef-toggles').before(ratioControl);
      let motionIndex = 0, frameId = 0;
      const paintMotion = () => { const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2); overlay.width = Math.round(rect.width * dpr); overlay.height = Math.round(rect.height * dpr); const ctx = overlay.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height); const usingManual=manualTrace.length>1&&!state.playing&&scrubMotion,path=usingManual?manualTrace:(canvas.__trajectory||[]); if ((!state.playing&&!scrubMotion)||!path.length) return; const index=usingManual?manualTraceIndex:motionIndex,point=path[Math.min(index,path.length-1)],s=canvasScale(rect.width,rect.height),x=rect.width/2+point.x*s,y=rect.height/2-point.y*s;ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fillStyle='#f4b63e';ctx.strokeStyle='#614a1e';ctx.lineWidth=1.5;ctx.fill();ctx.stroke();if(point.vx!==undefined)arrow(ctx,x,y,x+point.vx*14,y-point.vy*14,'#784ab3',2); };
      function drawProfile(target, name, color, values, markerX, timeMode = false) {
        const rect = target.getBoundingClientRect(); if (!rect.width || !rect.height) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2), w = rect.width, h = rect.height;
        target.width = Math.round(w * dpr); target.height = Math.round(h * dpr);
        const ctx = target.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = '#e6edf6'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(24, h/2); ctx.lineTo(w-8, h/2); ctx.moveTo(24, 8); ctx.lineTo(24, h-16); ctx.stroke();
        if (!values || values.length < 2) { ctx.fillStyle='#75849a'; ctx.font='11px system-ui'; ctx.fillText('拖动黄色粒子描出 x(t)，或播放理论运动', 30, h/2); return; }
        const xs = values.map(point => timeMode ? point.t : point.x), ys = values.map(point => timeMode ? point.x : point.value);
        const xMin = Math.min(...xs), xMax = Math.max(...xs), autoMin = Math.min(...ys), autoMax = Math.max(...ys), fixedRange = name === 'V' && state.profileV ? state.profileRange : name === 'Eₓ' && state.editField ? state.profileERange : null, yMin = fixedRange ? -fixedRange : autoMin, yMax = fixedRange ? fixedRange : autoMax, ySpan = Math.max(.05, yMax-yMin);
        const X = x => 26 + (x-xMin)/Math.max(.001,xMax-xMin)*(w-38), Y = y => h-17-(y-yMin)/ySpan*(h-29);
        ctx.strokeStyle=color; ctx.lineWidth=2; ctx.beginPath(); values.forEach((point,index) => { const x= timeMode ? point.t : point.x, y= timeMode ? point.x : point.value; if(index===0)ctx.moveTo(X(x),Y(y));else ctx.lineTo(X(x),Y(y)); }); ctx.stroke();
        if (markerX !== null) { const x=X(markerX); ctx.strokeStyle='#263c5c88';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x,8);ctx.lineTo(x,h-16);ctx.stroke();ctx.setLineDash([]); }
        ctx.fillStyle='#677990';ctx.font='10px system-ui';ctx.fillText(timeMode?'t':'x',w-14,h-3);ctx.fillText(name,3,12);
      }
      function paintProfiles() {
        const data=canvas.__profileData||[];
        drawProfile(profileGrid.querySelector('[data-profile="potential"] canvas'),'V','#d88a36',data.map(p=>({x:p.x,value:p.potential})),state.testX);
        drawProfile(profileGrid.querySelector('[data-profile="field"] canvas'),'Eₓ','#27866b',data.map(p=>({x:p.x,value:p.field})),state.testX);
        const path=canvas.__trajectory||[];
        const useManual=manualTrace.length>1&&!state.playing,samples=useManual?manualTrace:path.map((p,index)=>({t:index*.015,x:p.x}));
        const marker=samples.length?(state.playing||scrubMotion)?Math.min(samples.length-1,useManual?manualTraceIndex:motionIndex)*.015:useManual?samples[samples.length-1].t:null:null;
        drawProfile(profileGrid.querySelector('[data-profile="time"] canvas'),'x','#376fd4',samples,marker,true);
      }
      let repaintFrame = 0, repaintFast = false;
      const repaint = (fast = false) => {
        if (repaintFrame) { repaintFast = repaintFast && fast; return; }
        repaintFast = fast;
        repaintFrame = requestAnimationFrame(() => {
          repaintFrame = 0; const fastFrame = repaintFast; repaintFast = false;
          if (!canvas.isConnected) return;
          draw(canvas, fastFrame); const readout = view.querySelector('.ef-readout'); if (readout) readout.textContent = canvas.dataset.readout || '';
          paintMotion(); paintProfiles();
        });
      };
      const setZoom = value => { state.zoom = Math.max(.65, Math.min(1.6, Math.round(value * 100) / 100)); const output = view.querySelector('[data-ef-zoom-output]'); if (output) output.textContent = `${Math.round(state.zoom * 100)}%`; persist(); repaint(); };
      view.querySelector('[data-ef-zoom-out]').onclick = () => setZoom(state.zoom - .15);
      view.querySelector('[data-ef-zoom-in]').onclick = () => setZoom(state.zoom + .15);
      view.querySelector('[data-ef-zoom-fit]').onclick = () => setZoom(1);
      const editPotentialButton = view.querySelector('[data-ef-edit-potential]');
      const editFieldButton = view.querySelector('[data-ef-edit-field]');
      const refreshPotentialEditor = () => { if (editPotentialButton) editPotentialButton.textContent = state.editPotential ? '完成曲线编辑' : '编辑 V(x) 曲线'; if (editFieldButton) editFieldButton.textContent = state.editField ? '完成曲线编辑' : '编辑 Eₓ(x) 曲线'; const hint = view.querySelector('[data-profile-hint]'); if (hint) hint.textContent = state.editPotential ? '拖动橙色曲线上的点，上下改变电势波形' : '橙线；开启编辑后可上下拖动曲线波形'; const fieldHint = view.querySelector('[data-field-hint]'); if (fieldHint) fieldHint.textContent = state.editField ? '拖动绿色曲线上的点；橙色 V(x) 与运动会同步变化' : '绿线；Eₓ = −dV/dx，编辑任一曲线都会联动'; };
      editPotentialButton.onclick = () => { if (!state.profileV) { const values = (canvas.__profileData || []).map(point => point.potential); state.profileV = values.length === 81 ? values : Array.from({length:81}, (_,i) => Math.sin(i/80*Math.PI*2)); state.profileRange = Math.max(.5, ...state.profileV.map(value => Math.abs(value))) * 1.25; } state.editPotential = !state.editPotential; if (state.editPotential) { state.editField = false; state.profileE = null; } refreshPotentialEditor(); persist(); repaint(); };
      editFieldButton.onclick = () => { if (!state.profileE) { const values = (canvas.__profileData || []).map(point => point.field); state.profileE = values.length === 81 ? values : Array.from({length:81}, () => 0); state.profileERange = Math.max(.5, ...state.profileE.map(value => Math.abs(value))) * 1.25; const anchor = state.profileV?.[0] ?? (canvas.__profileData?.[0]?.potential ?? 0); state.profileV = [anchor]; for (let i = 1; i < 81; i++) state.profileV.push(state.profileV[i-1] - (state.profileE[i-1] + state.profileE[i]) * .5 * .065); state.profileRange = Math.max(.5, ...state.profileV.map(value => Math.abs(value))) * 1.25; } state.editField = !state.editField; if (state.editField) state.editPotential = false; refreshPotentialEditor(); persist(); repaint(); };
      view.querySelector('[data-ef-reset-potential]').onclick = () => { state.profileV = null; state.profileE = null; state.editPotential = false; state.editField = false; refreshPotentialEditor(); persist(); repaint(); };
      refreshPotentialEditor();
      function bindCurveDrag(target, kind) {
        if (target.dataset.dragBound) return;
        target.dataset.dragBound = 'true';
        const update = event => {
          const rect=target.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(event.clientX-rect.left-26)/Math.max(1,rect.width-38)));
          if(kind==='potential' && state.editPotential && target.__editGesture){
            const y = Math.max(8, Math.min(rect.height - 17, event.clientY - rect.top)), desired = ((rect.height - 17 - y) / Math.max(1,rect.height - 29) * 2 - 1) * state.profileRange, delta = desired - target.__editGesture.original[target.__editGesture.index];
            state.profileV = target.__editGesture.original.map((value,index) => Math.max(-state.profileRange, Math.min(state.profileRange, value + delta * Math.exp(-(((index-target.__editGesture.index)/3.5)**2)))));
          }else if(kind==='field' && state.editField && target.__editGesture){
            const y = Math.max(8, Math.min(rect.height - 17, event.clientY - rect.top)), desired = ((rect.height - 17 - y) / Math.max(1,rect.height-29) * 2 - 1) * state.profileERange, delta = desired - target.__editGesture.original[target.__editGesture.index];
            state.profileE = target.__editGesture.original.map((value,index) => Math.max(-state.profileERange, Math.min(state.profileERange, value + delta * Math.exp(-(((index-target.__editGesture.index)/3.5)**2)))));
            state.profileV = [target.__editGesture.anchor]; for (let i=1;i<81;i++) state.profileV.push(state.profileV[i-1] - (state.profileE[i-1]+state.profileE[i])*.5*.065);
          }else if(kind==='time'){
            if(state.playing)pause();
            scrubMotion=true;
            const usingManual=manualTrace.length>1,path=usingManual?manualTrace:(canvas.__trajectory||[]);
            if(!path.length)return;
            const index=Math.round(fraction*(path.length-1));
            if(usingManual){manualTraceIndex=index;const point=path[index];state.testX=point.x;state.testY=point.y;}
            else{motionIndex=index;const point=path[index];state.testX=point.x;state.testY=point.y;}
          }else{
            scrubMotion=false;
            state.testX=-2.6+fraction*5.2;
          }
          repaint(true);
        };
        target.addEventListener('pointerdown',event=>{event.preventDefault();if(kind==='potential'&&state.editPotential){const rect=target.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(event.clientX-rect.left-26)/Math.max(1,rect.width-38)));target.__editGesture={index:Math.round(fraction*80),original:state.profileV.slice()};}else if(kind==='field'&&state.editField){const rect=target.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(event.clientX-rect.left-26)/Math.max(1,rect.width-38)));target.__editGesture={index:Math.round(fraction*80),original:state.profileE.slice(),anchor:state.profileV[0]};}else if(kind==='position'){if(state.playing)pause();scrubMotion=false;manualTrace=[];}target.setPointerCapture(event.pointerId);update(event);});
        target.addEventListener('pointermove',event=>{if(target.hasPointerCapture(event.pointerId))update(event);});
        target.addEventListener('pointerup',event=>{if(target.hasPointerCapture(event.pointerId))target.releasePointerCapture(event.pointerId);persist();});
        target.addEventListener('pointercancel',()=>persist());
      }
      bindCurveDrag(profileGrid.querySelector('[data-profile="potential"] canvas'),'potential');
      bindCurveDrag(profileGrid.querySelector('[data-profile="field"] canvas'),'field');
      bindCurveDrag(profileGrid.querySelector('[data-profile="time"] canvas'),'time');
      const mutate = () => { persist(); repaint(); };
      const syncProbeSelection = index => { state.activeTestCharge = index; const probe = state.testCharges[index]; state.testX = probe.x; state.testY = probe.y; state.testQ = probe.q; };
      view.querySelectorAll('[data-ef-probe-add]').forEach(button => button.onclick = () => { const index = state.testCharges.length, sign = Number(button.dataset.efProbeAdd); state.testCharges.push({ x: ((index % 3) - 1) * .72, y: (Math.floor(index / 3) - .5) * .62, q: sign }); syncProbeSelection(index); persist(); activeRender(); });
      view.querySelectorAll('[data-ef-probe-select]').forEach(button => button.onclick = () => { syncProbeSelection(Number(button.dataset.efProbeSelect)); persist(); activeRender(); });
      view.querySelectorAll('[data-ef-probe-remove]').forEach(button => button.onclick = () => { if (state.testCharges.length <= 1) return; const index = Number(button.dataset.efProbeRemove); state.testCharges.splice(index, 1); syncProbeSelection(Math.min(state.activeTestCharge > index ? state.activeTestCharge - 1 : state.activeTestCharge, state.testCharges.length - 1)); persist(); activeRender(); });
      view.querySelectorAll('[data-ef-mode]').forEach(button => button.onclick = () => { state.mode = button.dataset.efMode; if (state.mode === 'points' && state.charges.length < 2) state.charges = [{ x: -.8, y: 0, q: 1 }, { x: .8, y: 0, q: -1 }]; persist(); activeRender(); });
      view.querySelectorAll('[data-ef-add]').forEach(button => button.addEventListener('click', e => { const index = state.charges.length; state.charges.push({ x: ((index % 3) - 1) * .85, y: Math.floor(index / 3) * .55, q: Number(e.currentTarget.dataset.efAdd) }); persist(); activeRender(); }));
      view.querySelectorAll('[data-ef-remove]').forEach(button => button.onclick = () => { state.charges.splice(Number(button.dataset.efRemove), 1); mutate(); activeRender(); });
      view.querySelectorAll('[data-ef-charge-q]').forEach(input => input.oninput = e => { const index = Number(e.target.dataset.efChargeQ), source = e.target.closest('.ef-source-row'); state.charges[index].q = Number(e.target.value); const output = view.querySelector(`[data-ef-charge-output="${index}"]`); if (output) output.textContent = `${state.charges[index].q > 0 ? '+' : ''}${state.charges[index].q.toFixed(1)}`; const dot = source.querySelector('.ef-charge-dot'); dot.textContent = state.charges[index].q > 0 ? '+' : '−'; dot.classList.toggle('positive', state.charges[index].q > 0); dot.classList.toggle('negative', state.charges[index].q <= 0); mutate(); });
      view.querySelector('[data-ef-reset]')?.addEventListener('click', () => { state.charges = INITIAL.charges.map(c => ({ ...c })); mutate(); activeRender(); });
      const bindRange = (selector, prop, out, fmt = value => Number(value).toFixed(2)) => view.querySelector(selector)?.addEventListener('input', e => { state[prop] = Number(e.target.value); const label = view.querySelector(out); if (label) label.textContent = fmt(state[prop]); mutate(); });
      bindRange('[data-ef-q]', 'q', '[data-ef-q-output]', value => `${value > 0 ? '+' : ''}${value.toFixed(1)}`); bindRange('[data-ef-r]', 'radius', '[data-ef-r-output]'); bindRange('[data-ef-field]', 'field', '[data-ef-field-output]'); bindRange('[data-ef-v]', 'vx', '[data-ef-v-output]');
      view.querySelector('[data-ef-prompt]').textContent = state.testQ > 0 ? '正试探电荷的受力方向与 E 同向；轨迹切线又和 E 有什么关系？' : '负试探电荷受力方向与 E 相反；轨迹方向还会和受力方向相同吗？';
      bindRange('[data-ef-ratio]', 'specificCharge', '[data-ef-ratio-output]');
      for (const [selector, prop] of [['[data-ef-lines]', 'showLines'], ['[data-ef-potential]', 'showPotential'], ['[data-ef-force]', 'showForce'], ['[data-ef-motion]', 'showMotion']]) view.querySelector(selector).onchange = e => { state[prop] = e.target.checked; mutate(); };
      const start = () => { manualTrace = []; scrubMotion=false; state.showMotion = true; state.playing = true; motionIndex = 0; const motionToggle = view.querySelector('[data-ef-motion]'); if (motionToggle) motionToggle.checked = true; view.querySelector('[data-ef-play]').textContent = '暂停理论运动'; persist(); repaint(); let profileFrame = 0; const tick = () => { if (!state.playing) return; motionIndex += 2; if (motionIndex >= (canvas.__trajectory || []).length - 1) motionIndex = 0; paintMotion(); if (++profileFrame % 4 === 0) paintProfiles(); frameId = requestAnimationFrame(tick); }; frameId = requestAnimationFrame(tick); stopAnimation = () => { state.playing = false; cancelAnimationFrame(frameId); }; };
      const pause = () => { state.playing = false; cancelAnimationFrame(frameId); stopAnimation = null; view.querySelector('[data-ef-play]').textContent = '▶ 播放理论运动'; repaint(); };
      view.querySelector('[data-ef-play]').onclick = () => { if (state.playing) pause(); else start(); };
      view.querySelector('[data-ef-restart]').onclick = () => { if (state.playing) pause(); start(); };
      view.querySelector('[data-ef-clear-trace]').onclick = () => { manualTrace = []; repaint(); };
      let drag = null;
      canvas.addEventListener('pointerdown', e => { const rect = canvas.getBoundingClientRect(), s = canvasScale(rect.width, rect.height), x = (e.clientX - rect.left - rect.width / 2) / s, y = (rect.height / 2 - (e.clientY - rect.top)) / s; const probeIndex = state.testCharges.findIndex(probe => Math.hypot(x - probe.x, y - probe.y) < .48); if (probeIndex >= 0) { if (probeIndex !== state.activeTestCharge) syncProbeSelection(probeIndex); if (state.playing) pause(); scrubMotion=false;state.showMotion=false;const motionToggle=view.querySelector('[data-ef-motion]');if(motionToggle)motionToggle.checked=false;manualTrace = [{t:0,x:state.testX,y:state.testY}];manualTraceIndex=0; traceStartedAt = performance.now(); drag = { type: 'test' }; } else if (state.mode === 'points') { const index = state.charges.findIndex(c => Math.hypot(x - c.x, y - c.y) < .52); if (index >= 0) drag = { type: 'charge', index }; } if (drag) { e.preventDefault();canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); } });
      canvas.addEventListener('pointermove', e => { if (!drag) return; const rect = canvas.getBoundingClientRect(), s = canvasScale(rect.width, rect.height), x = (e.clientX - rect.left - rect.width / 2) / s, y = (rect.height / 2 - (e.clientY - rect.top)) / s; if (drag.type === 'test') { state.testX = x; state.testY = y; state.testCharges[state.activeTestCharge] = { ...state.testCharges[state.activeTestCharge], x, y }; const t=(performance.now()-traceStartedAt)/1000, previous=manualTrace[manualTrace.length-1]; if (!previous||Math.hypot(x-previous.x,y-previous.y)>.025) manualTrace.push({t,x,y}); if(manualTrace.length>1500)manualTrace=manualTrace.filter((_,index)=>index%2===0); repaint(true); } else { state.charges[drag.index].x = x; state.charges[drag.index].y = y; repaint(true); } });
      const finishDrag = () => { if (drag) { persist(); repaint(); } drag = null; canvas.classList.remove('dragging'); };
      canvas.addEventListener('pointerup', finishDrag); canvas.addEventListener('pointercancel', finishDrag);
      const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(repaint) : null; if (resize) resize.observe(canvas); else window.addEventListener('resize', repaint, { once: true }); repaint();
      disposeElectric = () => { if (resize) resize.disconnect(); if (stopAnimation) { stopAnimation(); stopAnimation = null; } };
    }
    function mountElectricLab(container, options = {}) {
      if (!container) throw new Error('电场实验台需要一个容器元素');
      const seeded = options.state && typeof options.state === 'object' ? options.state : {};
      const mapped = Object.assign({}, seeded);
      if (mapped.charge !== undefined && mapped.q === undefined) {
        if (mapped.mode === 'uniform') mapped.field = Number(mapped.charge) || 1;
        else mapped.q = Number(mapped.charge) || 1;
        delete mapped.charge;
      }
      if (mapped.testCharge !== undefined && mapped.testQ === undefined) { mapped.testQ = Number(mapped.testCharge) || 1; delete mapped.testCharge; }
      Object.assign(state, INITIAL, mapped);
      if (!MODES[state.mode]) state.mode = 'points';
      if (!Array.isArray(state.charges)) state.charges = INITIAL.charges.map(c => ({ ...c }));
      state.zoom = Math.max(.65, Math.min(1.6, Number(state.zoom) || 1));
      if (!Array.isArray(state.testCharges) || !state.testCharges.length) state.testCharges = [{ x: state.testX, y: state.testY, q: state.testQ }];
      state.activeTestCharge = Math.max(0, Math.min(state.testCharges.length - 1, Number(state.activeTestCharge) || 0));
      Object.assign(state, { testX: Number(state.testCharges[state.activeTestCharge].x) || 0, testY: Number(state.testCharges[state.activeTestCharge].y) || 0, testQ: Number(state.testCharges[state.activeTestCharge].q) || 1 });
      state.editPotential = Boolean(state.editPotential);
      state.editField = Boolean(state.editField);
      if (!Array.isArray(state.profileV) || state.profileV.length !== 81) state.profileV = null;
      if (!Array.isArray(state.profileE) || state.profileE.length !== 81) state.profileE = null;
      state.profileRange = Math.max(.5, Number(state.profileRange) || 1);
      state.profileERange = Math.max(.5, Number(state.profileERange) || 1);
      state.playing = false;
      const prevPersist = persistEnabled, prevRender = activeRender;
      persistEnabled = options.persist !== false;
      activeRender = typeof options.render === 'function' ? options.render : render;
      electricPage(container);
      return { dispose() { if (disposeElectric) { disposeElectric(); disposeElectric = null; } persistEnabled = prevPersist; activeRender = prevRender; }, state };
    }
    function laboratoryPage(view) {
      showVariantBar();
      view.className = 'work';
      if (state.activeSection !== 'tools' || state.activeLab !== 'electric') {
        state.playing = false;
        if (disposeElectric) { disposeElectric(); disposeElectric = null; }
      }
      view.innerHTML = `<section class="panel toolbox-heading"><h2>工具箱</h2><p>查考法、做建模，也试试新的学习方式。</p><nav class="toolbox-nav" aria-label="工具箱分区">${[['textbook','教材考法库'],['tools','几何与学科工具']].map(([key,title]) => `<button type="button" data-toolbox-section="${key}" aria-pressed="${state.activeSection === key}">${title}</button>`).join('')}</nav></section><div id="toolbox-content"></div>`;
      view.querySelectorAll('[data-toolbox-section]').forEach(button => button.onclick = () => { state.activeSection = button.dataset.toolboxSection; persist(); api.render(); });
      const section = view.querySelector('#toolbox-content');
      if (state.activeSection === 'textbook') {
        if (window.__eduTextbookLibrary) window.__eduTextbookLibrary.render(section);
        else section.innerHTML = '<section class="panel"><p>考法库未能加载，请刷新页面重试。</p></section>';
        return;
      }
      section.innerHTML = `<section class="panel lab-switcher"><div class="lab-switcher-head"><div><span class="pill good">学习工具</span><h2>几何与学科工具</h2><p class="muted">选择一门学科，进入对应的互动工具。</p></div><span class="lab-mark" aria-hidden="true">✦</span></div><div class="lab-toolbar" role="tablist" aria-label="选择学科实验">${[['electric','⚡','物理 · 电场']].map(([key, icon, title]) => `<button type="button" role="tab" aria-selected="${state.activeLab === key}" data-lab-select="${key}" class="${state.activeLab === key ? 'active' : ''}"><span aria-hidden="true">${icon}</span>${title}</button>`).join('')}</div></section><div class="lab-content" id="lab-course-content"></div>`;
      view.querySelectorAll('[data-lab-select]').forEach(button => button.onclick = () => { state.activeLab = button.dataset.labSelect; persist(); api.render(); });
      const content = section.querySelector('#lab-course-content');
      section.querySelector('.lab-switcher').insertAdjacentHTML('beforeend', '<div class="toolbox-model-entry"><span>圆柱、圆锥、球的截面与空间模型</span><button type="button" data-toolbox-circular>进入圆体建模 →</button></div>');
      section.querySelector('[data-toolbox-circular]').onclick = () => { appState.tab = 'circular'; api.render(); };
      activeRender = render; persistEnabled = true; if (state.activeLab === 'electric') electricPage(content);
      else if (typeof window.__eduRenderLegacyLab === 'function') { state.playing = false; if (disposeElectric) { disposeElectric(); disposeElectric = null; } window.__eduRenderLegacyLab(state.activeLab, content); }
      else content.innerHTML = '<section class="panel">课程引擎正在加载，请稍后再试。</section>';
    }
    api.registerRender(() => { if (appState.tab !== 'labs') { variantBar?.remove(); state.playing = false; if (disposeElectric) { disposeElectric(); disposeElectric = null; } return false; } document.querySelector('.tabs').hidden = false; document.querySelectorAll('.tabs button').forEach(button => button.classList.toggle('active', button.dataset.tab === 'labs')); laboratoryPage(api.view); return true; });
    api.decorateHome(v => { v.querySelectorAll('[data-open-chem],[data-open-analytic],[data-open-electric]').forEach(button => button.closest('.panel')?.remove()); v.insertAdjacentHTML('beforeend', '<section class="panel ef-home"><div><span class="pill good">随时查阅</span><h2>工具箱</h2><p class="muted">教材考法库与几何与学科工具。</p></div><button class="primary" data-open-laboratory>打开工具箱</button></section>'); v.querySelector('[data-open-laboratory]').onclick = () => { appState.tab = 'labs'; api.render(); }; });
  }
  // —— 任意容器复用入口（错题库题卡内联电场实验台） ——
  function mountFromAnyContainer(container, options) {
    const opts = options && typeof options === 'object' ? options : {};
    if (typeof sharedMountElectricLab !== 'function') {
      const stub = { state: state, render: function () {}, renderHome: function () {},
        registerRender: function () {}, decorateHome: function () {}, view: null };
      try { activate(stub); } catch (error) { if (typeof document !== 'undefined') console.warn('[electric-lab] activate 复用失败：' + (error && error.message)); }
    }
    if (typeof sharedMountElectricLab !== 'function') throw new Error('电场实验台尚未就绪，请稍后重试');
    return sharedMountElectricLab(container, opts);
  }
  window.__eduMountElectricLab = function (container, options) {
    if (!container) throw new Error('__eduMountElectricLab 需要一个容器元素');
    return mountFromAnyContainer(container, options);
  };
  if (typeof window.__registerElectricFieldLab === 'function') window.__registerElectricFieldLab({ activate });
  else window.addEventListener('load', () => window.__registerElectricFieldLab?.({ activate }), { once: true });
})();
