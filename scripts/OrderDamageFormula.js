/**
 * OrderDamageFormula.js
 *
 * Safe arithmetic expression evaluator for Skill/Spell/Weapon formulas.
 *
 * Supported:
 *  - Numbers: 10, 1.5, 1,5
 *  - Operators: +  -  *  /   (also supports ×)
 *  - Parentheses: ( ... )
 *  - Identifiers (RU/EN): 13 main characteristics + Multiplier/Множитель
 *
 * Project rules:
 *  - Expression is dynamic: multiple occurrences of parts are allowed.
 *  - If a part can't be parsed, it becomes 0 (do not fail whole formula).
 *  - Result is clamped to >= 0.
 */

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}

// 13 primary characteristics (internal keys)
export const ORDER_CHARACTERISTICS = [
  "Strength", "Dexterity", "Stamina", "Accuracy", "Will", "Knowledge", "Charisma",
  "Seduction", "Leadership", "Faith", "Medicine", "Magic", "Stealth",
];

function normalizeToken(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, "")
    .replace(/ё/g, "е");
}

function toNumber(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function finalizeNumber(n) {
  if (!Number.isFinite(n)) return 0;
  // Reduce ugly floats in the UI
  const r = Math.round(n);
  if (Math.abs(n - r) < 1e-9) return r;
  return Number(n.toFixed(4));
}

function roundUpToInteger(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.ceil(n);
}

export function getActorCharacteristicTotal(actor, key) {
  const sys = getSystem(actor);
  const obj = sys?.[key] ?? null;
  const base = Number(obj?.value ?? 0) || 0;

  const localMods = Array.isArray(obj?.modifiers)
    ? obj.modifiers.reduce((acc, m) => acc + (Number(m?.value) || 0), 0)
    : 0;

  const globalMods = Array.isArray(sys?.MaxModifiers)
    ? sys.MaxModifiers.reduce((acc, m) => {
        const v = Number(m?.value) || 0;
        const k = m?.characteristic ?? m?.Characteristic ?? m?.key ?? null;
        return String(k) === String(key) ? acc + v : acc;
      }, 0)
    : 0;

  return base + localMods + globalMods;
}

function isOperatorChar(ch) {
  return ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "×";
}
function isParen(ch) { return ch === "(" || ch === ")"; }
function isDigit(ch) { return ch >= "0" && ch <= "9"; }

function isLetter(ch) {
  try { return /\p{L}/u.test(ch); }
  catch { return /[A-Za-zА-Яа-яЁё]/.test(ch); }
}

const CHARACTERISTIC_ALIASES = (() => {
  const map = new Map();
  const add = (key, ...aliases) => {
    for (const a of aliases) {
      const n = normalizeToken(a);
      if (n) map.set(n, key);
    }
  };

  add("Strength", "strength", "сила");
  add("Dexterity", "dexterity", "ловкость");
  add("Stamina", "stamina", "выносливость");
  add("Accuracy", "accuracy", "меткость");
  add("Will", "will", "стойкость духа", "сила духа");
  add("Knowledge", "knowledge", "знания");
  add("Charisma", "charisma", "харизма");
  add("Seduction", "seduction", "обольщение");
  add("Leadership", "leadership", "лидерство");
  add("Faith", "faith", "вера");
  add("Medicine", "medicine", "медицина");
  add("Magic", "magic", "магия");
  add("Stealth", "stealth", "скрытность");

  // Special keyword: Multiplier value from the item
  add("__MULTIPLIER__", "multiplier", "множитель");
  return map;
})();

/**
 * Tokenizer.
 * - Reads multi-word identifiers (e.g. "Стойкость духа") until the next operator or bracket.
 * - Ignores unknown symbols.
 */
function tokenizeFormula(src) {
  const s = String(src ?? "");
  const tokens = [];
  let i = 0;

  const peekNonSpace = (from) => {
    let j = from;
    while (j < s.length && /\s/.test(s[j])) j++;
    return j < s.length ? s[j] : "";
  };

  while (i < s.length) {
    const ch = s[i];

    if (/\s/.test(ch)) { i++; continue; }

    if (isParen(ch)) {
      tokens.push({ t: ch === "(" ? "lparen" : "rparen", v: ch });
      i++;
      continue;
    }

    if (isOperatorChar(ch)) {
      tokens.push({ t: "op", v: ch === "×" ? "*" : ch });
      i++;
      continue;
    }

    // Support 'x' as multiplication only when it behaves like an operator
    if (ch === "x" || ch === "X") {
      const prev = i > 0 ? peekNonSpace(Math.max(0, i - 1)) : "";
      const next = peekNonSpace(i + 1);
      const prevOk = isDigit(prev) || prev === ")";
      const nextOk = isDigit(next) || next === "(";
      if (prevOk && nextOk) {
        tokens.push({ t: "op", v: "*" });
        i++;
        continue;
      }
      // otherwise treat as part of identifier below
    }

    // Numbers
    if (isDigit(ch) || (ch === "." && isDigit(peekNonSpace(i + 1)))) {
      let j = i;
      let seenDot = false;
      while (j < s.length) {
        const c = s[j];
        if (isDigit(c)) { j++; continue; }
        if ((c === "." || c === ",") && !seenDot) { seenDot = true; j++; continue; }
        break;
      }
      const raw = s.slice(i, j);
      const n = toNumber(raw);
      tokens.push({ t: "num", v: Number.isFinite(n) ? n : 0 });
      i = j;
      continue;
    }

    // Identifiers: read until operator/paren. Allow spaces to support multi-word names.
    if (isLetter(ch)) {
      let j = i;
      while (j < s.length) {
        const c = s[j];
        if (isOperatorChar(c) || isParen(c)) break;
        j++;
      }
      const raw = s.slice(i, j).trim();
      tokens.push({ t: "id", v: raw });
      i = j;
      continue;
    }

    // Unknown symbol -> skip
    i++;
  }

  return tokens;
}

const OP_INFO = {
  "+": { p: 1, a: "L" },
  "-": { p: 1, a: "L" },
  "*": { p: 2, a: "L" },
  "/": { p: 2, a: "L" },
  "u+": { p: 3, a: "R" },
  "u-": { p: 3, a: "R" },
};

function toRpn(tokens) {
  const out = [];
  const stack = [];
  let prevType = "start";

  for (const tk of tokens) {
    if (tk.t === "num" || tk.t === "id") {
      out.push(tk);
      prevType = "value";
      continue;
    }

    if (tk.t === "lparen") {
      stack.push(tk);
      prevType = "lparen";
      continue;
    }

    if (tk.t === "rparen") {
      while (stack.length && stack[stack.length - 1].t !== "lparen") out.push(stack.pop());
      if (stack.length && stack[stack.length - 1].t === "lparen") stack.pop();
      prevType = "value";
      continue;
    }

    if (tk.t === "op") {
      let op = tk.v;
      const unaryContext = prevType === "start" || prevType === "op" || prevType === "lparen";
      if ((op === "+" || op === "-") && unaryContext) op = op === "+" ? "u+" : "u-";

      const cur = OP_INFO[op];
      if (!cur) { prevType = "op"; continue; }

      while (stack.length && stack[stack.length - 1].t === "op") {
        const top = stack[stack.length - 1].v;
        const ti = OP_INFO[top];
        if (!ti) break;

        const higher = ti.p > cur.p;
        const equalAndLeft = ti.p === cur.p && cur.a === "L";
        if (higher || equalAndLeft) out.push(stack.pop());
        else break;
      }

      stack.push({ t: "op", v: op });
      prevType = "op";
    }
  }

  while (stack.length) {
    const top = stack.pop();
    if (top.t !== "lparen") out.push(top);
  }
  return out;
}

function resolveIdentifierValue(idRaw, actor, item) {
  const key = CHARACTERISTIC_ALIASES.get(normalizeToken(idRaw)) || null;
  if (!key) return 0;

  if (key === "__MULTIPLIER__") {
    return Number(getSystem(item)?.Multiplier ?? 0) || 0;
  }

  if (!actor) return 0;
  return getActorCharacteristicTotal(actor, key);
}

function evalRpn(rpn, actor, item) {
  const stack = [];
  const popOrZero = () => {
    if (!stack.length) return 0;
    const v = Number(stack.pop());
    return Number.isFinite(v) ? v : 0;
  };

  for (const tk of rpn) {
    if (tk.t === "num") { stack.push(Number(tk.v) || 0); continue; }
    if (tk.t === "id") { stack.push(resolveIdentifierValue(tk.v, actor, item)); continue; }

    if (tk.t === "op") {
      if (tk.v === "u+") { stack.push(popOrZero()); continue; }
      if (tk.v === "u-") { stack.push(-popOrZero()); continue; }

      const b = popOrZero();
      const a = popOrZero();

      if (tk.v === "+") stack.push(a + b);
      else if (tk.v === "-") stack.push(a - b);
      else if (tk.v === "*") stack.push(a * b);
      else if (tk.v === "/") stack.push(b === 0 ? 0 : a / b);
      else stack.push(0);
    }
  }

  if (!stack.length) return 0;
  const out = Number(stack.pop());
  return Number.isFinite(out) ? out : 0;
}

/**
 * Public API: evaluates impact (Damage) formula string.
 * - Accepts both full expressions and a single number.
 * - Returns a non-negative integer (rounded up).
 */
export function evaluateDamageFormula(rawFormula, actor, item) {
  const src = String(rawFormula ?? "").trim();
  if (!src) return 0;

  if (/^[+-]?\d+(?:[\.,]\d+)?$/.test(src)) {
    const n = toNumber(src);
    return Math.max(0, roundUpToInteger(finalizeNumber(n)));
  }

  const tokens = tokenizeFormula(src);
  if (!tokens.length) return 0;

  const rpn = toRpn(tokens);
  const val = evalRpn(rpn, actor, item);
  return Math.max(0, roundUpToInteger(finalizeNumber(val)));
}

/**
 * Public API: evaluates range formula string.
 * - Accepts both full expressions and a single number.
 * - Returns a non-negative integer (rounded up).
 */
export function evaluateRangeFormula(rawFormula, actor, item) {
  const src = String(rawFormula ?? "").trim();
  if (!src) return 0;

  if (/^[+-]?\d+(?:[\.,]\d+)?$/.test(src)) {
    const n = toNumber(src);
    return Math.max(0, roundUpToInteger(finalizeNumber(n)));
  }

  const tokens = tokenizeFormula(src);
  if (!tokens.length) return 0;

  const rpn = toRpn(tokens);
  const val = evalRpn(rpn, actor, item);
  return Math.max(0, roundUpToInteger(finalizeNumber(val)));
}

/**
 * Public API: evaluates roll/cast formula string.
 * - Accepts both full expressions and a single number.
 * - Returns a signed integer (rounded up, no clamping).
 */
export function evaluateRollFormula(rawFormula, actor, item) {
  const src = String(rawFormula ?? "").trim();
  if (!src) return 0;

  if (/^[+-]?\d+(?:[\.,]\d+)?$/.test(src)) {
    const n = toNumber(src);
    return roundUpToInteger(finalizeNumber(n));
  }

  const tokens = tokenizeFormula(src);
  if (!tokens.length) return 0;

  const rpn = toRpn(tokens);
  const val = evalRpn(rpn, actor, item);
  return roundUpToInteger(finalizeNumber(val));
}

/**
 * Writes computed damage into item.system.Damage (derived-only, not persisted)
 */
export function applyComputedDamageToItem({ item, actor } = {}) {
  if (!item) return 0;
  const sys = getSystem(item);

  const collectImpactFormulas = () => {
    let rawArr = [];
    const raw = sys?.DamageFormulas;

    if (Array.isArray(raw)) {
      rawArr = raw;
    } else if (raw && typeof raw === "object") {
      const keys = Object.keys(raw)
        .filter((k) => String(Number(k)) === k)
        .map((k) => Number(k))
        .sort((a, b) => a - b);
      rawArr = keys.map((k) => raw[k]);
    } else if (typeof raw === "string") {
      rawArr = [raw];
    }

    const out = rawArr.map((v) => String(v ?? ""));
    const legacy = typeof sys?.DamageFormula === "string" ? sys.DamageFormula : "";
    if (String(legacy).trim() && !out.some((v) => String(v).trim() === String(legacy).trim())) {
      out.unshift(String(legacy));
    }
    return out;
  };

  const formulas = collectImpactFormulas().map((f) => String(f ?? ""));
  const computedList = formulas.map((f) => (String(f).trim().length > 0 ? evaluateDamageFormula(f, actor, item) : 0));
  const primaryFormula = formulas.find((f) => String(f).trim().length > 0)
    ?? (typeof sys?.DamageFormula === "string" ? sys.DamageFormula : "");
  const hasFormula = String(primaryFormula ?? "").trim().length > 0;

  const computedPrimary = hasFormula
    ? evaluateDamageFormula(primaryFormula, actor, item)
    : Math.max(0, finalizeNumber(Number(sys?.Damage ?? 0) || 0));

  try {
    const targetSys = item.system ?? item.data?.system;
    if (targetSys) {
      targetSys.Damage = computedPrimary;
      targetSys.DamageFormulasComputed = computedList;

      for (const key of Object.keys(targetSys)) {
        if (/^Damage\d+$/.test(String(key))) delete targetSys[key];
      }
      for (let i = 0; i < computedList.length; i += 1) {
        if (i === 0) continue;
        targetSys[`Damage${i + 1}`] = computedList[i];
      }
    }
  } catch {}

  return computedPrimary;
}

/**
 * Writes computed range into item.system.Range (derived-only, not persisted)
 */
export function applyComputedRangeToItem({ item, actor } = {}) {
  if (!item) return 0;
  const sys = getSystem(item);

  const formula = typeof sys?.RangeFormula === "string" ? sys.RangeFormula : "";
  const hasFormula = formula.trim().length > 0;

  const computed = hasFormula
    ? evaluateRangeFormula(formula, actor, item)
    : Math.max(0, finalizeNumber(Number(sys?.Range ?? 0) || 0));

  try {
    if (item.system) item.system.Range = computed;
    else if (item.data?.system) item.data.system.Range = computed;
  } catch {}

  return computed;
}
