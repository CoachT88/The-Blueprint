import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(path.join(root,p),'utf8');
const SPECS=[["cardio-erections","stronger-erections","Does Cardiovascular Exercise Support Erections?"],["weaker-morning-erections","stronger-erections","Why Are My Morning Erections Weaker?"],["anxiety-or-physical-ed","stronger-erections","How Do I Investigate Performance Anxiety and Physical Causes?"],["finish-quickly-penetration","last-longer","Why Do I Finish Quickly During Penetration?"],["ejaculation-warning-signs","last-longer","How Do I Recognize When I Am Close to Ejaculation?"],["arousal-awareness-practice","last-longer","How Can I Practice Arousal Awareness?"],["last-longer-alone-than-sex","last-longer","Why Do I Last Longer Alone Than During Sex?"],["breathing-manage-arousal","better-sexual-performance","Can Breathing Help Manage Arousal?"],["sleep-erections-libido","better-sexual-performance","How Does Sleep Affect Erections and Libido?"],["stay-composed-during-arousal","better-sexual-performance","How Can I Stay Composed When Arousal Increases?"]];
const visible=s=>s.replace(/<script[\s\S]*?<\/script>/g,' ')
   .replace(/<style[\s\S]*?<\/style>/g,' ')
   .replace(/<!-- SITE-NAV:START -->[\s\S]*?<!-- SITE-NAV:END -->/g,' ')
   .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
const allowed=new Set(['www.niddk.nih.gov','www.cdc.gov','www.nhs.uk',
  'www.mayoclinic.org','my.clevelandclinic.org','www.urologyhealth.org']);
const required=['Three principles worth keeping','Try This:','When to get medical help',
  'Where this information comes from','Related guides','Your next step'];

describe('Phase 1: the ten missing guides are now fully published',()=>{
 test('all 10 source pages exist, have live topic-hub links and appear in /learn/ and sitemap',()=>{
   expect(SPECS).toHaveLength(10);
   for(const [slug,hub] of SPECS){
     expect(existsSync(path.join(root,slug,'index.html'))).toBe(true);
     expect(read(hub+'/index.html')).toContain('href="/'+slug+'/"');
     expect(read('learn/index.html')).toContain('href="/'+slug+'/"');
     expect(read('sitemap.xml')).toContain('https://theblueprint.site/'+slug+'/');
     expect(read('tools/sync-site-nav.mjs')).toContain("'"+slug+"/index.html'");
   }
 });
 test('no topic hub leaves a listed question marked as unfinished',()=>{
   for(const hub of ['stronger-erections','last-longer','better-sexual-performance']){
     const s=read(hub+'/index.html');
     expect(s).not.toContain('Guides for the remaining topics are being prepared.');
     const list=s.match(/<ul class="guide-list">([\s\S]*?)<\/ul>/)?.[1]||'';
     const items=[...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m=>m[1]);
     expect(items.length).toBeGreaterThan(4);
     expect(items.every(x=>x.includes('href="/'))).toBe(true);
   }
 });
 for(const [slug,hub,title] of SPECS){
   const src=read(slug+'/index.html');
   test(slug+': direct answer, correct metadata and a full 10-section guide',()=>{
     expect(src).toContain('<h1>'+title+'</h1>');
     expect(src).toContain('<link rel="canonical" href="https://theblueprint.site/'+slug+'/">');
     const lead=src.match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1]||'';
     expect(lead.length).toBeGreaterThan(160);
     const nums=[...src.matchAll(/<h2>(\d+)\. /g)].map(m=>Number(m[1]));
     expect(nums).toEqual([1,2,3,4,5,6,7,8,9,10]);
     for(const part of required)expect(src).toContain(part);
     const schema=JSON.parse(src.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
     expect(schema['@graph'].find(x=>x['@type']==='Article').isAccessibleForFree).toBe(true);
     expect(schema['@graph'].find(x=>x['@type']==='Article').author.name).toBe('The Blueprint');
     expect(JSON.stringify(schema)).not.toContain('reviewedBy');
     expect(schema['@graph'].find(x=>x['@type']==='Article').citation.length).toBeGreaterThanOrEqual(4);
   });
   test(slug+': principles teach, free plan works privately, medical safety exists',()=>{
     const cards=[...src.matchAll(/<div class="principle">([\s\S]*?)<\/div>/g)].map(m=>m[1]);
     expect(cards.length).toBe(3);
     for(const c of cards)for(const marker of ['<dt>Why it matters</dt>','<dt>Practical example</dt>','<dt>Apply it</dt>'])expect(c).toContain(marker);
     const section=src.slice(src.indexOf('<h2>6. Try This:'),src.indexOf('</section>',src.indexOf('<h2>6. Try This:')));
     expect(section).toContain('class="check"');
     expect((section.match(/<li>/g)||[]).length).toBeGreaterThanOrEqual(4);
     expect(visible(section)).toMatch(/nothing to buy.*nothing to sign up for.*no personal information/i);
     expect(visible(section)).toMatch(/cannot diagnose/);
     expect(section).not.toContain('<a ');
     expect(src).toContain('It does not diagnose or treat');
     expect(src).toContain('evaluated by a qualified healthcare professional');
     const medical=src.slice(src.indexOf('<h2>7. When '),src.indexOf('</section>',src.indexOf('<h2>7. When ')));
     expect((medical.match(/<li>/g)||[]).length).toBeGreaterThanOrEqual(4);
     expect(src).toContain('$99 one-time access.');
     expect((visible(src).match(/\$99/g)||[]).length).toBe(1);
     expect(src).toContain('href="/whats-inside/"');
     expect(src).toContain('href="/how-it-works/"');
   });
   test(slug+': sources, privacy and shared design are enforced',()=>{
     const refs=src.slice(src.indexOf('<h2>8. Where this information comes from'),src.indexOf('</section>',src.indexOf('<h2>8. Where this information comes from')));
     const links=[...refs.matchAll(/<a href="(https:\/\/[^"]+)"([^>]*)>/g)];
     expect(links.length).toBeGreaterThanOrEqual(4);
     for(const [,url,attrs] of links){
       expect(allowed.has(new URL(url).host),url).toBe(true);
       expect(attrs).toContain('target="_blank"');
       expect(attrs).toContain('rel="noopener noreferrer"');
     }
     expect((refs.match(/Supports /g)||[]).length).toBeGreaterThanOrEqual(4);
     expect(src.match(/<style>[\s\S]*?<\/style>/g)).toHaveLength(1);
     const css=src.match(/\/\* GUIDE-CSS:START \*\/([\s\S]*?)\/\* GUIDE-CSS:END \*\//)?.[1];
     expect(css?.trim()).toBe(read('tools/guide.css').trim());
     expect(src.match(/<!-- SITE-NAV:START -->([\s\S]*?)<!-- SITE-NAV:END -->/)?.[1].trim()).toBe(read('tools/site-nav.html').trim());
     const body=src.replace(/<!-- SITE-NAV:START -->[\s\S]*?<!-- SITE-NAV:END -->/,'');
     expect(body).not.toMatch(/localStorage|sessionStorage|document\.cookie|gtag|fbq\(/);
     expect((body.match(/<script /g)||[])).toHaveLength(1);
     expect(src).not.toMatch(/[—–]/);
   });
 }
});
