import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(path.join(root,p),'utf8');
const notes=JSON.parse(read('daily/notes.json'));
const archive=read('daily/index.html');
const home=read('index.html');
const learn=read('learn/index.html');

describe('The Daily Blueprint content and return-visit experience',()=>{
  test('exactly 30 unique reviewed notes are published with complete practical teaching',()=>{
    expect(notes).toHaveLength(30);
    expect(new Set(notes.map(n=>n.id)).size).toBe(30);
    for(const note of notes){
      for(const key of ['id','title','belief','why','action','principle','link','category']){
        expect(typeof note[key],key+' missing').toBe('string');
        expect(note[key].trim().length,key+' empty').toBeGreaterThan(key==='category'?3:5);
      }
      expect(note.id).toMatch(/^[a-z0-9-]+$/);
      expect(note.link).toMatch(/^\/(?:[a-z0-9-]+\/)+$/);
      expect(existsSync(path.join(root,note.link,'index.html')),note.link+' missing').toBe(true);
      expect(archive).toContain('id="'+note.id+'"');
      expect(archive).toContain(note.title.replace(/&/g,'&amp;'));
      expect(archive).toContain(note.action.replace(/&/g,'&amp;'));
    }
  });

  test('all notes are in static accessible HTML, not only loaded through JavaScript',()=>{
    expect((archive.match(/<details class="daily-note"/g)||[])).toHaveLength(30);
    expect((archive.match(/data-share="/g)||[])).toHaveLength(30);
    expect(archive).toMatch(/<main class="wrap">/);
    expect(archive).toContain('A different note is featured each day');
    expect(archive).toContain('Featured notes rotate daily from the archive.');
    expect(archive).toContain('document.querySelectorAll');
    expect(archive).toContain("addEventListener('hashchange',jump)");
  });

  test('sharing is first-party, private, and links are stable',()=>{
    expect(archive).toContain('https://theblueprint.site/daily/#');
    expect(archive).not.toContain('http://www.google-analytics.com');
    expect(archive).not.toContain('gtag(');
    expect(archive).toContain('No account, payment, or personal data required');
  });

  test('the homepage offers free action before paid features',()=>{
    /* Asserted on the ORDER OF THE FREE PATHS, not on the ids of the
       sections that used to hold them. The home page had three parallel
       free funnels: a full-width daily note, the assessment in the hero,
       and a "start without buying anything" grid. They are one funnel now,
       and the guarantee that survives all of that is the one that matters:
       every free route appears before the price, and the price is last. */
    const hero=home.slice(home.indexOf('<section class="hero"'),home.indexOf('</section>',home.indexOf('<section class="hero"')));
    expect(hero).toContain('Experience alone');
    expect(hero.indexOf('href="/assessment/"')).toBeGreaterThan(0);
    expect(hero.indexOf('href="/assessment/"')).toBeLessThan(hero.indexOf('href="#get"'));
    const price=home.indexOf('<section id="get">');
    expect(price).toBeGreaterThan(0);
    for(const free of ['/assessment/','/daily/','/last-longer/','/stronger-erections/',
                       '/better-sexual-performance/','/size-enhancement/']){
      const at=home.indexOf('href="'+free+'"',home.indexOf('SITE-NAV:END -->'));
      expect(at,free+' is not offered in the page body').toBeGreaterThan(0);
      expect(at,free+' is offered only after the price').toBeLessThan(price);
    }
    expect(home.slice(price+1),'the price section is not last').not.toContain('<section');
    expect(home).toContain('id="get"');
    expect(home).toContain('var ON = true;');
    expect(home).toContain('var PRICE_LABEL = \'$99\';');
  });

  test('free notes are discoverable through the library, shared header and sitemap',()=>{
    expect(learn).toContain('href="/daily/"');
    expect(read('tools/site-nav.html')).toContain('href="/daily/"');
    expect(read('sitemap.xml')).toContain('https://theblueprint.site/daily/');
    expect(read('tools/sync-site-nav.mjs')).toContain("'daily/index.html'");
  });
});
