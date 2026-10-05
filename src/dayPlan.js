/**
 * What is a valid day plan?
 *
 * That is the only question this module answers. Not which programme
 * generated it, not what tomorrow should be, not whether the member
 * progresses, not how readiness modifies it, not whether a missed day moves
 * forward. Those belong to later phases and none of them are here.
 *
 * WHY A DATED PLAN AT ALL
 *
 * The programme is currently seven strings in an array indexed by
 * Date#getDay(). That shape cannot say that a day has supporting work, that a
 * rest day still carries a daily practice, or what dose was actually
 * prescribed. It also has no history: the progression ledger exists precisely
 * because the schedule cannot answer what a past week asked for.
 *
 * THREE KINDS OF WORK, AND THEY STAY APART
 *
 *   Primary Training Session   at most one per day. The only thing that can
 *                              ever earn progression.
 *   Supporting Work            zero or more. Scheduled, but never qualifying.
 *   Daily Practice             zero or more. May continue on a Rest day
 *                              without converting it into a training day, and
 *                              never touches the day's status.
 *
 * They are three separate fields rather than one list with a kind flag,
 * because a flag makes every consumer responsible for filtering and one of
 * them eventually would not. programmeWork() exists for the same reason: it
 * returns exactly the items a status may be computed over, so a caller asks
 * the module what counts instead of remembering.
 *
 * MODE IS WHAT THE PROGRAMME PRESCRIBED, NOT WHETHER WE COULD READ THE RECORD
 *
 * The four modes describe valid prescribed states. A corrupt record is not a
 * fifth kind of prescribed day, it is a data-integrity condition, and mixing
 * the two would let a parse failure masquerade as programme state. So a plan
 * whose identity or mode cannot be read is not repaired and not relabelled:
 * normaliseDayPlan() returns null, and validateDayPlan() keeps the reason so
 * a later layer can tell "no plan existed" from "a dated record existed and
 * could not be interpreted" without inventing a training mode for it.
 *
 * Unknown data must not silently become Rest. Data-integrity state must not
 * become programme state either.
 *
 * Pure: no DOM, no globals, no clock, no mutation of inputs. Deterministic.
 */

/** Valid prescribed states. Deliberately closed. */
export const DAY_MODE = Object.freeze({
    PRESCRIBED: 'prescribed',
    MODIFIED:   'modified',
    PROTECTIVE: 'protective',
    REST:       'rest',
});

export const PLAN_STATUS = Object.freeze({
    PENDING:   'pending',
    COMPLETED: 'completed',
    PARTIAL:   'partial',
    MISSED:    'missed',
});

/** The three work kinds. Used to select per-kind field handling. */
export const WORK_KIND = Object.freeze({
    PRIMARY:        'primary',
    SUPPORTING:     'supporting',
    DAILY_PRACTICE: 'dailyPractice',
});

/** Why a plan could not be read, or what was repaired inside one. */
export const VIOLATION = Object.freeze({
    INVALID_DATE:          'invalid_date',
    INVALID_MODE:          'invalid_mode',
    INVALID_STATUS:        'invalid_status',
    NOT_AN_OBJECT:         'not_an_object',
    PRIMARY_NOT_SINGULAR:  'primary_not_singular',
    REST_HAS_PRIMARY:      'rest_has_primary',
    REST_HAS_SUPPORTING:   'rest_has_supporting',
    MALFORMED_ARRAY:       'malformed_array',
    MALFORMED_WORK_ITEM:   'malformed_work_item',
    UNRESOLVED_DOSE:       'unresolved_dose',
    MALFORMED_DOSE:        'malformed_dose',
});

const MODES    = new Set(Object.values(DAY_MODE));
const STATUSES = new Set(Object.values(PLAN_STATUS));

/* Known indirection-only shapes. A dose consisting solely of these is a
   pointer into a policy table, not a record of what the member was told to
   do, and the whole value of a snapshot is that it survives the table
   changing underneath it.

   This list cannot predict every future field name and is not trying to.
   The real guarantee is the rule below, not the blocklist. */
