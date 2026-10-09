/**
 * Turn a classified programme into dated plans, and derive the legacy week
 * from them.
 *
 * This is the authority transition. After it, dated day plans are the
 * programme and the seven-slot `schedule` column is a compatibility
 * projection derived from them. The flow is one way:
 *
 *     programme -> dated day plans -> legacy 7-slot schedule -> consumers
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not change a single prescription. This is a REPRESENTATION change:
 * the slot that says 'girth' today becomes a dated plan whose primary session
 * is 'girth', carrying the dose the existing engine would resolve. Only one of
 * the four programmes has a frozen design and even that one has open numbers,
 * so inventing programme content here would be authoring product policy
 * inside an infrastructure change.
 *
 * So no stage track, no supporting work, no daily practice, no new dose
 * policy. Those arrive in the phases where their design is frozen, and
 * `generatedFrom.version` on every stored plan records which content produced
 * it.
 *
 * NO BACKFILL, STATED AS ARITHMETIC RATHER THAN AS A PROMISE
 *
 * Generation starts at TODAY and runs to the end of next ISO week, so between
 * 8 and 14 plans depending on the weekday. A member who cuts over on a
 * Thursday gets Thursday onward and no Monday, Tuesday or Wednesday, because
 * for a date before day plans existed the honest value is absent. The first
 * draft of this generated the whole current week and would have written three
 * dates that had already passed.
 *
 * WHY THE PROJECTION READS NEXT WEEK
 *
 * The current week is partial on six days out of seven, and `toLegacySchedule`
 * refuses a week with a missing day, correctly. So the projection source is
 * the next COMPLETE Monday-to-Sunday week, which the horizon always contains
 * in full: horizonEnd is next Sunday by definition, and next Monday is at
 * most seven and at least one day away.
 *
 * That is sound only while every week is the same week, which is true in
 * version 1 because the weekly prescription is the member's fixed preset
 * array. A programme with week-varying orchestration cannot be represented
 * indefinitely by one recurring seven-slot column, and before that lands
 * either the external consumers migrate or there is a reviewed compatibility
 * policy. See docs/last-longer-design.md section 9.
 *
 * DATES ARE LOCAL CALENDAR DATES, AND THAT COST A CORRECTION
 *
 * A plan's date is the day the member lived through, so the key comes from
 * localDateKeyForWeekday: formatted from getFullYear/getMonth/getDate, never
 * through toISOString().
 *
 * The first version of this module used dateKeyForWeekday instead,
 * specifically so the keys would match what toLegacySchedule looked plans up
 * by, and said so approvingly. But src/weekUtils.js documents that helper as
 * a frozen legacy compatibility path whose local-noon to UTC conversion
 * shifts a date at extreme positive offsets, and its own tests pin the UTC+14
 * case. Matching formulas was right; matching them on the one with a known
 * date bug was not, and it would have made every authoritative plan identity
 * inherit it.
 *
 * So the projection's internal lookup moved to the local sibling as well.
 * Both still come from ONE helper, which is what keeps generation and lookup
 * from drifting apart, and the legacy helper is untouched for its existing
 * consumers.
 *
 * Pure: no DOM, no clock it was not handed, no globals, no mutation of
 * inputs. The routine tables live in the page and are injected, because a
 * second copy of a dose table here is how two prescriptions drift apart.
 */

import { normaliseDayPlan, DAY_MODE, PLAN_STATUS } from './dayPlan.js';
import { toLegacySchedule } from './scheduleSlot.js';
import { localDateKeyForWeekday, localDateKey } from './weekUtils.js';
/* The dose SCHEMA version, stamped on every dose this generator writes.
   Deliberately NOT PROGRAMME_CONTENT_VERSION: that one says which revision of
   a programme's CONTENT a plan came from, and this says what SHAPE the dose
   object has. A content change leaves the shape alone and a shape change says
   nothing about content, so one number could not answer either question. */
import { DOSE_SCHEMA_VERSION } from './doseExecution.js';

