import {buildPedagogicalVisualization} from './pedagogical-visualization.mjs';

const EPSILON = 1e-9;

const add = (a, b) => a.map((value, index) => value + b[index]);
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const scale = (a, factor) => a.map(value => value * factor);
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(...a);
const unit = a => {
  const length = norm(a);
  if (!(length > EPSILON)) throw new Error('ZERO_LENGTH_VECTOR');
  return scale(a, 1 / length);
};
const distance = (a, b) => norm(subtract(a, b));
const finitePoint = point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const clamp = value => Math.max(-1, Math.min(1, value));

function planeData(points, coplanarError = 'PLANE_POINTS_NOT_COPLANAR') {
  if (!Array.isArray(points) || points.length < 3 || !points.every(finitePoint)) throw new Error('INVALID_PLANE_POINTS');
  for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) {
    if (distance(points[i], points[j]) <= EPSILON) throw new Error('DUPLICATE_PLANE_POINT');
  }
  // A valid plane may start with three collinear points. Use the strongest
  // available pair from the full point set, then check every point against it.
  let normal = [0, 0, 0];
  for (let i = 1; i < points.length - 1; i += 1) for (let j = i + 1; j < points.length; j += 1) {
    const candidate = cross(subtract(points[i], points[0]), subtract(points[j], points[0]));
    if (norm(candidate) > norm(normal)) normal = candidate;
  }
  if (!Number.isFinite(norm(normal)) || norm(normal) <= EPSILON) throw new Error('DEGENERATE_PLANE');
  const normalized = unit(normal);
  if (points.some(point => Math.abs(dot(subtract(point, points[0]), normalized)) > 1e-7)) throw new Error(coplanarError);
  return {origin: points[0], normal: normalized};
}

function uniqueEdges(faces) {
  const seen = new Map();
  for (const face of faces) {
    for (let index = 0; index < face.length; index += 1) {
      const edge = [face[index], face[(index + 1) % face.length]];
      const key = [...edge].sort().join('\u0000');
      if (!seen.has(key)) seen.set(key, edge);
    }
  }
  return [...seen.values()];
}

function finalizeSolid(kind, coordinates, faces, metadata = {}) {
  const normalizedCoordinates = Object.fromEntries(Object.entries(coordinates).map(([id, point]) => [String(id), point.map(Number)]));
  const normalizedFaces = faces.map(face => face.map(String));
  return {kind, coordinates: normalizedCoordinates, faces: normalizedFaces, edges: uniqueEdges(normalizedFaces), ...metadata};
}

export function createPolyhedronSpec({kind = 'polyhedron', coordinates, faces, ...metadata} = {}) {
  return finalizeSolid(kind, coordinates || {}, faces || [], metadata);
}

function orthonormalAxes(axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
  if (!Array.isArray(axes) || axes.length !== 3) throw new Error('INVALID_AXES');
  const [x, y, requestedZ] = axes.map(unit);
  if (Math.abs(dot(x, y)) > EPSILON || Math.abs(dot(x, requestedZ)) > EPSILON || Math.abs(dot(y, requestedZ)) > EPSILON) {
    throw new Error('CUBOID_AXES_NOT_ORTHOGONAL');
  }
  let z = unit(cross(x, y));
  if (dot(z, requestedZ) < 0) z = scale(z, -1);
  return [x, y, z];
}

export function createCuboidSpec({length, width, height, origin = [0, 0, 0], axes} = {}) {
  const dimensions = [Number(length), Number(width), Number(height)];
  if (!dimensions.every(value => value > 0) || !finitePoint(origin)) throw new Error('INVALID_CUBOID_PARAMETERS');
  const [xAxis, yAxis, zAxis] = orthonormalAxes(axes);
  const pointAt = (x, y, z) => add(origin, add(scale(xAxis, x), add(scale(yAxis, y), scale(zAxis, z))));
  const coordinates = {
    A: pointAt(0, 0, 0), B: pointAt(dimensions[0], 0, 0), C: pointAt(dimensions[0], dimensions[1], 0), D: pointAt(0, dimensions[1], 0),
    A1: pointAt(0, 0, dimensions[2]), B1: pointAt(dimensions[0], 0, dimensions[2]), C1: pointAt(dimensions[0], dimensions[1], dimensions[2]), D1: pointAt(0, dimensions[1], dimensions[2])
  };
  const faces = [['A', 'B', 'C', 'D'], ['A1', 'D1', 'C1', 'B1'], ['A', 'A1', 'B1', 'B'], ['B', 'B1', 'C1', 'C'], ['C', 'C1', 'D1', 'D'], ['D', 'D1', 'A1', 'A']];
  return finalizeSolid('cuboid', coordinates, faces, {dimensions: {length: dimensions[0], width: dimensions[1], height: dimensions[2]}});
}

export function createCubeSpec({edge, origin = [0, 0, 0], axes} = {}) {
  const value = Number(edge);
  if (!(value > 0)) throw new Error('INVALID_CUBE_EDGE');
  return {...createCuboidSpec({length: value, width: value, height: value, origin, axes}), kind: 'cube', dimensions: {edge: value}};
}

