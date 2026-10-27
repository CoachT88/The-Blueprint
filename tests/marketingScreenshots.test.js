import { describe, test, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root=path.resolve(process.cwd());
const read=relative=>readFileSync(path.join(root,relative),'utf8');

// Four screenshots furnished by the app owner, not generated from an outdated
// local app build. Missing images intentionally fail the release gate.
const assets=[
  ['app-today-2026.jpg',1630],
  ['app-sessions-2026.jpg',1442],
  ['app-recovery-2026.jpg',1524],
  ['app-guided-practice-2026.jpg',1596]
];

function dimensions(bytes){
  for(let i=2;i<bytes.length-9;){
    if(bytes[i]!==0xff){i++;continue;}
    const marker=bytes[i+1];
    if([0xc0,0xc1,0xc2,0xc3].includes(marker))
      return {height:bytes.readUInt16BE(i+5),width:bytes.readUInt16BE(i+7)};
    if(marker===0xda)break;
    const len=bytes.readUInt16BE(i+2);
    if(len<2)break;
    i+=2+len;
  }
  throw new Error('Expected a readable JPEG file');
}

describe('current app screenshots supplied by the product owner',()=>{
  test('all four current screenshots are committed and valid',()=>{
    for(const [name,height] of assets){
      const rel='img/'+name;
      expect(statSync(path.join(root,rel)).size,name).toBeGreaterThan(20000);
      const buffer=readFileSync(path.join(root,rel));
      expect(buffer[0],name).toBe(0xff);
      expect(buffer[1],name).toBe(0xd8);
      expect(dimensions(buffer),name).toEqual({width:780,height});
    }
  });
  test('the homepage gallery uses exactly the four current screenshots',()=>{
    const home=read('index.html');
    expect((home.match(/<figure class="shot">/g)||[])).toHaveLength(4);
    for(const [name] of assets) expect(home).toContain('src="img/'+name+'"');
    expect(home).toContain('What happens after you open the app?');
    expect(home).not.toContain('src="img/shot-home.jpg"');
    expect(home).not.toContain('fictional demonstration data');
    expect(home).not.toContain('dry tissue tears');
  });
  test('Whats Inside uses current Today and Guided Practice screens',()=>{
    const page=read('whats-inside/index.html');
    expect(page).toContain('src="/img/app-today-2026.jpg"');
    expect(page).toContain('src="/img/app-guided-practice-2026.jpg"');
    expect(page).not.toContain('src="/img/shot-progress.jpg"');
    expect(page).toContain('See all four current app screens');
  });
});