/** The programme vocabulary. What a member is ON. */
export const PROGRAMME_KEY = Object.freeze({
    SIZE:              'size',
    LAST_LONGER:       'lastLonger',
    ERECTION_QUALITY:  'erectionQuality',
    EVERYTHING:        'everything',
});

/**
 * The content version these plans were generated from.
 *
 * 1 means: the authoritative dated representation of the legacy prescription.
 * The frozen Last Longer stage track, and any real Size, EQ or Everything
 * programme design, are later versions. A stored plan's
 * generatedFrom.version is how a reader knows which it is looking at.
 */
export const PROGRAMME_CONTENT_VERSION = 1;

/** Why a cutover produced nothing. */
export const GENERATE_REFUSAL = Object.freeze({
    NOT_PERMITTED:   'not_permitted',
    NO_PROGRAMME_KEY:'no_programme_key',
    NO_WEEK_SHAPE:   'no_week_shape',
    INVALID_PLAN:    'invalid_generated_plan',
    PROJECTION:      'projection_failed',
});

/**
 * Legacy goal key to programme key, and back.
 *
 * `size` is in both vocabularies and means different things in each, which is
 * exactly how an edit assigns one from the other and reads plausibly. Both
 * directions are written out rather than derived, so neither can be inferred
 * wrongly.
 */
const KEY_FOR_PRESET = Object.freeze({
    size: PROGRAMME_KEY.SIZE,
    stamina: PROGRAMME_KEY.LAST_LONGER,
    eq: PROGRAMME_KEY.ERECTION_QUALITY,
    all: PROGRAMME_KEY.EVERYTHING,
});
const PRESET_FOR_KEY = Object.freeze({
    [PROGRAMME_KEY.SIZE]: 'size',
    [PROGRAMME_KEY.LAST_LONGER]: 'stamina',
    [PROGRAMME_KEY.ERECTION_QUALITY]: 'eq',
    [PROGRAMME_KEY.EVERYTHING]: 'all',
});

const DAY_MS = 86400000;
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const KEYS = Object.freeze(Object.values(PROGRAMME_KEY));

/**
 * Which programme is this member on?
 *
 * A MAPPING, NOT A GATE. mayGenerateOver() decides whether generation is
 * permitted and is the only place that decision is made; this decides which
 * programme, and returns null when there is nothing to map. A custom member
 * has no preset to map from, so null falls out of the data rather than being
 * a second permission judgement.
 *
 * An already-cut-over programme keeps its key: the key is the cutover marker
 * and re-deriving it on every load would be a chance to change it.
 */
export function programmeKeyFor(programme) {
    if (!isPlainObject(programme)) return null;
    if (KEYS.includes(programme.key)) return programme.key;
    const m = programme.migration;
    if (!isPlainObject(m)) return null;
    /* The default cohort's stored week is byte-identical to the Size preset,
       so Size reproduces it exactly. This establishes a programme. It does
       NOT claim the member chose Size as a goal, and primaryGoal is left
       exactly as it is. */
    if (m.source === 'default') return PROGRAMME_KEY.SIZE;
    if (m.source === 'preset') return KEY_FOR_PRESET[m.presetKey] || null;
    return null;
}

/** The seven-slot weekly shape a programme prescribes, from the real presets. */
export function weekShapeFor(key, presets) {
    const preset = PRESET_FOR_KEY[key];
    if (!preset || !isPlainObject(presets)) return null;
    const shape = presets[preset];
    return (Array.isArray(shape) && shape.length === 7) ? shape : null;
}

/**
 * Today through the end of next ISO week.
 *
 * Every key comes from localDateKeyForWeekday, so the set is exactly the 14
 * consecutive dates of this ISO week and the next, in the member's own
 * calendar, and filtering to those at or after today is what makes generation
 * forward-only.
 */
