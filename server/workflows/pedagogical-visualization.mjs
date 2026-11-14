/**
 * Teaching-display adapter.  Its interface deliberately accepts verified
 * geometry only and returns references, never replacement coordinates.
 */
const unique = values => [...new Set(values.filter(Boolean))];

const dimensionKind = item => {
  const text = `${item.id || ''} ${item.label || ''}`.toLowerCase();
  if (/radius|半径|\br\s*=/.test(text)) return 'radius';
  if (/diameter|直径/.test(text)) return 'diameter';
  if (/height|高\s|\bh\s*=/.test(text)) return 'height';
  if (/distance|距离|plane-distance|\bd\s*=/.test(text)) return 'distance';
  return 'length';
};

const ANNOTATION_KINDS = new Set(['length', 'angle', 'rightAngle', 'radius', 'diameter', 'height', 'distance', 'parallel', 'perpendicular', 'equalLength', 'midpoint', 'projection', 'center', 'tangentPoint', 'planeLabel', 'sectionLabel', 'arc', 'coordinate', 'unitScale']);
const validPointList = (points, coordinates) => Array.isArray(points)
  && points.length > 0 && points.every(point => Array.isArray(coordinates?.[point]) && coordinates[point].length === 3);
const validRays = (rays, coordinates) => Array.isArray(rays) && rays.length === 2
  && rays.every(ray => validPointList(ray, coordinates) && ray.length === 2 && ray[0] === rays[0][0]);
const validSegments = (segments, coordinates) => Array.isArray(segments) && segments.length > 0
  && segments.every(segment => validPointList(segment, coordinates) && segment.length === 2);

const CHINESE_ORDINALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/* 小问视图必须能当选择器用，所以标签不能是占位符。
   模型经常不给 label，旧实现一律兜底成"当前小问"，结果两个小问的按钮长得一模一样。
   这里按小问序号生成"第（1）问"这样的可区分标签，并保留题目自己给的文字描述。 */
/* 模型常把内部 ID 塞进 query.target：derived-cd-perp-ab、c_parallel_DE_plane_BCC1B1、q1。
   这些都不能展示给学生看。可读文字在 query.quote 里。 */
function looksLikeInternalId(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (/^[a-z]{0,3}\d+$/i.test(value)) return true;
  if (/^(derived|fact|query|constraint|relation|ev|entity)[-_]/i.test(value)) return true;
  if (/^c[-_]/i.test(value)) return true;
  const hasChinese = /[\u4e00-\u9fff]/.test(value);
  const hasMath = /[=+\-×÷⊥∥∠△√π°′″]/u.test(value);
  if (!hasChinese && !hasMath && /^[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)+$/.test(value)) return true;
  return false;
}

function subproblemLabel(item, index, query) {
  const own = String(item?.label || '').trim();
  const target = String(query?.target || '').trim();
  const readableTarget = looksLikeInternalId(target) ? '' : target;
  const title = String(item?.title || '').trim()
    || String(query?.quote || '').trim()
    || readableTarget;
  // 模型自带的、且不是占位符的标签优先，但要补上序号，否则仍然分不清。
  const descriptive = own && own !== '当前小问' && own !== '小问' && !looksLikeInternalId(own);
  if (descriptive) return `第（${index + 1}）问 · ${own}`.slice(0, 80);
  if (title) return `第（${index + 1}）问 · ${title}`.slice(0, 80);
  return `第（${CHINESE_ORDINALS[index] || index + 1}）问`;
}

/* 把小问视图和小问查询严格对齐。
   模型给的 queryId 不可靠（实测常缺失），所以以 geometryIR.queries 的顺序为准；
   模型确实给了能对上的 queryId 时优先按它匹配，避免顺序被改动后错位。 */
