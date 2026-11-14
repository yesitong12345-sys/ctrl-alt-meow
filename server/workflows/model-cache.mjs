import {createHash} from 'node:crypto';

const SYMBOLS = new Map([['−','-'],['–','-'],['—','-'],['×','*'],['·','*'],['÷','/'],['∠','角'],['∥','平行'],['⊥','垂直'],['°','度'],['，',','],['。','.'],['：',':'],['；',';'],['（','('],['）',')']]);

export function normalizeModelQuestion(question, subject = '') {
  let text = String(question || '').normalize('NFKC').toLocaleLowerCase();
  for (const [from, to] of SYMBOLS) text = text.split(from).join(to);
  text = text.replace(/[\u200b-\u200f\ufeff\s]+/g, '').replace(/[【】\[\]{}]/g, '').replace(/[,;:]+/g, ',');
  const conditions = (String(question || '').match(/[-+]?\d+(?:\.\d+)?(?:°|度|cm|mm|m|秒|s|\s*\w+)?/gi) || []).map(value => value.replace(/\s+/g,'').toLowerCase()).sort();
  return {text, conditions, subject:String(subject || '').normalize('NFKC').trim()};
}

export function modelCacheHash(question, subject = '') {
  const normalized = normalizeModelQuestion(question, subject);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function findModelCache(cache, question, subject = '') {
  const hash = modelCacheHash(question, subject);
  return (Array.isArray(cache) ? cache : []).find(entry => entry.hash === hash) || null;
}

export function rememberModel(cache, {question, subject, scene, generatedBy = 'unknown', generatedAt = new Date().toISOString()} = {}) {
  const normalized = normalizeModelQuestion(question, subject), hash = modelCacheHash(question, subject);
  const entry = {hash, normalized_question:normalized.text, conditions:normalized.conditions, subject:normalized.subject,
    model_url:`/v1/model-cache/${hash}`, generated_by:String(generatedBy), generated_at:generatedAt, reuse_count:0,
    scene:scene ? structuredClone(scene) : null, schema_version:1};
  const items = Array.isArray(cache) ? cache : [];
  const index = items.findIndex(item => item.hash === hash);
  if (index >= 0) items[index] = {...items[index], ...entry, reuse_count:Number(items[index].reuse_count || 0)};
  else items.unshift(entry);
  return entry;
}

export function markModelReuse(entry) {
  if (!entry) return null;
  entry.reuse_count = Number(entry.reuse_count || 0) + 1;
  return entry;
}
