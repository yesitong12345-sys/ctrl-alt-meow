import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),lib=require('../../implementation/textbook-library.js'),katex=require('../../implementation/vendor/katex/katex.min.js');
const source=fs.readFileSync(new URL('../../implementation/textbook-library.js',import.meta.url),'utf8'),block=source.split('// BEGIN TEXTBOOK TYPESETTING')[1].split('// END TEXTBOOK TYPESETTING')[0],{textbookNotation:tex,textbookMathParts:parts}=new Function(block+';return {textbookNotation,textbookMathParts};')();
test('fractions preserve grouped coordinates, scalar multiplication and norm denominators',()=>{
 assert.equal(tex('2/3'),'\\dfrac{2}{3}');assert.equal(tex('(2/3)n'),'\\left(\\dfrac{2}{3}\\right) n');assert.equal(tex('H=(20/3,4/3,4/3)'),"H = \\left(\\dfrac{20}{3} , \\dfrac{4}{3} , \\dfrac{4}{3}\\right)");
 assert.equal(tex('|u·n|/(|u||n|)'),'\\dfrac{\\left|u \\cdot n\\right|}{\\left|u\\right| \\left|n\\right|}');assert(tex('(v·u)²/(u·u)').includes('\\dfrac{\\left(v \\cdot u\\right)^{2}}{u \\cdot u}'));
});
test('radical scope, superscripts and component subscripts retain authored meaning',()=>{
 assert.equal(tex('√2a'),'\\sqrt{2} a');assert.equal(tex('√10/4'),'\\dfrac{\\sqrt{10}}{4}');assert.equal(tex('√(10/4)'),'\\sqrt{\\dfrac{10}{4}}');assert.equal(tex('u_zv_z'),'u_{z} v_{z}');assert(tex('S△A₁BC=2√2').includes('S_{\\triangle A_{1}BC}'));
 assert(tex('10⁻¹⁴').includes('10^{-14}'));assert(tex('vₓ').includes('v_{x}'));assert(parts('向量AB=(2,2,0)').some(p=>p.latex?.includes('\\overrightarrow{AB}')));
});
test('math parts preserve original prose, punctuation, options, units and unsafe text as text',()=>{
 for(const input of ['代回H=(20/3,4/3,4/3)，回查20/3+8/3+8/3=12。','A. [18，81/4]　　B. [27/4，81/4]','1.0×10⁻³ mol/L。','<img src=x onerror=alert(1)>','来源：2021—2025'])assert.equal(parts(input).map(p=>p.text).join(''),input);
 assert(parts('A. [18，81/4]').some(p=>p.latex?.includes('\\dfrac{81}{4}')));assert(tex('10⁻³ mol/L').includes('\\mathrm{L}^{-1}'));assert.equal(tex('<img src=x onerror=alert(1)>'),null);
});
test('all authored mathematics and chemistry formula candidates compile with bundled KaTeX',()=>{
 let count=0;function visit(v){if(typeof v==='string'){const ps=parts(v);assert.equal(ps.map(p=>p.text).join(''),v);for(const p of ps)if(p.latex){katex.renderToString(p.latex,{throwOnError:true,strict:'ignore',trust:false});count++;}}else if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')for(const [key,value]of Object.entries(v))if(!/^(id|scene|url|sourceKey|kind|originalCaption|related|visual|mesh|.*Points|planeDistance|keywords)$/.test(key))visit(value);}
 for(const c of lib.findCards('全部主题','','数学'))visit(c.expansionLesson||c.circleCard||{text:c.description});for(const c of lib.findRecentReviews())visit(c);for(const c of lib.findCards('全部主题','','化学'))visit(c.sourceCard);assert(count>3500);
});
test('every redraw and chemical feedback retypesets without touching personal persistence',()=>{
 assert(source.includes('typesetTextbook(container);'));assert(source.includes('showChemistryFeedback(container);typesetTextbook(container);'));assert(block.includes("host.dataset.latex=part.latex"));assert(block.includes("trust:false"));assert(block.includes("p.closest('svg"));assert(!/\bfetch\s*\(|localStorage|sessionStorage/.test(block));assert(block.includes('document.createElementNS'));assert(block.includes('data-formula-retry'));
});
test('global formula normalization and auto-render leave SVG to its own coordinate-aware math layer',()=>{
 const index=fs.readFileSync(new URL('../../implementation/index.html',import.meta.url),'utf8');assert(index.includes("if(node.closest('svg'))return;let source="));assert(index.includes("parent.closest('svg,.katex,[data-latex]"));assert(index.includes("ignoredTags:['script','noscript','style','textarea','pre','code','svg']"));
});
test('chemistry mode keeps chemical symbols upright without changing mathematical variable typography',()=>{
 assert.equal(tex('CH₃COOH',true),'\\mathrm{CH}_{3} \\mathrm{COOH}');assert.equal(tex('HCO₃⁻',true),'\\mathrm{HCO}_{3}^{-}');assert.equal(tex('AB',false),'AB');
 for(const card of lib.findCards('全部主题','','化学')){function visit(v){if(typeof v==='string')for(const p of parts(v,true))if(p.latex)katex.renderToString(p.latex,{throwOnError:true,strict:'ignore'});else{}else if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')for(const [k,x]of Object.entries(v))if(!/url|id/i.test(k))visit(x);}visit(card.sourceCard);}
});
