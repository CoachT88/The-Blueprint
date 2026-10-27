import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

describe('Current owner-provided Blueprint app screenshots',()=>{
  const imageDimensions=[
    ['app-today-2026.jpg',780,1630],
    ['app-sessions-2026.jpg',780,1442],
    ['app-recovery-2026.jpg',780,1524],
    ['app-guided-practice-2026.jpg',780,1596]
  ];
  test('all four real current device screenshots exist at the expected dimensions',()=>{
    for(const [name,width,height] of imageDimensions){
      const rel='img/'+name;
      expect(statSync(path.join(root,rel)).size,name).toBeGreaterThan(20000);
      const d=jpegSize(rel);
      expect(d,name).toEqual({width,height});
    }
  });
  test('the product story shows four authentic current screens and accurate captions',()=>{
    const home=read('index.html');
    const inside=read('whats-inside/index.html');
    for(const [name] of imageDimensions){
      expect(home).toContain('src="img/'+name+'"');
    }
    expect((home.match(/<figure class="shot">/g)||[])).toHaveLength(4);
    expect(home).toContain('current Blueprint app supplied by Coach Tee');
    expect(home).not.toContain('fictional demonstration data');
    expect(home).not.toContain('dry tissue tears');
    expect(home).not.toContain('img/shot-home.jpg');
    expect(inside).toContain('src="/img/app-today-2026.jpg"');
    expect(inside).toContain('src="/img/app-guided-practice-2026.jpg"');
    expect(inside).not.toContain('img/shot-progress.jpg');
  });

  test('EVERY MARKETING IMAGE EXISTS, AND IS THE SIZE THE MARKUP CLAIMS',()=>{
    /* The failure this exists for is a screenshot swap. The owner's own
       device captures are a different shape from the generated ones, so
       dropping them in without changing the width and height attributes
       would either squash the picture or reserve the wrong space and shift
       the page as it loads. This walks what the pages actually reference
       rather than a list, so a fifth screenshot is covered the day it
       lands, and a missing file fails here instead of in a browser. */
    const pages=['index.html','whats-inside/index.html'];
    let checked=0;
    for(const page of pages){
      const src=read(page);
      for(const m of src.matchAll(/<img src="(\/?img\/[^"]+)"[^>]*?width="(\d+)"[^>]*?height="(\d+)"/g)){
        const rel=m[1].replace(/^\//,'');
        expect(statSync(path.join(root,rel)).size,`${page} -> ${rel}`).toBeGreaterThan(5000);
        const d=jpegSize(rel);
        expect([d.width,d.height],`${page} declares ${rel} as ${m[2]}x${m[3]}`)
          .toEqual([Number(m[2]),Number(m[3])]);
        checked++;
      }
    }
    expect(checked,'the walk found no marketing images at all').toBeGreaterThanOrEqual(6);
  });

  test('mobile gallery reduces vertical scrolling without hiding any product screens',()=>{
    const home=read('index.html');
    expect(home).toContain('class="shots" tabindex="0" role="region"');
    expect(home).toContain('aria-label="Four Blueprint app screenshots"');
    expect(home).toContain('Four screens. Swipe sideways to explore');
    expect(home).toContain('scroll-snap-type:x mandatory');
    expect(home).toContain('overflow-x:auto');
    expect(home).toContain('flex:0 0 min(88%,340px)');
    expect(home).toContain('grid-template-columns:repeat(4,minmax(0,1fr))');
    expect((home.match(/<figure class="shot">/g)||[])).toHaveLength(4);
  });

  test('and no screenshot sits in img/ that nothing references',()=>{
    /* The other half of a swap: the old files left behind, so nobody can
       tell from the directory which set is live. og-card.jpg is the link
       preview image and is referenced from every page's meta tags. */
    const html=readdirSync(root).filter(n=>!n.startsWith('.'))
      .flatMap(n=>{
        const abs=path.join(root,n);
        if(n==='index.html') return [abs];
        try{ if(!statSync(abs).isDirectory()) return []; }catch{ return []; }
        if(['node_modules','app','tests','tools','src','supabase','functions'].includes(n)) return [];
        return readdirSync(abs,{recursive:true}).filter(f=>String(f).endsWith('.html'))
          .map(f=>path.join(abs,String(f)));
      });
    const referenced=new Set();
    for(const f of html){
      for(const m of readFileSync(f,'utf8').matchAll(/\/?img\/([A-Za-z0-9._-]+)/g)) referenced.add(m[1]);
    }
    const orphans=readdirSync(path.join(root,'img')).filter(f=>!referenced.has(f));
    expect(orphans,'unreferenced screenshots left in img/').toEqual([]);
  });

  test('outdated automatic screenshot capture is not part of the publishing workflow',()=>{
    expect(()=>read('tools/capture-marketing-screenshots.mjs')).toThrow();
    expect(()=>read('.github/workflows/refresh-marketing-shots.yml')).toThrow();
    expect(read('docs/app-screenshot-handoff.md')).toContain('IMG_7829.jpeg');
  });
});
