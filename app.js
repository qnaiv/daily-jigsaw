'use strict';
/* Daily Jigsaw (まいにちジグソー)
 * バニラJS・ビルドなし。前半は純粋ロジック (Node からも import 可能)、後半がブラウザUI。
 */

/* ================= 純粋ロジック ================= */

var BASE_DATE_FALLBACK = '2026-11-07';
var DIFFICULTIES = [36, 100, 225, 400, 784, 1225, 2025];
var TABSIZE = 0.2;      // デコの高さ = 一辺の約20%
var JITTER = 0.045;     // 制御点ジッター (辺長比)
var SNAP_DIST = 0.35;   // 相対スナップの許容距離 (セル単位)

/* ---- シード乱数 ---- */
function hashSeed(str) {
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngFromString(str) { return mulberry32(hashSeed(str)); }

/* ---- 日付 (JST) ---- */
function dateToMs(s) {
  var p = s.split('-');
  return Date.UTC(+p[0], +p[1] - 1, +p[2]);
}
function msToDateStr(ms) {
  var d = new Date(ms);
  function p2(v) { return String(v).padStart(2, '0'); }
  return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
}
function daysBetween(aStr, bStr) { return Math.round((dateToMs(aStr) - dateToMs(bStr)) / 86400000); }
function addDays(dateStr, delta) { return msToDateStr(dateToMs(dateStr) + delta * 86400000); }
function jstTodayString(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date());
}
/* 日付移動は廃止 (ユーザー指定): アプリは常に今日 (JST) のお題だけを開く。
 * ?date= パラメータにも対応しない。過去の記録はコレクションで見るだけ。 */

/* ---- お題決定: (対象日 - 基準日) mod プール ---- */
function pickImageId(dateStr, pool) {
  var ids = pool.ids;
  var days = daysBetween(dateStr, pool.baseDate || BASE_DATE_FALLBACK);
  var idx = ((days % ids.length) + ids.length) % ids.length;
  return ids[idx];
}
function imageSizeFor(pieces) {
  if (pieces <= 225) return 1080;
  if (pieces <= 784) return 1600;
  return 2048;
}

/* ---- 辺生成 (Draradech 方式) ----
 * 内部の境界ごとに「1本の曲線」を1回だけ生成し、隣り合う2ピースで共有する。
 * 座標系 (u, v): u は辺に沿って 0→1、v は外向き正方向への変位 (符号付き)。
 *   横境界 h[row][col]: u は +x 方向、v の + は +y (下のピース側)
 *   縦境界 v[row][col]: u は +y 方向、v の + は +x (右のピース側)
 * sign=+1 のとき、横境界では上のピースにデコ (下へ出る)、縦境界では左のピースにデコ (右へ出る)。
 * 輪郭 = 直線部 + 3次ベジェ3本 (付け根の遷移 → ノブ本体 → 付け根の遷移)。
 * 個体差: t (高さ 0.7〜1.3倍)、b (中心のずれ ±0.15)、a/c/d/e (制御点ジッター数%)。
 */
function genEdge(rng) {
  function jit() { return (rng() * 2 - 1) * JITTER; }
  var sign = rng() < 0.5 ? 1 : -1;
  var t = TABSIZE * (0.7 + rng() * 0.6);          // 低いノブ〜高いノブ
  var b = (rng() * 2 - 1) * 0.15;                  // ノブ中心のずれ ±15%
  var a = jit(), c = jit(), d = jit(), e = jit();
  // ノブが辺からはみ出さない保証: 頭の半幅 + 付け根の余白 + |ずれ| < 0.5
  var headHalf = 0.085 + t * 0.40 + Math.abs(d) * 0.5;
  var fillet = 0.06;
  var maxShift = 0.5 - headHalf - fillet - 0.02;
  if (Math.abs(b) > maxShift) b = Math.sign(b) * Math.max(0, maxShift);
  return { sign: sign, t: t, a: a, b: b, c: c, d: d, e: e, headHalf: headHalf, neckHalf: 0.045 + d * 0.5 };
}
/* 辺のベジェ区間列を返す。start: {u,v}, segs: [{x1,y1,x2,y2,x3,y3}] (終点のみ保持) */
function edgeSegments(edge) {
  var c = 0.5 + edge.b;
  var t = edge.t, s = edge.sign;
  var nh = edge.neckHalf, hh = edge.headHalf, fl = 0.06;
  var xs = c - hh - fl, xe = c + hh + fl;
  var a = edge.a, e = edge.e, tilt = edge.c;
  var segs = [
    // 付け根の遷移: 直線部から首へなめらかに入る
    { x1: c - nh - 0.055, y1: s * 0.0, x2: c - nh - 0.040, y2: s * t * 0.45, x3: c - nh, y3: s * t * 0.60 },
    // ノブ本体: 首より幅広い丸い頭 (制御点を高くして頂点が t に届くようにする)
    { x1: c - hh - 0.02 + tilt, y1: s * t * 1.12, x2: c + hh + 0.02 + tilt, y2: s * t * 1.12, x3: c + nh, y3: s * t * 0.60 },
    // 付け根の遷移: 首から直線部へ戻る
    { x1: c + nh + 0.040, y1: s * t * 0.45, x2: c + nh + 0.055, y2: s * 0.0, x3: xe, y3: s * e * 0.3 }
  ];
  return { start: { u: 0, v: s * a }, lineTo: { u: xs, v: s * a * 0.3 }, segs: segs, end: { u: 1, v: s * e } };
}
/* 辺をサンプリングした点列 [{u,v}] を返す (始点→終点) */
function sampleEdge(edge, perSeg) {
  perSeg = perSeg || 8;
  var es = edgeSegments(edge);
  var pts = [{ u: es.start.u, v: es.start.v }, { u: es.lineTo.u, v: es.lineTo.v }];
  var cur = es.lineTo;
  function cubic(p0, p1, p2, p3, tt) {
    var mt = 1 - tt;
    return mt * mt * mt * p0 + 3 * mt * mt * tt * p1 + 3 * mt * tt * tt * p2 + tt * tt * tt * p3;
  }
  es.segs.forEach(function (sg) {
    for (var i = 1; i <= perSeg; i++) {
      var tt = i / perSeg;
      pts.push({
        u: cubic(cur.u, sg.x1, sg.x2, sg.x3, tt),
        v: cubic(cur.v, sg.y1, sg.y2, sg.y3, tt)
      });
    }
    cur = { u: sg.x3, v: sg.y3 };
  });
  pts.push({ u: es.end.u, v: es.end.v });
  return pts;
}
/* 全境界の生成。h[row][col] (row 1..n-1), v[row][col] (col 1..n-1) */
function generateEdges(dateStr, pieces) {
  var n = Math.round(Math.sqrt(pieces));
  var rng = rngFromString(dateStr + ':' + pieces);
  var h = [], v = [], r, c;
  for (r = 0; r <= n; r++) { h.push(new Array(n).fill(null)); v.push(new Array(n + 1).fill(null)); }
  for (r = 1; r < n; r++) for (c = 0; c < n; c++) h[r][c] = genEdge(rng);
  for (r = 0; r < n; r++) for (c = 1; c < n; c++) v[r][c] = genEdge(rng);
  return { n: n, h: h, v: v };
}
/* ピース (col,row) の一辺をピースローカル座標 (セル=1) の点列で返す。side: 'top'|'right'|'bottom'|'left'
 * 輪郭の周回順 (時計回り) に合わせ、top:左→右 / right:上→下 / bottom:右→左 / left:下→上 で返す。 */
function sideSamples(edges, col, row, side, perSeg) {
  var n = edges.n, edge = null, map, reversed = false;
  if (side === 'top') {
    if (row === 0) return [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    edge = edges.h[row][col];
    map = function (p) { return { x: p.u, y: p.v }; };
  } else if (side === 'bottom') {
    if (row === n - 1) return [{ x: 1, y: 1 }, { x: 0, y: 1 }];
    edge = edges.h[row + 1][col];
    map = function (p) { return { x: p.u, y: 1 + p.v }; };
    reversed = true;
  } else if (side === 'right') {
    if (col === n - 1) return [{ x: 1, y: 0 }, { x: 1, y: 1 }];
    edge = edges.v[row][col + 1];
    map = function (p) { return { x: 1 + p.v, y: p.u }; };
  } else { // left
    if (col === 0) return [{ x: 0, y: 1 }, { x: 0, y: 0 }];
    edge = edges.v[row][col];
    map = function (p) { return { x: p.v, y: p.u }; };
    reversed = true;
  }
  var pts = sampleEdge(edge, perSeg || 8).map(map);
  return reversed ? pts.reverse() : pts;
}
/* ピース輪郭の全点列 (時計回り、始点は重複させない) */
function pieceOutlinePoints(edges, col, row, perSeg) {
  var sides = ['top', 'right', 'bottom', 'left'];
  var all = [];
  sides.forEach(function (side) {
    var pts = sideSamples(edges, col, row, side, perSeg);
    for (var i = 0; i < pts.length - 1; i++) all.push(pts[i]);
  });
  return all;
}

/* ---- グリッド / 塊 / 完成判定 ----
 * 塊 (cluster) = { pieces:[id...], surface:'desk'|'mat', gx, gy }
 * (gx, gy) は塊の anchor ピース (id最小) が置かれているグリッド座標。
 * ピース id = row * n + col, ホーム座標 = (col, row)。
 */
function pieceHome(id, n) { return { col: id % n, row: Math.floor(id / n) }; }
function clusterAnchorId(cluster) { return Math.min.apply(null, cluster.pieces); }
function piecePositions(clusters, n) {
  var pos = new Map();
  clusters.forEach(function (cl) {
    var anchor = pieceHome(clusterAnchorId(cl), n);
    cl.pieces.forEach(function (id) {
      var home = pieceHome(id, n);
      pos.set(id, { surface: cl.surface, gx: cl.gx + (home.col - anchor.col), gy: cl.gy + (home.row - anchor.row) });
    });
  });
  return pos;
}
function snapToGrid(v) { return Math.round(v); }
/* ドラッグ中の塊 drag (gx, gy は浮動小数) が、他の塊のどれかと本来の隣接関係で
 * 合体できる位置に近いかを調べる。合体できれば { other, gx, gy } (吸着先) を返す。 */
function findRelativeSnap(drag, others, n) {
  var anchor = pieceHome(clusterAnchorId(drag), n);
  var dragSet = new Set(drag.pieces);
  var best = null;
  var otherPos = piecePositions(others, n);
  drag.pieces.forEach(function (id) {
    var home = pieceHome(id, n);
    var offX = home.col - anchor.col, offY = home.row - anchor.row;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    dirs.forEach(function (d) {
      var nid = (home.row + d[1]) * n + (home.col + d[0]);
      if (home.col + d[0] < 0 || home.col + d[0] >= n || home.row + d[1] < 0 || home.row + d[1] >= n) return;
      if (dragSet.has(nid) || !otherPos.has(nid)) return;
      var q = otherPos.get(nid);
      if (q.surface !== drag.surface) return;
      var needX = q.gx - d[0] - offX, needY = q.gy - d[1] - offY;
      var dist = Math.hypot(drag.gx - needX, drag.gy - needY);
      if (dist <= SNAP_DIST && (!best || dist < best.dist)) {
        var other = others.find(function (o) { return o.pieces.indexOf(nid) >= 0; });
        best = { other: other, gx: needX, gy: needY, dist: dist };
      }
    });
  });
  return best;
}
/* ドラッグした塊 moving を others の中へ合体させる。
 * 手順: (1) 現在位置 (浮動小数) から相対スナップ範囲内で合体を試みる
 *       (2) 合体しなかったらグリッド吸着し、吸着後にちょうど正しい相対位置に
 *           揃っていたら必ず合体させる (「合っているのにくっつかない」防止)
 *       (3) 合体した塊がさらに別の塊とも正しく隣接していれば連鎖合体する
 * opts.noSnap=true のときは (2) のグリッド吸着を行わず、現在位置のままで
 * 合体判定だけを行う (範囲選択の追随塊用: 相対配置を壊さないため)。
 * 返り値: { clusters: 合体後の全塊, cluster: moving を含む塊, merged: 合体したか } */
function absorbMerges(others, moving, n, opts) {
  var noSnap = !!(opts && opts.noSnap);
  var pool = others.slice();
  var cur = { pieces: moving.pieces.slice(), surface: moving.surface, gx: moving.gx, gy: moving.gy };
  var merged = false;
  function tryOnce(exactOnly) {
    var snap = findRelativeSnap(cur, pool, n);
    if (!snap) return false;
    if (exactOnly && snap.dist > 1e-9) return false;
    var trial = { pieces: cur.pieces, surface: cur.surface, gx: snap.gx, gy: snap.gy };
    var posOther = piecePositions([snap.other], n);
    var posTrial = piecePositions([trial], n);
    var pieces = Array.from(new Set(snap.other.pieces.concat(cur.pieces)));
    var anchorId = clusterAnchorId({ pieces: pieces });
    var ap = posOther.get(anchorId) || posTrial.get(anchorId);
    cur = { pieces: pieces, surface: cur.surface, gx: ap.gx, gy: ap.gy };
    pool.splice(pool.indexOf(snap.other), 1);
    merged = true;
    return true;
  }
  while (tryOnce(false)) { /* 連鎖合体 */ }
  if (!merged) {
    if (!noSnap) { cur.gx = snapToGrid(cur.gx); cur.gy = snapToGrid(cur.gy); }
    while (tryOnce(true)) { /* 吸着後 (noSnap 時は現在位置) で正しい相対位置なら確実合体 */ }
  }
  return { clusters: pool.concat([cur]), cluster: cur, merged: merged };
}

/* 範囲選択: 矩形 (セル座標・正規化済み {x0,y0,x1,y1}、x0<x1, y0<y1 前提) と
 * 交差するピースを持つ塊を返す。ピースの矩形は [gx, gx+1] × [gy, gy+1] で、
 * 辺だけが接する場合は交差とみなさない。surface を渡すとその面の塊だけに絞る。 */
function clustersInRect(clusters, n, rect, surface) {
  var pos = piecePositions(clusters, n);
  return clusters.filter(function (cl) {
    if (surface && cl.surface !== surface) return false;
    for (var i = 0; i < cl.pieces.length; i++) {
      var p = pos.get(cl.pieces[i]);
      if (p && p.gx < rect.x1 && p.gx + 1 > rect.x0 && p.gy < rect.y1 && p.gy + 1 > rect.y0) return true;
    }
    return false;
  });
}
/* 塊の配列を (dx, dy) だけ平行移動した新しい配列を返す (元の塊は変更しない)。
 * 範囲選択のグループ移動で「掴んだ塊の確定移動量を他の塊へ追随させる」計算に使う。 */
function shiftClusters(clusters, dx, dy) {
  return clusters.map(function (cl) {
    return { pieces: cl.pieces.slice(), surface: cl.surface, gx: cl.gx + dx, gy: cl.gy + dy };
  });
}

/* 散らばり領域 (セル単位の矩形): 机ワールドの広さそのもの。
 * 旧来の机ビュー (横 n+6 × 縦 n+4) の約1.9倍の面積を縦横に確保し、
 * マット盤 (n×n) をほぼ中央に含む。fitView (初期カメラ/ズーム下限) もこれを使う。 */
function scatterRect(pieces) {
  var n = Math.round(Math.sqrt(pieces));
  var w = Math.ceil((n + 6) * 1.35);
  var h = Math.ceil((n + 4) * 1.4);
  return { x0: -Math.floor((w - n) / 2), y0: -Math.floor((h - n) / 2), w: w, h: h };
}

/* 初期散らばり: 全ピースを机にぶちまけた状態にする (自由配置)。
 * セル方式はやめ、日付×難易度シードで決定的に各ピースの左上座標を直接決める。
 * 密度にムラを出すため、大半のピースは数個のクラスタ中心の周りにばら撒き、
 * 残りは領域全体へ一様に散らす (固まった場所と空いた場所ができる)。
 * ところどころ重なってよいが、完全に隠れて掴めなくならないよう、既配置ピースとの
 * 重なり (面積比) が 0.42 を超える候補は再抽選し、上限回数でも駄目なら
 * 最も重なりの小さい候補を採る。回転は入れない。
 * 再訪時の復元は保存済み配置そのままで、この関数は新規開始時にだけ呼ばれる。 */
function initialScatter(dateStr, pieces) {
  var rect = scatterRect(pieces);
  var rng = rngFromString('scatter:' + dateStr + ':' + pieces);
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  // クラスタ中心 (密度のムラの芯)
  var nCenters = Math.max(3, Math.min(14, Math.round(pieces / 90)));
  var centers = [];
  for (var ci = 0; ci < nCenters; ci++) {
    centers.push({ x: rect.x0 + rng() * rect.w, y: rect.y0 + rng() * rect.h });
  }
  var radX = rect.w * 0.16, radY = rect.h * 0.16;
  // 空間ハッシュ (1セルバケット) で近傍の重なり検査を安くする
  var buckets = new Map();
  function worstOverlap(x, y) {
    var bx = Math.floor(x), by = Math.floor(y), worst = 0;
    for (var i = bx - 1; i <= bx + 1; i++) {
      for (var j = by - 1; j <= by + 1; j++) {
        var arr = buckets.get(i + ',' + j);
        if (!arr) continue;
        for (var k = 0; k < arr.length; k++) {
          var ox = 1 - Math.abs(x - arr[k].x), oy = 1 - Math.abs(y - arr[k].y);
          if (ox > 0 && oy > 0 && ox * oy > worst) worst = ox * oy;
        }
      }
    }
    return worst;
  }
  function put(x, y) {
    var key = Math.floor(x) + ',' + Math.floor(y);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ x: x, y: y });
  }
  function sample(uniformOnly) {
    var x, y;
    if (!uniformOnly && rng() < 0.72) {
      var c = centers[Math.floor(rng() * centers.length)];
      x = c.x + (rng() + rng() - 1) * radX; // 三角分布で中心ほど濃く
      y = c.y + (rng() + rng() - 1) * radY;
    } else {
      x = rect.x0 + rng() * rect.w;
      y = rect.y0 + rng() * rect.h;
    }
    // ピース全体 (1セル) が領域内に収まるようクランプ
    return {
      x: clamp(x, rect.x0, rect.x0 + rect.w - 1),
      y: clamp(y, rect.y0, rect.y0 + rect.h - 1)
    };
  }
  var clusters = [];
  for (var id = 0; id < pieces; id++) {
    var best = null, bestOv = Infinity, t;
    for (t = 0; t < 12; t++) {           // 第1段: クラスタ寄せ＋一様の混合で抽選
      var p1 = sample(false);
      var ov1 = worstOverlap(p1.x, p1.y);
      if (ov1 < bestOv) { bestOv = ov1; best = p1; }
      if (ov1 <= 0.42) break;
    }
    if (bestOv > 0.42) {                 // 第2段: 一様抽選で逃げ場を探す
      for (t = 0; t < 28; t++) {
        var p2 = sample(true);
        var ov2 = worstOverlap(p2.x, p2.y);
        if (ov2 < bestOv) { bestOv = ov2; best = p2; }
        if (ov2 <= 0.42) break;
      }
    }
    put(best.x, best.y);
    clusters.push({ pieces: [id], surface: 'desk', gx: best.x, gy: best.y });
  }
  // 重なり順もシャッフルする (後ろの要素ほど手前に描かれ、ヒットテストも優先される)
  for (var m = clusters.length - 1; m > 0; m--) {
    var s = Math.floor(rng() * (m + 1));
    var t2 = clusters[m]; clusters[m] = clusters[s]; clusters[s] = t2;
  }
  return clusters;
}

