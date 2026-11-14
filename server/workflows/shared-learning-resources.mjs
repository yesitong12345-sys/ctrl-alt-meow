// Public snapshots deliberately exclude identities, sessions and personal FSRS state.
const text = (value, max = 8000) => String(value || '').trim().slice(0, max);
const strings = values => Array.isArray(values) ? values.slice(0, 40).map(v => text(v, 120)).filter(Boolean) : [];

export function sharedCardSnapshot(card) {
  return {version: 1, type: 'knowledge_card',
    frontContent: text(card.frontContent || card.challengePrompt),
    backContent: text(card.backContent || card.content || card.insight),
    nextTimeAction: text(card.nextTimeAction), memoryHook: text(card.memoryHook, 300)};
}

export function sharedMistakeSnapshot(record, chosenFields) {
  const include = key => !Array.isArray(chosenFields) || chosenFields.includes(key);
  return {version: 1, type: 'wrong_question', question: include('question') ? text(record.question, 16000) : '',
    subject: text(record.subject, 40), unit: text(record.unit, 120), knowledgePoints: strings(record.knowledgePoints),
    microSkills: strings(record.microSkills), questionType: text(record.questionType, 80),
    correctAnswer: include('correctAnswer') ? text(record.correctAnswer) : '', analysis: text(record.analysis),
    // Publisher's answer/errors are examples, never the recipient's learning diagnosis.
    exampleAnswer: include('studentAnswer') ? text(record.studentAnswer) : '',
    exampleErrors: include('errorCause') ? strings(record.errorCauses) : []};
}

export function importedMistake(shared, {id, userId, createdAt}) {
  const snapshot = shared.snapshot?.type === 'wrong_question' ? shared.snapshot : null;
  // Legacy plaza items contained labeled plain text only.
  const legacy = label => text(String(shared.description || '').match(new RegExp('【' + label + '】([\\s\\S]*?)(?=\\n【|$)'))?.[1], 16000);
  const question = text(snapshot?.question || legacy('题目'), 16000);
  if (!question) return null;
  return {id, user_id: userId, studentId: userId, subject: shared.subject || '未分类', unit: snapshot?.unit || '',
    question, questionType: snapshot?.questionType || '', knowledgePoints: snapshot?.knowledgePoints || [shared.knowledgePoint].filter(Boolean),
    microSkills: snapshot?.microSkills || [], studentAnswer: '', errorCauses: [], processSteps: [], stuckAt: null,
    correctAnswer: snapshot?.correctAnswer || legacy('参考答案'), analysis: snapshot?.analysis || legacy('解析/提醒'),
    sharedExampleAnswer: snapshot?.exampleAnswer || legacy('我的作答'), sharedExampleErrors: snapshot?.exampleErrors || [],
    source: 'shared_knowledge', origin: 'shared_knowledge_import', sourceSharedKnowledgeId: shared.id,
    sharedSource: {authorName: shared.authorName || '同学', sharedAt: shared.createdAt},
    // New personal learning history. No donor mastery or review state is copied.
    learningProfile: {reviewCount: 0, mastery: 0, fsrs: null},
    geometryModelRequested: false, geometryResult: null, visualization: {renderer: 'none'}, createdAt, updatedAt: createdAt};
}
