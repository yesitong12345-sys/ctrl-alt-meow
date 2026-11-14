/*
 * 知识网络里两个知识点之间的「衔接提示卡」。
 *
 * 学生点一条连线时，想知道的是：这两个知识点到底怎么一起用 / 怎么区分。
 * 这里按关系类型给出一张可导入知识闯关的小卡片：
 *   依赖   怎么从先修推到后修
 *   易混淆 两者的判别标志是什么
 *   常结合 一道题里它们各自负责哪一段
 *
 * 卡片内容必须短、能被学生拿走就用；渲染时当成文本，不产生 HTML。
 */
const TEXT_LIMIT = 1000;
const NOTE_LIMIT = 600;

const RELATION_META = {
  DEPENDS_ON: {
    key: 'depends',
    label: '依赖',
    color: 'yellow',
    angle: '把先修知识补上，再学这个知识点才不会卡',
    ask: '先修知识在这道题里是怎么被用上的？没有它会卡在哪一步？',
  },
  CONFUSES_WITH: {
    key: 'confuses',
    label: '易混淆',
    color: 'red',
    angle: '分清两者在定义、图形和公式上的差别，考试才不选错',
    ask: '这两个知识点在题目里各自看什么条件？你上次是怎么混的？',
  },
  CO_OCCURS_WITH: {
    key: 'co-occurs',
    label: '常结合',
    color: 'green',
    angle: '这类题经常一起考，掌握它们的配合顺序就能拿分',
    ask: '这类题里它们分别负责哪一步？先后顺序是什么？',
  },
  RELATED_TO: {
    key: 'related',
    label: '相关',
    color: 'blue',
    angle: '同属一个知识族，一起过一遍更省时间',
    ask: '它们共同的那条主线是什么？',
  },
};

const clean = (value, limit) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

export function relationMetaFor(type) {
  return RELATION_META[type] || RELATION_META.RELATED_TO;
}

/* 不依赖模型也能给出的兜底卡片：类型 + 两个知识点 + 该问自己的问题。
   保证点任何一条线都有东西可看，不会出现空面板。 */
export function fallbackRelationTip({pointA, pointB, relationType, frequency = 1, subject = ''}) {
  const meta = relationMetaFor(relationType);
  const a = clean(pointA, 40) || '知识点 A';
  const b = clean(pointB, 40) || '知识点 B';
  const pair = relationType === 'DEPENDS_ON' ? `${a} 依赖 ${b}` : `${a} 与 ${b}`;
  const headline = relationType === 'DEPENDS_ON' ? `${pair}：先补 ${b}` : `${pair}：${meta.label}`;
  const body = relationType === 'DEPENDS_ON'
    ? `${b} 是 ${a} 的前提。先把 ${b} 用自己的话说清楚，再回到 ${a}，你不会再是"套公式但不知道为什么"。`
    : relationType === 'CONFUSES_WITH'
      ? `${a} 和 ${b} 长得像但判据不同。做题时先写清楚"这题问的是哪一个量"，再决定用哪个公式。`
      : `${a} 和 ${b} 经常出现在同一道题里（已记录 ${Number(frequency) || 1} 次共现），先分清它们各自负责哪一步。`;
  const solution = relationType === 'DEPENDS_ON'
    ? `①先找题目里哪个条件需要用到 ${b}；②再用它把 ${a} 推出来。`
    : relationType === 'CONFUSES_WITH'
      ? `①先找题目问的是 ${a} 还是 ${b}（看条件与单位）；②再按两者的判别标志区分，别把 ${a} 的做法直接套到 ${b}。`
      : `①先找题目里 ${a} 和 ${b} 各自负责哪一步；②再按先后顺序把它们接起来。`;
  return {
    source: 'local_fallback',
    relationType,
    relationLabel: meta.label,
    color: meta.color,
    pointA: a,
    pointB: b,
    subject: clean(subject, 20),
    headline,
    body: clean(body, NOTE_LIMIT),
    solution: clean(solution, NOTE_LIMIT),
    tip: clean(`考试里先判断这道题要的是 ${a} 还是 ${b}，再决定用哪一个。`, NOTE_LIMIT),
    question: meta.ask,
    pitfall: relationType === 'CONFUSES_WITH' ? `最容易错的地方：把 ${a} 的做法直接套到 ${b} 上。` : '',
  };
}