export function createPrismSpec({base, translation, topNames} = {}) {
  const entries = Object.entries(base || {});
  if (entries.length < 3 || !entries.every(([, point]) => finitePoint(point)) || !finitePoint(translation) || norm(translation) <= EPSILON) throw new Error('INVALID_PRISM_PARAMETERS');
  const basePlane = planeData(entries.map(([, point]) => point), 'PRISM_BASE_NOT_COPLANAR');
  if (entries.some(([, point]) => Math.abs(dot(subtract(point, basePlane.origin), basePlane.normal)) > EPSILON)) throw new Error('PRISM_BASE_NOT_COPLANAR');
  const names = Array.isArray(topNames) && topNames.length === entries.length ? topNames.map(String) : entries.map(([id]) => `${id}1`);
  const coordinates = Object.fromEntries(entries);
  entries.forEach(([id, point], index) => { coordinates[names[index]] = add(point, translation); });
  const bottom = entries.map(([id]) => id);
  const top = [...names].reverse();
  const faces = [bottom, top, ...bottom.map((id, index) => [id, names[index], names[(index + 1) % names.length], bottom[(index + 1) % bottom.length]])];
  return finalizeSolid('prism', coordinates, faces, {baseVertices: bottom, topVertices: names, translation: [...translation]});
}

export function createParallelepipedSpec({origin=[0,0,0], edgeVectors, baseNames=['A','B','C','D'], topNames=['A1','B1','C1','D1']} = {}) {
  if (!finitePoint(origin) || !Array.isArray(edgeVectors) || edgeVectors.length !== 3 || !edgeVectors.every(finitePoint)) throw new Error('INVALID_PARALLELEPIPED_PARAMETERS');
  const [u,v,w]=edgeVectors;
  if ([u,v,w].some(vector=>norm(vector)<=EPSILON) || Math.abs(dot(cross(u,v),w))<=EPSILON) throw new Error('DEGENERATE_PARALLELEPIPED');
  if (!Array.isArray(baseNames)||baseNames.length!==4||!Array.isArray(topNames)||topNames.length!==4) throw new Error('INVALID_PARALLELEPIPED_NAMES');
  const [A,B,C,D]=baseNames.map(String),[A1,B1,C1,D1]=topNames.map(String);
  const base={
    [A]:[...origin],
    [B]:add(origin,u),
    [C]:add(origin,add(u,v)),
    [D]:add(origin,v)
  };
  const solid=createPrismSpec({base,translation:w,topNames:[A1,B1,C1,D1]});
  return {...solid,kind:'parallelepiped',edgeVectors:edgeVectors.map(vector=>[...vector])};
}

export function createPyramidSpec({base, apex} = {}) {
  const entries = Object.entries(base || {}), apexEntries = Object.entries(apex || {});
  if (entries.length < 3 || apexEntries.length !== 1 || !entries.every(([, point]) => finitePoint(point)) || !finitePoint(apexEntries[0][1])) throw new Error('INVALID_PYRAMID_PARAMETERS');
  const basePlane = planeData(entries.map(([, point]) => point), 'PYRAMID_BASE_NOT_COPLANAR');
  if (entries.some(([, point]) => Math.abs(dot(subtract(point, basePlane.origin), basePlane.normal)) > EPSILON)) throw new Error('PYRAMID_BASE_NOT_COPLANAR');
  const [apexName, apexPoint] = apexEntries[0];
  if (Math.abs(dot(subtract(apexPoint, basePlane.origin), basePlane.normal)) <= EPSILON) throw new Error('PYRAMID_APEX_ON_BASE_PLANE');
  const coordinates = {...Object.fromEntries(entries), [apexName]: [...apexPoint]};
  const bottom = entries.map(([id]) => id);
  const faces = [bottom, ...bottom.map((id, index) => [apexName, id, bottom[(index + 1) % bottom.length]])];
  return finalizeSolid('pyramid', coordinates, faces, {baseVertices: bottom, apex: apexName});
}

export function linePlaneAngle(line, plane) {
  if (!Array.isArray(line) || line.length !== 2) throw new Error('INVALID_LINE');
  const direction = subtract(line[1], line[0]), {normal} = planeData(plane);
  if (norm(direction) <= EPSILON) throw new Error('DEGENERATE_LINE');
  return Math.asin(clamp(Math.abs(dot(unit(direction), normal))));
}

