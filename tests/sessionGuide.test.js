import {describe,test,expect,vi} from 'vitest';
import {createGuideSpeech} from '../src/sessionGuide.js';

function setup(){
    const synth={speak:vi.fn(),cancel:vi.fn()};
    let allowed=true;const unavailable=vi.fn();
    const guide=createGuideSpeech({synth,Utterance:class{constructor(text){this.text=text;}},
        isAllowed:()=>allowed,onUnavailable:unavailable});
    return {guide,synth,unavailable,setAllowed:v=>allowed=v};
}
describe('optional spoken guidance is isolated from execution',()=>{
    test('starts silent and requires an explicit enable',()=>{
        const {guide,synth}=setup();expect(guide.say('Breathe gently.')).toBe(false);
        expect(synth.speak).not.toHaveBeenCalled();guide.setEnabled(true);
        expect(guide.say('Breathe gently.')).toBe(true);
    });
    test('repeated ticks do not queue duplicate speech',()=>{
        const {guide,synth}=setup();guide.setEnabled(true);
        for(let i=0;i<20;i++)guide.say('Fully release.');
        expect(synth.speak).toHaveBeenCalledTimes(1);
        guide.say('Gently lift.');expect(synth.speak).toHaveBeenCalledTimes(2);
    });
    test('a new cue cancels queued old instructions',()=>{
        const {guide,synth}=setup();guide.setEnabled(true);guide.say('First cue.');guide.say('Next cue.');
        expect(synth.cancel).toHaveBeenCalledTimes(2);
        expect(synth.speak.mock.calls.at(-1)[0].text).toBe('Next cue.');
    });
    test('paused, hidden, or another account cannot speak',()=>{
        const {guide,synth,setAllowed}=setup();guide.setEnabled(true);setAllowed(false);
        expect(guide.say('Continue.')).toBe(false);expect(synth.speak).not.toHaveBeenCalled();
    });
    test('cancellation allows the same instruction after a deliberate resume',()=>{
        const {guide,synth}=setup();guide.setEnabled(true);guide.say('Fully release.');guide.cancel();guide.say('Fully release.');
        expect(synth.speak).toHaveBeenCalledTimes(2);
        guide.setEnabled(false);expect(guide.say('Next.')).toBe(false);
    });
    test('speech failures fall back to silent guidance without throwing',()=>{
        const {guide,synth,unavailable}=setup();guide.setEnabled(true);synth.speak.mockImplementation(()=>{throw Error('unavailable')});
        expect(()=>guide.say('Breathe gently.')).not.toThrow();expect(guide.isEnabled()).toBe(false);expect(unavailable).toHaveBeenCalledTimes(1);
    });
    test('a stale error from a canceled cue cannot turn off its replacement',()=>{
        const {guide,synth,unavailable}=setup();guide.setEnabled(true);guide.say('First.');const old=synth.speak.mock.calls[0][0];
        guide.say('Next.');old.onerror({error:'synthesis-failed'});
        expect(guide.isEnabled()).toBe(true);expect(unavailable).not.toHaveBeenCalled();
        synth.speak.mock.calls[1][0].onerror({error:'not-allowed'});
        expect(guide.isEnabled()).toBe(false);expect(unavailable).toHaveBeenCalledTimes(1);
    });
    test('unsupported browsers retain the on-screen path',()=>{
        const guide=createGuideSpeech();expect(guide.available).toBe(false);expect(guide.setEnabled(true)).toBe(false);
        expect(()=>guide.cancel()).not.toThrow();expect(guide.say('Hello.')).toBe(false);
    });
});
