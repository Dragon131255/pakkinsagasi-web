// Web版（index.html）の計算・判定・並べ替え。Search.ps1 / Config.ps1 と同じ内容を JavaScript で書いたもの
// 判定基準や計算式を変えるときは Config.ps1・Search.ps1 とこのファイルの両方を直す
(function (root) {
  'use strict';

  // ---- Config.ps1 と同じ値 ----
  var Criteria = {
    Dynamic: { SqueezeMin: 8, SqueezeMax: 20, Series: ['P'] },
    Static: { SqueezeMin: 15, SqueezeMax: 30, Series: ['P', 'G'] }
  };
  var FillMax = 85, StretchMin = 0, StretchMax = 5, MaxResults = 2;
  var GrooveTolerance = {
    P: { 1.9: 0.05, 2.4: 0.06, 3.5: 0.08, 5.7: 0.10, 8.4: 0.10 },
    G: { 3.1: 0.10, 5.7: 0.10 }
  };
  var GrooveWidthTolerance = 0.25;
  var GrooveDiff = {
    P: { 1.9: 3.0, 2.4: 4.0, 3.5: 6.0, 5.7: 10.0, 8.4: 15.0 },
    G: { 3.1: 5.0, 5.7: 10.0 }
  };
  var GrooveWidthStd = {
    P: { 1.9: [2.5, 3.9, 5.4], 2.4: [3.2, 4.4, 6.0], 3.5: [4.7, 6.0, 7.8], 5.7: [7.5, 9.0, 11.5], 8.4: [11.0, 13.0, 17.0] },
    G: { 3.1: [4.1, 5.6, 7.3], 5.7: [7.5, 9.0, 11.5] }
  };

  function parseTable(csv) {
    var lines = csv.replace(/^﻿/, '').trim().split(/\r?\n/);
    var head = lines.shift().split(',');
    return lines.map(function (line) {
      var c = line.split(','), o = {};
      head.forEach(function (h, i) { o[h.trim()] = (c[i] || '').trim(); });
      return { Series: o.Series, Name: o.Name, D1: +o.D1, D2: +o.D2 };
    });
  }

  function f(v, n) { return v.toFixed(n); }

  function findORing(opt) {
    var gi = opt.inner, go = opt.outer, gw = opt.width;
    var hasInner = gi != null, hasOuter = go != null, hasWidth = gw != null;
    var brIndex = { None: 0, One: 1, Both: 2 }[opt.backupRing || 'None'];

    if (!(hasInner || hasOuter || hasWidth)) throw new Error('溝の内径・外径・溝幅のどれか1つ以上を入力してください。');
    [gi, go, gw].forEach(function (v) {
      if (v != null && v <= 0) throw new Error('寸法には0より大きい値を入力してください。');
    });
    if (hasInner && hasOuter && go <= gi) throw new Error('溝の外径は内径より大きい値を入力してください。');

    var c = Criteria[opt.use];
    var mid = (c.SqueezeMin + c.SqueezeMax) / 2;

    var notes = [];
    if (hasInner) notes.push('内径の伸び ' + StretchMin + '〜' + StretchMax + '%');
    if (hasOuter) {
      notes.push('つぶし率 0%超（範囲の判定なし）');
      if (!hasInner) notes.push('（溝内径は未入力のため、Oリング内径 d1 にはまる前提で溝深さを計算）');
    }
    if (hasWidth) {
      notes.push('溝充填率 ' + FillMax + '% 以下');
      if (brIndex > 0) notes.push('（溝幅からバックアップリングの分＝標準溝幅のBRありとBRなしの差を引いて計算）');
      if (!hasOuter) notes.push('（溝外径は未入力のため、つぶし率 ' + mid + '% になる溝深さを仮定）');
    }

    var evaluated = [];
    opt.table.forEach(function (r) {
      if (c.Series.indexOf(r.Series) < 0) return;

      var stretch = null;
      if (hasInner) stretch = (gi - r.D1) / r.D1 * 100;

      var squeeze = null, h;
      if (hasOuter) {
        var seat = hasInner ? gi : r.D1;
        h = (go - seat) / 2;
        if (h <= 0) return;
        squeeze = (r.D2 - h) / r.D2 * 100;
      } else {
        h = r.D2 * (1 - mid / 100);
      }

      var std = (GrooveWidthStd[r.Series] || {})[r.D2] || null;
      var brSpace = std ? std[brIndex] - std[0] : 0;

      var fill = null;
      if (hasWidth) {
        var w = gw - brSpace;
        fill = w <= 0 ? Infinity : (Math.PI * r.D2 * r.D2 / 4) / (h * w) * 100;
      }

      var tol = (GrooveTolerance[r.Series] || {})[r.D2];
      var stdD1 = null, stdD2 = null, m = /^[A-Z]+([\d.]+)/.exec(r.Name);
      if (m) {
        stdD1 = +m[1];
        var diff = (GrooveDiff[r.Series] || {})[r.D2];
        if (diff != null) stdD2 = stdD1 + diff;
      }

      evaluated.push({
        Series: r.Series, Name: r.Name, D1: r.D1, D2: r.D2,
        TolInner: tol != null ? '0 / -' + f(tol, 2) : '—',
        TolOuter: tol != null ? '+' + f(tol, 2) + ' / 0' : '—',
        TolWidth: '+' + f(GrooveWidthTolerance, 2) + ' / 0',
        StdWidth: std ? std[brIndex] : null,
        StdInner: stdD1, StdOuter: stdD2,
        Depth: h, Squeeze: squeeze, Fill: fill, Stretch: stretch,
        StretchOk: !hasInner || (stretch >= StretchMin && stretch <= StretchMax),
        SqueezeOk: !hasOuter || squeeze > 0,
        FillOk: !hasWidth || fill <= FillMax
      });
    });

    var key = hasInner ? function (x) { return x.Stretch; }
      : hasOuter ? function (x) { return Math.abs(x.Squeeze - mid); }
        : function (x) { return FillMax - x.Fill; };

    var candidates = [];
    c.Series.forEach(function (s) {
      candidates = candidates.concat(evaluated
        .filter(function (x) { return x.Series === s && x.StretchOk && x.SqueezeOk && x.FillOk; })
        .sort(function (a, b) { return key(a) - key(b); })
        .slice(0, MaxResults));
    });

    var reasons = [];
    if (candidates.length === 0) {
      var fitting = evaluated.filter(function (x) { return x.StretchOk; });
      if (fitting.length === 0) {
        reasons.push(hasInner
          ? '溝内径に合う内径のOリングがありません（内径の伸び ' + StretchMin + '〜' + StretchMax + '% の範囲外）。'
          : '入力した寸法に合うOリングがありません。');
      } else {
        fitting.forEach(function (x) {
          var ng = [];
          if (!x.SqueezeOk) ng.push('つぶし率 ' + f(x.Squeeze, 1) + '%（つぶれないためシールしない）');
          if (!x.FillOk) ng.push('溝充填率 ' + f(x.Fill, 1) + '%（上限 ' + FillMax + '%）');
          reasons.push(x.Name + '：' + ng.join('、'));
        });
        if (reasons.length > 10) reasons = reasons.slice(0, 10).concat('…ほか ' + (reasons.length - 10) + ' 件');
      }
    }

    return {
      GrooveDepth: hasInner && hasOuter ? (go - gi) / 2 : null,
      Candidates: candidates, Reasons: reasons, Notes: notes
    };
  }

  var api = { parseTable: parseTable, findORing: findORing, MaxResults: MaxResults };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pakkin = api;
})(this);