const POINTER_KEYS = new Set([
    'policykey', 'policyref', 'templatekey', 'templateref',
    'ref', '$ref', 'lookupkey', 'doseref',
]);

const isPlainObject = (v) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
    && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/**
 * A strict ISO local-date key, 'YYYY-MM-DD', that names a real calendar day.
 *
 * Deliberately strict. A weekday index, a timestamp, a Date, '2026-2-3' and
 * '2026-02-30' are all rejected rather than coerced, because the date is the
 * plan's identity and guessing it would place a record on a day it does not
 * belong to.
 */
export function isDateKey(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const [y, m, d] = v.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const probe = new Date(Date.UTC(y, m - 1, d));
    return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * Deep clone, or refuse.
 *
 * Returns { ok, value }. Anything not JSON-safe is refused rather than
 * silently dropped, which is the difference between this and
 * JSON.parse(JSON.stringify(x)): that would quietly turn a function into
 * nothing and a Date into a string, and a prescription that quietly changed
 * shape on the way into storage is the problem this module exists to avoid.
 */
export function cloneResolved(v, seen) {
    const stack = seen || new Set();
    if (v === null) return { ok: true, value: null };
    const t = typeof v;
    if (t === 'string' || t === 'boolean') return { ok: true, value: v };
    if (t === 'number') return Number.isFinite(v) ? { ok: true, value: v } : { ok: false };
    if (t !== 'object') return { ok: false };            // undefined, function, symbol, bigint
    if (stack.has(v)) return { ok: false };              // circular
    stack.add(v);
    try {
        if (Array.isArray(v)) {
            const out = [];
            for (const item of v) {
                const r = cloneResolved(item, stack);
                if (!r.ok) return { ok: false };
                out.push(r.value);
            }
            return { ok: true, value: out };
        }
        if (!isPlainObject(v)) return { ok: false };     // Date, Map, Set, class instances
        const out = {};
        for (const k of Object.keys(v)) {
            const r = cloneResolved(v[k], stack);
            if (!r.ok) return { ok: false };
            out[k] = r.value;
        }
        return { ok: true, value: out };
    } finally {
        stack.delete(v);
    }
}

/** An object whose every key is a known pointer: a reference, not a record. */
function isIndirectionOnly(v) {
    if (!isPlainObject(v)) return false;
    const keys = Object.keys(v);
    return keys.length > 0 && keys.every((k) => POINTER_KEYS.has(k.toLowerCase()));
}

/**
 * A resolved dose, or nothing.
 *
 * THE INVARIANT, stated as the rule rather than as a type: a stored dose is a
 * resolved immutable snapshot, and knowing what was prescribed that day must
 * never require dereferencing a mutable policy table.
 *
 * So the dose may be any JSON-safe resolved data. Not numbers only: a
 * four-programme model will legitimately need variants, tool identifiers,
 * direction or cadence, and forcing those through a numeric field would push
 * them somewhere worse.
 *
 * Returns { value } when resolved, { violation } when refused, or {} when
 * genuinely absent. **A missing dose stays missing.** Inventing one would be
 * fabricating a prescription nobody gave.
 */
function normaliseDose(raw) {
    if (raw === undefined || raw === null) return {};
    if (isIndirectionOnly(raw)) return { violation: VIOLATION.UNRESOLVED_DOSE };
    const r = cloneResolved(raw);
    return r.ok ? { value: r.value } : { violation: VIOLATION.MALFORMED_DOSE };
}

/**
 * One item of work, of a given kind.
 *
 * Shared handling for `type` and `dose`; the kind-specific fields are the
 * only thing that differs. Returns null for an item with no usable type,
 * because an item we cannot name is not work we can prescribe.
 */
function normaliseWorkItem(raw, kind, violations) {
    if (!isPlainObject(raw)) {
        violations.push({ code: VIOLATION.MALFORMED_WORK_ITEM, detail: { kind } });
        return null;
    }
    const type = typeof raw.type === 'string' ? raw.type.trim() : '';
    if (!type) {
        violations.push({ code: VIOLATION.MALFORMED_WORK_ITEM, detail: { kind, reason: 'no type' } });
        return null;
    }

    /* Unknown fields ride along for forward compatibility: an older cached
       shell must not strip data a newer version wrote. Known fields are
       overwritten below, so preservation never rescues a field we recognise
       and reject. */
    const out = { ...raw, type };

    const dose = normaliseDose(raw.dose);
    if (dose.violation) {
        violations.push({ code: dose.violation, detail: { kind, type } });
        delete out.dose;
    } else if ('value' in dose) {
        out.dose = dose.value;
    } else {
        delete out.dose;                       // absent stays absent
    }

    // Kind-specific fields. Anything of the wrong type is dropped, not coerced.
    if (kind === WORK_KIND.PRIMARY) {
        if (typeof raw.tier !== 'string' || !raw.tier.trim()) delete out.tier;
        else out.tier = raw.tier.trim();
        delete out.category;
    } else {
        if (kind === WORK_KIND.SUPPORTING) {
            if (typeof raw.category !== 'string' || !raw.category.trim()) delete out.category;
            else out.category = raw.category.trim();
        } else {
            delete out.category;
        }
        if (typeof raw.required !== 'boolean') delete out.required;   // never invented
        delete out.tier;
    }
    return out;
}

function normaliseWorkArray(raw, kind, violations) {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
        violations.push({ code: VIOLATION.MALFORMED_ARRAY, detail: { kind } });
        return [];
    }
    const out = [];
    for (const item of raw) {
        const n = normaliseWorkItem(item, kind, violations);
        if (n) out.push(n);
    }
    return out;
}