/* スタート画面の箱の包装柄 (完成写真は載せない)。日付シードで決定的にローテーション */
var BOX_PATTERNS = [
  { id: 'dots-red', name: '生成りに細ドット' },
  { id: 'stripes-mint', name: '細ストライプ' },
  { id: 'stars-navy', name: '紺に小星' },
  { id: 'gingham-pink', name: '細ギンガム' },
  { id: 'confetti', name: '小紋' },
  { id: 'floral-retro', name: '小花' }
];
function boxPatternIndex(dateStr) {
  var days = daysBetween(dateStr, BASE_DATE_FALLBACK);
  return ((days % BOX_PATTERNS.length) + BOX_PATTERNS.length) % BOX_PATTERNS.length;
}
function boxPatternForDate(dateStr) { return BOX_PATTERNS[boxPatternIndex(dateStr)]; }

/* 完成判定 (内部のみ): 全ピースがマット上にあり、各ピースがホーム座標に一致 */
function isComplete(clusters, n) {
  var pos = piecePositions(clusters, n);
  if (pos.size !== n * n) return false;
  for (var id = 0; id < n * n; id++) {
    var p = pos.get(id), home = pieceHome(id, n);
    if (!p || p.surface !== 'mat' || p.gx !== home.col || p.gy !== home.row) return false;
  }
  return true;
}
function isEdgePiece(id, n) {
  var h = pieceHome(id, n);
  return h.col === 0 || h.row === 0 || h.col === n - 1 || h.row === n - 1;
}

/* ---- コレクション詳細の「完成盤面」描画用レイアウト ----
 * 詳細では写真を通常表示でなく、マットに完成させたときと同じ見た目
 * (全ピースがホーム座標に置かれ、輪郭と凹凸が見える) で Canvas 描画する。
 * プレイ画面のマット (fitView('mat')) と同じく、盤の周りに1セルの余白を取る。 */
function completedBoardLayout(pieces, sizePx) {
  var n = Math.round(Math.sqrt(pieces));
  var cellPx = sizePx / (n + 2);
  return { n: n, cellPx: cellPx, ox: cellPx, oy: cellPx, boardPx: cellPx * n };
}
/* 詳細描画の解像度と辺サンプリング密度。表示は1回だけなので重くなりすぎない
 * 範囲で、ピース数が多い難易度ほど解像度と密度を落として固まらないようにする。 */
function detailRenderPlan(pieces) {
  var n = Math.round(Math.sqrt(pieces));
  return {
    n: n,
    sizePx: n >= 45 ? 736 : n >= 28 ? 864 : 960,
    perSeg: n >= 28 ? 6 : 10
  };
}
/* ---- 机の木目タイル敷き (描画オフセット計算) ----
 * 木目タイルはワールド座標に固定して敷く (パン/ズームで机の上を動く感触)。
 * CanvasPattern.setTransform には頼らない: パターンの変換行列は CTM (dpr) との
 * 合成や再ラスタライズの扱いがブラウザごとに異なり、マットでカメラを動かした
 * あと机に戻るとタイルの実効スケールがずれて継ぎ目が太く崩れて見える事故が
 * あったため、タイルは drawImage で明示的に敷く方式に統一する。
 * woodTileOrigin: ワールド原点の画面座標 offset から、タイルを描き始める
 * 画面座標を返す。結果は (-size, 0] の範囲に収まり、offset - result は size の
 * 整数倍になる (タイル境界が常にワールドに固定される)。負の offset でも壊れない。 */
function woodTileOrigin(offset, size) {
  if (!(size > 0)) return 0;
  var m = offset % size;
  if (m > 0) m -= size;
  return m;
}

/* 机背景キャッシュのキー: テーマ・ステージ実寸 (CSS px)・dpr・カメラ
 * (scale/tx/ty) がすべて一致したときだけ、キャッシュした机背景を
 * 使い回せる。カメラの文字列化精度は draw() のミニマップ変化検知
 * (camKey) と同じ (scale 4桁 / tx,ty 1桁) にそろえ、検知とキャッシュの
 * 「変わった」判定がずれないようにする。 */
function deskBgKey(theme, w, h, dpr, v) {
  return theme + '|' + w + 'x' + h + '|d' + dpr + '|' +
    v.scale.toFixed(4) + '|' + v.tx.toFixed(1) + '|' + v.ty.toFixed(1);
}

/* マット盤の外側かどうか (セル座標)。盤の範囲は [0, n) × [0, n)。
 * マット画面で盤の外をタップしたら机に戻る判定に使う。 */
function isOutsideBoardCell(gx, gy, n) {
  return gx < 0 || gy < 0 || gx >= n || gy >= n;
}

/* ミニマップ: ワールド矩形 (セル単位 {x0, y0, w, h}) を maxW × maxH (px) に
 * アスペクト維持で収め、中央寄せするレイアウトを返す。
 * 返り値の (ox, oy) に (セルの位置 - rect.x0/y0) * scale を足すとマップ内座標になる。 */
function minimapLayout(rect, maxW, maxH) {
  var scale = Math.min(maxW / rect.w, maxH / rect.h);
  var w = rect.w * scale, h = rect.h * scale;
  return { scale: scale, w: w, h: h, ox: (maxW - w) / 2, oy: (maxH - h) / 2 };
}

/* ピースの立体感 (bitmap px): 「わずかな厚み」と縁のベベル幅をセルサイズから決める。
 * 比率はユーザーがスライダープレビューで決めた確定値 (厚み 3.7% / ベベル幅 2.2%)。
 * 厚みは大セルで 3.7% が効くよう最大 8px まで許すが、セルが小さい難易度
 * (2025ピース等) では比率が膨らんで汚く見えないよう最小限 (約1px) に抑える。
 * ベベルは 1px〜6px。濃さ (0.7倍) と側面の暗さ (0.41) は描画側の定数で持つ。
 * 返り値: { thickness: 側面の押し出し量 (下方向), bevel: 縁の陰影の幅 } */
function pieceRelief(cellPx) {
  if (!(cellPx > 0)) return { thickness: 0, bevel: 0 };
  var thickness = cellPx * 0.037;
  if (thickness < 1) thickness = Math.min(1, cellPx * 0.04); // 小セルでは最小限 (セル比4%まで)
  if (thickness > 8) thickness = 8;
  var bevel = cellPx * 0.022;
  if (bevel < 1) bevel = 1;
  if (bevel > 6) bevel = 6;
  return { thickness: thickness, bevel: bevel };
}

/* ---- BGM プレイリスト (純粋ロジック) ----
 * 再生はブラウザ側 (HTMLAudioElement) の責務だが、「どの順で・何回繰り返すか」
 * の規則はここに切り出してテスト可能にする。
 * - シャッフルは「全曲一巡するまで重複なし」: shuffledOrder が 0..count-1 の
 *   順列を返し、UI 側はその順に再生し切ったら次の順列を作る。
 * - 一巡の継ぎ目で同じ曲が連続しないよう、nextShuffleOrder は直前に再生した
 *   曲 (lastPlayed) が先頭に来たら 2 番目と入れ替える (曲数 2 以上のとき)。
 * - 短い曲 (90 秒未満) は 2 回続けて再生してから次へ進む (trackPlays)。
 *   長さが取れない曲 (0 以下・NaN) は短い扱いにしない (無限ループ防止)。 */
var BGM_SHORT_TRACK_SEC = 90;
function isShortTrack(durationSec) {
  return typeof durationSec === 'number' && durationSec > 0 && durationSec < BGM_SHORT_TRACK_SEC;
}
function trackPlays(durationSec) { return isShortTrack(durationSec) ? 2 : 1; }
function shuffledOrder(count, rng) {
  var order = [];
  for (var i = 0; i < count; i++) order.push(i);
  for (var j = count - 1; j > 0; j--) {
    var k = Math.floor(rng() * (j + 1));
    if (k < 0) k = 0; if (k > j) k = j; // rng が範囲外を返しても壊れないように
    var t = order[j]; order[j] = order[k]; order[k] = t;
  }
  return order;
}
function nextShuffleOrder(count, rng, lastPlayed) {
  var order = shuffledOrder(count, rng);
  if (count > 1 && typeof lastPlayed === 'number' && order[0] === lastPlayed) {
    var t = order[0]; order[0] = order[1]; order[1] = t;
  }
  return order;
}

/* 保存済み進捗が「開始済み」かどうか。
 * 旧バージョンの保存 (started フラグなし) でも、塊が残っていれば開始済みとして扱う。 */
function progressIsStarted(prog) {
  return !!prog && (!!prog.started || !!(prog.clusters && prog.clusters.length > 0));
}

/* スタート画面でその難易度について出すパネルの種類。
 * 'box' = 未開始 (包装された箱) / 'resume' = 進行中 (つづきから・はじめから) /
 * 'cleared' = クリア済み (ベストタイム表示)。起動時は進捗があっても必ず
 * スタート画面から始めるので、机への自動復帰はせずこの判定で出し分ける。 */
function startPanelMode(prog) {
  if (!prog) return 'box';
  if (prog.cleared) return 'cleared';
  return progressIsStarted(prog) ? 'resume' : 'box';
}

/* 「はじめから」を押したときに進捗リセットの確認が要るか (未開始なら確認不要)。 */
function freshStartNeedsConfirm(prog) {
  return startPanelMode(prog) !== 'box';
}

function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  var m = Math.floor(sec / 60), s = sec % 60, hh = Math.floor(m / 60);
  function p2(v) { return String(v).padStart(2, '0'); }
  return hh > 0 ? hh + ':' + p2(m % 60) + ':' + p2(s) : p2(m) + ':' + p2(s);
}

var PureLogic = {
  BASE_DATE_FALLBACK: BASE_DATE_FALLBACK, DIFFICULTIES: DIFFICULTIES,
  TABSIZE: TABSIZE, JITTER: JITTER, SNAP_DIST: SNAP_DIST,
  hashSeed: hashSeed, mulberry32: mulberry32, rngFromString: rngFromString,
  dateToMs: dateToMs, msToDateStr: msToDateStr, daysBetween: daysBetween, addDays: addDays,
  jstTodayString: jstTodayString,
  pickImageId: pickImageId, imageSizeFor: imageSizeFor,
  genEdge: genEdge, edgeSegments: edgeSegments, sampleEdge: sampleEdge,
  generateEdges: generateEdges, sideSamples: sideSamples, pieceOutlinePoints: pieceOutlinePoints,
  pieceHome: pieceHome, clusterAnchorId: clusterAnchorId, piecePositions: piecePositions,
  snapToGrid: snapToGrid, findRelativeSnap: findRelativeSnap, isComplete: isComplete,
  absorbMerges: absorbMerges, clustersInRect: clustersInRect, shiftClusters: shiftClusters,
  scatterRect: scatterRect, initialScatter: initialScatter,
  BOX_PATTERNS: BOX_PATTERNS, boxPatternIndex: boxPatternIndex, boxPatternForDate: boxPatternForDate,
  isEdgePiece: isEdgePiece, formatTime: formatTime,
  progressIsStarted: progressIsStarted, startPanelMode: startPanelMode, freshStartNeedsConfirm: freshStartNeedsConfirm,
  completedBoardLayout: completedBoardLayout, detailRenderPlan: detailRenderPlan,
  woodTileOrigin: woodTileOrigin, deskBgKey: deskBgKey, isOutsideBoardCell: isOutsideBoardCell, minimapLayout: minimapLayout,
  pieceRelief: pieceRelief,
  BGM_SHORT_TRACK_SEC: BGM_SHORT_TRACK_SEC, isShortTrack: isShortTrack, trackPlays: trackPlays,
  shuffledOrder: shuffledOrder, nextShuffleOrder: nextShuffleOrder
};
if (typeof module !== 'undefined' && module.exports) module.exports = PureLogic;

/* ================= ブラウザ UI ================= */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
(function () {
var $ = function (id) { return document.getElementById(id); };
var STORE_KEY = 'daily-jigsaw:v1';
var CELL = 100; // ワールド単位: 1セル = 100

/* ---------- 保存 ---------- */
function loadStore() {
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (raw) { var s = JSON.parse(raw); if (s && s.progress && s.records) return s; }
  } catch (e) { /* ignore */ }
  return { records: [], progress: {}, lastDifficulty: 36, uiTheme: 'walnut', bgmOn: true, bgmVolume: 0.7, seOn: true };
}
var store = loadStore();
function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 容量超過などは無視 */ }
}

/* ---------- テーマ (A ウォルナット / B 北欧ペーパー / C ダーク・アトリエ) ----------
 * UI の配色は CSS 変数 (style.css の [data-theme] ) で切り替える。
 * ここでは Canvas 側 (机の木目・マット色・紙吹雪) と箱の包装紙の色を持つ。
 * 選択は store.uiTheme に保存する (旧保存データに無ければ 'walnut')。 */
