// Load-order check: `node scripts/check-load-order.js`
//
// The renderer is a set of classic scripts that share one global scope and run in the order index.html
// lists them. Code that runs while a script loads (not inside a function called later) may only use what
// is already defined: names from earlier scripts, functions of its own script (they are hoisted), and its
// own `const`/`let`/`class` declared above it. Using anything else is a ReferenceError at startup, and one
// such mistake once broke the section colour menu. This check reads the scripts in order and reports every
// such use, following calls into the functions they make at load time too.
'use strict';

const fs = require('fs');
const path = require('path');

const KEYWORDS = new Set(
  'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of null true false undefined'.split(' ')
);
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);

// Tokens of a script: identifiers, punctuation and string/template text (contents dropped, ${} kept).
function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const prevSignificant = () => out[out.length - 1];
  const regexAllowed = () => {
    const p = prevSignificant();
    if (!p) return true;
    if (p.t === 'id') return KEYWORDS.has(p.v) && !['this', 'super', 'null', 'true', 'false', 'undefined'].includes(p.v);
    if (p.t === 'num' || p.t === 'str') return false;
    return !/^[)\]}]$/.test(p.v);
  };
  const templateDepth = []; // brace depth at which each open ${ … } began
  let braces = 0;
  function readTemplate() {
    // At a ` or just after a } that closes ${ … }: read text up to the next ${ or the closing `.
    while (i < n) {
      const c = src[i];
      if (c === '\\') i += 2;
      else if (c === '`') {
        i++;
        out.push({ t: 'str', v: '`' });
        return;
      } else if (c === '$' && src[i + 1] === '{') {
        i += 2;
        out.push({ t: 'p', v: '(' }); // ${ … } is an expression evaluated with the template
        templateDepth.push(braces);
        return;
      } else i++;
    }
  }
  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      out.push({ t: 'nl', v: '\n' });
      i++;
    } else if (/\s/.test(c)) i++;
    else if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2);
      i = i < 0 ? n : i + 2;
    } else if (c === "'" || c === '"') {
      i++;
      while (i < n && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++;
      out.push({ t: 'str', v: c });
    } else if (c === '`') {
      i++;
      readTemplate();
    } else if (c === '/' && regexAllowed()) {
      i++;
      let cls = false;
      while (i < n && (src[i] !== '/' || cls)) {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') cls = true;
        else if (src[i] === ']') cls = false;
        i++;
      }
      i++;
      while (/[a-z]/i.test(src[i] || '')) i++;
      out.push({ t: 'str', v: '/' });
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j), at: i });
      i = j;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j])) j++;
      out.push({ t: 'num', v: src.slice(i, j) });
      i = j;
    } else if (src.startsWith('=>', i)) {
      out.push({ t: 'p', v: '=>' });
      i += 2;
    } else if (src.startsWith('...', i)) {
      out.push({ t: 'p', v: '...' });
      i += 3;
    } else if (src.startsWith('?.', i) && !/[0-9]/.test(src[i + 2] || '')) {
      out.push({ t: 'p', v: '.' });
      i += 2;
    } else {
      if (c === '{') braces++;
      if (c === '}') {
        if (templateDepth.length && templateDepth[templateDepth.length - 1] === braces) {
          templateDepth.pop();
          out.push({ t: 'p', v: ')' });
          i++;
          readTemplate();
          continue;
        }
        braces--;
      }
      out.push({ t: 'p', v: c });
      i++;
    }
  }
  return out;
}

