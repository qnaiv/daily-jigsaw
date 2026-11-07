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
function isValidDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  var ms = dateToMs(s);
  return msToDateStr(ms) === s;
}
function jstTodayString(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date());
}
/* ?date= の解決: 不正/未来日は今日にクランプ */
function resolvePlayDate(param, todayStr) {
  if (param && isValidDateStr(param) && daysBetween(param, todayStr) <= 0) return param;
  return todayStr;
}

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
 * 返り値: { clusters: 合体後の全塊, cluster: moving を含む塊, merged: 合体したか } */
function absorbMerges(others, moving, n) {
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
    cur.gx = snapToGrid(cur.gx); cur.gy = snapToGrid(cur.gy);
    while (tryOnce(true)) { /* グリッド吸着後の確実合体 */ }
  }
  return { clusters: pool.concat([cur]), cluster: cur, merged: merged };
}

/* 初期散らばり: 全ピースを机のグリッド上に1つずつ散らばせる。
 * 日付×難易度のシードで決定的 (同じ条件なら誰でも同じ配置)。
 * 机ビュー (横 n+6 セル × 縦 n+4 セル、原点 -3,-1) の内側に収める。 */
function initialScatter(dateStr, pieces) {
  var n = Math.round(Math.sqrt(pieces));
  var cols = n + 6;
  var rows = Math.ceil(pieces / cols);
  var rng = rngFromString('scatter:' + dateStr + ':' + pieces);
  var cells = [];
  for (var i = 0; i < cols * rows; i++) cells.push(i);
  for (var k = cells.length - 1; k > 0; k--) {
    var j = Math.floor(rng() * (k + 1));
    var tmp = cells[k]; cells[k] = cells[j]; cells[j] = tmp;
  }
  var clusters = [];
  for (var id = 0; id < pieces; id++) {
    var cell = cells[id];
    clusters.push({ pieces: [id], surface: 'desk', gx: (cell % cols) - 3, gy: Math.floor(cell / cols) - 1 });
  }
  return clusters;
}

/* スタート画面の箱の包装柄 (完成写真は載せない)。日付シードで決定的にローテーション */
var BOX_PATTERNS = [
  { id: 'dots-red', name: 'ドット（赤）' },
  { id: 'stripes-mint', name: 'ストライプ（ミント）' },
  { id: 'stars-navy', name: '星空（紺）' },
  { id: 'gingham-pink', name: 'ギンガム（ピンク）' },
  { id: 'confetti', name: 'コンフェッティ' },
  { id: 'floral-retro', name: 'レトロ花柄' }
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
  isValidDateStr: isValidDateStr, jstTodayString: jstTodayString, resolvePlayDate: resolvePlayDate,
  pickImageId: pickImageId, imageSizeFor: imageSizeFor,
  genEdge: genEdge, edgeSegments: edgeSegments, sampleEdge: sampleEdge,
  generateEdges: generateEdges, sideSamples: sideSamples, pieceOutlinePoints: pieceOutlinePoints,
  pieceHome: pieceHome, clusterAnchorId: clusterAnchorId, piecePositions: piecePositions,
  snapToGrid: snapToGrid, findRelativeSnap: findRelativeSnap, isComplete: isComplete,
  absorbMerges: absorbMerges, initialScatter: initialScatter,
  BOX_PATTERNS: BOX_PATTERNS, boxPatternIndex: boxPatternIndex, boxPatternForDate: boxPatternForDate,
  isEdgePiece: isEdgePiece, formatTime: formatTime
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
  return { records: [], progress: {}, lastDifficulty: 36 };
}
var store = loadStore();
function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 容量超過などは無視 */ }
}
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
var params = new URLSearchParams(location.search);
var todayStr = jstTodayString();
var playDate = resolvePlayDate(params.get('date'), todayStr);
var difficulty = DIFFICULTIES.indexOf(store.lastDifficulty) >= 0 ? store.lastDifficulty : 36;
var state = null; // ゲーム開始時に構築