var THEME_NAMES = ['walnut', 'nordic', 'atelier'];
var THEMES = {
  walnut: {
    mat: '#33523f',
    brass: '#c9a227', // 範囲選択ハイライト (CSS の --brass と一致)
    wood: { stops: ['#7a5636', '#64452a', '#7a5636'], grain: [70, 105, 45, 68, 18, 30], seamDark: 'rgba(43,26,10,0.40)', seamLight: 'rgba(255,238,200,0.10)', knot: '60,38,16', fallback: '#6b4a2a', vigLight: 'rgba(255,240,210,0.06)', vigDark: 'rgba(30,17,4,0.22)' },
    confetti: ['#33523f', '#c9a227', '#f5efe4', '#7a3b3a', '#8a6d3b'],
    box: {
      'dots-red': { bg: '#efe6d0', fg: '#33523f', fg2: '#c9a227' },
      'stripes-mint': { bg: '#33523f', fg: '#efe6d0', fg2: '#c9a227' },
      'stars-navy': { bg: '#2c3a55', fg: '#c9a227', fg2: '#e8ddc8' },
      'gingham-pink': { bg: '#e9d5cf', fg: '#a05a52', fg2: '#a05a52' },
      'confetti': { bg: '#f2ead6', fg: '#8a6d3b', fg2: '#33523f' },
      'floral-retro': { bg: '#a9603f', fg: '#f3e3c2', fg2: '#33523f' }
    }
  },
  nordic: {
    mat: '#9db89a',
    brass: '#c99b3f',
    wood: { stops: ['#dec294', '#d2af7e', '#dec294'], grain: [150, 182, 114, 140, 68, 96], seamDark: 'rgba(146,110,58,0.32)', seamLight: 'rgba(255,255,255,0.22)', knot: '150,112,62', fallback: '#d9b98c', vigLight: 'rgba(255,255,255,0.10)', vigDark: 'rgba(120,84,32,0.12)' },
    confetti: ['#cf6f4f', '#9db89a', '#fbfaf7', '#d9a441', '#7d9bb3'],
    box: {
      'dots-red': { bg: '#fbfaf7', fg: '#9db89a', fg2: '#cf6f4f' },
      'stripes-mint': { bg: '#9db89a', fg: '#fbfaf7', fg2: '#cf6f4f' },
      'stars-navy': { bg: '#aebfd0', fg: '#fbfaf7', fg2: '#cf6f4f' },
      'gingham-pink': { bg: '#f7e8e4', fg: '#e0a89c', fg2: '#e0a89c' },
      'confetti': { bg: '#fdfaf2', fg: '#cf6f4f', fg2: '#9db89a' },
      'floral-retro': { bg: '#dfa184', fg: '#fdf6ec', fg2: '#9db89a' }
    }
  },
  atelier: {
    mat: '#5e2f35',
    brass: '#b08d4f',
    wood: { stops: ['#413125', '#352820', '#413125'], grain: [10, 26, 7, 18, 4, 12], seamDark: 'rgba(0,0,0,0.50)', seamLight: 'rgba(232,221,200,0.07)', knot: '10,7,4', fallback: '#3a2c22', vigLight: 'rgba(232,221,200,0.04)', vigDark: 'rgba(0,0,0,0.35)' },
    confetti: ['#b08d4f', '#5e2f35', '#e8ddc8', '#33523f', '#8a6d3b'],
    box: {
      'dots-red': { bg: '#2e2620', fg: '#b08d4f', fg2: '#5e2f35' },
      'stripes-mint': { bg: '#5e2f35', fg: '#e8ddc8', fg2: '#b08d4f' },
      'stars-navy': { bg: '#232c42', fg: '#b08d4f', fg2: '#e8ddc8' },
      'gingham-pink': { bg: '#4a3230', fg: '#8a5a52', fg2: '#8a5a52' },
      'confetti': { bg: '#33291f', fg: '#b08d4f', fg2: '#5e2f35' },
      'floral-retro': { bg: '#5e2f35', fg: '#d9b98c', fg2: '#b08d4f' }
    }
  }
};
var uiTheme = THEME_NAMES.indexOf(store.uiTheme) >= 0 ? store.uiTheme : 'walnut';
document.documentElement.setAttribute('data-theme', uiTheme);
function applyTheme() {
  document.documentElement.setAttribute('data-theme', uiTheme);
  document.querySelectorAll('[data-theme-opt]').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-theme-opt') === uiTheme);
  });
  invalidateDeskBackdrop(); // 木目・マット色が変わるので背景レイヤーを作り直す
  if (state) { renderStartScreen(); draw(); } // 箱の色と Canvas (木目/マット) を新テーマで描き直す
  if (typeof detailRecord !== 'undefined' && detailRecord && !$('detailModal').hidden) renderDetailPuzzle(detailRecord); // 詳細のマット色も追従
}
function setUiTheme(name) {
  if (THEME_NAMES.indexOf(name) < 0) return;
  uiTheme = name;
  store.uiTheme = name;
  saveStore();
  applyTheme();
}
/* ---------- サウンド (BGM / SE) ----------
 * 設定はテーマと同じ流儀で store に保存する (bgmOn / bgmVolume / seOn)。
 * 旧バージョンの保存データにはキーが無いので、その場合は既定値を使う。 */
var bgmOn = store.bgmOn !== false;
var bgmVolume = (typeof store.bgmVolume === 'number' && isFinite(store.bgmVolume))
  ? Math.min(1, Math.max(0, store.bgmVolume)) : 0.7;
var seOn = store.seOn !== false;
function saveAudioSettings() {
  store.bgmOn = bgmOn;
  store.bgmVolume = bgmVolume;
  store.seOn = seOn;
  saveStore();
}

/* ---- BGM ----
 * プレイリスト 13 曲 (合計 40:56)。選曲 UI は持たず、シャッフルで
 * 全曲一巡するまで重複なく再生する (順列の規則は PureLogic)。
 * 短い曲 (90 秒未満) は 2 回続けて再生してから次へ進む。
 * 再生開始は最初のユーザー操作のあと (自動再生ポリシー)。曲が替わるたびに
 * 右下へ曲名と作者を小さく出して数秒で消す (クレジット表示を兼ねる)。 */
var BGM_TRACKS = [
  { file: 'meditation-impromptu-01.mp3', title: 'Meditation Impromptu 01', artist: 'Kevin MacLeod', license: 'CC BY 4.0' },
  { file: 'meditation-impromptu-02.mp3', title: 'Meditation Impromptu 02', artist: 'Kevin MacLeod', license: 'CC BY 4.0' },
  { file: 'meditation-impromptu-03.mp3', title: 'Meditation Impromptu 03', artist: 'Kevin MacLeod', license: 'CC BY 4.0' },
  { file: 'when-time-called-me-darling.mp3', title: 'When Time Called Me Darling', artist: 'HoliznaCC0', license: 'CC0' },
  { file: 'still-life.mp3', title: 'Still Life', artist: 'HoliznaCC0', license: 'CC0' },
  { file: 'birds.mp3', title: 'Birds', artist: 'HoliznaCC0', license: 'CC0' },
  { file: 'one-night-in-france.mp3', title: 'One Night In France', artist: 'HoliznaCC0', license: 'CC0' },
  { file: 'break-from-reality.mp3', title: 'Break From Reality', artist: 'HoliznaCC0', license: 'CC0' },
  { file: 'orchid.mp3', title: 'Orchid', artist: 'HoliznaCC0', license: 'CC0' },
  { file: 'tranquil-mindscape.mp3', title: 'Tranquil Mindscape', artist: 'HoliznaCC0', license: 'CC0' },
  { file: 'wetlands.mp3', title: 'Wetlands', artist: 'HoliznaCC0', license: 'CC0' },
  { file: 'coffee-lounge.mp3', title: 'Coffee Lounge', artist: 'PeriTune', license: 'CC BY 4.0' },
  { file: 'positive3.mp3', title: 'Positive3', artist: 'PeriTune', license: 'CC BY 4.0' }
];
var bgm = {
  audio: null, order: [], pos: 0, current: -1, playsLeft: 1,
  started: false, hiddenPaused: false, toastTimer: null, errorStreak: 0
};
function bgmEnsure() {
  if (bgm.audio) return bgm.audio;
  var a = new Audio();
  a.preload = 'auto';
  a.volume = bgmVolume;
  a.addEventListener('loadedmetadata', function () {
    bgm.playsLeft = trackPlays(a.duration); // 短い曲は 2 回 (長さ確定後に決める)
  });
  a.addEventListener('ended', function () {
    bgm.playsLeft--;
    if (bgm.playsLeft > 0) { // 短い曲の 2 回目: 同じ曲をもう一度
      a.currentTime = 0;
      bgmPlayPromise(a.play());
    } else {
      bgmNext();
    }
  });
  a.addEventListener('playing', function () { bgm.errorStreak = 0; });
  a.addEventListener('error', function () {
    // 読めない曲で止まらないよう次へ進む。ただし全曲読めない場合は
    // 一巡ぶん試したところで諦める (次へ進み続ける無限ループにしない)
    if (!bgm.started) return;
    bgm.errorStreak++;
    if (bgm.errorStreak < BGM_TRACKS.length) bgmNext();
  });
  bgm.audio = a;
  return a;
}
function bgmPlayPromise(p) {
  if (p && p.catch) p.catch(function () { /* 自動再生拒否などは黙って無視 */ });
}
function bgmShowToast(track) {
  var el = $('bgmToast');
  if (!el) return;
  el.textContent = '♪ ' + track.title + ' — ' + track.artist;
  el.classList.add('show');
  if (bgm.toastTimer) clearTimeout(bgm.toastTimer);
  bgm.toastTimer = setTimeout(function () { el.classList.remove('show'); }, 4500);
}
function bgmPlayTrack(idx) {
  var a = bgmEnsure();
  bgm.current = idx;
  bgm.playsLeft = 1; // loadedmetadata で短い曲なら 2 に更新される
  a.src = 'audio/' + BGM_TRACKS[idx].file;
  bgmShowToast(BGM_TRACKS[idx]);
  bgmPlayPromise(a.play());
}
function bgmNext() {
  bgm.pos++;
  if (bgm.pos >= bgm.order.length) {
    bgm.order = nextShuffleOrder(BGM_TRACKS.length, Math.random, bgm.current);
    bgm.pos = 0;
  }
  bgmPlayTrack(bgm.order[bgm.pos]);
}
/* 最初のユーザー操作から呼ばれる。以後の曲送りは 'ended' が駆動する */
function bgmStart() {
  if (bgm.started || !bgmOn) return;
  bgm.started = true;
  bgm.order = nextShuffleOrder(BGM_TRACKS.length, Math.random, -1);
  bgm.pos = 0;
  bgmPlayTrack(bgm.order[0]);
}
function bgmApplySettings() {
  var a = bgmEnsure();
  a.volume = bgmVolume;
  if (!bgmOn) {
    a.pause();
  } else if (!bgm.started) {
    bgmStart(); // 設定シートの操作自体がユーザー操作なので開始してよい
  } else if (a.paused && !document.hidden) {
    bgmPlayPromise(a.play()); // オフ→オンに戻したら再開する
  }
}
/* タブが隠れたら一時停止し、戻ったら再開する (設定でオフのときは再開しない) */
document.addEventListener('visibilitychange', function () {
  var a = bgm.audio;
  if (!a || !bgm.started) return;
  if (document.hidden) {
    if (!a.paused) { a.pause(); bgm.hiddenPaused = true; }
  } else if (bgm.hiddenPaused) {
    bgm.hiddenPaused = false;
    if (bgmOn) bgmPlayPromise(a.play());
  }
});

/* ---- SE (全て Web Audio 合成。音源ファイルなし) ----
 * 掴む = 紙の「サッ」/ 置く = 木の「トッ」/ 合体 = クリック + 2 音チャイム /
 * クリア = オルゴール風アルペジオ / 蓋 = 紙の擦れ + 小さなノック。
 * AudioContext は最初のユーザー操作でだけ生成する (自動再生ポリシー)。 */
var seCtx = null, seMaster = null, seNoiseBuf = null;
function ensureSeContext() {
  if (seCtx) {
    if (seCtx.state === 'suspended') seCtx.resume();
    return;
  }
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    seCtx = new AC();
    seMaster = seCtx.createGain();
    seMaster.gain.value = 0.22; // マスターは控えめ (0.15〜0.3 の範囲)
    seMaster.connect(seCtx.destination);
  } catch (e) { seCtx = null; }
}
function seNoiseBuffer() {
  if (seNoiseBuf) return seNoiseBuf;
  var len = Math.max(1, Math.floor(seCtx.sampleRate * 0.5));
  var buf = seCtx.createBuffer(1, len, seCtx.sampleRate);
  var d = buf.getChannelData(0);
  for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  seNoiseBuf = buf;
  return buf;
}
/* ノイズを帯域フィルタ越しに鳴らす。freq は [開始, 終了] のスイープ */
function seNoise(dur, type, freq, peak, delay) {
  if (!seCtx) return;
  var t0 = seCtx.currentTime + (delay || 0);
  var src = seCtx.createBufferSource();
  src.buffer = seNoiseBuffer();
  src.loop = true;
  var f = seCtx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq[0], t0);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, freq[1]), t0 + dur);
  f.Q.value = 1.1;
  var g = seCtx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(seMaster);
  src.start(t0); src.stop(t0 + dur + 0.05);
}
/* 単音。freq は [開始, 終了] (ドロップ表現) か単一数値 */
function seTone(freq, dur, peak, type, delay) {
  if (!seCtx) return;
  var t0 = seCtx.currentTime + (delay || 0);
  var o = seCtx.createOscillator();
  o.type = type || 'sine';
  var f0 = Array.isArray(freq) ? freq[0] : freq;
  var f1 = Array.isArray(freq) ? freq[1] : freq;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur * 0.8);
  var g = seCtx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(seMaster);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
function seReady() { return seOn && !!seCtx; }
function seGrab() { // 紙の「サッ」: ノイズのバンドパスを 1200→2400Hz へ上げる
  if (!seReady()) return;
  seNoise(0.1, 'bandpass', [1200, 2400], 0.5);
}
function seDrop() { // 木の「トッ」: サインのピッチドロップ + ローパスの木の当たり
  if (!seReady()) return;
  seTone([180, 70], 0.12, 0.6);
  seNoise(0.05, 'lowpass', [900, 500], 0.22);
}
function seMerge() { // クリック + G5→C6 の 2 音チャイム
  if (!seReady()) return;
  seNoise(0.03, 'highpass', [3000, 3000], 0.3);
  seTone(784, 0.22, 0.22);
  seTone(1046.5, 0.3, 0.22, 'sine', 0.07);
}
function seClear() { // オルゴール風アルペジオ C5-E5-G5-C6 (倍音を薄く重ねる)
  if (!seReady()) return;
  [523.25, 659.25, 783.99, 1046.5].forEach(function (fq, i) {
    seTone(fq, 0.55, 0.26, 'sine', i * 0.13);
    seTone(fq * 2, 0.3, 0.06, 'sine', i * 0.13);
  });
}
function seLid() { // 紙の擦れ (バンドパス 400→1400Hz, 0.25s) + 小さなノック
  if (!seReady()) return;
  seNoise(0.25, 'bandpass', [400, 1400], 0.4);
  seTone([220, 90], 0.07, 0.28, 'sine', 0.22);
}
/* 最初のユーザー操作 (キャプチャ段階で受けるので、ステージ側の
 * pointerdown ハンドラより先に AudioContext の生成と BGM 開始が走る) */
function onFirstUserGesture() {
  ensureSeContext();
  if (bgmOn && !bgm.started) bgmStart();
}
document.addEventListener('pointerdown', onFirstUserGesture, true);
document.addEventListener('keydown', onFirstUserGesture, true);

function progressFor(date, pieces) {
  if (!store.progress[date]) store.progress[date] = {};
  if (!store.progress[date][pieces]) {
    store.progress[date][pieces] = { clusters: [], elapsedSec: 0, moves: 0, previewViewed: false, previewCount: 0, cleared: false, started: false };
  }
  return store.progress[date][pieces];
}
function findRecord(date, pieces) {
  return store.records.find(function (r) { return r.date === date && r.pieces === pieces; });
}
function computeStreak() {
  var days = new Set(store.records.map(function (r) { return r.date; }));
  var today = jstTodayString();
  var cur = days.has(today) ? today : addDays(today, -1);
  var streak = 0;
  while (days.has(cur)) { streak++; cur = addDays(cur, -1); }
  return streak;
}

/* ---------- 画面状態 ---------- */
var todayStr = jstTodayString();
var playDate = todayStr; // 日付移動は廃止: 常に今日のお題だけ
var difficulty = DIFFICULTIES.indexOf(store.lastDifficulty) >= 0 ? store.lastDifficulty : 36;
var state = null; // ゲーム開始時に構築

function newGameState(pool) {
  var prog = progressFor(playDate, difficulty);
  var gameStarted = progressIsStarted(prog);
  return {
    pool: pool,
    imageId: pickImageId(playDate, pool),
    author: null, authorUrl: null,
    n: Math.round(Math.sqrt(difficulty)),
    edges: generateEdges(playDate, difficulty),
    surface: 'desk',
    phase: gameStarted ? 'play' : 'box', // 'box' = スタート画面 (未開封)
    gameStarted: gameStarted,
    opening: false,
    clusters: gameStarted ? prog.clusters.map(function (c) { return { pieces: c.pieces.slice(), surface: c.surface, gx: c.gx, gy: c.gy }; }) : [],
    elapsedBase: prog.elapsedSec || 0,
    moves: prog.moves || 0,
    previewViewed: !!prog.previewViewed,
    previewCount: prog.previewCount || 0,
    mergeFlash: null,                 // { ids:Set, start:ms } 合体フィードバック
    cleared: !!prog.cleared,
    started: false, paused: false, timerStart: 0,
    views: { desk: null, mat: null }, // {scale, tx, ty} scaleFit も保持
    bitmaps: new Map(),               // pieceId -> {canvas, path, cellPx, marginPx}
    srcCanvas: null, boardPx: 0,
    resumed: prog.clusters.length > 0
  };
}
function persistProgress() {
  var prog = progressFor(playDate, difficulty);
  prog.clusters = state.clusters.map(function (c) { return { pieces: c.pieces.slice(), surface: c.surface, gx: c.gx, gy: c.gy }; });
  prog.elapsedSec = currentElapsed();
  prog.moves = state.moves;
  prog.previewViewed = state.previewViewed;
  prog.previewCount = state.previewCount;
  prog.cleared = state.cleared;
  prog.started = state.gameStarted;
  saveStore();
}
function currentElapsed() {
  var run = (state.started && !state.paused && !state.cleared) ? (Date.now() - state.timerStart) / 1000 : 0;
  return Math.floor(state.elapsedBase + run);
}

