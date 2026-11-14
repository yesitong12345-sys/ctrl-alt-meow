import test from 'node:test';
import assert from 'node:assert/strict';
import {aiRubricProfile, buildDetectFor, createDeepSeekAiRubricAdapter, normalizeAiRubric, supportsAiRubric} from '../workflows/ai-rubric.mjs';

const sample = {
  steps: [
    {label: '建立空间直角坐标系', goal: '以底面中心为原点建系', why: '坐标系选错会让后面全错', keywords: ['坐标系', '原点'], nextQuestion: '你的原点是哪一点？', check: '检查三轴是否两两垂直'},
    {label: '写出关键点坐标', goal: '把题目给的边长落到坐标上', why: '边长与坐标要对应', keywords: ['坐标', '边长'], nextQuestion: '各点坐标是多少？'},
    {label: '求平面的法向量', goal: '用平面内两条方向做叉积', why: '法向量是线面角的关键', keywords: ['法向量', '叉积'], nextQuestion: '法向量是多少？'},
    {label: '代入线面角公式', goal: '用方向向量与法向量求正弦', why: '注意是正弦不是余弦', keywords: ['正弦', '线面角'], nextQuestion: '正弦值是多少？'},
    {label: '检验取值范围', goal: '确认结果在 (0,1] 内', why: '正弦不可能大于 1', keywords: ['检验', '范围'], nextQuestion: '结果合理吗？'},
  ],
};

test('数学与物理才走 AI 反推', () => {
  assert.equal(supportsAiRubric('数学'), true);
  assert.equal(supportsAiRubric('物理'), true);
  assert.equal(supportsAiRubric('数学·几何'), true);
  assert.equal(supportsAiRubric('语文'), false);
  assert.equal(supportsAiRubric('英语'), false);
  assert.equal(supportsAiRubric(''), false);
});

test('反推结果会被规范成 tutor 可用的得分点契约', () => {
  const rubric = normalizeAiRubric(sample, '一道立体几何题');
  assert.ok(rubric);
  assert.equal(rubric.source, 'ai_reverse');
  assert.equal(rubric.steps.length, 5);
  assert.equal(rubric.parts.length, 5);
  for (const step of rubric.steps) {
    assert.match(step.id, /^ai_\d+$/);
    assert.equal(typeof step.detect, 'undefined', '存库的形态里不应有函数');
    assert.ok(step.label.length <= 26);
    assert.ok(step.hint.length > 0);
    assert.ok(step.nextQuestion.length > 0);
    assert.ok(Array.isArray(step.keywords));
  }
  // parts 的 steps 必须指回真实 step id，否则陪练进度对不上
  for (const part of rubric.parts) {
    assert.deepEqual(part.steps, [part.id]);
    assert.ok(rubric.steps.some(step => step.id === part.id));
  }
  assert.deepEqual(rubric.parts.map(p => p.id), rubric.steps.map(s => s.id));
});

test('步骤太少或没有 label 时不产出（宁可回落兜底也不要半个得分点表）', () => {
  assert.equal(normalizeAiRubric({steps: sample.steps.slice(0, 2)}), null);
  assert.equal(normalizeAiRubric({steps: [{goal: '没有标题'}]}), null);
  assert.equal(normalizeAiRubric({steps: []}), null);
  assert.equal(normalizeAiRubric(null), null);
});

test('detect 用关键词判定：命中阈值才算完成', () => {
  const detect = buildDetectFor(['法向量', '叉积']);
  assert.equal(detect('我先求平面的法向量，用的是叉积'), true);
  assert.equal(detect('我求了法向量'), false);        // 只命中 1 个，不够
  assert.equal(detect('完全无关的一句话'), false);
  assert.equal(buildDetectFor([])('任何话'), false);  // 没关键词不给分
  // 关键词里的正则元字符不能炸
  assert.equal(typeof buildDetectFor(['平面(ABC)', 'a[0]']), 'function');
});

test('反推结果是纯数据：存进库再取回来仍然可用（detect 在读取时重建）', () => {
  const rubric = normalizeAiRubric(sample, 'x');
  assert.ok(rubric);
  // 纯数据：不能夹带函数，否则写库/读库会静默丢检测能力
  assert.equal(JSON.stringify(rubric).includes('function'), false);
  const stored = JSON.parse(JSON.stringify(rubric));   // 模拟存库再读回
  const profile = aiRubricProfile({aiRubric: stored});
  assert.ok(profile, 'JSON 往返后必须仍然能取到得分点');
  assert.equal(profile.steps.length, 5);
  assert.equal(typeof profile.steps[0].detect, 'function');
  // 重建出来的 detect 仍然按关键词判定
  assert.equal(profile.steps[2].detect('我先求平面的法向量，用的是叉积'), true);
  assert.equal(profile.steps[2].detect('我直接跳到结论'), false);
  assert.deepEqual(profile.parts.map(p => p.id), profile.steps.map(s => s.id));
});

test('aiRubricProfile 的容错：脏数据只丢那一条，不整体崩', () => {
  const rubric = normalizeAiRubric(sample, 'x');
  const stored = JSON.parse(JSON.stringify(rubric));
  stored.steps.push({id: 'ai_broken'});                       // 缺 label
  stored.parts.push({id: 'ghost', label: '幽灵', steps: ['not_exist']});
  const profile = aiRubricProfile({aiRubric: stored});
  assert.ok(profile);
  assert.equal(profile.steps.length, 5, '缺 label 的那条应被丢掉');
  assert.equal(profile.parts.some(p => p.id === 'ghost'), false, '指向不存在步骤的 part 应被丢掉');
  assert.equal(aiRubricProfile({aiRubric: {steps: []}}), null);
  assert.equal(aiRubricProfile({aiRubric: {steps: [{id: 'x'}]}}), null);
  assert.equal(aiRubricProfile({}), null);
  assert.equal(aiRubricProfile(null), null);
});

test('没有配置密钥时不创建适配器（服务端据此给出可重试的失败态）', () => {
  assert.equal(createDeepSeekAiRubricAdapter({}), null);
  assert.equal(createDeepSeekAiRubricAdapter({endpoint: 'https://x', apiKey: 'k'}), null);
  assert.equal(typeof createDeepSeekAiRubricAdapter({endpoint: 'https://x', apiKey: 'k', model: 'm'}), 'function');
});

test('适配器走 JSON 输出并做重试，最终返回规范化的 rubric', async () => {
  let calls = 0;
  const adapter = createDeepSeekAiRubricAdapter({
    endpoint: 'https://example.test/v1', apiKey: 'k', model: 'm',
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return {ok: false, status: 500, json: async () => ({})};
      return {ok: true, status: 200, json: async () => ({choices: [{message: {content: JSON.stringify(sample)}}]})};
    },
  });
  const rubric = await adapter({question: '一道立体几何题', subject: '数学'});
  assert.equal(calls, 2, '第一次 500 应该重试');
  assert.equal(rubric.steps.length, 5);
  assert.equal(rubric.steps[0].label, '建立空间直角坐标系');
});

test('适配器：步骤不足时重试后仍失败会抛错，不会返回空 rubric', async () => {
  const adapter = createDeepSeekAiRubricAdapter({
    endpoint: 'https://example.test/v1', apiKey: 'k', model: 'm',
    fetchImpl: async () => ({ok: true, status: 200, json: async () => ({choices: [{message: {content: JSON.stringify({steps: [{label: '只有一步'}]})}}]})}),
  });
  await assert.rejects(() => adapter({question: 'q'}), /AI_RUBRIC_TOO_FEW_STEPS|AI_RUBRIC_FAILED/);
});