function newGameState(pool) {
  var prog = progressFor(playDate, difficulty);
  // 旧バージョンの保存 (started なし) でも、塊が残っていれば開始済みとして扱う
  var gameStarted = !!prog.started || prog.clusters.length > 0;
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
  ctx.save();
  ctx.clip(path);
  ctx.drawImage(state.srcCanvas, marginPx - home.col * cellPx, marginPx - home.row * cellPx, state.boardPx, state.boardPx);
  ctx.restore();
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
  if (state && !state.views.desk) fitViews();
  draw();
}
function fitView(surface) {
  var n = state.n;
  var worldW = (surface === 'mat' ? n + 2 : n + 6) * CELL;
  var worldH = (surface === 'mat' ? n + 2 : n + 4) * CELL;
  var fit = Math.min(stageW / worldW, stageH / worldH);
  var ox = surface === 'mat' ? -CELL : -(3 * CELL);
  var oy = -CELL;
  return { scale: fit, fit: fit, tx: (stageW - worldW * fit) / 2 - ox * fit, ty: (stageH - worldH * fit) / 2 - oy * fit };
}
function fitViews() {
  if (!stageW || !stageH) return; // プレイ画面が非表示の間はフィット計算しない (表示時に resizeStage が行う)
  state.views.desk = fitView('desk');
  state.views.mat = fitView('mat');
}
function view() { return state.views[state.surface]; }
function worldToScreen(wx, wy) { var v = view(); return { x: wx * v.scale + v.tx, y: wy * v.scale + v.ty }; }
function screenToWorld(sx, sy) { var v = view(); return { x: (sx - v.tx) / v.scale, y: (sy - v.ty) / v.scale }; }

/* ---------- 机の木目テクスチャ ----------
 * 木目タイルを一度だけオフスクリーンに描き、ワールド座標に固定して敷く
 * (パン/ズームに追随するので「机の上を動いている」感触になる)。 */