/* ---------- 画像読み込み / フォールバック ---------- */
function makeFallbackCanvas(dateStr) {
  var size = 1024, cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  var ctx = cv.getContext('2d');
  var rng = rngFromString('fallback:' + dateStr);
  var hue = Math.floor(rng() * 360);
  ctx.fillStyle = 'hsl(' + hue + ',45%,72%)';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'hsl(' + ((hue + 40) % 360) + ',50%,60%)';
  ctx.fillRect(0, size * 0.55, size, size * 0.45);
  for (var i = 0; i < 26; i++) {
    ctx.beginPath();
    ctx.fillStyle = 'hsl(' + Math.floor(rng() * 360) + ',55%,' + (35 + rng() * 40) + '%)';
    ctx.globalAlpha = 0.5 + rng() * 0.5;
    ctx.arc(rng() * size, rng() * size, 20 + rng() * 130, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'hsl(' + ((hue + 180) % 360) + ',60%,30%)';
  for (var j = 0; j < 8; j++) ctx.fillRect(rng() * size, rng() * size, 60 + rng() * 160, 26 + rng() * 60);
  return cv;
}
function loadSourceImage() {
  return new Promise(function (resolve) {
    var size = imageSizeFor(difficulty);
    var url = 'https://picsum.photos/id/' + state.imageId + '/' + size + '/' + size;
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () { resolve({ img: img, fallback: false }); };
    img.onerror = function () { resolve({ img: makeFallbackCanvas(playDate), fallback: true }); };
    img.src = url;
  });
}
function fetchCredit() {
  fetch('https://picsum.photos/id/' + state.imageId + '/info')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (info) {
      if (!info) return;
      state.author = info.author; state.authorUrl = info.url;
      $('themeCredit').innerHTML = 'Photo by <a href="' + info.url + '" target="_blank" rel="noopener">' + info.author + '</a>';
    })
    .catch(function () { /* クレジットなしでも遊べる */ });
}

/* ---------- ピース画像の事前描画 (オフスクリーン) ---------- */
/* ピース側面の色: そのピースの写真 (ホーム範囲) の平均色を暗くしたもの。
 * 厚紙の側面らしく上面より一段暗くする。ピクセルを読み取れない環境
 * (CORS で汚染されたキャンバス等) では濃い茶色に落とす。
 * bitmap 生成時に一度だけ呼ばれる。 */
function pieceSideColor(id, cellPx) {
  var fallback = 'rgb(58,45,33)';
  try {
    var n = state.n, home = pieceHome(id, n);
    var srcCtx = state.srcCanvas.getContext('2d');
    var sw = Math.max(1, Math.round(cellPx));
    var data = srcCtx.getImageData(Math.round(home.col * cellPx), Math.round(home.row * cellPx), sw, sw).data;
    var step = Math.max(1, Math.floor(sw / 24)) * 4; // 間引いて平均を取る
    var r = 0, g = 0, b = 0, cnt = 0;
    for (var i = 0; i + 2 < data.length; i += step) { r += data[i]; g += data[i + 1]; b += data[i + 2]; cnt++; }
    if (!cnt) return fallback;
    var f = 0.41; // 側面は上面より暗く (プレビューで決めた確定値)
    return 'rgb(' + Math.round(r / cnt * f) + ',' + Math.round(g / cnt * f) + ',' + Math.round(b / cnt * f) + ')';
  } catch (e) { return fallback; }
}
/* ベベルの濃さ: ハイライト/影の基準 alpha に掛ける強さ係数
 * (プレビューで決めた確定値 0.7倍 → 白 0.18*0.7 ≒ 0.126 / 黒 0.22*0.7 ≒ 0.154)。 */
var PIECE_BEVEL_STRENGTH = 0.7;
/* 縁のベベル: 光は左上から (机の接影の向きとも揃える)。輪郭でクリップした
 * 内側に、輪郭をずらして太く描くことで反対側の縁にだけ帯を残す古典的な方法で、
 * 上・左の縁に薄いハイライト、下・右の縁に薄い影を入れる。幅は pieceRelief の bevel。 */
function strokePieceBevel(ctx, path, bevel) {
  if (!(bevel > 0)) return;
  ctx.save();
  ctx.clip(path);
  ctx.lineWidth = bevel * 2;
  // ハイライト: 輪郭を下・右へずらして描く → 上・左の縁の内側に帯が残る
  ctx.save();
  ctx.translate(bevel * 0.75, bevel * 0.75);
  ctx.strokeStyle = 'rgba(255,255,255,' + (0.18 * PIECE_BEVEL_STRENGTH).toFixed(3) + ')';
  ctx.stroke(path);
  ctx.restore();
  // 影: 輪郭を上・左へずらして描く → 下・右の縁の内側に帯が残る
  ctx.save();
  ctx.translate(-bevel * 0.75, -bevel * 0.75);
  ctx.strokeStyle = 'rgba(0,0,0,' + (0.22 * PIECE_BEVEL_STRENGTH).toFixed(3) + ')';
  ctx.stroke(path);
  ctx.restore();
  ctx.restore();
}
function pieceBitmap(id) {
  if (state.bitmaps.has(id)) return state.bitmaps.get(id);
  var n = state.n, home = pieceHome(id, n);
  var cellPx = state.boardPx / n;
  var marginPx = Math.ceil(cellPx * 0.34);
  var sizePx = Math.ceil(cellPx + marginPx * 2);
  var cv = document.createElement('canvas');
  cv.width = sizePx; cv.height = sizePx;
  var ctx = cv.getContext('2d');
  var path = buildPiecePath(id, cellPx, marginPx);
  var relief = pieceRelief(cellPx);
  // 側面: 輪郭シルエットを下へ少しずらして写真面より先に塗り、「わずかな厚み」を出す。
  // 1px 刻みで重ね塗りして、斜めの縁でも段差や透けが出ないようにする。
  // 押し出しは bitmap のマージン内に収まる (ノブの張り出し + 厚み < マージン)。
  if (relief.thickness > 0) {
    ctx.fillStyle = pieceSideColor(id, cellPx);
    for (var yy = relief.thickness; yy > 0; yy -= 1) {
      ctx.save();
      ctx.translate(0, yy);
      ctx.fill(path);
      ctx.restore();
    }
  }
  // 写真面
  ctx.save();
  ctx.clip(path);
  ctx.drawImage(state.srcCanvas, marginPx - home.col * cellPx, marginPx - home.row * cellPx, state.boardPx, state.boardPx);
  ctx.restore();
  // 縁のベベル (上・左に光、下・右に影)。既存の輪郭線はこの上に引いて締める
  strokePieceBevel(ctx, path, relief.bevel);
  ctx.strokeStyle = 'rgba(30,30,30,0.35)';
  ctx.lineWidth = Math.max(1, cellPx * 0.02);
  ctx.stroke(path);
  var bmp = { canvas: cv, path: path, cellPx: cellPx, marginPx: marginPx };
  state.bitmaps.set(id, bmp);
  return bmp;
}
/* ピース輪郭を Path2D で作る (bitmap ピクセル座標, 原点はマージン分ずらす) */
function buildPiecePath(id, cellPx, marginPx) {
  var n = state.n, home = pieceHome(id, n);
  var path = new Path2D();
  var sides = ['top', 'right', 'bottom', 'left'];
  sides.forEach(function (side, si) {
    var pts = outlineSidePoints(id, side);
    pts.forEach(function (p, i) {
      var x = marginPx + p.x * cellPx, y = marginPx + p.y * cellPx;
      if (si === 0 && i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    });
  });
  path.closePath();
  return path;
}
/* ベジェ込みの輪郭点列 (1辺あたり細かくサンプル) */
function outlineSidePoints(id, side) {
  var n = state.n, home = pieceHome(id, n);
  return sideSamples(state.edges, home.col, home.row, side, 10);
}

/* ---------- 描画 ---------- */
var stage = $('stage'), sctx = stage.getContext('2d');
var scratchCtx = document.createElement('canvas').getContext('2d');
var stageW = 0, stageH = 0, dpr = 1;
function resizeStage() {
  var wrap = $('stageWrap');
  dpr = Math.min(2, window.devicePixelRatio || 1);
  stageW = wrap.clientWidth; stageH = wrap.clientHeight;
  if (!stageW || !stageH) return; // 非表示中は実サイズが取れないので何もしない
  stage.width = Math.round(stageW * dpr); stage.height = Math.round(stageH * dpr);
  invalidateDeskBackdrop(); // 背景レイヤーはステージ実寸で描くので作り直す
  if (state && !state.views.desk) fitViews();
  draw();
}
function fitView(surface) {
  var n = state.n;
  var worldW, worldH, ox, oy;
  if (surface === 'mat') {
    worldW = (n + 2) * CELL; worldH = (n + 2) * CELL;
    ox = -CELL; oy = -CELL;
  } else {
    // 机ワールド = 散らばり領域そのもの (旧来より縦横に広い)。
    // fit (表示100%) とズーム下限はこの領域に追随する。
    var r = scatterRect(n * n);
    worldW = r.w * CELL; worldH = r.h * CELL;
    ox = r.x0 * CELL; oy = r.y0 * CELL;
  }
  var fit = Math.min(stageW / worldW, stageH / worldH);
  return { scale: fit, fit: fit, tx: (stageW - worldW * fit) / 2 - ox * fit, ty: (stageH - worldH * fit) / 2 - oy * fit };
}
function fitViews() {
  if (!stageW || !stageH) return; // プレイ画面が非表示の間はフィット計算しない (表示時に resizeStage が行う)
  state.views.desk = fitView('desk');
  state.views.mat = fitView('mat');
  invalidateDeskBackdrop(); // 机カメラが変わるので背景レイヤーを作り直す
}
function view() { return state.views[state.surface]; }
function worldToScreen(wx, wy) { var v = view(); return { x: wx * v.scale + v.tx, y: wy * v.scale + v.ty }; }
function screenToWorld(sx, sy) { var v = view(); return { x: (sx - v.tx) / v.scale, y: (sy - v.ty) / v.scale }; }

/* ---------- 机の木目テクスチャ ----------
 * 木目タイルを一度だけオフスクリーンに描き、ワールド座標に固定して敷く
 * (パン/ズームに追随するので「机の上を動いている」感触になる)。
 * 敷き方は CanvasPattern ではなく drawImage の明示タイル敷き: 共有パターン
 * オブジェクトの setTransform はブラウザ差で実効スケールがずれることがあり
 * (マットでピンチを繰り返したあと机の継ぎ目が太く崩れるバグの原因)、
 * テクスチャ側に可変状態を持たせないことで机とマットの状態干渉も断つ。
 * タイルのキャンバス自体はテーマごとにキャッシュし、読み取り専用で共有する。
 *
 * タイルの中身は「横長の板の並び」として手続き描画する (ピース厚みプレビュー
 * の机の絵柄に合わせた描法): 板ごとに基準トーンを穏やかに変え、板の中は
 * 上がわずかに明るく下へ柔らかく落ちる縦グラデーション、木目は少なく薄く、
 * 板の境目は硬い線でなく柔らかい影の帯で表す。板の高さの合計はタイル寸法
 * 512 に一致させ、上下の継ぎ目でも板のリズムが切れないようにする。 */
var woodTiles = {}; // テーマごとに生成してキャッシュ (模様の配置は全テーマ共通シード)
/* パレットの hex 色を混ぜる/明暗を付けるための小さなヘルパー */
function woodHexRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function woodMixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function woodShadeStr(rgb, f, alpha) {
  var r = Math.max(0, Math.min(255, Math.round(rgb[0] * f)));
  var g = Math.max(0, Math.min(255, Math.round(rgb[1] * f)));
  var b = Math.max(0, Math.min(255, Math.round(rgb[2] * f)));
  return alpha == null ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
/* 3ストップのグラデーション (従来タイルの色づけ) を位置 t (0..1) でサンプルする */
function woodSampleStops(stopsRgb, t) {
  return t < 0.5 ? woodMixRgb(stopsRgb[0], stopsRgb[1], t * 2) : woodMixRgb(stopsRgb[1], stopsRgb[2], (t - 0.5) * 2);
}
function getWoodTile() {
  var key = uiTheme;
  if (woodTiles[key]) return woodTiles[key];
  var pal = THEMES[key].wood;
  var cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  var c = cv.getContext('2d');
  var rng = rngFromString('woodplanks-v1');
  var stopsRgb = pal.stops.map(woodHexRgb);
  var gr = pal.grain;
  var rows = [128, 104, 152, 128]; // 板の高さ (合計 512 = タイル寸法)
  var seamYs = [];
  var y = 0;
  for (var ri = 0; ri < rows.length; ri++) {
    var ph = rows[ri];
    seamYs.push(y);
    // 板ごとの基準トーン: 全体の色グラデーションを板の中心でサンプルし、
    // シード付きで穏やかにばらつかせる (±5%)
    var base = woodSampleStops(stopsRgb, (y + ph / 2) / 512);
    var tone = 0.95 + rng() * 0.10;
    // 板内の陰影: 上がわずかに明るく、下へ向けて柔らかく落ちる
    var grad = c.createLinearGradient(0, y, 0, y + ph);
    grad.addColorStop(0, woodShadeStr(base, tone * 1.07));
    grad.addColorStop(0.55, woodShadeStr(base, tone));
    grad.addColorStop(1, woodShadeStr(base, tone * 0.90));
    c.fillStyle = grad;
    c.fillRect(0, y, 512, ph);
    c.save();
    c.beginPath(); c.rect(0, y, 512, ph); c.clip();
    // 木目: 横に流れる柔らかい波線 (少なく・薄く)。周期は 512 の約数にして
    // 横方向のタイル継ぎ目でも線がつながるようにする
    for (var i = 0; i < 7; i++) {
      var gy = y + rng() * ph, amp = 0.8 + rng() * 2.4;
      var per = 512 / (2 + Math.floor(rng() * 4)), phase = rng() * 6.28;
      c.beginPath();
      for (var x = 0; x <= 512; x += 8) {
        var yy = gy + Math.sin(x / per * 6.28 + phase) * amp;
        if (x === 0) c.moveTo(x, yy); else c.lineTo(x, yy);
      }
      c.strokeStyle = 'rgba(' + (gr[0] + (rng() * (gr[1] - gr[0])) | 0) + ',' + (gr[2] + (rng() * (gr[3] - gr[2])) | 0) + ',' + (gr[4] + (rng() * (gr[5] - gr[4])) | 0) + ',' + (0.03 + rng() * 0.07).toFixed(3) + ')';
      c.lineWidth = 0.8 + rng() * 2.4;
      c.stroke();
    }
    // 幅の広い柔らかい色の流れ (絵画的なムラ) を板ごとに1本、薄く入れる
    var sy = y + rng() * ph, sh = 10 + rng() * 22, sf = rng() < 0.6 ? 0.82 : 1.14, sa = 0.05 + rng() * 0.05;
    var sg = c.createLinearGradient(0, sy - sh / 2, 0, sy + sh / 2);
    sg.addColorStop(0, woodShadeStr(base, sf, 0));
    sg.addColorStop(0.5, woodShadeStr(base, sf, sa));
    sg.addColorStop(1, woodShadeStr(base, sf, 0));
    c.fillStyle = sg;
    c.fillRect(0, y, 512, ph);
    // 板の縦継ぎ (突き付け): 長い板のつなぎ目を板ごとに1か所、柔らかい影で
    var jx = 48 + rng() * 416;
    var jg = c.createLinearGradient(jx - 3, 0, jx + 3, 0);
    jg.addColorStop(0, woodShadeStr(base, 0.72, 0));
    jg.addColorStop(0.5, woodShadeStr(base, 0.72, 0.28));
    jg.addColorStop(1, woodShadeStr(base, 0.72, 0));
    c.fillStyle = jg;
    c.fillRect(jx - 3, y, 6, ph);
    c.restore();
    y += ph;
  }
  // 板と板の継ぎ目: 硬い線ではなく、境目を中心にした柔らかい影の帯 + 下側に細い光。
  // y=512 は y=0 と同じ継ぎ目の続き (タイルの上下がつながるため両端に描く)
  seamYs.push(512);
  seamYs.forEach(function (sy2) {
    var seam = c.createLinearGradient(0, sy2 - 4, 0, sy2 + 4);
    seam.addColorStop(0, woodShadeStr(stopsRgb[1], 1, 0));
    seam.addColorStop(0.5, pal.seamDark);
    seam.addColorStop(1, woodShadeStr(stopsRgb[1], 1, 0));
    c.fillStyle = seam;
    c.fillRect(0, sy2 - 4, 512, 8);
    c.fillStyle = pal.seamLight; c.fillRect(0, sy2 + 1, 512, 1);
  });
  // 節 (ふし): 控えめに2つ
  for (var k = 0; k < 2; k++) {
    var kx = 60 + rng() * 390, ky = 60 + rng() * 390;
    for (var r = 9; r > 1; r -= 2) {
      c.beginPath();
      c.ellipse(kx, ky, r * 1.5, r, 0.3, 0, 6.29);
      c.strokeStyle = 'rgba(' + pal.knot + ',' + (0.08 + (9 - r) * 0.016).toFixed(3) + ')';
      c.lineWidth = 1.4;
      c.stroke();
    }
  }
  woodTiles[key] = cv;
  return cv;
}
/* 机の背景を ctx に描く (w, h は CSS px の描画領域)。メイン画面とマット背景の
 * 「ぼんやりした机」レイヤーの両方から使う。タイルはワールド固定で敷く:
 * 1タイル = 512ワールド単位、画面上は 512 * v.scale px になり、開始位置は
 * woodTileOrigin でワールド原点に位相を合わせる。 */
function drawDeskBackgroundOn(ctx, v, w, h) {
  var pal = THEMES[uiTheme].wood;
  ctx.fillStyle = pal.fallback;
  ctx.fillRect(0, 0, w, h);
  var tile = null;
  try { tile = getWoodTile(); } catch (e) { tile = null; }
  if (tile) {
    var ts = 512 * v.scale; // タイルの画面サイズ (CSS px)
    if (ts >= 2) {
      var ox = woodTileOrigin(v.tx, ts), oy = woodTileOrigin(v.ty, ts);
      // +1 は隣接タイル間のサブピクセルの隙間を埋めるための重なり (下地色で保険済み)
      for (var x = ox; x < w; x += ts) {
        for (var y = oy; y < h; y += ts) {
          ctx.drawImage(tile, x, y, ts + 1, ts + 1);
        }
      }
    }
  }
  // 机全体にゆるい陰影 (ビネット) をつけて天板らしくする
  var vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, pal.vigLight);
  vg.addColorStop(1, pal.vigDark);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}
/* 机背景 (木目タイル敷き + ビネット) のキャッシュ。
 * 背景はカメラが静止している間は1ピクセルも変わらないのに、ピースの
 * ドラッグ中は pointermove のたびに全体を再生成していた。Firefox Android
 * ではその同期再描画の負荷/競合で「画面内容が縦に潰れたノイズの横帯」が
 * 背景に残る不具合が出たため、ステージ実寸 (CSS px × dpr) のオフスクリーン
 * に描いてキャッシュし、キーが一致する間は drawImage 1回で転写だけにする。
 * キー (deskBgKey) にテーマ・ステージ寸法・dpr・カメラを含むので、
 * テーマ切替/リサイズ/カメラ移動では自動的に作り直され、明示的な
 * 無効化は要らない。木目の位相 (ワールド固定) は drawDeskBackgroundOn が
 * カメラから決めるため、キャッシュしても見た目は変わらない。 */
var deskBgCache = null; // { key, canvas }
function drawDeskBackground(v) {
  if (!stageW || !stageH) { drawDeskBackgroundOn(sctx, v, stageW, stageH); return; }
  var key = deskBgKey(uiTheme, stageW, stageH, dpr, v);
  if (deskBgCache && deskBgCache.key === key) {
    sctx.drawImage(deskBgCache.canvas, 0, 0, stageW, stageH);
    return;
  }
  var cv = deskBgCache ? deskBgCache.canvas : document.createElement('canvas');
  var bw = Math.max(1, Math.round(stageW * dpr)), bh = Math.max(1, Math.round(stageH * dpr));
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  var c2 = cv.getContext('2d');
  c2.setTransform(dpr, 0, 0, dpr, 0, 0); // 以後の座標は CSS px (drawDeskBackgroundOn の前提と同じ)
  drawDeskBackgroundOn(c2, v, stageW, stageH);
  deskBgCache = { key: key, canvas: cv };
  sctx.drawImage(cv, 0, 0, stageW, stageH);
}

/* 描画の rAF 集約: 対話ハンドラ (pointermove のドラッグ/パン/ピンチ、
 * ホイール等) からは draw() を直接呼ばず、こちら経由で「1フレームに
 * 最大1回」だけ実描画する。イベントがフレームより速く来ても描画は
 * 間引かれ、状態そのものはハンドラ側で即時更新されるので操作感は変わらない。
 * 状態確定が同期描画に依存する箇所 (離した瞬間の確定描画、リサイズ直後、
 * 合体フラッシュの自前 rAF ループ等) は従来どおり draw() を直接呼ぶ。 */
var drawQueued = false;
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(function () { drawQueued = false; draw(); });
}

function draw() {
  if (!state || !state.srcCanvas || !state.views[state.surface]) return;
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  var isMat = state.surface === 'mat';
  var v = view(), n = state.n;
  if (isMat) {
    drawMatBackdrop(); // 盤の外側: 机が薄いベール越しにぼんやり見える
  } else {
    drawDeskBackground(v);
    // 机でカメラが動いたらミニマップを出す (初回は現在値で初期化だけする)
    var camKey = v.scale.toFixed(4) + '|' + v.tx.toFixed(1) + '|' + v.ty.toFixed(1);
    if (lastCamKey === '') lastCamKey = camKey;
    else if (camKey !== lastCamKey) { lastCamKey = camKey; pokeMinimap(); }
  }
  if (isMat) {
    var tl = worldToScreen(0, 0), br = worldToScreen(n * CELL, n * CELL);
    sctx.fillStyle = THEMES[uiTheme].mat; // 盤そのものはベールを被せずクッキリ
    sctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    sctx.fillStyle = 'rgba(0,0,0,0.12)';
    sctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    sctx.strokeStyle = 'rgba(255,255,255,0.75)';
    sctx.lineWidth = 2;
    sctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    sctx.strokeStyle = 'rgba(255,255,255,0.16)';
    sctx.lineWidth = 1;
    sctx.beginPath();
    for (var g = 1; g < n; g++) {
      var gp = worldToScreen(g * CELL, g * CELL);
      sctx.moveTo(tl.x, gp.y); sctx.lineTo(br.x, gp.y);
      sctx.moveTo(gp.x, tl.y); sctx.lineTo(gp.x, br.y);
    }
    sctx.stroke();
  }
  // 表示範囲のカリング: 画面内にある塊だけ描く
  var wTl = screenToWorld(0, 0), wBr = screenToWorld(stageW, stageH);
  var ordered = state.clusters.filter(function (c) { return c.surface === state.surface; });
  if (drag && drag.cluster) {
    // ドラッグ中の塊 (範囲選択時はグループ全塊) を最前面に描く
    var tops = drag.group ? drag.group.map(function (g) { return g.cluster; }) : [drag.cluster];
    ordered = ordered.filter(function (c) { return tops.indexOf(c) < 0; })
      .concat(ordered.filter(function (c) { return tops.indexOf(c) >= 0; }));
  }
  ordered.forEach(function (cl) { drawCluster(cl, wTl, wBr); });
  // 合体フィードバック: 合体した塊の輪郭が一瞬光る
  if (state.mergeFlash) {
    var alpha = Math.max(0, 1 - (Date.now() - state.mergeFlash.start) / 550);
    if (alpha > 0) {
      var flash = state.mergeFlash;
      eachVisiblePiece(function (id, wx, wy) {
        if (!flash.ids.has(id)) return;
        if (wx + CELL * 1.4 < wTl.x || wx - CELL * 0.4 > wBr.x || wy + CELL * 1.4 < wTl.y || wy - CELL * 0.4 > wBr.y) return;
        strokePiece(id, wx, wy, 'rgba(255,190,0,' + alpha.toFixed(3) + ')', 3.5, 'rgba(255,200,40,' + (alpha * 0.25).toFixed(3) + ')');
      });
    }
  }
  // 範囲選択: 選択中の塊の輪郭を真鍮色でハイライトする
  if (selection.size) {
    var brass = THEMES[uiTheme].brass;
    selection.forEach(function (cl) {
      if (cl.surface !== state.surface) return;
      var anchor = pieceHome(clusterAnchorId(cl), n);
      cl.pieces.forEach(function (id) {
        var home = pieceHome(id, n);
        var wx = (cl.gx + (home.col - anchor.col)) * CELL, wy = (cl.gy + (home.row - anchor.row)) * CELL;
        if (wx + CELL * 1.4 < wTl.x || wx - CELL * 0.4 > wBr.x || wy + CELL * 1.4 < wTl.y || wy - CELL * 0.4 > wBr.y) return;
        strokePiece(id, wx, wy, brass, 3, hexToRgba(brass, 0.16));
      });
    });
  }
  // 範囲選択の矩形 (画面座標でそのまま描く)
  if (selRect) {
    var rx = Math.min(selRect.x0, selRect.x1), ry = Math.min(selRect.y0, selRect.y1);
    var rw = Math.abs(selRect.x1 - selRect.x0), rh = Math.abs(selRect.y1 - selRect.y0);
    var brass2 = THEMES[uiTheme].brass;
    sctx.fillStyle = hexToRgba(brass2, 0.14);
    sctx.fillRect(rx, ry, rw, rh);
    sctx.strokeStyle = brass2;
    sctx.lineWidth = 1.5;
    sctx.strokeRect(rx, ry, rw, rh);
  }
}
/* ---------- ミニマップ (机でカメラを動かしている間だけ表示) ----------
 * 散らばり領域全体の縮小図に、机上のピースを点で、現在のビューポートを
 * 枠で描く。画面外にピースが残っていることが分かるようにするのが目的で、
 * ミニマップ自体は操作対象にしない。表示の出し入れは draw() のカメラ変化
 * 検知 (pokeMinimap) が担い、移動が止まると少し置いてフェードアウトする。 */
var minimapHideTimer = null;
var lastCamKey = ''; // draw() がカメラ変化を検知するための前回値
function pokeMinimap() {
  if (!state || state.surface !== 'desk') return;
  var mm = $('minimap');
  if (!mm) return;
  mm.classList.add('on');
  drawMinimap();
  if (minimapHideTimer) clearTimeout(minimapHideTimer);
  minimapHideTimer = setTimeout(function () { mm.classList.remove('on'); }, 700);
}
function hideMinimap() {
  var mm = $('minimap');
  if (mm) mm.classList.remove('on');
  if (minimapHideTimer) { clearTimeout(minimapHideTimer); minimapHideTimer = null; }
}
function drawMinimap() {
  var mm = $('minimap');
  if (!mm || !state || !state.views.desk) return;
  var ctx = mm.getContext('2d');
  var u = mm.width / 132; // CSS 132×118 に対する backing 解像度の比
  ctx.setTransform(u, 0, 0, u, 0, 0);
  ctx.clearRect(0, 0, 132, 118);
  var n = state.n;
  var r = scatterRect(n * n);
  var lay = minimapLayout(r, 120, 106);
  ctx.save();
  ctx.translate(6, 6);
  // 散らばり領域 (机全体)
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(lay.ox, lay.oy, lay.w, lay.h);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1;
  ctx.strokeRect(lay.ox, lay.oy, lay.w, lay.h);
  // 机上のピースを点で (領域の外に出た分はクリップ)。選択中の塊は真鍮色
  ctx.save();
  ctx.beginPath(); ctx.rect(lay.ox, lay.oy, lay.w, lay.h); ctx.clip();
  state.clusters.forEach(function (cl) {
    if (cl.surface !== 'desk') return;
    ctx.fillStyle = selection.has(cl) ? THEMES[uiTheme].brass : 'rgba(255,255,255,0.92)';
    var anchor = pieceHome(clusterAnchorId(cl), n);
    cl.pieces.forEach(function (id) {
      var home = pieceHome(id, n);
      var gx = cl.gx + (home.col - anchor.col), gy = cl.gy + (home.row - anchor.row);
      var px = lay.ox + (gx - r.x0) * lay.scale, py = lay.oy + (gy - r.y0) * lay.scale;
      ctx.fillRect(px - 1, py - 1, 2, 2);
    });
  });
  ctx.restore();
  // 現在のビューポート範囲
  var tl = screenToWorld(0, 0), br = screenToWorld(stageW, stageH);
  var vx = lay.ox + (tl.x / CELL - r.x0) * lay.scale, vy = lay.oy + (tl.y / CELL - r.y0) * lay.scale;
  var vw = (br.x - tl.x) / CELL * lay.scale, vh = (br.y - tl.y) / CELL * lay.scale;
  ctx.strokeStyle = THEMES[uiTheme].brass;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(vx, vy, vw, vh);
  ctx.restore();
}

/* '#c9a227' + alpha → 'rgba(...)' (Canvas の選択ハイライト用) */
function hexToRgba(hex, alpha) {
  var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
/* 現在の画面にある全ピースについて (id, ワールドx, ワールドy) で fn を呼ぶ */
function eachVisiblePiece(fn) {
  var n = state.n;
  state.clusters.forEach(function (cl) {
    if (cl.surface !== state.surface) return;
    var anchor = pieceHome(clusterAnchorId(cl), n);
    cl.pieces.forEach(function (id) {
      var home = pieceHome(id, n);
      fn(id, (cl.gx + (home.col - anchor.col)) * CELL, (cl.gy + (home.row - anchor.row)) * CELL);
    });
  });
}
/* ピース輪郭の輪郭線/塗りを重ね描きする (ハイライト・フラッシュ用) */
function strokePiece(id, wx, wy, style, widthPx, fillStyle) {
  var bmp = pieceBitmap(id), v = view();
  var ratio = (CELL * v.scale) / bmp.cellPx;
  var dx = wx * v.scale + v.tx - bmp.marginPx * ratio;
  var dy = wy * v.scale + v.ty - bmp.marginPx * ratio;
  sctx.save();
  sctx.translate(dx, dy);
  sctx.scale(ratio, ratio);
  if (fillStyle) { sctx.fillStyle = fillStyle; sctx.fill(bmp.path); }
  if (style) { sctx.strokeStyle = style; sctx.lineWidth = widthPx / ratio; sctx.stroke(bmp.path); }
  sctx.restore();
}
function startMergeFlash(pieces) {
  state.mergeFlash = { ids: new Set(pieces), start: Date.now() };
  (function loop() {
    if (!state || !state.mergeFlash) return;
    if (Date.now() - state.mergeFlash.start >= 560) { state.mergeFlash = null; draw(); return; }
    draw();
    requestAnimationFrame(loop);
  })();
}
function clusterWorldBox(cl) {
  var n = state.n, anchor = pieceHome(clusterAnchorId(cl), n);
  var minC = 1e9, minR = 1e9, maxC = -1e9, maxR = -1e9;
  cl.pieces.forEach(function (id) {
    var h = pieceHome(id, n);
    minC = Math.min(minC, h.col); minR = Math.min(minR, h.row);
    maxC = Math.max(maxC, h.col); maxR = Math.max(maxR, h.row);
  });
  return {
    x0: (cl.gx + (minC - anchor.col) - 0.4) * CELL, y0: (cl.gy + (minR - anchor.row) - 0.4) * CELL,
    x1: (cl.gx + (maxC - anchor.col) + 1.4) * CELL, y1: (cl.gy + (maxR - anchor.row) + 1.4) * CELL
  };
}
function drawCluster(cl, wTl, wBr) { drawClusterOn(sctx, view(), cl, wTl, wBr); }
function drawClusterOn(ctx, v, cl, wTl, wBr) {
  var box = clusterWorldBox(cl);
  if (box.x1 < wTl.x || box.x0 > wBr.x || box.y1 < wTl.y || box.y0 > wBr.y) return;
  var n = state.n, anchor = pieceHome(clusterAnchorId(cl), n);
  cl.pieces.forEach(function (id) {
    var home = pieceHome(id, n);
    var wx = (cl.gx + (home.col - anchor.col)) * CELL, wy = (cl.gy + (home.row - anchor.row)) * CELL;
    if (wx + CELL * 1.4 < wTl.x || wx - CELL * 0.4 > wBr.x || wy + CELL * 1.4 < wTl.y || wy - CELL * 0.4 > wBr.y) return;
    var bmp = pieceBitmap(id);
    var ratio = (CELL * v.scale) / bmp.cellPx;
    var dx = wx * v.scale + v.tx - bmp.marginPx * ratio;
    var dy = wy * v.scale + v.ty - bmp.marginPx * ratio;
    var sz = bmp.canvas.width * ratio;
    ctx.drawImage(bmp.canvas, dx, dy, sz, sz);
  });
}

/* ---------- マット画面の背景: 机をぼんやり見せる ----------
 * マット盤の外側には、机 (木目 + 机上の塊) を薄いベール越しに見せる。
 * 机レイヤーはオフスクリーンに描いて使い回す: マット表示中は机側のカメラも
 * 塊も変わらないので、盤の状態が変わったとき (afterBoardChange 等) だけ
 * 再描画すればよい。ぼかし専用処理はせず、0.6倍の低解像度で描いて拡大する
 * ことで柔らかくし、さらに無色のベール (中立グレー・不透明度 0.65) を
 * 被せて机の見え方は 3.5割ほどに落とす。 */
var DESK_BACKDROP_SCALE = 0.6;
var deskBackdrop = null;
var deskBackdropDirty = true;
function invalidateDeskBackdrop() { deskBackdropDirty = true; }
function ensureDeskBackdrop() {
  var dv = state && state.views.desk;
  if (!dv || !stageW || !stageH) { deskBackdrop = null; return; }
  if (!deskBackdropDirty && deskBackdrop) return;
  var bw = Math.max(1, Math.round(stageW * dpr * DESK_BACKDROP_SCALE));
  var bh = Math.max(1, Math.round(stageH * dpr * DESK_BACKDROP_SCALE));
  if (!deskBackdrop) deskBackdrop = document.createElement('canvas');
  deskBackdrop.width = bw; deskBackdrop.height = bh;
  var bctx = deskBackdrop.getContext('2d');
  bctx.setTransform(bw / stageW, 0, 0, bh / stageH, 0, 0); // 以後の座標は CSS px でよい
  drawDeskBackgroundOn(bctx, dv, stageW, stageH);
  var wTl = { x: (0 - dv.tx) / dv.scale, y: (0 - dv.ty) / dv.scale };
  var wBr = { x: (stageW - dv.tx) / dv.scale, y: (stageH - dv.ty) / dv.scale };
  state.clusters.forEach(function (cl) {
    if (cl.surface === 'desk') drawClusterOn(bctx, dv, cl, wTl, wBr);
  });
  deskBackdropDirty = false;
}
/* マット画面の下地: ぼんやりした机 + ベール。机レイヤーが作れない初期状態では
 * 従来どおりマット色ベタ塗りに落とす。盤そのものは draw() 側でこの上に描く。 */
function drawMatBackdrop() {
  ensureDeskBackdrop();
  if (deskBackdrop) {
    sctx.drawImage(deskBackdrop, 0, 0, stageW, stageH);
    // ベールは無色 (中立グレー) にする: マット色で染めると盤外まで緑/赤に
    // 見えてしまうため、色味のない半透明で机の濃さだけを落とす (ユーザー指定)
    sctx.fillStyle = 'rgba(17,17,17,0.65)';
  } else {
    sctx.fillStyle = THEMES[uiTheme].mat;
  }
  sctx.fillRect(0, 0, stageW, stageH);
}
/* ヒットテスト: 画面座標 → 塊 (最前面優先) */
function hitCluster(sx, sy) {
  var w = screenToWorld(sx, sy);
  var list = state.clusters.filter(function (c) { return c.surface === state.surface; });
  for (var i = list.length - 1; i >= 0; i--) {
    var cl = list[i];
    var box = clusterWorldBox(cl);
    if (w.x < box.x0 || w.x > box.x1 || w.y < box.y0 || w.y > box.y1) continue;
    var n = state.n, anchor = pieceHome(clusterAnchorId(cl), n);
    for (var j = 0; j < cl.pieces.length; j++) {
      var id = cl.pieces[j], home = pieceHome(id, n);
      var wx = (cl.gx + (home.col - anchor.col)) * CELL, wy = (cl.gy + (home.row - anchor.row)) * CELL;
      var bmp = pieceBitmap(id);
      var bx = (w.x - wx) / CELL * bmp.cellPx + bmp.marginPx;
      var by = (w.y - wy) / CELL * bmp.cellPx + bmp.marginPx;
      if (bx < 0 || by < 0 || bx >= bmp.canvas.width || by >= bmp.canvas.height) continue;
      if (scratchCtx.isPointInPath(bmp.path, bx, by)) return { cluster: cl, pieceId: id };
    }
  }
  return null;
}

/* ---------- 操作 (ドラッグ / ピンチ / パン / ズーム) ---------- */
var drag = null;         // { cluster, grabDX, grabDY, startSurface, moved, group }
var pointers = new Map();
var pinch = null;        // { d0, scale0, cx, cy, tx0, ty0 }
var panStart = null;     // { sx, sy, tx, ty }
var zoneHot = false;

/* ---------- 範囲選択 (長押し方式・セッション限りで保存しない) ----------
 * 空き地を長押し (450ms・ほぼ静止) すると選択モードに入り、ドラッグで矩形を描く。
 * 長押し判定前に指が 10px 超動いたら通常パンに移行する (パンは少し遅れて始まる)。
 * ピース上の長押しは従来どおり即ドラッグ (判定は空き地だけ)。 */
var selection = new Set();  // 選択中の塊オブジェクトの集合
var pressPending = null;    // 長押し判定待ち { id, sx, sy, tx, ty, timer }
var selRect = null;         // 描画中の矩形 (画面座標) { id, x0, y0, x1, y1 }
var LONG_PRESS_MS = 450;
var PRESS_MOVE_PX = 10;

function clearSelection() {
  if (!selection.size) return;
  selection.clear();
  draw();
}
/* 合体などで塊オブジェクトが差し替わったあと、残っていない塊を選択から落とす */
function pruneSelection() {
  if (!selection.size || !state) return;
  selection.forEach(function (cl) {
    if (state.clusters.indexOf(cl) < 0) selection.delete(cl);
  });
}
/* 長押し判定と矩形を打ち切る (ピンチ開始時など)。矩形は確定せず捨てる */
function cancelPressAndRect() {
  if (pressPending) { clearTimeout(pressPending.timer); pressPending = null; }
  if (selRect) { selRect = null; $('selectChip').hidden = true; draw(); }
}
/* 矩形を離した: 交差した塊を選択する。ほぼ点のままならタップ扱いで選択解除のみ */
function finishSelRect() {
  var r = selRect;
  selRect = null;
  $('selectChip').hidden = true;
  if (Math.abs(r.x1 - r.x0) < 4 && Math.abs(r.y1 - r.y0) < 4) {
    selection.clear();
    draw();
    return;
  }
  var a = screenToWorld(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1));
  var b = screenToWorld(Math.max(r.x0, r.x1), Math.max(r.y0, r.y1));
  var rect = { x0: a.x / CELL, y0: a.y / CELL, x1: b.x / CELL, y1: b.y / CELL };
  selection = new Set(clustersInRect(state.clusters, state.n, rect, state.surface));
  draw();
}

function stagePos(ev) {
  var r = stage.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}
stage.addEventListener('pointerdown', function (ev) {
  if (!state || state.phase !== 'play' || uiHome || uiCollection) return;
  stage.setPointerCapture(ev.pointerId);
  var p = stagePos(ev);
  pointers.set(ev.pointerId, p);
  if (pointers.size === 2) {
    // ピンチ開始: 掴んでいた塊はその場で確定 (吸着/合体/保存) させてからピンチへ切り替える。
    // (旧実装は drag を捨てていたため、塊が浮いたまま未保存になることがあった)
    // 範囲選択の長押し判定・矩形はピンチが優先なので打ち切る (ピンチ中は選択操作をしない)
    cancelPressAndRect();
    if (drag) { settleDrag(); showDropZone(false); zoneHot = false; }
    panStart = null;
    var pts = Array.from(pointers.values());
    pinch = {
      d0: Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
      cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2,
      scale0: view().scale, tx0: view().tx, ty0: view().ty
    };
    return;
  }
  var hit = state.cleared ? null : hitCluster(p.x, p.y);
  if (hit) {
    var w = screenToWorld(p.x, p.y);
    var inSelection = selection.has(hit.cluster);
    // 選択外のピースを掴んだら、その時点で選択を解除して通常ドラッグにする
    if (!inSelection) clearSelection();
    // 掴んだ塊を最前面へ
    state.clusters.splice(state.clusters.indexOf(hit.cluster), 1);
    state.clusters.push(hit.cluster);
    drag = {
      cluster: hit.cluster,
      grabDX: w.x / CELL - hit.cluster.gx, grabDY: w.y / CELL - hit.cluster.gy,
      startSurface: state.surface, moved: false, group: null
    };
    if (inSelection && selection.size > 1) {
      // 範囲選択のグループドラッグ: 選択全塊の相対オフセットを掴んだ塊基準で保持する
      drag.group = Array.from(selection).map(function (c) {
        return { cluster: c, offX: c.gx - hit.cluster.gx, offY: c.gy - hit.cluster.gy };
      });
    }
    seGrab(); // 掴んだ音 (紙の「サッ」)
    startTimerOnce();
    showDropZone(true);
  } else if (state.cleared) {
    panStart = { sx: p.x, sy: p.y, tx: view().tx, ty: view().ty };
  } else {
    // 空き地: すぐにはパンを始めず、長押し (範囲選択) かパンかの判定に入る。
    // 450ms ほぼ静止できたら選択モードへ、判定前に 10px 超動いたら通常パンへ。
    var pid = ev.pointerId, sx0 = p.x, sy0 = p.y;
    var w0 = screenToWorld(sx0, sy0);
    pressPending = {
      id: pid, sx: sx0, sy: sy0, tx: view().tx, ty: view().ty, wx: w0.x, wy: w0.y,
      timer: setTimeout(function () {
        if (!pressPending || pressPending.id !== pid || !pointers.has(pid)) return;
        pressPending = null;
        selRect = { id: pid, x0: sx0, y0: sy0, x1: sx0, y1: sy0 };
        $('selectChip').hidden = false;
        draw();
      }, LONG_PRESS_MS)
    };
  }
});
stage.addEventListener('pointermove', function (ev) {
  if (!pointers.has(ev.pointerId)) return;
  var p = stagePos(ev);
  pointers.set(ev.pointerId, p);
  if (pinch && pointers.size === 2) {
    var pts = Array.from(pointers.values());
    var d = Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
    var cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
    var v = view();
    var ns = clampZoom(pinch.scale0 * d / pinch.d0);
    // ピンチ開始時に2本指の中心の下にあったワールド点を、現在の中心の下に保つ。
    // 拡縮と移動 (中心のパン) がこの1式で同時に効く (旧実装は中心移動分を二重に
    // 加算していたため、ピンチ中に視点が流れて「怪しい」挙動になっていた)。
    var wx = (pinch.cx - pinch.tx0) / pinch.scale0, wy = (pinch.cy - pinch.ty0) / pinch.scale0;
    v.scale = ns;
    v.tx = cx - wx * ns; v.ty = cy - wy * ns;
    updateZoomLabel();
    requestDraw(); // ピンチは連続発火するので rAF 集約 (requestDraw のコメント参照)
    return;
  }
  if (selRect && selRect.id === ev.pointerId) {
    selRect.x1 = p.x; selRect.y1 = p.y;
    requestDraw(); // 矩形描画も pointermove 連続発火なので rAF 集約
    return;
  }
  if (pressPending && pressPending.id === ev.pointerId) {
    // 長押し判定前に指が動いたら通常パンへ移行する。パンの基準は pointerdown
    // 時点のままなので、遅れて始まっても視点は跳ねない (移動量をそのまま適用)。
    if (Math.hypot(p.x - pressPending.sx, p.y - pressPending.sy) > PRESS_MOVE_PX) {
      clearTimeout(pressPending.timer);
      panStart = { sx: pressPending.sx, sy: pressPending.sy, tx: pressPending.tx, ty: pressPending.ty };
      pressPending = null;
    } else {
      return; // 判定待ちの微動では何もしない
    }
  }
  if (drag) {
    drag.moved = true;
    var zone = $('dropZone');
    var inZone = !zone.hidden && p.y <= 64;
    zone.classList.toggle('hot', inZone);
    if (inZone && !zoneHot) {
      zoneHot = true;
      switchSurfaceDuringDrag();
    }
    if (!inZone) zoneHot = false;
    var w = screenToWorld(p.x, p.y);
    drag.cluster.gx = w.x / CELL - drag.grabDX;
    drag.cluster.gy = w.y / CELL - drag.grabDY;
    if (drag.group) {
      // 範囲選択: 他の選択塊も相対位置を保って追随する
      drag.group.forEach(function (g) {
        if (g.cluster === drag.cluster) return;
        g.cluster.gx = drag.cluster.gx + g.offX;
        g.cluster.gy = drag.cluster.gy + g.offY;
      });
    }
    requestDraw(); // ドラッグは pointermove 連続発火なので rAF 集約
    return;
  }
  if (panStart) {
    view().tx = panStart.tx + (p.x - panStart.sx);
    view().ty = panStart.ty + (p.y - panStart.sy);
    requestDraw(); // パンも pointermove 連続発火なので rAF 集約
  }
});
function endPointer(ev) {
  var cancelled = ev.type === 'pointercancel';
  // 範囲選択まわりの終了処理 (この指が担当していた場合のみ)
  if (pressPending && pressPending.id === ev.pointerId) {
    clearTimeout(pressPending.timer);
    var wasTap = !panStart && pointers.size === 1; // パンに移行せず単独で離した = 空き地タップ
    var pp = pressPending;
    pressPending = null;
    if (wasTap && !cancelled) {
      clearSelection(); // 空き地を短くタップ → 選択解除
      // マット画面で盤の外側をタップしたら机に戻る (盤の中のタップは従来どおり)。
      // 空き地タップだけがここを通る (ピースはドラッグ、パンは panStart 経由、
      // 長押しは selRect 経由) ので、パン/ドラッグ/ピンチとは誤判定しない。
      if (state && state.surface === 'mat' && isOutsideBoardCell(pp.wx / CELL, pp.wy / CELL, state.n)) switchSurface();
    }
  }
  if (selRect && selRect.id === ev.pointerId) {
    if (cancelled) { selRect = null; $('selectChip').hidden = true; draw(); }
    else finishSelRect(); // 矩形に交差した塊を選択
  }
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 1 && !drag && state && state.views[state.surface]) {
    // ピンチから1本指に戻る: 残った指の現在位置でパンの基準を取り直し、
    // そのままパンへ移行する (基準が古いままだと視点が跳ねる)
    var rest = Array.from(pointers.values())[0];
    panStart = { sx: rest.x, sy: rest.y, tx: view().tx, ty: view().ty };
  }
  if (pointers.size === 0) {
    if (drag) settleDrag();
    panStart = null;
    showDropZone(false);
    zoneHot = false;
  }
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);
stage.addEventListener('contextmenu', function (ev) { ev.preventDefault(); }); // 長押しでメニューを出さない