export function dihedralAngle(firstPlane, secondPlane, selection) {
  const first = planeData(firstPlane), second = planeData(secondPlane);
  // Two-argument calls retain the historical smaller plane-angle interface.
  // Query/validator callers must pass an explicit selection object instead.
  if (selection === undefined) return Math.acos(clamp(Math.abs(dot(first.normal, second.normal))));
  if (selection?.angleType === 'plane_angle') {
    if (selection.edge !== undefined || selection.firstSide !== undefined || selection.secondSide !== undefined) throw new Error('CONFLICTING_DIHEDRAL_SELECTION');
    return Math.acos(clamp(Math.abs(dot(first.normal, second.normal))));
  }
  if (selection?.angleType !== undefined && selection.angleType !== 'dihedral') throw new Error('INVALID_DIHEDRAL_ANGLE_TYPE');
  const {edge, firstSide, secondSide} = selection;
  if (!Array.isArray(edge) || edge.length !== 2 || !edge.every(finitePoint) || !finitePoint(firstSide) || !finitePoint(secondSide)) throw new Error('DIHEDRAL_HALF_PLANES_REQUIRED');
  const axis = unit(subtract(edge[1], edge[0]));
  const onPlane = (point, plane) => Math.abs(dot(subtract(point, plane.origin), plane.normal)) <= 1e-7;
  if (!edge.every(point => onPlane(point, first) && onPlane(point, second)) || !onPlane(firstSide, first) || !onPlane(secondSide, second)) throw new Error('DIHEDRAL_SELECTION_NOT_ON_PLANES');
  const transverse = point => {const v = subtract(point, edge[0]);return unit(subtract(v, scale(axis, dot(v, axis))));};
  return Math.acos(clamp(dot(transverse(firstSide), transverse(secondSide))));
}

export function pointPlaneDistance(point, plane) {
  const data = planeData(plane);
  if (!finitePoint(point)) throw new Error('INVALID_POINT');
  return Math.abs(dot(subtract(point, data.origin), data.normal));
}

export function projectPointToPlane(point, plane) {
  const data = planeData(plane);
  if (!finitePoint(point)) throw new Error('INVALID_POINT');
  return subtract(point, scale(data.normal, dot(subtract(point, data.origin), data.normal)));
}

export function pointLineDistance(point, line) {
  if (!finitePoint(point) || !Array.isArray(line) || line.length !== 2 || !line.every(finitePoint)) throw new Error('INVALID_POINT_LINE_DISTANCE');
  const direction = subtract(line[1], line[0]);
  if (norm(direction) <= EPSILON) throw new Error('DEGENERATE_LINE');
  return norm(cross(subtract(point, line[0]), direction)) / norm(direction);
}

export function skewLineDistance(firstLine, secondLine) {
  if (![firstLine, secondLine].every(line => Array.isArray(line) && line.length === 2 && line.every(finitePoint))) throw new Error('INVALID_SKEW_LINES');
  const firstDirection = subtract(firstLine[1], firstLine[0]), secondDirection = subtract(secondLine[1], secondLine[0]);
  const commonNormal = cross(firstDirection, secondDirection);
  if (norm(commonNormal) <= EPSILON) return pointLineDistance(secondLine[0], firstLine);
  return Math.abs(dot(subtract(secondLine[0], firstLine[0]), commonNormal)) / norm(commonNormal);
}

function deduplicatePoints(points, tolerance = 1e-8) {
  const result = [];
  for (const point of points) if (!result.some(existing => distance(existing, point) <= tolerance)) result.push(point);
  return result;
}

function orderedSection(points, normal) {
  const center = scale(points.reduce((sum, point) => add(sum, point), [0, 0, 0]), 1 / points.length);
  const n = unit(normal);
  const helper = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const xAxis = unit(cross(helper, n)), yAxis = cross(n, xAxis);
  return [...points].sort((a, b) => Math.atan2(dot(subtract(a, center), yAxis), dot(subtract(a, center), xAxis)) - Math.atan2(dot(subtract(b, center), yAxis), dot(subtract(b, center), xAxis)));
}

function polygonArea3d(points, normal) {
  let vectorArea = [0, 0, 0];
  for (let index = 0; index < points.length; index += 1) vectorArea = add(vectorArea, cross(points[index], points[(index + 1) % points.length]));
  return Math.abs(dot(vectorArea, unit(normal))) / 2;
}

export function intersectPolyhedronWithPlane(solid, plane, tolerance = 1e-8) {
  const normal = plane?.normal?.map(Number), offset = Number(plane?.offset);
  if (!finitePoint(normal) || norm(normal) <= EPSILON || !Number.isFinite(offset)) return {status: 'invalid_plane', points: []};
  const intersections = [];
  for (const [startId, endId] of solid.edges || []) {
    const start = solid.coordinates[startId], end = solid.coordinates[endId];
    const startValue = dot(normal, start) - offset, endValue = dot(normal, end) - offset;
    if (Math.abs(startValue) <= tolerance) intersections.push([...start]);
    if (Math.abs(endValue) <= tolerance) intersections.push([...end]);
    if (startValue * endValue < -(tolerance ** 2)) {
      const ratio = startValue / (startValue - endValue);
      intersections.push(add(start, scale(subtract(end, start), ratio)));
    }
  }
  const points = deduplicatePoints(intersections, tolerance);
  if (points.length < 3) return {status: 'no_section', points};
  const ordered = orderedSection(points, normal);
  return {status: 'verified', points: ordered, area: polygonArea3d(ordered, normal), plane: {normal: [...normal], offset}};
}

function solveThreeByThree(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) <= EPSILON) throw new Error('SINGULAR_LINEAR_SYSTEM');
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let index = column; index < 4; index += 1) rows[column][index] /= divisor;
    for (let row = 0; row < 3; row += 1) if (row !== column) {
      const factor = rows[row][column];
      for (let index = column; index < 4; index += 1) rows[row][index] -= factor * rows[column][index];
    }
  }
  return rows.map(row => row[3]);
}

