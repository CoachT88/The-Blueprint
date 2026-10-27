import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const home = readFileSync('index.html','utf8');
const section = id => {
  const start=home.indexOf(id==='top'?'<section class="hero" id="top">':`<section id="${id}">`);
  if (start<0) throw new Error(`No #${id} section`);
  return home.slice(start,home.indexOf('</section>',start)+10);
};

describe('Homepage: clear value, fewer decisions, truthful offer',()=>{
  test('hero identifies the buyer problem, the app payoff and two simple paths',()=>{
    const hero=section('top');
    expect(hero).toContain("Experience alone doesn't make you better in bed.");
    expect(hero).toContain('The Blueprint gives you a place to start and a way to practice.');
    expect(hero).toContain('guided sessions');
    expect(hero).toContain('length or girth');
    expect(hero).toContain('track your own progress');
    expect(hero).toContain('Find my starting point — free');
    expect(hero).toContain('See the $99 app');
    expect(hero).toContain('$99 once &middot; No subscription &middot; Future app updates included');
    expect((hero.match(/class="btn(?: ghost)?"/g)||[])).toHaveLength(2);
    expect(hero).toContain('href="/assessment/"');
    expect(hero).toContain('href="/whats-inside/"');
  });
  test('choice is by goal, not a duplicate list of fears plus cards',()=>{
    const why=section('why');
    for(const goal of ['/last-longer/','/stronger-erections/','/better-sexual-performance/','/size-enhancement/']){
      expect(why).toContain(`href="${goal}"`);
    }
    expect((why.match(/class="card goal"/g)||[])).toHaveLength(4);
    expect(why).not.toContain('<ul class="thoughts">');
    expect(why).toContain('free information');
    expect(why).toContain('href="/assessment/"');
  });
  test('method is expressed as three visible steps, with deeper info optional',()=>{
    const how=section('how');
    expect((how.match(/class="card plan-step"/g)||[])).toHaveLength(3);
    expect(how).toContain('Start where you are.');
    expect(how).toContain('Know your next move.');
    expect(how).toContain('See what changes.');
    expect(how).toContain('aria-label="Your Blueprint in three steps"');
    expect(how).toContain('<details class="more">');
    expect(how).toContain('Length training');
    expect(how).toContain('Pelvic floor control');
    expect(how).toMatch(/Progress and responses vary/i);
  });
  test('proof is related to this offer, not a different app',()=>{
    const proof=section('proof');
    expect(proof).toContain('What men have shared with Coach Tee.');
    expect(proof).not.toContain('Lazy GymRat');
    expect((proof.match(/<figure class="quote">/g)||[])).toHaveLength(3);
    expect(proof).toContain('These are individual');
  });
  test('genuine owner images and the real checkout still have the same route',()=>{
    const look=section('look');
    const offer=section('get');
    expect(look).toContain('img/app-today-2026.jpg');
    expect(look).toContain('img/app-guided-practice-2026.jpg');
    expect(offer).toContain('id="buy-onsite"');
    expect(offer).toContain('$99');
    expect(home).toContain('id="get"');
  });
});