export function normalizeRelationTip(parsed, base) {
  const raw = parsed && typeof parsed === 'object' ? parsed : {};
  const headline = clean(raw.headline, 80) || base.headline;
  const body = clean(raw.body, NOTE_LIMIT) || base.body;
  const tip = clean(raw.tip, NOTE_LIMIT) || base.tip;
  return {
    ...base,
    source: 'ai',
    headline,
    body,
    solution: clean(raw.solution, NOTE_LIMIT) || base.solution,
    tip,
    question: clean(raw.question, 160) || base.question,
    pitfall: clean(raw.pitfall, NOTE_LIMIT) || base.pitfall,
  };
}

/* 交给模型的题面：只给两个知识点的名字、关系类型和学科，不给原题，
   避免把某一道题的答案写进通用技巧里。 */
const PROMPT = `你是一个高中老师。学生会点开知识网络图上两个知识点之间的一条连线，你要给他一张能直接用的小卡片。

要求：
1. 只讲这两个知识点之间怎么衔接、怎么区分、怎么配合，不要展开成完整课程。
2. 用高中生能看懂的话，具体、可操作，不要空话。
3. 不要编造具体题目里的数字。

按 JSON 输出：{"headline":"一句话点出两者的关系","body":"两三句话讲清楚怎么一起用或怎么区分","solution":"一条通用解法：①先找什么条件；②再看怎么注意两者的关系","tip":"一条可以立刻照做的做题技巧","question":"让学生自查的一句话","pitfall":"最容易错在哪（易混淆关系必须写）"}`;

const promptFor = (base) => [
  `学科：${base.subject || '未标注'}`,
  `知识点 A：${base.pointA}`,
  `知识点 B：${base.pointB}`,
  `关系类型：${base.relationLabel}（${base.relationType === 'DEPENDS_ON' ? 'A 依赖 B' : base.relationType === 'CONFUSES_WITH' ? 'A 和 B 容易混' : 'A 和 B 经常一起考'}）`,
].join('\n');

export function createDeepSeekRelationTipAdapter(config = {}) {
  if (!config.endpoint || !config.apiKey || !config.model) return null;
  return async (base) => {
    const content = [{type: 'text', text: `${PROMPT}\n\n这张卡片的信息：\n${promptFor(base)}`}];
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs || 40000);
      try {
        const response = await (config.fetchImpl || fetch)(config.endpoint, {
          method: 'POST',
          headers: {'content-type': 'application/json', authorization: `Bearer ${config.apiKey}`},
          signal: controller.signal,
          body: JSON.stringify({model: config.model, messages: [{role: 'user', content}], temperature: 0.3, response_format: {type: 'json_object'}}),
        });
        if (!response.ok) {
          const error = Object.assign(new Error(`RELATION_TIP_HTTP_${response.status}`), {code: `RELATION_TIP_HTTP_${response.status}`});
          if (response.status < 500 && response.status !== 429) throw error;
          failure = error;
        } else {
          const body = await response.json();
          const raw = body?.choices?.[0]?.message?.content;
          const parsed = typeof raw === 'string' ? JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '')) : raw;
          return normalizeRelationTip(parsed, base);
        }
      } catch (error) {
        failure = error?.name === 'AbortError' ? Object.assign(new Error('RELATION_TIP_TIMEOUT'), {code: 'RELATION_TIP_TIMEOUT'}) : error;
        if (/HTTP_(401|402|403)/.test(String(failure?.code || ''))) throw failure;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
    throw failure || new Error('RELATION_TIP_FAILED');
  };
}

/* 卡片正文：导入知识闯关时用这段文字当"我的理解"，
   它是可读的连贯中文，而不是把 headlne/body 拼成半句话。 */
export function relationTipText(tip) {
  const lines = [tip.headline, tip.body, tip.solution, tip.tip, tip.pitfall].map(item => clean(item, TEXT_LIMIT)).filter(Boolean);
  return lines.join(' ').slice(0, TEXT_LIMIT) || `${tip.pointA} 和 ${tip.pointB} 的关系`;
}
