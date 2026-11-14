import {createHash} from 'node:crypto';
// Do not lowercase symbols, discard numbers/units, or erase mathematical spacing.
export const strictQuestionFingerprint = (question, subject = '') => createHash('sha256')
  .update(JSON.stringify([String(subject || '').trim(), String(question || '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim()])).digest('hex');