var woodPattern = null;
function getWoodPattern() {
  if (woodPattern) return woodPattern;
  var cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  var c = cv.getContext('2d');
  var rng = rngFromString('woodgrain-v1');
  var grad = c.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#b0824f');
  grad.addColorStop(0.5, '#a87c48');
  grad.addColorStop(1, '#b0824f');
  c.fillStyle = grad;
  c.fillRect(0, 0, 512, 512);
  // 木目: 横方向に流れる波状の線
  for (var i = 0; i < 80; i++) {
    var y0 = rng() * 512, amp = 1 + rng() * 3, per = 120 + rng() * 220, ph = rng() * 6.28;
    c.beginPath();
    for (var x = 0; x <= 512; x += 8) {
      var y = y0 + Math.sin(x / per * 6.28 + ph) * amp;
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = 'rgba(' + (88 + (rng() * 40) | 0) + ',' + (56 + (rng() * 26) | 0) + ',20,' + (0.05 + rng() * 0.13).toFixed(3) + ')';
    c.lineWidth = 0.6 + rng() * 2.2;
    c.stroke();
  }
  // 板の継ぎ目
  [0, 170, 341].forEach(function (y) {
    c.fillStyle = 'rgba(70,44,18,0.35)'; c.fillRect(0, y, 512, 2);
    c.fillStyle = 'rgba(255,230,180,0.10)'; c.fillRect(0, y + 2, 512, 1);
  });
  // 節 (ふし)
  for (var k = 0; k < 3; k++) {
    var kx = 60 + rng() * 390, ky = 60 + rng() * 390;
    for (var r = 9; r > 1; r -= 2) {
      c.beginPath();
      c.ellipse(kx, ky, r * 1.5, r, 0.3, 0, 6.29);
      c.strokeStyle = 'rgba(80,50,20,' + (0.10 + (9 - r) * 0.02).toFixed(3) + ')';
      c.lineWidth = 1.4;
      c.stroke();
    }
  }
  woodPattern = sctx.createPattern(cv, 'repeat');
  return woodPattern;
}
function drawDeskBackground(v) {
  var pat = null;
  try { pat = getWoodPattern(); } catch (e) { pat = null; }
  if (pat) {
    if (pat.setTransform && typeof DOMMatrix !== 'undefined') {
      try { pat.setTransform(new DOMMatrix([v.scale, 0, 0, v.scale, v.tx, v.ty])); } catch (e) { /* 対応外環境では素のタイリング */ }
    }
    sctx.fillStyle = pat;
  } else {
    sctx.fillStyle = '#a87f4e';
  }
  sctx.fillRect(0, 0, stageW, stageH);
  // 机全体にゆるい陰影をつけて天板らしくする
  var vg = sctx.createRadialGradient(stageW / 2, stageH / 2, Math.min(stageW, stageH) * 0.35, stageW / 2, stageH / 2, Math.max(stageW, stageH) * 0.75);
  vg.addColorStop(0, 'rgba(255,240,210,0.07)');
  vg.addColorStop(1, 'rgba(40,22,4,0.16)');
  sctx.fillStyle = vg;
  sctx.fillRect(0, 0, stageW, stageH);
}

function draw() {
  if (!state || !state.srcCanvas || !state.views[state.surface]) return;
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  var isMat = state.surface === 'mat';
  var v = view(), n = state.n;
  if (isMat) {
    sctx.fillStyle = '#46685a';
    sctx.fillRect(0, 0, stageW, stageH);
  } else {
    drawDeskBackground(v);
  }
  if (isMat) {
    var tl = worldToScreen(0, 0), br = worldToScreen(n * CELL, n * CELL);
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
  if (drag && drag.cluster) ordered = ordered.filter(function (c) { return c !== drag.cluster; }).concat([drag.cluster]);
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
function drawCluster(cl, wTl, wBr) {
  var box = clusterWorldBox(cl);
  if (box.x1 < wTl.x || box.x0 > wBr.x || box.y1 < wTl.y || box.y0 > wBr.y) return;
  var n = state.n, anchor = pieceHome(clusterAnchorId(cl), n), v = view();
  cl.pieces.forEach(function (id) {
    var home = pieceHome(id, n);
    var wx = (cl.gx + (home.col - anchor.col)) * CELL, wy = (cl.gy + (home.row - anchor.row)) * CELL;
    if (wx + CELL * 1.4 < wTl.x || wx - CELL * 0.4 > wBr.x || wy + CELL * 1.4 < wTl.y || wy - CELL * 0.4 > wBr.y) return;
    var bmp = pieceBitmap(id);
    var ratio = (CELL * v.scale) / bmp.cellPx;
    var dx = wx * v.scale + v.tx - bmp.marginPx * ratio;
    var dy = wy * v.scale + v.ty - bmp.marginPx * ratio;
    var sz = bmp.canvas.width * ratio;
    sctx.drawImage(bmp.canvas, dx, dy, sz, sz);
  });
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
var drag = null;         // { cluster, grabDX, grabDY, startSurface, moved }
var pointers = new Map();
var pinch = null;        // { d0, scale0, cx, cy, tx0, ty0 }
var panStart = null;     // { sx, sy, tx, ty }
var zoneHot = false;

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
    var pts = Array.from(pointers.values());
    pinch = {
      d0: Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
      cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2,
      scale0: view().scale, tx0: view().tx, ty0: view().ty
    };
    drag = null; panStart = null;
    return;
  }
  var hit = state.cleared ? null : hitCluster(p.x, p.y);
  if (hit) {
    var w = screenToWorld(p.x, p.y);
    // 掴んだ塊を最前面へ
    state.clusters.splice(state.clusters.indexOf(hit.cluster), 1);
    state.clusters.push(hit.cluster);
    drag = {
      cluster: hit.cluster,
      grabDX: w.x / CELL - hit.cluster.gx, grabDY: w.y / CELL - hit.cluster.gy,
      startSurface: state.surface, moved: false
    };
    startTimerOnce();
    showDropZone(true);
  } else {
    panStart = { sx: p.x, sy: p.y, tx: view().tx, ty: view().ty };
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
    var wx = (pinch.cx - pinch.tx0) / pinch.scale0, wy = (pinch.cy - pinch.ty0) / pinch.scale0;
    v.scale = ns;
    v.tx = cx - wx * ns + (cx - pinch.cx); v.ty = cy - wy * ns + (cy - pinch.cy);
    updateZoomLabel();
    draw();
    return;
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
    draw();
    return;
  }
  if (panStart) {
    view().tx = panStart.tx + (p.x - panStart.sx);
    view().ty = panStart.ty + (p.y - panStart.sy);
    draw();
  }
});
function endPointer(ev) {
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) {
    if (drag) finishDrag(ev);
    panStart = null;
    showDropZone(false);
    zoneHot = false;
  }
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

function finishDrag(ev) {
  var cl = drag.cluster;
  var wasMoved = drag.moved;
  drag = null;
  if (!wasMoved) { draw(); return; }
  state.moves++;
  // 合体処理 (相対スナップ→グリッド吸着→吸着後に正しい相対位置なら確実に合体、まで一括)
  var others = state.clusters.filter(function (c) { return c !== cl; });
  var res = absorbMerges(others, { pieces: cl.pieces, surface: cl.surface, gx: cl.gx, gy: cl.gy }, state.n);
  state.clusters = res.clusters;
  if (res.merged) startMergeFlash(res.cluster.pieces);
  afterBoardChange();
}
function afterBoardChange() {
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
  drag.cluster.surface = state.surface;
  // 切替先でのドロップゾーンは「戻る」方向を案内する
  $('dropZoneLabel').textContent = state.surface === 'desk' ? 'マット' : '机';
  updateSurfaceUI();
  draw();
}
function switchSurface() {
  if (!state || state.phase !== 'play' || uiHome) return;
  state.surface = state.surface === 'desk' ? 'mat' : 'desk';
  updateSurfaceUI();
  draw();
}
function updateSurfaceUI() {
  $('surfaceLabel').textContent = state.surface === 'desk' ? '作業机' : 'パズルマット';
  $('surfaceBtn').textContent = state.surface === 'desk' ? 'マットを開く' : '机に戻る';
  updateZoomLabel();
}
function clampZoom(s) {
  var v = view();
  return Math.max(v.fit, Math.min(v.fit * 4, s));
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
  draw();
}, { passive: false });
var lastTap = 0;
stage.addEventListener('dblclick', function () { zoomBy(1.5); });
stage.addEventListener('touchend', function (ev) {
  var now = Date.now();
  if (now - lastTap < 300) zoomBy(1.5);
  lastTap = now;
});

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
  var colors = ['#0f766e', '#f59e0b', '#dc2626', '#2563eb', '#7c3aed', '#16a34a'];
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
var firstStart = true; // 初回だけ「未開封→スタート画面 / 開始済み→そのまま続きからプレイ」
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
function openDetail(r) {
  $('detailImg').src = 'https://picsum.photos/id/' + r.imageId + '/800/800';
  $('detailText').innerHTML =
    '日付: ' + r.date + '<br>難易度: ' + r.pieces + 'ピース<br>クリアタイム: ' + formatTime(r.bestTimeSec) +
    '<br>手数: ' + (r.moves != null ? r.moves : '-') +
    '<br>完成図: ' + (r.previewViewed ? '見た（' + r.previewCount + '回）' : '見ずにクリア') +
    (r.author ? '<br>作者: ' + r.author : '');
  $('detailPlayBtn').onclick = function () { location.href = '?date=' + r.date; };
  $('detailModal').hidden = false;
}