/*
  Walk a script's tokens. Returns its top-level declarations (with their kind and position), the names it
  uses while loading (with position), and for each top-level function the names its body uses.
*/
function analyse(src) {
  const toks = tokenize(src);
  const decls = []; // { name, kind, at }
  const uses = []; // { name, at }
  const bodies = new Map(); // function name -> Set of names used inside
  const stack = []; // { v: '{' | '(' | '[' | '=>', deferred, fn }
  const deferred = () => stack.some((f) => f.deferred);
  // The top-level function whose body this is, counting only what runs when it is called (not callbacks
  // it sets up for later).
  const currentFn = () => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].fn) return stack[k].fn;
      if (stack[k].deferred) return null;
    }
    return null;
  };
  const skip = new Set(); // token positions that name what a destructuring declaration declares
  const sig = (k, dir) => {
    for (let j = k + dir; j >= 0 && j < toks.length; j += dir) if (toks[j].t !== 'nl') return [toks[j], j];
    return [null, -1];
  };
  const matchingOpen = (k) => {
    let depth = 0;
    for (let j = k; j >= 0; j--) {
      const v = toks[j].v;
      if (toks[j].t !== 'p') continue;
      if (v === ')') depth++;
      if (v === '(' && --depth === 0) return j;
    }
    return -1;
  };
  const popArrows = () => {
    while (stack.length && stack[stack.length - 1].v === '=>') stack.pop();
  };
  let pendingFn = null; // name of a top-level function whose body opens next
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.t === 'nl') {
      // A line break ends an arrow's expression body at statement level ("x => y" then a new line).
      const [next] = sig(k, 1);
      const top = stack[stack.length - 1];
      if (top && top.v === '=>' && next && next.t === 'id' && ['const', 'let', 'var', 'function', 'class', 'if', 'for', 'return'].includes(next.v)) popArrows();
      continue;
    }
    if (tk.t === 'id') {
      if (skip.has(k)) continue;
      const [prev] = sig(k, -1);
      const [next] = sig(k, 1);
      if (!stack.length && prev && prev.t === 'id' && prev.v === 'function') {
        decls.push({ name: tk.v, kind: 'function', at: tk.at });
        pendingFn = tk.v;
        continue;
      }
      if (!stack.length && prev && prev.t === 'id' && ['const', 'let', 'var', 'class'].includes(prev.v)) {
        decls.push({ name: tk.v, kind: prev.v, at: tk.at });
        continue;
      }
      if (KEYWORDS.has(tk.v)) continue;
      if (prev && prev.v === '.' && prev.t === 'p') continue; // a property
      const top = stack[stack.length - 1];
      if (next && next.v === ':' && top && top.v === '{' && prev && (prev.v === '{' || prev.v === ',')) continue; // an object key
      const fn = currentFn();
      if (fn) bodies.get(fn).add(tk.v);
      if (!deferred()) uses.push({ name: tk.v, at: tk.at, call: next && next.v === '(' });
      continue;
    }
    if (tk.t !== 'p') continue;
    const v = tk.v;
    if (v === '=>') {
      const [next] = sig(k, 1);
      if (!(next && next.v === '{')) stack.push({ v: '=>', deferred: true });
      continue;
    }
    if (v === ',' || v === ';') {
      popArrows();
      // Destructured top-level names: const { a, b } = … / const [a, b] = …
      continue;
    }
    if (v === '{' || v === '(' || v === '[') {
      let isDeferred = false;
      let fn = null;
      if (v === '{') {
        const [prev, pj] = sig(k, -1);
        if (prev && prev.v === '=>') isDeferred = true;
        else if (prev && prev.v === ')') {
          const open = matchingOpen(pj);
          const [before] = open >= 0 ? sig(open, -1) : [null];
          isDeferred = !(before && before.t === 'id' && CONTROL.has(before.v));
        }
        if (pendingFn && !stack.length) {
          fn = pendingFn;
          bodies.set(fn, new Set());
          pendingFn = null;
        }
        // Top-level destructuring declarations.
        const [p2] = sig(k, -1);
        if (!stack.length && p2 && p2.t === 'id' && ['const', 'let', 'var'].includes(p2.v)) {
          for (let j = k + 1; j < toks.length && toks[j].v !== '}'; j++) {
            if (toks[j].t !== 'id') continue;
            skip.add(j);
            if (!(sig(j, 1)[0] && sig(j, 1)[0].v === ':')) decls.push({ name: toks[j].v, kind: p2.v, at: toks[j].at });
          }
        }
      }
      stack.push({ v, deferred: isDeferred, fn });
      continue;
    }
    if (v === '}' || v === ')' || v === ']') {
      popArrows();
      stack.pop();
      if (v !== '}') popArrows.call(null);
      continue;
    }
  }
  return { decls, uses, bodies };
}

function check(root) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const declaredIn = new Map(); // name -> index of the first file declaring it
  const scripts = files.map((f, i) => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const a = analyse(src);
    for (const d of a.decls) if (!declaredIn.has(d.name)) declaredIn.set(d.name, i);
    return { file: f, src, ...a };
  });
  const allBodies = new Map();
  for (const s of scripts) for (const [name, body] of s.bodies) if (!allBodies.has(name)) allBodies.set(name, body);
  const problems = [];
  const lineOf = (src, at) => src.slice(0, at).split('\n').length;
  scripts.forEach((s, i) => {
    const local = new Map(s.decls.map((d) => [d.name, d]));
    const available = (name, at) => {
      const d = local.get(name);
      if (d) return d.kind === 'function' || d.kind === 'var' || d.at < at;
      return !declaredIn.has(name) || declaredIn.get(name) < i;
    };
    for (const u of s.uses) {
      const report = (name, via) => problems.push(`${s.file}:${lineOf(s.src, u.at)}  uses ${name}${via ? ` (through ${via}())` : ''} before ${declaredIn.has(name) && declaredIn.get(name) !== i ? `${files[declaredIn.get(name)]} defines it` : 'it is defined'}`);
      if (!available(u.name, u.at)) {
        report(u.name);
        continue;
      }
      // A function called while loading: what it uses must be there too.
      if (!u.call || !allBodies.has(u.name)) continue;
      const seen = new Set([u.name]);
      const queue = [u.name];
      while (queue.length) {
        const fn = queue.shift();
        for (const name of allBodies.get(fn) || []) {
          if (!declaredIn.has(name) || local.get(name)?.kind === 'function') continue;
          if (!available(name, u.at)) report(name, fn);
          else if (allBodies.has(name) && !seen.has(name)) {
            seen.add(name);
            queue.push(name);
          }
        }
      }
    }
  });
  return [...new Set(problems)];
}

module.exports = { check, analyse };

if (require.main === module) {
  const problems = check(path.join(__dirname, '..', 'src', 'renderer'));
  if (problems.length) {
    console.log(problems.join('\n'));
    process.exit(1);
  }
  console.log('Load order: every script uses only what is defined before it.');
}