/**
 * The load boundary.
 *
 * jsonb enforces no shape, so anything arriving from storage is untrusted: it
 * may predate this phase, come from a restored backup, or have been written
 * by a version a cached shell has not seen.
 *
 * Returns null when the plan cannot be identified or its mode cannot be read.
 * Those are data-integrity conditions, not prescribed states, so the plan is
 * refused rather than repaired into something that looks legitimate. Use
 * validateDayPlan() to find out why.
 *
 * Everything subordinate fails safe inside an otherwise identifiable plan: a
 * malformed array becomes empty, an unreadable item is dropped, an invalid
 * status becomes pending. The distinction is deliberate. Invalid identity or
 * state invalidates the plan; malformed content inside a readable plan does
 * not.
 */
export function normaliseDayPlan(raw) {
    if (!isPlainObject(raw)) return null;
    if (!isDateKey(raw.date)) return null;
    if (typeof raw.mode !== 'string' || !MODES.has(raw.mode)) return null;

    const violations = [];
    const mode = raw.mode;

    let primarySession = null;
    if (Array.isArray(raw.primarySession)) {
        // Zero or one, structurally. An array is never silently taken apart.
        violations.push({ code: VIOLATION.PRIMARY_NOT_SINGULAR, detail: { count: raw.primarySession.length } });
    } else if (raw.primarySession !== undefined && raw.primarySession !== null) {
        primarySession = normaliseWorkItem(raw.primarySession, WORK_KIND.PRIMARY, violations);
    }

    let supportingWork = normaliseWorkArray(raw.supportingWork, WORK_KIND.SUPPORTING, violations);
    const dailyPractice = normaliseWorkArray(raw.dailyPractice, WORK_KIND.DAILY_PRACTICE, violations);

    /* Rest is a prescription and it means no training. Daily Practice stays:
       a low-burden practice does not convert the day into a training day,
       which is the whole reason the third work type exists. */
    if (mode === DAY_MODE.REST) {
        if (primarySession) {
            violations.push({ code: VIOLATION.REST_HAS_PRIMARY, detail: { type: primarySession.type } });
            primarySession = null;
        }
        if (supportingWork.length) {
            violations.push({ code: VIOLATION.REST_HAS_SUPPORTING, detail: { count: supportingWork.length } });
            supportingWork = [];
        }
    }

    let status = PLAN_STATUS.PENDING;
    if (typeof raw.status === 'string' && STATUSES.has(raw.status)) status = raw.status;
    else if (raw.status !== undefined && raw.status !== null) {
        /* Pending is the only value that claims nothing. Completed would
           invent credit and missed would invent a failure. */
        violations.push({ code: VIOLATION.INVALID_STATUS, detail: { got: raw.status } });
    }

    const generatedFrom = isPlainObject(raw.generatedFrom)
        ? (cloneResolved(raw.generatedFrom).value ?? null)
        : null;

    const out = {
        ...raw,                      // forward compatibility, then corrected below
        date: raw.date,
        mode,
        primarySession,
        supportingWork,
        dailyPractice,
        status,
        generatedFrom,
    };
    /* generatedAt is never defaulted. Stamping it with a clock we do not have
       would invent provenance for a record we did not generate. */
    if (typeof raw.generatedAt !== 'string' || !raw.generatedAt) delete out.generatedAt;
    return out;
}