/* ドラッグの確定処理 (離したとき & ピンチへ切り替えるとき共通) */
function settleDrag() {
  var cl = drag.cluster;
  var group = drag.group;
  var wasMoved = drag.moved;
  drag = null;
  if (!wasMoved) { draw(); return; }
  seDrop(); // 置いた音 (木の「トッ」)
  state.moves++;
  if (group && group.length > 1) { settleGroupDrag(cl, group); return; }
  // 合体処理 (相対スナップ→グリッド吸着→吸着後に正しい相対位置なら確実に合体、まで一括)
  var others = state.clusters.filter(function (c) { return c !== cl; });
  var res = absorbMerges(others, { pieces: cl.pieces, surface: cl.surface, gx: cl.gx, gy: cl.gy }, state.n);
  state.clusters = res.clusters;
  if (res.merged) { startMergeFlash(res.cluster.pieces); seMerge(); } // 合体のクリック + チャイム
  afterBoardChange();
}
/* 範囲選択のグループ確定:
 * (1) 掴んだ塊だけを非選択塊に対して通常どおり確定 (相対スナップ/グリッド吸着/合体) し、
 *     アンカーピースの実移動量 (吸着込み) を求める
 * (2) 他の選択塊へ同じ移動量を追随させる (相対配置は保持)
 * (3) 追随した各塊は合体判定だけ行う (noSnap: 単独のグリッド吸着で相対配置を壊さない) */