function buildSubproblemViews(displayPlan, queries, knownRefs, annotations) {
  const planned = Array.isArray(displayPlan.subproblemVisualization) ? displayPlan.subproblemVisualization : [];
  const byQueryId = new Map();
  for (const item of planned) {
    const id = String(item?.queryId || '').trim();
    if (id && !byQueryId.has(id)) byQueryId.set(id, item);
  }
  const fallbackView = (query, index) => ({
    id: `query-view-${index + 1}`,
    queryId: String(query?.id || `query-${index + 1}`),
    label: subproblemLabel(null, index, query),
    highlightEntities: collectQueryEntityRefs(query, knownRefs),
    annotationIds: []
  });
  const aligned = queries.map((query, index) => {
    const plannedForQuery = byQueryId.get(String(query?.id || '')) || planned[index];
    // 过滤掉指向不存在实体的引用，否则渲染器会因为一个坏引用整块丢弃该小问。
    const highlights = (Array.isArray(plannedForQuery?.highlightEntities) ? plannedForQuery.highlightEntities : [])
      .filter(ref => knownRefs.has(ref));
    return {
      id: String(plannedForQuery?.id || `query-view-${index + 1}`),
      queryId: String(query?.id || plannedForQuery?.queryId || `query-${index + 1}`),
      label: subproblemLabel(plannedForQuery, index, query),
      highlightEntities: highlights.length ? highlights : collectQueryEntityRefs(query, knownRefs),
      annotationIds: Array.isArray(plannedForQuery?.annotationIds)
        ? plannedForQuery.annotationIds.filter(id => annotations.some(annotation => annotation.id === id || annotation.id === `ai-${id}`))
        : []
    };
  });
  // 没有 queries 时退回模型自己给的视图，只补齐标签。
  if (!aligned.length) {
    return planned
      .filter(item => Array.isArray(item?.highlightEntities) && item.highlightEntities.every(ref => knownRefs.has(ref)))
      .map((item, index) => ({
        id: String(item.id || `subproblem-${index + 1}`),
        queryId: item.queryId ? String(item.queryId) : '',
        label: subproblemLabel(item, index, null),
        highlightEntities: item.highlightEntities,
        annotationIds: Array.isArray(item.annotationIds) ? item.annotationIds.filter(id => annotations.some(annotation => annotation.id === id || annotation.id === `ai-${id}`)) : []
      }));
  }
  return aligned;
}

/* 从小问的目标里挑出模型已经画出来的实体，作为高亮兜底。 */
function collectQueryEntityRefs(query, knownRefs) {
  const refs = [];
  const visit = item => {
    if (typeof item === 'string') {
      if (knownRefs.has(item) && !refs.includes(item)) refs.push(item);
      return;
    }
    if (Array.isArray(item)) return item.forEach(visit);
    if (item && typeof item === 'object') Object.values(item).forEach(visit);
  };
  visit(query?.target ?? query);
  return refs;
}