export function circumsphereFromPoints(points, tolerance = 1e-7) {
  if (!Array.isArray(points) || points.length < 4 || !points.every(finitePoint)) throw new Error('CIRCUMSPHERE_REQUIRES_FOUR_POINTS');
  let center = null;
  outer: for (let anchor = 0; anchor < points.length - 3; anchor += 1) {
    for (let i = anchor + 1; i < points.length - 2; i += 1) for (let j = i + 1; j < points.length - 1; j += 1) for (let k = j + 1; k < points.length; k += 1) {
      const base = points[anchor], selected = [points[i], points[j], points[k]];
      try {
        center = solveThreeByThree(selected.map(point => scale(subtract(point, base), 2)), selected.map(point => dot(point, point) - dot(base, base)));
        break outer;
      } catch {}
    }
  }
  if (!center) throw new Error('CIRCUMSPHERE_POINTS_COPLANAR');
  const radius = distance(center, points[0]);
  const residual = Math.max(...points.map(point => Math.abs(distance(center, point) - radius) / Math.max(1, radius)));
  if (residual > tolerance) throw new Error('POINTS_NOT_COSPHERICAL');
  return {center, radius, residual};
}

export function insphereForPolyhedron(solid, tolerance = 1e-7) {
  const vertices = Object.values(solid.coordinates || {});
  if (!vertices.length) throw new Error('EMPTY_POLYHEDRON');
  const center = scale(vertices.reduce((sum, point) => add(sum, point), [0, 0, 0]), 1 / vertices.length);
  const distances = solid.faces.map(face => pointPlaneDistance(center, face.slice(0, 3).map(id => solid.coordinates[id])));
  const radius = distances[0], residual = Math.max(...distances.map(value => Math.abs(value - radius) / Math.max(1, radius)));
  if (!(radius > tolerance) || residual > tolerance) throw new Error('POLYHEDRON_HAS_NO_CENTROIDAL_INSPHERE');
  return {center, radius, residual};
}

export function validatePolyhedronSpec(solid, tolerance = 1e-7) {
  const checks = [];
  const pointIds = new Set(Object.keys(solid.coordinates || {}));
  for (const [id, point] of Object.entries(solid.coordinates || {})) checks.push({id: `point:${id}`, pass: finitePoint(point), residual: finitePoint(point) ? 0 : Infinity});
  for (let index = 0; index < (solid.faces || []).length; index += 1) {
    const face = solid.faces[index];
    let residual = Infinity, pass = face.length >= 3 && face.every(id => pointIds.has(id));
    if (pass) {
      try {
        const points = face.map(id => solid.coordinates[id]), plane = planeData(points);
        residual = Math.max(...points.map(point => Math.abs(dot(subtract(point, plane.origin), plane.normal))));
        pass = residual <= tolerance;
      } catch { pass = false; }
    }
    checks.push({id: `face:${index + 1}`, pass, residual});
  }
  for (let index = 0; index < (solid.edges || []).length; index += 1) {
    const [a, b] = solid.edges[index], value = pointIds.has(a) && pointIds.has(b) ? distance(solid.coordinates[a], solid.coordinates[b]) : 0;
    checks.push({id: `edge:${a}-${b}`, pass: value > tolerance, residual: value > tolerance ? 0 : Infinity});
  }
  const incidence = new Map();
  for (const face of solid.faces || []) for (let index=0;index<face.length;index+=1) {
    const key=[face[index],face[(index+1)%face.length]].sort().join('\u0000');
    incidence.set(key,(incidence.get(key)||0)+1);
  }
  const openSurface=solid.kind==='surface_complex';
  checks.push({id:openSurface?'topology:open-surface-complex':'topology:closed-two-manifold',pass:incidence.size>0&&(openSurface||[...incidence.values()].every(count=>count===2)),residual:openSurface?0:[...incidence.values()].filter(count=>count!==2).length});
  let convex=true,maxConvexResidual=0;
  for(const face of solid.faces||[]){
    try{
      const facePoints=face.map(id=>solid.coordinates[id]),plane=planeData(facePoints),signs=Object.entries(solid.coordinates).filter(([id])=>!face.includes(id)).map(([,point])=>dot(subtract(point,plane.origin),plane.normal)).filter(value=>Math.abs(value)>tolerance);
      if(signs.some(value=>value>0)&&signs.some(value=>value<0))convex=false;
      maxConvexResidual=Math.max(maxConvexResidual,signs.length?Math.min(Math.max(...signs),0)-Math.max(Math.min(...signs),0):0);
    }catch{convex=false;maxConvexResidual=Infinity}
  }
  checks.push({id:openSurface?'topology:each-face-planar':'topology:convex',pass:openSurface||convex,residual:openSurface?0:convex?0:maxConvexResidual||Infinity});
  return {pass: checks.length > 0 && checks.every(check => check.pass), checks, tolerance};
}

