// Reads and compares typed math answers (numbers, exact values like pi/4 or 3/8, and formulas).
// Copied unchanged from the online-module projects (MMW, DiffCal, IntegCal).

var MathExpr = (function () {
  var FN = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    sec: function (x) { return 1 / Math.cos(x); }, csc: function (x) { return 1 / Math.sin(x); },
    cot: function (x) { return 1 / Math.tan(x); },
    arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
    arcsec: function (x) { return Math.acos(1 / x); }, arccsc: function (x) { return Math.asin(1 / x); },
    arccot: function (x) { return Math.PI / 2 - Math.atan(x); },
    sinh: function (x) { return (Math.exp(x) - Math.exp(-x)) / 2; },
    cosh: function (x) { return (Math.exp(x) + Math.exp(-x)) / 2; },
    tanh: function (x) { var a = Math.exp(x), b = Math.exp(-x); return (a - b) / (a + b); },
    sech: function (x) { return 2 / (Math.exp(x) + Math.exp(-x)); },
    csch: function (x) { return 2 / (Math.exp(x) - Math.exp(-x)); },
    coth: function (x) { var a = Math.exp(x), b = Math.exp(-x); return (a + b) / (a - b); },
    arcsinh: function (x) { return Math.log(x + Math.sqrt(x * x + 1)); },
    arccosh: function (x) { return Math.log(x + Math.sqrt(x * x - 1)); },
    arctanh: function (x) { return 0.5 * Math.log((1 + x) / (1 - x)); },
    ln: Math.log, log: Math.log, exp: Math.exp, sqrt: Math.sqrt, abs: Math.abs,
    cbrt: function (x) { return x < 0 ? -Math.pow(-x, 1 / 3) : Math.pow(x, 1 / 3); }
  };
  var ALIAS = { asin: 'arcsin', acos: 'arccos', atan: 'arctan', asec: 'arcsec', acsc: 'arccsc', acot: 'arccot',
                asinh: 'arcsinh', acosh: 'arccosh', atanh: 'arctanh', arsinh: 'arcsinh', arcosh: 'arccosh',
                artanh: 'arctanh' };
  var INVERSE = { sin: 'arcsin', cos: 'arccos', tan: 'arctan', sec: 'arcsec', csc: 'arccsc', cot: 'arccot',
                  sinh: 'arcsinh', cosh: 'arccosh', tanh: 'arctanh' };
  var CONST = { pi: Math.PI, e: Math.E };
  var GREEK = { 'θ': 'theta', 'α': 'alpha', 'β': 'beta', 'φ': 'phi', 'λ': 'lambda', 'ω': 'omega', 'μ': 'mu' };
  var TEXFN = { arcsin: '\\sin^{-1}', arccos: '\\cos^{-1}', arctan: '\\tan^{-1}', arcsec: '\\sec^{-1}',
                arccsc: '\\csc^{-1}', arccot: '\\cot^{-1}', arcsinh: '\\sinh^{-1}', arccosh: '\\cosh^{-1}',
                arctanh: '\\tanh^{-1}', sech: '\\operatorname{sech}', csch: '\\operatorname{csch}',
                exp: '\\exp', ln: '\\ln', log: '\\ln' };

  function fail(msg) { var e = new Error(msg); e.mathexpr = true; throw e; }

  function normalize(s) {
    s = String(s == null ? '' : s);
    s = s.replace(/[−–—]/g, '-').replace(/[×·⋅∙]/g, '*').replace(/÷/g, '/').replace(/π/g, 'pi')
      .replace(/√/g, 'sqrt').replace(/∛/g, 'cbrt').replace(/⁻¹/g, '^(-1)').replace(/⁻²/g, '^(-2)')
      .replace(/²/g, '^2').replace(/³/g, '^3').replace(/⁴/g, '^4').replace(/½/g, '(1/2)').replace(/\*\*/g, '^')
      .replace(/[θαβφλωμ]/g, function (c) { return GREEK[c]; })
      .replace(/\\left|\\right|\\,|\\;|\\!/g, '').replace(/\\cdot|\\times/g, '*')
      .replace(/\\(pi|theta|alpha|beta|phi|lambda|omega|mu)/g, '$1')
      .replace(/\\(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|sec|csc|cot|ln|log|exp)/g, '$1')
      .replace(/\\sqrt/g, 'sqrt').replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '(($1)/($2))')
      .replace(/[{}]/g, function (c) { return c === '{' ? '(' : ')'; })
      .replace(/\[/g, '(').replace(/\]/g, ')');
    return s;
  }

  function tokenize(src, vars) {
    var names = [];
    Object.keys(FN).forEach(function (k) { names.push({ s: k, k: 'fn' }); });
    Object.keys(ALIAS).forEach(function (k) { names.push({ s: k, k: 'fn' }); });
    Object.keys(CONST).forEach(function (k) { names.push({ s: k, k: 'const' }); });
    (vars || []).forEach(function (v) { names.push({ s: v, k: 'var' }); });
    names.push({ s: 'C', k: 'C' });
    names.sort(function (a, b) { return b.s.length - a.s.length; });
    var out = [], i = 0, s = src;
    while (i < s.length) {
      var c = s.charAt(i);
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        var m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)/);
        if (!m) fail('I could not read the number near "' + s.slice(i, i + 6) + '".');
        out.push({ k: 'num', v: Number(m[1]) });
        i += m[1].length;
        continue;
      }
      if (/[+\-*\/^(),|!]/.test(c)) { out.push({ k: c }); i++; continue; }
      if (/[A-Za-z_]/.test(c)) {
        var hit = null;
        for (var j = 0; j < names.length; j++) {
          if (s.substr(i, names[j].s.length) === names[j].s) { hit = names[j]; break; }
        }
        if (!hit) fail('Unknown symbol "' + s.slice(i).match(/^[A-Za-z_]+/)[0] + '". ' +
          (vars && vars.length ? 'Use ' + vars.join(', ') + ' as the variable' + (vars.length > 1 ? 's' : '') + '.' : 'Numbers only here.'));
        out.push({ k: hit.k, s: ALIAS[hit.s] || hit.s });
        i += hit.s.length;
        continue;
      }
      fail('The symbol "' + c + '" is not allowed. Use + - * / ^ ( ) and function names such as sin, ln, sqrt.');
    }
    return out;
  }

  function parse(text, vars) {
    var src = normalize(text).trim();
    if (!src) fail('The answer is empty.');
    var toks = tokenize(src, vars), p = 0, absDepth = 0;
    function peek() { return toks[p]; }
    function next() { return toks[p++]; }
    function is(k) { return toks[p] && toks[p].k === k; }
    function expect(k) { if (!is(k)) fail(k === ')' ? 'A closing parenthesis ")" is missing.' : 'Expected "' + k + '".'); p++; }
    function startsPrimary(t) {
      if (!t) return false;
      if (t.k === '|') return absDepth === 0 || prevIsOperator();
      return t.k === 'num' || t.k === 'var' || t.k === 'const' || t.k === 'fn' || t.k === '(' || t.k === 'C';
    }
    function prevIsOperator() { var t = toks[p - 1]; return !t || /^[+\-*\/^(,|]$/.test(t.k) && t.k !== ')'; }
    function expr() {
      var a = term();
      while (is('+') || is('-')) { var op = next().k; a = { t: 'bin', op: op, a: a, b: term() }; }
      return a;
    }
    function term() {
      var a = unary();
      for (;;) {
        if (is('*') || is('/')) { var op = next().k; a = { t: 'bin', op: op, a: a, b: unary() }; }
        else if (startsPrimary(peek())) a = { t: 'bin', op: '*', a: a, b: power(), implicit: true };
        else return a;
      }
    }
    function unary() {
      if (is('-')) { next(); return { t: 'neg', a: unary() }; }
      if (is('+')) { next(); return unary(); }
      return power();
    }
    function power() {
      var a = postfix();
      if (is('^')) { next(); return { t: 'bin', op: '^', a: a, b: unary() }; }
      return a;
    }
    function postfix() {
      var a = primary();
      while (is('!')) { next(); a = { t: 'fact', a: a }; }
      return a;
    }
    function fnArg() {
      // sin(x), or sin x / sin 2x / ln x^2 without parentheses: numbers, variables and constants that follow
      if (is('(')) { next(); var e = expr(); expect(')'); return e; }
      if (is('|')) return primary();
      var parts = [];
      while (is('num') || is('var') || is('const')) {
        var f = primary();
        if (is('^')) { next(); f = { t: 'bin', op: '^', a: f, b: unary() }; }
        parts.push(f);
      }
      if (!parts.length) fail('A function needs an input, for example sin(x).');
      return parts.reduce(function (x, y) { return { t: 'bin', op: '*', a: x, b: y, implicit: true }; });
    }
    function primary() {
      var t = next();
      if (!t) fail('The answer ends too early.');
      if (t.k === 'num') return { t: 'num', v: t.v };
      if (t.k === 'var') return { t: 'var', n: t.s };
      if (t.k === 'const') return { t: 'const', n: t.s };
      if (t.k === 'C') return { t: 'C' };
      if (t.k === '(') { var e = expr(); expect(')'); return e; }
      if (t.k === '|') { absDepth++; var a = expr(); absDepth--; expect('|'); return { t: 'fn', f: 'abs', a: a }; }
      if (t.k === 'fn') {
        var f = t.s, pw = null;
        if (is('^')) {
          // sin^2 x means (sin x)^2 and sin^-1 x means arcsin x
          next();
          var save = p, neg = false;
          if (is('(')) { next(); if (is('-')) { next(); neg = true; } }
          else if (is('-')) { next(); neg = true; }
          if (neg && is('num') && peek().v === 1) {
            next();
            if (toks[save] && toks[save].k === '(') expect(')');
            if (!INVERSE[f]) fail('Write the inverse of ' + f + ' another way.');
            f = INVERSE[f];
          } else { p = save; pw = postfix(); }
        }
        var node = { t: 'fn', f: f, a: fnArg() };
        return pw ? { t: 'bin', op: '^', a: node, b: pw } : node;
      }
      fail(t.k === ')' ? 'There is an extra ")" or something is missing before it.' : 'Something is missing before "' + t.k + '".');
    }
    var tree = expr();
    if (p < toks.length) fail(toks[p].k === ')' ? 'There is an extra ")".' : 'I could not read the part starting at "' + (toks[p].s || toks[p].k) + '".');
    return tree;
  }

  function gamma(n) {
    if (n < 0 || Math.floor(n) !== n || n > 170) return NaN;
    var r = 1;
    for (var i = 2; i <= n; i++) r *= i;
    return r;
  }

  function value(t, env) {
    switch (t.t) {
      case 'num': return t.v;
      case 'const': return CONST[t.n];
      case 'C': return env && env.C !== undefined ? env.C : 0;
      case 'var': return env && env[t.n] !== undefined ? env[t.n] : NaN;
      case 'neg': return -value(t.a, env);
      case 'fact': return gamma(value(t.a, env));
      case 'fn': return FN[t.f](value(t.a, env));
      case 'bin':
        var a = value(t.a, env), b = value(t.b, env);
        if (t.op === '+') return a + b;
        if (t.op === '-') return a - b;
        if (t.op === '*') return a * b;
        if (t.op === '/') return a / b;
        if (a < 0 && Math.floor(b) !== b) {
          // odd roots of negative numbers, e.g. (-8)^(1/3)
          var inv = 1 / b, k = Math.round(inv);
          if (Math.abs(inv - k) < 1e-9 && k % 2 !== 0) return -Math.pow(-a, b);
          return NaN;
        }
        return Math.pow(a, b);
    }
    return NaN;
  }

  function hasC(t) {
    if (!t) return false;
    if (t.t === 'C') return true;
    return hasC(t.a) || hasC(t.b);
  }

  var PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };
  function prec(t) {
    if (t.t === 'bin') return PREC[t.op];
    if (t.t === 'neg') return 1.5;
    return 9;
  }
  function latex(t) {
    switch (t.t) {
      case 'num': return String(t.v);
      case 'const': return t.n === 'pi' ? '\\pi' : 'e';
      case 'C': return 'C';
      case 'var': return t.n.length > 1 ? '\\' + t.n : t.n;
      case 'neg': return '-' + wrap(t.a, 2);
      case 'fact': return wrap(t.a, 9) + '!';
      case 'fn':
        if (t.f === 'sqrt') return '\\sqrt{' + latex(t.a) + '}';
        if (t.f === 'cbrt') return '\\sqrt[3]{' + latex(t.a) + '}';
        if (t.f === 'abs') return '\\left|' + latex(t.a) + '\\right|';
        if (t.f === 'exp') return 'e^{' + latex(t.a) + '}';
        return (TEXFN[t.f] || '\\' + t.f) + '\\left(' + latex(t.a) + '\\right)';
      case 'bin':
        if (t.op === '/') return '\\frac{' + latex(t.a) + '}{' + latex(t.b) + '}';
        if (t.op === '^') {
          if (t.a.t === 'fn' && t.a.f !== 'sqrt' && t.a.f !== 'abs' && t.a.f !== 'exp' && t.a.f !== 'cbrt') {
            return (TEXFN[t.a.f] || '\\' + t.a.f) + '^{' + latex(t.b) + '}\\left(' + latex(t.a.a) + '\\right)';
          }
          return wrap(t.a, 5) + '^{' + latex(t.b) + '}';
        }
        if (t.op === '*') {
          var l = wrap(t.a, 2), r = wrap(t.b, 2.5);
          var dot = t.b.t === 'num' || (t.b.t === 'bin' && t.b.op === '^' && t.b.a.t === 'num') || t.b.t === 'neg';
          return l + (dot ? ' \\cdot ' : ' ') + r;
        }
        return latex(t.a) + ' ' + t.op + ' ' + wrap(t.b, t.op === '-' ? 1.5 : 1);
    }
    return '';
  }
  function wrap(t, p) {
    var s = latex(t);
    return prec(t) < p ? '\\left(' + s + '\\right)' : s;
  }

  // Deterministic sample points, so a submission is always graded the same way.
  function samples(vars, domain, count) {
    var seed = 12345, pts = [];
    function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    for (var i = 0; i < count; i++) {
      var env = {};
      vars.forEach(function (v) {
        var d = (domain && domain[v]) || [-2, 2];
        env[v] = d[0] + (d[1] - d[0]) * (0.03 + 0.94 * rnd());
      });
      pts.push(env);
    }
    return pts;
  }

  function close(a, b, rel) {
    return Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
  }

  /** Numeric item: the answer may be a decimal or an exact expression such as pi/4 or 2ln(3). */
  function numberOf(text) {
    var tree = parse(text, []);
    if (hasC(tree)) fail('This answer is a number; leave out "+ C".');
    return value(tree, {});
  }

  /**
   * Formula item. spec = { vars: ['x'], domain: { x: [a, b] }, constant: true|false }
   * constant: an antiderivative; any answer that differs from the key by a constant is accepted.
   */
  function sameFunction(text, keyText, spec) {
    spec = spec || {};
    var vars = spec.vars || ['x'];
    var s = parse(text, vars), k = parse(keyText, vars);
    var pts = samples(vars, spec.domain, 14), used = 0, d0 = null;
    for (var i = 0; i < pts.length; i++) {
      var kv = value(k, pts[i]);
      if (!isFinite(kv)) continue;
      var sv = value(s, pts[i]);
      if (!isFinite(sv)) return false;
      used++;
      if (spec.constant) {
        var d = sv - kv;
        if (d0 === null) d0 = d;
        else if (!close(d, d0, 1e-7 * Math.max(1, Math.abs(kv)))) return false;
      } else if (!close(sv, kv, 1e-7)) return false;
    }
    return used >= 4;
  }

  return { parse: parse, value: value, latex: latex, hasC: hasC, numberOf: numberOf,
           sameFunction: sameFunction, normalize: normalize };
})();
// ===== end MathExpr =====