export function horizonFor(now) {
    const ref = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
    const monday = new Date(ref);
    monday.setHours(12, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const nextMonday = new Date(monday.getTime() + (7 * DAY_MS));

    /* Index is Date#getDay() order, so index 0 is the Sunday that ENDS the
       ISO week and index 1 is its Monday. Both weeks together are 14
       consecutive dates. */
    const all = [];
    for (let i = 0; i < 7; i++) all.push(localDateKeyForWeekday(monday, i));
    for (let i = 0; i < 7; i++) all.push(localDateKeyForWeekday(nextMonday, i));
    all.sort();

    const today = localDateKeyForWeekday(ref, ref.getDay());
    const dates = all.filter(d => d >= today);
    return { today, monday, nextMonday, horizonEnd: dates[dates.length - 1], dates };
}

/**
 * Today's plan date, in exactly the form stored plans use.
 *
 * A reader looking a plan up has to spell the key the same way the generator
 * and the projection do, or it finds nothing on the one day the formulas
 * disagree. Same helper, same answer.
 */
export function planDateKey(now) {
    const ref = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
    return localDateKeyForWeekday(ref, ref.getDay());
}

/**
 * The dose the existing engine would resolve, as resolved numbers.
 *
 * A stored dose has to be understandable later without consulting a policy
 * table that has since changed, so there are no references and no lookup
 * keys, only values. src/dayPlan.js refuses an indirection-only dose; this
 * does not produce one at any depth.
 *
 * Two shapes because the engine genuinely has two. Set-based work goes
 * through the tier offsets; girth ignores them entirely and the circuit table
 * IS the dose, which is what getCurEx() does.
 *
 * Readiness is NOT in here. Deload and moderate soreness stay applied at
 * session time, as today. This records what the programme asked for, not what
 * the member will do on the day, the same separation the ledger keeps between
 * a stored target and the session log.
 */
export function resolveDose(type, tier, tables) {
    const t = isPlainObject(tables) ? tables : {};
    const routines = isPlainObject(t.routines) ? t.routines : {};
    const list = Array.isArray(routines[type]) ? routines[type] : null;
    if (!list || !list.length) return null;

    if (type === 'girth') {
        const table = isPlainObject(t.girthCircuit) ? t.girthCircuit : {};
        const cfg = table[tier] || table.intermediate;
        if (!isPlainObject(cfg)) return null;
        /* The title is the discriminator because that is what getCurEx() uses;
           both girth exercises carry isGirthCircuit, so the flag cannot tell
           them apart. A drift test pins the titles. */
        const stations = list.map(ex => ({
            title: ex.title,
            duration: ex.title === 'Wet Jelq' ? cfg.jelqDur : cfg.uliDur,
        }));
        const dose = { v: DOSE_SCHEMA_VERSION, shape: 'circuit', tier, rounds: cfg.rounds, stations };
        if (typeof cfg.restDur === 'number') dose.restDur = cfg.restDur;
        return dose;
    }

    const diffs = Array.isArray(t.difficulties) ? t.difficulties : [];
    const diff = diffs.find(d => d && d.id === tier) || diffs[1];
    if (!isPlainObject(diff)) return null;
    /* Elite falls back to the advanced override, matching applyDifficulty. */
    const expKey = diff.id === 'elite' ? 'advanced' : diff.id;
    const overrides = isPlainObject(t.exExperience) ? t.exExperience : {};
    const directions = Array.isArray(t.directionals) ? t.directionals.length : 0;

    const exercises = list.map(ex => {
        const ov = overrides[ex.title] && overrides[ex.title][expKey];
        const out = isPlainObject(ov)
            ? { title: ex.title, sets: ov.sets, duration: ov.duration }
            : {
                title: ex.title,
                sets: Math.max(1, ex.sets + diff.setsOffset),
                duration: Math.round(ex.duration * diff.durationMult),
            };
        /* Resolved to a count, not a reference to the direction list. */
        if (ex.isDirectional && directions) out.directions = directions;
        if (typeof ex.restDur === 'number') out.restDur = ex.restDur;
        return out;
    });
    return { v: DOSE_SCHEMA_VERSION, shape: 'sets', tier, exercises };
}

/** One dated plan, from one legacy slot. */
function planFor(date, slot, opts) {
    const { key, tier, tables, generatedAt } = opts;
    const base = {
        date,
        supportingWork: [],
        dailyPractice: [],
        status: PLAN_STATUS.PENDING,
        generatedAt,
        generatedFrom: { programmeKey: key, version: PROGRAMME_CONTENT_VERSION },
    };
    if (slot === 'rest') return { ...base, mode: DAY_MODE.REST, primarySession: null };
    const dose = resolveDose(slot, tier, tables);
    const primarySession = { type: slot, tier };
    if (dose) primarySession.dose = dose;
    return { ...base, mode: DAY_MODE.PRESCRIBED, primarySession };
}

/**
 * The plans for the horizon, forward only.
 *
 * The slot for a date is the weekly shape indexed by that date's weekday, so
 * the generated week IS the member's existing week. That is what makes the
 * projection a no-op on the compatibility column in version 1.
 */
export function generatePlans(input) {
    const i = isPlainObject(input) ? input : {};
    const key = i.key;
    const shape = weekShapeFor(key, i.presets);
    if (!shape) return { ok: false, reason: GENERATE_REFUSAL.NO_WEEK_SHAPE };

    const h = horizonFor(i.now);
    const generatedAt = (i.now instanceof Date && !isNaN(i.now.getTime())
        ? i.now : new Date()).toISOString();
    const tier = typeof i.tier === 'string' && i.tier ? i.tier : 'intermediate';

    const plans = h.dates.map(date => {
        /* Weekday from the date key itself, at local noon, so the slot for a
           date never depends on when generation ran. */
        const weekday = new Date(date + 'T12:00:00').getDay();
        return planFor(date, shape[weekday], { key, tier, tables: i.tables, generatedAt });
    });

    for (const p of plans) {
        if (normaliseDayPlan(p) === null) {
            return { ok: false, reason: GENERATE_REFUSAL.INVALID_PLAN, detail: p.date };
        }
    }
    return { ok: true, plans, horizon: h };
}

/** Everything except provenance, for deciding whether a plan really changed. */
const contentOf = (p) => {
    if (!isPlainObject(p)) return '';
    const { generatedAt: _drop, ...rest } = p;
    return JSON.stringify(rest);
};

/**
 * Merge generated plans with retained history.
 *
 * THE RULE, AND TODAY IS THE INTERESTING CASE
 *
 *   a past date               immutable
 *   today, already stored     immutable, EVEN IF IT DOES NOT VALIDATE
 *   today, absent             generate it
 *   tomorrow onward           may regenerate
 *
 * So a first cutover still creates Today, and from then on Today is
 * historical prescription truth for the rest of that local date: a second
 * load, a tier change, a content-version recalculation all leave it
 * byte-identical, generatedAt included.
 *
 * A CORRUPT TODAY IS PRESERVED RATHER THAN REPLACED, which is the part worth
 * explaining. An unreadable plan is not trustworthy programme truth, but
 * neither do we know what its original valid prescription was. Regenerating
 * it from the member's CURRENT programme and tier would manufacture a
 * replacement prescription and destroy the evidence that the stored record
 * became corrupt. The safer failure mode is to preserve the ambiguity, report
 * it, and let the reader fall back to the compatibility column for the
 * remainder of the day. See getScheduledType in app/index.html.
 *
 * A regenerated FUTURE plan whose content matches the stored one keeps the
 * stored generatedAt. Otherwise every load would churn provenance and nothing
 * would ever be idempotent.
 */
export function retainPlans(existing, generated, opts) {
    const o = isPlainObject(opts) ? opts : {};
    const today = typeof o.today === 'string' ? o.today : '';
    const maxPlans = Number.isFinite(o.maxPlans) ? o.maxPlans : 70;
    const maxPastDays = Number.isFinite(o.maxPastDays) ? o.maxPastDays : 56;
    const budget = Number.isFinite(o.budget) ? o.budget : 60000;

    const stored = new Map();
    for (const p of (Array.isArray(existing) ? existing : [])) {
        if (isPlainObject(p) && typeof p.date === 'string') stored.set(p.date, p);
    }

    /* Eight weeks, because the progression gate is four of eight: a plan
       older than the progression window answers no live question. */
    let oldestKept = '';
    if (today) {
        /* `today` is an authoritative LOCAL date key, and the cutoff compared
           against stored plan dates has to be one too. Parsing at T12:00:00
           with no zone is local, and setDate is local arithmetic, so only the
           formatting was wrong: toISOString() here put the cutoff a day early
           at UTC+13 and UTC+14 and would have dropped a plan that is exactly
           on the boundary. The same shift the generation side already shed. */
        const d = new Date(today + 'T12:00:00');
        d.setDate(d.getDate() - maxPastDays);
        oldestKept = localDateKey(d);
    }

    const out = [];
    const kept = new Set();
    for (const [date, plan] of stored) {
        if (today && date > today) continue;           // the generator owns these
        if (oldestKept && date < oldestKept) continue; // beyond retention
        out.push(plan);
        kept.add(date);                                // today included, as written
    }
    for (const p of (Array.isArray(generated) ? generated : [])) {
        if (kept.has(p.date)) continue;                // already immutable
        const prev = stored.get(p.date);
        out.push(prev && contentOf(prev) === contentOf(p) ? prev : p);
    }
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    let trimmed = out.length > maxPlans ? out.slice(out.length - maxPlans) : out;
    /* Byte backstop, oldest first, so a hand-edited import cannot blow the
       row. Never drops a generated plan: those are the newest. */
    while (trimmed.length > 1 && JSON.stringify(trimmed).length > budget) {
        trimmed = trimmed.slice(1);
    }
    return trimmed;
}

/**
 * The whole cutover, decided purely.
 *
 * Returns everything the caller should commit, or a refusal. The caller
 * assigns nothing until this returns ok, so a refusal cannot leave a
 * half-written pair, and `schedule` is only ever written together with the
 * plans that produced it.
 *
 * `permitted` is passed in rather than computed: mayGenerateOver() is the only
 * authority gate and this function must not become a second one.
 */
export function cutoverPlan(input) {
    const i = isPlainObject(input) ? input : {};
    if (i.permitted !== true) return { ok: false, reason: GENERATE_REFUSAL.NOT_PERMITTED };

    const programme = isPlainObject(i.programme) ? i.programme : null;
    const key = programmeKeyFor(programme);
    if (!key) return { ok: false, reason: GENERATE_REFUSAL.NO_PROGRAMME_KEY };

    const gen = generatePlans({
        key, now: i.now, tier: i.tier, presets: i.presets, tables: i.tables,
    });
    if (!gen.ok) return gen;

    const dayPlans = retainPlans(i.existingPlans, gen.plans, {
        today: gen.horizon.today,
        maxPlans: i.maxPlans,
        maxPastDays: i.maxPastDays,
        budget: i.budget,
    });

    /* The next COMPLETE Monday-to-Sunday week. The current week is partial on
       six days out of seven and toLegacySchedule refuses a missing day. */
    const proj = toLegacySchedule(dayPlans, gen.horizon.nextMonday);
    if (!proj.ok) {
        return {
            ok: false,
            reason: GENERATE_REFUSAL.PROJECTION,
            detail: proj.reason,
            unrepresentable: proj.unrepresentable,
        };
    }

    return {
        ok: true,
        dayPlans,
        schedule: proj.slots,
        /* Spread, never rebuilt: migration provenance is historical and
           authority changing does not change what was classified or when.
           adoptedAt is untouched, because automatic migration is not member
           adoption. */
        programme: {
            ...programme,
            key,
            version: PROGRAMME_CONTENT_VERSION,
            cyclePosition: null,
        },
        horizon: gen.horizon,
    };
}