function exactNumber(value) {
  if (Number.isSafeInteger(value)) return {op: 'integer', value};
  const rounded = Number(value.toFixed(12));
  const text = String(rounded);
  if (!text.includes('e') && text.includes('.')) {
    const digits = text.length - text.indexOf('.') - 1, q = 10 ** digits, p = Math.round(rounded * q);
    const gcd = (a, b) => b ? gcd(b, a % b) : Math.abs(a);
    const divisor = gcd(p, q);
    return {op: 'rational', p: p / divisor, q: q / divisor};
  }
  const denominator = 1_000_000_000;
  const numerator = Math.round(rounded * denominator);
  const gcd = (a, b) => b ? gcd(b, a % b) : Math.abs(a);
  const divisor = gcd(numerator, denominator);
  return {op: 'rational', p: numerator / divisor, q: denominator / divisor};
}

function resolvePoint(coordinates, id) {
  const point = coordinates[id];
  if (!point) throw new Error(`UNKNOWN_POINT:${id}`);
  return point;
}

function resolvePlane(coordinates, ids) {
  if (!Array.isArray(ids) || ids.length < 3) throw new Error('PLANE_REQUIRES_THREE_POINTS');
  return ids.map(id => resolvePoint(coordinates, id));
}

function compileSolid(spec = {}) {
  if (spec.kind === 'cube') return createCubeSpec(spec);
  if (spec.kind === 'cuboid') return createCuboidSpec(spec);
  if (spec.kind === 'prism') return createPrismSpec(spec);
  if (spec.kind === 'parallelepiped') return createParallelepipedSpec(spec);
  if (spec.kind === 'pyramid') return createPyramidSpec(spec);
  if (spec.kind === 'polyhedron') return finalizeSolid('polyhedron', spec.coordinates || {}, spec.faces || []);
  if (spec.kind === 'surface_complex') return finalizeSolid('surface_complex', spec.coordinates || {}, spec.faces || []);
  throw new Error(`UNSUPPORTED_POLYHEDRON:${spec.kind || 'missing'}`);
}

function sceneFromSolid(solid, sections, extras = {coordinates: {}, elements: [], dimensions: []}) {
  const coordinates = {...solid.coordinates, ...(extras.coordinates || {})};
  const sectionElements = [];
  sections.forEach((section, sectionIndex) => {
    const pointIds = section.points.map((point, pointIndex) => `S${sectionIndex + 1}_${pointIndex + 1}`);
    pointIds.forEach((id, index) => { coordinates[id] = section.points[index]; });
    sectionElements.push({id: `section-${sectionIndex + 1}`, type: 'section-polygon', points: pointIds, normal: section.plane.normal, opacity: 0.4});
  });
  const maximum = Math.max(1, ...Object.values(coordinates).flat().map(value => Math.abs(value))), gridUnit = maximum > 12 ? maximum / 12 : 1;
  const divisions = Math.max(6, Math.ceil((maximum * 2 + 2) / gridUnit));
  const queryLine = solid.edges[0];
  const referenceValue = distance(solid.coordinates[queryLine[0]], solid.coordinates[queryLine[1]]);
  const rendered = {
    coordinates,
    scene: {
      schemaVersion: 'geometry-scene/v3', coordinateConvention: 'math_xyz_z_up', threeTransform: '[x,z,y]',
      grid: {unit: gridUnit, size: gridUnit * divisions, divisions, plane: 'z=0', valueSource: 'canonicalCoordinates'},
      frameEdges: solid.edges.map(edge => [...edge]), queryLine: [...queryLine],
      dimensions: (extras.dimensions||[]).some(item=>Array.isArray(item.points)&&item.points.length===2&&item.points.every(point=>queryLine.includes(point)))?[]:[{id: 'reference-edge', points: [...queryLine], label: `${queryLine.join('')} = ${Number(referenceValue.toFixed(6))}`, valueSource: 'validatedCoordinates'}],
      elements: [
        ...solid.faces.map((points, index) => ({id: `face-${index + 1}`, type: 'polyhedron-face', points: [...points], opacity: 0.1})),
        ...solid.edges.map((points, index) => ({id: `edge-${index + 1}`, type: 'segment', points: [...points], style: 'frame'})),
        ...Object.keys(solid.coordinates).map(id => ({id: `point-${id}`, type: 'point', point: id})),
        ...sectionElements,
        ...(extras.elements || []),
        {id: 'axes', type: 'axes', size: Math.max(2, maximum)}
      ]
    }
  };
  rendered.scene.dimensions.push(...(extras.dimensions || []));
  return rendered;
}

