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
    const hero=home.slice(home.indexOf('<section class="hero"'),home.indexOf('</section>',home.indexOf('<section class="hero"')));
    expect(hero).toContain('Experience alone');
    expect(hero.indexOf('href="/assessment/"')).toBeGreaterThan(0);
    expect(hero.indexOf('href="/assessment/"')).toBeLessThan(hero.indexOf('href="#get"'));
    expect(home.indexOf('id="daily-note"')).toBeLessThan(home.indexOf('id="inside"'));
    expect(home.indexOf('id="start-free"')).toBeLessThan(home.indexOf('id="inside"'));
    expect(home).toContain("fetch('/daily/notes.json')");
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
