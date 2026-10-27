import { describe, test, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = rel => readFileSync(path.join(root, rel),'utf8');

function jpegSize(rel) {
  const bytes = readFileSync(path.join(root,rel));
  expect(bytes[0]).toBe(0xff);
  expect(bytes[1]).toBe(0xd8);
  for(let i=2;i<bytes.length-9;){
    if(bytes[i]!==0xff){i++;continue;}
    const marker=bytes[i+1];
    if([0xc0,0xc1,0xc2,0xc3].includes(marker)){
      return {height:bytes.readUInt16BE(i+5),width:bytes.readUInt16BE(i+7)};
    }
    if(marker===0xda) break;
    const len=bytes.readUInt16BE(i+2);
    if(len<2)break;
    i+=2+len;
  }
  throw new Error('No image dimensions found in '+rel);
}

describe('Phase 3: current app demonstration screenshots',()=>{
  const names=['shot-home','shot-mission','shot-recovery','shot-progress'];
  test('all four real JPG captures exist and are readable mobile images',()=>{
    for(const name of names){
      const rel='img/'+name+'.jpg';
      expect(statSync(path.join(root,rel)).size,name).toBeGreaterThan(20000);
      const d=jpegSize(rel);
      expect(d.width,name).toBeGreaterThanOrEqual(380);
      expect(d.height,name).toBeGreaterThanOrEqual(820);
    }
  });
  test('the product story shows four distinct screens without fabricated results',()=>{
    const home=read('index.html');
    const inside=read('whats-inside/index.html');
    for(const name of names){
      expect(home).toContain('src="img/'+name+'.jpg"');
    }
    expect((home.match(/<figure class="shot">/g)||[])).toHaveLength(4);
    expect(home).toContain('fictional demonstration data');
    expect(home).not.toContain('dry tissue tears');
    for(const name of ['shot-home','shot-progress']){
      expect(inside).toContain('src="/img/'+name+'.jpg"');
    }
    expect(inside).toContain('fictional demo information');
  });
  test('screens are sourced from the real application in a reproducible capture',()=>{
    const capture=read('tools/capture-marketing-screenshots.mjs');
    expect(capture).toContain("from '../tests/e2e/harness.js'");
    expect(capture).toContain("goToStep(0)");
    expect(capture).toContain("goToStep(3)");
    expect(capture).toContain("goToRecoveryPicker()");
    expect(capture).toContain("openProgressChart()");
    expect(capture).toContain("demo@example.invalid");
  });
});
