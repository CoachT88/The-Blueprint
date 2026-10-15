import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

describe('personal Blueprint presentation',()=>{
    let app;
    beforeAll(async()=>{app=await openApp();},60000);
    afterAll(async()=>{await app?.close();});

    test('sign-in and account creation remain reachable on a short phone',async()=>{
        await app.page.setViewportSize({width:320,height:568});
        await app.page.locator('#auth-email').fill('member@example.com');
        expect(await app.page.locator('label[for="auth-email"]').textContent()).toBe('Purchase email');
        await app.page.locator('#tab-signup').click();
        await app.page.locator('#auth-confirm').fill('example-password');
        await app.page.locator('#auth-submit-btn').scrollIntoViewIfNeeded();
        const box=await app.page.locator('#auth-submit-btn').boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y+box.height).toBeLessThanOrEqual(568);
        expect(await app.page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);
        await app.page.locator('#tab-login').click();
    });

    test('all four goal choices and Done remain reachable without footer overlap',async()=>{
        await signIn(app.page,{persisted:{primaryGoal:'stamina'}});
        await app.page.evaluate(()=>showOnboarding(_obLastIdx(),true));
        for(const goal of ['size','stamina','eq','all']){
            const option=app.page.locator(`#goal-options [data-goal="${goal}"]`);
            await option.scrollIntoViewIfNeeded();
            const box=await option.boundingBox();
            const next=await app.page.locator('#ob-next-btn').boundingBox();
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.y+box.height).toBeLessThan(next.y);
        }
        expect(await app.page.locator('[data-goal="stamina"]').getAttribute('aria-pressed')).toBe('true');
        await app.page.locator('#ob-next-btn').click();
        expect(await app.page.locator('#onboarding-overlay').isVisible()).toBe(false);
    });

    test('goal identity updates on HQ and completion without writing training state',async()=>{
        for(const [key,label] of Object.entries({size:'Size',stamina:'Lasting longer',eq:'Erection quality',all:'All of it'})){
            const result=await app.page.evaluate(key=>{
                persisted.primaryGoal=key;
                const before=JSON.stringify(persisted),writes=window.__writes.length;
                renderMemberGoal();
                return {texts:[...document.querySelectorAll('[data-member-goal]')].map(e=>e.textContent),
                    unchanged:before===JSON.stringify(persisted),writes:window.__writes.length-writes};
            },key);
            expect(result.texts).toEqual([`Your focus: ${label}`,`Your focus: ${label}`]);
            expect(result.unchanged).toBe(true);expect(result.writes).toBe(0);
        }
        await app.page.evaluate(()=>{persisted.primaryGoal='';renderMemberGoal();});
        expect(await app.page.locator('[data-member-goal]:not(.hidden)').count()).toBe(0);
    });

    test('session completion still asks the member to save',async()=>{
        await app.page.evaluate(()=>{persisted.primaryGoal='stamina';goToStep(5);});
        expect(await app.page.locator('#finish-session-btn').textContent()).toMatch(/Save session/);
        expect(await app.page.locator('#step-5 .bp-completion-copy').textContent()).toMatch(/Save your session/);
        expect(await app.page.locator('#step-5 [data-member-goal]').textContent()).toContain('Lasting longer');
    });

    test('primary action text keeps at least 4.5:1 contrast and keyboard focus stays visible',async()=>{
        const result=await app.page.locator('#finish-session-btn').evaluate(button=>{
            const style=getComputedStyle(button);
            const lum=color=>color.match(/[\d.]+/g).slice(0,3).map(Number)
                .map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
                .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
            const values=[lum(style.color),lum(style.backgroundColor)].sort((a,b)=>a-b);
            return (values[1]+.05)/(values[0]+.05);
        });
        expect(result).toBeGreaterThanOrEqual(4.5);
        await app.page.keyboard.press('Tab');
        await app.page.locator('#finish-session-btn').focus();
        expect(await app.page.locator('#finish-session-btn').evaluate(e=>getComputedStyle(e).outlineStyle)).not.toBe('none');
        expect(app.errors).toEqual([]);
    });
});
