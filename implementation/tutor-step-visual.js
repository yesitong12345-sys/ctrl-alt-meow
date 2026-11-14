/* 得分点 → 3D 模型的高亮与数值标注（本地渲染，不再问 AI）
 *
 * 为什么要有这个文件：
 * 陪练的「本题得分点」和那个 3D 模型原本是两套互不相干的东西 —— 模型只吃 geometryResult，
 * 得分点里没有任何可视化描述。于是学生已经推出「截面半径 = 5」，模型上却什么都不会出现。
 *
 * 但这件事不需要 AI 重新生成模型：AI 反推得分点时顺手把「这一步高亮哪些实体、这一步的数值是多少」
 * 一起返回（见 server/workflows/ai-rubric.mjs 的 visual 字段），前端在**已经挂好的同一个场景**上
 * 本地高亮 + 标数字就够了。省掉的是"为了换个高亮状态再让模型生成一遍"的那笔 token。
 *
 * 两个实现选择，都是为了不跟渲染器重复造轮子：
 * ① 高亮用渲染器自带的能力：container.__geometryController.dimExcept(ids)
 *    （它会把非相关实体压淡、相关实体保持清晰，正是"聚焦这一步"要的效果）
 * ② 数值不自己算三维投影。渲染器已有一套跟着相机更新的标注层
 *    （.measure-label / .geometry-label-layer），自己再实现一遍只会错位。
 *    所以数值显示为模型下方的一条读数条 —— 位置永远不会错，也不需要动渲染器。
 *
 * 取值优先级：AI 这一步明确给出的值 → 后端已验证的 dimensions 值 → 不标（绝不猜）。
 */