/**
 * Normalise a list. Undateable or unreadable plans are dropped without
 * disturbing the rest, newest last, one plan per date.
 *
 * Last write wins on a duplicate date: deterministic, and the later entry is
 * the one a later reconcile produced.
 */
export function normaliseDayPlans(list) {
    if (!Array.isArray(list)) return [];
    const byDate = new Map();
    for (const raw of list) {
        const plan = normaliseDayPlan(raw);
        if (plan) byDate.set(plan.date, plan);
    }
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Why a raw record is unreadable, or what would be repaired inside it.
 *
 * Runs against RAW input rather than a normalised plan, because the plans
 * worth asking about are the ones normaliseDayPlan() refused. This is how a
 * later storage or migration layer tells "no plan existed" from "a dated
 * record existed and could not be interpreted" without that distinction
 * leaking into programme semantics.
 */
export function validateDayPlan(raw) {
    const violations = [];
    if (!isPlainObject(raw)) {
        return { ok: false, violations: [{ code: VIOLATION.NOT_AN_OBJECT, detail: { got: typeof raw } }] };
    }
    if (!isDateKey(raw.date)) {
        violations.push({ code: VIOLATION.INVALID_DATE, detail: { got: raw.date } });
    }
    if (typeof raw.mode !== 'string' || !MODES.has(raw.mode)) {
        violations.push({ code: VIOLATION.INVALID_MODE, detail: { got: raw.mode } });
    }
    /* Subordinate checks run regardless, so one report explains everything
       wrong with the record rather than only the first thing. */
    if (Array.isArray(raw.primarySession)) {
        violations.push({ code: VIOLATION.PRIMARY_NOT_SINGULAR, detail: { count: raw.primarySession.length } });
    } else if (raw.primarySession !== undefined && raw.primarySession !== null) {
        normaliseWorkItem(raw.primarySession, WORK_KIND.PRIMARY, violations);
    }
    const supporting = normaliseWorkArray(raw.supportingWork, WORK_KIND.SUPPORTING, violations);
    normaliseWorkArray(raw.dailyPractice, WORK_KIND.DAILY_PRACTICE, violations);

    if (raw.mode === DAY_MODE.REST) {
        if (raw.primarySession) violations.push({ code: VIOLATION.REST_HAS_PRIMARY, detail: {} });
        if (supporting.length) violations.push({ code: VIOLATION.REST_HAS_SUPPORTING, detail: { count: supporting.length } });
    }
    if (raw.status !== undefined && raw.status !== null
        && !(typeof raw.status === 'string' && STATUSES.has(raw.status))) {
        violations.push({ code: VIOLATION.INVALID_STATUS, detail: { got: raw.status } });
    }
    return { ok: violations.length === 0, violations };
}

/**
 * The items a programme-day status may be computed over: Primary and
 * Supporting Work, and nothing else.
 *
 * Exported as a function rather than left as a convention so that a future
 * consumer asks the module what counts instead of remembering to filter.
 * Daily Practice can never appear here, which is what stops a missed
 * breathing practice from marking a Rest day as a missed programme day.
 */
export function programmeWork(plan) {
    if (!isPlainObject(plan)) return [];
    const out = [];
    if (isPlainObject(plan.primarySession)) out.push(plan.primarySession);
    if (Array.isArray(plan.supportingWork)) {
        for (const item of plan.supportingWork) if (isPlainObject(item)) out.push(item);
    }
    return out;
}