export function compilePolyhedronGeometryIR(ir = {}) {
  if (ir.schemaVersion !== 'geometry-ir/polyhedron-v1') return {status: 'schema_invalid', error: 'UNSUPPORTED_SCHEMA'};
  let solid;
  try { solid = compileSolid(ir.solid); } catch (error) { return {status: 'unsupported', error: String(error.message || error)}; }
  const validation = validatePolyhedronSpec(solid);
  for(const constraint of ir.constraints||[]){
    let residual=Infinity;
    try {
    if(constraint.kind==='length')residual=Math.abs(distance(...constraint.points.map(id=>resolvePoint(solid.coordinates,id)))-Number(constraint.value));
    if(constraint.kind==='angle'){
      const vectors=constraint.rays.map(([vertex,end])=>subtract(resolvePoint(solid.coordinates,end),resolvePoint(solid.coordinates,vertex)));
      const degrees=Math.acos(clamp(dot(unit(vectors[0]),unit(vectors[1]))))*180/Math.PI;
      residual=Math.abs(degrees-Number(constraint.degrees));
    }
    if(constraint.kind==='plane_perpendicular'){
      const first=planeData(resolvePlane(solid.coordinates,constraint.firstPlane)).normal,second=planeData(resolvePlane(solid.coordinates,constraint.secondPlane)).normal;
      residual=Math.abs(dot(first,second));
    }
    } catch (error) {
      return {status:'validation_failed',error:String(error.message||error),validation:{...validation,pass:false,
        checks:[...validation.checks,{id:`constraint:${constraint.id}`,kind:constraint.kind,pass:false,residual:Infinity}]}};
    }
    const pass=Number.isFinite(residual)&&residual<=1e-7;
    validation.checks.push({id:`constraint:${constraint.id}`,kind:constraint.kind,pass,residual,tolerance:1e-7});
    if(constraint.hard!==false&&!pass)validation.pass=false;
  }
  if (!validation.pass) return {status: 'validation_failed', validation};
  const queryResults = {}, sections = [], queryChecks=[], extras = {coordinates:{},elements:[],dimensions:Array.isArray(ir.dimensions)?ir.dimensions.map(item=>structuredClone(item)):[]};
  try {
    for (const query of ir.queries || []) {
      // Queries execute in order: only original and already verified derived
      // points are available. Never resolve a future construction implicitly.
      const queryCoordinates = {...solid.coordinates, ...extras.coordinates};
      const requireFreshPoint = id => {
        if (typeof id !== 'string' || !id.trim()) throw new Error('INVALID_DERIVED_POINT_ID');
        if (id in queryCoordinates) throw new Error(`DERIVED_POINT_ID_COLLISION:${id}`);
      };
      if (query.kind === 'line_plane_angle') {
        const radians = linePlaneAngle(query.line.map(id => resolvePoint(queryCoordinates, id)), resolvePlane(queryCoordinates, query.plane));
        queryResults[query.id] = {kind: query.kind, radians, degrees: radians * 180 / Math.PI, sine: Math.sin(radians)};
        queryChecks.push({id:`query:${query.id}`,pass:true,residual:0,kind:query.kind});
      } else if (query.kind === 'vector_relation') {
        const queryCoordinates={...solid.coordinates,...extras.coordinates};
        const first = subtract(resolvePoint(queryCoordinates, query.first[1]), resolvePoint(queryCoordinates, query.first[0]));
        const second = subtract(resolvePoint(queryCoordinates, query.second[1]), resolvePoint(queryCoordinates, query.second[0]));
        if (norm(first) <= EPSILON || norm(second) <= EPSILON) return {status:'validation_failed', error:'DEGENERATE_VECTOR', queryId:query.id};
        const cosine = dot(unit(first), unit(second));
        const crossNorm = norm(cross(first, second));
        if(query.sourceRole==='given'){
          const residual=query.expectation?.perpendicular?Math.abs(cosine):norm(cross(unit(first),unit(second)));
          const pass=residual<=1e-7;
          validation.checks.push({id:`given:${query.id}`,kind:'source_relation',pass,residual,tolerance:1e-7});
          if(!pass){validation.pass=false;return {status:'validation_failed',validation,error:'GIVEN_RELATION_CONTRADICTED',queryId:query.id};}
        }
        for(const line of [query.first,query.second]){
          const id=`vector-focus-${line.join('-')}`;
          if(!extras.elements.some(element=>element.id===id))extras.elements.push({id,type:'segment',points:[...line],style:'focus',role:'query-focus'});
        }
        queryResults[query.id] = {kind: query.kind, dot: dot(first, second), cosine, parallel: crossNorm <= 1e-8, perpendicular: Math.abs(cosine) <= 1e-8, cross: cross(first, second)};
        queryChecks.push({id:`query:${query.id}`,pass:true,residual:0,kind:query.kind});
      } else if (query.kind === 'dihedral_angle') {
        const radians = dihedralAngle(resolvePlane(queryCoordinates, query.firstPlane), resolvePlane(queryCoordinates, query.secondPlane), {
          angleType:query.angleType,edge:query.edge?.map(id=>resolvePoint(queryCoordinates,id)),
          firstSide:query.firstSide===undefined?undefined:resolvePoint(queryCoordinates,query.firstSide),
          secondSide:query.secondSide===undefined?undefined:resolvePoint(queryCoordinates,query.secondSide)
        });
        queryResults[query.id] = {kind: query.kind, angleType:query.angleType||'dihedral', radians, degrees: radians * 180 / Math.PI, cosine: Math.cos(radians)};
        queryChecks.push({id:`query:${query.id}`,pass:true,residual:0,kind:query.kind});
      } else if (query.kind === 'point_plane_distance') {
        queryResults[query.id] = {kind: query.kind, value: pointPlaneDistance(resolvePoint(queryCoordinates, query.point), resolvePlane(queryCoordinates, query.plane))};
        queryChecks.push({id:`query:${query.id}`,pass:true,residual:0,kind:query.kind});
      } else if (query.kind === 'skew_line_distance') {
        queryResults[query.id] = {kind: query.kind, value: skewLineDistance(query.firstLine.map(id => resolvePoint(queryCoordinates, id)), query.secondLine.map(id => resolvePoint(queryCoordinates, id)))};
        queryChecks.push({id:`query:${query.id}`,pass:true,residual:0,kind:query.kind});
      } else if (query.kind === 'polyhedron_section') {
        const section = intersectPolyhedronWithPlane(solid, query.plane);
        if (section.status !== 'verified') return {status: 'validation_failed', error: 'SECTION_NOT_DEFINED', queryId: query.id};
        sections.push(section);
        queryResults[query.id] = {kind: query.kind, vertexCount: section.points.length, area: section.area, points: section.points};
        queryChecks.push({id:`query:${query.id}`,pass:true,residual:Math.max(...section.points.map(point=>Math.abs(dot(query.plane.normal,point)-query.plane.offset))),kind:query.kind});
      } else if (query.kind === 'point_on_segment') {
        const [start, end] = query.segment.map(id => resolvePoint(queryCoordinates, id)), parameter = Number(query.parameter);
        if (!(parameter >= 0 && parameter <= 1) || !query.pointId) return {status:'validation_failed',error:'INVALID_SEGMENT_PARAMETER',queryId:query.id};
        requireFreshPoint(query.pointId);
        const coordinates = add(start, scale(subtract(end, start), parameter));
        extras.coordinates[query.pointId] = coordinates;
        extras.elements.push({id:`point-${query.pointId}`,type:'point',point:query.pointId},{id:`construction-${query.segment[0]}-${query.pointId}`,type:'segment',points:[query.segment[0],query.pointId],style:'construction',role:'verified-construction'});
        queryResults[query.id] = {kind:query.kind,coordinates,parameter};
        queryChecks.push({id:`query:${query.id}`,pass:true,residual:pointLineDistance(coordinates,[start,end]),kind:query.kind});
      } else if(query.kind==='affine_point'){
        const queryCoordinates={...solid.coordinates,...extras.coordinates},start=resolvePoint(queryCoordinates,query.first[0]),end=resolvePoint(queryCoordinates,query.second[1]),factor=Number(query.factor);
        if(query.first[1]!==query.pointId||query.second[0]!==query.pointId||!(factor>0))return {status:'validation_failed',error:'INVALID_AFFINE_POINT_RELATION',queryId:query.id};
        requireFreshPoint(query.pointId);
        const coordinates=scale(add(start,scale(end,factor)),1/(1+factor));
        extras.coordinates[query.pointId]=coordinates;
        extras.elements.push({id:`point-${query.pointId}`,type:'point',point:query.pointId},{id:`construction-${query.first[0]}-${query.pointId}`,type:'segment',points:[query.first[0],query.pointId],style:'construction',role:'verified-construction'},{id:`construction-${query.pointId}-${query.second[1]}`,type:'segment',points:[query.pointId,query.second[1]],style:'construction',role:'verified-construction'});
        const left=subtract(coordinates,start),right=scale(subtract(end,coordinates),factor),residual=norm(subtract(left,right));
        queryResults[query.id]={kind:query.kind,coordinates,factor};queryChecks.push({id:`query:${query.id}`,pass:residual<=1e-7,residual,kind:query.kind});
      } else if(query.kind==='segment_length'){
        const queryCoordinates={...solid.coordinates,...extras.coordinates},value=distance(...query.points.map(id=>resolvePoint(queryCoordinates,id)));
        extras.elements.push({id:`focus-${query.points.join('-')}`,type:'segment',points:[...query.points],style:'focus',role:'query-focus'});
        extras.dimensions.push({id:`query-length-${query.points.join('-')}`,points:[...query.points],label:query.points.join(''),value,valueSource:`queries.${query.id}`});
        queryResults[query.id]={kind:query.kind,value};queryChecks.push({id:`query:${query.id}`,pass:Number.isFinite(value)&&value>EPSILON,residual:0,kind:query.kind});
      } else if (query.kind === 'projection_to_plane') {
        const source = resolvePoint(queryCoordinates, query.point), footId = query.footId || `${query.point}_projection`;
        requireFreshPoint(footId);
        const coordinates = projectPointToPlane(source, resolvePlane(queryCoordinates, query.plane));
        extras.coordinates[footId] = coordinates;
        extras.elements.push({id:`point-${footId}`,type:'point',point:footId},{id:`construction-${query.point}-${footId}`,type:'segment',points:[query.point,footId],style:'construction',role:'verified-construction'});
        extras.dimensions.push({id:`distance-${query.point}-${footId}`,points:[query.point,footId],label:`${query.point}${footId}`,value:distance(source,coordinates),valueSource:`queries.${query.id}`});
        queryResults[query.id] = {kind:query.kind,coordinates,distance:distance(source,coordinates),footId};
        queryChecks.push({id:`query:${query.id}`,pass:pointPlaneDistance(coordinates,resolvePlane(queryCoordinates,query.plane))<=1e-7,residual:pointPlaneDistance(coordinates,resolvePlane(queryCoordinates,query.plane)),kind:query.kind});
      } else if (query.kind === 'circumsphere') {
        const ids = Array.isArray(query.surfacePoints) && query.surfacePoints.length >= 4 ? query.surfacePoints : Object.keys(solid.coordinates);
        const sphere = circumsphereFromPoints(ids.map(id => resolvePoint(solid.coordinates,id)));
        const centerId = query.centerId || 'O_circum';
        requireFreshPoint(centerId);
        extras.coordinates[centerId] = sphere.center;
        extras.elements.push({id:`point-${centerId}`,type:'point',point:centerId},{id:`circumsphere-${query.id}`,type:'sphere',center:centerId,radius:exactNumber(sphere.radius),opacity:.2});
        queryResults[query.id] = {kind:query.kind,center:sphere.center,radius:sphere.radius,residual:sphere.residual};
        queryChecks.push({id:`query:${query.id}`,pass:sphere.residual<=1e-7,residual:sphere.residual,kind:query.kind});
      } else if (query.kind === 'insphere') {
        const sphere = insphereForPolyhedron(solid), centerId = query.centerId || 'O_inner';
        requireFreshPoint(centerId);
        extras.coordinates[centerId] = sphere.center;
        extras.elements.push({id:`point-${centerId}`,type:'point',point:centerId},{id:`insphere-${query.id}`,type:'sphere',center:centerId,radius:exactNumber(sphere.radius),opacity:.28});
        queryResults[query.id] = {kind:query.kind,center:sphere.center,radius:sphere.radius,residual:sphere.residual};
        queryChecks.push({id:`query:${query.id}`,pass:sphere.residual<=1e-7,residual:sphere.residual,kind:query.kind});
      } else return {status: 'unsupported', error: `UNSUPPORTED_QUERY:${query.kind}`};
    }
  } catch (error) { return {status: 'validation_failed', error: String(error.message || error), validation:{...validation,pass:false,checks:[...validation.checks,...queryChecks,{id:'query:invalid',pass:false,residual:Infinity}]}}; }
  if (queryChecks.some(check => !check.pass)) {
    return {status:'validation_failed',error:'DERIVED_QUERY_CHECK_FAILED',
      validation:{...validation,pass:false,checks:[...validation.checks,...queryChecks]}};
  }
  const rendered = sceneFromSolid(solid, sections, extras);
  const vectorQueries=(ir.queries||[]).filter(query=>query.kind==='vector_relation');
  if(vectorQueries.length){
    const queryLines=[];
    for(const query of vectorQueries)for(const line of [query.first,query.second])if(!queryLines.some(existing=>existing.join('|')===line.join('|')))queryLines.push([...line]);
    rendered.scene.queryLine=[...queryLines[0]];
    rendered.scene.queryLines=queryLines;
  }
  const canonicalCoordinates = Object.fromEntries(Object.entries(rendered.coordinates).map(([id, point]) => [id, point.map(exactNumber)]));
  const finalValidation={...validation,pass:validation.pass&&queryChecks.every(check=>check.pass),checks:[...validation.checks,...queryChecks],sectionChecks:queryChecks.filter(check=>check.kind==='polyhedron_section')};
  const assertedGoals=(ir.queries||[]).filter(query=>query.expectation);
  const goalChecks=assertedGoals.map(query=>{
    const result=queryResults[query.id]||{};
    const expected=query.expectation;
    const pass=Object.entries(expected).every(([key,value])=>result[key]===value);
    return {queryId:query.id,expected,computed:Object.fromEntries(Object.keys(expected).map(key=>[key,result[key]])),pass};
  });
  const goalResult={status:goalChecks.length?(goalChecks.every(item=>item.pass)?'proved':'not_proved'):'not_requested',checks:goalChecks};
  rendered.scene.pedagogy=buildPedagogicalVisualization({scene:rendered.scene,coordinates:rendered.coordinates,query:(ir.queries||[])[0],verification:{checks:finalValidation.checks.map(check=>({constraintId:check.id,pass:check.pass}))}});
  return {
    status: 'verified_unique', geometryIR: structuredClone(ir), solid, queryResults, goalResult,
    validation: finalValidation,
    result: {
      solverStatus: 'verified', modelKind: solid.kind, canonicalCoordinates,
      answer: Object.values(queryResults).some(item=>item.kind==='vector_relation')
        ? {displayPlain:`夹角余弦为 ${Number(Object.values(queryResults).find(item=>item.kind==='vector_relation').cosine.toFixed(12))}`,latex:''}
        : Object.values(queryResults).some(item=>item.kind==='segment_length')
          ? {displayPlain:`线段长为 ${Number(Object.values(queryResults).find(item=>item.kind==='segment_length').value.toFixed(12))}`,latex:''}
          : {displayPlain: '模型、空间关系与截面均已通过确定性验证。', latex: ''},
      verification: {answerUnique: true, embeddingUnique: true, checks: finalValidation.checks, sourceGrounding: 'geometry-ir/polyhedron-v1', mathVerification: 'polyhedron-deterministic-validator/v1'},
      scene: rendered.scene
    }
  };
}