(function () {
  'use strict';

  var css = '.geo-step-readout{position:absolute;left:8px;right:8px;bottom:8px;display:flex;gap:7px;flex-wrap:wrap;'
    + 'pointer-events:none;z-index:7}'
    + '.geo-step-readout span{padding:4px 11px;border-radius:10px;background:rgba(255,255,255,.96);'
    + 'border:1px solid #cfdcef;color:#243a5e;font:13px/1.5 system-ui;box-shadow:0 2px 8px rgba(38,51,65,.14)}'
    + '.geo-step-readout span.is-answer{background:#e6f0ff;border-color:#3f6fd8;color:#1c3f8f;font-weight:700}'
    + '.geo-step-readout span.is-derived{background:#fffdf8;border-style:dashed;color:#8b4f2e}'
    + '.geo-step-readout span.is-step{background:#fff3d6;border-color:#d9a441;color:#7a4c00;font-weight:700}';
  var styleNode = null;
  function ensureStyle() {
    if (styleNode || typeof document === 'undefined') return;
    styleNode = document.createElement('style');
    styleNode.textContent = css;
    document.head.appendChild(styleNode);
  }

  /* geometryResult 里的数值是精确节点（{op:'rational',p,q} 之类），要能变成人看的数 */
  function numeric(node) {
    if (node == null) return NaN;
    if (typeof node === 'number') return node;
    if (typeof node !== 'object') return Number(node);
    if (node.op === 'integer') return Number(node.value);
    if (node.op === 'rational') return Number(node.p) / Number(node.q);
    if (node.op === 'sqrt') return Math.sqrt(numeric(node.arg));
    if (node.op === 'neg') return -numeric(node.arg);
    if (node.op === 'add') return (node.args || []).reduce(function (sum, item) { return sum + numeric(item); }, 0);
    if (node.op === 'mul') return (node.args || []).reduce(function (product, item) { return product * numeric(item); }, 1);
    return NaN;
  }

  function display(value) {
    if (value == null || value === '') return '';
    var number = numeric(value);
    if (Number.isFinite(number)) {
      if (Math.abs(number - Math.round(number)) < 1e-9) return String(Math.round(number));
      return String(Math.round(number * 1000) / 1000);
    }
    return String(value).trim();
  }

  /* 后端已验证的尺寸值。这一步的关键词更偏"半径"时优先挑半径类的。 */
  function dimensionFor(result, keywords) {
    var dimensions = (result && result.scene && result.scene.dimensions) || [];
    if (!dimensions.length) return null;
    var wanted = String(keywords || '');
    var preferRadius = /半径|直径|radius|diameter|截面圆/.test(wanted);
    var usable = dimensions.filter(function (item) {
      if (!item || item.value == null) return false;
      // 估读的值不标：宁可没有，也不能标错
      return !item.estimated;
    });
    if (!usable.length) return null;
    var pick = null;
    if (preferRadius) pick = usable.find(function (item) {
      return /半径|直径|radius|diameter/.test(String(item.label || '') + ' ' + String(item.kind || ''));
    });
    if (!pick) pick = usable[0];
    return {value: pick.value, text: pick.label || (preferRadius ? '半径' : '长度')};
  }

  /* 这一步要显示哪些数值。AI 已经算出来的值直接用，不让前端猜。 */
  function valuesForStep(step, result) {
    var visual = (step && step.visual) || null;
    var out = [];
    ((visual && visual.labels) || []).forEach(function (label) {
      var value = display(label.value);
      if (!value) return;
      out.push({value: value, text: label.text || '', kind: label.fromAnswer ? 'answer' : 'step'});
    });
    if (!out.length) {
      var keywords = String((step && step.label) || '') + ' ' + String((step && step.goal) || '') + ' ' + String((step && step.hint) || '');
      var derived = dimensionFor(result, keywords);
      if (derived) out.push({value: display(derived.value), text: derived.text, kind: 'derived'});
    }
    return out.slice(0, 4);
  }

  /* 本地兜底：AI 经常把 highlight 留空，但它写的这一步文字里本来就会提到题面的点名
     （「求三边长度」→ AC、AB₁）。这些点名在 geometryResult 的坐标表里是已知的，
     直接按名字认出来即可 —— 不必为了这个再问一次模型。 */
  function namesMentionedInStep(step, result) {
    var coordinates = (result && (result.__normalizedCoordinates || result.canonicalCoordinates)) || {};
    var haystack = [step && step.label, step && step.goal, step && step.hint, step && step.why]
      .map(function (value) { return String(value || ''); }).join(' ');
    if (!haystack.trim()) return [];
    var found = [];
    Object.keys(coordinates).forEach(function (name) {
      if (!name || name.length > 6) return;
      var letter = /^[A-Za-z]$/.test(name);
      // 单字母点名（A、B1、A₁）要按词边界匹配，否则「半径」里的字母、"S" 都会误命中；
      // 多字点名直接找子串即可。
      var hit = letter
        ? new RegExp('(^|[^A-Za-z0-9])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z0-9]|$)').test(haystack)
        : haystack.indexOf(name) >= 0;
      if (hit) found.push(name);
    });
    return found;
  }

  /* 把题面点名里的下标数字统一成 ASCII（B₁ → B1），避免和坐标表里的写法对不上。 */
  function normName(value) {
    return String(value == null ? '' : value).replace(/[₀₁₂₃₄₅₆₇₈₉]/g, function (ch) {
      return String('₀₁₂₃₄₅₆₇₈₉'.indexOf(ch));
    });
  }

  /* 把 "6√2"、"6√2/√3"、"60°"、"5" 这类字符串解析成数值；解析不了返回 NaN。
     只支持「数 × √数」与「分子/分母」这种 AI 常见写法，不做完整表达式求值。 */
  function parseTerm(term) {
    if (!term) return NaN;
    var m = String(term).match(/^(\d*\.?\d*)(?:√(\d*\.?\d*))?$/);
    if (!m) return NaN;
    var coeff = m[1] === '' ? 1 : Number(m[1]);
    if (!Number.isFinite(coeff)) return NaN;
    if (m[2] == null || m[2] === '') return coeff;
    var radicand = Number(m[2]);
    if (!Number.isFinite(radicand) || radicand < 0) return NaN;
    return coeff * Math.sqrt(radicand);
  }
  function parseExpression(text) {
    if (text == null) return NaN;
    if (typeof text === 'number') return text;
    if (typeof text !== 'string') return numeric(text);
    var s = String(text).replace(/[°度]/g, '').replace(/\s+/g, '').trim();
    if (!s) return NaN;
    var parts = s.split('/');
    var numerator = parseTerm(parts[0]);
    var denominator = parts.length > 1 ? parseTerm(parts[1]) : 1;
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return NaN;
    return numerator / denominator;
  }

  /* 一个场景元素代表的值：截面圆/圆盘取半径，线段取两端点距离。 */
  function pointDistance(a, b, coordinates) {
    var pa = coordinates[a], pb = coordinates[b];
    if (!pa || !pb) return null;
    var dx = numeric(pa[0]) - numeric(pb[0]);
    var dy = numeric(pa[1]) - numeric(pb[1]);
    var dz = numeric(pa[2] || 0) - numeric(pb[2] || 0);
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return Number.isFinite(d) ? d : null;
  }
  function elementValue(element, coordinates) {
    if (!element || !coordinates) return null;
    if (element.type === 'section-circle' || element.type === 'disk') {
      var radius = numeric(element.radius);
      return Number.isFinite(radius) ? radius : null;
    }
    if (element.type === 'segment' && Array.isArray(element.points) && element.points.length === 2) {
      return pointDistance(element.points[0], element.points[1], coordinates);
    }
    return null;
  }

  /* 本地值匹配：从这一步的 label（AI 顺带返回的「量 + 数值」）认实体。
     - 文本直接含点名（AC / AB₁ / CB₁）→ 找端点是这些点的 segment / point；
     - 文本是量类型（半径 / 高 / 内角），用数值去场景里找值相等的元素。 */
  function entitiesFromLabels(step, result) {
    var visual = (step && step.visual) || null;
    var labels = (visual && visual.labels) || [];
    if (!labels.length) return [];
    var coordinates = (result && (result.__normalizedCoordinates || result.canonicalCoordinates)) || {};
    var elements = (result && result.scene && result.scene.elements) || [];
    var coordNames = Object.keys(coordinates);
    var ids = [];
    labels.forEach(function (label) {
      if (!label) return;
      var text = String(label.text || label.entity || '').trim();
      if (!text) return;
      var value = parseExpression(label.value);
      var textNorm = normName(text).replace(/_?\{(\d+)\}/g,'$1');
      var tokens = textNorm.match(/[A-Za-z](?:\d+|'+)?/g) || [];
      var points = coordNames.filter(function (name) { return tokens.indexOf(normName(name)) >= 0; });
      if (points.length >= 2) {
        elements.forEach(function (element) {
          if (!element || !element.id || ids.indexOf(element.id) >= 0) return;
          var elementPoints = Array.isArray(element.points) ? element.points : (element.point ? [element.point] : []);
          if (elementPoints.length && elementPoints.every(function (p) { return points.indexOf(p) >= 0; })) ids.push(element.id);
        });
        return;
      }
      var wantRadius = /半径|直径|截面圆|radius|diameter|section/.test(text);
      var wantHeight = /高|距离|边长|长度|height|length|distance/.test(text);
      var wantAngle = /内角|二面角|角度|angle|dihedral/.test(text);
      var wantArea = /面积|area/.test(text);
      var candidates = elements.filter(function (element) {
        if (!element || !element.id) return false;
        if (wantRadius) return element.type === 'section-circle' || element.type === 'disk';
        if (wantHeight) return element.type === 'segment';
        if (wantAngle || wantArea) return element.type === 'polyhedron-face' || element.type === 'section-triangle';
        return false;
      });
      if (!candidates.length) return;
      if (Number.isFinite(value)) {
        var hit = candidates.find(function (element) {
          var v = elementValue(element, coordinates);
          return v !== null && Math.abs(v - value) < 1e-6;
        });
        if (hit && candidates.filter(function(element){var v=elementValue(element,coordinates);return v!==null&&Math.abs(v-value)<1e-6;}).length === 1) ids.push(hit.id);
      }
    });
    return ids.slice(0, 12);
  }

  /* 从已验证的 dimensions 认这一步涉及的点：step 文字提到「半径/高/距离/边长」，
     就在 scene.dimensions 里找 label 命中对应词的项，返回它的 points。
     dimensions 是几何内核算出来的，所有 verified 模型都有，比 AI 的 highlight 可靠。 */
  function dimensionPointsForStep(step, result) {
    var dimensions = (result && result.scene && result.scene.dimensions) || [];
    if (!dimensions.length) return [];
    var text = [step && step.label, step && step.goal, step && step.hint, step && step.why]
      .map(function (value) { return String(value || ''); }).join(' ');
    var wantRadius = /半径|直径|radius|diameter/.test(text);
    var wantHeight = /高|height/.test(text);
    var wantEdge = /边长|长度|棱|edge|length/.test(text);
    var wantDistance = /距离|点面距|distance/.test(text);
    var points = [];
    dimensions.forEach(function (dimension) {
      if (!dimension || !Array.isArray(dimension.points) || !dimension.points.length) return;
      var label = String(dimension.label || '') + ' ' + String(dimension.id || '');
      var hit = (wantRadius && /半径|直径|radius|diameter|r\s*=/.test(label))
        || (wantHeight && /高|height|h\s*=/.test(label))
        || (wantEdge && /边长|长度|棱/.test(label))
        || (wantDistance && /距离|distance/.test(label));
      if (hit) dimension.points.forEach(function (pointName) { if (points.indexOf(pointName) < 0) points.push(pointName); });
    });
    return points;
  }

  /* 这一步高亮哪些实体：本地匹配为主 —— ① 步骤文字里提到的点名 ② label 里的实体/量 + 数值
     ③ dimensions 里的量对应的点；AI 给的 highlight 只作补充，对不上就不高亮。 */
  function entitiesForStep(step, result) {
    var visual = (step && step.visual) || null;
    var elements = (result && result.scene && result.scene.elements) || [];
    var ids = [];
    var wanted = namesMentionedInStep(step, result)
      .map(function (name) { return String(name).trim().toLowerCase(); });
    ((visual && (visual.entities || visual.highlight)) || []).forEach(function (name) {
      var clean = String(name).trim().toLowerCase();
      if (clean && wanted.indexOf(clean) < 0) wanted.push(clean);
    });
    elements.forEach(function (element) {
      if (!element || !element.id) return;
      var points = (element.points || []).map(function(p){return String(p).toLowerCase();});
      if (wanted.some(function (name) {
        var target = name.replace(/^(平面|线段|直线|点)/, '').replace(/[₁₂₃]/g,function(c){return {'₁':'1','₂':'2','₃':'3'}[c]});
        return target === String(element.id).toLowerCase() || target === String(element.point || '').toLowerCase()
          || points.length >= 2 && (target === points.join('') || target === points.slice().reverse().join(''));
      })) ids.push(element.id);
    });
    entitiesFromLabels(step, result).forEach(function (id) {
      if (ids.indexOf(id) < 0) ids.push(id);
    });
    var dimensionPoints = dimensionPointsForStep(step, result);
    if (dimensionPoints.length === 2) elements.forEach(function(element){
      if(element?.type === 'segment' && element.points?.length === 2 && element.points.every(function(p){return dimensionPoints.indexOf(p)>=0;}) && ids.indexOf(element.id)<0) ids.push(element.id);
    });
    // No type-wide fallback: an unmapped name must not light up every plane/point.
    return ids.slice(0, 12);
  }

  var state = {container: null, readout: null};

  function clear() {
    if (state.readout) state.readout.remove();
    var controller = state.container && state.container.__geometryController;
    if (controller) { try { controller.restoreOpacity(); } catch (error) {} }
    state.readout = null;
    state.container = null;
    state.lastIds = [];
  }

  function attach(container) {
    ensureStyle();
    clear();
    state.container = container;
    state.readout = document.createElement('div');
    state.readout.className = 'geo-step-readout';
    state.readout.setAttribute('data-geo-step-readout', '');
    container.appendChild(state.readout);
  }

  /* 页面上当前可见、且已经挂好控制器的 3D 容器 */
  function findStage(caseId) {
    var nodes = document.querySelectorAll('.three-stage, [data-case-three], [data-subproblem-three]');
    var index;
    for (index = 0; index < nodes.length; index += 1) {
      if (caseId && nodes[index].dataset.caseThree !== caseId && nodes[index].closest('[data-mistake-id]')?.dataset.mistakeId !== caseId) continue;
      if (nodes[index].__geometryController && nodes[index].isConnected && nodes[index].offsetParent !== null) return nodes[index];
    }
    for (index = 0; index < nodes.length; index += 1) {
      if (caseId && nodes[index].dataset.caseThree !== caseId && nodes[index].closest('[data-mistake-id]')?.dataset.mistakeId !== caseId) continue;
      if (nodes[index].__geometryController && nodes[index].isConnected) return nodes[index];
    }
    return null;
  }

  /* 公开入口：把一个得分点显示到模型上。
     step 可以直接传得分点对象（含 visual），也可以只传 id（这时只能靠 dimensions 推）。 */
  window.__eduShowStepOnModel = function (step, explicitResult, access) {
    var container = findStage(access && access.caseId);
    var result = explicitResult || (container && container.__geometryResult) || null;
    if (!container) {clear(); return {ok: false, reason: 'NO_MODEL'};}
    if (!container.__geometryController) return {ok: false, reason: 'MODEL_NOT_MOUNTED'};
    if (!result) return {ok: false, reason: 'NO_GEOMETRY_RESULT'};
    if (state.container !== container) attach(container);

    var record=window.__eduStepVisualRecord?.(access&&access.caseId)||{geometryResult:result};
    if(window.__eduTabletGeometry&&!window.__eduTabletGeometry.allowed(record)){clear();return {ok:false,reason:'ACCOUNT_CHANGED'};}
    var contract=window.__eduStepVisualContract;
    var visual=contract?contract.resolveVisual(step?.visual,contract.catalogFor(record),step?.hint):null;
    if(contract&&record.aiRubric?.visualBinding&&!contract.bindingMatches(record.aiRubric.visualBinding,record))visual={mode:'text_only',entityIds:[],hint:'',reason:'题干或模型已变化，旧图形提示已停用。'};
    var ids = visual ? visual.entityIds : entitiesForStep(step, result);
    var values = access && access.completed && access.answerUnlocked && (!visual || visual.mode==='highlight' && step?.visual?.labels?.length) ? valuesForStep(step, result).filter(function(item){
      return (result.scene.dimensions || []).some(function(d){return !d.estimated && d.value != null && display(d.value) === item.value;});
    }) : [];
    state.lastIds = ids;
    try { container.__geometryController.restoreOpacity(); } catch (error) {}
    if (ids.length) {
      try { container.__geometryController.dimExcept(ids); } catch (error) {}
    }
    if (state.readout) {
      state.readout.innerHTML = values.map(function (item) {
        var text = (item.text ? item.text + ' = ' : '') + item.value;
        return '<span class="is-' + item.kind + '">' + escapeHtml(text) + '</span>';
      }).join('');
      if(visual){
        var note=document.createElement('span');note.textContent=visual.hint||visual.reason||'已突出本步相关对象。';state.readout.prepend(note);
        var reset=document.createElement('button');reset.type='button';reset.textContent='恢复完整模型';reset.style.cssText='pointer-events:auto;min-width:44px;min-height:44px';reset.onclick=()=>clear();state.readout.appendChild(reset);
      }
    }
    return {ok: true, highlighted: ids.length, values: values.length};
  };

  window.__eduClearStepOnModel = function () { clear(); return true; };

  window.__eduStepModelDebug = function () {
    return {
      mounted: !!(state.container && state.container.__geometryController),
      readout: state.readout ? state.readout.textContent : '',
      readoutNodes: state.readout ? state.readout.children.length : 0,
      connected: !!(state.container && state.container.isConnected),
      highlighted: (state.lastIds || []).length,
      lastIds: (state.lastIds || []).slice(0, 8),
    };
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch];
    });
  }
})();