/* ---------- コントロール配線 ---------- */
function buildDifficultySeg() {
  var seg = $('difficultySeg');
  seg.innerHTML = '';
  var labels = { 36: '36 かんたん', 100: '100', 225: '225', 400: '400', 784: '784', 1225: '1225', 2025: '2025 おに' };
  DIFFICULTIES.forEach(function (d) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'seg-btn' + (d === difficulty ? ' active' : '');
    b.textContent = labels[d];
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
  $('settingsDateNext').disabled = playDate >= todayStr;
  $('settingsDateToday').disabled = playDate === todayStr;
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
    showCollection();
  });
  $('settingsHomeBtn').addEventListener('click', function () {
    closeSettings();
    if (state) persistProgress();
    uiHome = true;
    renderStartScreen();
    applyVisibility();
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
  $('settingsDatePrev').addEventListener('click', function () { location.href = '?date=' + addDays(playDate, -1); });
  $('settingsDateNext').addEventListener('click', function () {
    if (playDate < todayStr) location.href = '?date=' + addDays(playDate, 1);
  });
  $('settingsDateToday').addEventListener('click', function () { location.href = location.pathname; });
  $('resumePlayBtn').addEventListener('click', function () {
    uiHome = false;
    applyVisibility();
    updateProgressUI();
    draw();
  });
  $('giftBox').addEventListener('click', openBox);
  $('giftBox').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openBox(); }
  });
  $('collectionBtn').addEventListener('click', showCollection);
  $('collectionBack').addEventListener('click', showPlay);
  $('datePrevBtn').addEventListener('click', function () { location.href = '?date=' + addDays(playDate, -1); });
  $('dateTodayBtn').addEventListener('click', function () { location.href = location.pathname; });
  $('resumeClose').addEventListener('click', function () { $('resumeBanner').hidden = true; });
  document.querySelectorAll('[data-close]').forEach(function (el) {
    el.addEventListener('click', function () {
      $('previewModal').hidden = true;
      $('detailModal').hidden = true;
    });
  });
  $('resultCloseBtn').addEventListener('click', function () { $('resultModal').hidden = true; });
  $('resultCollectionBtn').addEventListener('click', function () { $('resultModal').hidden = true; showCollection(); });
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
function giftFlowerSvg(cx, cy, s) {
  var out = '<g transform="translate(' + cx + ',' + cy + ') scale(' + s + ')">';
  for (var i = 0; i < 5; i++) {
    var a = Math.PI * 2 * i / 5 - Math.PI / 2;
    out += '<circle cx="' + (Math.cos(a) * 5.4).toFixed(1) + '" cy="' + (Math.sin(a) * 5.4).toFixed(1) + '" r="4" fill="#ffd9a0"/>';
  }
  return out + '<circle r="2.6" fill="#fff3d6"/></g>';
}
function giftPatternDef(patternId) {
  var body;
  switch (patternId) {
    case 'dots-red':
      body = '<rect width="36" height="36" fill="#cf3a3a"/><circle cx="9" cy="9" r="5" fill="#ffe9d6"/><circle cx="27" cy="27" r="5" fill="#ffe9d6"/>';
      return '<pattern id="giftPat" width="36" height="36" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'stripes-mint':
      body = '<rect width="28" height="28" fill="#9fd8bd"/><rect width="11" height="28" fill="#eafff3"/>';
      return '<pattern id="giftPat" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' + body + '</pattern>';
    case 'stars-navy':
      body = '<rect width="44" height="44" fill="#24365e"/>' +
        '<polygon points="0,-5 1.5,-1.6 5,-1.6 2.2,1.2 3.2,4.8 0,2.8 -3.2,4.8 -2.2,1.2 -5,-1.6 -1.5,-1.6" transform="translate(12,13)" fill="#ffe9a8"/>' +
        '<polygon points="0,-3.4 1,-1.1 3.4,-1.1 1.5,0.8 2.2,3.3 0,1.9 -2.2,3.3 -1.5,0.8 -3.4,-1.1 -1,-1.1" transform="translate(33,33)" fill="#cfe0ff"/>' +
        '<circle cx="33" cy="10" r="1.6" fill="#ffffff"/><circle cx="8" cy="36" r="1.6" fill="#ffffff"/>';
      return '<pattern id="giftPat" width="44" height="44" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'gingham-pink':
      body = '<rect width="30" height="30" fill="#f9dce6"/><rect width="30" height="15" fill="#f2a7c3" opacity="0.55"/><rect width="15" height="30" fill="#f2a7c3" opacity="0.55"/>';
      return '<pattern id="giftPat" width="30" height="30" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'confetti':
      body = '<rect width="46" height="46" fill="#fdf3d8"/>' +
        '<rect x="6" y="8" width="8" height="3.4" fill="#e4572e" transform="rotate(30 10 10)"/>' +
        '<circle cx="32" cy="12" r="3.2" fill="#2a9d8f"/>' +
        '<rect x="20" y="24" width="3.4" height="9" fill="#4361ee" transform="rotate(-18 22 28)"/>' +
        '<circle cx="38" cy="36" r="2.6" fill="#f4b942"/>' +
        '<rect x="7" y="35" width="7" height="3" fill="#8338ec" transform="rotate(12 10 36)"/>' +
        '<circle cx="14" cy="22" r="2.2" fill="#ef476f"/>';
      return '<pattern id="giftPat" width="46" height="46" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    default: // floral-retro
      body = '<rect width="48" height="48" fill="#d96f4e"/>' + giftFlowerSvg(13, 13, 1) + giftFlowerSvg(36, 36, 0.72) +
        '<circle cx="37" cy="11" r="2" fill="#ffe3b3"/><circle cx="10" cy="38" r="2" fill="#ffe3b3"/>';
      return '<pattern id="giftPat" width="48" height="48" patternUnits="userSpaceOnUse">' + body + '</pattern>';
  }
}
function giftBoxSvg(patternId) {
  function face(points, shade) {
    var s = '<polygon points="' + points + '" fill="url(#giftPat)"/>';
    if (shade > 0) s += '<polygon points="' + points + '" fill="#000000" opacity="' + shade + '"/>';
    return s + '<polygon points="' + points + '" fill="none" stroke="rgba(60,30,10,0.35)" stroke-width="1"/>';
  }
  return '<svg viewBox="0 0 416 190" role="img" aria-label="包装されたパズルの箱">' +
    '<defs>' + giftPatternDef(patternId) + '</defs>' +
    '<ellipse cx="208" cy="170" rx="168" ry="13" fill="rgba(0,0,0,0.28)"/>' +
    face('316,128 352,84 352,114 316,158', 0.30) +  /* 右側面 */
    face('64,128 316,128 316,158 64,158', 0.16) +   /* 正面 */
    face('316,121 352,77 352,84 316,128', 0.22) +   /* 蓋の右縁 */
    face('64,121 316,121 316,128 64,128', 0.08) +   /* 蓋の前縁 */
    face('100,77 352,77 316,121 64,121', 0) +       /* 蓋の上面 */
    '</svg>';
}
/* 箱タップ → 暗転 → ぶちまけたあとの作業机から開始 (開封アニメーションは無し)。
 * 開封自体はタイマーを開始しない (タイマーは最初のピースを掴んだとき)。 */
