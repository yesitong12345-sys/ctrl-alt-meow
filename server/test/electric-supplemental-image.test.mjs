import test from 'node:test';
import assert from 'node:assert/strict';
import {createIntakeDraft, confirmWrongQuestion} from '../workflows/wrong-question-intake.mjs';

test('a supplemental graph image follows its confirmed text question into the mistake record', () => {
  const draft=createIntakeDraft({studentId:'student-1',source:'image',fileName:'',
    supplementaryImageHash:'a'.repeat(64),supplementaryImageMimeType:'image/jpeg',supplementaryImageName:'field-graph.jpg',
    preview:{question:'电势 V 随 x 的变化如图所示，判断场强方向。',handwriting:[],subject:'物理',knowledgePoints:['电场强度'],errorCause:'',errorCauseEvidence:'',answer:'',steps:[]}});
  const record=confirmWrongQuestion(draft,{});
  assert.deepEqual(record.supplementaryImage,{hash:'a'.repeat(64),fileName:'field-graph.jpg',mimeType:'image/jpeg'});
  assert.equal(record.sourceImage,null);
});

test('the upload form sends a supplemental image with the same question and confirmation', async () => {
  const {readFile}=await import('node:fs/promises');
  const {fileURLToPath}=await import('node:url');
  const source=await readFile(fileURLToPath(new URL('../../implementation/wrong-question-entry.js',import.meta.url)),'utf8');
  assert.match(source,/supplementalImageData:intake\.supplementImageData/);
  assert.match(source,/id="wq-attachment-file"/);
  assert.match(source,/supplementalImageData:intake\.supplementImageData,supplementImageName/);
});