function settleGroupDrag(leader, group) {
  var n = state.n;
  var gset = new Set(group.map(function (g) { return g.cluster; }));
  var anchorId = clusterAnchorId(leader);
  var before = piecePositions([leader], n).get(anchorId);
  var res = absorbMerges(
    state.clusters.filter(function (c) { return !gset.has(c); }),
    { pieces: leader.pieces, surface: leader.surface, gx: leader.gx, gy: leader.gy }, n);
  var after = piecePositions([res.cluster], n).get(anchorId);
  var dx = after.gx - before.gx, dy = after.gy - before.gy;
  var flash = res.merged ? res.cluster.pieces.slice() : null;
  var followers = group.map(function (g) { return g.cluster; }).filter(function (c) { return c !== leader; });
  var all = res.clusters.concat(shiftClusters(followers, dx, dy));
  var queue = all.slice(res.clusters.length);
  while (queue.length) {
    var f = queue.shift();
    if (all.indexOf(f) < 0) continue; // 既に別の塊へ合体済み
    var r2 = absorbMerges(
      all.filter(function (c) { return c !== f; }),
      { pieces: f.pieces, surface: f.surface, gx: f.gx, gy: f.gy }, n, { noSnap: true });
    all = r2.clusters;
    if (r2.merged) flash = (flash || []).concat(r2.cluster.pieces);
  }
  state.clusters = all;
  if (flash) { startMergeFlash(flash); seMerge(); } // グループ側で合体した場合も同じ音
  afterBoardChange();
}
function afterBoardChange() {
  pruneSelection(); // 合体で差し替わった塊は選択から外れる
  invalidateDeskBackdrop(); // 塊の配置が変わったのでマット背景の机レイヤーを作り直す
  persistProgress();
  updateProgressUI();
  draw();
  if (!state.cleared && isComplete(state.clusters, state.n)) onClear();
}
function showDropZone(show) {
  var zone = $('dropZone');
  zone.hidden = !show;
  $('dropZoneLabel').textContent = state.surface === 'desk' ? 'マット' : '机';
}
/* ドラッグ中に画面を切り替える: 掴んでいる塊を新しい画面側へ移し、ドラッグを継続する */
function switchSurfaceDuringDrag() {
  if (!drag) return;
  state.surface = state.surface === 'desk' ? 'mat' : 'desk';
  if (drag.group) {
    // 範囲選択: グループ全塊が一緒に画面を移る (選択は維持される)
    drag.group.forEach(function (g) { g.cluster.surface = state.surface; });
  } else {
    drag.cluster.surface = state.surface;
  }
  // 切替先でのドロップゾーンは「戻る」方向を案内する
  $('dropZoneLabel').textContent = state.surface === 'desk' ? 'マット' : '机';
  invalidateDeskBackdrop(); // 塊が面を移ったので机レイヤーを作り直す
  updateSurfaceUI();
  draw();
}
function switchSurface() {
  if (!state || state.phase !== 'play' || uiHome) return;
  state.surface = state.surface === 'desk' ? 'mat' : 'desk';
  selection.clear(); // 画面切替では選択は保持しない
  invalidateDeskBackdrop();
  updateSurfaceUI();
  draw();
}
function updateSurfaceUI() {
  $('surfaceLabel').textContent = state.surface === 'desk' ? '作業机' : 'パズルマット';
  $('surfaceBtn').textContent = state.surface === 'desk' ? 'マットを開く' : '机に戻る';
  if (state.surface !== 'desk') hideMinimap(); // ミニマップは机画面だけのもの
  updateZoomLabel();
}
function clampZoom(s) {
  var v = view();
  // 下限は「机全体が画面に収まる倍率 (fit = 表示100%)」の 0.5 倍まで下げる。
  // 100% 未満にも引けるので、机全体＋余白を見渡せる。上限は fit の4倍。
  // ズーム±ボタン / ホイール / ピンチすべてこの共通クランプを通る。
  return Math.max(v.fit * 0.5, Math.min(v.fit * 4, s));
}
function zoomBy(factor) {
  var v = view();
  var cx = stageW / 2, cy = stageH / 2;
  var w = screenToWorld(cx, cy);
  v.scale = clampZoom(v.scale * factor);
  v.tx = cx - w.x * v.scale; v.ty = cy - w.y * v.scale;
  updateZoomLabel();
  draw();
}
function updateZoomLabel() {
  if (!state || !view()) return;
  $('zoomLabel').textContent = Math.round(view().scale / view().fit * 100) + '%';
}
stage.addEventListener('wheel', function (ev) {
  if (!state) return;
  ev.preventDefault();
  var p = stagePos(ev);
  var v = view();
  var w = screenToWorld(p.x, p.y);
  v.scale = clampZoom(v.scale * (ev.deltaY < 0 ? 1.12 : 1 / 1.12));
  v.tx = p.x - w.x * v.scale; v.ty = p.y - w.y * v.scale;
  updateZoomLabel();
  requestDraw(); // ホイールは連続発火するので rAF 集約
}, { passive: false });
/* ダブルタップズームは廃止 (ユーザー指定)。dblclick / touchend のダブルタップ
 * 判定は置かない: touchend 判定はピンチ終了時の2指の離し方 (<300ms) にも
 * 反応してしまい、指を離した瞬間に zoomBy が走って画面が跳ねる事故があった。 */