function openBox() {
  if (!state || state.phase !== 'box' || state.opening) return;
  state.opening = true;
  var veil = $('fadeVeil');
  veil.classList.add('on');
  setTimeout(function () {
    if (!state) return;
    state.clusters = initialScatter(playDate, difficulty);
    state.gameStarted = true;
    state.phase = 'play';
    uiHome = false;
    persistProgress();
    applyVisibility();
    updateProgressUI();
    draw();
    veil.classList.remove('on');
    state.opening = false;
  }, 300);
}

/* スタート画面の表示内容: 未開封なら箱、開始済みなら「つづきから」パネル */
function renderStartScreen() {
  if (!state) return;
  var startedAlready = state.gameStarted;
  $('giftBox').innerHTML = giftBoxSvg(boxPatternForDate(playDate).id);
  $('giftBox').hidden = startedAlready;
  $('startHint').hidden = startedAlready;
  $('resumePanel').hidden = !startedAlready;
  if (startedAlready) {
    var pos = piecePositions(state.clusters, state.n);
    var onMat = 0;
    pos.forEach(function (p) { if (p.surface === 'mat') onMat++; });
    $('resumeInfo').textContent = difficulty + 'ピース ・ マットに置いたピース ' + onMat + ' / ' + difficulty + ' ・ ' + formatTime(currentElapsed());
  }
}

/* ---------- ゲーム開始 ---------- */
function startGame(pool) {
  state = newGameState(pool);
  buildDifficultySeg();
  if (firstStart) { uiHome = state.phase === 'box'; firstStart = false; }
  // スタート画面: 未開封なら包装された箱 (柄は日付で決定的)、開始済みなら続きからパネル
  renderStartScreen();
  $('fadeVeil').classList.remove('on');
  var d = new Date(dateToMs(playDate));
  $('themeDateLabel').textContent = d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日のお題';
  $('dateTodayBtn').hidden = playDate === todayStr;
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
    startGame(pool);
    resizeStage();
  })
  .catch(function () {
    $('themeDateLabel').textContent = '画像プールの読み込みに失敗しました';
    $('loadingOverlay').textContent = 'data/images.json を読み込めませんでした';
  });
})();
}
