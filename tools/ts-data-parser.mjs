// Minimal, non-executing parser for Pokémon Showdown data tables (data/*.ts).
// It reads the object literal after `export const X ... = {` as plain data and
// skips any function values (methods, arrow functions), recording their names
// under the `__fns` key so the build can tell which entries have custom logic.

export function parseDataTable(src) {
  const start = src.indexOf('= {', src.indexOf('export const'));
  if (start < 0) throw new Error('No data table found');
  const p = new Parser(src, start + 2);
  return p.value();
}

class Parser {
  constructor(src, i) { this.s = src; this.i = i; }
  err(msg) { throw new Error(msg + ' at ' + this.i + ': ' + JSON.stringify(this.s.slice(this.i, this.i + 60))); }
  ws() {
    const s = this.s;
    for (;;) {
      const c = s[this.i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { this.i++; continue; }
      if (c === '/' && s[this.i + 1] === '/') { while (this.i < s.length && s[this.i] !== '\n') this.i++; continue; }
      if (c === '/' && s[this.i + 1] === '*') { this.i = s.indexOf('*/', this.i + 2) + 2; continue; }
      return;
    }
  }
  peek() { this.ws(); return this.s[this.i]; }
  value() {
    const c = this.peek();
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"' || c === "'" || c === '`') return this.string();
    if (c === '-' || (c >= '0' && c <= '9') || c === '.') return this.number();
    if (c === '(') { this.skipFunctionValue(); return FN; }
    const id = this.ident();
    if (id === 'true') return true;
    if (id === 'false') return false;
    if (id === 'null') return null;
    if (id === 'undefined') return undefined;
    if (id === 'function' || id === 'async') { this.skipFunctionValue(); return FN; }
    // Arrow function with single bare param: x => ...
    if (this.peek() === '=' && this.s[this.i + 1] === '>') { this.skipArrowBody(); return FN; }
    // Any other bare identifier (e.g. an enum reference) is kept as a string.
    return { __ref: id };
  }
  ident() {
    this.ws();
    const m = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i, this.i + 80));
    if (!m) this.err('Expected identifier');
    this.i += m[0].length;
    return m[0];
  }
  number() {
    this.ws();
    const m = /^-?(?:\d[\d_]*)?(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(this.s.slice(this.i, this.i + 40));
    this.i += m[0].length;
    return Number(m[0].replace(/_/g, ''));
  }
  string() {
    const q = this.s[this.i++];
    let out = '';
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === '\\') {
        const n = this.s[this.i++];
        if (n === 'n') out += '\n';
        else if (n === 't') out += '\t';
        else if (n === 'u') { out += String.fromCharCode(parseInt(this.s.slice(this.i, this.i + 4), 16)); this.i += 4; }
        else out += n;
        continue;
      }
      if (c === q) return out;
      if (q === '`' && c === '$' && this.s[this.i] === '{') { this.i++; this.skipBalanced('{', '}', 1); out += '${…}'; continue; }
      out += c;
    }
    this.err('Unterminated string');
  }
  array() {
    this.i++;
    const out = [];
    for (;;) {
      if (this.peek() === ']') { this.i++; return out; }
      if (this.s.startsWith('...', this.i)) this.err('Spread not supported');
      out.push(this.value());
      if (this.peek() === ',') this.i++;
    }
  }
  key() {
    const c = this.peek();
    if (c === '"' || c === "'") return this.string();
    if (c >= '0' && c <= '9') return String(this.number());
    if (c === '[') this.err('Computed key not supported');
    return this.ident();
  }
  object() {
    this.i++;
    const out = {};
    for (;;) {
      if (this.peek() === '}') { this.i++; return out; }
      let k = this.key();
      if ((k === 'get' || k === 'set' || k === 'async') && /[A-Za-z_$]/.test(this.peek())) k = this.key();
      const c = this.peek();
      if (c === '(' || c === '<') {
        // Method shorthand: name(args): Type { body }
        this.skipMethod();
        (out.__fns ||= []).push(k);
      } else if (c === ':') {
        this.i++;
        const v = this.value();
        if (v === FN) (out.__fns ||= []).push(k);
        else if (v !== undefined) out[k] = v;
        else out[k] = UNDEF;
      } else if (c === ',' || c === '}') {
        out[k] = { __ref: k }; // shorthand property
      } else this.err('Unexpected token in object');
      if (this.peek() === ',') this.i++;
    }
  }
  skipMethod() {
    if (this.peek() === '<') this.skipBalanced('<', '>');
    this.skipBalanced('(', ')');
    // optional return type annotation
    if (this.peek() === ':') { this.i++; while (this.peek() !== '{') this.i++; }
    this.skipBalanced('{', '}');
  }
  skipFunctionValue() {
    // function (...) {...} | async (...) => ... | (...) => ...
    while (this.peek() !== '(') this.i++;
    this.skipBalanced('(', ')');
    if (this.peek() === ':') { this.i++; while (!/[{=]/.test(this.peek())) this.i++; }
    if (this.peek() === '=') { this.skipArrowBody(); return; }
    this.skipBalanced('{', '}');
  }
  skipArrowBody() {
    this.i += 2; // =>
    if (this.peek() === '{') { this.skipBalanced('{', '}'); return; }
    // expression body: read until , or } at depth 0
    let depth = 0;
    for (;;) {
      const c = this.s[this.i];
      if (c === '"' || c === "'" || c === '`') { this.string(); continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      if (c === ')' || c === ']' || c === '}') { if (depth === 0) return; depth--; }
      if (c === ',' && depth === 0) return;
      this.i++;
    }
  }
  skipBalanced(open, close, startDepth = 0) {
    if (!startDepth) { this.ws(); if (this.s[this.i] !== open) this.err('Expected ' + open); this.i++; }
    let depth = 1;
    const s = this.s;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === '"' || c === "'" || c === '`') { this.string(); continue; }
      if (c === '/' && s[this.i + 1] === '/') { while (s[this.i] !== '\n') this.i++; continue; }
      if (c === '/' && s[this.i + 1] === '*') { this.i = s.indexOf('*/', this.i + 2) + 2; continue; }
      if (c === '/' && open === '{' && this.looksLikeRegex()) { this.skipRegex(); continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (!depth) { this.i++; return; } }
      this.i++;
    }
    this.err('Unbalanced ' + open);
  }
  looksLikeRegex() {
    let j = this.i - 1;
    while (j >= 0 && /\s/.test(this.s[j])) j--;
    return /[(,=:[!&|?{};]/.test(this.s[j]) || /\breturn$/.test(this.s.slice(Math.max(0, j - 6), j + 1));
  }
  skipRegex() {
    this.i++;
    let cls = false;
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === '\\') { this.i++; continue; }
      if (c === '[') cls = true;
      else if (c === ']') cls = false;
      else if (c === '/' && !cls) break;
    }
    while (/[a-z]/i.test(this.s[this.i])) this.i++;
  }
}

const FN = Symbol('fn');
export const UNDEF = Symbol('undefined');