/* ---------- タイマー / 進捗 ---------- */
function startTimerOnce() {
  if (!state.started && !state.cleared) {
    state.started = true;
    state.timerStart = Date.now();
  }
}
setInterval(function () {
  if (!state) return;
  $('timerText').textContent = formatTime(currentElapsed());
  if (state.started && !state.paused && !state.cleared && Math.floor(Date.now() / 5000) !== Math.floor((Date.now() - 500) / 5000)) persistProgress();
}, 500);
function updateProgressUI() {
  var pos = piecePositions(state.clusters, state.n);
  var onMat = 0;
  pos.forEach(function (p) { if (p.surface === 'mat') onMat++; });
  $('progressText').textContent = 'マット ' + onMat + ' / ' + difficulty + ' ・ 塊 ' + state.clusters.length;
  $('timerText').textContent = formatTime(currentElapsed());
}

/* ---------- クリア処理 ---------- */
function onClear() {
  seClear(); // クリアのオルゴール風アルペジオ
  state.cleared = true;
  state.elapsedBase = currentElapsed();
  var elapsed = state.elapsedBase;
  var prev = findRecord(playDate, difficulty);
  var rec = {
    date: playDate, imageId: state.imageId, pieces: difficulty,
    clearTimeSec: elapsed,
    bestTimeSec: prev ? Math.min(prev.bestTimeSec, elapsed) : elapsed,
    moves: state.moves,
    previewViewed: state.previewViewed, previewCount: state.previewCount,
    clearedAt: new Date().toISOString(),
    author: state.author || null
  };
  if (prev) store.records[store.records.indexOf(prev)] = rec; else store.records.push(rec);
  persistProgress();
  $('streakNum').textContent = computeStreak();
  runConfetti();
  $('resultText').textContent = playDate + ' ・ ' + difficulty + 'ピース ・ タイム ' + formatTime(elapsed) + ' ・ ' + state.moves + '手';
  $('resultBadge').hidden = state.previewViewed;
  $('resultModal').hidden = false;
}
function runConfetti() {
  var wrap = $('confettiWrap'), cv = $('confetti'), ctx = cv.getContext('2d');
  cv.width = window.innerWidth; cv.height = window.innerHeight;
  wrap.hidden = false;
  var parts = [];
  var colors = THEMES[uiTheme].confetti;
  for (var i = 0; i < 160; i++) {
    parts.push({ x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.4, w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, vy: 1.6 + Math.random() * 2.6, vx: -1 + Math.random() * 2, rot: Math.random() * Math.PI, vr: -0.1 + Math.random() * 0.2, color: colors[i % colors.length] });
  }
  var start = Date.now();
  (function frame() {
    var t = Date.now() - start;
    ctx.clearRect(0, 0, cv.width, cv.height);
    parts.forEach(function (p) {
      p.y += p.vy; p.x += p.vx + Math.sin((p.y + p.rot * 40) / 30); p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (t < 3200) requestAnimationFrame(frame);
    else { wrap.hidden = true; ctx.clearRect(0, 0, cv.width, cv.height); }
  })();
}

/* ---------- 画面遷移 ----------
 * uiHome: スタート画面を表示しているか (プレイ中は false)
 * uiCollection: コレクションを表示しているか */
var uiHome = true;
var uiCollection = false;
var collectionBackToHome = false; // クリア画面経由で開いたコレクションの「戻る」はプレイ画面でなくスタート画面へ
var firstStart = true; // 初回だけ true。起動時は進捗があっても必ずスタート画面から (机へ自動復帰しない)
function applyVisibility() {
  $('startView').hidden = !uiHome || uiCollection;
  $('playView').hidden = uiHome || uiCollection;
  $('collectionView').hidden = !uiCollection;
  if (!uiHome && !uiCollection) resizeStage();
}
function showCollection() {
  uiCollection = true;
  applyVisibility();
  renderCollection();
}
function showPlay() {
  uiCollection = false;
  applyVisibility();
}
/* スタート画面に戻る (設定の「スタート画面に戻る」と、クリア画面を閉じたときの共通動線) */
function goToStartScreen() {
  if (state) persistProgress();
  uiHome = true;
  uiCollection = false;
  renderStartScreen();
  applyVisibility();
}
function renderCollection() {
  var recs = store.records.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.pieces - a.pieces; });
  var days = new Set(recs.map(function (r) { return r.date; }));
  var perDiff = DIFFICULTIES.map(function (d) {
    var c = recs.filter(function (r) { return r.pieces === d; }).length;
    return d + 'ピース: ' + c;
  }).join(' ／ ');
  $('collectionStats').innerHTML =
    '<span class="stat">クリア日数 <b>' + days.size + '</b></span>' +
    '<span class="stat">総クリア数 <b>' + recs.length + '</b></span>' +
    '<span class="stat">連続日数 <b>' + computeStreak() + '</b></span>' +
    '<span class="stat">' + perDiff + '</span>';
  $('collectionEmpty').hidden = recs.length > 0;
  var grid = $('collectionGrid');
  grid.innerHTML = '';
  recs.forEach(function (r) {
    var card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';
    var badges = '<span class="badge">' + r.pieces + 'ピース</span>' +
      (r.previewViewed ? '<span class="badge">完成図: 見た</span>' : '<span class="badge praise">完成図を見ずにクリア！</span>');
    card.innerHTML = '<img loading="lazy" src="https://picsum.photos/id/' + r.imageId + '/400/400" alt="">' +
      '<span class="card-body"><span class="card-date">' + r.date + '</span>' +
      '<span>クリアタイム ' + formatTime(r.bestTimeSec) + '</span>' + badges + '</span>';
    card.addEventListener('click', function () { openDetail(r); });
    grid.appendChild(card);
  });
}
/* ---------- コレクション詳細: 完成盤面をジグソー風に描く ----------
 * 写真をそのまま出すのではなく、そのレコードの難易度 n で「全ピースが
 * マット上の正しい位置に置かれた状態」を Canvas に1回だけ描く。
 * 辺は既存の generator をレコードの日付×難易度シードで再生成する
 * (当時の形と一致しなくてよいが、開くたびに同じ形になる)。
 * ピースの描き方はプレイ画面と揃える: 輪郭パスでクリップして写真を描き、
 * 縁に線を付ける (pieceBitmap と同じ流儀)。背景はマット色にして、
 * マットに置いて完成させたときの見た目にする。 */
var detailRecord = null;
var detailSeq = 0; // 非同期読み込みの競合ガード (開き直したら古い描画を捨てる)

function openDetail(r) {
  detailRecord = r;
  $('detailText').innerHTML =
    '日付: ' + r.date + '<br>難易度: ' + r.pieces + 'ピース<br>クリアタイム: ' + formatTime(r.bestTimeSec) +
    '<br>手数: ' + (r.moves != null ? r.moves : '-') +
    '<br>完成図: ' + (r.previewViewed ? '見た（' + r.previewCount + '回）' : '見ずにクリア') +
    (r.author ? '<br>作者: ' + r.author : '');
  // 過去日をプレイしに行く導線は作らない (コレクションは閲覧のみ)
  $('detailModal').hidden = false;
  renderDetailPuzzle(r);
}

/* 詳細用の写真を正方形キャンバスで用意する。読み込み失敗時はゲーム本体と
 * 同じ抽象画フォールバック (そのレコードの日付シード生成) をソースにする。 */
function loadDetailSource(r) {
  return new Promise(function (resolve) {
    var size = Math.min(1080, imageSizeFor(r.pieces));
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      var side = Math.min(img.naturalWidth, img.naturalHeight);
      var cv = document.createElement('canvas');
      cv.width = size; cv.height = size;
      cv.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      resolve(cv);
    };
    img.onerror = function () { resolve(makeFallbackCanvas(r.date)); };
    img.src = 'https://picsum.photos/id/' + r.imageId + '/' + size + '/' + size;
  });
}
/* 完成盤面用のピース輪郭パス (盤面座標)。buildPiecePath と同じ組み立てだが、
 * ゲームの state ではなく引数の edges / レイアウトから作る。 */
function detailPiecePath(edges, col, row, layout, perSeg) {
  var path = new Path2D();
  var sides = ['top', 'right', 'bottom', 'left'];
  sides.forEach(function (side, si) {
    var pts = sideSamples(edges, col, row, side, perSeg);
    pts.forEach(function (p, i) {
      var x = layout.ox + (col + p.x) * layout.cellPx;
      var y = layout.oy + (row + p.y) * layout.cellPx;
      if (si === 0 && i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    });
  });
  path.closePath();
  return path;
}
/* マット + 完成盤面を描く。src が null の間はマットと「読み込み中」だけ出す */
function paintDetailBoard(cv, r, src) {
  var plan = detailRenderPlan(r.pieces);
  var layout = completedBoardLayout(r.pieces, plan.sizePx);
  var ctx = cv.getContext('2d');
  var n = layout.n;
  // マット全面 + 盤の土台 (プレイ画面のマット描画と揃える)
  ctx.fillStyle = THEMES[uiTheme].mat;
  ctx.fillRect(0, 0, plan.sizePx, plan.sizePx);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(layout.ox, layout.oy, layout.boardPx, layout.boardPx);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.strokeRect(layout.ox, layout.oy, layout.boardPx, layout.boardPx);
  if (!src) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 ' + Math.max(14, Math.round(plan.sizePx * 0.028)) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('読み込み中…', plan.sizePx / 2, plan.sizePx / 2);
    return;
  }
  var edges = generateEdges(r.date, r.pieces);
  for (var id = 0; id < n * n; id++) {
    var home = pieceHome(id, n);
    var path = detailPiecePath(edges, home.col, home.row, layout, plan.perSeg);
    ctx.save();
    ctx.clip(path);
    ctx.drawImage(src, layout.ox, layout.oy, layout.boardPx, layout.boardPx);
    ctx.restore();
    strokePieceBevel(ctx, path, pieceRelief(layout.cellPx).bevel); // プレイ画面と揃える
    ctx.strokeStyle = 'rgba(30,30,30,0.35)';
    ctx.lineWidth = Math.max(1, layout.cellPx * 0.02);
    ctx.stroke(path);
  }
}
function renderDetailPuzzle(r) {
  var seq = ++detailSeq;
  var cv = $('detailCanvas');
  var plan = detailRenderPlan(r.pieces);
  cv.width = plan.sizePx;
  cv.height = plan.sizePx;
  paintDetailBoard(cv, r, null); // 先にマットだけ描いて待たせない
  loadDetailSource(r).then(function (src) {
    if (seq !== detailSeq) return; // 別の詳細が開かれたら古い結果は捨てる
    paintDetailBoard(cv, r, src);
  });
}

/* ---------- コントロール配線 ---------- */
/* 難易度セレクタ (案D: 重なったカード)。傾きはカード位置で決定的に決める。
 * 選択中カードの想定時間はカード列の下に1行だけ出す。 */
var DIFF_TIME_LABELS = { 36: '3〜8分', 100: '20〜40分', 225: '1〜2時間', 400: '2〜4時間', 784: '半日〜1日', 1225: '1〜2日', 2025: '数日がかり' };
var DIFF_SUB_LABELS = { 36: 'かんたん', 2025: 'おに' };
var DIFF_TILTS = [-3, -1.2, 2.2, -2, 1.4, -0.6, 2.5];
function buildDifficultySeg() {
  var seg = $('difficultySeg');
  seg.innerHTML = '';
  DIFFICULTIES.forEach(function (d, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'diff-card' + (d === difficulty ? ' active' : '');
    b.style.setProperty('--tilt', DIFF_TILTS[i % DIFF_TILTS.length] + 'deg');
    b.style.zIndex = d === difficulty ? 20 : i + 1;
    var num = document.createElement('span');
    num.className = 'diff-num';
    num.textContent = d;
    b.appendChild(num);
    if (DIFF_SUB_LABELS[d]) {
      var sub = document.createElement('span');
      sub.className = 'diff-sub';
      sub.textContent = DIFF_SUB_LABELS[d];
      b.appendChild(sub);
    }
    b.setAttribute('aria-pressed', d === difficulty ? 'true' : 'false');
    b.addEventListener('click', function () {
      if (d === difficulty) return;
      if (state) persistProgress();
      difficulty = d;
      store.lastDifficulty = d;
      saveStore();
      startGame(state.pool);
    });
    seg.appendChild(b);
  });
  var subLabel = DIFF_SUB_LABELS[difficulty];
  $('difficultyTime').textContent = (subLabel ? subLabel + ' ・ ' : '') + '想定 ' + DIFF_TIME_LABELS[difficulty];
}

/* ---------- タイマーの一時停止/再開 ---------- */
function timerRunning() {
  return !!(state && state.started && !state.paused && !state.cleared);
}
function pauseTimer() {
  if (!timerRunning()) return;
  state.elapsedBase = currentElapsed();
  state.paused = true;
}
function resumeTimer() {
  if (!state || !state.paused || state.cleared) return;
  state.paused = false;
  state.timerStart = Date.now();
}

/* ---------- 完成図プレビュー (補助はこれだけ。開いたら記録する) ---------- */
function openPreview() {
  if (!state || state.phase !== 'play') return;
  state.previewViewed = true;
  state.previewCount++;
  persistProgress();
  if (state.usedFallback && state.srcCanvas) {
    $('previewImg').src = state.srcCanvas.toDataURL();
  } else {
    var size = Math.min(1080, imageSizeFor(difficulty));
    $('previewImg').src = 'https://picsum.photos/id/' + state.imageId + '/' + size + '/' + size;
  }
  $('previewModal').hidden = false;
}

/* ---------- 設定メニュー (開いている間はタイマー停止) ---------- */
var settingsAutoPaused = false;
function updateSettingsPauseBtn() {
  var btn = $('settingsPauseBtn');
  if (!state || !state.started || state.cleared) { btn.disabled = true; btn.textContent = '一時停止'; return; }
  btn.disabled = false;
  btn.textContent = state.paused ? '再開する' : '一時停止する';
}
function openSettings() {
  if (!state || state.phase !== 'play' || uiHome || uiCollection) return;
  settingsAutoPaused = false;
  if (timerRunning()) { pauseTimer(); settingsAutoPaused = true; persistProgress(); }
  updateSettingsPauseBtn();
  $('settingsModal').hidden = false;
}
function closeSettings() {
  $('settingsModal').hidden = true;
  if (settingsAutoPaused) {
    settingsAutoPaused = false;
    resumeTimer();
    persistProgress();
  }
}

/* ---------- やりなおす (進行を消して未開始の箱に戻る) ---------- */
function restartPuzzle() {
  if (store.progress[playDate]) delete store.progress[playDate][difficulty];
  saveStore();
  uiHome = true;
  startGame(state.pool);
}