export function buildPedagogicalVisualization({scene = {}, coordinates = {}, query = {}, verification = {}, displayPlan = {}, queries = []} = {}) {
  const elements = Array.isArray(scene.elements) ? scene.elements : [];
  const annotations = [];
  const emphasis = {faces: [], sections: [], boundaries: [], lines: [], points: [], distanceMarkers: []};
  const addAnnotation = item => {
    if (item.points && !validPointList(item.points, coordinates)) return;
    annotations.push(item);
  };
  const queryLine = validPointList(scene.queryLine, coordinates) ? scene.queryLine : null;
  const queryPlane = validPointList(scene.queryPlane, coordinates) && scene.queryPlane.length >= 3 ? scene.queryPlane : null;

  if (queryLine) emphasis.lines.push({id: 'focus-query-line', kind: 'line', entityRefs: queryLine, layer: 'focus', priority: 100});
  if (queryPlane) {
    emphasis.faces.push({id: 'focus-query-plane', kind: 'plane', entityRefs: queryPlane, layer: 'focus', priority: 96});
    addAnnotation({id: 'label-query-plane', kind: 'planeLabel', entityRefs: queryPlane, points: queryPlane, label: `平面 ${queryPlane.join('')}`, layer: 'focus', priority: 94});
  }

  const sphere = elements.find(element => element.type === 'sphere');
  const sections = elements.filter(element => element.type === 'section-circle');
  const isSectionQuery = Boolean(sphere && sections.length) || /section|截面|中心距|distance/i.test(`${query?.kind || query?.type || ''} ${query?.target || ''}`);
  if (sphere && isSectionQuery) {
    emphasis.faces.push({id: 'semantic-sphere-body', kind: 'body', semanticRole: 'sphereBody', entityRefs: [sphere.id], layer: 'base', priority: 45});
    if (sphere.center && coordinates[sphere.center]) emphasis.points.push({id: 'semantic-sphere-center', kind: 'point', semanticRole: 'sphereCenter', entityRefs: [sphere.center], layer: 'focus', priority: 98});
  }

  for (const element of elements) {
    if (element.type === 'section-polygon' && validPointList(element.points, coordinates) && element.points.length >= 3) {
      emphasis.faces.push({id:`plane-${element.id}`,kind:'plane',semanticRole:'sectionPlane',entityRefs:[element.id],layer:'section-plane',priority:62,visible:false});
      emphasis.sections.push({id:`polygon-${element.id}`,kind:'section',semanticRole:'sectionPolygon',entityRefs:[element.id],points:[...element.points],layer:'sections',priority:96});
      emphasis.boundaries.push({id:`boundary-${element.id}`,kind:'boundary',semanticRole:'sectionBoundary',entityRefs:[element.id],points:[...element.points],layer:'sections',priority:100});
      addAnnotation({id:`label-${element.id}`,kind:'sectionLabel',entityRefs:[element.id],points:[element.points[0]],label:'截面',layer:'sections',priority:88});
    }
    if (element.type === 'section-circle') {
      emphasis.faces.push({id: `plane-${element.id}`, kind: 'plane', semanticRole: 'sectionPlane', entityRefs: [element.id], layer: 'section-plane', priority: 62, visible: false});
      emphasis.sections.push({id: `disk-${element.id}`, kind: 'section', semanticRole: 'sectionDisk', entityRefs: [element.id], layer: 'sections', priority: 96});
      emphasis.boundaries.push({id: `boundary-${element.id}`, kind: 'boundary', semanticRole: 'sectionBoundary', entityRefs: [element.id], layer: 'sections', priority: 100});
      if (element.center && coordinates[element.center]) {
        emphasis.points.push({id: `point-${element.id}`, kind: 'point', semanticRole: 'sectionCenter', entityRefs: [element.center], layer: 'focus', priority: 99});
        addAnnotation({id: `label-${element.id}`, kind: 'sectionLabel', entityRefs: [element.center], points: [element.center], label: '截面圆', layer: 'sections', priority: 88});
        addAnnotation({id: `center-${element.id}`, kind: 'center', entityRefs: [element.center], points: [element.center], label: '截面圆心', layer: isSectionQuery ? 'focus' : 'relations', priority: 86});
      }
    }
    if (element.type === 'sphere' || element.type === 'cylinder' || element.type === 'cone') {
      const center = element.center || element.baseCenter;
      if (center && coordinates[center]) addAnnotation({id: `center-${element.id}`, kind: 'center', entityRefs: [center], points: [center], label: element.type === 'sphere' ? '球心' : '圆心', layer: element.type === 'sphere' && isSectionQuery ? 'focus' : 'relations', priority: 76});
    }
  }

  const requestedHighlights = unique((displayPlan.subproblemVisualization || []).flatMap(item => item.highlightEntities || []));
  for (const ref of requestedHighlights) {
    const element = elements.find(item => item.id === ref || item.point === ref);
    if (!element) continue;
    if (element.type === 'segment') emphasis.lines.push({id: `query-focus-${ref}`, kind: 'line', semanticRole: 'queryLine', entityRefs: [ref], points: element.points, layer: 'focus', priority: 100, unverified: true});
    else if (element.type === 'plane' || element.type === 'polyhedron-face') emphasis.faces.push({id: `query-focus-${ref}`, kind: 'plane', semanticRole: 'queryPlane', entityRefs: [ref], points: element.points, layer: 'focus', priority: 98, unverified: true});
    else if (element.type === 'point') emphasis.points.push({id: `query-focus-${ref}`, kind: 'point', semanticRole: 'queryPoint', entityRefs: [ref], layer: 'focus', priority: 99, unverified: true});
  }

  for (const item of scene.dimensions || []) {
    if (!validPointList(item.points, coordinates)) continue;
    const kind = dimensionKind(item);
    addAnnotation({id: `dimension-${item.id}`, kind, entityRefs: item.points, points: item.points, label: item.label, valueSource: item.valueSource, layer: 'dimensions', priority: 90});
    if (isSectionQuery && kind === 'distance') {
      const matchingLine = elements.find(element => element.type === 'segment' && Array.isArray(element.points)
        && element.points.length === item.points.length && element.points.every((point, index) => point === item.points[index]));
      emphasis.lines.push({id: `line-${item.id}`, kind: 'line', semanticRole: 'centerToSectionDistance', entityRefs: matchingLine ? [matchingLine.id] : item.points, points: item.points, layer: 'focus', priority: 100});
      emphasis.distanceMarkers.push({id: `marker-${item.id}`, kind: 'distance', semanticRole: 'centerToSectionDistance', entityRefs: matchingLine ? [matchingLine.id] : item.points, points: item.points, label: item.label, layer: 'dimensions', priority: 100});
    }
  }
  const constructionIds = elements.filter(item => item.role === 'verified-construction' || item.style === 'construction').map(item => item.id);
  const verificationRefs = (verification.checks || []).filter(item => item.pass).map(item => item.constraintId);
  const knownRefs = new Set([...Object.keys(coordinates), ...elements.map(item => item.id)]);
  const verifiedConstraintRefs = new Set(verificationRefs);
  const displayOnlyConstraintRefs = new Set(verification.displayOnlyConstraintRefs || []);
  for (const candidate of displayPlan.annotations || []) {
    const entityRefs = Array.isArray(candidate.entityRefs) ? candidate.entityRefs : [];
    const constraintRefs = Array.isArray(candidate.constraintRefs) ? candidate.constraintRefs : [];
    if (!ANNOTATION_KINDS.has(candidate.kind) || !entityRefs.length || !entityRefs.every(ref => knownRefs.has(ref)) || !constraintRefs.every(ref => verifiedConstraintRefs.has(ref) || displayOnlyConstraintRefs.has(ref))) continue;
    const points = Array.isArray(candidate.points) ? candidate.points : entityRefs.filter(ref => coordinates[ref]);
    if (!validPointList(points, coordinates)) continue;
    const geometry = {};
    if (validRays(candidate.rays, coordinates)) geometry.rays = candidate.rays.map(ray => [...ray]);
    if (validSegments(candidate.segments, coordinates)) geometry.segments = candidate.segments.map(segment => [...segment]);
    if (candidate.center && coordinates[candidate.center]) geometry.center = candidate.center;
    addAnnotation({id: `ai-${candidate.id || annotations.length}`, kind: candidate.kind, entityRefs, points, constraintRefs, label: String(candidate.label || ''), layer: candidate.layer || 'relations', priority: Number(candidate.priority || 70), unverified: constraintRefs.some(ref => !verifiedConstraintRefs.has(ref)), ...geometry});
  }
  return {
    schemaVersion: 'pedagogical-visualization/v3',
    emphasis,
    annotations,
    constructionLayers: constructionIds.length ? [{id: 'verified-constructions', semanticRole: 'auxiliaryConstructions', elementIds: constructionIds, constraintRefs: verificationRefs, visible: false}] : [],
    subproblemViews: buildSubproblemViews(displayPlan, Array.isArray(queries) ? queries : [], knownRefs, annotations),
    visibilityRules: {defaultVisibleLayers: ['focus', 'dimensions', 'sections'], optionalLayers: ['relations', 'constructions', 'section-plane']},
    visibilitySequence: Array.isArray(displayPlan.visibilitySequence) && displayPlan.visibilitySequence.length ? displayPlan.visibilitySequence : [
      {id: 'base-structure', layers: ['base'], visible: true},
      {id: 'current-focus', layers: ['focus'], visible: true},
      {id: 'math-annotations', layers: ['dimensions'], visible: true}
    ],
    styleHints: {
      priorityOrder: ['focus', 'constructions', 'known', 'base'], inactiveOpacity: 0.22, labelFacing: 'camera',
      semanticStyles: {
        sphereBody: {preserveBaseMaterial: true}, sectionPlane: {color: '#6f8374', opacity: 0.12, visible: false},
        sectionDisk: {color: '#315a67', opacity: 0.38},
        sectionBoundary: {color: '#b7653d', opacity: 1, lineStyle: 'solid'},
        sphereCenter: {color: '#315a67', markerScale: 1.7}, sectionCenter: {color: '#b7653d', markerScale: 1.8},
        centerToSectionDistance: {color: '#b7653d', opacity: 1, lineWidth: 2}
      }
    },
    query: {kind: query?.kind || query?.type || 'unknown', target: query?.target || null},
    referencedConstraintIds: unique(verificationRefs)
  };
}
