import test from 'node:test';
import assert from 'node:assert/strict';
import {csvQuestions} from '../src/csv-questions.js';
const header='category,language,difficulty,status,text,choice1,choice2,choice3,choice4,correctIndex,explanation,source';
test('CSV imports quoted commas, multiline explanations and escaped quotes',()=>{
  const [q]=csvQuestions(header+'\r\nscience,fr,1,draft,"Texte, question",A,B,C,D,0,"Une ligne\nUne ""citation""",fixture\r\n');
  assert.equal(q.text,'Texte, question');assert.equal(q.explanation,'Une ligne\nUne "citation"');assert.equal(q.correctIndex,0);assert.deepEqual(q.choices,['A','B','C','D']);
});
test('CSV rejects missing duplicate headers, inconsistent columns and unfinished quoting',()=>{
  for(const csv of ['text,text\na,b',header+'\nshort,row',header+'\n"unclosed'])assert.throws(()=>csvQuestions(csv),{status:400});
});
