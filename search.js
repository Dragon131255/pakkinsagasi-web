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

  // ---- 阪上パッキン（油圧シリンダ用）：Search.ps1 の Find-Packing と同じ ----
  var PackingDiaTol = 0.5, PackingWidthTol = 0.5;   // Config.ps1 と同じ値
  var PackingProducts = ['SKY', 'KY', 'UHP', 'MLP', 'MLR', 'UPH'];   // 検索結果に出す製品（Config.ps1 の $PackingProducts と同じ。阪上は一時的に SKY・KY だけ）

  // 溝寸法の公差（Config.ps1 の $PackingTolerance と同じ。出典：阪上製作所の寸法指示図）
  var PackingTolerance = {
    'GPY': { Piston: { Inner: 'h8', Outer: 'H9' }, Width: '+0.25/0' },
    'GNY': { Rod: { Inner: 'f8', Outer: 'H8' }, Width: '+0.25/0' },
    'RGY': { Piston: { Inner: '+0.2/0', Outer: 'H9' }, Width: '±0.2' },
    'RNY': { Rod: { Inner: 'f8', Outer: '0/-0.2' }, Width: '±0.2' },
    'ⓉSGY': { Piston: { Inner: '+0.2/0', Outer: 'H9' }, Width: '±0.2' },
    'ⓉSNY': { Rod: { Inner: 'f8', Outer: '0/-0.2' }, Width: '±0.2' },
    'SKY': { Piston: { Inner: '+0.2/0', Outer: 'H9' }, Rod: { Inner: 'f8', Outer: '0/-0.2' }, Width: '±0.2' },
    'KY': { Piston: { Inner: 'h8', Outer: 'H9' }, Rod: { Inner: 'f8', Outer: 'H9' }, Width: '±0.2' }
  };
  // ISO 286（JIS B 0401）[µm]：寸法区分の上限 [mm]、IT8、IT9、f の上の寸法許容差
  var FitSizeUpper = [3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600];
  var FitIT8 = [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97, 110, 125, 140, 165, 195];
  var FitIT9 = [25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155, 175, 200, 230, 260, 310];
  var FitEsF = [-6, -10, -13, -16, -20, -25, -30, -36, -43, -50, -56, -62, -68, -76, -80, -86, -98, -110];

  function formatPackingTol(spec, size) {
    var um = function (v) { return v === 0 ? '0' : (v > 0 ? '+' : '-') + (Math.abs(v) / 1000).toFixed(3); };
    var m = /^([Hhf])(8|9)$/.exec(spec);
    if (m) {
      var i = 0;
      while (i < FitSizeUpper.length && size > FitSizeUpper[i]) i++;
      if (i >= FitSizeUpper.length) return spec;
      var it = m[2] === '8' ? FitIT8[i] : FitIT9[i], hi, lo;
      if (m[1] === 'H') { hi = it; lo = 0; } else if (m[1] === 'h') { hi = 0; lo = -it; } else { hi = FitEsF[i]; lo = FitEsF[i] - it; }
      return spec + ' ' + um(hi) + ' / ' + um(lo);
    }
    m = /^([+\-]?[\d.]+)\/([+\-]?[\d.]+)$/.exec(spec);
    return m ? m[1] + ' / ' + m[2] : spec;
  }

  function getPackingTol(r) {
    var t = PackingTolerance[r.Product];
    if (!t) return { Inner: '—', Outer: '—', Width: '—' };
    var inner = [], outer = [];
    ['Piston', 'Rod'].forEach(function (u) {
      if (!t[u]) return;
      var label = r.Use === 'Both' ? { Piston: 'ピストン ', Rod: 'ロッド ' }[u] : '';
      inner.push(label + formatPackingTol(t[u].Inner, r.D1));
      outer.push(label + formatPackingTol(t[u].Outer, r.D2));
    });
    return { Inner: inner.join('／'), Outer: outer.join('／'), Width: formatPackingTol(t.Width, 0) };
  }

  function parsePackingTable(csv) {
    var lines = csv.replace(/^﻿/, '').trim().split(/\r?\n/);
    var head = lines.shift().split(',');
    return lines.map(function (line) {
      var c = line.split(','), o = {};
      head.forEach(function (h, i) { o[h.trim()] = (c[i] || '').trim(); });
      return { Product: o.Product, Use: o.Use, Code: o.Code, D1: +o.Inner, D2: +o.Outer, H: o.H, GA: +o.GA, GB: +o.GB, Backup: o.Backup, DiaD1: o.D1Dia || '' };
    });
  }

  function findPacking(opt) {
    var gi = opt.inner, go = opt.outer, gw = opt.width;
    var hasInner = gi != null, hasOuter = go != null, hasWidth = gw != null;
    if (!(hasInner || hasOuter || hasWidth)) throw new Error('溝の内径・外径・溝幅のどれか1つ以上を入力してください。');
    [gi, go, gw].forEach(function (v) {
      if (v != null && v <= 0) throw new Error('寸法には0より大きい値を入力してください。');
    });
    if (hasInner && hasOuter && go <= gi) throw new Error('溝の外径は内径より大きい値を入力してください。');
    var br = opt.backupRing || 'None', withBR = br !== 'None';

    var notes = [];
    if (hasInner) notes.push('d の差 ±' + PackingDiaTol + ' mm 以内');
    if (hasOuter) notes.push('D の差 ±' + PackingDiaTol + ' mm 以内');
    if (hasWidth) {
      notes.push('溝幅の差 ±' + PackingWidthTol + ' mm 以内（' + (withBR ? 'バックアップリングありの溝幅 GB' : 'バックアップリングなしの溝幅 GA') + '）');
      if (br === 'Both') notes.push('（サイズ表に両側の溝幅はないため、バックアップリングありの溝幅で判定）');
    }

    var matched = [];
    opt.table.forEach(function (r, i) {
      if ((opt.products || PackingProducts).indexOf(r.Product) < 0) return;
      var w = withBR ? r.GB : r.GA, dev = 0, e;
      if (hasInner) { e = Math.abs(gi - r.D1); if (e > PackingDiaTol + 1e-9) return; dev += e; }
      if (hasOuter) { e = Math.abs(go - r.D2); if (e > PackingDiaTol + 1e-9) return; dev += e; }
      if (hasWidth) { e = Math.abs(gw - w); if (e > PackingWidthTol + 1e-9) return; dev += e; }
      var tol = getPackingTol(r);
      matched.push({ Product: r.Product, Use: r.Use, Code: r.Code, D1: r.D1, D2: r.D2, DiaD1: r.DiaD1, H: r.H, Width: w,
        TolInner: tol.Inner, TolOuter: tol.Outer, TolWidth: tol.Width,
        Backup: withBR ? r.Backup : '', Deviation: dev, Order: i });
    });

    var byDev = function (a, b) { return a.Deviation - b.Deviation || a.Order - b.Order; };
    var groups = {}, names = [];
    matched.forEach(function (m) { if (!groups[m.Product]) { groups[m.Product] = []; names.push(m.Product); } groups[m.Product].push(m); });
    var tops = names.map(function (n) { return groups[n].sort(byDev).slice(0, MaxResults); });
    tops.sort(function (a, b) { return byDev(a[0], b[0]); });
    var candidates = [].concat.apply([], tops);

    return {
      Candidates: candidates,
      Reasons: candidates.length ? [] : ['入力した寸法に合う阪上パッキンはありません（許容差の範囲外）。'],
      Notes: notes
    };
  }

  var api = { parseTable: parseTable, findORing: findORing, parsePackingTable: parsePackingTable, findPacking: findPacking, MaxResults: MaxResults };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pakkin = api;
})(this);
