const normalize = value => String(value || '').replace(/\r/g, '').trim();

function extractOptions(question) {
  const text = normalize(question);
  const marker = '(?:[.．、:：)）]|项[.．、:：]?)';
  const matches = [...text.matchAll(new RegExp(`(?:^|\\n|\\s|\\()([A-H])${marker}\\s*([\\s\\S]*?)(?=(?:\\n|\\s|\\()[A-H]${marker}\\s*|$)`, 'g'))];
  return matches.map(match => ({label: match[1], text: match[2].trim()})).filter(option => option.text);
}

function choiceKind(question, optionCount) {
  if (!optionCount) return 'constructed_response';
  const text = normalize(question);
  if (/多项选择|多选题|多选|有多个.{0,8}(正确|符合)|正确的有.{0,6}(多个|两项|三项)/.test(text)) return 'multiple_choice';
  return 'single_choice';
}

function statedJudgment(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const local = String(text || '').match(new RegExp(`(?:选项)?${escaped}(?:项)?([^\\n]{0,42})`, 'i'))?.[1] || '';
  if (/(?:不正确|错误|不成立|不符合|排除|不能推出)/.test(local)) return false;
  if (/(?:正确|成立|符合|保留|可以推出)/.test(local)) return true;
  return null;
}

function optionStep(option, nextOption, kind, correctOptionLabels) {
  const label = option.label;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const detector = new RegExp(`(?:选项)?${escaped}(?:项)?[^\\n]{0,36}(?:正确|错误|成立|不成立|符合|不符合|排除|保留|因为|理由|依据)|(?:正确|错误|排除|保留)[^\\n]{0,18}(?:选项)?${escaped}(?:项)?`, 'i');
  const nextQuestion = nextOption
    ? `选项 ${label} 的判断已经形成证据。接着判断选项 ${nextOption.label}，并说明它成立或不成立的依据。`
    : kind === 'multiple_choice'
      ? '各选项已经逐项判断。现在汇总所有正确选项，写出最终多选答案。'
      : '各选项已经逐项判断。现在写出唯一正确选项作为最终答案。';
  const evaluate = text => {
    if (!correctOptionLabels.length) return 'unknown';
    const judgment = statedJudgment(String(text || ''), label);
    if (judgment === null) return 'unknown';
    return judgment === correctOptionLabels.includes(label) ? 'correct' : 'incorrect';
  };
  return {
    id: `judge_${label}`,
    goal: `evaluate_choice_option_${label}`,
    knownResult: `已对选项 ${label} 给出有依据的判断。`,
    understanding: `你已经对选项 ${label} 作出了判断，并给出了可以检查的理由。`,
    explanation: `选项 ${label} 的判断已记入本题得分点；这里只确认你真实说明过的依据。`,
    detect: text => {
      const raw = String(text || '');
      if (!correctOptionLabels.length) return detector.test(raw);
      const judgment = statedJudgment(raw, label);
      const expected = correctOptionLabels.includes(label);
      return judgment === expected && /(因为|依据|由|所以|可得|反例|条件|公式|定义|定理|计算)/.test(raw);
    },
    evaluate,
    nextQuestion,
    followUpQuestion: `换一种方式：先说选项 ${label} 用到了哪个条件、公式或反例，再判断它是否成立。`
  };
}

function finalStep(kind, options, correctOptionLabels) {
  const labels = options.map(option => option.label).join('');
  const answerPattern = new RegExp(`(?:最终|答案|所以|选择|应选)[^\\n]{0,20}[${labels}]`, 'i');
  return {
    id: 'final_selection',
    goal: 'state_and_verify_choice_answer',
    knownResult: kind === 'multiple_choice' ? '已汇总全部正确选项。' : '已确定唯一正确选项。',
    understanding: kind === 'multiple_choice' ? '你已经汇总并写出了多选题的最终选择。' : '你已经写出了单选题的唯一最终选择。',
    explanation: '最终选择已与前面对各选项的判断证据对应，可以完成本题。',
    detect: text => {
      const raw = String(text || '');
      if (!answerPattern.test(raw)) return false;
      const finalText = raw.match(/(?:最终|答案|所以|选择|应选)[^\n]{0,20}/i)?.[0] || '';
      const chosen = [...new Set((finalText.match(/[A-H]/gi) || []).map(label => label.toUpperCase()))].sort();
      if (kind === 'single_choice' && chosen.length !== 1) return false;
      if (kind === 'multiple_choice' && chosen.length < 1) return false;
      if (!correctOptionLabels.length) return true;
      return chosen.join('') === correctOptionLabels.slice().sort().join('');
    },
    nextQuestion: '本题已完成：最后检查最终选择与逐项判断是否一致。',
    followUpQuestion: kind === 'multiple_choice' ? '请用“最终选择：A、C”这样的格式汇总所有正确选项。' : '请用“最终选择：B”这样的格式写出唯一答案。'
  };
}

export function buildQuestionRubric(question, {correctOptionLabels = []} = {}) {
  const options = extractOptions(question);
  const questionKind = choiceKind(question, options.length);
  if (questionKind === 'constructed_response') return {questionKind, options: [], parts: [], steps: []};
  const normalizedCorrect = [...new Set(correctOptionLabels.map(label => String(label).trim().toUpperCase()).filter(Boolean))];
  const optionSteps = options.map((option, index) => optionStep(option, options[index + 1], questionKind, normalizedCorrect));
  const lastStep = finalStep(questionKind, options, normalizedCorrect);
  const steps = [...optionSteps, lastStep];
  const parts = [
    ...options.map(option => ({
      id: `judge_${option.label}`,
      label: `判断选项 ${option.label}`,
      hint: `结合题目条件判断选项 ${option.label} 是否成立，并写出理由。`,
      steps: [`judge_${option.label}`]
    })),
    {
      id: 'final_selection',
      label: questionKind === 'multiple_choice' ? '汇总全部正确选项' : '确定唯一正确选项',
      hint: questionKind === 'multiple_choice' ? '根据逐项判断写出全部正确选项，不能漏选或多选。' : '根据逐项判断写出唯一答案。',
      steps: ['final_selection']
    }
  ];
  return {questionKind, options, parts, steps};
}