function wireControls() {
  $('surfaceBtn').addEventListener('click', switchSurface);
  $('zoomInBtn').addEventListener('click', function () { zoomBy(1.3); });
  $('zoomOutBtn').addEventListener('click', function () { zoomBy(1 / 1.3); });
  $('settingsBtn').addEventListener('click', openSettings);
  document.querySelectorAll('[data-theme-opt]').forEach(function (b) {
    b.addEventListener('click', function () { setUiTheme(b.getAttribute('data-theme-opt')); });
  });
  /* サウンド設定: 保存済みの値をコントロールへ反映し、変更は即保存 + 即適用。
   * クレジット一覧は BGM_TRACKS から生成する (曲名・作者・ライセンス)。 */
  $('bgmToggle').checked = bgmOn;
  $('bgmVolume').value = Math.round(bgmVolume * 100);
  $('seToggle').checked = seOn;
  $('bgmCredits').innerHTML = BGM_TRACKS.map(function (t) {
    return '<li>' + t.title + ' — ' + t.artist + '（' + t.license + '）</li>';
  }).join('');
  $('bgmToggle').addEventListener('change', function () {
    bgmOn = $('bgmToggle').checked;
    saveAudioSettings();
    bgmApplySettings();
  });
  $('bgmVolume').addEventListener('input', function () {
    bgmVolume = $('bgmVolume').value / 100;
    saveAudioSettings();
    bgmApplySettings();
  });
  $('seToggle').addEventListener('change', function () {
    seOn = $('seToggle').checked;
    saveAudioSettings();
  });
  document.querySelectorAll('[data-settings-close]').forEach(function (el) {
    el.addEventListener('click', closeSettings);
  });
  $('settingsPauseBtn').addEventListener('click', function () {
    if (!state || !state.started || state.cleared) return;
    if (state.paused) resumeTimer(); else pauseTimer();
    settingsAutoPaused = false; // ユーザーが明示的に切り替えたら自動再開しない
    updateSettingsPauseBtn();
    persistProgress();
    $('timerText').textContent = formatTime(currentElapsed());
  });
  $('settingsPreviewBtn').addEventListener('click', function () {
    closeSettings();
    openPreview();
  });
  $('settingsCollectionBtn').addEventListener('click', function () {
    closeSettings();
    collectionBackToHome = false; // プレイ中からのコレクションはプレイ画面へ戻る
    showCollection();
  });
  $('settingsHomeBtn').addEventListener('click', function () {
    closeSettings();
    goToStartScreen();
  });
  $('settingsRestartBtn').addEventListener('click', function () {
    $('confirmModal').hidden = false;
  });
  $('confirmNoBtn').addEventListener('click', function () { $('confirmModal').hidden = true; });
  $('confirmYesBtn').addEventListener('click', function () {
    $('confirmModal').hidden = true;
    closeSettings();
    restartPuzzle();
  });
  $('resumePlayBtn').addEventListener('click', function () {
    uiHome = false;
    applyVisibility();
    updateProgressUI();
    draw();
  });
  /* スタート画面の「はじめから」: 誤タップ防止のため必ず確認モーダルを挟む。
   * 確定したら進捗を消して未開封の箱に戻り、通常の開始フロー (箱→机) に入る。
   * 設定シート側の確認モーダル (confirmModal) とは別にし、挙動を混ぜない。 */
  $('freshStartBtn').addEventListener('click', function () {
    if (!freshStartNeedsConfirm({ started: state && state.gameStarted, cleared: state && state.cleared, clusters: state ? state.clusters : [] })) return;
    $('freshConfirmText').textContent = difficulty + 'ピースの進捗は消えます。はじめから遊びますか？';
    $('freshConfirmModal').hidden = false;
  });
  $('freshConfirmNoBtn').addEventListener('click', function () { $('freshConfirmModal').hidden = true; });
  $('freshConfirmYesBtn').addEventListener('click', function () {
    $('freshConfirmModal').hidden = true;
    restartPuzzle();
  });
  $('giftBox').addEventListener('click', openBox);
  $('giftBox').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openBox(); }
  });
  $('collectionBtn').addEventListener('click', function () {
    collectionBackToHome = false;
    showCollection();
  });
  $('collectionBack').addEventListener('click', function () {
    if (collectionBackToHome) { collectionBackToHome = false; goToStartScreen(); }
    else showPlay();
  });
  $('resumeClose').addEventListener('click', function () { $('resumeBanner').hidden = true; });
  document.querySelectorAll('[data-close]').forEach(function (el) {
    el.addEventListener('click', function () {
      $('previewModal').hidden = true;
      $('detailModal').hidden = true;
    });
  });
  // クリア画面を閉じたらプレイ画面 (空の机) には残らず、スタート画面に戻す
  $('resultCloseBtn').addEventListener('click', function () { $('resultModal').hidden = true; goToStartScreen(); });
  $('resultCollectionBtn').addEventListener('click', function () {
    $('resultModal').hidden = true;
    collectionBackToHome = true; // コレクションから戻る先もスタート画面にする
    showCollection();
  });
  $('resultCopyBtn').addEventListener('click', function () {
    var text = $('resultText').textContent + ' #まいにちジグソー';
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    $('resultCopyBtn').textContent = 'コピーしました';
    setTimeout(function () { $('resultCopyBtn').textContent = '結果をコピー'; }, 1500);
  });
  window.addEventListener('resize', resizeStage);
}

/* ---------- スタート画面の箱 ----------
 * 実物のパズル箱と同じ「平たくて広い」薄型の箱を SVG で描く。
 * 蓋・本体の多角形は頂点を共有してズレないようにし、陰影は
 * 蓋上面 (最も明るい) → 蓋の前縁 → 正面 → 蓋の右縁 → 右側面 (最も暗い) で一貫させる。
 * 包装柄は全面に貼り、面ごとに陰影だけを変える。文字・ラベル・完成図は入れない。 */
function giftFlowerSvg(cx, cy, s, petal, center) {
  var out = '<g transform="translate(' + cx + ',' + cy + ') scale(' + s + ')">';
  for (var i = 0; i < 5; i++) {
    var a = Math.PI * 2 * i / 5 - Math.PI / 2;
    out += '<circle cx="' + (Math.cos(a) * 4.6).toFixed(1) + '" cy="' + (Math.sin(a) * 4.6).toFixed(1) + '" r="3.4" fill="' + petal + '"/>';
  }
  return out + '<circle r="2.2" fill="' + center + '"/></g>';
}
/* 包装柄はテーマごとの色 (THEMES[uiTheme].box) で描く。柄の種類と日付ローテーションは不変。
 * 原色の大きな柄は廃止し、彩度を落とした細かい柄に統一している。 */
function giftPatternDef(patternId) {
  var pal = THEMES[uiTheme].box[patternId] || THEMES[uiTheme].box['dots-red'];
  var body;
  switch (patternId) {
    case 'dots-red': // 細ドット
      body = '<rect width="30" height="30" fill="' + pal.bg + '"/>' +
        '<circle cx="8" cy="8" r="2.4" fill="' + pal.fg + '"/><circle cx="23" cy="23" r="2.4" fill="' + pal.fg + '"/>' +
        '<circle cx="23" cy="8" r="1.3" fill="' + pal.fg2 + '"/><circle cx="8" cy="23" r="1.3" fill="' + pal.fg2 + '"/>';
      return '<pattern id="giftPat" width="30" height="30" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'stripes-mint': // 細ストライプ
      body = '<rect width="22" height="22" fill="' + pal.bg + '"/><rect width="5" height="22" fill="' + pal.fg + '"/>';
      return '<pattern id="giftPat" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' + body + '</pattern>';
    case 'stars-navy': // 小さな星
      body = '<rect width="40" height="40" fill="' + pal.bg + '"/>' +
        '<polygon points="0,-3.6 1.1,-1.2 3.6,-1.2 1.6,0.9 2.3,3.5 0,2 -2.3,3.5 -1.6,0.9 -3.6,-1.2 -1.1,-1.2" transform="translate(11,12)" fill="' + pal.fg + '"/>' +
        '<polygon points="0,-2.4 0.7,-0.8 2.4,-0.8 1.1,0.6 1.6,2.3 0,1.3 -1.6,2.3 -1.1,0.6 -2.4,-0.8 -0.7,-0.8" transform="translate(30,30)" fill="' + pal.fg2 + '"/>' +
        '<circle cx="31" cy="9" r="1.1" fill="' + pal.fg2 + '"/><circle cx="7" cy="33" r="1.1" fill="' + pal.fg + '"/>';
      return '<pattern id="giftPat" width="40" height="40" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'gingham-pink': // 細ギンガム
      body = '<rect width="24" height="24" fill="' + pal.bg + '"/><rect width="24" height="12" fill="' + pal.fg + '" opacity="0.45"/><rect width="12" height="24" fill="' + pal.fg + '" opacity="0.45"/>';
      return '<pattern id="giftPat" width="24" height="24" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'confetti': // 小紋 (小さな粒と線)
      body = '<rect width="34" height="34" fill="' + pal.bg + '"/>' +
        '<rect x="5" y="7" width="5" height="1.8" fill="' + pal.fg + '" transform="rotate(30 7 8)"/>' +
        '<circle cx="24" cy="9" r="1.7" fill="' + pal.fg2 + '"/>' +
        '<rect x="15" y="18" width="1.8" height="5" fill="' + pal.fg2 + '" transform="rotate(-18 16 20)"/>' +
        '<circle cx="28" cy="27" r="1.4" fill="' + pal.fg + '"/>' +
        '<rect x="6" y="26" width="4.4" height="1.6" fill="' + pal.fg2 + '" transform="rotate(12 8 27)"/>' +
        '<circle cx="11" cy="16" r="1.2" fill="' + pal.fg + '"/>';
      return '<pattern id="giftPat" width="34" height="34" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    default: // floral-retro: 小花
      body = '<rect width="42" height="42" fill="' + pal.bg + '"/>' + giftFlowerSvg(12, 12, 0.8, pal.fg, pal.fg2) + giftFlowerSvg(32, 32, 0.55, pal.fg, pal.fg2) +
        '<circle cx="33" cy="10" r="1.4" fill="' + pal.fg2 + '"/><circle cx="9" cy="34" r="1.4" fill="' + pal.fg2 + '"/>';
      return '<pattern id="giftPat" width="42" height="42" patternUnits="userSpaceOnUse">' + body + '</pattern>';
  }
}
function giftBoxSvg(patternId) {
  function face(points, shade) {
    var s = '<polygon points="' + points + '" fill="url(#giftPat)"/>';
    if (shade > 0) s += '<polygon points="' + points + '" fill="#000000" opacity="' + shade + '"/>';
    return s + '<polygon points="' + points + '" fill="none" stroke="rgba(60,30,10,0.35)" stroke-width="1"/>';
  }
  /* 開口部の内側: 蓋に隠れて通常は見えない。蓋が持ち上がると
   * 暗い内側が少し見えるだけ (中身のピースは描かない)。 */
  var opening = '100,77 352,77 316,129 64,129';
  var inside = '<polygon points="' + opening + '" fill="#33200f"/>';
  /* 蓋: 上面 + 前縁 + 右縁を1グループにし、CSS で回転させず真上へ
   * 持ち上げる (.gift-lid / #giftBox.opening) */
  var lid = '<g class="gift-lid">' +
    face('316,121 352,77 352,84 316,128', 0.22) +   /* 蓋の右縁 */
    face('64,121 316,121 316,128 64,128', 0.08) +   /* 蓋の前縁 */
    face('100,77 352,77 316,121 64,121', 0) +       /* 蓋の上面 */
    '</g>';
  /* 接地影: 箱の底面フットプリント (64,158)-(316,158)-(352,114)-(100,114) に沿った
   * 平たく横長の影。接地面近くは濃く (芯・弱ぼかし)、外側へ柔らかくぼける (広ぼかし)。
   * 浮いて見える楕円影は廃止。 */
  var shadowDefs =
    '<filter id="giftShSoft" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="7"/></filter>' +
    '<filter id="giftShCore" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="2.5"/></filter>';
  var shadow =
    '<polygon points="54,163 326,163 362,117 92,117" fill="rgba(43,24,6,0.20)" filter="url(#giftShSoft)"/>' +
    '<polygon points="62,161 318,161 354,117 98,117" fill="rgba(43,24,6,0.32)" filter="url(#giftShCore)"/>';
  return '<svg viewBox="0 0 416 190" role="img" aria-label="包装されたパズルの箱">' +
    '<defs>' + giftPatternDef(patternId) + shadowDefs + '</defs>' +
    shadow +
    face('316,128 352,84 352,114 316,158', 0.30) +  /* 右側面 */
    face('64,128 316,128 316,158 64,158', 0.16) +   /* 正面 */
    inside +
    lid +
    '</svg>';
}
/* 箱タップ → 蓋がパカッと開く (約0.42s) → 暗転 → ぶちまけたあとの作業机から開始。
 * ピースが飛び散るアニメーションは作らない (蓋パカッ＋暗転だけ)。
 * 開封自体はタイマーを開始しない (タイマーは最初のピースを掴んだとき)。 */
function openBox() {
  if (!state || state.phase !== 'box' || state.opening) return;
  state.opening = true; // 開封アニメーション中の連打を無効化 (CSS 側でも pointer-events: none)
  seLid(); // 蓋が開く音 (紙の擦れ + ノック)
  var box = $('giftBox');
  box.classList.add('opening');
  var veil = $('fadeVeil');
  setTimeout(function () { veil.classList.add('on'); }, 270); // 蓋が開ききる頃から暗転を始める
  setTimeout(function () {
    if (!state) return;
    state.clusters = initialScatter(playDate, difficulty);
    selection.clear(); // 散らばった新しい塊に旧選択は引き継がない
    state.gameStarted = true;
    state.phase = 'play';
    uiHome = false;
    persistProgress();
    applyVisibility();
    updateProgressUI();
    draw();
    veil.classList.remove('on');
    box.classList.remove('opening'); // 次に箱を出すとき (やりなおし後) は閉じた状態から
    state.opening = false;
  }, 580);
}

/* スタート画面の表示内容: 未開封なら箱、開始済みなら「つづきから / はじめから」パネル。
 * 起動時は進捗があっても必ずここから始め、続きはユーザーが選ぶ。 */
function renderStartScreen() {
  if (!state) return;
  var mode = startPanelMode({ started: state.gameStarted, cleared: state.cleared, clusters: state.clusters });
  var startedAlready = mode !== 'box';
  $('giftBox').classList.remove('opening');
  $('giftBox').innerHTML = giftBoxSvg(boxPatternForDate(playDate).id);
  $('giftBox').hidden = startedAlready;
  $('startHint').hidden = startedAlready;
  $('resumePanel').hidden = !startedAlready;
  if (startedAlready) {
    if (mode === 'cleared') {
      // クリア済みの日付×難易度は進捗サマリーの代わりにクリア表示にする
      var rec = findRecord(playDate, difficulty);
      var best = rec ? rec.bestTimeSec : currentElapsed();
      $('resumeInfo').textContent = difficulty + 'ピース ・ クリア済み ・ ベストタイム ' + formatTime(best);
    } else {
      var pos = piecePositions(state.clusters, state.n);
      var onMat = 0;
      pos.forEach(function (p) { if (p.surface === 'mat') onMat++; });
      $('resumeInfo').textContent = difficulty + 'ピース ・ マットに置いたピース ' + onMat + ' / ' + difficulty + ' ・ ' + formatTime(currentElapsed());
    }
  }
}

/* ---------- ゲーム開始 ---------- */
function startGame(pool) {
  state = newGameState(pool);
  selection.clear(); // 塊が作り直されるので選択は引き継がない
  cancelPressAndRect();
  buildDifficultySeg();
  if (firstStart) { uiHome = true; firstStart = false; } // ページを開き直したら必ずスタート画面から
  // スタート画面: 未開封なら包装された箱 (柄は日付で決定的)、開始済みなら続きからパネル
  renderStartScreen();
  $('fadeVeil').classList.remove('on');
  var d = new Date(dateToMs(playDate));
  $('themeDateLabel').textContent = d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日のお題';
  $('themeCredit').textContent = '';
  $('streakNum').textContent = computeStreak();
  $('loadingOverlay').style.display = 'flex';
  $('resumeBanner').hidden = !state.resumed;
  applyVisibility();
  loadSourceImage().then(function (res) {
    var src = res.img;
    state.usedFallback = res.fallback;
    // 正方形クロップを boardPx のキャンバスへ (難易度に応じた取得サイズと一致させる)
    var boardPx = imageSizeFor(difficulty);
    var cv = document.createElement('canvas');
    cv.width = boardPx; cv.height = boardPx;
    var sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
    var side = Math.min(sw, sh);
    cv.getContext('2d').drawImage(src, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, boardPx, boardPx);
    state.srcCanvas = cv;
    state.boardPx = boardPx;
    state.bitmaps.clear();
    $('fallbackNote').hidden = !res.fallback;
    $('loadingOverlay').style.display = 'none';
    fitViews();
    updateSurfaceUI();
    updateProgressUI();
    draw();
  });
  fetchCredit();
}

/* ---------- 初期化 ---------- */
fetch('data/images.json')
  .then(function (r) { if (!r.ok) throw new Error('images.json'); return r.json(); })
  .then(function (pool) {
    wireControls();
    applyTheme();
    startGame(pool);
    resizeStage();
  })
  .catch(function () {
    $('themeDateLabel').textContent = '画像プールの読み込みに失敗しました';
    $('loadingOverlay').textContent = 'data/images.json を読み込めませんでした';
  });
})();
}
