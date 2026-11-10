'use strict';
/* Daily Jigsaw (まいにちジグソー)
 * バニラJS・ビルドなし。前半は純粋ロジック (Node からも import 可能)、後半がブラウザUI。
 */

/* ================= 純粋ロジック ================= */

var BASE_DATE_FALLBACK = '2026-11-07';
var DIFFICULTIES = [16, 36, 64, 100, 225, 400, 1024]; // 2025/784/1225 は廃止。2グループ制に合わせて 64 と 1024 (32x32) を追加 (2026-11-08)
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

/* ---- お題決定: (対象日 - 基準日) をプールで引く ----
 * 2026-11-08 からは難易度グループ制: 2グループ ([16,36,64] / [100,225,400,1024])
 * ごとに別のお題を割り当てる (pickPoolEntry の group 引数)。グループなしの
 * 呼び出しは従来の日付のみ選択 (旧バージョンで開始した進行中ゲームの維持用)。
 * プール (data/images.json) はエントリ配列形式:
 *   { type:'picsum', id } — Lorem Picsum の写真
 *   { type:'url', key, title, source, thumbUrl, fullUrl, license, attribution }
 *     — 厳選した外部オープンコレクション (Wikimedia / Met / Cleveland)。
 *     key は curation/round2.json のインデックスで、安定キーは 'u' + key。
 * 旧形式 { ids:[...] } も poolEntries が picsum エントリとして読む。 */
function poolEntries(pool) {
  if (!pool) return [];
  if (Array.isArray(pool.entries)) return pool.entries;
  if (Array.isArray(pool.ids)) return pool.ids.map(function (id) { return { type: 'picsum', id: id }; });
  return [];
}
/* 難易度グループ: 同じグループの難易度は同じお題 (画像) を共有する。
 * 2グループ制 (2026-11-08): [16,36,64]→0 / [100,225,400,1024]→1。
 * 旧 1225 はグループ1扱い (進行中ゲームの維持用)、未知の値 (旧 784 など) は 0。 */
function difficultyGroup(pieces) {
  if (pieces === 100 || pieces === 225 || pieces === 400 || pieces === 1024 || pieces === 1225) return 1;
  return 0;
}
/* 装飾ティア: 難易度 ladder の絶対位置で額装飾と ★ の色が変わる
 * (2026-11-09 ステージ制への転換に合わせ再設計。旧2グループ内の順位制は廃止)。
 * 100 = 'bronze' (銅)、225 = 'silver' (銀)、400 = 'gold' (金)、
 * 最上位 (1024) = 'royal' (金 + 全周ライン)。旧 1225 は 'gold' 扱いで維持。
 * 対象外 (16 / 36 / 64) は null。 */
function frameTier(pieces) {
  if (pieces === 1024) return 'royal';
  if (pieces === 400 || pieces === 1225) return 'gold';
  if (pieces === 225) return 'silver';
  if (pieces === 100) return 'bronze';
  return null;
}
/* 装飾ティア対象か (旧称「上級」)。銀・金・特別装飾いずれかの記録に付く */
function isUpperTier(pieces) {
  return frameTier(pieces) !== null;
}
function pickPoolEntry(dateStr, pool, group) {
  var entries = poolEntries(pool);
  if (!entries.length) return null;
  var days = daysBetween(dateStr, pool.baseDate || BASE_DATE_FALLBACK);
  /* グループ指定時は (日数×2 + グループ) で引く: 同じ日でもグループごとに
   * 別のお題になり、グループ内では同じお題を共有する。
   * 省略時は従来どおり日数だけで引く (旧バージョン互換)。 */
  var raw = typeof group === 'number' ? days * 2 + group : days;
  var idx = ((raw % entries.length) + entries.length) % entries.length;
  return entries[idx];
}
/* 旧 API 互換: picsum エントリのときだけ ID を返す (URL エントリは null) */
function pickImageId(dateStr, pool) {
  var e = pickPoolEntry(dateStr, pool);
  return e && e.type === 'picsum' ? e.id : null;
}
/* エントリの安定キー: picsum は 'p' + id、URL は 'u' + key */
function poolEntryKey(entry) {
  if (!entry) return null;
  return entry.type === 'picsum' ? 'p' + entry.id : 'u' + entry.key;
}
function poolEntryByKey(pool, key) {
  var entries = poolEntries(pool);
  for (var i = 0; i < entries.length; i++) if (poolEntryKey(entries[i]) === key) return entries[i];
  return null;
}
/* コレクション記録 → 安定キー。旧記録 (数値 imageId のみ) は 'p'+id として読む */
function recordImageKey(rec) {
  if (!rec) return null;
  if (typeof rec.imageKey === 'string' && rec.imageKey) return rec.imageKey;
  if (typeof rec.imageId === 'number') return 'p' + rec.imageId;
  return null;
}
/* ---------- ステージ制 (2026-11-09 転換) ----------
 * お題は日替わり/ラウンド制をやめ、ステージ順に何個でも進める。
 * ステージ S (1始まり) のお題はプールの並びで決まる: 1周目はプール順、
 * 2周目以降は周回ごとの決定的シャッフル順 (全ステージ制覇で次の周へ)。
 * ステージの「日付キー」は従来の仮想日付 (基準日 + S-1日) を流用し、
 * 記録・進捗のキー互換を保つ (表示には使わない)。 */
function stageDate(stage) { return addDays(BASE_DATE_FALLBACK, Math.max(1, Math.floor(stage) || 1) - 1); }
function stageCycle(stage, poolLen) { return poolLen > 0 ? Math.floor((Math.max(1, stage) - 1) / poolLen) : 0; }
function stageOrderForCycle(cycle, poolLen) {
  var order = [];
  for (var i = 0; i < poolLen; i++) order.push(i);
  if (cycle <= 0 || poolLen <= 1) return order;
  var rng = rngFromString('stage-cycle:' + cycle + ':' + poolLen);
  for (var j = poolLen - 1; j > 0; j--) {
    var k = Math.floor(rng() * (j + 1));
    var t = order[j]; order[j] = order[k]; order[k] = t;
  }
  return order;
}
function stageEntryIndex(stage, poolLen) {
  if (poolLen <= 0) return -1;
  var pos = (Math.max(1, stage) - 1) % poolLen;
  return stageOrderForCycle(stageCycle(stage, poolLen), poolLen)[pos];
}
function stageEntry(stage, pool) {
  var entries = poolEntries(pool);
  var idx = stageEntryIndex(stage, entries.length);
  return idx >= 0 ? entries[idx] : null;
}
/* 記録 → ステージ番号。新記録は rec.stage を持ち、旧記録は画像キーの
 * 1周目の位置から復元する (どちらも無ければ日付キーから) */
function recordStage(rec, pool) {
  if (!rec) return null;
  if (typeof rec.stage === 'number' && rec.stage >= 1) return Math.floor(rec.stage);
  var key = recordImageKey(rec);
  if (key) {
    var entries = poolEntries(pool);
    for (var i = 0; i < entries.length; i++) if (poolEntryKey(entries[i]) === key) return i + 1;
  }
  if (rec.date) return Math.max(1, daysBetween(rec.date, BASE_DATE_FALLBACK) + 1);
  return null;
}
function clearedStages(records, pool) {
  var set = new Set();
  (records || []).forEach(function (r) { var s = recordStage(r, pool); if (s) set.add(s); });
  return set;
}
/* 最新の未挑戦ステージ = クリア済みでない最小のステージ番号 */
function nextStage(records, pool) {
  var done = clearedStages(records, pool);
  var s = 1;
  while (done.has(s)) s++;
  return s;
}
function unlockedImageKeys(records) {
  var set = new Set();
  (records || []).forEach(function (r) { var k = recordImageKey(r); if (k) set.add(k); });
  return set;
}
/* 箱の包装柄はステージ番号で回す (従来の日付×グループは廃止) */
function stageBoxPatternIndex(stage) {
  var raw = Math.max(1, Math.floor(stage) || 1) - 1;
  return ((raw % BOX_PATTERNS.length) + BOX_PATTERNS.length) % BOX_PATTERNS.length;
}
/* プレイ用 (正方形・難易度サイズ) の画像 URL。URL エントリは fullUrl 固定 */
function entryPhotoUrl(entry, size) {
  if (!entry) return null;
  if (entry.type === 'picsum') return 'https://picsum.photos/id/' + entry.id + '/' + size + '/' + size;
  return entry.fullUrl || entry.thumbUrl || null;
}
/* サムネイル (コレクション/写真立て用・正方形 400px 級) の URL */
function entryThumbUrl(entry) {
  if (!entry) return null;
  if (entry.type === 'picsum') return 'https://picsum.photos/id/' + entry.id + '/400/400';
  return entry.thumbUrl || entry.fullUrl || null;
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
 * 輪郭 = 直線部 + 3次ベジェ8本。頭は「楕円」(横半径 headHalf、中心は高さ
 * 0.65t、縦半径 0.35t) で定義し、最広点から 30° 下の接合点で輪郭に合流する。
 * 付け根→首は凹フィレット、首→接合点は変曲のある S 字でつなぎ、全ての継ぎ目で
 * 接線を一致させる (G1 連続)。幅プロファイルは「付け根 → 首 (最小) → 頭 (最大)
 * → 頂」の単峰型になるよう寸法を決めている。
 * 古典的ノブの寸法 (セル比・全幅、実測値): 頭 ≈0.22〜0.24 / 首 ≈0.16〜0.19
 * (頭の 0.74〜0.78 倍、頭/首比 ≈1.29〜1.34) / 付け根の遷移幅 ≈0.32〜0.34 /
 * 高さ ≈0.16〜0.24。headHalf / neckHalf / filletHalf は曲線が実際に通る半幅。
 *
 * 【旧実装の不具合1 (2026-11-08 実測で判明)】最初期の edgeSegments はノブ本体を
 * 「首→首を結ぶ1本のベジェ」で描き、制御点だけを headHalf 位置に置いていた。
 * ベジェ曲線は制御点に届かないため、引数の headHalf (半幅 0.14〜0.21) に
 * 対して実際の頭幅は全幅 0.13〜0.20 しかなく、逆に付け根は xs = c-headHalf-0.06
 * から始まるため遷移幅が全幅 0.40 (最大 0.84) に及んだ。結果として
 * 「広い裾がなだらかに細くなり、細い首の上に小さな頭が乗る」垂れた形になり、
 * 実機で「タブが細長く垂れる・首が極端に細い」と見えていた。
 * 【旧実装の不具合2 (同日、5ベジェ版)】節点を曲線上の点に直したが、頭の側面の
 * 制御点を headHalf+0.02 まで外へ張り出させて「頭の下のえぐれ」を作ったため、
 * 首の上に別パーツの笠が乗ったような二段変形 (頭の下にもう一つの膨らみ) に
 * なり、「鏡餅みたい」と却下された。現行は楕円＋S字フィレットで単一ノブ化。
 * 【旧実装の不具合3 (同日、端点のバリ)】edgeSegments の端点を start=(0, s*a) /
 * end=(1, s*e) とし、辺の端点自体を直線 (v=0) からジッター分ずらしていた。
 * 角では横辺の終端と縦辺の始端が一致せず、輪郭に段差が残った (実測: |a|/|e|
 * は最大 0.045・中央値 0.022、角の接続ギャップは最大 0.063・中央値 0.035)。
 * Draradech 原法どおり端点は必ず角 (0,0)/(1,0) に一致させ、a/e は付け根
 * フィレットの基部高さ ha=a*0.3 / he=e*0.3 としてのみ効かせる。
 * 個体差: t (高さ 0.8〜1.2倍)、b (中心のずれ ±0.15)、a/c/d/e (制御点ジッター数%)。
 */
function genEdge(rng) {
  function jit() { return (rng() * 2 - 1) * JITTER; }
  var sign = rng() < 0.5 ? 1 : -1;
  var t = TABSIZE * (0.8 + rng() * 0.4);          // ノブ高さ 0.16〜0.24
  var b = (rng() * 2 - 1) * 0.15;                  // ノブ中心のずれ ±15%
  var a = jit(), c = jit(), d = jit(), e = jit();
  // 頭・首・付け根は曲線が実際に通る半幅。首は頭の 0.74〜0.78 倍に保ち、
  // 細い首＋笠状の頭という二段変形にならない寸法にする
  var headHalf = 0.115 + c * 0.11;                 // 頭の横半径 (半幅 0.110〜0.120、全幅 ≈0.22〜0.24)
  var neckHalf = headHalf * (0.76 + d * 0.35);     // 首の半幅 (頭の 0.744〜0.776 倍)
  var filletHalf = headHalf + 0.052;               // 付け根遷移の半幅 (全幅 ≈0.32〜0.34)
  // ノブが辺からはみ出さない保証: 付け根の半幅 + |ずれ| + 余白 < 0.5
  var maxShift = 0.5 - filletHalf - 0.02;
  if (Math.abs(b) > maxShift) b = Math.sign(b) * Math.max(0, maxShift);
  return { sign: sign, t: t, a: a, b: b, c: c, d: d, e: e, headHalf: headHalf, neckHalf: neckHalf, filletHalf: filletHalf };
}
/* 辺のベジェ区間列を返す。start: {u,v}, segs: [{x1,y1,x2,y2,x3,y3}] (終点のみ保持)
 * 構成 (左→右): 付け根フィレット → 首→接合 (S字) → 楕円弧 (接合→最広→頂→
 * 最広→接合) → 接合→首 (S字) → 付け根フィレット。節点は全て曲線上の点で、
 * 首では鉛直接線、接合点・最広点・頂点では楕円の接線に制御点を揃える (G1)。
 * 高さ方向の節点: 首 0.375t / 接合 0.475t / 最広 (= 楕円中心) 0.65t / 頂 1.0t。
 * start=(0,0) / end=(1,0) は角に完全一致させる (端点にジッターを持たせない)。 */
function edgeSegments(edge) {
  var s = edge.sign, t = edge.t;
  var c = 0.5 + edge.b;
  var Rh = edge.headHalf, nh = edge.neckHalf, bx = edge.filletHalf;
  var cx = c + edge.c * 0.3;                    // 頭楕円の中心 u (微小チルト)
  var yc = t * 0.65, Rv = t * 0.35;             // 楕円の中心高さ・縦半径 (頂 = yc+Rv = t)
  var PHI = Math.PI / 6;                        // 接合点は最広点から 30° 下
  var hj = yc - Rv * Math.sin(PHI);             // 接合点の高さ = 0.475t
  var h1 = hj - t * 0.10;                       // 首の高さ = 0.375t
  var ha = edge.a * 0.3, he = edge.e * 0.3;     // 付け根の高さ (直線部の傾きを引き継ぐ)
  // 楕円パラメータ点と、θ 減少方向 (= 輪郭の進行方向) の接線ベクトル
  function P(th) { return { u: cx + Rh * Math.cos(th), h: yc + Rv * Math.sin(th) }; }
  function D(th) { return { u: Rh * Math.sin(th), h: -Rv * Math.cos(th) }; }
  // 楕円弧 θA→θB (θA>θB) を1本のベジェで近似 (制御点は両端の接線上)
  function arc(thA, thB) {
    var k = (4 / 3) * Math.tan((thA - thB) / 4);
    var pA = P(thA), pB = P(thB), dA = D(thA), dB = D(thB);
    return { x1: pA.u + k * dA.u, y1: pA.h + k * dA.h, x2: pB.u - k * dB.u, y2: pB.h - k * dB.h, x3: pB.u, y3: pB.h };
  }
  var THJ = Math.PI + PHI, THJR = -PHI;         // 接合点のパラメータ角 (左 210° / 右 -30°)
  var J = P(THJ), JR = P(THJR);
  var NL = { u: cx - nh, h: h1 }, NR = { u: cx + nh, h: h1 };
  var BL = { u: c - bx, h: ha }, BR = { u: c + bx, h: he };
  var g2 = 0.38;                                // 接合点での接線方向の制御点距離係数
  var dJ = D(THJ), dJR = D(THJR);
  var segsH = [
    // 付け根 (左): ベースから首へ絞る凹フィレット (首側は鉛直接線で受ける)
    { x1: BL.u + 0.62 * (NL.u - BL.u), y1: BL.h + 0.30 * (NL.h - BL.h), x2: NL.u, y2: NL.h - 0.42 * (NL.h - BL.h), x3: NL.u, y3: NL.h },
    // 首→接合 (左): 鉛直に立ち上がり、楕円の接線に滑らかに合流する S 字
    { x1: NL.u, y1: NL.h + 0.45 * (J.h - NL.h), x2: J.u - g2 * dJ.u, y2: J.h - g2 * dJ.h, x3: J.u, y3: J.h },
    arc(THJ, Math.PI),                          // 接合→最広 (左)
    arc(Math.PI, Math.PI / 2),                  // 最広→頂 (左)
    arc(Math.PI / 2, 0),                        // 頂→最広 (右)
    arc(0, THJR),                               // 最広→接合 (右)
    // 接合→首 (右): 左の S 字と対称
    { x1: JR.u + g2 * dJR.u, y1: JR.h + g2 * dJR.h, x2: NR.u, y2: NR.h + 0.45 * (JR.h - NR.h), x3: NR.u, y3: NR.h },
    // 付け根 (右): 首からベースへ戻る凹フィレット
    { x1: NR.u, y1: NR.h - 0.42 * (NR.h - BR.h), x2: BR.u - 0.62 * (BR.u - NR.u), y2: BR.h + 0.30 * (NR.h - BR.h), x3: BR.u, y3: BR.h }
  ];
  var segs = segsH.map(function (sg) {
    return { x1: sg.x1, y1: s * sg.y1, x2: sg.x2, y2: s * sg.y2, x3: sg.x3, y3: s * sg.y3 };
  });
  return { start: { u: 0, v: 0 }, lineTo: { u: BL.u, v: s * ha }, segs: segs, end: { u: 1, v: 0 } };
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
 * 塊 (cluster) = { pieces:[id...], surface:'desk', gx, gy }
 * (gx, gy) は塊の anchor ピース (id最小) が置かれているグリッド座標。
 * ピース id = row * n + col, ホーム座標 = (col, row)。
 * 面は机1つだけ (2026-11-08 にマット概念を廃止)。盤面は机ワールドの
 * [0,n]×[0,n] の領域で、旧マット座標と一致する。surface フィールドは
 * 旧セーブ互換のために残すが常に 'desk' で、判定には使わない。
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
 * 辺だけが接する場合は交差とみなさない。 */
function clustersInRect(clusters, n, rect) {
  var pos = piecePositions(clusters, n);
  return clusters.filter(function (cl) {
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

/* 塊のピースが占めるセル範囲 (gx/gy はアンカーピース = 最小 id の位置)。
 * maxX/maxY は排他 (ピースは [gx, gx+1) の正方形として扱う) */
function clusterCellBounds(cluster, n) {
  var anchor = pieceHome(clusterAnchorId(cluster), n);
  var minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  cluster.pieces.forEach(function (id) {
    var h = pieceHome(id, n);
    if (h.col < minC) minC = h.col;
    if (h.col > maxC) maxC = h.col;
    if (h.row < minR) minR = h.row;
    if (h.row > maxR) maxR = h.row;
  });
  return {
    minX: cluster.gx + (minC - anchor.col), maxX: cluster.gx + (maxC - anchor.col) + 1,
    minY: cluster.gy + (minR - anchor.row), maxY: cluster.gy + (maxR - anchor.row) + 1
  };
}
/* 塊全体が rect (セル単位) に収まるよう gx/gy を平行移動クランプした値を返す。
 * 塊の内部配置は変えない。収まっている場合は入力と同じ値になる (机の有限化) */
function clampClusterToRect(cluster, n, rect) {
  var b = clusterCellBounds(cluster, n);
  var gx = cluster.gx, gy = cluster.gy;
  if (b.minX < rect.x0) gx += rect.x0 - b.minX;
  else if (b.maxX > rect.x0 + rect.w) gx -= b.maxX - (rect.x0 + rect.w);
  if (b.minY < rect.y0) gy += rect.y0 - b.minY;
  else if (b.maxY > rect.y0 + rect.h) gy -= b.maxY - (rect.y0 + rect.h);
  return { gx: gx, gy: gy };
}
/* 塊の配列を rect 内へ正規化する (平行移動のみ)。変わらない塊は同じ
 * オブジェクトのまま返るため冪等で、範囲内のセーブは完全一致する */
function normalizeClustersToRect(clusters, n, rect) {
  return clusters.map(function (cl) {
    var c = clampClusterToRect(cl, n, rect);
    if (c.gx === cl.gx && c.gy === cl.gy) return cl;
    return { pieces: cl.pieces, surface: cl.surface, gx: c.gx, gy: c.gy };
  });
}
/* 複数の塊の和集合が rect に収まる平行移動量 (グループドラッグ/運搬用) */
function clampClustersTranslation(clusters, n, rect) {
  if (!clusters.length) return { dx: 0, dy: 0 };
  var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  clusters.forEach(function (cl) {
    var b = clusterCellBounds(cl, n);
    if (b.minX < minX) minX = b.minX;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxY > maxY) maxY = b.maxY;
  });
  var dx = 0, dy = 0;
  if (minX < rect.x0) dx = rect.x0 - minX;
  else if (maxX > rect.x0 + rect.w) dx = (rect.x0 + rect.w) - maxX;
  if (minY < rect.y0) dy = rect.y0 - minY;
  else if (maxY > rect.y0 + rect.h) dy = (rect.y0 + rect.h) - maxY;
  return { dx: dx, dy: dy };
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

/* 机の境界 (机の有限化の可動範囲): 散らばり領域を中心から縦横4倍に
 * 広げた矩形 (ユーザー指示 2026-11-10: ×2→まだ狭い→×4 で確定)。
 * 境界の外は drawDeskBoundary のベールで暗く見える化するので、
 * 運べないエリアが見て分かる。初期散らばりと fit は散らばり領域のまま */
var DESK_BOUNDS_FACTOR = 4;
function deskBounds(pieces) {
  var r = scatterRect(pieces);
  var ex = r.w * (DESK_BOUNDS_FACTOR - 1) / 2, ey = r.h * (DESK_BOUNDS_FACTOR - 1) / 2;
  return { x0: r.x0 - ex, y0: r.y0 - ey, w: r.w * DESK_BOUNDS_FACTOR, h: r.h * DESK_BOUNDS_FACTOR };
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

/* スタート画面の箱の包装柄 (完成写真は載せない)。日付×難易度グループで決定的に決まる */
var BOX_PATTERNS = [
  { id: 'dots-red', name: '生成りに細ドット' },
  { id: 'stripes-mint', name: '細ストライプ' },
  { id: 'stars-navy', name: '紺に小星' },
  { id: 'gingham-pink', name: '細ギンガム' },
  { id: 'confetti', name: '小紋' },
  { id: 'floral-retro', name: '小花' },
  { id: 'plaid', name: '格子' },
  { id: 'hearts', name: 'ハート' },
  { id: 'moons', name: '月と星' },
  { id: 'leaves', name: '葉っぱ' },
  { id: 'waves', name: '青海波' },
  { id: 'triangles', name: '三角' },
  { id: 'diamonds', name: 'ダイヤ' },
  { id: 'snow', name: '雪の結晶' },
  { id: 'sakura', name: '花びら' },
  { id: 'clouds', name: '雲' },
  { id: 'checkers', name: '市松' },
  { id: 'music', name: '音符' },
  { id: 'polka-big', name: '大ドット' },
  { id: 'grid', name: '方眼' }
];
/* グループ指定時は (日数×2 + グループ) で引く (お題画像のグループ選択と同じリズム):
 * 同じ日でもグループごとに別の柄になり、翌日は全グループの柄が変わる。
 * 省略時は従来どおり日数だけで引く (旧バージョン互換)。 */
function boxPatternIndex(dateStr, group) {
  var days = daysBetween(dateStr, BASE_DATE_FALLBACK);
  var raw = typeof group === 'number' ? days * 2 + group : days;
  return ((raw % BOX_PATTERNS.length) + BOX_PATTERNS.length) % BOX_PATTERNS.length;
}
function boxPatternForDate(dateStr, group) { return BOX_PATTERNS[boxPatternIndex(dateStr, group)]; }

/* 完成判定 (内部のみ): 全ピースが1つの塊につながった瞬間が完成。
 * 相対スナップの合体は正しい隣接関係でしか起きないので、1つの塊に
 * なった時点で絵は正しく組み上がっている (位置は問わない) */
function isComplete(clusters, n) {
  return clusters.length === 1 && clusters[0].pieces.length === n * n;
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
/* ---- 机テクスチャのタイル敷き (描画オフセット計算) ----
 * テクスチャタイルはワールド座標に固定して敷く (パン/ズームで机の上を動く感触)。
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

/* ---- 机背景の世界空間キャッシュ (純粋計算) ----
 * 旧方式は「画面全体・カメラ込みキー」のキャッシュで、カメラが動くたびに
 * 画面全体を手続き描画し直していた。Firefox Android ではジェスチャ中の
 * その毎フレーム再生成が重なり、背景が横縞に化ける/潰れる表示崩れが出た。
 * 新方式はカメラに依存しない「ワールド空間・固定解像度」のキャッシュにし、
 * 毎フレームは部分転写 (drawImage) だけで済ませる。転写は deskBgBlit が
 * 「整数アラインしたソース矩形 + 等倍率のデスト矩形」で返すため、
 * 引き伸ばし/潰れ (異方スケール) が構造的に起こらない。キャッシュ範囲を
 * 出たカメラでは null を返し、呼び出し側が直接描画にフォールバックする。 */

/* キャッシュが覆う範囲 (セル単位)。机の fit は散らばり領域で決まるが、
 * 画面のアスペクトが領域と違うと、fit 表示でも領域の外まで見える
 * (例: 縦長スマホでは上下に大きくはみ出す)。さらに最小ズーム (fit×0.5)
 * では見える範囲が各辺 2 倍になる。そこで「現在のステージで最小ズーム・
 * 中心 = 散らばり中心のときに見える範囲」を 1 割の余白つきで覆う。
 * 範囲はテーマ・難易度・ステージ寸法だけで決まり、カメラには依存しない
 * (ステージ寸法の変化はリサイズ時だけなので再生成は稀)。 */
function deskBgRegionCells(pieces, stageW, stageH, cellUnits) {
  var s = scatterRect(pieces);
  var fit = Math.min(stageW / (s.w * cellUnits), stageH / (s.h * cellUnits));
  if (!(fit > 0)) {
    var mx0 = Math.ceil(s.w * 0.6), my0 = Math.ceil(s.h * 0.6);
    return { x0: s.x0 - mx0, y0: s.y0 - my0, w: s.w + mx0 * 2, h: s.h + my0 * 2 };
  }
  var visW = 2 * stageW / (fit * cellUnits), visH = 2 * stageH / (fit * cellUnits); // 最小ズームで見える幅・高さ (セル)
  var w = Math.max(s.w, visW) * 1.1, h = Math.max(s.h, visH) * 1.1;
  var cx = s.x0 + s.w / 2, cy = s.y0 + s.h / 2;
  return { x0: Math.floor(cx - w / 2), y0: Math.floor(cy - h / 2), w: Math.ceil(w), h: Math.ceil(h) };
}

/* キャッシュの解像度計画: 目標 1.5 px/ワールド単位を上限に、最大寸法
 * maxDim・最大面積 maxArea (px) の両方に収まる解像度 R を決める。
 * 収まりきらない/細かすぎる場合は null (キャッシュを使わない)。 */
function deskBgPlan(regionW, regionH, maxDim, maxArea) {
  if (!(regionW > 0) || !(regionH > 0) || !(maxDim > 0) || !(maxArea > 0)) return null;
  var R = Math.min(1.5, maxDim / regionW, maxDim / regionH, Math.sqrt(maxArea / (regionW * regionH)));
  if (!(R >= 0.05)) return null;
  var wPx = Math.min(maxDim, Math.max(1, Math.ceil(regionW * R)));
  var hPx = Math.min(maxDim, Math.max(1, Math.ceil(regionH * R)));
  return { R: R, wPx: wPx, hPx: hPx };
}

/* カメラ v でステージ (stageW × stageH, CSS px) に机背景キャッシュを
 * 貼るための矩形。region はワールド単位 {x0, y0, w, h}、plan は deskBgPlan
 * の結果。見えているワールド範囲がキャッシュ範囲に完全に収まるときだけ
 * 矩形を返し、はみ出す場合は null (直接描画フォールバック)。
 * sx/sy/sw/sh はキャッシュ側 px (整数)、dx/dy/dw/dh は CSS px。
 * dw/sw と dh/sh はどちらも v.scale / R に一致する (等倍率を保証)。 */
function deskBgBlit(v, stageW, stageH, region, plan) {
  if (!v || !plan || !(v.scale > 0) || !(stageW > 0) || !(stageH > 0)) return null;
  var vx0 = (0 - v.tx) / v.scale, vy0 = (0 - v.ty) / v.scale;
  var vx1 = (stageW - v.tx) / v.scale, vy1 = (stageH - v.ty) / v.scale;
  if (vx0 < region.x0 || vy0 < region.y0 || vx1 > region.x0 + region.w || vy1 > region.y0 + region.h) return null;
  var R = plan.R;
  var sx = Math.floor((vx0 - region.x0) * R), sy = Math.floor((vy0 - region.y0) * R);
  var ex = Math.ceil((vx1 - region.x0) * R), ey = Math.ceil((vy1 - region.y0) * R);
  if (sx < 0) sx = 0; if (sy < 0) sy = 0;
  if (ex > plan.wPx) ex = plan.wPx; if (ey > plan.hPx) ey = plan.hPx;
  var sw = ex - sx, sh = ey - sy;
  if (sw <= 0 || sh <= 0) return null;
  return {
    sx: sx, sy: sy, sw: sw, sh: sh,
    dx: (region.x0 + sx / R) * v.scale + v.tx, dy: (region.y0 + sy / R) * v.scale + v.ty,
    dw: sw / R * v.scale, dh: sh / R * v.scale
  };
}

/* ---- ピースビットマップの健全性チェック (純粋判定) ----
 * ピースの写真面は必ず不透明なので、ビットマップ中心部の alpha が
 * すべて 0 なら「描いたはずなのに中身が無い」異常 (ブラウザ側で
 * キャンバスの実体が失われた等)。その判定と、作り直しのポリシーを
 * ここに切り出してテスト可能にする。 */
function bitmapProbeOk(alphas) {
  if (!alphas || !alphas.length) return false;
  for (var i = 0; i < alphas.length; i++) if (alphas[i] > 0) return true;
  return false;
}
/* failures = そのピースでプローブが連続失敗した回数 (今回分を含む)。
 * 1回目はその場で即作り直す。数回はキャッシュせず次の描画で再試行し
 * (一時的な喪失なら自然に回復する)、それ以上続く場合は毎フレーム
 * 再生成で固まらないよう諦めてキャッシュする (スポットチェック側で
 * 後から回復を検出できる)。 */
function bitmapRetryPlan(failures) {
  if (failures <= 1) return { retryNow: true, giveUp: false };
  if (failures <= 3) return { retryNow: false, giveUp: false };
  return { retryNow: false, giveUp: true };
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

/* ---- BGM クロスフェード (純粋ロジック) ----
 * 曲の切り替わりでは、前曲をフェードアウトしながら次曲をフェードインする。
 * ゲイン曲線は等パワー (cos / sin) で、重なっている間の合計パワーが
 * 一定になるようにする (線形だと中間で音が痩せて聞こえる)。
 * フェード時間は最長 BGM_FADE_SEC 秒。曲が短い場合は曲長の 1/4 までに
 * 縮め、0.5 秒未満になるような曲ではフェードしない (0 を返す)。 */
var BGM_FADE_SEC = 3;
function crossfadeCurve(t) {
  t = Math.min(1, Math.max(0, typeof t === 'number' && isFinite(t) ? t : 0));
  var a = t * Math.PI / 2;
  return { out: Math.cos(a), in: Math.sin(a) };
}
function crossfadeDuration(durationSec) {
  if (typeof durationSec !== 'number' || !isFinite(durationSec) || durationSec <= 0) return 0;
  var d = Math.min(BGM_FADE_SEC, durationSec / 4);
  return d >= 0.5 ? d : 0;
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

/* スタート画面の箱をタップしたときの動作。箱は進行の有無にかかわらず
 * 常に表示し、未開始なら新規に開封 ('open')、進行中・クリア済みなら
 * そのまま机へ入る ('resume')。散らばし直しは 'open' のときだけ行う。 */
function boxTapAction(prog) {
  return startPanelMode(prog) === 'box' ? 'open' : 'resume';
}

/* ---- クリア報酬インテリア (純粋ロジック) ----
 * 仕様 (2026-11-08 案B「壁だけ」改定。机インテリアは廃止):
 * - その日の初回クリアで 1 日 1 個、未所持から「ランダム抽選」で直接付与する。
 * - 抽選はレア度 (★1 コモン / ★2 レア / ★3 スーパーレア) の重み付き。
 *   重みは RARITY_TABLE に集約する。季節アイテム (months を持つ) は
 *   その月の間だけ抽選対象になる。
 * - インテリアの付与は毎日のランダム抽選のみ。フレームのスタイルは
 *   別枠の「解放報酬」で、累計クリア回数 (store.records.length) で解放する
 *   (黒=5 / 白=10 / 金=20 / アンティーク=35、初期はウォルナットのみ)。
 *   解放した分は wall.pendingUnlocks に積み、通知で確認されるまで残す。
 * - 付与した id は wall.pending に積み、スタート画面の通知から開く
 *   リビールで確認されるまで残る (壁画面を開いたときも解消する)。
 * - 保存は store.wall (normalizeWall で形を保証)。旧・机インテリアの
 *   store.rewards はもう使わない (保存データ自体は消さず読み捨てる)。
 * カタログは wall-items/catalog.json と同期 (50 点)。
 * 画像は wall-items/<id>.webp (512×512 透過)。
 * 配置は壁に対する比率座標 {x, y} (中心) の配列で保持し、配列順 = 重なり順。
 * 額装パズルは frames に { recordKey, x, y, w, color } で保持する。 */
var RARITY_TABLE = {
  1: { label: '★1', name: 'コモン', weight: 100 },
  2: { label: '★2', name: 'レア', weight: 30 },
  3: { label: '★3', name: 'スーパーレア', weight: 8 }
};
function rarityLabel(item) {
  var r = item && RARITY_TABLE[item.rarity];
  return r ? r.label : '';
}
var WALL_CATALOG = [
  { id: 'w001', name: '桜のリース', cat: 'wreath', size: 'M', rarity: 1, months: [3,4,5] },
  { id: 'w002', name: 'ミモザのリース', cat: 'wreath', size: 'M', rarity: 2 },
  { id: 'w003', name: 'あじさいリース', cat: 'wreath', size: 'M', rarity: 1, months: [6] },
  { id: 'w004', name: 'ひまわりリース', cat: 'wreath', size: 'L', rarity: 1, months: [7,8] },
  { id: 'w005', name: 'バラのリース', cat: 'wreath', size: 'M', rarity: 2 },
  { id: 'w006', name: 'ラベンダーリース', cat: 'wreath', size: 'M', rarity: 1 },
  { id: 'w007', name: 'ユーカリリース', cat: 'wreath', size: 'M', rarity: 1 },
  { id: 'w008', name: 'オリーブのリース', cat: 'wreath', size: 'M', rarity: 1 },
  { id: 'w009', name: '紅葉リース', cat: 'wreath', size: 'M', rarity: 1, months: [10,11] },
  { id: 'w010', name: '松ぼっくりのリース', cat: 'wreath', size: 'M', rarity: 2 },
  { id: 'w011', name: 'コットンフラワーのリース', cat: 'wreath', size: 'M', rarity: 1 },
  { id: 'w012', name: '野花の小リース', cat: 'wreath', size: 'S', rarity: 1 },
  { id: 'w013', name: 'ローズマリーのリース', cat: 'wreath', size: 'S', rarity: 1 },
  { id: 'w014', name: 'ドライフラワーのスワッグ', cat: 'wreath', size: 'M', rarity: 1 },
  { id: 'w015', name: 'ラベンダーのスワッグ', cat: 'wreath', size: 'M', rarity: 1, months: [6,7] },
  { id: 'w016', name: 'かすみ草のスワッグ', cat: 'wreath', size: 'S', rarity: 1 },
  { id: 'w017', name: 'パンパスグラスのスワッグ', cat: 'wreath', size: 'M', rarity: 1 },
  { id: 'w018', name: 'ハーフリース', cat: 'wreath', size: 'M', rarity: 3 },
  { id: 'w019', name: '蔦のリース', cat: 'wreath', size: 'M', rarity: 1 },
  { id: 'w020', name: '木の実とベルのリース', cat: 'wreath', size: 'M', rarity: 2 },
  { id: 'w021', name: '三角フラッグ（パステル）', cat: 'garland', size: 'L', rarity: 1 },
  { id: 'w022', name: '三角フラッグ（アースカラー）', cat: 'garland', size: 'L', rarity: 1 },
  { id: 'w023', name: '星型ガーランド', cat: 'garland', size: 'L', rarity: 1 },
  { id: 'w024', name: '月と星のガーランド', cat: 'garland', size: 'L', rarity: 2 },
  { id: 'w025', name: 'ポンポンガーランド', cat: 'garland', size: 'M', rarity: 1 },
  { id: 'w026', name: 'フェルトボールガーランド', cat: 'garland', size: 'M', rarity: 1 },
  { id: 'w027', name: '紙の輪ガーランド', cat: 'garland', size: 'M', rarity: 2 },
  { id: 'w028', name: '折り鶴ガーランド', cat: 'garland', size: 'M', rarity: 3 },
  { id: 'w029', name: '木製ビーズガーランド', cat: 'garland', size: 'M', rarity: 1 },
  { id: 'w030', name: '葉っぱガーランド', cat: 'garland', size: 'L', rarity: 1 },
  { id: 'w031', name: '小花ガーランド', cat: 'garland', size: 'M', rarity: 2 },
  { id: 'w032', name: '貝殻ガーランド', cat: 'garland', size: 'M', rarity: 1 },
  { id: 'w033', name: '松ぼっくりガーランド', cat: 'garland', size: 'M', rarity: 1 },
  { id: 'w034', name: 'リボンガーランド', cat: 'garland', size: 'M', rarity: 2 },
  { id: 'w035', name: '提灯ガーランド', cat: 'garland', size: 'M', rarity: 1 },
  { id: 'w036', name: '小鳥ガーランド', cat: 'garland', size: 'M', rarity: 2 },
  { id: 'w037', name: 'ハートガーランド', cat: 'garland', size: 'M', rarity: 1 },
  { id: 'w038', name: 'ドライオレンジガーランド', cat: 'garland', size: 'M', rarity: 1 },
  { id: 'w039', name: 'ストリングライト（丸電球）', cat: 'light', size: 'L', rarity: 2 },
  { id: 'w040', name: 'ストリングライト（星型）', cat: 'light', size: 'L', rarity: 2 },
  { id: 'w041', name: 'ストリングライト（紙シェード）', cat: 'light', size: 'L', rarity: 1 },
  { id: 'w042', name: 'ウォールランプ（きのこ型）', cat: 'light', size: 'M', rarity: 2 },
  { id: 'w043', name: 'ウォールランプ（真鍮・半月）', cat: 'light', size: 'M', rarity: 1 },
  { id: 'w044', name: 'ペーパーランタン（丸）', cat: 'light', size: 'M', rarity: 2 },
  { id: 'w045', name: 'ペーパーランタン（星型）', cat: 'light', size: 'M', rarity: 3 },
  { id: 'w046', name: 'キャンドル型ウォールライト', cat: 'light', size: 'S', rarity: 1 },
  { id: 'w047', name: 'ウォールランプ（アンバーガラス）', cat: 'light', size: 'M', rarity: 2 },
  { id: 'w048', name: '小さな提灯ライト', cat: 'light', size: 'S', rarity: 1 },
  { id: 'w049', name: 'フェアリーライト', cat: 'light', size: 'L', rarity: 1 },
  { id: 'w050', name: 'ティーカップライト', cat: 'light', size: 'S', rarity: 2 },
  { id: 'w051', name: '雲型ウォールライト', cat: 'light', size: 'M', rarity: 2 },
  { id: 'w052', name: '壁掛けランタン', cat: 'light', size: 'M', rarity: 1 },
  { id: 'w053', name: 'ハンギングプラント（マクラメ）', cat: 'plant', size: 'M', rarity: 2 },
  { id: 'w054', name: 'ハンギングプラント（ガラス玉）', cat: 'plant', size: 'S', rarity: 1 },
  { id: 'w055', name: 'ハンギングプラント（編みかご）', cat: 'plant', size: 'M', rarity: 2 },
  { id: 'w056', name: 'ハンギングプラント（真鍮ポット）', cat: 'plant', size: 'S', rarity: 1 },
  { id: 'w057', name: 'ハンギングプラント（白陶器）', cat: 'plant', size: 'M', rarity: 1 },
  { id: 'w058', name: 'アイビーの壁鉢', cat: 'plant', size: 'M', rarity: 2 },
  { id: 'w059', name: '多肉の壁掛けプランター', cat: 'plant', size: 'M', rarity: 2 },
  { id: 'w060', name: 'エアプランツ（ガラスボール）', cat: 'plant', size: 'S', rarity: 1 },
  { id: 'w061', name: 'エアプランツ（流木付き）', cat: 'plant', size: 'S', rarity: 2 },
  { id: 'w062', name: '壁掛け一輪挿し（ガラス）', cat: 'plant', size: 'S', rarity: 1 },
  { id: 'w063', name: '壁掛け一輪挿し（陶器）', cat: 'plant', size: 'S', rarity: 1 },
  { id: 'w064', name: '試験管フラワースタンド', cat: 'plant', size: 'M', rarity: 2 },
  { id: 'w065', name: '苔玉の壁掛け', cat: 'plant', size: 'S', rarity: 1 },
  { id: 'w066', name: '壁掛けテラリウム', cat: 'plant', size: 'M', rarity: 2 },
  { id: 'w067', name: '押し花フレーム', cat: 'plant', size: 'M', rarity: 1 },
  { id: 'w068', name: '吊り下げハーバリウム', cat: 'plant', size: 'S', rarity: 1 },
  { id: 'w069', name: '蔦の枝飾り', cat: 'plant', size: 'L', rarity: 2 },
  { id: 'w070', name: '花の壁バスケット', cat: 'plant', size: 'M', rarity: 2 },
  { id: 'w071', name: 'ラベンダーの壁束', cat: 'plant', size: 'S', rarity: 1, months: [6,7] },
  { id: 'w072', name: 'ドライフラワードーム', cat: 'plant', size: 'S', rarity: 1 },
  { id: 'w073', name: '止まり木プランター', cat: 'plant', size: 'M', rarity: 2 },
  { id: 'w074', name: 'プランターボックス', cat: 'plant', size: 'M', rarity: 2 },
  { id: 'w075', name: '木の丸時計（ウォルナット）', cat: 'clock', size: 'M', rarity: 1 },
  { id: 'w076', name: '白い丸時計', cat: 'clock', size: 'M', rarity: 1 },
  { id: 'w077', name: '真鍮の丸時計', cat: 'clock', size: 'M', rarity: 2 },
  { id: 'w078', name: '振り子時計', cat: 'clock', size: 'M', rarity: 2 },
  { id: 'w079', name: '小屋型の時計', cat: 'clock', size: 'M', rarity: 2 },
  { id: 'w080', name: '猫シルエット時計', cat: 'clock', size: 'M', rarity: 2 },
  { id: 'w081', name: 'レトロ四角時計', cat: 'clock', size: 'M', rarity: 1 },
  { id: 'w082', name: '月モチーフ時計', cat: 'clock', size: 'S', rarity: 1 },
  { id: 'w083', name: '花の文字盤時計', cat: 'clock', size: 'M', rarity: 2 },
  { id: 'w084', name: '革ひも吊り時計', cat: 'clock', size: 'S', rarity: 1 },
  { id: 'w085', name: 'セラミック時計（水色）', cat: 'clock', size: 'S', rarity: 1 },
  { id: 'w086', name: '両面時計', cat: 'clock', size: 'M', rarity: 3 },
  { id: 'w087', name: '丸ミラー（木枠）', cat: 'mirror', size: 'M', rarity: 2 },
  { id: 'w088', name: '丸ミラー（真鍮枠）', cat: 'mirror', size: 'M', rarity: 2 },
  { id: 'w089', name: '雲型ミラー', cat: 'mirror', size: 'M', rarity: 1 },
  { id: 'w090', name: 'アーチ型ミラー', cat: 'mirror', size: 'M', rarity: 2 },
  { id: 'w091', name: '楕円ミラー', cat: 'mirror', size: 'M', rarity: 1 },
  { id: 'w092', name: 'サンバーストミラー', cat: 'mirror', size: 'M', rarity: 3 },
  { id: 'w093', name: '四角ミラー（白枠）', cat: 'mirror', size: 'S', rarity: 1 },
  { id: 'w094', name: '波型ミラー', cat: 'mirror', size: 'M', rarity: 2 },
  { id: 'w095', name: '六角ミラー', cat: 'mirror', size: 'S', rarity: 1 },
  { id: 'w096', name: 'ハート型ミラー', cat: 'mirror', size: 'S', rarity: 1 },
  { id: 'w097', name: '木の棚板（本）', cat: 'shelf', size: 'M', rarity: 1 },
  { id: 'w098', name: '木の棚板（花瓶）', cat: 'shelf', size: 'M', rarity: 1 },
  { id: 'w099', name: '二段の壁棚', cat: 'shelf', size: 'M', rarity: 2 },
  { id: 'w100', name: '三角ブラケット棚', cat: 'shelf', size: 'M', rarity: 1 },
  { id: 'w101', name: 'ハウス型の壁棚', cat: 'shelf', size: 'M', rarity: 2 },
  { id: 'w102', name: 'マグカップフック板', cat: 'shelf', size: 'M', rarity: 1 },
  { id: 'w103', name: '鍵掛けフックボード', cat: 'shelf', size: 'S', rarity: 1 },
  { id: 'w104', name: '枝風フック', cat: 'shelf', size: 'S', rarity: 1 },
  { id: 'w105', name: '布の壁ポケット', cat: 'shelf', size: 'M', rarity: 2 },
  { id: 'w106', name: '革風壁ポケット', cat: 'shelf', size: 'S', rarity: 1 },
  { id: 'w107', name: 'レターホルダー', cat: 'shelf', size: 'S', rarity: 1 },
  { id: 'w108', name: 'ハンギングバスケット', cat: 'shelf', size: 'M', rarity: 1 },
  { id: 'w109', name: '壁掛けブックシェルフ', cat: 'shelf', size: 'M', rarity: 2 },
  { id: 'w110', name: '小さなスパイスラック', cat: 'shelf', size: 'S', rarity: 1 },
  { id: 'w111', name: '猫の足跡フック', cat: 'shelf', size: 'S', rarity: 1 },
  { id: 'w112', name: '壁付け小引き出し棚', cat: 'shelf', size: 'M', rarity: 2 },
  { id: 'w113', name: 'タペストリー（山と太陽）', cat: 'tapestry', size: 'L', rarity: 3 },
  { id: 'w114', name: 'タペストリー（海と波）', cat: 'tapestry', size: 'L', rarity: 2 },
  { id: 'w115', name: 'タペストリー（森と鹿）', cat: 'tapestry', size: 'L', rarity: 2 },
  { id: 'w116', name: 'ファブリックポスター（花）', cat: 'tapestry', size: 'M', rarity: 1 },
  { id: 'w117', name: 'ファブリックポスター（猫）', cat: 'tapestry', size: 'M', rarity: 1 },
  { id: 'w118', name: 'マクラメ壁飾り', cat: 'tapestry', size: 'M', rarity: 2 },
  { id: 'w119', name: 'マクラメ（葉っぱ型）', cat: 'tapestry', size: 'S', rarity: 1 },
  { id: 'w120', name: 'ドリームキャッチャー', cat: 'tapestry', size: 'M', rarity: 2 },
  { id: 'w121', name: 'ドリームキャッチャー（月型）', cat: 'tapestry', size: 'M', rarity: 2 },
  { id: 'w122', name: 'ウィービング', cat: 'tapestry', size: 'M', rarity: 2 },
  { id: 'w123', name: '刺繍フープ（花）', cat: 'tapestry', size: 'S', rarity: 1 },
  { id: 'w124', name: '刺繍フープ（小鳥）', cat: 'tapestry', size: 'S', rarity: 1 },
  { id: 'w125', name: 'つるし飾り', cat: 'tapestry', size: 'M', rarity: 2 },
  { id: 'w126', name: '手ぬぐいタペストリー', cat: 'tapestry', size: 'M', rarity: 1 },
  { id: 'w127', name: 'パッチワーク布飾り', cat: 'tapestry', size: 'S', rarity: 1 },
  { id: 'w128', name: '編みの雪結晶飾り', cat: 'tapestry', size: 'S', rarity: 1, months: [12,1,2] },
  { id: 'w129', name: '空の額縁（アンティーク金）', cat: 'frame', size: 'L', rarity: 3 },
  { id: 'w130', name: '空の額縁（白・細）', cat: 'frame', size: 'M', rarity: 1 },
  { id: 'w131', name: '丸い空の額縁', cat: 'frame', size: 'M', rarity: 1 },
  { id: 'w132', name: '写真ストリング（木製クリップ）', cat: 'frame', size: 'L', rarity: 2 },
  { id: 'w133', name: '写真ストリング（横長）', cat: 'frame', size: 'L', rarity: 2 },
  { id: 'w134', name: 'コルクボード', cat: 'frame', size: 'M', rarity: 1 },
  { id: 'w135', name: 'パンチングボード', cat: 'frame', size: 'M', rarity: 2 },
  { id: 'w136', name: 'クリップボード（2枚組）', cat: 'frame', size: 'M', rarity: 1 },
  { id: 'w137', name: '黒板風ボード', cat: 'frame', size: 'M', rarity: 1 },
  { id: 'w138', name: 'ウッドサイン（模様）', cat: 'frame', size: 'M', rarity: 1 },
  { id: 'w139', name: '絵柄カレンダー', cat: 'frame', size: 'M', rarity: 2 },
  { id: 'w140', name: '木製プラーク（葉の彫刻）', cat: 'frame', size: 'S', rarity: 1 },
  { id: 'w141', name: '枝のモビール', cat: 'frame', size: 'L', rarity: 3 },
  { id: 'w142', name: '風鈴', cat: 'frame', size: 'S', rarity: 1 },
  { id: 'w143', name: 'しめ縄飾り', cat: 'seasonal', size: 'M', rarity: 3, months: [12,1] },
  { id: 'w144', name: 'ミニ門松風の壁飾り', cat: 'seasonal', size: 'M', rarity: 1, months: [12,1] },
  { id: 'w145', name: '破魔矢', cat: 'seasonal', size: 'M', rarity: 2, months: [12,1] },
  { id: 'w146', name: 'だるまの壁飾り', cat: 'seasonal', size: 'S', rarity: 1, months: [12,1] },
  { id: 'w147', name: '鬼のお面（節分）', cat: 'seasonal', size: 'S', rarity: 1, months: [2] },
  { id: 'w148', name: '豆まき枡の壁飾り', cat: 'seasonal', size: 'S', rarity: 1, months: [2] },
  { id: 'w149', name: 'つるし雛', cat: 'seasonal', size: 'M', rarity: 3, months: [3] },
  { id: 'w150', name: '桃の花の枝飾り', cat: 'seasonal', size: 'M', rarity: 2, months: [3] },
  { id: 'w151', name: 'こいのぼり（壁掛け）', cat: 'seasonal', size: 'M', rarity: 2, months: [5] },
  { id: 'w152', name: '兜の壁飾り', cat: 'seasonal', size: 'M', rarity: 3, months: [5] },
  { id: 'w153', name: '桜の枝飾り', cat: 'seasonal', size: 'M', rarity: 1, months: [3,4,5] },
  { id: 'w154', name: '藤の垂れ飾り', cat: 'seasonal', size: 'M', rarity: 2, months: [4,5] },
  { id: 'w155', name: 'あじさいの壁飾り', cat: 'seasonal', size: 'M', rarity: 1, months: [6] },
  { id: 'w156', name: '七夕の笹飾り', cat: 'seasonal', size: 'M', rarity: 1, months: [7] },
  { id: 'w157', name: '祭り提灯（2連）', cat: 'seasonal', size: 'M', rarity: 2, months: [7,8] },
  { id: 'w158', name: '金魚の壁飾り', cat: 'seasonal', size: 'S', rarity: 1, months: [7,8] },
  { id: 'w159', name: 'ひまわりの壁飾り', cat: 'seasonal', size: 'M', rarity: 1, months: [7,8] },
  { id: 'w160', name: 'お月見飾り', cat: 'seasonal', size: 'M', rarity: 2, months: [9,10] },
  { id: 'w161', name: '秋の実りの飾り', cat: 'seasonal', size: 'M', rarity: 1, months: [10,11] },
  { id: 'w162', name: 'ハロウィンかぼちゃ', cat: 'seasonal', size: 'M', rarity: 1, months: [10] },
  { id: 'w163', name: 'おばけガーランド', cat: 'seasonal', size: 'M', rarity: 1, months: [10] },
  { id: 'w164', name: 'コウモリ飾り', cat: 'seasonal', size: 'S', rarity: 1, months: [10] },
  { id: 'w165', name: 'クリスマスリース', cat: 'seasonal', size: 'M', rarity: 3, months: [12] },
  { id: 'w166', name: 'オーナメントボールの枝', cat: 'seasonal', size: 'M', rarity: 2, months: [12] },
  { id: 'w167', name: 'クリスマスの靴下', cat: 'seasonal', size: 'S', rarity: 1, months: [12] },
  { id: 'w168', name: '雪の結晶飾り（3連）', cat: 'seasonal', size: 'M', rarity: 1, months: [12,1,2] },
  { id: 'w169', name: '壁掛けミニツリー', cat: 'seasonal', size: 'M', rarity: 1, months: [12] },
  { id: 'w170', name: 'サンタの壁飾り', cat: 'seasonal', size: 'S', rarity: 1, months: [12] },
  { id: 'w171', name: 'トナカイのオーナメント', cat: 'seasonal', size: 'S', rarity: 1, months: [12] },
  { id: 'w172', name: 'ハートのリース（バレンタイン）', cat: 'seasonal', size: 'M', rarity: 1, months: [2] },
  { id: 'w173', name: '木製の星飾り（大）', cat: 'motif', size: 'M', rarity: 1 },
  { id: 'w174', name: '木製の三日月飾り', cat: 'motif', size: 'M', rarity: 1 },
  { id: 'w175', name: '月と星のモビール', cat: 'motif', size: 'M', rarity: 1 },
  { id: 'w176', name: '虹の壁飾り', cat: 'motif', size: 'M', rarity: 2 },
  { id: 'w177', name: '雲の壁飾り', cat: 'motif', size: 'M', rarity: 1 },
  { id: 'w178', name: '雲と雨粒のセット', cat: 'motif', size: 'M', rarity: 1 },
  { id: 'w179', name: '太陽の壁飾り', cat: 'motif', size: 'M', rarity: 1 },
  { id: 'w180', name: '小鳥の壁飾り（3羽）', cat: 'motif', size: 'S', rarity: 1 },
  { id: 'w181', name: '蝶の壁飾り（3連）', cat: 'motif', size: 'S', rarity: 1 },
  { id: 'w182', name: '猫のシルエット飾り', cat: 'motif', size: 'M', rarity: 1 },
  { id: 'w183', name: '犬のシルエット飾り', cat: 'motif', size: 'M', rarity: 1 },
  { id: 'w184', name: 'うさぎの壁飾り', cat: 'motif', size: 'S', rarity: 1 },
  { id: 'w185', name: 'フクロウの壁飾り', cat: 'motif', size: 'S', rarity: 1 },
  { id: 'w186', name: '小さな家の飾り（3軒）', cat: 'motif', size: 'M', rarity: 1 },
  { id: 'w187', name: '気球の飾り', cat: 'motif', size: 'M', rarity: 1 },
  { id: 'w188', name: '飛行機の飾り', cat: 'motif', size: 'M', rarity: 1 },
  { id: 'w189', name: '帆船の飾り', cat: 'motif', size: 'M', rarity: 1 },
  { id: 'w190', name: '灯台の飾り', cat: 'motif', size: 'M', rarity: 1 },
  { id: 'w191', name: 'きのこの飾り（2個）', cat: 'motif', size: 'S', rarity: 1 },
  { id: 'w192', name: 'どんぐりと葉の飾り', cat: 'motif', size: 'S', rarity: 1 },
  { id: 'w193', name: 'アンティークキーの飾り', cat: 'motif', size: 'S', rarity: 1 },
  { id: 'w194', name: '羽根の壁飾り', cat: 'motif', size: 'M', rarity: 1 },
  { id: 'w195', name: '壁掛け小皿（花柄）', cat: 'motif', size: 'S', rarity: 1 },
  { id: 'w196', name: '壁掛け小皿（鳥柄）', cat: 'motif', size: 'S', rarity: 1 },
  { id: 'w197', name: 'てんとう虫と葉の飾り', cat: 'motif', size: 'S', rarity: 1 },
  { id: 'w198', name: '蜂と花の飾り', cat: 'motif', size: 'S', rarity: 1 },
  { id: 'w199', name: 'ティーカップの壁飾り', cat: 'motif', size: 'S', rarity: 1 },
  { id: 'w200', name: 'ミニチュア窓枠', cat: 'motif', size: 'M', rarity: 1 },
];
/* 額装パズルのフレームスタイル (frame-design.md の 20 種)。
 * 描画はデータ駆動: color (枠色) / width (枠幅の比率) / mat (マットの色、
 * 無ければ null) / ornament (装飾タイプ) / shape (rect | circle) /
 * material (wood | metal | enamel | rainbow: 帯の質感表現)。
 * line は「内側の細線」の色 (lineDouble は二重線)。rainbow は color の
 * 代わりに RAINBOW_COLORS で帯を塗り、gradient はスウォッチ用の代表色。
 * 解放は unlockAt (累計クリア回数) で、初期は oak / walnut の 2 種。 */
var FRAME_STYLES = [
  { id: 'oak',     name: 'ナチュラルオーク',    unlockAt: 0,   color: '#C8A165', width: 0.06, mat: '#F7F1E2', ornament: 'none',    shape: 'rect',   material: 'wood' },
  { id: 'walnut',  name: 'ウォルナット',        unlockAt: 0,   color: '#6E4C2C', width: 0.06, mat: '#F7F1E2', ornament: 'none',    shape: 'rect',   material: 'wood' },
  { id: 'black',   name: 'ブラック',            unlockAt: 3,   color: '#33302C', width: 0.05, mat: null,       ornament: 'none',    shape: 'rect',   material: 'enamel' },
  { id: 'ribbon',  name: 'リボンフレーム',      unlockAt: 5,   color: '#F4F1EA', width: 0.06, mat: null,       ornament: 'ribbon',  shape: 'rect',   material: 'enamel' },
  { id: 'white',   name: 'ホワイト',            unlockAt: 8,   color: '#F4F1EA', width: 0.06, mat: null,       ornament: 'line',    shape: 'rect',   material: 'enamel', line: '#BEB6A8', lineDouble: true },
  { id: 'circle',  name: 'まるフレーム',        unlockAt: 12,  color: '#6E4C2C', width: 0.06, mat: null,       ornament: 'none',    shape: 'circle', material: 'wood' },
  { id: 'pink',    name: 'パステルピンク',      unlockAt: 16,  color: '#E7B7C5', width: 0.06, mat: null,       ornament: 'none',    shape: 'rect',   material: 'enamel' },
  { id: 'gold',    name: 'ゴールド',            unlockAt: 20,  color: '#C4A24B', width: 0.06, mat: '#F7F1E2', ornament: 'line',    shape: 'rect',   material: 'metal',  line: '#F0D68C' },
  { id: 'flower',  name: 'お花フレーム',        unlockAt: 25,  color: '#F6F0DE', width: 0.07, mat: null,       ornament: 'flowers', shape: 'rect',   material: 'enamel' },
  { id: 'sky',     name: 'スカイブルー',        unlockAt: 30,  color: '#A8C6D8', width: 0.06, mat: null,       ornament: 'none',    shape: 'rect',   material: 'enamel' },
  { id: 'antique', name: 'アンティークゴールド', unlockAt: 40,  color: '#A67C2E', width: 0.07, mat: null,       ornament: 'corners', shape: 'rect',   material: 'metal' },
  { id: 'silver',  name: 'シルバー',            unlockAt: 50,  color: '#B9BDC4', width: 0.06, mat: null,       ornament: 'line',    shape: 'rect',   material: 'metal',  line: '#EBEEF2' },
  { id: 'cherry',  name: 'チェリーウッド',      unlockAt: 60,  color: '#8A4A38', width: 0.06, mat: null,       ornament: 'none',    shape: 'rect',   material: 'wood' },
  { id: 'starry',  name: '星空フレーム',        unlockAt: 75,  color: '#26314E', width: 0.07, mat: null,       ornament: 'stars',   shape: 'rect',   material: 'enamel' },
  { id: 'green',   name: 'ディープグリーン',    unlockAt: 90,  color: '#3E5C4B', width: 0.06, mat: null,       ornament: 'none',    shape: 'rect',   material: 'enamel' },
  { id: 'bronze',  name: 'ブロンズ',            unlockAt: 110, color: '#8C6A3F', width: 0.06, mat: null,       ornament: 'none',    shape: 'rect',   material: 'metal' },
  { id: 'navy',    name: 'ネイビー',            unlockAt: 130, color: '#2F4057', width: 0.06, mat: null,       ornament: 'none',    shape: 'rect',   material: 'enamel' },
  { id: 'rainbow', name: 'レインボーフレーム',  unlockAt: 155, color: '#D9A7A0', width: 0.07, mat: null,       ornament: 'none',    shape: 'rect',   material: 'rainbow',
    gradient: 'linear-gradient(135deg, #D9A7A0, #E5C39A, #B5C49A, #9AB8C4, #B0A3C4)' },
  { id: 'pearl',   name: 'パールフレーム',      unlockAt: 180, color: '#F3F0EB', width: 0.07, mat: null,       ornament: 'pearl',   shape: 'rect',   material: 'enamel' },
  { id: 'royal',   name: 'ロイヤルゴールド',    unlockAt: 210, color: '#B28A2C', width: 0.09, mat: null,       ornament: 'crown',   shape: 'rect',   material: 'metal',  line: '#F0D68C' }
];
function frameStyleById(id) {
  for (var i = 0; i < FRAME_STYLES.length; i++) if (FRAME_STYLES[i].id === id) return FRAME_STYLES[i];
  return null;
}
/* ---- 額装フレーム描画の純粋ヘルパー (承認済みレシピの数値部分) ----
 * 実際の Canvas 描画は UI 側の paintFrameUnit が担い、ここは色計算と
 * 寸法決めだけを切り出してテスト可能にする。レシピの正本は
 * room-samples/wall-mock-final.png を作った描画手順。 */
/* 額ユニット Canvas の余白率: 落影 (右下) と枠外にはみ出す装飾
 * (王冠・リボン) を収めるため、ユニット外周に幅比でこの分だけ足す */
var FRAME_PAD_RATIO = 0.16;
/* レインボーフレームの帯色 (くすみパステル 6 色・帯の周囲を一周する) */
var RAINBOW_COLORS = [[227, 169, 169], [240, 203, 160], [247, 231, 169], [183, 214, 176], [164, 196, 214], [186, 178, 216]];
function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
/* [r,g,b] に明暗係数を掛けて 0..255 に丸める (枠の面ごとの陰影用) */
function shadeRgb(rgb, f) {
  return rgb.map(function (c) {
    var v = Math.round(c * f);
    return v < 0 ? 0 : v > 255 ? 255 : v;
  });
}
function shadeColor(hex, f) { return shadeRgb(hexToRgb(hex), f); }
/* [r,g,b] (0..255) → CIELAB [L,a,b] (D65)。お助けの色分けは知覚的に近い色を
 * 同じ山にするため、RGB ではなく Lab で開きを測る */
function rgbToLab(rgb) {
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  var r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
  var x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  var y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  var z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
  var fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/* お助けの色分け: 固定の色区分ではなく、残っているピース同士の「相対的な」
 * 近さで分ける。基本は Lab 空間での凝集クラスタリング (近い色から順に
 * くっつける) で、狙う山の数はピース数の約 1/5 (3〜8山に制限)。
 * なだらかなグラデーション (霧の空など) でも近い濃さ同士が固まり、
 * 明暗のバンド状の山になる。戻り値はグループの配列 (入力 index の配列)。
 * 決定的 (乱数なし) */
var CLUSTER_MAX_GROUPS = 8;
function clusterByColor(labs) {
  if (labs.length < CLUSTER_MIN_GROUPS * 2) return [labs.map(function (_, i) { return i; })];
  var target = Math.min(CLUSTER_MAX_GROUPS, Math.max(CLUSTER_MIN_GROUPS, Math.round(labs.length / 5)));
  return clusterAgglomerative(labs, target);
}
var CLUSTER_MIN_GROUPS = 3;
/* 近い色からくっつける凝集クラスタリング (平均連結・決定的)。
 * 遠く離れた色同士は最後まで混ざらず、似た色の固まりができる */
function clusterAgglomerative(labs, target) {
  var clusters = labs.map(function (_, i) { return [i]; });
  function centroid(c) {
    var s = [0, 0, 0];
    c.forEach(function (ix) { s[0] += labs[ix][0]; s[1] += labs[ix][1]; s[2] += labs[ix][2]; });
    return [s[0] / c.length, s[1] / c.length, s[2] / c.length];
  }
  while (clusters.length > target) {
    var cents = clusters.map(centroid);
    var bi = -1, bj = -1, bd = Infinity;
    for (var i = 0; i < clusters.length; i++) for (var j = i + 1; j < clusters.length; j++) {
      var dd = (cents[i][0] - cents[j][0]) * (cents[i][0] - cents[j][0]) + (cents[i][1] - cents[j][1]) * (cents[i][1] - cents[j][1]) + (cents[i][2] - cents[j][2]) * (cents[i][2] - cents[j][2]);
      if (dd < bd) { bd = dd; bi = i; bj = j; }
    }
    clusters[bi] = clusters[bi].concat(clusters[bj]);
    clusters.splice(bj, 1);
  }
  return clusters.filter(function (c) { return c.length > 0; });
}
/* 帯の周囲位置 t (0..1: 上辺左端から時計回り) における虹色 [r,g,b] */
function rainbowColorAt(t) {
  t = ((t % 1) + 1) % 1;
  var seg = t * RAINBOW_COLORS.length;
  var i = Math.floor(seg);
  var fr = seg - i;
  var a = RAINBOW_COLORS[i % RAINBOW_COLORS.length];
  var b = RAINBOW_COLORS[(i + 1) % RAINBOW_COLORS.length];
  return [0, 1, 2].map(function (k) { return Math.round(a[k] + (b[k] - a[k]) * fr); });
}
/* 額ユニットの寸法 (CSS px): U = 枠外形の一辺。
 * bw = 枠帯の幅、matW = マット幅 (帯幅の 0.7 倍)、board = 盤面の一辺、
 * pad = Canvas 余白、size = Canvas の一辺。 */
function frameGeometry(U, st) {
  var bw = Math.max(2, U * st.width);
  var matW = st.mat ? bw * 0.7 : 0;
  var pad = U * FRAME_PAD_RATIO;
  return { bw: bw, matW: matW, board: U - 2 * (bw + matW), pad: pad, size: U + 2 * pad };
}
/* 累計クリア回数で新しく解放されるスタイル id (未解放のものだけ・表の順) */
function newFrameUnlocks(wall, totalClears) {
  return FRAME_STYLES.filter(function (st) {
    return st.unlockAt > 0 && totalClears >= st.unlockAt && wall.frameUnlocks.indexOf(st.id) < 0;
  }).map(function (st) { return st.id; });
}
/* 解放を wall に反映する: frameUnlocks に加え、未通知分として
 * pendingUnlocks にも積む。戻り値: 今回解放した styleId の配列。 */
function applyFrameUnlocks(wall, totalClears) {
  var ids = newFrameUnlocks(wall, totalClears);
  ids.forEach(function (id) {
    wall.frameUnlocks.push(id);
    if (wall.pendingUnlocks.indexOf(id) < 0) wall.pendingUnlocks.push(id);
  });
  return ids;
}
/* 壁紙 (wallpaper-design.md の 20 種)。フレームと並ぶ解放報酬の第 2 系統で、
 * 解放は unlockAt (累計クリア回数)、初期は kinari / sage の 2 種。
 * 描画はデータ駆動: kind ごとに UI 側のペインター (paintWallpaperRegion)
 * が小さな描画関数で描く。base は地色、accent は柄色 (必要な種別だけ)。
 * 柄はすべてトーンオントーンで弱く付け、飾りの邪魔をしない。 */
var WALLPAPERS = [
  { id: 'kinari',     name: '生成り',              unlockAt: 0,   kind: 'solid',    base: '#F3E9D3' },
  { id: 'sage',       name: 'セージグリーン',      unlockAt: 0,   kind: 'solid',    base: '#CBD4C0' },
  { id: 'pink',       name: 'ダスティピンク',      unlockAt: 3,   kind: 'solid',    base: '#ECD5CD' },
  { id: 'stripe',     name: '細ストライプ',        unlockAt: 5,   kind: 'stripe',   base: '#F3E9D3', accent: '#D6C6A8' },
  { id: 'blue',       name: 'ダスティブルー',      unlockAt: 8,   kind: 'solid',    base: '#C5D1DC' },
  { id: 'dot',        name: '小さなドット',        unlockAt: 12,  kind: 'dot',      base: '#F3E9D3', accent: '#CEBA94' },
  { id: 'mint',       name: 'ミントグリーン',      unlockAt: 16,  kind: 'solid',    base: '#C4DED2' },
  { id: 'floral',     name: '小花柄',              unlockAt: 20,  kind: 'floral',   base: '#F6ECDC', accent: '#E9B7BE', leaf: '#A9BE9C' },
  { id: 'lemon',      name: 'レモンイエロー',      unlockAt: 25,  kind: 'solid',    base: '#F2E3B3' },
  { id: 'gingham',    name: 'ギンガムチェック',    unlockAt: 30,  kind: 'gingham',  base: '#F3E9D3', accent: '#B9C6A9' },
  { id: 'wood',       name: '木目パネル',          unlockAt: 40,  kind: 'wood',     base: '#D2AC80', accent: '#96703F' },
  { id: 'lavender',   name: 'ラベンダー',          unlockAt: 50,  kind: 'solid',    base: '#D5CBE4' },
  { id: 'brick',      name: 'レンガ',              unlockAt: 60,  kind: 'brick',    base: '#EFE4CE', accent: '#D9A58C' },
  { id: 'terracotta', name: 'テラコッタ',          unlockAt: 75,  kind: 'solid',    base: '#DCA98C' },
  { id: 'starry',     name: '星空',                unlockAt: 90,  kind: 'starry',   base: '#2C3954', accent: '#F0D68C' },
  { id: 'forest',     name: 'ディープフォレスト',  unlockAt: 110, kind: 'solid',    base: '#47624F' },
  { id: 'gray',       name: 'ウォームグレー',      unlockAt: 130, kind: 'solid',    base: '#CFC8BC' },
  { id: 'wine',       name: 'ワインレッド',        unlockAt: 155, kind: 'solid',    base: '#9E5B5B' },
  { id: 'gold',       name: 'アンティークゴールド', unlockAt: 180, kind: 'microdot', base: '#BE9E57', accent: '#D8BE82' },
  { id: 'moonlit',    name: '月夜',                unlockAt: 210, kind: 'moonlit',  base: '#232F4A', sub: '#3A4A6B', accent: '#F0D68C' }
];
function wallpaperById(id) {
  for (var i = 0; i < WALLPAPERS.length; i++) if (WALLPAPERS[i].id === id) return WALLPAPERS[i];
  return null;
}
/* 累計クリア回数で新しく解放される壁紙 id (未解放のものだけ・表の順) */
function newPaperUnlocks(wall, totalClears) {
  return WALLPAPERS.filter(function (p) {
    return p.unlockAt > 0 && totalClears >= p.unlockAt && wall.paperUnlocks.indexOf(p.id) < 0;
  }).map(function (p) { return p.id; });
}
/* 解放を wall に反映する: paperUnlocks に加え、未通知分として
 * pendingPaperUnlocks にも積む。戻り値: 今回解放した壁紙 id の配列。 */
function applyPaperUnlocks(wall, totalClears) {
  var ids = newPaperUnlocks(wall, totalClears);
  ids.forEach(function (id) {
    wall.paperUnlocks.push(id);
    if (wall.pendingPaperUnlocks.indexOf(id) < 0) wall.pendingPaperUnlocks.push(id);
  });
  return ids;
}
/* 壁の広さは段階制 (2026-11-08 ユーザー決定): 無限には広げず2段階まで。
 * 段階0 = 横1.5倍・縦1.2倍 (最初から)、段階1 = 横3.0倍・縦1.4倍
 * (累計クリア WALL_EXPAND_CLEARS 回で解放)。倍率はステージ (画面) 比。
 * 段階制より前のセーブは 1.0 x 1.0 の壁として扱い、段階0へ移行する。
 * 座標の移行: 横は中心基準 (今の並びが真ん中に残り両側が開く)、
 * 縦は床基準 (床からの高さ = 1 - y を保存し、上方向にだけ伸びる)。 */
var WALL_SIZE_STAGES = [{ w: 1.5, h: 1.2 }, { w: 3.0, h: 1.4 }];
var WALL_LEGACY_SIZE = { w: 1, h: 1 };
var WALL_EXPAND_CLEARS = 15;
function wallSizeOf(stage) {
  if (stage === -1) return WALL_LEGACY_SIZE;
  return WALL_SIZE_STAGES[stage] || WALL_SIZE_STAGES[0];
}
function spreadWallX(x, fromW, toW) {
  var v = 0.5 + (x - 0.5) * (fromW / toW);
  return Math.min(1, Math.max(0, v));
}
function spreadWallY(y, fromH, toH) {
  var v = 1 - (1 - y) * (fromH / toH);
  return Math.min(1, Math.max(0, v));
}
/* wall の配置座標を現在の段階から目標段階の広さへ移し替え、sizeStage を
 * 更新する。wall.sizeStage が数値でない場合は旧形式 (1.0 x 1.0) とみなす */
function applyWallSizeStage(wall, stage) {
  var from = wallSizeOf(typeof wall.sizeStage === 'number' ? wall.sizeStage : -1);
  var to = wallSizeOf(stage);
  if (from !== to) {
    [wall.placed, wall.frames].forEach(function (arr) {
      (arr || []).forEach(function (p) {
        if (typeof p.x === 'number') p.x = spreadWallX(p.x, from.w, to.w);
        if (typeof p.y === 'number') p.y = spreadWallY(p.y, from.h, to.h);
      });
    });
  }
  wall.sizeStage = stage;
}
/* 壁の拡張解放: 段階0で累計クリアが条件に達したら段階1へ広げ、
 * 未通知分として pendingExpand を立てる。戻り値: 今回広げたか */
function applyWallExpand(wall, totalClears) {
  var cur = typeof wall.sizeStage === 'number' ? wall.sizeStage : 0;
  if (cur >= WALL_SIZE_STAGES.length - 1) return false;
  if (totalClears < WALL_EXPAND_CLEARS) return false;
  applyWallSizeStage(wall, cur + 1);
  wall.pendingExpand = true;
  return true;
}
/* アイテムの表示幅 (壁の幅に対する比率) の目安: カタログのサイズ感から決める */
var WALL_SIZE_RATIO = { S: 0.20, M: 0.28, L: 0.40 };
/* ---- 床の猫 (2026-11-09 ユーザー指定) ----
 * 壁画面の床に置く猫。壁アイテムとは別カタログ・別所持リスト
 * (wall.catsOwned / wall.catsPlaced) で管理し、配置は x (中心比) のみで
 * 足元は床に固定される。c01 白猫はスターターとして最初から床にいる。
 * 残りは壁アイテムと同じごほうび抽選で届く (drawWallItem の対象に混ぜる)。
 * 画像は cats/<id>.webp (512×512 透過)。w = 床での幅 (ステージ幅比)。
 * 画風はシンプル・ミニマル (ユーザーがサンプルで承認した方向)。 */
var CAT_CATALOG = [
  { id: 'c01', name: '白猫 (お座り)', rarity: 1, w: 0.15 },
  { id: 'c02', name: '茶トラ (香箱座り)', rarity: 2, w: 0.17 },
  { id: 'c03', name: '三毛猫 (のび)', rarity: 2, w: 0.27 },
  { id: 'c04', name: '黒猫 (お座り)', rarity: 2, w: 0.15 },
  { id: 'c05', name: 'キジトラ (丸まって寝る)', rarity: 2, w: 0.18 },
  { id: 'c06', name: '三毛猫 (寝そべり)', rarity: 2, w: 0.28 },
  { id: 'c07', name: 'ハチワレ (クッション)', rarity: 2, w: 0.18 },
  { id: 'c08', name: '子猫と毛糸玉', rarity: 2, w: 0.19 },
  { id: 'c09', name: '長毛猫 (ふわふわ)', rarity: 2, w: 0.17 },
  { id: 'c10', name: '白猫 (ごろごろ)', rarity: 3, w: 0.23 }
];
var CAT_STARTER_ID = 'c01';
var CAT_FEET_Y = 0.972; // 猫の足元の高さ (ワールド高さ比・床帯の中)
function catById(id) {
  for (var i = 0; i < CAT_CATALOG.length; i++) if (CAT_CATALOG[i].id === id) return CAT_CATALOG[i];
  return null;
}
/* 壁アイテムと猫のどちらか (ごほうび表示・保存検証の共通解決) */
function collectibleById(id) { return wallItemById(id) || catById(id); }
function wallItemById(id) {
  for (var i = 0; i < WALL_CATALOG.length; i++) if (WALL_CATALOG[i].id === id) return WALL_CATALOG[i];
  return null;
}
function wallItemWidthRatio(item) {
  return (item && WALL_SIZE_RATIO[item.size]) || WALL_SIZE_RATIO.M;
}
/* 最初から持っている壁アイテム (初日でも飾れるように)。付与抽選は
 * 所持済みを対象から外すので、ここに入っていれば二重に届くことはない */
var WALL_STARTER_ITEMS = ['w007', 'w030', 'w037']; // ユーカリリース / 葉っぱガーランド / ハートガーランド
function emptyWall() {
  return { owned: WALL_STARTER_ITEMS.slice(), seen: {}, pending: [], placed: [], frames: [], frameUnlocks: ['oak', 'walnut'], pendingUnlocks: [], paper: 'kinari', paperUnlocks: ['kinari', 'sage'], pendingPaperUnlocks: [], sizeStage: 0, pendingExpand: false, lastDate: null, grantDates: {}, history: {}, catsOwned: [CAT_STARTER_ID], catsPlaced: [{ id: CAT_STARTER_ID, x: 0.5 }] };
}
/* 保存データの形が崩れていても使える形に寄せる (旧データには wall 自体がない)。
 * placed は配列順 = 重なり順を保つ。壁アイテムは同じものを複数置ける
 * (2026-11-09 PBI 21) ので重複は落とさず、各配置に uid を振って区別する。
 * 額 (frames) の重複は従来どおり先勝ちで落とす。 */
function normalizeWall(w) {
  var out = emptyWall();
  if (!w || typeof w !== 'object') return out;
  if (Array.isArray(w.owned)) {
    out.owned = w.owned.filter(function (id, idx) { return !!wallItemById(id) && w.owned.indexOf(id) === idx; });
  }
  // 初期アイテムは既存セーブにも不足分を補う (新規は emptyWall で所持済み)
  WALL_STARTER_ITEMS.forEach(function (id) {
    if (wallItemById(id) && out.owned.indexOf(id) < 0) out.owned.push(id);
  });
  if (w.seen && typeof w.seen === 'object') {
    Object.keys(w.seen).forEach(function (id) {
      if (collectibleById(id) && typeof w.seen[id] === 'string') out.seen[id] = w.seen[id];
    });
  }
  if (Array.isArray(w.pending)) {
    out.pending = w.pending.filter(function (id) { return !!collectibleById(id); });
  }
  if (Array.isArray(w.placed)) {
    var uidSeq = 0, uidSeen = {};
    w.placed.forEach(function (p) {
      var m = p && typeof p.uid === 'string' ? /^u(\d+)$/.exec(p.uid) : null;
      if (m) uidSeq = Math.max(uidSeq, parseInt(m[1], 10));
    });
    w.placed.forEach(function (p) {
      if (p && wallItemById(p.id) && out.owned.indexOf(p.id) >= 0 && typeof p.x === 'number' && typeof p.y === 'number') {
        var uid = (typeof p.uid === 'string' && /^u\d+$/.test(p.uid) && !uidSeen[p.uid]) ? p.uid : null;
        if (!uid) { uidSeq += 1; uid = 'u' + uidSeq; }
        uidSeen[uid] = true;
        var c = clampItemPos(p.x, p.y);
        out.placed.push({ id: p.id, uid: uid, x: c.x, y: c.y });
      }
    });
  }
  if (Array.isArray(w.frames)) {
    var frameKeys = {};
    w.frames.forEach(function (f) {
      var keyParts = (f && typeof f.recordKey === 'string') ? f.recordKey.split('|') : [];
      var keyOk = keyParts.length === 3 && /^\d{4}-\d{2}-\d{2}$/.test(keyParts[0]) && /^\d+$/.test(keyParts[1]) && keyParts[2].length > 0;
      if (f && keyOk && typeof f.x === 'number' && typeof f.y === 'number' && !frameKeys[f.recordKey]) {
        frameKeys[f.recordKey] = true;
        var c = clampItemPos(f.x, f.y);
        out.frames.push({
          recordKey: f.recordKey, x: c.x, y: c.y,
          w: (typeof f.w === 'number' && f.w > 0.05 && f.w <= 0.9) ? f.w : 0.30,
          color: frameStyleById(f.color) ? f.color : 'walnut'
        });
      }
    });
  }
  if (Array.isArray(w.frameUnlocks)) {
    out.frameUnlocks = w.frameUnlocks.filter(function (id, idx) { return !!frameStyleById(id) && w.frameUnlocks.indexOf(id) === idx; });
  }
  ['oak', 'walnut'].forEach(function (id) { // 初期スタイルは常時使える
    if (out.frameUnlocks.indexOf(id) < 0) out.frameUnlocks.unshift(id);
  });
  if (Array.isArray(w.pendingUnlocks)) {
    out.pendingUnlocks = w.pendingUnlocks.filter(function (id) {
      var st = frameStyleById(id);
      return !!st && st.unlockAt > 0;
    });
  }
  // 壁紙 (旧セーブには無いので初期値で補完する)
  if (Array.isArray(w.paperUnlocks)) {
    out.paperUnlocks = w.paperUnlocks.filter(function (id, idx) { return !!wallpaperById(id) && w.paperUnlocks.indexOf(id) === idx; });
  }
  ['kinari', 'sage'].forEach(function (id) { // 初期の壁紙は常時使える
    if (out.paperUnlocks.indexOf(id) < 0) out.paperUnlocks.push(id);
  });
  if (Array.isArray(w.pendingPaperUnlocks)) {
    out.pendingPaperUnlocks = w.pendingPaperUnlocks.filter(function (id) {
      var p = wallpaperById(id);
      return !!p && p.unlockAt > 0;
    });
  }
  // 適用中の壁紙は実在し、かつ解放済みでなければ生成りに戻す
  out.paper = (typeof w.paper === 'string' && wallpaperById(w.paper) && out.paperUnlocks.indexOf(w.paper) >= 0) ? w.paper : 'kinari';
  // 未解放スタイルで保存されている額はウォルナットに落とす (選択肢に出ない値を持たせない)
  out.frames.forEach(function (f) {
    if (out.frameUnlocks.indexOf(f.color) < 0) f.color = 'walnut';
  });
  if (typeof w.lastDate === 'string') out.lastDate = w.lastDate;
  // ごほうびの付与済み日 (グループ別)。旧形式 (lastDate のみ) は両グループ
  // 付与済みとして引き継ぎ、二重付与を防ぐ
  out.grantDates = {};
  if (w.grantDates && typeof w.grantDates === 'object') {
    ['0', '1'].forEach(function (g) {
      if (typeof w.grantDates[g] === 'string') out.grantDates[g] = w.grantDates[g];
    });
  }
  if (out.lastDate && out.grantDates['0'] === undefined && out.grantDates['1'] === undefined) {
    out.grantDates = { '0': out.lastDate, '1': out.lastDate };
  }
  if (w.history && typeof w.history === 'object') {
    Object.keys(w.history).forEach(function (d) {
      if (Array.isArray(w.history[d])) out.history[d] = w.history[d].filter(function (id) { return !!collectibleById(id); });
    });
  }
  // 床の猫: 所持と配置 (配置は x のみ、足元は床固定)。スターターの白猫は
  // 常時所持。catsPlaced が配列で保存されていればその内容を尊重し (空配列 =
  // 全てしまった状態)、無い旧セーブではスターターを床の中央に置く
  if (Array.isArray(w.catsOwned)) {
    out.catsOwned = w.catsOwned.filter(function (id, idx) { return !!catById(id) && w.catsOwned.indexOf(id) === idx; });
  }
  if (out.catsOwned.indexOf(CAT_STARTER_ID) < 0) out.catsOwned.push(CAT_STARTER_ID);
  if (Array.isArray(w.catsPlaced)) {
    out.catsPlaced = [];
    var catPlacedIds = {};
    w.catsPlaced.forEach(function (p) {
      if (p && catById(p.id) && out.catsOwned.indexOf(p.id) >= 0 && typeof p.x === 'number' && !catPlacedIds[p.id]) {
        catPlacedIds[p.id] = true;
        out.catsPlaced.push({ id: p.id, x: Math.min(0.97, Math.max(0.03, p.x)) });
      }
    });
  }
  // 壁の広さ段階: 有効な段階が保存されていれば引き継ぐ。無ければ段階制より
  // 前のセーブ (1.0 x 1.0 の壁) として、段階0の広さへ座標を移行する
  if (typeof w.sizeStage === 'number' && WALL_SIZE_STAGES[w.sizeStage]) {
    out.sizeStage = w.sizeStage;
  } else {
    out.sizeStage = -1; // applyWallSizeStage に旧形式として読ませるための番兵
    applyWallSizeStage(out, 0);
  }
  out.pendingExpand = w.pendingExpand === true;
  return out;
}
/* 抽選対象に入るか: 未所持で、季節物はその月の間だけ */
function wallDrawEligible(item, wall, month) {
  if (!item) return false;
  if (wall.owned.indexOf(item.id) >= 0) return false;
  if (item.months && item.months.indexOf(month) < 0) return false;
  return true;
}
/* その日のごほうび抽選。未所持の対象を RARITY_TABLE の重みで 1 点抽選する。
 * 対象が無ければ null。ctx: { month } / rng: () => [0,1) */
function drawWallItem(wall, ctx, rng) {
  var pool = WALL_CATALOG.filter(function (it) { return wallDrawEligible(it, wall, ctx.month); });
  // 猫も同じ抽選に混ぜる (未所持の猫が対象)
  var catsOwned = Array.isArray(wall.catsOwned) ? wall.catsOwned : [];
  CAT_CATALOG.forEach(function (c) { if (catsOwned.indexOf(c.id) < 0) pool.push(c); });
  if (!pool.length) return null;
  var total = 0;
  pool.forEach(function (it) { total += RARITY_TABLE[it.rarity].weight; });
  var roll = rng() * total;
  for (var i = 0; i < pool.length; i++) {
    roll -= RARITY_TABLE[pool[i].rarity].weight;
    if (roll < 0) return pool[i].id;
  }
  return pool[pool.length - 1].id; // 浮動小数点の端数保険
}
/* アイテムを所持に加える (重複は無視)。seen には初回入手日を残す */
function grantWallItems(wall, ids, date) {
  ids.forEach(function (id) {
    if (catById(id)) {
      if (!Array.isArray(wall.catsOwned)) wall.catsOwned = [];
      if (wall.catsOwned.indexOf(id) >= 0) return;
      wall.catsOwned.push(id);
    } else {
      if (!wallItemById(id) || wall.owned.indexOf(id) >= 0) return;
      wall.owned.push(id);
    }
    if (date && !wall.seen[id]) wall.seen[id] = date;
  });
  return wall;
}
function recordWallHistory(wall, date, ids) {
  if (!ids.length) return;
  var cur = wall.history[date] || [];
  ids.forEach(function (id) { if (cur.indexOf(id) < 0) cur.push(id); });
  wall.history[date] = cur;
}
/* ---- 額のサイズ3段階 (2026-11-10 ユーザー設計) ----
 * 段階値は幅比 w。大は小の面積4倍 (幅2倍)、中は幅の中間で現行標準。
 * 既存の額 (0.30 / 初期 0.28) は移行なしで「中」扱い */
var FRAME_SIZE_TIERS = [
  { id: 's', label: '小', w: 0.20 },
  { id: 'm', label: '中', w: 0.30 },
  { id: 'l', label: '大', w: 0.40 }
];
/* 幅比から最も近い段階の添字を返す (境界は仕様どおり 0.25 / 0.35) */
function frameSizeTierOf(w) {
  if (w < 0.25) return 0;
  if (w <= 0.35) return 1;
  return 2;
}
/* サイズ変更後の中心クランプ: 中心は維持し、額が壁からはみ出す場合
 * だけ、はみ出し分を内側へ寄せて全体を壁に収める。幅の壁内比は
 * f.w/size.w、高さ比は f.w/size.h (額は正方形で単位空間では一辺 f.w) */
function clampFrameCenter(f, size) {
  var hw = f.w / size.w / 2, hh = f.w / size.h / 2;
  return {
    x: Math.min(1 - hw, Math.max(hw, f.x)),
    y: Math.min(1 - hh, Math.max(hh, f.y))
  };
}
/* ---- 壁画面のサンプル箱 (猫の配置ガイド、2026-11-10 ユーザー決定) ----
 * スタート画面の壁帯でギフト箱が壁に被る範囲を、壁座標 (比率) で返す。
 * 帯の幾何は renderWallPreviewCanvas / updateWallPreview と同じ式:
 * 帯はビューポート全幅、帯高 = min(壁の自然高, 画面高の 28%)、帯が
 * 壁より横長な分は下地だけが左右へ延長され、壁本体は中央に収まる。
 * 箱は CSS (.gift-box: width min(86%, 400px)、.wallband-box:
 * bottom 0 + translateY(48%)) から決まり、アートワーク本体
 * (viewBox 416x190 の x=64..352 / y=84..163) の範囲を壁比率へ換算する。
 * 換算値は puppeteer 実測 (412x915) と 0.002 以内で一致する (テスト参照) */
var SAMPLE_BOX_ART = { x0: 64 / 416, x1: 352 / 416, y0: 84 / 190, y1: 163 / 190 };
function sampleBoxArtRect(vw, vh, size) {
  var dispW = vw;
  var natH = dispW * (1.25 * size.h) / size.w;
  var cap = vw <= 700 ? vh * 0.28 : Infinity;
  var bandH = Math.min(natH, cap);
  var aspect = dispW / bandH;
  var uw = size.w, uh = 1.25 * size.h;
  var ext = uw / uh < aspect ? uh * aspect : uw;
  var wallLeftPx = dispW * (ext - uw) / 2 / ext;
  var wallWidthPx = dispW * uw / ext;
  var elW = Math.min(0.86 * dispW, 400), elH = elW * 190 / 416;
  var elLeft = (dispW - elW) / 2;
  var elTop = bandH - 0.52 * elH; /* 要素の下端は帯下端 + 要素高の 48% */
  var artL = elLeft + elW * SAMPLE_BOX_ART.x0, artR = elLeft + elW * SAMPLE_BOX_ART.x1;
  var artT = elTop + elH * SAMPLE_BOX_ART.y0, artB = elTop + elH * SAMPLE_BOX_ART.y1;
  return {
    left: (artL - wallLeftPx) / wallWidthPx,
    top: artT / bandH,
    width: (artR - artL) / wallWidthPx,
    height: (artB - artT) / bandH
  };
}
/* アートワーク矩形 → SVG 要素全体の矩形 (壁比率)。要素の高さは
 * ワールドの px アスペクト (幅px/高さpx) 経由で決まる */
function sampleBoxElementRect(vw, vh, size, worldAspect) {
  var art = sampleBoxArtRect(vw, vh, size);
  var elW = art.width / (SAMPLE_BOX_ART.x1 - SAMPLE_BOX_ART.x0);
  var elLeft = art.left - elW * SAMPLE_BOX_ART.x0;
  var elH = elW * worldAspect * (190 / 416);
  var elTop = art.top - elH * SAMPLE_BOX_ART.y0;
  return { left: elLeft, top: elTop, width: elW, height: elH, art: art };
}
/* 壁の端でクランプ: アイテム/額の中心は壁 (比率 0〜1) の内側に収める */
function clampItemPos(x, y) {
  function c(v) { return typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5; }
  return { x: c(x), y: c(y) };
}
/* 全データリセット: 保存キー 1 つだけを消す (他のキーは触らない)。
 * 戻り値: そのキーに値があったか。storage は localStorage 互換オブジェクト。 */
function resetAllData(storage, key) {
  if (!storage || typeof storage.removeItem !== 'function' || typeof key !== 'string') return false;
  var had = false;
  try { had = storage.getItem(key) != null; } catch (e) { /* 読めなくても削除は試みる */ }
  try { storage.removeItem(key); } catch (e) { return false; }
  return had;
}

function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  var m = Math.floor(sec / 60), s = sec % 60, hh = Math.floor(m / 60);
  function p2(v) { return String(v).padStart(2, '0'); }
  return hh > 0 ? hh + ':' + p2(m % 60) + ':' + p2(s) : p2(m) + ':' + p2(s);
}

/* ---- タイマー累積 (純粋関数) ----
 * 経過時間の持ち方: base (確定済みの累積秒) + 走行中セグメント。
 * 走行中セグメントは started && !paused && !cleared の間だけ
 * (now - timerStart) が加わる。cleared が立った後は base のみが正になる。
 * ★ クリア確定 (onClear) と一時停止では、必ず「フラグを立てる前に」
 *   elapsedSeconds で走行分を base へ畳み込むこと。先に cleared を立てて
 *   から読むと走行分が丸ごと切り捨てられ、開始から一度も一時停止して
 *   いないゲームのクリアタイムが 0 秒になる (実機バグの根本原因)。 */
function elapsedSeconds(t, now) {
  if (!t) return 0;
  var run = 0;
  if (t.started && !t.paused && !t.cleared && t.timerStart > 0) {
    run = (now - t.timerStart) / 1000;
    if (!(run > 0)) run = 0; // 時計の巻き戻し等で負にしない
  }
  return Math.floor((t.base || 0) + run);
}
/* クリアタイムの保険 (最終ガード): 手数が 1 以上あるのに 0 秒になる
 * 場合は、保存済みの進行 (elapsedSec) から復元し、それも無ければ
 * 最低 1 秒にする。0 秒クリアを記録に残さないため。 */
function sanitizeClearTime(elapsed, moves, savedSec) {
  var e = Math.floor(elapsed) || 0;
  if (e > 0) return e;
  if ((moves || 0) > 0) {
    var s = Math.floor(savedSec) || 0;
    return s > 0 ? s : 1;
  }
  return 0;
}

/* ---------- UIテーマ ----------
 * テーマは机テクスチャの4案がそのままテーマになったもの (2026-11-08 刷新)。
 * 旧テーマ (A/B/C・旧英語ID) は廃止し、保存値が旧値・未知値なら
 * 既定の 'walnut' に落とす (後継マッピングはしない)。 */
var UI_THEME_IDS = ['walnut', 'oak', 'greenmat', 'linen'];
function normalizeUiTheme(value) {
  return UI_THEME_IDS.indexOf(value) >= 0 ? value : 'walnut';
}

var GAME_URL = 'https://daily-jigsaw.pages.dev';
/* 結果の共有文 (文字共有・クリップボード共通)。ゲーム URL と
 * ハッシュタグ #まいにちジグソー を必ず含む。 */
function buildShareText(res) {
  return 'まいにちジグソー ' + (res.stage ? 'ステージ' + res.stage : res.date) + ' ・ ' + res.pieces + 'ピース ・ タイム ' +
    formatTime(res.timeSec) + ' ・ ' + res.moves + '手でクリア！\n' +
    GAME_URL + '\n#まいにちジグソー';
}

/* 壁アイテムの配置 uid の次番号 ('u' + 数字)。既存の最大値 + 1 を返す */
function nextWallItemUid(placed) {
  var max = 0;
  (placed || []).forEach(function (p) {
    var m = p && typeof p.uid === 'string' ? /^u(\d+)$/.exec(p.uid) : null;
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'u' + (max + 1);
}
/* コーチマーク式チュートリアルの画面別セグメント (ステップ番号の配分)。
 * ステップの文面と対象要素はブラウザ側の TOUR_STEP_DEFS が持つ */
var TOUR_SEGMENTS = { start: [0, 1], play: [2, 3], settings: [4], wall: [5, 6] };
var TOUR_STEP_COUNT = 7;
var PureLogic = {
  BASE_DATE_FALLBACK: BASE_DATE_FALLBACK, DIFFICULTIES: DIFFICULTIES,
  TABSIZE: TABSIZE, JITTER: JITTER, SNAP_DIST: SNAP_DIST,
  hashSeed: hashSeed, mulberry32: mulberry32, rngFromString: rngFromString,
  dateToMs: dateToMs, msToDateStr: msToDateStr, daysBetween: daysBetween, addDays: addDays,
  jstTodayString: jstTodayString,
  pickImageId: pickImageId, imageSizeFor: imageSizeFor,
  poolEntries: poolEntries, pickPoolEntry: pickPoolEntry, poolEntryKey: poolEntryKey,
  difficultyGroup: difficultyGroup, isUpperTier: isUpperTier, frameTier: frameTier,
  poolEntryByKey: poolEntryByKey, recordImageKey: recordImageKey,
  stageDate: stageDate, stageCycle: stageCycle, stageOrderForCycle: stageOrderForCycle,
  stageEntryIndex: stageEntryIndex, stageEntry: stageEntry, recordStage: recordStage,
  clearedStages: clearedStages, nextStage: nextStage, unlockedImageKeys: unlockedImageKeys,
  stageBoxPatternIndex: stageBoxPatternIndex,
  entryPhotoUrl: entryPhotoUrl, entryThumbUrl: entryThumbUrl,
  genEdge: genEdge, edgeSegments: edgeSegments, sampleEdge: sampleEdge,
  generateEdges: generateEdges, sideSamples: sideSamples, pieceOutlinePoints: pieceOutlinePoints,
  pieceHome: pieceHome, clusterAnchorId: clusterAnchorId, piecePositions: piecePositions,
  snapToGrid: snapToGrid, findRelativeSnap: findRelativeSnap, isComplete: isComplete,
  absorbMerges: absorbMerges, clustersInRect: clustersInRect, shiftClusters: shiftClusters,
  scatterRect: scatterRect, deskBounds: deskBounds, initialScatter: initialScatter,
  clusterCellBounds: clusterCellBounds, clampClusterToRect: clampClusterToRect,
  normalizeClustersToRect: normalizeClustersToRect, clampClustersTranslation: clampClustersTranslation,
  BOX_PATTERNS: BOX_PATTERNS, boxPatternIndex: boxPatternIndex, boxPatternForDate: boxPatternForDate,
  isEdgePiece: isEdgePiece, formatTime: formatTime,
  elapsedSeconds: elapsedSeconds, sanitizeClearTime: sanitizeClearTime,
  GAME_URL: GAME_URL, buildShareText: buildShareText,
  UI_THEME_IDS: UI_THEME_IDS, normalizeUiTheme: normalizeUiTheme,
  progressIsStarted: progressIsStarted, startPanelMode: startPanelMode, freshStartNeedsConfirm: freshStartNeedsConfirm,
  boxTapAction: boxTapAction,
  WALL_CATALOG: WALL_CATALOG,
  FRAME_STYLES: FRAME_STYLES, WALL_SIZE_RATIO: WALL_SIZE_RATIO,
  FRAME_PAD_RATIO: FRAME_PAD_RATIO, RAINBOW_COLORS: RAINBOW_COLORS,
  hexToRgb: hexToRgb, shadeRgb: shadeRgb, shadeColor: shadeColor,
  rgbToLab: rgbToLab, clusterByColor: clusterByColor,
  rainbowColorAt: rainbowColorAt, frameGeometry: frameGeometry,
  frameStyleById: frameStyleById, newFrameUnlocks: newFrameUnlocks, applyFrameUnlocks: applyFrameUnlocks,
  WALLPAPERS: WALLPAPERS, wallpaperById: wallpaperById,
  newPaperUnlocks: newPaperUnlocks, applyPaperUnlocks: applyPaperUnlocks,
  WALL_SIZE_STAGES: WALL_SIZE_STAGES, WALL_EXPAND_CLEARS: WALL_EXPAND_CLEARS,
  wallSizeOf: wallSizeOf, spreadWallX: spreadWallX, spreadWallY: spreadWallY,
  applyWallSizeStage: applyWallSizeStage, applyWallExpand: applyWallExpand,
  RARITY_TABLE: RARITY_TABLE, rarityLabel: rarityLabel,
  WALL_STARTER_ITEMS: WALL_STARTER_ITEMS,
  wallItemById: wallItemById, wallItemWidthRatio: wallItemWidthRatio,
  CAT_CATALOG: CAT_CATALOG, catById: catById, collectibleById: collectibleById, CAT_FEET_Y: CAT_FEET_Y,
  FRAME_SIZE_TIERS: FRAME_SIZE_TIERS, frameSizeTierOf: frameSizeTierOf, clampFrameCenter: clampFrameCenter,
  SAMPLE_BOX_ART: SAMPLE_BOX_ART, sampleBoxArtRect: sampleBoxArtRect, sampleBoxElementRect: sampleBoxElementRect,
  emptyWall: emptyWall, normalizeWall: normalizeWall, nextWallItemUid: nextWallItemUid,
  TOUR_SEGMENTS: TOUR_SEGMENTS, TOUR_STEP_COUNT: TOUR_STEP_COUNT,
  wallDrawEligible: wallDrawEligible, drawWallItem: drawWallItem,
  grantWallItems: grantWallItems, recordWallHistory: recordWallHistory,
  clampItemPos: clampItemPos, resetAllData: resetAllData,
  completedBoardLayout: completedBoardLayout, detailRenderPlan: detailRenderPlan,
  woodTileOrigin: woodTileOrigin, deskBgRegionCells: deskBgRegionCells, deskBgPlan: deskBgPlan, deskBgBlit: deskBgBlit,
  bitmapProbeOk: bitmapProbeOk, bitmapRetryPlan: bitmapRetryPlan,
  isOutsideBoardCell: isOutsideBoardCell, minimapLayout: minimapLayout,
  pieceRelief: pieceRelief,
  BGM_SHORT_TRACK_SEC: BGM_SHORT_TRACK_SEC, isShortTrack: isShortTrack, trackPlays: trackPlays,
  shuffledOrder: shuffledOrder, nextShuffleOrder: nextShuffleOrder,
  BGM_FADE_SEC: BGM_FADE_SEC, crossfadeCurve: crossfadeCurve, crossfadeDuration: crossfadeDuration
};
if (typeof module !== 'undefined' && module.exports) module.exports = PureLogic;

/* ================= ブラウザ UI ================= */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
(function () {
var $ = function (id) { return document.getElementById(id); };

/* ---------- PWA: Service Worker 登録 (失敗しても本体に影響させない) ---------- */
try {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 登録失敗時は通常の Web ページとして動作 */ });
    });
  }
} catch (e) { /* ignore */ }

var STORE_KEY = 'daily-jigsaw:v1';
var CELL = 100; // ワールド単位: 1セル = 100

/* ---------- 保存 ---------- */
function loadStore() {
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (raw) { var s = JSON.parse(raw); if (s && s.progress && s.records) return s; }
  } catch (e) { /* ignore */ }
  return { records: [], progress: {}, lastDifficulty: 36, uiTheme: 'walnut', bgmOn: true, bgmVolume: 0.7, seOn: true, seVolume: 1 };
}
var store = loadStore();
store.uiTheme = normalizeUiTheme(store.uiTheme); // 旧テーマ値は無効値として既定 'walnut' に落とす
store.wall = normalizeWall(store.wall); // 壁インテリア (旧データには無いので空で作る。旧 store.rewards は読み捨て)
/* ラウンド制 (第N回) は廃止 (2026-11-09 ステージ制へ転換)。store.round は旧セーブに残っていても読まない */
function saveStoreDeferred() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } }
function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 容量超過などは無視 */ }
}

/* ---------- テーマ (机テクスチャ4種: ウォルナット / ライトオーク / グリーンマット / リネン) ----------
 * UI の配色は CSS 変数 (style.css の [data-theme] ) で切り替える。
 * ここでは Canvas 側 (机テクスチャ・マット色・真鍮色・紙吹雪) と箱の包装紙の色を持つ。
 * 机の絵柄は手続き描画ではなく、承認済みモックと同じ生成コードで作った
 * テクスチャ画像 (desk-textures/tex-*.jpg) をそのまま使う。desk.base は
 * テクスチャの平均色で、読み込み前/失敗時のフォールバックと地色に使う。
 * 選択は store.uiTheme に保存する (旧値・未知値は normalizeUiTheme で 'walnut')。 */
var THEME_NAMES = UI_THEME_IDS;
var THEMES = {
  walnut: {
    mat: '#33523f',
    brass: '#c9a227', // 範囲選択ハイライト (CSS の --brass と一致)
    desk: { tex: 'desk-textures/tex-walnut.jpg', base: '#7e5c38', vigLight: 'rgba(255,240,210,0.06)', vigDark: 'rgba(30,17,4,0.22)', sheen: null },
    confetti: ['#33523f', '#c9a227', '#f5efe4', '#7a3b3a', '#8a6d3b'],
    box: {
      'dots-red': { bg: '#efe6d0', fg: '#33523f', fg2: '#c9a227' },
      'stripes-mint': { bg: '#33523f', fg: '#efe6d0', fg2: '#c9a227' },
      'stars-navy': { bg: '#2c3a55', fg: '#c9a227', fg2: '#e8ddc8' },
      'gingham-pink': { bg: '#e9d5cf', fg: '#a05a52', fg2: '#a05a52' },
      'confetti': { bg: '#f2ead6', fg: '#8a6d3b', fg2: '#33523f' },
      'floral-retro': { bg: '#a9603f', fg: '#f3e3c2', fg2: '#33523f' },
      'plaid': { bg: '#f0e7d3', fg: '#33523f', fg2: '#c9a227' },
      'hearts': { bg: '#7a3b3a', fg: '#f3e3c2', fg2: '#c9a227' },
      'moons': { bg: '#2c3a55', fg: '#e8ddc8', fg2: '#c9a227' },
      'leaves': { bg: '#efe6d0', fg: '#5c7350', fg2: '#c9a227' },
      'waves': { bg: '#33523f', fg: '#e8ddc8', fg2: '#c9a227' },
      'triangles': { bg: '#f2ead6', fg: '#a9603f', fg2: '#33523f' },
      'diamonds': { bg: '#efe6d0', fg: '#7a3b3a', fg2: '#c9a227' },
      'snow': { bg: '#44506b', fg: '#f5efe4', fg2: '#c9a227' },
      'sakura': { bg: '#e9d5cf', fg: '#c47a74', fg2: '#a05a52' },
      'clouds': { bg: '#efe6d0', fg: '#7d9bb3', fg2: '#c9a227' },
      'checkers': { bg: '#f2ead6', fg: '#33523f', fg2: '#c9a227' },
      'music': { bg: '#efe6d0', fg: '#7a3b3a', fg2: '#33523f' },
      'polka-big': { bg: '#33523f', fg: '#f3e3c2', fg2: '#c9a227' },
      'grid': { bg: '#fbf5e6', fg: '#8a6d3b', fg2: '#a05a52' }
    }
  },
  oak: {
    mat: '#9db89a',
    brass: '#c99b3f', // CSS の --brass と一致
    desk: { tex: 'desk-textures/tex-oak.jpg', base: '#c0a071', vigLight: 'rgba(255,255,255,0.10)', vigDark: 'rgba(120,84,32,0.12)', sheen: null },
    confetti: ['#cf6f4f', '#9db89a', '#fbfaf7', '#d9a441', '#7d9bb3'],
    box: {
      'dots-red': { bg: '#fbfaf7', fg: '#9db89a', fg2: '#cf6f4f' },
      'stripes-mint': { bg: '#9db89a', fg: '#fbfaf7', fg2: '#cf6f4f' },
      'stars-navy': { bg: '#aebfd0', fg: '#fbfaf7', fg2: '#cf6f4f' },
      'gingham-pink': { bg: '#f7e8e4', fg: '#e0a89c', fg2: '#e0a89c' },
      'confetti': { bg: '#fdfaf2', fg: '#cf6f4f', fg2: '#9db89a' },
      'floral-retro': { bg: '#dfa184', fg: '#fdf6ec', fg2: '#9db89a' },
      'plaid': { bg: '#fbfaf7', fg: '#9db89a', fg2: '#cf6f4f' },
      'hearts': { bg: '#f7e8e4', fg: '#cf6f4f', fg2: '#d9a441' },
      'moons': { bg: '#aebfd0', fg: '#fbfaf7', fg2: '#d9a441' },
      'leaves': { bg: '#fbfaf7', fg: '#7d9b6e', fg2: '#cf6f4f' },
      'waves': { bg: '#9db89a', fg: '#fbfaf7', fg2: '#d9a441' },
      'triangles': { bg: '#fdfaf2', fg: '#cf6f4f', fg2: '#9db89a' },
      'diamonds': { bg: '#fbfaf7', fg: '#d9a441', fg2: '#cf6f4f' },
      'snow': { bg: '#7d9bb3', fg: '#fdfaf2', fg2: '#d9a441' },
      'sakura': { bg: '#f7e8e4', fg: '#e0a89c', fg2: '#cf6f4f' },
      'clouds': { bg: '#fbfaf7', fg: '#aebfd0', fg2: '#d9a441' },
      'checkers': { bg: '#fdfaf2', fg: '#9db89a', fg2: '#cf6f4f' },
      'music': { bg: '#fbfaf7', fg: '#cf6f4f', fg2: '#9db89a' },
      'polka-big': { bg: '#9db89a', fg: '#fdfaf2', fg2: '#cf6f4f' },
      'grid': { bg: '#fdfaf2', fg: '#b9c4a8', fg2: '#cf6f4f' }
    }
  },
  greenmat: {
    mat: '#7a4038',
    brass: '#c9a227', // CSS の --brass と一致
    desk: { tex: 'desk-textures/tex-greenmat.jpg', base: '#335240', vigLight: 'rgba(225,255,230,0.05)', vigDark: 'rgba(8,18,12,0.30)', sheen: 'rgba(255,255,240,0.10)' },
    confetti: ['#c9a227', '#ece4cf', '#7a4038', '#8aa873', '#f5efe4'],
    box: {
      'dots-red': { bg: '#2e2620', fg: '#b08d4f', fg2: '#5e2f35' },
      'stripes-mint': { bg: '#5e2f35', fg: '#e8ddc8', fg2: '#b08d4f' },
      'stars-navy': { bg: '#232c42', fg: '#b08d4f', fg2: '#e8ddc8' },
      'gingham-pink': { bg: '#4a3230', fg: '#8a5a52', fg2: '#8a5a52' },
      'confetti': { bg: '#33291f', fg: '#b08d4f', fg2: '#5e2f35' },
      'floral-retro': { bg: '#5e2f35', fg: '#d9b98c', fg2: '#b08d4f' },
      'plaid': { bg: '#2e2620', fg: '#5e2f35', fg2: '#b08d4f' },
      'hearts': { bg: '#5e2f35', fg: '#e8ddc8', fg2: '#b08d4f' },
      'moons': { bg: '#232c42', fg: '#e8ddc8', fg2: '#b08d4f' },
      'leaves': { bg: '#2e2620', fg: '#8aa873', fg2: '#b08d4f' },
      'waves': { bg: '#1f3125', fg: '#e8ddc8', fg2: '#b08d4f' },
      'triangles': { bg: '#33291f', fg: '#b08d4f', fg2: '#8a5a52' },
      'diamonds': { bg: '#2e2620', fg: '#b08d4f', fg2: '#e8ddc8' },
      'snow': { bg: '#31405c', fg: '#e8ddc8', fg2: '#b08d4f' },
      'sakura': { bg: '#4a3230', fg: '#c48a80', fg2: '#b08d4f' },
      'clouds': { bg: '#2e2620', fg: '#7d8aa0', fg2: '#b08d4f' },
      'checkers': { bg: '#33291f', fg: '#5e2f35', fg2: '#b08d4f' },
      'music': { bg: '#2e2620', fg: '#d9b98c', fg2: '#b08d4f' },
      'polka-big': { bg: '#5e2f35', fg: '#e8ddc8', fg2: '#b08d4f' },
      'grid': { bg: '#2e2620', fg: '#6b543a', fg2: '#b08d4f' }
    }
  },
  linen: {
    mat: '#aebf9c',
    brass: '#b8862e', // CSS の --brass と一致
    desk: { tex: 'desk-textures/tex-linen.jpg', base: '#e8ddc7', vigLight: 'rgba(255,255,255,0.10)', vigDark: 'rgba(120,100,60,0.10)', sheen: null },
    confetti: ['#476b4f', '#c9a227', '#fbf7ec', '#cf8f7a', '#8aa873'],
    box: {
      'dots-red': { bg: '#f7efdb', fg: '#476b4f', fg2: '#b8862e' },
      'stripes-mint': { bg: '#476b4f', fg: '#f7efdb', fg2: '#b8862e' },
      'stars-navy': { bg: '#44506b', fg: '#e8ddc8', fg2: '#b8862e' },
      'gingham-pink': { bg: '#f3e3da', fg: '#b98a7a', fg2: '#b98a7a' },
      'confetti': { bg: '#faf3e0', fg: '#b8862e', fg2: '#476b4f' },
      'floral-retro': { bg: '#b98a5e', fg: '#faf0da', fg2: '#476b4f' },
      'plaid': { bg: '#f7efdb', fg: '#aebf9c', fg2: '#b8862e' },
      'hearts': { bg: '#f3e3da', fg: '#cf8f7a', fg2: '#b8862e' },
      'moons': { bg: '#44506b', fg: '#e8ddc8', fg2: '#b8862e' },
      'leaves': { bg: '#faf3e0', fg: '#6d8a5f', fg2: '#b8862e' },
      'waves': { bg: '#476b4f', fg: '#f7efdb', fg2: '#b8862e' },
      'triangles': { bg: '#faf3e0', fg: '#b98a5e', fg2: '#476b4f' },
      'diamonds': { bg: '#f7efdb', fg: '#b8862e', fg2: '#b98a7a' },
      'snow': { bg: '#5a6a86', fg: '#faf3e0', fg2: '#b8862e' },
      'sakura': { bg: '#f3e3da', fg: '#cf9a8a', fg2: '#b98a5e' },
      'clouds': { bg: '#faf3e0', fg: '#9db4c6', fg2: '#b8862e' },
      'checkers': { bg: '#faf3e0', fg: '#476b4f', fg2: '#b8862e' },
      'music': { bg: '#f7efdb', fg: '#a05a52', fg2: '#476b4f' },
      'polka-big': { bg: '#476b4f', fg: '#faf3e0', fg2: '#b8862e' },
      'grid': { bg: '#fbf7ec', fg: '#bfb088', fg2: '#b8862e' }
    }
  }
};
var uiTheme = normalizeUiTheme(store.uiTheme);
document.documentElement.setAttribute('data-theme', uiTheme);
function applyTheme() {
  document.documentElement.setAttribute('data-theme', uiTheme);
  document.querySelectorAll('[data-theme-opt]').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-theme-opt') === uiTheme);
  });
  invalidateDeskBackdrop(); // 机テクスチャ・マット色が変わるので背景レイヤーを作り直す
  if (state) { renderStartScreen(); draw(); } // 箱の色と Canvas (机/マット) を新テーマで描き直す
  if (typeof detailRecord !== 'undefined' && detailRecord && !$('detailModal').hidden) renderDetailPuzzle(detailRecord); // 詳細のマット色も追従
}
function setUiTheme(name) {
  if (THEME_NAMES.indexOf(name) < 0) return;
  uiTheme = name;
  store.uiTheme = name;
  saveStore();
  applyTheme();
}
/* ---------- 操作モード (ドラッグ / 持ち運び) ----------
 * ドラッグ = 従来どおり掴んで引く。持ち運び = ピースをタップで持ち上げ、
 * カメラ (パン/ピンチ) を自由に動かしてからタップで置く。大きい難易度で
 * 遠くへ運ぶとき用。持ち運びモードでも押しながらのドラッグは従来どおり
 * 使え、タップ (ほぼ動かさず離す) だけが「持ち上げ」になる。
 * 設定はテーマと同じ流儀で store.carryMode に保存する */
var carryMode = store.carryMode === true;
function syncOpModeButtons() {
  document.querySelectorAll('[data-opmode]').forEach(function (b) {
    b.classList.toggle('active', (b.getAttribute('data-opmode') === 'carry') === carryMode);
  });
}
function setCarryMode(on) {
  carryMode = !!on;
  store.carryMode = carryMode;
  saveStore();
  syncOpModeButtons();
  if (!carryMode) dropCarry(); // 従来モードに戻したら運び中のピースはその場に置く
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
  store.seVolume = seVolume;
  saveStore();
}

/* ---------- サウンド設定の同期 (設定シート ⇔ スタート画面) ----------
 * 同じ設定のコントロールが両画面にあるので、値の反映はここへ集約し、
 * どちらを触っても両方のコントロール表示が常に一致するようにする。 */
function syncAudioControls() {
  [['bgmToggle', bgmOn], ['bgmToggleStart', bgmOn],
   ['seToggle', seOn], ['seToggleStart', seOn]].forEach(function (p) {
    var el = $(p[0]); if (el) el.checked = p[1];
  });
  var vol = Math.round(bgmVolume * 100);
  ['bgmVolume', 'bgmVolumeStart'].forEach(function (id) {
    var el = $(id); if (el) el.value = vol;
  });
  var svol = Math.round(seVolume * 100);
  ['seVolume', 'seVolumeStart'].forEach(function (id) {
    var el = $(id); if (el) el.value = svol;
  });
}
function onBgmToggleChanged(checked) {
  bgmOn = checked;
  saveAudioSettings();
  bgmApplySettings(); // 中で syncAudioControls も呼ぶ
}
function onBgmVolumeInput(value) {
  bgmVolume = value / 100;
  saveAudioSettings();
  bgmApplySettings();
}
function onSeToggleChanged(checked) {
  seOn = checked;
  saveAudioSettings();
  syncAudioControls();
}
function onSeVolumeInput(value) {
  seVolume = value / 100;
  saveAudioSettings();
  applySeVolume();
  syncAudioControls();
  if (seOn) sePlaceOk(); // 調整中その場で試聴できるように
}

/* ---- BGM ----
 * プレイリスト 13 曲 (合計 40:56)。選曲 UI は持たず、シャッフルで
 * 全曲一巡するまで重複なく再生する (順列の規則は PureLogic)。
 * 短い曲 (90 秒未満) は 2 回続けて再生してから次へ進む。
 * 曲の切り替わりはクロスフェード (id 18): Audio 要素を 2 つ (デッキ)
 * 持ち回し、終わり際の数秒で前曲をフェードアウトしながら次曲を
 * フェードインする。ゲイン曲線と時間の計算は PureLogic。
 * 再生は机に入ってから (id 19): タイトル画面 (スタート画面) では
 * 開始しない。ただし一度流れ始めたら戻っても止めない (2026-11-10 改訂)。最初の play() が端末に受け付けられ
 * なかった場合に備え、ユーザー操作のたびに再試行する (bgmTryPlay)。
 * 曲名と作者は、その曲が再生されている間ずっと右下へ小さく
 * 出しっぱなしにする (クレジット表示を兼ねる)。 */
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
  { file: 'let-it-happen.mp3', title: 'Let It Happen', artist: 'OtoLogic', license: 'CC BY 4.0' },
  { file: 'in-that-mood.mp3', title: 'In That Mood', artist: 'OtoLogic', license: 'CC BY 4.0' }
];
var bgm = {
  decks: [null, null], active: 0,
  order: [], pos: 0, current: -1,
  started: false, hiddenPaused: false, errorStreak: 0, dead: false,
  fading: null, fadeTimer: null, watchTimer: null
};
/* Audio 要素は2つ (デッキ) を持ち回し、曲の切り替わりはクロスフェードにする。
 * デッキ: { audio, track (曲 index・未ロードは -1), playsLeft (短い曲の残り再生回数) } */
function bgmDeck(i) {
  if (bgm.decks[i]) return bgm.decks[i];
  var a = new Audio();
  a.preload = 'auto';
  a.volume = 0;
  var deck = { audio: a, track: -1, playsLeft: 1 };
  a.addEventListener('loadedmetadata', function () {
    deck.playsLeft = trackPlays(a.duration); // 短い曲は 2 回 (長さ確定後に決める)
  });
  a.addEventListener('ended', function () {
    // 終端での切替は「フェード監視が間に合わなかった場合」の保険。
    // フェード中・裏デッキの終了では何もしない。
    if (bgm.fading || deck !== bgm.decks[bgm.active]) return;
    deck.playsLeft--;
    if (deck.playsLeft > 0) { // 短い曲の 2 回目: 同じ曲をもう一度
      a.currentTime = 0;
      bgmPlayPromise(a.play());
    } else {
      bgmAdvanceNow();
    }
  });
  a.addEventListener('playing', function () {
    bgm.errorStreak = 0;
    bgm.dead = false;
    if (deck.track === bgm.current) bgmShowNowPlaying(); // 再生が実際に始まったら曲名クレジットを出す
  });
  a.addEventListener('pause', function () {
    // フェード中の停止 (旧デッキの幕引き等) ではクレジットを消さない
    if (!bgm.fading && deck.track === bgm.current) bgmHideNowPlaying();
  });
  a.addEventListener('error', function () {
    // 読めない曲で止まらないよう次へ進む。ただし全曲読めない場合は
    // 一巡ぶん試したところで諦める (次へ進み続ける無限ループにしない)
    if (!bgm.started || deck.track < 0) return;
    bgm.errorStreak++;
    if (bgm.errorStreak >= BGM_TRACKS.length) {
      bgm.dead = true; // 全曲失敗: 操作のたびの再試行で叩き続けないようにする
      bgmStopAll();
      bgmHideNowPlaying();
      return;
    }
    if (bgm.fading && deck === bgm.decks[bgm.fading.into]) {
      bgmCancelFade(); // フェード先が読めない: フェードをやめて即座に次へ
      bgmAdvanceNow();
    } else if (deck === bgm.decks[bgm.active]) {
      bgmAdvanceNow();
    }
  });
  bgm.decks[i] = deck;
  return deck;
}
function bgmPlayPromise(p) {
  if (p && p.catch) p.catch(function () { /* 自動再生拒否などは黙って無視 */ });
}
/* 曲名クレジット: その曲が再生されている間、右下に出しっぱなしにする。
 * 表示は Audio の playing イベント、非表示は pause イベントに連動させる
 * ので、オフにしたとき・タブを隠して一時停止したとき・全曲失敗のときは
 * 消える。テキストだけ先に差し替えるのは bgmPlayTrack / bgmStartFade
 * (曲の切替時)。クロスフェードでは新しい曲が主役になるフェード開始時点で
 * 切り替える。 */
function bgmSetNowPlayingText() {
  var el = $('bgmToast');
  if (!el || bgm.current < 0) return;
  var t = BGM_TRACKS[bgm.current];
  el.textContent = '♪ ' + t.title + ' — ' + t.artist;
}
function bgmShowNowPlaying() {
  bgmSetNowPlayingText();
  var el = $('bgmToast');
  if (el && bgm.current >= 0) el.classList.add('show');
}
function bgmHideNowPlaying() {
  var el = $('bgmToast');
  if (el) el.classList.remove('show');
}
function bgmLoadDeck(deck, idx) {
  deck.track = idx;
  deck.playsLeft = 1; // loadedmetadata で短い曲なら 2 に更新される
  deck.audio.src = 'audio/' + BGM_TRACKS[idx].file;
}
/* 指定デッキで曲を単独再生する (開始時・即時切替時)。音量は現在の設定値 */
function bgmPlayTrack(idx) {
  bgmCancelFade();
  var deck = bgmDeck(bgm.active);
  var other = bgm.decks[1 - bgm.active];
  if (other) other.audio.pause();
  bgmLoadDeck(deck, idx);
  bgm.current = idx;
  deck.audio.volume = bgmVolume;
  bgmSetNowPlayingText();
  bgmPlayPromise(deck.audio.play());
}
/* シャッフル順の次の曲 index を返す (一巡したら直前と重ならない次の順列を作る) */
function bgmNextIndex() {
  bgm.pos++;
  if (bgm.pos >= bgm.order.length) {
    bgm.order = nextShuffleOrder(BGM_TRACKS.length, Math.random, bgm.current);
    bgm.pos = 0;
  }
  return bgm.order[bgm.pos];
}
/* フェードなしの即時切替 (終端の保険・エラースキップ用) */
function bgmAdvanceNow() {
  var idx = bgmNextIndex();
  var out = bgm.decks[bgm.active];
  if (out) out.audio.pause();
  bgm.active = 1 - bgm.active;
  bgmPlayTrack(idx);
}
/* ---- クロスフェード ----
 * 監視タイマ (250ms) が「その曲の最後の再生 (短い曲の 2 回目含む) の
 * 終わり際」を検知してフェードを始める。フェード中は 50ms ごとに
 * 等パワー曲線 (crossfadeCurve) で両デッキの音量を書き換える。
 * 音量の基準は常に現在の bgmVolume なので、フェード中の音量変更も
 * 次のティックから自然に反映される。 */
function bgmWatchTick() {
  if (!bgm.started || bgm.fading || bgm.dead || !bgmOn || document.hidden || bgmOnTitle()) return;
  var deck = bgm.decks[bgm.active];
  if (!deck || deck.audio.paused || deck.playsLeft > 1) return;
  var fade = crossfadeDuration(deck.audio.duration);
  if (fade <= 0) return; // フェードできない長さの曲は 'ended' の即時切替に任せる
  if (deck.audio.duration - deck.audio.currentTime <= fade) bgmStartFade(fade);
}
function bgmStartFade(fadeSec) {
  var inIdx = 1 - bgm.active;
  var inDeck = bgmDeck(inIdx);
  var idx = bgmNextIndex();
  bgmLoadDeck(inDeck, idx);
  bgm.current = idx; // クレジットはフェード開始 (新曲が主役になる時点) で切り替える
  bgmSetNowPlayingText();
  inDeck.audio.volume = 0;
  bgmPlayPromise(inDeck.audio.play());
  bgm.fading = { from: bgm.active, into: inIdx, t0: performance.now(), dur: fadeSec * 1000 };
  if (bgm.fadeTimer) clearInterval(bgm.fadeTimer);
  bgm.fadeTimer = setInterval(bgmFadeTick, 50);
  bgmFadeTick();
}
function bgmFadeTick() {
  var f = bgm.fading;
  if (!f) return;
  var g = crossfadeCurve((performance.now() - f.t0) / f.dur);
  bgm.decks[f.from].audio.volume = bgmVolume * g.out;
  bgm.decks[f.into].audio.volume = bgmVolume * g.in;
  if (g.in >= 1) bgmFinishFade();
}
function bgmFinishFade() {
  var f = bgm.fading;
  if (!f) return;
  bgm.fading = null;
  if (bgm.fadeTimer) { clearInterval(bgm.fadeTimer); bgm.fadeTimer = null; }
  var out = bgm.decks[f.from];
  out.audio.pause();
  try { out.audio.currentTime = 0; } catch (e) { /* 未ロード時は無視 */ }
  bgm.active = f.into;
  bgm.decks[f.into].audio.volume = bgmVolume;
}
function bgmCancelFade() {
  if (!bgm.fading) return;
  if (bgm.fadeTimer) { clearInterval(bgm.fadeTimer); bgm.fadeTimer = null; }
  var inDeck = bgm.decks[bgm.fading.into];
  inDeck.audio.pause();
  inDeck.track = -1;
  bgm.fading = null;
  var act = bgm.decks[bgm.active];
  if (act) act.audio.volume = bgmVolume;
}
function bgmStopAll() {
  if (bgm.fadeTimer) { clearInterval(bgm.fadeTimer); bgm.fadeTimer = null; }
  bgm.fading = null;
  bgm.decks.forEach(function (d) { if (d) d.audio.pause(); });
}
/* タイトル画面 (スタート画面) では、まだ一度も BGM が流れていない
 * 間だけ音を出さない (id 19 の改訂、2026-11-10 ユーザー指示)。
 * 一度流れ始めたら (bgm.started)、トップに戻っても止めずに流し続ける。
 * 壁画面は従来どおり最初から例外 (スタート画面から入っても流れる)。
 * uiHome / uiWall は同じクロージャ内で後から宣言される var (参照は実行時のみ)。 */
function bgmOnTitle() { return uiHome && !uiWall && !bgm.started; }
/* 最初の再生開始。呼ばれるのは机に入った時点 (openBox 完了・つづき再開) と、
 * ジェスチャごとの再試行 (bgmTryPlay) から。タイトル画面では開始しない */
function bgmStart() {
  if (bgm.started || !bgmOn || bgmOnTitle()) return;
  bgm.started = true;
  bgm.order = nextShuffleOrder(BGM_TRACKS.length, Math.random, -1);
  bgm.pos = 0;
  if (!bgm.watchTimer) bgm.watchTimer = setInterval(bgmWatchTick, 250);
  bgmPlayTrack(bgm.order[0]);
}
/* ユーザー操作を合図に「鳴るべきなら鳴らす」。未開始なら開始し、開始済み
 * でも止まっていたら音量を適用し直して play() を再試行する。
 * まだ流れていない間のタイトル画面では何もしない (id 19)。
 * オフのとき・全曲読めなかった (dead) とき・タブが隠れているときも同様 */
function bgmTryPlay() {
  if (!bgmOn || bgm.dead || bgmOnTitle()) return;
  if (!bgm.started) { bgmStart(); return; }
  if (bgm.fading) return;
  var deck = bgm.decks[bgm.active];
  if (!deck || document.hidden || !deck.audio.paused) return;
  deck.audio.volume = bgmVolume;
  bgmPlayPromise(deck.audio.play());
}
function bgmApplySettings() {
  syncAudioControls();
  if (!bgmOn) {
    bgmStopAll();
    bgmHideNowPlaying(); // 再生が始まっていないと pause イベントが来ないので明示的に隠す
    return;
  }
  if (!bgm.fading) { // 音量の即時反映 (フェード中はティックが毎回書き直す)
    var deck = bgm.decks[bgm.active];
    if (deck) deck.audio.volume = bgmVolume;
  }
  if (bgm.dead) {
    // 全曲読めなかった状態からの明示的な再試行 (オンに戻す操作自体を合図にする)
    bgm.dead = false;
    bgm.errorStreak = 0;
    if (!bgmOnTitle()) bgmPlayTrack(bgm.current >= 0 ? bgm.current : 0);
  } else if (!bgm.started) {
    bgmStart(); // 設定の操作自体がユーザー操作。ただしタイトル画面では bgmStart 側で止まる
  } else if (!bgm.fading) {
    var d2 = bgm.decks[bgm.active];
    if (d2 && d2.audio.paused && !document.hidden && !bgmOnTitle()) {
      bgmPlayPromise(d2.audio.play()); // オフ→オンに戻したら再開する
    }
  }
}
/* タイトル画面に戻るとき: 一度流れ始めた BGM は止めない (id 19 改訂)。
 * 停止は BGM オフとタブを隠したときだけ。旧仕様の呼び出し箇所
 * (goToStartScreen / restartPuzzle) はそのまま残してある */
function bgmEnterTitle() { /* 流し続ける: 何もしない */ }
/* タブが隠れたら一時停止し、戻ったら再開する (設定でオフのとき・
 * まだ一度も流れていないタイトル画面では再開しない) */
document.addEventListener('visibilitychange', function () {
  if (!bgm.started) return;
  if (document.hidden) {
    var anyPlaying = bgm.decks.some(function (d) { return d && !d.audio.paused; });
    if (anyPlaying) {
      if (bgm.fading) bgmFinishFade();
      bgm.decks.forEach(function (d) { if (d) d.audio.pause(); });
      bgm.hiddenPaused = true;
    }
  } else if (bgm.hiddenPaused) {
    bgm.hiddenPaused = false;
    if (bgmOn && !bgmOnTitle()) {
      var deck = bgm.decks[bgm.active];
      if (deck) bgmPlayPromise(deck.audio.play());
    }
  }
});
/* タブが隠れている間はブラウザがオフスクリーン canvas の実体を落とす
 * ことがある (Firefox Android)。表示に戻ったらビットマップを全捨てして
 * 遅延再生成させ、「ピースが透明なまま」を防ぐ (リサイズ時も resizeStage
 * で同様に捨てる)。 */
document.addEventListener('visibilitychange', function () {
  if (document.hidden || !state) return;
  state.bitmaps.clear();
  state.bitmapFailures.clear();
  bmpIdList = null;
  draw();
});

/* ---- SE (全て Web Audio 合成。音源ファイルなし) ----
 * 掴む = 紙の「サッ」/ 置く = 木の「トッ」/ 合体 = クリック + 2 音チャイム /
 * クリア = オルゴール風アルペジオ / 蓋 = 紙の擦れ + 小さなノック。
 * AudioContext は最初のユーザー操作でだけ生成する (自動再生ポリシー)。 */
/* SE音量: store.seVolume (0〜1、未保存なら 1)。実際のゲインは
 * 基準 SE_MASTER_BASE × seVolume。既定の基準は 0.22 → 0.26 に微増 (2026-11-10 ユーザー指示) */
var SE_MASTER_BASE = 0.26;
var seVolume = (typeof store.seVolume === 'number' && isFinite(store.seVolume))
  ? Math.min(1, Math.max(0, store.seVolume)) : 1;
function seMasterGain() { return SE_MASTER_BASE * seVolume; }
function applySeVolume() { if (seMaster && seCtx) seMaster.gain.setTargetAtTime(seMasterGain(), seCtx.currentTime, 0.02); }
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
    seMaster.gain.value = seMasterGain(); // 基準 0.26 × ユーザーの SE音量 (既定 1)
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
/* タイトル画面 (スタート画面) では音を出さない (id 19)。ゲーム内 SE は
 * スタート画面にいる間は鳴らさない。蓋の音 (seLid) だけは「箱を開ける
 * タップ以降はゲーム開始の一部」として、このゲートの対象外にする */
function seInGame() { return seReady() && !uiHome; }
function seGrab() { // 紙の「サッ」: ノイズのバンドパスを 1200→2400Hz へ上げる
  if (!seInGame()) return;
  seNoise(0.1, 'bandpass', [1200, 2400], 0.5);
}
function seDrop() { // 木の「トッ」: サインのピッチドロップ + ローパスの木の当たり
  if (!seInGame()) return;
  seTone([180, 70], 0.12, 0.6);
  seNoise(0.05, 'lowpass', [900, 500], 0.22);
}
function seMerge() { // クリック + G5→C6 の 2 音チャイム
  if (!seInGame()) return;
  seNoise(0.03, 'highpass', [3000, 3000], 0.3);
  seTone(784, 0.22, 0.22);
  seTone(1046.5, 0.3, 0.22, 'sine', 0.07);
}
function seClear() { // オルゴール風アルペジオ C5-E5-G5-C6 (倍音を薄く重ねる)
  if (!seInGame()) return;
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
function seReward() { // 報酬が届く/選ぶ: キラキラした2音 + 柔らかい決定音
  if (!seInGame()) return;
  seTone(1318.5, 0.25, 0.15);
  seTone(1760, 0.35, 0.13, 'sine', 0.08);
  seTone(659.25, 0.2, 0.09, 'sine', 0.05);
}
/* 配置音を鳴らしてよい場面: プレイ中、または壁画面 (スタート画面経由でも
 * uiWall が立っていれば鳴らす)。素のスタート画面では鳴らさない */
function sePlaceOk() { return seReady() && (!uiHome || uiWall); }
function sePlace() { // 壁に置く: 陶器の「コトン」
  if (!sePlaceOk()) return;
  seTone([320, 140], 0.09, 0.32);
  seNoise(0.04, 'lowpass', [700, 400], 0.14);
}
function seUnplace() { // 壁からしまう: 配置音より控えめな「コトッ」
  if (!sePlaceOk()) return;
  seTone([260, 120], 0.07, 0.15);
  seNoise(0.03, 'lowpass', [600, 350], 0.06);
}
/* ユーザー操作のたびにキャプチャ段階で受ける (ステージ側の pointerdown
 * ハンドラより先に AudioContext の生成と BGM の開始/再試行が走る)。
 * 「最初の操作だけ」ではなく毎回呼ぶのが bgmTryPlay の再試行の要。 */
function onFirstUserGesture() {
  ensureSeContext();
  bgmTryPlay();
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

/* ---------- 画面状態 ---------- */
var todayStr = jstTodayString(); // 実日付 (ラウンド移行時の位置合わせにだけ使う)
/* ステージ制 (2026-11-09 転換): お題はステージ順に何個でも進める。
 * 現在のステージはクリア記録から導出する (保存しないのでズレない)。
 * playDate はステージの日付キー (基準日 + ステージ-1日) で、記録・進捗・
 * 乱数シードのキーは従来どおり日付キーで動く (表示には使わない)。
 * replayStage はコレクションからの再プレイ先 (null = 最新の未挑戦)。 */
var playStage = 1;
var playDate = stageDate(playStage);
var replayStage = null;
function currentStage(pool) { return replayStage || nextStage(store.records, pool); }
function syncPlayStage(pool) {
  playStage = currentStage(pool);
  playDate = stageDate(playStage);
  return playStage;
}
function findRecordForStage(stage, pieces) {
  for (var i = 0; i < store.records.length; i++) {
    var r = store.records[i];
    if (r.pieces === pieces && recordStage(r, state && state.pool) === stage) return r;
  }
  return null;
}
/* 旧セーブの進行中データをステージキーへ移す (1回だけ)。
 * 進行中エントリのステージは、固定済み imgKey のプール位置から決める。
 * imgKey が無い旧エントリは従来の (日付×グループ) 選択で復元する */
function migrateProgressToStages(pool) {
  if (store.stageMigrated) return;
  var entries = poolEntries(pool);
  var np = {};
  Object.keys(store.progress || {}).forEach(function (date) {
    var byDiff = store.progress[date] || {};
    Object.keys(byDiff).forEach(function (pieces) {
      var prog = byDiff[pieces];
      if (!prog) return;
      var stage = null;
      if (prog.imgKey) {
        var e = poolEntryByKey(pool, prog.imgKey);
        if (e) stage = entries.indexOf(e) + 1;
      }
      if (!stage) {
        var ent = pickPoolEntry(date, pool, difficultyGroup(Number(pieces)));
        if (ent) stage = entries.indexOf(ent) + 1;
      }
      if (!stage) return;
      var dk = stageDate(stage);
      if (!np[dk]) np[dk] = {};
      var ex = np[dk][pieces];
      if (!ex || (prog.clusters ? prog.clusters.length : 0) > (ex.clusters ? ex.clusters.length : 0)) np[dk][pieces] = prog;
    });
  });
  store.progress = np;
  store.stageMigrated = true;
  saveStore();
}
var difficulty = DIFFICULTIES.indexOf(store.lastDifficulty) >= 0 ? store.lastDifficulty : 36;
var state = null; // ゲーム開始時に構築

function newGameState(pool) {
  var prog = progressFor(playDate, difficulty);
  var gameStarted = progressIsStarted(prog);
  /* お題の決定 (ステージ制): ステージのお題は stageEntry で決定的。
   * - progress.imgKey が保存されていれば、そのエントリを最優先で維持する
   * - 開始済みなのに imgKey が無い = 旧バージョンで始めた進行中ゲーム。
   *   ステージのお題で引き直し、imgKey を補完保存する
   * - それ以外 (新規) もステージのお題 (開始確定時に imgKey を保存) */
  var entry;
  if (prog.imgKey) {
    entry = poolEntryByKey(pool, prog.imgKey) || stageEntry(playStage, pool);
  } else if (gameStarted) {
    entry = stageEntry(playStage, pool);
    prog.imgKey = poolEntryKey(entry);
    saveStore();
  } else {
    entry = stageEntry(playStage, pool);
  }
  return {
    pool: pool,
    stage: playStage,
    entry: entry,
    imageKey: poolEntryKey(entry),
    imageId: entry && entry.type === 'picsum' ? entry.id : null,
    author: null, authorUrl: null,
    n: Math.round(Math.sqrt(difficulty)),
    edges: generateEdges(playDate, difficulty),
    phase: gameStarted ? 'play' : 'box', // 'box' = スタート画面 (未開封)
    gameStarted: gameStarted,
    opening: false,
    // 読み込み時に机の外へ出てしまったピースを内側へ救済する (机の有限化)。
    // 範囲内のセーブは正規化が冪等なので1ピクセルも動かない
    clusters: gameStarted ? normalizeClustersToRect(prog.clusters.map(function (c) { return { pieces: c.pieces.slice(), surface: 'desk', gx: c.gx, gy: c.gy }; }), Math.round(Math.sqrt(difficulty)), deskBounds(difficulty)) : [],
    elapsedBase: prog.elapsedSec || 0,
    moves: prog.moves || 0,
    previewViewed: !!prog.previewViewed,
    previewCount: prog.previewCount || 0,
    mergeFlash: null,                 // { ids:Set, start:ms } 合体フィードバック
    cleared: !!prog.cleared,
    started: false, paused: false, timerStart: 0,
    views: { desk: null }, // {scale, tx, ty} scaleFit も保持
    bitmaps: new Map(),               // pieceId -> {canvas, path, cellPx, marginPx}
    bitmapFailures: new Map(),        // pieceId -> プローブ連続失敗回数 (作り直しポリシー用)
    srcCanvas: null, boardPx: 0,
    resumed: prog.clusters.length > 0
  };
}
function persistProgress() {
  normalizeClustersInDesk(); // 保存は必ず机の中の配置だけにする (机の有限化の最終担保)
  var prog = progressFor(playDate, difficulty);
  prog.clusters = state.clusters.map(function (c) { return { pieces: c.pieces.slice(), surface: c.surface, gx: c.gx, gy: c.gy }; });
  prog.elapsedSec = currentElapsed();
  prog.moves = state.moves;
  prog.previewViewed = state.previewViewed;
  prog.previewCount = state.previewCount;
  prog.cleared = state.cleared;
  prog.started = state.gameStarted;
  /* ゲーム開始が確定したら、そのときのお題キーを progress に固定する
   * (以後の再開ではこのキーが最優先になり、お題が途中で変わらない) */
  if (state.gameStarted && state.imageKey) prog.imgKey = state.imageKey;
  saveStore();
}
function currentElapsed() {
  return elapsedSeconds({
    base: state.elapsedBase, started: state.started, paused: state.paused,
    cleared: state.cleared, timerStart: state.timerStart
  }, Date.now());
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
/* 画像読み込み: まず CORS (anonymous) で試し、失敗したら素の読み込みに
 * 落とす。ホスト別の実測 (2026-11-08): picsum / thumb.wikimedia.org /
 * images.metmuseum.org は Access-Control-Allow-Origin:* を返すが、
 * openaccess-cdn.clevelandart.org は返さないため CORS モードでは読めない。
 * 素読み込みだとキャンバスは汚染されるが、ピクセル読み取り系は全て
 * try/catch + 代替色フォールバックで守ってある (pieceSideColor 等)。 */
function loadImgCorsFallback(url) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () { resolve(img); };
    img.onerror = function () {
      var plain = new Image();
      plain.onload = function () { resolve(plain); };
      plain.onerror = function () { reject(new Error('image load failed')); };
      plain.src = url;
    };
    img.src = url;
  });
}
function loadSourceImage() {
  var size = imageSizeFor(difficulty);
  var url = entryPhotoUrl(state.entry, size);
  if (!url) return Promise.resolve({ img: makeFallbackCanvas(playDate), fallback: true });
  return loadImgCorsFallback(url).then(
    function (img) { return { img: img, fallback: false }; },
    function () { return { img: makeFallbackCanvas(playDate), fallback: true }; });
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fetchCredit() {
  // トップ画面にクレジットは出さない (ユーザー指定)。帰属表示は設定シートの
  // クレジットモーダル (photoCredits) に集約。ここでは記録用の著者名だけ取る
  var e = state.entry;
  if (e && e.type === 'url') return;
  if (!state.imageId) return;
  fetch('https://picsum.photos/id/' + state.imageId + '/info')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (info) {
      if (!info) return;
      state.author = info.author; state.authorUrl = info.url;
    })
    .catch(function () { /* 著者名なしでも遊べる */ });
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
/* ビットマップの健全性プローブ: 中心部 (セルの中心はどの形状でも必ず
 * ピースの内側) の alpha を読み、1つでも不透明なら正常とみなす。
 * Firefox Android ではメモリ逼迫時にオフスクリーン canvas の実体が
 * 黙って失われ、drawImage しても何も描かれないことがある (輪郭パスは
 * JS 側に残るので「輪郭だけの中空ピース」になる)。読み取れない環境
 * では干渉しないよう正常扱いにする。 */
function probePieceBitmap(bmp) {
  try {
    var ctx = bmp.canvas.getContext('2d');
    var cx = Math.round(bmp.marginPx + bmp.cellPx / 2), cy = Math.round(bmp.marginPx + bmp.cellPx / 2);
    var data = ctx.getImageData(Math.max(0, cx - 3), Math.max(0, cy - 3), 6, 6).data;
    var alphas = [];
    for (var i = 3; i < data.length; i += 4) alphas.push(data[i]);
    return bitmapProbeOk(alphas);
  } catch (e) { return true; }
}
function pieceBitmap(id) {
  var cached = state.bitmaps.get(id);
  if (cached) return cached;
  var failures = state.bitmapFailures.get(id) || 0;
  var bmp = renderPieceBitmap(id);
  if (probePieceBitmap(bmp)) {
    state.bitmapFailures.delete(id);
    state.bitmaps.set(id, bmp);
    return bmp;
  }
  // 描いたはずのビットマップが透明なまま = 実体が失われた疑い。
  // 異常なビットマップを恒常キャッシュするとセッション中ずっと中空に
  // なるため、ポリシー (bitmapRetryPlan) に従って作り直す/再試行する。
  failures++;
  state.bitmapFailures.set(id, failures);
  var plan = bitmapRetryPlan(failures);
  if (plan.retryNow) {
    var retry = renderPieceBitmap(id);
    if (probePieceBitmap(retry)) {
      state.bitmapFailures.delete(id);
      state.bitmaps.set(id, retry);
      return retry;
    }
    bmp = retry;
    failures++;
    state.bitmapFailures.set(id, failures);
    plan = bitmapRetryPlan(failures);
  }
  if (plan.giveUp) state.bitmaps.set(id, bmp); // 諦めてキャッシュ (スポットチェックで回復検出は続く)
  return bmp;
}
/* 描画中ビットマップのローテーションチェック: draw() のたびに最大1つだけ
 * プローブし、実体が失われていたらキャッシュから捨てる (次回描画で
 * 作り直される)。全数チェックは重いので、遊んでいるうちに一巡する
 * この方式で「透明なまま固定」を防ぐ。 */
var bmpProbePos = 0, bmpIdList = null;
function spotCheckBitmap() {
  if (!state || !state.bitmaps.size) return;
  if (!bmpIdList || bmpIdList.length !== state.bitmaps.size) bmpIdList = Array.from(state.bitmaps.keys());
  if (!bmpIdList.length) return;
  var id = bmpIdList[bmpProbePos % bmpIdList.length];
  bmpProbePos++;
  var bmp = state.bitmaps.get(id);
  // 生成直後 (<2秒) は対象外: 生成時プローブと二重に再生成が走って
  // スラッシングになるのを防ぐ (実体の喪失は時間をおいて起こる前提)
  if (bmp && bmp.createdAt && Date.now() - bmp.createdAt > 2000 && !probePieceBitmap(bmp)) {
    state.bitmaps.delete(id);
    bmpIdList = null;
  }
}
function renderPieceBitmap(id) {
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
  // 写真面: 描画自体が例外になる環境では側面色で塗って「見える」状態に
  // 留める (例外で draw() 全体が死んで画面が固まるよりましな劣化にする)
  ctx.save();
  ctx.clip(path);
  try {
    ctx.drawImage(state.srcCanvas, marginPx - home.col * cellPx, marginPx - home.row * cellPx, state.boardPx, state.boardPx);
  } catch (e) {
    ctx.fillStyle = pieceSideColor(id, cellPx);
    ctx.fillRect(0, 0, sizePx, sizePx);
  }
  ctx.restore();
  // 縁のベベル (上・左に光、下・右に影)。既存の輪郭線はこの上に引いて締める
  strokePieceBevel(ctx, path, relief.bevel);
  ctx.strokeStyle = 'rgba(30,30,30,0.35)';
  ctx.lineWidth = Math.max(1, cellPx * 0.02);
  ctx.stroke(path);
  return { canvas: cv, path: path, cellPx: cellPx, marginPx: marginPx, createdAt: Date.now() };
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
  // リサイズはブラウザがオフスクリーン canvas の実体を落とす契機にもなる
  // (向き変更・ツールバー伸縮)。ビットマップは遅延再生成されるので、
  // ここで全捨てして「透明なまま固定」を防ぐ (失敗カウントもリセット)。
  if (state) { state.bitmaps.clear(); state.bitmapFailures.clear(); bmpIdList = null; }
  if (state && !state.views.desk) fitViews();
  if (state && state.views.desk) clampCamera();
  draw();
}
function fitView() {
  // 机ワールド = 散らばり領域そのもの (盤面 [0,n]² を含む)。
  // fit (表示100%) とズーム下限はこの領域に追随する。
  var n = state.n;
  var r = scatterRect(n * n);
  var worldW = r.w * CELL, worldH = r.h * CELL;
  var ox = r.x0 * CELL, oy = r.y0 * CELL;
  var fit = Math.min(stageW / worldW, stageH / worldH);
  return { scale: fit, fit: fit, tx: (stageW - worldW * fit) / 2 - ox * fit, ty: (stageH - worldH * fit) / 2 - oy * fit };
}
function fitViews() {
  if (!stageW || !stageH) return; // プレイ画面が非表示の間はフィット計算しない (表示時に resizeStage が行う)
  state.views.desk = fitView();
  invalidateDeskBackdrop(); // 机カメラが変わるので背景レイヤーを作り直す
}
function view() { return state.views.desk; }
/* 机の有限化 (PBI #27、設計は DESIGN.md): 境界は deskBounds (散らばり
 * 領域の縦横2倍 = 最低倍率で見える全範囲)。ピースもカメラもここを
 * 出ない。クランプは平行移動のみで、塊の内部配置・合体の成否は
 * 変えない。保存形式も変えない (値の範囲だけ制限) */
function deskRect() { return deskBounds(state.n * state.n); }
function clampClusterInDesk(cluster) {
  var c = clampClusterToRect(cluster, state.n, deskRect());
  cluster.gx = c.gx; cluster.gy = c.gy;
}
function clampGroupInDesk(clusters) {
  var t = clampClustersTranslation(clusters, state.n, deskRect());
  if (!t.dx && !t.dy) return;
  clusters.forEach(function (cl) { cl.gx += t.dx; cl.gy += t.dy; });
}
/* 全塊を机の中へ正規化する (保存前の最終担保と、読み込み時の救済で使う) */
function normalizeClustersInDesk() {
  state.clusters.forEach(function (cl) { clampClusterInDesk(cl); });
}
/* カメラの行き過ぎ防止: 机の端から画面の半分より外は見せない */
function clampCamera() {
  var v = view();
  if (!v || !state || !stageW || !stageH) return;
  var r = deskRect();
  var left = r.x0 * CELL, top = r.y0 * CELL;
  var right = (r.x0 + r.w) * CELL, bot = (r.y0 + r.h) * CELL;
  var minTx = stageW / 2 - right * v.scale, maxTx = stageW / 2 - left * v.scale;
  var minTy = stageH / 2 - bot * v.scale, maxTy = stageH / 2 - top * v.scale;
  v.tx = Math.min(maxTx, Math.max(minTx, v.tx));
  v.ty = Math.min(maxTy, Math.max(minTy, v.ty));
}
function worldToScreen(wx, wy) { var v = view(); return { x: wx * v.scale + v.tx, y: wy * v.scale + v.ty }; }
function screenToWorld(sx, sy) { var v = view(); return { x: (sx - v.tx) / v.scale, y: (sy - v.ty) / v.scale }; }

/* ---------- 机のテクスチャ (承認済み画像をそのまま敷く) ----------
 * 机の絵柄は、モック生成と同じコードで作ったテクスチャ画像
 * (desk-textures/tex-<テーマ>.jpg, 1200x1200・継ぎ目なくタイル可能) を
 * そのまま使う。Canvas の手続き描画で近似するとモックと実機で質感が
 * ずれるため、画像のピクセルを加工せずに敷く (2026-11-08 ユーザー指定)。
 * 1タイル = 512 ワールド単位で、位相はワールド原点に固定して敷くので
 * パン/ズームに追随して「机の上を動いている」感触になる (縮尺はモックの
 * ピース 218px : テクスチャ 1200px とほぼ一致する)。
 * 敷き方は CanvasPattern ではなく drawImage の明示タイル敷き: パターンの
 * setTransform はブラウザ差で実効スケールがずれることがあり (マットで
 * ピンチを繰り返したあと机の継ぎ目が太く崩れるバグの原因)、テクスチャ側に
 * 可変状態を持たせないことで机とマットの状態干渉も断つ。
 * 読み込み前/失敗時はテーマの地色 (テクスチャの平均色) で塗る。
 * グリーンマットの「柔らかい光沢」だけはテクスチャに焼き込まれていない
 * ので、drawDeskVignette が画面固定の薄い光を別途重ねる (モックでも
 * 画面基準の光だったため、見え方は同等になる)。 */
var DESK_TEX_WORLD = 1024; // テクスチャ1タイルのワールド寸法
var deskTexState = {}; // テーマキー -> { img: 読み込み済み Image | null, failed: bool }
/* テーマのテクスチャ画像を返す (読み込み開始は初回アクセス時)。
 * 読み込みが終わったら、地色ベタで作られた背景キャッシュを捨てて
 * テクスチャで描き直すよう通知する。 */
function getDeskTexture(key) {
  var st = deskTexState[key];
  if (!st) {
    st = { img: null, failed: false };
    deskTexState[key] = st;
    try {
      var im = new Image();
      im.onload = function () {
        st.img = im;
        deskBgWorld = null; // 世界空間キャッシュを作り直す (キーは不変だが中身が地色→画像になる)
        invalidateDeskBackdrop(); // マット背景の机レイヤーも作り直す
        if (state) draw();
      };
      im.onerror = function () { st.failed = true; };
      im.src = THEMES[key].desk.tex;
    } catch (e) { st.failed = true; }
  }
  return st.img;
}
/* 机の背景を ctx に描く (w, h は CSS px の描画領域)。メイン画面とマット背景の
 * 「ぼんやりした机」レイヤーの両方から使う。タイルはワールド固定で敷く:
 * 1タイル = 512ワールド単位、画面上は 512 * v.scale px になり、開始位置は
 * woodTileOrigin でワールド原点に位相を合わせる。 */
function drawDeskBackgroundOn(ctx, v, w, h) {
  var pal = THEMES[uiTheme].desk;
  ctx.fillStyle = pal.base;
  ctx.fillRect(0, 0, w, h);
  var tile = null;
  try { tile = getDeskTexture(uiTheme); } catch (e) { tile = null; }
  if (tile) {
    var ts = DESK_TEX_WORLD * v.scale; // タイルの画面サイズ (CSS px)
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
  drawDeskVignette(ctx, w, h);
}
/* 机全体にゆるい陰影 (ビネット) をつけて天板らしくする。ビネットは
 * 画面空間で決まるので、世界空間キャッシュには焼かず毎回上に描く。 */
function drawDeskVignette(ctx, w, h) {
  var pal = THEMES[uiTheme].desk;
  var vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, pal.vigLight);
  vg.addColorStop(1, pal.vigDark);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  // テーマによっては画面固定の柔らかい光を重ねる (グリーンマットの光沢:
  // テクスチャには焼き込まれていない要素で、モックでも画面基準の光)
  if (pal.sheen) {
    var sg = ctx.createRadialGradient(w * 0.3, h * 0.12, 0, w * 0.3, h * 0.12, Math.max(w, h) * 0.72);
    sg.addColorStop(0, pal.sheen);
    sg.addColorStop(1, 'rgba(255,255,240,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, w, h);
  }
}
/* 世界座標に変換済みの ctx へ、ワールド矩形 rect の範囲だけ下地色 +
 * テクスチャタイルを敷く (机背景の世界空間キャッシュ生成用)。タイルの位相は
 * ワールド原点基準 (DESK_TEX_WORLD の倍数) で、画面空間版 (drawDeskBackgroundOn の
 * woodTileOrigin) と一致する。ビネットは含まない。 */
function paintDeskTiles(ctx, rect) {
  var pal = THEMES[uiTheme].desk;
  ctx.fillStyle = pal.base;
  ctx.fillRect(rect.x0, rect.y0, rect.w, rect.h);
  var tile = null;
  try { tile = getDeskTexture(uiTheme); } catch (e) { tile = null; }
  if (!tile) return;
  var x0 = Math.floor(rect.x0 / DESK_TEX_WORLD) * DESK_TEX_WORLD, y0 = Math.floor(rect.y0 / DESK_TEX_WORLD) * DESK_TEX_WORLD;
  for (var x = x0; x < rect.x0 + rect.w; x += DESK_TEX_WORLD) {
    for (var y = y0; y < rect.y0 + rect.h; y += DESK_TEX_WORLD) {
      ctx.drawImage(tile, x, y, DESK_TEX_WORLD, DESK_TEX_WORLD);
    }
  }
}
/* 机背景のキャッシュ (世界空間・固定解像度)。
 * 旧方式は「画面全体をカメラ込みキーでキャッシュ」し、カメラが動くたび
 * (ピンチ/パンの毎フレーム) に画面全体を手続き描画し直していた。Firefox
 * Android ではその最中に背景が横縞に化ける表示崩れが残ったため、キャッシュ
 * をカメラから切り離す: 覆う範囲 (deskBgRegionCells) と解像度 (deskBgPlan)
 * はテーマ・難易度・ステージ寸法だけで決まり、カメラ移動では作り直されない。
 * 毎フレームの仕事は deskBgBlit が返す部分矩形の転写 + ビネットだけになる。
 * 転写矩形は整数アライン + 等倍率 (deskBgBlit の保証) なので、引き伸ばしや
 * 潰れは起こらない。範囲外のカメラでは直接描画にフォールバックする。 */
var DESK_BG_MAX_DIM = 4096, DESK_BG_MAX_AREA = 8388608; // 4096×2048 相当を上限にする
var deskBgWorld = null; // { key, canvas, region, plan }
var deskBgWorldFailed = false; // 生成に失敗したセッションでは直接描画に固定する
function ensureDeskBgWorld() {
  if (!state) return null;
  var rc = deskBgRegionCells(state.n * state.n, stageW, stageH, CELL);
  var region = { x0: rc.x0 * CELL, y0: rc.y0 * CELL, w: rc.w * CELL, h: rc.h * CELL };
  var key = uiTheme + '|' + stageW + 'x' + stageH + '|' + region.x0 + ',' + region.y0 + ',' + region.w + 'x' + region.h;
  if (deskBgWorld && deskBgWorld.key === key) return deskBgWorld;
  var plan = deskBgPlan(region.w, region.h, DESK_BG_MAX_DIM, DESK_BG_MAX_AREA);
  if (!plan) { deskBgWorld = null; return null; }
  try {
    var cv = document.createElement('canvas');
    cv.width = plan.wPx; cv.height = plan.hPx;
    var c2 = cv.getContext('2d');
    c2.setTransform(plan.R, 0, 0, plan.R, -region.x0 * plan.R, -region.y0 * plan.R);
    paintDeskTiles(c2, region);
    deskBgWorld = { key: key, canvas: cv, region: region, plan: plan };
  } catch (e) {
    deskBgWorld = null;
    deskBgWorldFailed = true;
  }
  return deskBgWorld;
}
function drawDeskBackground(v) {
  if (!stageW || !stageH) { drawDeskBackgroundOn(sctx, v, stageW, stageH); return; }
  var bg = deskBgWorldFailed ? null : ensureDeskBgWorld();
  var blit = bg ? deskBgBlit(v, stageW, stageH, bg.region, bg.plan) : null;
  if (!blit) { drawDeskBackgroundOn(sctx, v, stageW, stageH); return; }
  // 転写はソース整数矩形 → 等倍率デスト矩形のみ (deskBgBlit)。端数の
  // ズレで端に隙間が出ても、下地色を先に全面へ敷くので透けはしない。
  var pal = THEMES[uiTheme].desk;
  sctx.fillStyle = pal.base;
  sctx.fillRect(0, 0, stageW, stageH);
  sctx.drawImage(bg.canvas, blit.sx, blit.sy, blit.sw, blit.sh, blit.dx, blit.dy, blit.dw, blit.dh);
  drawDeskVignette(sctx, stageW, stageH);
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

/* 机の境界の見える化: 可動範囲 (deskBounds) の外側を無彩色の半透明
 * ベールで落とし、境界に細い明線を引く。「見えない壁」で止められる
 * 感覚を無くすため (ユーザー指示 2026-11-10)。色味は付けない
 * (盤外ベールの無彩色ルールと同じ)。ピースより下・机より上に描く */
function drawDeskBoundary(v) {
  var r = deskRect();
  var x0 = r.x0 * CELL * v.scale + v.tx, y0 = r.y0 * CELL * v.scale + v.ty;
  var x1 = (r.x0 + r.w) * CELL * v.scale + v.tx, y1 = (r.y0 + r.h) * CELL * v.scale + v.ty;
  sctx.fillStyle = 'rgba(38,32,24,0.34)';
  if (y0 > 0) sctx.fillRect(0, 0, stageW, y0);
  if (y1 < stageH) sctx.fillRect(0, y1, stageW, stageH - y1);
  if (x0 > 0) sctx.fillRect(0, Math.max(0, y0), x0, Math.min(stageH, y1) - Math.max(0, y0));
  if (x1 < stageW) sctx.fillRect(x1, Math.max(0, y0), stageW - x1, Math.min(stageH, y1) - Math.max(0, y0));
  sctx.strokeStyle = 'rgba(255,250,238,0.5)';
  sctx.lineWidth = 2;
  sctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
}

function draw() {
  if (!state || !state.srcCanvas || !state.views.desk) return;
  carryClusterPos();
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  var v = view(), n = state.n;
  drawDeskBackground(v);
  drawDeskBoundary(v);
  // 机でカメラが動いたらミニマップを出す (初回は現在値で初期化だけする)
  var camKey = v.scale.toFixed(4) + '|' + v.tx.toFixed(1) + '|' + v.ty.toFixed(1);
  if (lastCamKey === '') lastCamKey = camKey;
  else if (camKey !== lastCamKey) { lastCamKey = camKey; pokeMinimap(); }
  // 表示範囲のカリング: 画面内にある塊だけ描く
  var wTl = screenToWorld(0, 0), wBr = screenToWorld(stageW, stageH);
  var ordered = state.clusters.slice();
  if (drag && drag.cluster) {
    // ドラッグ中の塊 (範囲選択時はグループ全塊) を最前面に描く
    var tops = drag.group ? drag.group.map(function (g) { return g.cluster; }) : [drag.cluster];
    ordered = ordered.filter(function (c) { return tops.indexOf(c) < 0; })
      .concat(ordered.filter(function (c) { return tops.indexOf(c) >= 0; }));
  }
  ordered.forEach(function (cl) { drawCluster(cl, wTl, wBr); });
  spotCheckBitmap(); // 失われたビットマップがあれば1つまで検出して捨てる (次回描画で回復)
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
      var anchor = pieceHome(clusterAnchorId(cl), n);
      cl.pieces.forEach(function (id) {
        var home = pieceHome(id, n);
        var wx = (cl.gx + (home.col - anchor.col)) * CELL, wy = (cl.gy + (home.row - anchor.row)) * CELL;
        if (wx + CELL * 1.4 < wTl.x || wx - CELL * 0.4 > wBr.x || wy + CELL * 1.4 < wTl.y || wy - CELL * 0.4 > wBr.y) return;
        strokePiece(id, wx, wy, brass, 3, hexToRgba(brass, 0.16));
      });
    });
  }
  // 持ち運び中: 運んでいる塊の輪郭を金色でハイライトする
  if (carry) {
    var cAnchor = pieceHome(clusterAnchorId(carry.cluster), n);
    carry.cluster.pieces.forEach(function (id) {
      var cHome = pieceHome(id, n);
      var cwx = (carry.cluster.gx + (cHome.col - cAnchor.col)) * CELL, cwy = (carry.cluster.gy + (cHome.row - cAnchor.row)) * CELL;
      if (cwx + CELL * 1.4 < wTl.x || cwx - CELL * 0.4 > wBr.x || cwy + CELL * 1.4 < wTl.y || cwy - CELL * 0.4 > wBr.y) return;
      strokePiece(id, cwx, cwy, '#e8b64c', 3.5, 'rgba(232,182,76,0.20)');
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
  if (!state) return;
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

/* マット画面 (机をベール越しに見せる背景) は面の統合で廃止した。
 * 背景レイヤーの無効化フックは呼び出し箇所が残っているため空関数で受ける */
function invalidateDeskBackdrop() { /* 面の統合により不要 (互換のため残置) */ }

/* ヒットテスト: 画面座標 → 塊 (最前面優先) */
function hitCluster(sx, sy) {
  var w = screenToWorld(sx, sy);
  var list = state.clusters;
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
var drag = null;         // { cluster, grabDX, grabDY, moved, group }
var carry = null;        // 持ち運び中 { cluster, group, anchorX, anchorY, grabDX, grabDY }
/* 運んでいる塊は「掴んだ画面位置」に留まるよう、カメラが動くたびに
 * ワールド座標を引き直す (塊は画面に張り付き、世界が下を流れる) */
function carryClusterPos() {
  if (!carry) return;
  var w = screenToWorld(carry.anchorX, carry.anchorY);
  carry.cluster.gx = w.x / CELL - carry.grabDX;
  carry.cluster.gy = w.y / CELL - carry.grabDY;
  if (carry.group) {
    carry.group.forEach(function (g) {
      if (g.cluster === carry.cluster) return;
      g.cluster.gx = carry.cluster.gx + g.offX;
      g.cluster.gy = carry.cluster.gy + g.offY;
    });
    clampGroupInDesk(carry.group.map(function (g) { return g.cluster; })); // 机の端で止める (和集合)
  } else {
    clampClusterInDesk(carry.cluster); // 机の端で止める
  }
}
function startCarry(cluster, group, sx, sy, grabDX, grabDY) {
  carry = { cluster: cluster, group: group, anchorX: sx, anchorY: sy, grabDX: grabDX, grabDY: grabDY };
  draw();
}
/* 運び中の塊をその場に置く (グリッド吸着・合体・保存は settleDrag に任せる) */
function dropCarry() {
  if (!carry) return;
  var cl = carry.cluster, group = carry.group;
  carry = null;
  drag = { cluster: cl, group: group, moved: true, grabDX: 0, grabDY: 0, sx: 0, sy: 0, lastX: 0, lastY: 0, movedFar: true };
  settleDrag();
}
/* タップされた塊を持ち上げる (掴み始めの処理はドラッグ開始と共通) */
function beginCarryForCluster(hit, p) {
  if (state.cleared) return;
  if (state.clusters.indexOf(hit.cluster) < 0) return; // 直前の配置で合体済みなら持ち上げない
  var w = screenToWorld(p.x, p.y);
  var inSelection = selection.has(hit.cluster);
  if (!inSelection) clearSelection();
  state.clusters.splice(state.clusters.indexOf(hit.cluster), 1);
  state.clusters.push(hit.cluster);
  var group = null;
  if (inSelection && selection.size > 1) {
    group = Array.from(selection).map(function (c) {
      return { cluster: c, offX: c.gx - hit.cluster.gx, offY: c.gy - hit.cluster.gy };
    });
  }
  seGrab();
  startTimerOnce();
  startCarry(hit.cluster, group, p.x, p.y, w.x / CELL - hit.cluster.gx, w.y / CELL - hit.cluster.gy);
}
/* ドラッグ中の塊 (グループ含む) を現在のポインタ位置へ置く */
function positionDraggedCluster() {
  var w = screenToWorld(drag.lastX, drag.lastY);
  drag.cluster.gx = w.x / CELL - drag.grabDX;
  drag.cluster.gy = w.y / CELL - drag.grabDY;
  if (drag.group) {
    drag.group.forEach(function (g) {
      if (g.cluster === drag.cluster) return;
      g.cluster.gx = drag.cluster.gx + g.offX;
      g.cluster.gy = drag.cluster.gy + g.offY;
    });
    clampGroupInDesk(drag.group.map(function (g) { return g.cluster; })); // 机の端で止める (和集合)
  } else {
    clampClusterInDesk(drag.cluster); // 机の端で止める
  }
}
/* ドラッグ中の端スクロール: ピースを画面端に押し当て続けるとカメラが
 * 自動で流れ、そのまま遠くまで運べる。速度は端への近さで変わる */
var edgeScrollRaf = 0;
function kickEdgeScroll() { if (!edgeScrollRaf) edgeScrollRaf = requestAnimationFrame(edgeScrollStep); }
function stopEdgeScroll() { if (edgeScrollRaf) { cancelAnimationFrame(edgeScrollRaf); edgeScrollRaf = 0; } }
function edgeScrollStep() {
  edgeScrollRaf = 0;
  if (!drag) return;
  var r = stage.getBoundingClientRect();
  var M = 52, MAXV = 16;
  var vx = 0, vy = 0;
  if (drag.lastX < M) vx = MAXV * (1 - drag.lastX / M);
  else if (drag.lastX > r.width - M) vx = -MAXV * (1 - (r.width - drag.lastX) / M);
  if (drag.lastY < M) vy = MAXV * (1 - drag.lastY / M);
  else if (drag.lastY > r.height - M) vy = -MAXV * (1 - (r.height - drag.lastY) / M);
  if (!vx && !vy) return;
  view().tx += vx; view().ty += vy;
  clampCamera(); // 端スクロールでも机の外へ行き過ぎない
  positionDraggedCluster();
  requestDraw();
  kickEdgeScroll();
}
/* ---------- お助け: 同系色の山にまとめる ----------
 * バラのピース (1個だけの塊) を平均色で色系統に分け、散らばり領域内に
 * 山を作って集める。2個以上くっついた塊は動かさない。山の中は整列させず
 * ランダムにごちゃっと重なる配置。移動はアニメーションで滑らせ、終わりに
 * 全体が見えるフィット視点までカメラも寄せる */
var sortAnim = null; // { items: [{cluster, fromX, fromY, toX, toY}], viewFrom, viewTo, start, dur }
/* 平均色グリッド (data/colors.json): CORS ヘッダを返さないホスト (Cleveland 等) の
 * 画像は素読み込みになってキャンバスが汚染され、getImageData が例外を投げる。
 * その画像向けに、全 URL 画像の平均色を 16x16 グリッドで事前計算して同梱し、
 * pieceAvgColor のフォールバックとして使う。必要になった時だけ遅延 fetch する。 */
var COLOR_GRID_N = 16;
var colorGrids = null;
var colorGridsLoading = null;
function loadColorGrids() {
  if (colorGrids) return Promise.resolve(colorGrids);
  if (!colorGridsLoading) {
    colorGridsLoading = fetch('data/colors.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var out = {};
        if (j && j.colors) Object.keys(j.colors).forEach(function (k) {
          try {
            var bin = atob(j.colors[k]);
            var u = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
            if (u.length === COLOR_GRID_N * COLOR_GRID_N * 3) out[k] = u;
          } catch (e) { /* 壊れたエントリは読み飛ばす */ }
        });
        colorGrids = out;
        return colorGrids;
      })
      .catch(function () { colorGrids = {}; return colorGrids; });
  }
  return colorGridsLoading;
}
function gridAvgColor(id) {
  var e = state.entry;
  if (!e || e.key == null || !colorGrids) return null;
  var g = colorGrids[String(e.key)];
  if (!g) return null;
  var n = state.n, home = pieceHome(id, n), G = COLOR_GRID_N;
  var ix0 = Math.max(0, Math.floor((home.col + 0.2) / n * G)), ix1 = Math.min(G - 1, Math.ceil((home.col + 0.8) / n * G) - 1);
  var iy0 = Math.max(0, Math.floor((home.row + 0.2) / n * G)), iy1 = Math.min(G - 1, Math.ceil((home.row + 0.8) / n * G) - 1);
  var r = 0, gg = 0, b = 0, cnt = 0;
  for (var y = iy0; y <= iy1; y++) for (var x = ix0; x <= ix1; x++) {
    var o = (y * G + x) * 3;
    r += g[o]; gg += g[o + 1]; b += g[o + 2]; cnt++;
  }
  return cnt ? [r / cnt, gg / cnt, b / cnt] : null;
}
function pieceAvgColor(id, sctx2) {
  var n = state.n;
  var home = pieceHome(id, n);
  var src = state.srcCanvas;
  var cw = src.width / n, ch = src.height / n;
  var x0 = Math.floor(home.col * cw + cw * 0.2), y0 = Math.floor(home.row * ch + ch * 0.2);
  var w = Math.max(2, Math.floor(cw * 0.6)), h = Math.max(2, Math.floor(ch * 0.6));
  var data;
  try { data = sctx2.getImageData(x0, y0, w, h).data; }
  catch (err) {
    var gc = gridAvgColor(id);
    if (gc) return gc;
    throw err;
  }
  var r = 0, g = 0, b = 0, cnt = 0;
  for (var i = 0; i < data.length; i += 16) { r += data[i]; g += data[i + 1]; b += data[i + 2]; cnt++; }
  return [r / cnt, g / cnt, b / cnt];
}
function sortSinglesByColor() {
  if (!state || state.cleared || sortAnim) return;
  // 進行中のジェスチャは確定させずに解除する (塊はその場に残る)
  if (drag) { drag = null; stopEdgeScroll(); }
  carry = null;
  clearSelection();
  pointers.clear(); pinch = null; panStart = null;
  if (pressPending) { clearTimeout(pressPending.timer); pressPending = null; }
  selRect = null;
  var singles = state.clusters.filter(function (c) { return c.pieces.length === 1; });
  if (singles.length < 2) { showToast('バラのピースが少ないよ'); draw(); return; }
  try { runSortSingles(singles); }
  catch (err) {
    // ピクセルが読めない画像 (CORS 汚染): 平均色グリッドを読み込んで一度だけやり直す
    loadColorGrids().then(function () {
      try { runSortSingles(singles); }
      catch (err2) { showToast('この画像では色分けできなかったよ'); draw(); }
    });
  }
}
function runSortSingles(singles) {
  var sctx2 = state.srcCanvas.getContext('2d');
  // 固定の色区分ではなく、残っているピース同士の相対的な色の開きで分ける
  var labs = singles.map(function (c) { return rgbToLab(pieceAvgColor(c.pieces[0], sctx2)); });
  var groups = clusterByColor(labs).map(function (idxs) {
    return idxs.map(function (i) { return singles[i]; });
  });
  if (groups.length < 2) { showToast('ほぼ同じ色合いのピースばかりだよ'); return; }
  groups.sort(function (a, b) { return b.length - a.length; });
  var rect = scatterRect(state.n * state.n);
  var cols = Math.ceil(Math.sqrt(groups.length)), rows = Math.ceil(groups.length / cols);
  var cellW = rect.w / cols, cellH = rect.h / rows;
  var items = [];
  var ordered = state.clusters.filter(function (c) { return c.pieces.length > 1; });
  groups.forEach(function (group, i) {
    var cx = rect.x0 + (i % cols + 0.5) * cellW, cy = rect.y0 + (Math.floor(i / cols) + 0.5) * cellH;
    var list = group.slice();
    for (var j = list.length - 1; j > 0; j--) { var k = (Math.random() * (j + 1)) | 0; var t = list[j]; list[j] = list[k]; list[k] = t; }
    var rad = Math.max(0.7, Math.min(0.55 * Math.sqrt(list.length), Math.max(cellW, cellH) * 0.55));
    list.forEach(function (c) {
      var ang = Math.random() * Math.PI * 2, dist = rad * Math.sqrt(Math.random());
      items.push({ cluster: c, fromX: c.gx, fromY: c.gy, toX: cx + Math.cos(ang) * dist - 0.5, toY: cy + Math.sin(ang) * dist - 0.5 });
      ordered.push(c);
    });
  });
  state.clusters = ordered;
  var v = view();
  var fv = fitView();
  sortAnim = {
    items: items, start: performance.now(), dur: 650,
    viewFrom: { scale: v.scale, tx: v.tx, ty: v.ty },
    viewTo: { scale: fv.scale, tx: fv.tx, ty: fv.ty }
  };
  requestAnimationFrame(sortAnimStep);
  showToast(groups.length + '色の山に分けたよ');
}
function sortAnimStep(now) {
  if (!sortAnim) return;
  var t = Math.min(1, (now - sortAnim.start) / sortAnim.dur);
  var e = 1 - Math.pow(1 - t, 3);
  sortAnim.items.forEach(function (it) {
    it.cluster.gx = it.fromX + (it.toX - it.fromX) * e;
    it.cluster.gy = it.fromY + (it.toY - it.fromY) * e;
  });
  var v = view();
  v.scale = sortAnim.viewFrom.scale + (sortAnim.viewTo.scale - sortAnim.viewFrom.scale) * e;
  v.tx = sortAnim.viewFrom.tx + (sortAnim.viewTo.tx - sortAnim.viewFrom.tx) * e;
  v.ty = sortAnim.viewFrom.ty + (sortAnim.viewTo.ty - sortAnim.viewFrom.ty) * e;
  updateZoomLabel();
  draw();
  if (t < 1) requestAnimationFrame(sortAnimStep);
  else { sortAnim = null; persistProgress(); draw(); }
}
var pointers = new Map();
var pinch = null;        // { d0, scale0, cx, cy, tx0, ty0 }
var panStart = null;     // { sx, sy, tx, ty }

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
  selection = new Set(clustersInRect(state.clusters, state.n, rect));
  draw();
}

function stagePos(ev) {
  var r = stage.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}
stage.addEventListener('pointerdown', function (ev) {
  if (!state || state.phase !== 'play' || uiHome || uiCollection) return;
  if (sortAnim) return; // お助けのアニメーション中は操作を受けない
  stage.setPointerCapture(ev.pointerId);
  var p = stagePos(ev);
  if (!pointers.has(ev.pointerId) && pointers.size >= 2) resetGestureState();
  pointers.set(ev.pointerId, p);
  if (pointers.size === 2) {
    // ピンチ開始: 掴んでいた塊はその場で確定 (吸着/合体/保存) させてからピンチへ切り替える。
    // (旧実装は drag を捨てていたため、塊が浮いたまま未保存になることがあった)
    // 範囲選択の長押し判定・矩形はピンチが優先なので打ち切る (ピンチ中は選択操作をしない)
    cancelPressAndRect();
    if (drag) settleDrag();
    panStart = null;
    var pts = Array.from(pointers.values());
    pinch = {
      d0: Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
      cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2,
      scale0: view().scale, tx0: view().tx, ty0: view().ty
    };
    return;
  }
  if (carry && pointers.size === 1) {
    var hitC = state.cleared ? null : hitCluster(p.x, p.y);
    if (hitC && hitC.cluster === carry.cluster) {
      dropCarry(); // 運んでいる塊自体をタップ → その場に置く
      return;
    }
    if (hitC) {
      dropCarry(); // 運んでいたものを置いて、タップした塊を持ち上げる
      beginCarryForCluster(hitC, p);
      return;
    }
    // 空き地: タップなら置く、10px 超動いたらパン、長押しでは何もしない
    pressPending = {
      id: ev.pointerId, sx: p.x, sy: p.y, tx: view().tx, ty: view().ty, wx: 0, wy: 0, carryTap: true,
      timer: setTimeout(function () { /* 運び中は範囲選択に入らない */ }, LONG_PRESS_MS)
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
      moved: false, group: null,
      sx: p.x, sy: p.y, lastX: p.x, lastY: p.y, movedFar: false
    };
    if (inSelection && selection.size > 1) {
      // 範囲選択のグループドラッグ: 選択全塊の相対オフセットを掴んだ塊基準で保持する
      drag.group = Array.from(selection).map(function (c) {
        return { cluster: c, offX: c.gx - hit.cluster.gx, offY: c.gy - hit.cluster.gy };
      });
    }
    seGrab(); // 掴んだ音 (紙の「サッ」)
    startTimerOnce();
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
    clampCamera();
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
    drag.lastX = p.x; drag.lastY = p.y;
    if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > PRESS_MOVE_PX) drag.movedFar = true;
    positionDraggedCluster();
    kickEdgeScroll();
    requestDraw(); // ドラッグは pointermove 連続発火なので rAF 集約
    return;
  }
  if (panStart) {
    view().tx = panStart.tx + (p.x - panStart.sx);
    view().ty = panStart.ty + (p.y - panStart.sy);
    clampCamera();
    requestDraw(); // パンも pointermove 連続発火なので rAF 集約
  }
});
function endPointer(ev) {
  var cancelled = ev.type === 'pointercancel' || ev.type === 'lostpointercapture';
  // 範囲選択まわりの終了処理 (この指が担当していた場合のみ)
  if (pressPending && pressPending.id === ev.pointerId) {
    clearTimeout(pressPending.timer);
    var wasTap = !panStart && pointers.size === 1; // パンに移行せず単独で離した = 空き地タップ
    var pp = pressPending;
    pressPending = null;
    if (wasTap && !cancelled) {
      if (pp.carryTap) dropCarry(); // 運び中の空き地タップ → その場に置く
      else clearSelection(); // 空き地を短くタップ → 選択解除
    }
  }
  if (selRect && selRect.id === ev.pointerId) {
    if (cancelled) { selRect = null; $('selectChip').hidden = true; draw(); }
    else finishSelRect(); // 矩形に交差した塊を選択
  }
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 1 && !drag && state && state.views.desk) {
    // ピンチから1本指に戻る: 残った指の現在位置でパンの基準を取り直し、
    // そのままパンへ移行する (基準が古いままだと視点が跳ねる)
    var rest = Array.from(pointers.values())[0];
    panStart = { sx: rest.x, sy: rest.y, tx: view().tx, ty: view().ty };
  }
  if (pointers.size === 0) {
    if (drag) {
      if (carryMode && !drag.movedFar && !cancelled) {
        // 持ち運びモードでほぼ動かさず離した = タップ → そのまま持ち上げる
        var d = drag;
        drag = null;
        startCarry(d.cluster, d.group, d.lastX, d.lastY, d.grabDX, d.grabDY);
      } else settleDrag();
    }
    panStart = null;
  }
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);
stage.addEventListener('lostpointercapture', endPointer);
/* 中断で取り残された指 (ゴースト) の掃除: 通知や着信、アプリ切替、画面端の
 * システムジェスチャー等で pointerup/cancel が届かないと、pointers に実在
 * しない指が残り続け、次の1本指操作が「2本目の指」と誤認されてスワイプが
 * 拡大縮小になってしまう (iPhone 実機で発生し、再読み込みで直った件)。
 * lostpointercapture (上記) に加え、割り込みが起きやすいタイミングでは
 * ジェスチャ状態を丸ごと初期化して取り残しを防ぐ */
function resetGestureState() {
  if (drag) settleDrag();
  cancelPressAndRect();
  pointers.clear();
  pinch = null;
  panStart = null;
}
document.addEventListener('visibilitychange', function () { if (document.hidden) resetGestureState(); });
window.addEventListener('blur', resetGestureState);
stage.addEventListener('contextmenu', function (ev) { ev.preventDefault(); }); // 長押しでメニューを出さない

/* ドラッグの確定処理 (離したとき & ピンチへ切り替えるとき共通) */
function settleDrag() {
  var cl = drag.cluster;
  var group = drag.group;
  var wasMoved = drag.moved;
  drag = null;
  stopEdgeScroll();
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
/* 面は机1つだけになったので、切替 UI はズーム表示の更新のみ */
function updateSurfaceUI() {
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
  clampCamera();
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
  clampCamera();
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
  var max = 0;
  state.clusters.forEach(function (c) { if (c.pieces.length > max) max = c.pieces.length; });
  $('progressText').textContent = '最大の塊 ' + max + ' / ' + difficulty + ' ・ 塊 ' + state.clusters.length;
  $('timerText').textContent = formatTime(currentElapsed());
}

/* ---------- クリア処理 ---------- */
var lastClearResult = null; // 共有 (文字/画像) 用に直近のクリア結果を保持
function onClear() {
  seClear(); // クリアのオルゴール風アルペジオ
  /* ★ 順序が重要 (実機バグ修正): 以前は state.cleared = true を立ててから
   * currentElapsed() を読んでいたため、走行中セグメントが「クリア済みは
   * 走行しない」として切り捨てられていた。elapsedBase は一時停止時にしか
   * 畳み込まれないので、開始から一度も設定を開いていないゲームでは
   * クリアタイムが 0 秒になっていた (手数は別管理なので数えられていた)。
   * 必ず cleared を立てる前に確定させ、保険として保存済み進行からも守る。 */
  var elapsed = currentElapsed();
  elapsed = sanitizeClearTime(elapsed, state.moves, progressFor(playDate, difficulty).elapsedSec);
  state.cleared = true;
  state.elapsedBase = elapsed;
  var isFirstStageClear = !store.records.some(function (r) { return recordStage(r, state.pool) === playStage; });
  lastClearResult = {
    date: playDate, stage: playStage, pieces: difficulty, timeSec: elapsed, moves: state.moves,
    imageId: state.imageId, imageKey: state.imageKey,
    previewViewed: state.previewViewed
  };
  var prev = findRecordForStage(playStage, difficulty);
  var rec = {
    date: playDate, stage: playStage, imageId: state.imageId, imageKey: state.imageKey, pieces: difficulty,
    clearTimeSec: elapsed,
    bestTimeSec: prev ? Math.min(prev.bestTimeSec, elapsed) : elapsed,
    moves: state.moves,
    previewViewed: state.previewViewed, previewCount: state.previewCount,
    clearedAt: new Date().toISOString(),
    author: state.author || null
  };
  if (prev) store.records[store.records.indexOf(prev)] = rec; else store.records.push(rec);
  persistProgress();
  runConfetti();
  // 記録証 (C案): 額装した完成盤面 + 記録2行 + 「完成図を見ずにクリア」バッジ
  $('resultDateLine').textContent = 'ステージ ' + playStage + ' ・ ' + difficulty + 'ピース';
  $('resultStatLine').textContent = 'タイム ' + formatTime(elapsed) + ' ・ ' + state.moves + '手';
  $('resultBadge').hidden = state.previewViewed;
  var clearTier = frameTier(difficulty); // 装飾ティア (銅/銀/金/特別) のときだけティア色のバッジを出す
  $('resultUpperBadge').hidden = !clearTier;
  $('resultUpperBadge').className = 'cert-badge cert-badge-upper' + (clearTier && clearTier !== 'gold' ? ' ' + clearTier : '');
  var boardHost = $('resultBoard');
  boardHost.innerHTML = '';
  renderBoardCanvasAt(rec, 288).then(function (cv) {
    if (!cv) return;
    boardHost.innerHTML = '';
    boardHost.appendChild(cv);
  });
  // クリア報酬: ステージ初クリアでランダム抽選 1 点 (+ フレーム解放判定)
  var grants = processRewardsOnClear(isFirstStageClear);
  if (grants.length) {
    $('resultRewardItems').innerHTML = grants.map(function (id) {
      var it = collectibleById(id);
      if (!it) return '';
      var isCat = !!catById(id);
      return '<div class="cert-reward"><img src="' + (isCat ? 'cats/' : 'wall-items/') + it.id + '.webp" alt="' + it.name + '">' +
        '<div class="cert-reward-text"><span class="cert-reward-label">ごほうび</span>' +
        '<span class="cert-reward-name">' + it.name + '</span></div></div>';
    }).join('');
    $('resultRewardItems').hidden = false;
  } else {
    $('resultRewardItems').hidden = true;
    $('resultRewardItems').innerHTML = '';
  }
  $('resultModal').hidden = false;
  navPush('result');
}
/* ---------- クリア結果の共有 (文字 / 画像) ---------- */
function flashShareBtn(text) {
  var btn = $('resultShareBtn');
  var orig = '結果を共有';
  btn.textContent = text;
  setTimeout(function () { btn.textContent = orig; }, 1500);
}
/* 汎用の短い注記 (数秒で消える)。モーダルの上にも出る */
var appToastTimer = null;
function showToast(text) {
  var el = $('appToast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  if (appToastTimer) clearTimeout(appToastTimer);
  appToastTimer = setTimeout(function () { el.classList.remove('show'); }, 3800);
}
/* 文字で共有: Web Share が使えればそれ、無ければクリップボードへ。
 * 文面は buildShareText (URL + #まいにちジグソー を必ず含む) */
function shareResultText() {
  $('shareChoiceModal').hidden = true;
  if (!lastClearResult) return;
  var text = buildShareText(lastClearResult);
  if (navigator.share) {
    navigator.share({ text: text }).catch(function () { /* キャンセルは無視 */ });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function () {
      flashShareBtn('コピーしました');
    }, function () { /* 失敗時は何もしない */ });
  }
}
/* 共有画像 (1200×630): 左に完成盤面 (実ピース形状の継ぎ目つき)、
 * 右に結果とクレジット。盤面は壁の額装と同じレンダラーで描く */
function buildShareImage(res) {
  var rec = { date: res.date, pieces: res.pieces, imageId: res.imageId, imageKey: res.imageKey };
  return renderWallBoardCanvas(rec).then(function (board) {
    var W = 1200, H = 630;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#f7f2e7'; // 生成り (スタート画面の紙面)
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#33523f'; // 深緑の帯
    ctx.fillRect(0, 0, W, 12);
    ctx.fillRect(0, H - 12, W, 12);
    // 盤面: 左に 540×540、落影 + 深緑の細枠
    var bs = 540, bx = 45, by = (H - bs) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(60,40,20,0.35)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx, by, bs, bs);
    ctx.restore();
    ctx.drawImage(board, bx, by, bs, bs);
    ctx.strokeStyle = '#33523f';
    ctx.lineWidth = 6;
    ctx.strokeRect(bx, by, bs, bs);
    // テキスト (右側)
    var tx = bx + bs + 55;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#33523f';
    ctx.font = '800 58px sans-serif';
    ctx.fillText('まいにちジグソー', tx, 168);
    ctx.fillStyle = '#7a3b3a';
    ctx.font = '700 96px "Hiragino Mincho ProN", "Hiragino Mincho Pro", "Yu Mincho", "YuMincho", "Noto Serif JP", serif';
    ctx.fillText('クリア', tx, 292);
    // 完成図を見ずにクリアした場合はバッジで明記する。位置は見出しの
    // 実測幅 + 余白で決め、文字には絶対に重ねない。バッジが長くて
    // 横に収まらないときは見出しの下の行に置き、以降の記録行を
    // その分だけ下げてピルと重ならないようにする
    var statShift = 0;
    if (!res.previewViewed) {
      var titleW = ctx.measureText('クリア').width; // 見出しフォントが有効なうちに実測する
      var badgeText = '完成図を見ずにクリア';
      ctx.font = '600 25px sans-serif';
      var bw2 = ctx.measureText(badgeText).width + 32;
      var bh2 = 40, bx2 = tx + titleW + 26, by2 = 292 - 60;
      if (bx2 + bw2 > W - 24) { bx2 = tx; by2 = 308; statShift = 14; } // 横に収まらなければ見出しの下の行へ
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx2, by2, bw2, bh2, bh2 / 2);
      else ctx.rect(bx2, by2, bw2, bh2);
      ctx.fillStyle = '#f3e5bd';
      ctx.fill();
      ctx.fillStyle = '#7a5c14';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, bx2 + 16, by2 + bh2 / 2 + 1);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.fillStyle = '#3a3230';
    ctx.font = '600 42px sans-serif';
    ctx.fillText(res.date, tx, 388 + statShift);
    ctx.fillText(res.pieces + 'ピース ・ ' + res.moves + '手', tx, 452 + statShift);
    ctx.font = '800 54px sans-serif';
    ctx.fillText('タイム ' + formatTime(res.timeSec), tx, 532 + statShift);
    ctx.fillStyle = 'rgba(58,50,48,0.6)';
    ctx.font = '500 27px sans-serif';
    ctx.fillText(GAME_URL, tx, 588 + statShift);
    return cv;
  });
}
function downloadShareImage(cv) {
  var a = document.createElement('a');
  a.href = cv.toDataURL('image/png');
  a.download = 'mainichi-jigsaw-' + (lastClearResult ? lastClearResult.date : 'result') + '.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
/* 画像共有できない環境向けの受け皿: 保存したことを必ず知らせる
 * (無言でダウンロードすると「共有できず保存しようとする」バグに見える) */
var SHARE_SAVE_NOTE = 'このブラウザでは画像の直接共有ができないため、画像を保存しました';
function saveShareImageFallback(cv) {
  downloadShareImage(cv);
  showToast(SHARE_SAVE_NOTE);
}
/* 画像で共有: files 共有が使える環境ではそれ、無ければ保存 + 注記。
 * share() がキャンセル (AbortError) 以外で失敗したときも保存に落とす */
function shareResultImage() {
  $('shareChoiceModal').hidden = true;
  if (!lastClearResult) return;
  buildShareImage(lastClearResult).then(function (cv) {
    if (!cv) return;
    if (!cv.toBlob) { saveShareImageFallback(cv); return; }
    cv.toBlob(function (blob) {
      if (!blob) { saveShareImageFallback(cv); return; }
      var file = new File([blob], 'mainichi-jigsaw-' + lastClearResult.date + '.png', { type: 'image/png' });
      if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file] }).catch(function (err) {
          if (err && err.name === 'AbortError') return; // ユーザーのキャンセルは何もしない
          saveShareImageFallback(cv);
        });
      } else {
        saveShareImageFallback(cv);
      }
    }, 'image/png');
  });
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

/* ---------- クリア報酬インテリア (UI) ----------
 * 保存は store.wall (PureLogic の normalizeWall で形を保証)。
 * 付与はクリア時に確定する。届いた分は wall.pending に積み、スタート画面の
 * 通知から開くリビールで確認すると解消する (壁画面を開いても解消)。
 * フレームの解放も同じ作法で wall.pendingUnlocks に積み、通知から伝える。
 * 壁紙の解放 (第 2 系統) も同じ作法で wall.pendingPaperUnlocks に積む。
 * 小物の画像は wall-items/<id>.webp (壁用フラットイラスト・透過済み)。
 * プレイ中の机にはインテリアを一切描かない (旧・装飾レイヤーは廃止)。 */
/* クリア時に報酬を確定させる。ごほうび抽選はステージの初クリア時のみ
 * (再プレイでは出ない)。季節アイテムの月判定は実カレンダーの月を使う。
 * フレーム解放は累計クリア回数 (records 数) の到達で判定する。
 * 戻り値: 今回届いたアイテム id の配列 (結果画面の表示用) */
function processRewardsOnClear(firstClear) {
  var wall = store.wall;
  var grants = [];
  if (firstClear) {
    var month = parseInt(jstTodayString().split('-')[1], 10);
    var picked = drawWallItem(wall, { month: month }, Math.random);
    if (picked) {
      grantWallItems(wall, [picked], playDate);
      grants.push(picked);
    }
    wall.lastDate = playDate;
  }
  var unlocked = applyFrameUnlocks(wall, store.records.length);
  var paperUnlocked = applyPaperUnlocks(wall, store.records.length);
  var expanded = applyWallExpand(wall, store.records.length);
  if (grants.length) {
    recordWallHistory(wall, playDate, grants);
    grants.forEach(function (id) { if (wall.pending.indexOf(id) < 0) wall.pending.push(id); });
  }
  if (grants.length || unlocked.length || paperUnlocked.length || expanded) saveStore();
  return grants;
}
/* 記録 → エントリ解決 (額装・コレクション共通)。picsum はキーから
 * 直接作れ、URL エントリは現在のプールから引く。 */
function entryForRecord(rec) {
  var key = recordImageKey(rec);
  if (!key) return null;
  if (key.charAt(0) === 'p') return { type: 'picsum', id: parseInt(key.slice(1), 10) };
  return state && state.pool ? poolEntryByKey(state.pool, key) : null;
}
/* 額装パズルの記録キー (壁への配置データが参照する安定キー) */
function wallRecordKey(rec) {
  return rec.date + '|' + rec.pieces + '|' + recordImageKey(rec);
}
function recordByWallKey(key) {
  for (var i = 0; i < store.records.length; i++) {
    if (wallRecordKey(store.records[i]) === key) return store.records[i];
  }
  return null;
}
/* ---- ごほうびリビール (スタート画面の通知から開く) ---- */
function rewardCardHtml(it) {
  var isCat = !!catById(it.id);
  return '<img src="' + (isCat ? 'cats/' : 'wall-items/') + it.id + '.webp" alt="">' +
    '<span class="reward-name">' + it.name + '</span>' +
    '<span class="reward-note">' + (isCat ? 'ねこ ' : '') + rarityLabel(it) + '</span>';
}
function showRewardReveal() {
  if (!store.wall.pending.length) return;
  var box = $('rewardChoices');
  box.innerHTML = '';
  store.wall.pending.forEach(function (id) {
    var it = collectibleById(id);
    if (!it) return;
    var card = document.createElement('div');
    card.className = 'reward-card';
    card.innerHTML = rewardCardHtml(it);
    box.appendChild(card);
  });
  $('rewardModal').hidden = false;
  navPush('reward');
}
function closeRewardReveal() {
  $('rewardModal').hidden = true;
  if (store.wall.pending.length) {
    store.wall.pending = [];
    saveStore();
    updateStartWallRow();
  }
}
/* ---- フレーム / 壁紙 解放の通知 (スタート画面の通知から開く。
 * 両系統を 1 つのモーダルに合わせて出す) ---- */
function showUnlockNotice() {
  var list = $('unlockList');
  list.innerHTML = '';
  var fNames = [], pNames = [];
  var expanded = !!store.wall.pendingExpand;
  if (expanded) {
    var erow = document.createElement('div');
    erow.className = 'unlock-row';
    erow.innerHTML = '<span class="unlock-swatch" style="background:#F3E9D3"></span>' +
      '<span class="unlock-name">壁が広くなりました</span>' +
      '<span class="unlock-cond">累計 ' + WALL_EXPAND_CLEARS + ' 回クリアで解放</span>';
    list.appendChild(erow);
  }
  store.wall.pendingUnlocks.forEach(function (id) {
    var st = frameStyleById(id);
    if (!st) return;
    fNames.push(st.name);
    var row = document.createElement('div');
    row.className = 'unlock-row';
    row.innerHTML = '<span class="unlock-swatch" style="background:' + (st.gradient || st.color) + '"></span>' +
      '<span class="unlock-name">' + st.name + '</span>' +
      '<span class="unlock-cond">累計 ' + st.unlockAt + ' 回クリアで解放</span>';
    list.appendChild(row);
  });
  store.wall.pendingPaperUnlocks.forEach(function (id) {
    var p = wallpaperById(id);
    if (!p) return;
    pNames.push(p.name);
    var row = document.createElement('div');
    row.className = 'unlock-row';
    var cv = document.createElement('canvas');
    cv.className = 'unlock-swatch unlock-swatch-paper';
    row.appendChild(cv);
    var nm = document.createElement('span');
    nm.className = 'unlock-name';
    nm.textContent = p.name;
    row.appendChild(nm);
    var cond = document.createElement('span');
    cond.className = 'unlock-cond';
    cond.textContent = '累計 ' + p.unlockAt + ' 回クリアで解放';
    row.appendChild(cond);
    list.appendChild(row);
    paintPaperPreview(cv, p, 104, 80);
  });
  var title;
  if (expanded && !fNames.length && !pNames.length) title = '壁が広くなりました';
  else if (expanded) title = '壁が広くなり、新しいアイテムも使えるようになりました';
  else if (fNames.length && pNames.length) title = '新しいフレームと壁紙が使えるようになりました';
  else if (pNames.length === 1) title = '新しい壁紙『' + pNames[0] + '』が使えるようになりました';
  else if (pNames.length > 1) title = '新しい壁紙が使えるようになりました';
  else if (fNames.length === 1) title = '新しいフレーム『' + fNames[0] + '』が使えるようになりました';
  else title = '新しいフレームが使えるようになりました';
  $('unlockTitle').textContent = title;
  $('unlockModal').hidden = false;
  navPush('unlock');
}
function closeUnlockNotice() {
  $('unlockModal').hidden = true;
  if (store.wall.pendingUnlocks.length || store.wall.pendingPaperUnlocks.length || store.wall.pendingExpand) {
    store.wall.pendingUnlocks = [];
    store.wall.pendingPaperUnlocks = [];
    store.wall.pendingExpand = false;
    saveStore();
    updateStartWallRow();
  }
}

/* ---------- 壁画面 (案B: 正面から見た一面の壁) ----------
 * 所持アイテムと額装パズルを壁に自由配置する専用画面。配置は比率座標
 * (中心) で store.wall.placed / frames に保存し、placed の配列順が
 * アイテム同士の重なり順 (額は常にアイテムより奥に描く)。
 * 額はユニット全体を 1 枚の Canvas に描く (paintWallFrameUnit)。中身は
 * コレクション詳細と同じ「実ピース形状」の完成盤面レンダラーで描く
 * (renderWallBoardCanvas)。フレーム色は解放済みスタイルだけが選べる。 */
var uiWall = false;
var wallBackToHome = true;
var wallSelected = null; // { kind: 'item' | 'frame', key: id | recordKey }
var wallDrag = null;     // { kind, key, el, moved, startX, startY, offX, offY }

function showWall(from) {
  uiWall = true;
  wallBackToHome = from === 'home';
  navPush('wall');
  wallSelected = null;
  wallDrag = null;
  bgmTryPlay(); // 壁画面でも BGM を流す (開始はこのタップを起点にする)
  // 累計クリアが条件に達していれば壁を一段広げる (冪等)
  var expanded = applyWallExpand(store.wall, store.records.length);
  wallCam.x = 0.5; wallCam.y = 0.5;
  // 床に猫がいれば、開いたときに床まで見える全体表示で始める
  wallCam.zoom = (expanded || (store.wall.catsPlaced || []).length > 0) ? wallFitZoom() : 1;
  // 壁を開いたら未確認のごほうび/解放は確認済み扱いにする
  if (expanded || store.wall.pending.length || store.wall.pendingUnlocks.length || store.wall.pendingPaperUnlocks.length || store.wall.pendingExpand) {
    store.wall.pending = [];
    store.wall.pendingUnlocks = [];
    store.wall.pendingPaperUnlocks = [];
    store.wall.pendingExpand = false;
    saveStore();
  }
  applyVisibility();
  renderWall();
  if (expanded) showToast('壁が広くなりました');
  setTimeout(function () { maybeTourAuto('wall'); }, 450); // 初回だけ壁のツアー
}
function hideWall() {
  uiWall = false;
  wallSelected = null;
  wallDrag = null;
  saveStore();
  if (wallBackToHome) goToStartScreen();
  else applyVisibility();
}
function wallPlacedEntry(id) {
  for (var i = 0; i < store.wall.placed.length; i++) if (store.wall.placed[i].id === id) return store.wall.placed[i];
  return null;
}
function wallPlacedByUid(uid) {
  for (var i = 0; i < store.wall.placed.length; i++) if (store.wall.placed[i].uid === uid) return store.wall.placed[i];
  return null;
}
function wallFrameEntry(key) {
  for (var i = 0; i < store.wall.frames.length; i++) if (store.wall.frames[i].recordKey === key) return store.wall.frames[i];
  return null;
}
/* ---------- 壁カメラ (段階制の壁をパン/ズームで見る) ----------
 * 壁の実体は #wallWorld (ステージより大きい層) で、カメラは中心比率
 * (x, y) と倍率 zoom。screen = (比率 - 中心) x ワールドpx x zoom + 画面/2。
 * ズーム下限は壁全体が収まる倍率、上限は 2 倍。端では止まる (余白なし) */
var wallCam = { x: 0.5, y: 0.5, zoom: 1, tx: 0, ty: 0 };
function wallSize() { return wallSizeOf(store.wall && typeof store.wall.sizeStage === 'number' ? store.wall.sizeStage : 0); }
function wallWorldPx() {
  var stage = $('wallStage');
  var vw = (stage && stage.clientWidth) || 360, vh = (stage && stage.clientHeight) || 450;
  var s = wallSize();
  return { vw: vw, vh: vh, w: vw * s.w, h: vh * s.h };
}
function wallFitZoom() {
  var s = wallSize();
  return Math.min(1 / s.w, 1 / s.h);
}
function clampWallCam() {
  var s = wallSize();
  wallCam.zoom = Math.min(2, Math.max(wallFitZoom(), wallCam.zoom));
  var hw = 0.5 / (wallCam.zoom * s.w), hh = 0.5 / (wallCam.zoom * s.h);
  wallCam.x = hw >= 0.5 ? 0.5 : Math.min(1 - hw, Math.max(hw, wallCam.x));
  wallCam.y = hh >= 0.5 ? 0.5 : Math.min(1 - hh, Math.max(hh, wallCam.y));
}
function applyWallCam() {
  var world = $('wallWorld');
  if (!world) return;
  var d = wallWorldPx();
  clampWallCam();
  wallCam.tx = d.vw / 2 - wallCam.x * d.w * wallCam.zoom;
  wallCam.ty = d.vh / 2 - wallCam.y * d.h * wallCam.zoom;
  world.style.transform = 'translate(' + wallCam.tx + 'px,' + wallCam.ty + 'px) scale(' + wallCam.zoom + ')';
}
/* 画面座標 (client) → 壁の比率座標 */
function wallPointFromClient(cx, cy) {
  var stage = $('wallStage');
  var rect = stage.getBoundingClientRect();
  var d = wallWorldPx();
  return {
    x: (cx - rect.left - wallCam.tx) / (wallCam.zoom * d.w),
    y: (cy - rect.top - wallCam.ty) / (wallCam.zoom * d.h)
  };
}
/* 画面座標 (ステージ内 px) に壁比率点 wp が来るようカメラ中心を合わせる */
function wallCamSetFromScreen(wp, sx, sy) {
  var d = wallWorldPx();
  wallCam.x = wp.x - (sx - d.vw / 2) / (wallCam.zoom * d.w);
  wallCam.y = wp.y - (sy - d.vh / 2) / (wallCam.zoom * d.h);
}
/* 「全体」ボタン: 全体表示と等倍 (中心) を切り替える */
function toggleWallFit() {
  if (wallCam.zoom > wallFitZoom() + 0.01) {
    wallCam.zoom = wallFitZoom();
    wallCam.x = 0.5; wallCam.y = 0.5;
  } else {
    wallCam.zoom = 1;
    wallCam.x = 0.5; wallCam.y = 0.5;
  }
  applyWallCam();
}
function renderWall() {
  var stage = $('wallStage');
  stage.innerHTML = '';
  var world = document.createElement('div');
  world.id = 'wallWorld';
  var d = wallWorldPx();
  world.style.width = d.w + 'px';
  world.style.height = d.h + 'px';
  stage.appendChild(world);
  paintWallBackdrop(); // 背景 Canvas (壁紙 + 床 + 巾木) をワールドの一番奥に敷く
  store.wall.frames.forEach(function (f) { world.appendChild(buildWallFrameEl(f)); });
  store.wall.placed.forEach(function (p) { world.appendChild(buildWallItemEl(p)); });
  (store.wall.catsPlaced || []).forEach(function (p) { world.appendChild(buildWallCatEl(p)); });
  world.appendChild(buildWallSampleBox()); // 猫の配置ガイドは最前面 (半透明)
  var fit = document.createElement('button');
  fit.id = 'wallFitBtn';
  fit.className = 'wall-fit-btn';
  fit.type = 'button';
  fit.textContent = '全体';
  fit.addEventListener('click', function () { toggleWallFit(); });
  stage.appendChild(fit);
  applyWallCam();
  renderWallTray();
  updateWallSelBar();
}
/* ---------- 壁の共有画像 ----------
 * 壁全体 (現在の広さ分すべて) を 1 枚の Canvas に描いて共有する。
 * 額は実ピース形状の盤面で描き直し (画面表示と同じレシピ)、小物は
 * 画像をそのまま置く。重なり順は画面と同じ (額 → 小物)。
 * 下部にブランドのフッターを付ける。 */
function buildShareFrameCanvas(f, unitW, boardPx) {
  var rec = recordByWallKey(f.recordKey);
  var st = frameStyleById(f.color) || frameStyleById('walnut');
  var U = Math.max(24, unitW * f.w);
  var geo = frameGeometry(U, st);
  var scale = 2;
  var cv = document.createElement('canvas');
  cv.width = Math.round(geo.size * scale);
  cv.height = Math.round(geo.size * scale);
  var ctx = cv.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  var upper = rec && isUpperTier(rec.pieces) ? rec.pieces : 0;
  if (!rec) {
    paintFrameUnit(ctx, st, U, null, 'missing', f.recordKey, upper);
    return Promise.resolve({ cv: cv, size: geo.size });
  }
  return (boardPx ? renderBoardCanvasAt(rec, boardPx) : renderWallBoardCanvas(rec)).then(function (board) {
    paintFrameUnit(ctx, st, U, board, 'ready', f.recordKey, upper);
    return { cv: cv, size: geo.size };
  });
}
function buildWallShareImage() {
  var stage = $('wallStage');
  if (!stage || !stage.clientWidth) return Promise.resolve(null);
  var unit = stage.clientWidth, s = wallSize();
  var worldW = unit * s.w, worldH = stage.clientHeight * s.h;
  // 合成キャンバスが大きすぎると Firefox Android のタイル描画で帯状の
  // ノイズが入ることがあるため、幅は 1600px を上限にする。各描画段の
  // 合間には 1 フレーム待って描画を確定させてから次を重ねる
  var k = Math.min(2, 1600 / worldW);
  if (k < 0.5) k = 0.5;
  var W = Math.round(worldW * k), H = Math.round(worldH * k);
  var footer = Math.round(30 * k) + 18;
  var cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H + footer;
  var ctx = cv.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  paintWallBase(ctx, W, H, wallpaperById(store.wall.paper) || wallpaperById('kinari'));
  var frameJobs = store.wall.frames.map(function (f) {
    return buildShareFrameCanvas(f, unit * k).then(function (r) {
      ctx.drawImage(r.cv, Math.round(f.x * W - r.size / 2), Math.round(f.y * H - r.size / 2), r.size, r.size);
    });
  });
  var flushFrame = function () {
    return new Promise(function (res) { requestAnimationFrame(function () { requestAnimationFrame(res); }); });
  };
  return Promise.all(frameJobs).then(flushFrame).then(function () {
    var itemJobs = store.wall.placed.map(function (p) {
      return new Promise(function (res) {
        var it = wallItemById(p.id);
        if (!it) { res(); return; }
        var img = new Image();
        var draw = function () {
          var wpx = wallItemWidthRatio(it) * unit * k;
          var hpx = wpx * img.naturalHeight / Math.max(1, img.naturalWidth);
          ctx.save();
          ctx.shadowColor = 'rgba(90,70,40,0.25)';
          ctx.shadowBlur = 5 * k;
          ctx.shadowOffsetY = 3 * k;
          ctx.drawImage(img, p.x * W - wpx / 2, p.y * H - hpx / 2, wpx, hpx);
          ctx.restore();
          res();
        };
        img.onload = function () {
          // デコード完了前に描くと Firefox で帯状の欠けが出るため decode を待つ
          if (img.decode) img.decode().then(draw, draw); else draw();
        };
        img.onerror = function () { res(); };
        img.src = 'wall-items/' + it.id + '.webp';
      });
    });
    return Promise.all(itemJobs);
  }).then(flushFrame).then(function () {
    // 床の猫: 足元を床に合わせ、足下に楕円の影を落とす
    var catJobs = (store.wall.catsPlaced || []).map(function (p) {
      return new Promise(function (res) {
        var c = catById(p.id);
        if (!c) { res(); return; }
        var img = new Image();
        var draw = function () {
          var wpx = c.w * unit * k;
          var hpx = wpx * img.naturalHeight / Math.max(1, img.naturalWidth);
          var feetY = CAT_FEET_Y * H;
          ctx.save();
          ctx.fillStyle = 'rgba(60,38,18,0.30)';
          ctx.beginPath();
          ctx.ellipse(p.x * W, feetY, wpx * 0.36, Math.max(2, 5 * k), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.drawImage(img, p.x * W - wpx / 2, feetY - hpx, wpx, hpx);
          ctx.restore();
          res();
        };
        img.onload = function () {
          if (img.decode) img.decode().then(draw, draw); else draw();
        };
        img.onerror = function () { res(); };
        img.src = 'cats/' + c.id + '.webp';
      });
    });
    return Promise.all(catJobs);
  }).then(flushFrame).then(function () {
    ctx.fillStyle = '#F7F2E7';
    ctx.fillRect(0, H, W, footer);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#43382A';
    ctx.font = '700 ' + Math.round(15 * k) + 'px "Hiragino Mincho ProN", "Yu Mincho", serif';
    ctx.textAlign = 'left';
    ctx.fillText('まいにちジグソー', Math.round(14 * k), H + footer / 2);
    ctx.fillStyle = '#7A7264';
    ctx.font = Math.round(12 * k) + 'px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('daily-jigsaw.pages.dev', W - Math.round(14 * k), H + footer / 2);
    return cv;
  });
}
function downloadWallShareImage(cv) {
  var a = document.createElement('a');
  a.href = cv.toDataURL('image/png');
  a.download = 'mainichi-jigsaw-wall.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
/* スタート画面の壁帯プレビュー (PBI #24 案A): 共有画像と同じ部品・同じ
 * 重なり順で壁全体を1枚に描く。違いはフッターなし、額の盤面は小さめ
 * (288px) で軽くする、描画単位は壁画面に依存しない仮想幅 412 で固定。
 * 壁画面を開いていなくても描ける */
/* aspect (帯の幅/高さ) が壁より横長なときは、壁の下地 (壁紙と床) だけを
 * 左右へ継ぎ目なく延長して帯いっぱいに描く。額・小物・猫の位置と大きさは
 * 壁本来の座標のまま変形しない (ユーザー指示: 横の切れ目を見せない) */
function renderWallPreviewCanvas(aspect) {
  var s = wallSize();
  var unit = 412;
  var worldW = unit * s.w, worldH = unit * 1.25 * s.h;
  var extW = worldW;
  if (aspect && worldW / worldH < aspect) extW = Math.round(worldH * aspect);
  var k = Math.min(2, 824 / extW);
  if (k < 0.25) k = 0.25;
  var W = Math.round(worldW * k), H = Math.round(worldH * k);
  var EW = Math.round(extW * k), padX = Math.round((EW - W) / 2);
  var cv = document.createElement('canvas');
  cv.width = EW; cv.height = H;
  var ctx = cv.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  paintWallBase(ctx, EW, H, wallpaperById(store.wall.paper) || wallpaperById('kinari'));
  var flush = function () {
    return new Promise(function (res) { requestAnimationFrame(function () { requestAnimationFrame(res); }); });
  };
  var frameJobs = store.wall.frames.map(function (f) {
    return buildShareFrameCanvas(f, unit * k, 288).then(function (r) {
      ctx.drawImage(r.cv, Math.round(padX + f.x * W - r.size / 2), Math.round(f.y * H - r.size / 2), r.size, r.size);
    });
  });
  return Promise.all(frameJobs).then(flush).then(function () {
    var itemJobs = store.wall.placed.map(function (p) {
      return new Promise(function (res) {
        var it = wallItemById(p.id);
        if (!it) { res(); return; }
        var img = new Image();
        var draw = function () {
          var wpx = wallItemWidthRatio(it) * unit * k;
          var hpx = wpx * img.naturalHeight / Math.max(1, img.naturalWidth);
          ctx.save();
          ctx.shadowColor = 'rgba(90,70,40,0.25)';
          ctx.shadowBlur = 5 * k;
          ctx.shadowOffsetY = 3 * k;
          ctx.drawImage(img, padX + p.x * W - wpx / 2, p.y * H - hpx / 2, wpx, hpx);
          ctx.restore();
          res();
        };
        img.onload = function () {
          if (img.decode) img.decode().then(draw, draw); else draw();
        };
        img.onerror = function () { res(); };
        img.src = 'wall-items/' + it.id + '.webp';
      });
    });
    return Promise.all(itemJobs);
  }).then(flush).then(function () {
    var catJobs = (store.wall.catsPlaced || []).map(function (p) {
      return new Promise(function (res) {
        var c = catById(p.id);
        if (!c) { res(); return; }
        var img = new Image();
        var draw = function () {
          var wpx = c.w * unit * k;
          var hpx = wpx * img.naturalHeight / Math.max(1, img.naturalWidth);
          var feetY = CAT_FEET_Y * H;
          ctx.save();
          ctx.fillStyle = 'rgba(60,38,18,0.30)';
          ctx.beginPath();
          ctx.ellipse(padX + p.x * W, feetY, wpx * 0.36, Math.max(2, 5 * k), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.drawImage(img, padX + p.x * W - wpx / 2, feetY - hpx, wpx, hpx);
          ctx.restore();
          res();
        };
        img.onload = function () {
          if (img.decode) img.decode().then(draw, draw); else draw();
        };
        img.onerror = function () { res(); };
        img.src = 'cats/' + c.id + '.webp';
      });
    });
    return Promise.all(catJobs);
  }).then(flush).then(function () { return cv; });
}
/* 壁帯プレビューのキャッシュ: 壁の要約が同じなら再描画しない。
 * renderStartScreen は戻るたび・難易度切替のたびに呼ばれるため必須 */
var wallPreviewCache = { key: '', cv: null };
var wallPreviewBusyKey = '';
function wallPreviewKey() {
  var w = store.wall;
  return JSON.stringify([w.paper, w.sizeStage, w.frames, w.placed, w.catsPlaced, store.records.length]);
}
/* 帯のアスペクト (幅/高さ)。壁の下地を左右へ延長する量を決める。
 * キャッシュキーには混ぜない (起動直後のレイアウト揺れで本描画の
 * 表示が止まるバグがあったため) */
function wallPreviewAspect() {
  var s = wallSize();
  var dispW = ($('startWallBand') || {}).clientWidth || 412;
  var natH = dispW * (1.25 * s.h) / s.w;
  var cap = window.innerWidth <= 700 ? window.innerHeight * 0.28 : Infinity;
  return dispW / Math.max(1, Math.min(natH, cap));
}
function updateWallPreview() {
  var band = $('startWallBand'), cv = $('wallPreviewCanvas');
  if (!band || !cv || !store.wall) return;
  var s = wallSize();
  var dispW = band.clientWidth || 412;
  var natH = dispW * (1.25 * s.h) / s.w;
  var cap = window.innerWidth <= 700 ? window.innerHeight * 0.28 : Infinity;
  band.style.height = Math.round(Math.min(natH, cap)) + 'px';
  var aspect = wallPreviewAspect();
  // キャッシュキーは壁の内容だけにする。アスペクトを混ぜると、起動直後の
  // レイアウト確定 (URLバー収納等) でアスペクトが揺れたときに完了コール
  // バックのキー照合が外れ、本描画が二度と表示されない (開いた直後は
  // 壁紙だけで、ボタンを押すと装飾が出るバグの原因)。描画済みキャンバスは
  // フィット描画で吸収するので、アスペクト違いは見た目に影響しない
  var key = wallPreviewKey();
  var ctx = cv.getContext('2d');
  if (!ctx) return;
  // 案1 (全体フィット + 下地の左右延長): 壁全体が帯に収まるよう描き、
  // 帯のほうが横長な分は壁紙と床を左右へ継ぎ目なく伸ばして埋める。
  // 紙色の余白や横の切れ目は出ない (額・小物・猫は変形しない)
  var bw = Math.max(2, Math.round(dispW * 2)), bh = Math.max(2, Math.round(Math.min(natH, cap) * 2));
  if (wallPreviewCache.key === key && wallPreviewCache.cv) {
    var srcC = wallPreviewCache.cv;
    cv.width = bw; cv.height = bh;
    // 余白をベタ色で埋めると「壁が左右で切れた」ように見えるので、
    // 帯いっぱいに引き伸ばして描く (アスペクト差はレイアウト揺れ由来の
    // 数%程度で、歪みは目立たない)。ただし差が大きいときは従来の
    // フィット描画 (大きい歪みより余白のほうがまし)
    if (Math.abs(srcC.width / srcC.height - bw / bh) < 0.15) {
      ctx.drawImage(srcC, 0, 0, bw, bh);
    } else {
      ctx.fillStyle = '#f7f2e7';
      ctx.fillRect(0, 0, bw, bh);
      var sc = Math.min(bw / srcC.width, bh / srcC.height);
      var dw = Math.round(srcC.width * sc), dh = Math.round(srcC.height * sc);
      ctx.drawImage(srcC, Math.round((bw - dw) / 2), Math.round((bh - dh) / 2), dw, dh);
    }
    return;
  }
  // まず壁紙だけの即席で帯いっぱいに埋める (額・小物・猫の重い描画は後追い)
  cv.width = bw; cv.height = bh;
  paintWallBase(ctx, bw, bh, wallpaperById(store.wall.paper) || wallpaperById('kinari'));
  if (wallPreviewBusyKey === key) return;
  wallPreviewBusyKey = key;
  setTimeout(function () {
    renderWallPreviewCanvas(wallPreviewAspect()).then(function (full) {
      wallPreviewBusyKey = '';
      if (!full) return;
      wallPreviewCache = { key: key, cv: full };
      if (wallPreviewKey() === key && !$('startView').hidden) updateWallPreview();
    });
  }, 30);
}
/* 壁画像で共有: クリア画像と同じ作法 (files 共有 → 無ければ保存 + 注記) */
function shareWallImage() {
  buildWallShareImage().then(function (cv) {
    if (!cv) return;
    if (!cv.toBlob) { downloadWallShareImage(cv); showToast(SHARE_SAVE_NOTE); return; }
    cv.toBlob(function (blob) {
      if (!blob) { downloadWallShareImage(cv); showToast(SHARE_SAVE_NOTE); return; }
      var file = new File([blob], 'mainichi-jigsaw-wall.png', { type: 'image/png' });
      if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file] }).catch(function (err) {
          if (err && err.name === 'AbortError') return;
          downloadWallShareImage(cv);
          showToast(SHARE_SAVE_NOTE);
        });
      } else {
        downloadWallShareImage(cv);
        showToast(SHARE_SAVE_NOTE);
      }
    }, 'image/png');
  });
}
function wallCatPlacedEntry(id) {
  var placed = store.wall.catsPlaced || [];
  for (var i = 0; i < placed.length; i++) if (placed[i].id === id) return placed[i];
  return null;
}
/* 壁画面のサンプル箱: スタート画面の壁帯でギフト箱が壁に被る範囲を、
 * 壁の床に半透明で示すガイド (猫の配置用、2026-11-10 ユーザー決定)。
 * 柄はスタート画面の箱と同じ (現在のステージの柄)。操作は受け付けず
 * (pointer-events: none)、猫・小物・額より手前に置くので、裏にいる
 * 猫が透けて「スタート画面では隠れる」ことが見て分かる。
 * 濃さ: 常時 0.35、猫の選択中/ドラッグ中は 0.55 */
function sampleBoxActive() {
  return !!((wallSelected && wallSelected.kind === 'cat') || (wallDrag && wallDrag.kind === 'cat'));
}
function updateSampleBoxOpacity() {
  var el = $('wallSampleBox');
  if (el) el.style.opacity = sampleBoxActive() ? '0.55' : '0.35';
}
function buildWallSampleBox() {
  var el = document.createElement('div');
  el.className = 'wall-samplebox';
  el.id = 'wallSampleBox';
  var d = wallWorldPx();
  var r = sampleBoxElementRect(window.innerWidth, window.innerHeight, wallSize(), d.w / d.h);
  el.style.left = (r.left * 100) + '%';
  el.style.top = (r.top * 100) + '%';
  el.style.width = (r.width * 100) + '%';
  el.innerHTML = giftBoxSvg(BOX_PATTERNS[stageBoxPatternIndex(playStage)].id, 'wall');
  el.style.opacity = sampleBoxActive() ? '0.55' : '0.35';
  return el;
}
/* 床の猫の要素: 足元は床に固定 (bottom 指定)、移動は x だけ */
function buildWallCatEl(p) {
  var c = catById(p.id);
  var el = document.createElement('div');
  el.className = 'wall-el wall-cat';
  el.style.left = (p.x * 100) + '%';
  el.style.bottom = ((1 - CAT_FEET_Y) * 100) + '%';
  el.style.width = (c.w * 100 / wallSize().w) + '%';
  el.dataset.kind = 'cat';
  el.dataset.key = p.id;
  var sh = document.createElement('div');
  sh.className = 'wall-cat-shadow';
  el.appendChild(sh);
  var img = document.createElement('img');
  img.src = 'cats/' + c.id + '.webp';
  img.alt = c.name;
  img.draggable = false;
  el.appendChild(img);
  attachWallDrag(el, 'cat', p.id);
  return el;
}
function buildWallItemEl(p) {
  var it = wallItemById(p.id);
  var el = document.createElement('div');
  el.className = 'wall-el wall-item';
  el.style.left = (p.x * 100) + '%';
  el.style.top = (p.y * 100) + '%';
  el.style.width = (wallItemWidthRatio(it) * 100 / wallSize().w) + '%';
  el.dataset.kind = 'item';
  el.dataset.key = p.uid;
  var img = document.createElement('img');
  img.src = 'wall-items/' + it.id + '.webp';
  img.alt = it.name;
  img.draggable = false;
  el.appendChild(img);
  attachWallDrag(el, 'item', p.uid);
  return el;
}
/* ---------- 額装フレームの Canvas 描画 (承認済みレシピ) ----------
 * 額ユニット全体 (落影・枠帯・マット・盤面・装飾) を 1 枚の Canvas に描く。
 * レシピの正本は room-samples/wall-mock-final.png の描画手順: マイター
 * (斜め継ぎ) の帯に面ごとの陰影 (光は左上から) と素材の質感を重ね、
 * 内側に面取りとマット、装飾は陰影つきで描く。Canvas は配置・スタイル
 * 変更・壁の再描画のときにだけ生成し、ドラッグ中は要素ごと移動する。 */
function rgbCss(rgb, a) {
  return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (a === undefined ? 1 : a) + ')';
}
function tracePoly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
function fillPoly(ctx, pts, style) {
  tracePoly(ctx, pts);
  ctx.fillStyle = style;
  ctx.fill();
}
/* 帯の形 (外矩形 − 内矩形) でクリップする */
function frameBandClip(ctx, X0, Y0, U, bw) {
  var p = new Path2D();
  p.rect(X0, Y0, U, U);
  p.rect(X0 + bw, Y0 + bw, U - 2 * bw, U - 2 * bw);
  ctx.clip(p, 'evenodd');
}
/* 木目: 帯の各辺に、その辺の向きに沿った細いストリークを散らす */
function drawFrameGrainSide(ctx, poly, horizontal, rng, U) {
  ctx.save();
  tracePoly(ctx, poly);
  ctx.clip();
  var xs = poly.map(function (p) { return p[0]; });
  var ys = poly.map(function (p) { return p[1]; });
  var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
  var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  var along = horizontal ? (maxX - minX) : (maxY - minY);
  var across = horizontal ? (maxY - minY) : (maxX - minX);
  var n = Math.max(4, Math.round(along / (U * 0.055)));
  ctx.lineCap = 'round';
  for (var i = 0; i < n; i++) {
    var dark = rng() < 0.6;
    var a = 0.05 + rng() * 0.075;
    ctx.strokeStyle = dark ? 'rgba(40,24,10,' + a.toFixed(3) + ')' : 'rgba(255,236,200,' + (a * 0.85).toFixed(3) + ')';
    ctx.lineWidth = rng() < 0.75 ? 1 : 1.6;
    var t = 0.12 + rng() * 0.76;
    var s0 = rng() * 0.55;
    var sl = 0.16 + rng() * 0.30;
    var wob = (rng() - 0.5) * Math.max(1.5, U * 0.008);
    ctx.beginPath();
    if (horizontal) {
      var y = minY + t * across;
      ctx.moveTo(minX + s0 * along, y);
      ctx.lineTo(minX + (s0 + sl) * along, y + wob);
    } else {
      var x = minX + t * across;
      ctx.moveTo(x, minY + s0 * along);
      ctx.lineTo(x + wob, minY + (s0 + sl) * along);
    }
    ctx.stroke();
  }
  ctx.restore();
}
/* 金属帯の斜めの光沢 (左上→右下の柔らかい帯状ハイライト) */
function drawFrameMetalSheen(ctx, X0, Y0, U) {
  var gr = ctx.createLinearGradient(X0, Y0, X0 + U, Y0 + U);
  gr.addColorStop(0, 'rgba(255,246,214,0)');
  gr.addColorStop(0.23, 'rgba(255,246,214,0.07)');
  gr.addColorStop(0.393, 'rgba(255,246,214,0.27)');
  gr.addColorStop(0.555, 'rgba(255,246,214,0.07)');
  gr.addColorStop(0.718, 'rgba(255,246,214,0)');
  gr.addColorStop(1, 'rgba(255,246,214,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(X0, Y0, U, U);
}
/* エナメル/紙の柔らかな gloss (上ほど明るい) */
function drawFrameGloss(ctx, X0, Y0, U, peak) {
  var gr = ctx.createLinearGradient(0, Y0, 0, Y0 + U);
  gr.addColorStop(0, 'rgba(255,255,255,' + peak + ')');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(X0, Y0, U, U);
}
/* 虹色の帯: 辺ごとに、その辺が受け持つ周囲位置 t の範囲で補間する */
function fillRainbowSide(ctx, poly, x0, y0, x1, y1, t0, t1, f) {
  var gr = ctx.createLinearGradient(x0, y0, x1, y1);
  [0, 0.25, 0.5, 0.75, 1].forEach(function (s) {
    gr.addColorStop(s, rgbCss(shadeRgb(rainbowColorAt(t0 + (t1 - t0) * s), f)));
  });
  fillPoly(ctx, poly, gr);
}
/* マット内側の影: 盤面の縁からマット側へ薄れる 4 辺のグラデーション */
function drawMatInnerShadow(ctx, bx, by, B, w) {
  var A = 'rgba(70,50,30,0.28)', Z = 'rgba(70,50,30,0)';
  var g;
  g = ctx.createLinearGradient(0, by - w, 0, by);
  g.addColorStop(0, Z); g.addColorStop(1, A);
  ctx.fillStyle = g; ctx.fillRect(bx, by - w, B, w);
  g = ctx.createLinearGradient(0, by + B, 0, by + B + w);
  g.addColorStop(0, A); g.addColorStop(1, Z);
  ctx.fillStyle = g; ctx.fillRect(bx, by + B, B, w);
  g = ctx.createLinearGradient(bx - w, 0, bx, 0);
  g.addColorStop(0, Z); g.addColorStop(1, A);
  ctx.fillStyle = g; ctx.fillRect(bx - w, by, w, B);
  g = ctx.createLinearGradient(bx + B, 0, bx + B + w, 0);
  g.addColorStop(0, A); g.addColorStop(1, Z);
  ctx.fillStyle = g; ctx.fillRect(bx + B, by, w, B);
}
/* 内側の細線 (白は二重線) */
function drawFrameLine(ctx, st, X0, Y0, U, bw) {
  ctx.strokeStyle = st.line;
  ctx.lineWidth = Math.max(1, U * 0.006);
  var d = bw * 0.72;
  ctx.strokeRect(X0 + d, Y0 + d, U - 2 * d, U - 2 * d);
  if (st.lineDouble) {
    var d2 = bw * 0.35;
    ctx.strokeRect(X0 + d2, Y0 + d2, U - 2 * d2, U - 2 * d2);
  }
}
/* アンティークの四隅飾り (金の三角 + 点) */
function drawFrameCorners(ctx, X0, Y0, U) {
  var tri = U * 0.103, d = U * 0.034, r = Math.max(1.5, U * 0.013);
  [[X0, Y0, 1, 1], [X0 + U, Y0, -1, 1], [X0, Y0 + U, 1, -1], [X0 + U, Y0 + U, -1, -1]].forEach(function (c) {
    fillPoly(ctx, [[c[0], c[1]], [c[0] + c[2] * tri, c[1]], [c[0], c[1] + c[3] * tri]], 'rgb(244,220,150)');
    ctx.beginPath();
    ctx.arc(c[0] + c[2] * d, c[1] + c[3] * d, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgb(255,236,180)';
    ctx.fill();
  });
}
/* リボン: 結び目・折り目のハイライト・垂れる尾まで陰影つきで描く */
function drawFrameBow(ctx, cx, cy, s) {
  var pink = 'rgb(238,168,188)', dark = 'rgb(196,116,146)', light = 'rgb(250,205,218)';
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1, s * 0.06);
  [[0, 0, -s, -s * 0.6, -s * 0.92, s * 0.5], [0, 0, s, -s * 0.6, s * 0.92, s * 0.5]].forEach(function (p) {
    tracePoly(ctx, [[p[0], p[1]], [p[2], p[3]], [p[4], p[5]]]);
    ctx.fillStyle = pink; ctx.fill(); ctx.stroke();
  });
  ctx.strokeStyle = light;
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.beginPath(); ctx.moveTo(-s * 0.75, -s * 0.28); ctx.lineTo(-s * 0.15, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s * 0.75, -s * 0.28); ctx.lineTo(s * 0.15, 0); ctx.stroke();
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1, s * 0.06);
  [[-s * 0.16, s * 0.18, -s * 0.40, s * 0.85, -s * 0.02, s * 0.66],
   [s * 0.16, s * 0.18, s * 0.40, s * 0.85, s * 0.02, s * 0.66]].forEach(function (p) {
    tracePoly(ctx, [[p[0], p[1]], [p[2], p[3]], [p[4], p[5]]]);
    ctx.fillStyle = pink; ctx.fill(); ctx.stroke();
  });
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = pink; ctx.fill(); ctx.stroke();
  ctx.restore();
}
/* 小花 (2 トーンの花びら + 芯) と葉 */
function drawFrameFlower(ctx, cx, cy, r, petal, center) {
  for (var k = 0; k < 5; k++) {
    var ang = k * Math.PI * 2 / 5 - Math.PI / 2;
    var px = cx + r * 0.8 * Math.cos(ang), py = cy + r * 0.8 * Math.sin(ang);
    ctx.beginPath();
    ctx.arc(px, py, r * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = rgbCss(shadeRgb(petal, 0.94));
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px - r * 0.02, py - r * 0.10, r * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = rgbCss(petal);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.30, 0, Math.PI * 2);
  ctx.fillStyle = rgbCss(center);
  ctx.fill();
}
function drawFrameLeaf(ctx, cx, cy, r) {
  fillPoly(ctx, [[cx - r, cy + r * 0.6], [cx, cy - r], [cx + r, cy + r * 0.6], [cx, cy + r * 0.25]], 'rgb(126,160,110)');
}
function drawFrameFlowers(ctx, X0, Y0, U, inset) {
  var m = inset / 2; // 帯 (+マット) の中線に沿って並べる
  var spots = [];
  var i;
  for (i = 0; i < 7; i++) spots.push([X0 + U * (i + 0.5) / 7, Y0 + m]);
  for (i = 0; i < 7; i++) spots.push([X0 + U * (i + 0.5) / 7, Y0 + U - m]);
  for (i = 0; i < 5; i++) spots.push([X0 + m, Y0 + U * (i + 0.5) / 5]);
  for (i = 0; i < 5; i++) spots.push([X0 + U - m, Y0 + U * (i + 0.5) / 5]);
  var pink = [240, 186, 200], white = [250, 246, 236], center = [243, 203, 110];
  spots.forEach(function (s, idx) {
    if (idx % 3 === 2) drawFrameLeaf(ctx, s[0], s[1], U * 0.043);
    else drawFrameFlower(ctx, s[0], s[1], U * 0.048, idx % 2 ? white : pink, center);
  });
}
/* 四芒星 (キラキラ型) のパス */
function sparklePath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (var i = 0; i < 8; i++) {
    var ang = -Math.PI / 2 + i * Math.PI / 4;
    var rr = i % 2 === 0 ? r : r * 0.36;
    var x = cx + rr * Math.cos(ang), y = cy + rr * Math.sin(ang);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
/* 星空: 金の四芒星を帯の中線に散らし、柔らかいグローを下に敷く */
function drawFrameStars(ctx, X0, Y0, U, inset, rng) {
  var m = inset / 2;
  var spots = [];
  for (var i = 0; i < 12; i++) {
    var side = Math.floor(rng() * 4);
    var along = 0.04 + rng() * 0.92;
    var r = U * (0.020 + rng() * 0.013);
    var sx, sy;
    if (side === 0) { sx = X0 + along * U; sy = Y0 + m; }
    else if (side === 1) { sx = X0 + along * U; sy = Y0 + U - m; }
    else if (side === 2) { sx = X0 + m; sy = Y0 + along * U; }
    else { sx = X0 + U - m; sy = Y0 + along * U; }
    spots.push({ x: sx, y: sy, r: r });
  }
  ctx.save();
  ctx.shadowColor = 'rgba(255,220,130,0.85)';
  ctx.shadowBlur = Math.max(2, U * 0.03);
  ctx.fillStyle = 'rgb(255,220,130)';
  spots.forEach(function (s) { sparklePath(ctx, s.x, s.y, s.r); ctx.fill(); });
  ctx.restore();
  ctx.fillStyle = 'rgb(255,226,140)';
  spots.forEach(function (s) { sparklePath(ctx, s.x, s.y, s.r); ctx.fill(); });
}
/* 真珠ドット (左上にハイライト・下に陰) */
function drawFramePearlDot(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(243,240,235)';
  ctx.fill();
  ctx.strokeStyle = 'rgb(198,190,178)';
  ctx.lineWidth = Math.max(0.75, r * 0.12);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.88, Math.PI / 9, Math.PI * 7 / 9);
  ctx.strokeStyle = 'rgb(214,206,196)';
  ctx.lineWidth = Math.max(0.75, r * 0.22);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.18, cy - r * 0.30, r * 0.28, r * 0.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
}
function drawFramePearls(ctx, X0, Y0, U, inset) {
  var m = inset / 2;
  var step = U * 0.079, r = U * 0.024;
  var x, y;
  for (x = X0 + step / 2; x < X0 + U; x += step) {
    drawFramePearlDot(ctx, x, Y0 + m, r);
    drawFramePearlDot(ctx, x, Y0 + U - m, r);
  }
  for (y = Y0 + step; y < Y0 + U; y += step) {
    drawFramePearlDot(ctx, X0 + m, y, r);
    drawFramePearlDot(ctx, X0 + U - m, y, r);
  }
}
/* 王冠 (宝石つき): 上部中央に帯へまたがせて描く */
function drawFrameCrown(ctx, cx, cy, s) {
  ctx.save();
  ctx.translate(cx, cy);
  var gold = 'rgb(226,182,80)', dark = 'rgb(150,110,30)', lite = 'rgb(246,220,140)';
  tracePoly(ctx, [[-s, s * 0.5], [-s, -s * 0.45], [-s * 0.5, -s * 0.05], [0, -s * 0.62], [s * 0.5, -s * 0.05], [s, -s * 0.45], [s, s * 0.5]]);
  ctx.fillStyle = gold; ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = lite;
  ctx.fillRect(-s, s * 0.32, 2 * s, s * 0.18);
  [[-s * 0.55, 'rgb(214,110,110)'], [0, 'rgb(110,150,214)'], [s * 0.55, 'rgb(214,110,110)']].forEach(function (j) {
    ctx.beginPath();
    ctx.ellipse(j[0], s * 0.17, s * 0.12, s * 0.12, 0, 0, Math.PI * 2);
    ctx.fillStyle = j[1];
    ctx.fill();
  });
  [[-s, -s * 0.45], [0, -s * 0.62], [s, -s * 0.45]].forEach(function (p) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], s * 0.10, 0, Math.PI * 2);
    ctx.fillStyle = lite;
    ctx.fill();
  });
  ctx.restore();
}
/* 盤面プレースホルダ (ロード中/記録なし) */
function drawFrameBoardPlaceholder(ctx, bx, by, B, U, state) {
  ctx.fillStyle = '#DED5BF';
  ctx.fillRect(bx, by, B, B);
  ctx.fillStyle = 'rgba(90,70,40,0.65)';
  ctx.font = '600 ' + Math.max(11, Math.round(U * 0.045)) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(state === 'missing' ? '記録がありません' : '読み込み中…', bx + B / 2, by + B / 2);
}
/* 額ユニット 1 点を ctx に描く。座標は Canvas の CSS px で、ユニット
 * 外形の左上は (pad, pad)。board は完成盤面の Canvas (null の間は
 * boardState のプレースホルダ)。木目・星の乱数は seedKey で固定し、
 * 盤面ロード後の描き直しでも見た目が変わらないようにする。 */
function paintFrameUnit(ctx, st, U, board, boardState, seedKey, upperPieces) {
  var geo = frameGeometry(U, st);
  var bw = geo.bw, matW = geo.matW, B = geo.board;
  var X0 = geo.pad, Y0 = geo.pad, X1 = X0 + U, Y1 = Y0 + U;
  var rng = rngFromString('frame:' + st.id + ':' + seedKey);
  if (st.shape === 'circle') {
    paintCircleFrameUnit(ctx, st, U, board, boardState, seedKey, geo, upperPieces);
    return;
  }
  var base = hexToRgb(st.color);
  var ix0 = X0 + bw, iy0 = Y0 + bw, ix1 = X1 - bw, iy1 = Y1 - bw;
  var top = [[X0, Y0], [X1, Y0], [ix1, iy0], [ix0, iy0]];
  var bottom = [[X0, Y1], [ix0, iy1], [ix1, iy1], [X1, Y1]];
  var left = [[X0, Y0], [ix0, iy0], [ix0, iy1], [X0, Y1]];
  var right = [[X1, Y0], [X1, Y1], [ix1, iy1], [ix1, iy0]];
  // 1. 落影 (右下へ柔らかく)
  ctx.save();
  ctx.shadowColor = 'rgba(60,40,20,0.37)';
  ctx.shadowBlur = Math.max(2, U * 0.028);
  ctx.shadowOffsetX = U * 0.027;
  ctx.shadowOffsetY = U * 0.040;
  ctx.fillStyle = rgbCss(base);
  ctx.fillRect(X0, Y0, U, U);
  ctx.restore();
  // 2. 帯 (マイター継ぎ + 面ごとの陰影: 上 1.13 / 左 1.04 / 右 0.90 / 下 0.82)
  if (st.material === 'rainbow') {
    fillRainbowSide(ctx, top, X0, Y0, X1, Y0, 0, 0.25, 1.13);
    fillRainbowSide(ctx, right, X1, Y0, X1, Y1, 0.25, 0.5, 0.90);
    fillRainbowSide(ctx, bottom, X1, Y1, X0, Y1, 0.5, 0.75, 0.82);
    fillRainbowSide(ctx, left, X0, Y1, X0, Y0, 0.75, 1, 1.04);
    ctx.save();
    frameBandClip(ctx, X0, Y0, U, bw);
    drawFrameGloss(ctx, X0, Y0, U, 0.10);
    ctx.restore();
  } else {
    fillPoly(ctx, top, rgbCss(shadeRgb(base, 1.13)));
    fillPoly(ctx, bottom, rgbCss(shadeRgb(base, 0.82)));
    fillPoly(ctx, left, rgbCss(shadeRgb(base, 1.04)));
    fillPoly(ctx, right, rgbCss(shadeRgb(base, 0.90)));
    // 3. 素材の質感 (帯にクリップして重ねる)
    ctx.save();
    frameBandClip(ctx, X0, Y0, U, bw);
    if (st.material === 'wood') {
      drawFrameGrainSide(ctx, top, true, rng, U);
      drawFrameGrainSide(ctx, bottom, true, rng, U);
      drawFrameGrainSide(ctx, left, false, rng, U);
      drawFrameGrainSide(ctx, right, false, rng, U);
    } else if (st.material === 'metal') {
      drawFrameMetalSheen(ctx, X0, Y0, U);
    } else {
      drawFrameGloss(ctx, X0, Y0, U, 0.14);
    }
    ctx.restore();
  }
  // 4. 面取り (外周の暗線 + 内周のハイライト/影)
  var lw = Math.max(1, U * 0.007);
  var rainbow = st.material === 'rainbow';
  ctx.lineWidth = lw;
  ctx.strokeStyle = rainbow ? 'rgba(96,74,52,0.8)' : rgbCss(shadeRgb(base, 0.55));
  ctx.strokeRect(X0 + lw / 2, Y0 + lw / 2, U - lw, U - lw);
  function bevelLine(xa, ya, xb, yb, style) {
    ctx.strokeStyle = style;
    ctx.beginPath();
    ctx.moveTo(xa, ya);
    ctx.lineTo(xb, yb);
    ctx.stroke();
  }
  bevelLine(ix0, iy0, ix1, iy0, rainbow ? 'rgba(255,255,255,0.55)' : rgbCss(shadeRgb(base, 1.28)));
  bevelLine(ix0, iy0, ix0, iy1, rainbow ? 'rgba(255,255,255,0.45)' : rgbCss(shadeRgb(base, 1.20)));
  bevelLine(ix0, iy1, ix1, iy1, rainbow ? 'rgba(96,74,52,0.40)' : rgbCss(shadeRgb(base, 0.60)));
  bevelLine(ix1, iy0, ix1, iy1, rainbow ? 'rgba(96,74,52,0.32)' : rgbCss(shadeRgb(base, 0.70)));
  // 5. マット + 盤面側へ落ちる影
  var bx = X0 + bw + matW, by = Y0 + bw + matW;
  if (matW > 0) {
    ctx.fillStyle = st.mat;
    ctx.fillRect(ix0, iy0, U - 2 * bw, U - 2 * bw);
    drawMatInnerShadow(ctx, bx, by, B, Math.max(3, U * 0.027));
  }
  // 6. 盤面
  if (board) ctx.drawImage(board, bx, by, B, B);
  else drawFrameBoardPlaceholder(ctx, bx, by, B, U, boardState);
  // 7. 細線と装飾 (陰影つき)
  if (st.line) drawFrameLine(ctx, st, X0, Y0, U, bw);
  if (st.ornament === 'ribbon') drawFrameBow(ctx, bx + B - U * 0.038, Y0 - U * 0.01, U * 0.145);
  else if (st.ornament === 'flowers') drawFrameFlowers(ctx, X0, Y0, U, bw + matW);
  else if (st.ornament === 'stars') drawFrameStars(ctx, X0, Y0, U, bw + matW, rng);
  else if (st.ornament === 'corners') drawFrameCorners(ctx, X0, Y0, U);
  else if (st.ornament === 'pearl') drawFramePearls(ctx, X0, Y0, U, bw + matW);
  else if (st.ornament === 'crown') drawFrameCrown(ctx, X0 + U / 2, Y0 - U * 0.017, U * 0.147);
  // 8. 装飾ティア: 額の外側4隅にフラットな三角キャップを付ける (案F6。
  // 絵の中には何も描かない。額自体の豪華化ではなく「付け足す装飾」として区別する)。
  // 銀 (中位) は銀キャップ、金 (上位) は金キャップ、最上位 (royal) は
  // 金キャップ + 額の全周に細い金ライン (案B)。
  if (upperPieces) drawFrameCornerCaps(ctx, X0, Y0, U, frameTier(upperPieces));
}
/* 装飾ティア (案F6 + B): 額の外側4隅に付ける、フラットでマットな三角キャップ。
 * 壁インテリアの作風 (単色 + 輪郭線) に合わせ、グラデーションや影は付けない。
 * tier: 'silver' = 銀キャップ / 'gold' = 金キャップ /
 * 'royal' = 金キャップ + 額の全周に細い金ライン (最上位 1024 専用、案B) */
var CAP_COLORS = {
  bronze: { fill: '#b26a35', edge: '#86501f' },
  silver: { fill: '#b9bfc7', edge: '#8f979f' },
  gold: { fill: '#c9a24b', edge: '#a48034' },
  royal: { fill: '#c9a24b', edge: '#a48034' }
};
function drawFrameCornerCaps(ctx, X0, Y0, U, tier) {
  var col = CAP_COLORS[tier] || CAP_COLORS.gold;
  var L = U * 0.135;
  var X1 = X0 + U, Y1 = Y0 + U;
  var corners = [
    [X0, Y0, 1, 1], [X1, Y0, -1, 1], [X0, Y1, 1, -1], [X1, Y1, -1, -1]
  ];
  ctx.save();
  if (tier === 'royal') {
    // 全周の金ライン (キャップの下に敷く: 隅ではキャップが上に重なる)
    var inset = U * 0.024;
    ctx.strokeStyle = col.fill;
    ctx.lineWidth = Math.max(1, U * 0.012);
    ctx.strokeRect(X0 + inset, Y0 + inset, U - inset * 2, U - inset * 2);
  }
  ctx.fillStyle = col.fill;
  ctx.strokeStyle = col.edge;
  ctx.lineWidth = Math.max(1, U * 0.007);
  ctx.lineJoin = 'round';
  for (var i = 0; i < corners.length; i++) {
    var c = corners[i];
    ctx.beginPath();
    ctx.moveTo(c[0], c[1]);
    ctx.lineTo(c[0] + c[2] * L, c[1]);
    ctx.lineTo(c[0], c[1] + c[3] * L);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(c[0] + c[2] * L, c[1]);
    ctx.lineTo(c[0], c[1] + c[3] * L);
    ctx.stroke();
  }
  ctx.restore();
}
/* 装飾ティア (円形フレーム用): 四角い額のキャップ (案F6) に相当する表現として、
 * リング (額) 自体の左上部分をティア色のフラットな弧に替える。絵の中には描かない。 */
function drawCircleUpperArc(ctx, cx, cy, R, bw, tier) {
  var col = CAP_COLORS[tier] || CAP_COLORS.gold;
  var rMid = R - bw / 2;
  var a0 = Math.PI * 202 / 180, a1 = Math.PI * 248 / 180;
  ctx.save();
  if (tier === 'royal') {
    // 最上位: リングの外周寄りに細い金ラインを全周に引く (四角額の全周ライン相当)
    ctx.strokeStyle = col.fill;
    ctx.lineWidth = Math.max(1, R * 0.02);
    ctx.beginPath();
    ctx.arc(cx, cy, R - Math.max(1, R * 0.02), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = col.fill;
  ctx.lineWidth = bw;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.arc(cx, cy, rMid, a0, a1);
  ctx.stroke();
  // 弧の両端に一段濃い仕切り線
  ctx.strokeStyle = col.edge;
  ctx.lineWidth = Math.max(1, R * 0.014);
  [a0, a1].forEach(function (a) {
    ctx.beginPath();
    ctx.moveTo(cx + (R - bw) * Math.cos(a), cy + (R - bw) * Math.sin(a));
    ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
    ctx.stroke();
  });
  ctx.restore();
}
/* まるフレーム: 木目のリング + 面取り (弧のハイライト) + 円形の盤面 */
function paintCircleFrameUnit(ctx, st, U, board, boardState, seedKey, geo, upperPieces) {
  var bw = geo.bw, pad = geo.pad;
  var cx = pad + U / 2, cy = pad + U / 2;
  var R = U / 2, rIn = R - bw;
  var base = hexToRgb(st.color);
  var rng = rngFromString('frame:' + st.id + ':' + seedKey);
  // 落影
  ctx.save();
  ctx.shadowColor = 'rgba(60,40,20,0.37)';
  ctx.shadowBlur = Math.max(2, U * 0.028);
  ctx.shadowOffsetX = U * 0.027;
  ctx.shadowOffsetY = U * 0.040;
  ctx.fillStyle = rgbCss(base);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // リング本体
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = rgbCss(shadeRgb(base, 1.05));
  ctx.fill();
  // 木目 (リングにクリップ)
  ctx.save();
  var ring = new Path2D();
  ring.arc(cx, cy, R, 0, Math.PI * 2);
  ring.arc(cx, cy, rIn, 0, Math.PI * 2);
  ctx.clip(ring, 'evenodd');
  ctx.lineCap = 'round';
  var n = Math.max(12, Math.round(U * 0.16));
  for (var i = 0; i < n; i++) {
    var dark = rng() < 0.6;
    var a = 0.04 + rng() * 0.06;
    ctx.strokeStyle = dark ? 'rgba(40,24,10,' + a.toFixed(3) + ')' : 'rgba(255,236,200,' + (a * 0.85).toFixed(3) + ')';
    ctx.lineWidth = rng() < 0.75 ? 1 : 1.6;
    var sx = cx - R + rng() * U * 0.5;
    var sy = cy - R + rng() * U;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + U * (0.16 + rng() * 0.30), sy + (rng() - 0.5) * Math.max(1.5, U * 0.008));
    ctx.stroke();
  }
  ctx.restore();
  // 面取り: 外周の暗線・内周のハイライト・弧のハイライト
  var lw = Math.max(1, U * 0.007);
  ctx.lineWidth = lw;
  ctx.strokeStyle = rgbCss(shadeRgb(base, 0.55));
  ctx.beginPath();
  ctx.arc(cx, cy, R - lw / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = rgbCss(shadeRgb(base, 1.30));
  ctx.beginPath();
  ctx.arc(cx, cy, rIn + lw / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = Math.max(2, U * 0.018);
  ctx.strokeStyle = rgbCss(shadeRgb(base, 1.35), 0.63);
  ctx.beginPath();
  ctx.arc(cx, cy, R - lw, Math.PI * 100 / 180, Math.PI * 200 / 180);
  ctx.stroke();
  // 盤面 (円形クリップ)
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rIn, 0, Math.PI * 2);
  ctx.clip();
  if (board) ctx.drawImage(board, cx - rIn, cy - rIn, rIn * 2, rIn * 2);
  else drawFrameBoardPlaceholder(ctx, cx - rIn, cy - rIn, rIn * 2, U, boardState);
  ctx.restore();
  // 装飾ティア (円形): リングの左上をティア色の弧に替える (四角額のキャップ相当)
  if (upperPieces) drawCircleUpperArc(ctx, cx, cy, R, bw, frameTier(upperPieces));
}
function buildWallFrameEl(f) {
  var rec = recordByWallKey(f.recordKey);
  var st = frameStyleById(f.color) || frameStyleById('walnut');
  var el = document.createElement('div');
  el.className = 'wall-el wall-frame';
  el.dataset.kind = 'frame';
  el.dataset.key = f.recordKey;
  el.style.left = (f.x * 100) + '%';
  el.style.top = (f.y * 100) + '%';
  el.style.width = (f.w * 100 / wallSize().w) + '%';
  var cv = document.createElement('canvas');
  cv.className = 'frame-canvas';
  el.appendChild(cv);
  paintWallFrameUnit(cv, f, rec, st);
  attachWallDrag(el, 'frame', f.recordKey);
  return el;
}
/* 額ユニットの Canvas を生成する。盤面の読み込みが終わったら同じ手順で
 * 描き直す (乱数はシード固定なので枠の見た目は変わらない)。 */
function paintWallFrameUnit(cv, f, rec, st) {
  var stage = $('wallStage');
  var stageW = (stage && stage.clientWidth) || 360;
  var U = Math.max(24, stageW * f.w);
  var geo = frameGeometry(U, st);
  var scale = 2; // 解像度倍率 (CSS px に対して 2 倍で描いて滲みを防ぐ)
  var px = Math.round(geo.size * scale);
  cv.width = px;
  cv.height = px;
  var ctx = cv.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  // 装飾ティアは対象レコード (銀/金/特別装飾の難易度) のときだけ付ける
  var upperPieces = rec && isUpperTier(rec.pieces) ? rec.pieces : 0;
  paintFrameUnit(ctx, st, U, null, rec ? 'loading' : 'missing', f.recordKey, upperPieces);
  if (!rec) return;
  renderWallBoardCanvas(rec).then(function (board) {
    if (!cv.isConnected) return; // 壁を作り直していたら古い描画は捨てる
    var c2 = cv.getContext('2d');
    c2.setTransform(scale, 0, 0, scale, 0, 0);
    c2.clearRect(0, 0, geo.size, geo.size);
    paintFrameUnit(c2, st, U, board, 'ready', f.recordKey, upperPieces);
  });
}
/* 壁の額装パズル: コレクション詳細 (paintDetailBoard) と同じ辺生成・
 * 輪郭パスで、完成盤面をオフスクリーン Canvas に描く。ピースの形と数は
 * レコードの日付×難易度で決まる実物と一致する。 */
function renderWallBoardCanvas(rec) {
  return renderBoardCanvasAt(rec, detailRenderPlan(rec.pieces).sizePx);
}
/* 完成盤面を指定サイズで描く。額装は詳細サイズ、額装ピッカーの
 * サムネイルは小サイズで、どちらも同じ実ピース形状の見た目にする。 */
function renderBoardCanvasAt(rec, sizePx) {
  var plan = detailRenderPlan(rec.pieces);
  var bcv = document.createElement('canvas');
  bcv.width = sizePx;
  bcv.height = sizePx;
  return loadDetailSource(rec).then(function (src) {
    var ctx = bcv.getContext('2d');
    var layout = { n: plan.n, cellPx: sizePx / plan.n, ox: 0, oy: 0, boardPx: sizePx };
    var edges = generateEdges(rec.date, rec.pieces);
    for (var id = 0; id < plan.n * plan.n; id++) {
      var home = pieceHome(id, plan.n);
      var path = detailPiecePath(edges, home.col, home.row, layout, plan.perSeg);
      ctx.save();
      ctx.clip(path);
      ctx.drawImage(src, 0, 0, sizePx, sizePx);
      ctx.restore();
      strokePieceBevel(ctx, path, pieceRelief(layout.cellPx).bevel); // プレイ画面と揃える
      ctx.strokeStyle = 'rgba(30,30,30,0.35)';
      ctx.lineWidth = Math.max(1, layout.cellPx * 0.02);
      ctx.stroke(path);
    }
    return bcv;
  });
}

/* 壁要素のドラッグ (移動) とタップ (選択)。アイテムは掴んだ順に最前面へ */
function wallDragEntry(kind, key) {
  if (kind === 'item') return wallPlacedByUid(key);
  if (kind === 'cat') return wallCatPlacedEntry(key);
  return wallFrameEntry(key);
}
function attachWallDrag(el, kind, key) {
  el.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    var entry = wallDragEntry(kind, key);
    if (!entry) return;
    try { el.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    if (kind === 'item') {
      // 最後に触ったアイテムが最前面 (placed の配列順 = 重なり順)
      store.wall.placed.splice(store.wall.placed.indexOf(entry), 1);
      store.wall.placed.push(entry);
      el.parentNode.appendChild(el);
    }
    selectWall(kind, key);
    var pt = wallPointFromClient(ev.clientX, ev.clientY);
    wallDrag = {
      kind: kind, key: key, el: el, moved: false,
      startX: ev.clientX, startY: ev.clientY,
      offX: pt.x - entry.x,
      offY: pt.y - entry.y
    };
  });
  el.addEventListener('pointermove', function (ev) {
    if (!wallDrag || wallDrag.kind !== kind || wallDrag.key !== key) return;
    if (Math.abs(ev.clientX - wallDrag.startX) + Math.abs(ev.clientY - wallDrag.startY) > 6) wallDrag.moved = true;
    if (!wallDrag.moved) return;
    var entry = wallDragEntry(kind, key);
    if (!entry) return;
    var pt = wallPointFromClient(ev.clientX, ev.clientY);
    if (kind === 'cat') {
      // 猫は床に固定: 横移動だけ (足元は動かさない)
      entry.x = Math.min(0.95, Math.max(0.05, pt.x - wallDrag.offX));
      el.style.left = (entry.x * 100) + '%';
      return;
    }
    var c = clampItemPos(pt.x - wallDrag.offX, pt.y - wallDrag.offY);
    entry.x = c.x;
    entry.y = c.y;
    el.style.left = (c.x * 100) + '%';
    el.style.top = (c.y * 100) + '%';
  });
  function endDrag() {
    if (!wallDrag || wallDrag.kind !== kind || wallDrag.key !== key) return;
    var wasDrag = wallDrag.moved;
    wallDrag = null;
    updateSampleBoxOpacity();
    if (wasDrag) { saveStore(); sePlace(); }
  }
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('lostpointercapture', endDrag);
}
function selectWall(kind, key) {
  wallSelected = kind ? { kind: kind, key: key } : null;
  document.querySelectorAll('#wallStage .wall-el').forEach(function (el) {
    el.classList.toggle('sel', !!wallSelected && el.dataset.kind === kind && el.dataset.key === key);
  });
  updateWallSelBar();
  renderWallTray();
  updateSampleBoxOpacity();
}
function updateWallSelBar() {
  var bar = $('wallSelBar');
  if (!wallSelected) { bar.hidden = true; return; }
  bar.hidden = false;
  var isFrame = wallSelected.kind === 'frame';
  var selName = '';
  if (isFrame) selName = '額装パズル';
  else if (wallSelected.kind === 'item') {
    var selEntry = wallPlacedByUid(wallSelected.key);
    selName = selEntry ? ((wallItemById(selEntry.id) || {}).name || '') : '';
  } else selName = (collectibleById(wallSelected.key) || {}).name || '';
  $('wallSelName').textContent = selName;
  $('wallFrameColors').hidden = !isFrame;
  $('wallFrameSizes').hidden = !isFrame;
  if (isFrame) { renderFrameColorSwatches(); renderFrameSizeButtons(); }
}
/* フレーム色の選択肢: 解放済みスタイルだけを出す */
function renderFrameColorSwatches() {
  var box = $('wallFrameColors');
  box.innerHTML = '';
  var f = wallSelected && wallSelected.kind === 'frame' ? wallFrameEntry(wallSelected.key) : null;
  FRAME_STYLES.forEach(function (st) {
    if (store.wall.frameUnlocks.indexOf(st.id) < 0) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'frame-swatch' + (f && f.color === st.id ? ' active' : '');
    b.style.background = st.gradient || st.color;
    b.title = st.name;
    b.setAttribute('aria-label', st.name);
    b.addEventListener('click', function () {
      var fr = wallFrameEntry(wallSelected.key);
      if (!fr) return;
      fr.color = st.id;
      saveStore();
      renderWall();
      selectWall('frame', fr.recordKey);
    });
    box.appendChild(b);
  });
}
/* 額のサイズ3段階ボタン: 小/中/大。中心は維持し、拡大ではみ出す
 * ときだけ clampFrameCenter で内側へ寄せる (2026-11-10 ユーザー設計) */
function renderFrameSizeButtons() {
  var box = $('wallFrameSizes');
  box.innerHTML = '';
  var f = wallSelected && wallSelected.kind === 'frame' ? wallFrameEntry(wallSelected.key) : null;
  if (!f) return;
  var cur = frameSizeTierOf(f.w);
  FRAME_SIZE_TIERS.forEach(function (tier, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'frame-size-btn' + (i === cur ? ' active' : '');
    b.textContent = tier.label;
    b.setAttribute('aria-label', '額のサイズ ' + tier.label);
    b.addEventListener('click', function () {
      var fr = wallFrameEntry(wallSelected.key);
      if (!fr) return;
      fr.w = tier.w;
      var c = clampFrameCenter(fr, wallSize());
      fr.x = c.x;
      fr.y = c.y;
      saveStore();
      renderWall();
      selectWall('frame', fr.recordKey);
    });
    box.appendChild(b);
  });
}
function unplaceWallSelected() {
  if (!wallSelected) return;
  if (wallSelected.kind === 'item') {
    store.wall.placed = store.wall.placed.filter(function (p) { return p.uid !== wallSelected.key; });
  } else if (wallSelected.kind === 'cat') {
    store.wall.catsPlaced = (store.wall.catsPlaced || []).filter(function (p) { return p.id !== wallSelected.key; });
  } else {
    store.wall.frames = store.wall.frames.filter(function (f) { return f.recordKey !== wallSelected.key; });
  }
  wallSelected = null;
  saveStore();
  renderWall();
  seUnplace();
}
/* 下部トレイ: 所持アイテム (タップで配置/選択) + 額装の導線 */
function renderWallTray() {
  var wall = store.wall;
  var tray = $('wallTray');
  if (!tray) return;
  tray.innerHTML = '';
  if (!wall.owned.length) {
    tray.innerHTML = '<span class="decor-empty">まだ小物がありません。今日のパズルをクリアすると届きます</span>';
  }
  WALL_CATALOG.forEach(function (it) {
    if (wall.owned.indexOf(it.id) < 0) return;
    var count = 0;
    store.wall.placed.forEach(function (p) { if (p.id === it.id) count += 1; });
    var selEntry = wallSelected && wallSelected.kind === 'item' ? wallPlacedByUid(wallSelected.key) : null;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'decor-chip' + (count ? ' placed' : '') +
      (selEntry && selEntry.id === it.id ? ' sel' : '');
    b.innerHTML = '<img src="wall-items/' + it.id + '.webp" alt="">' +
      '<span class="decor-chip-name">' + it.name + '</span>' +
      '<span class="decor-chip-rarity">' + rarityLabel(it) + '</span>' +
      '<span class="decor-chip-state">' + (count === 0 ? '未配置' : count === 1 ? '配置中' : '配置中 ×' + count) + '</span>';
    b.addEventListener('click', function () {
      /* PBI 21: トレイのタップはいつでも新しい1点を置く (同じもの何個でも) */
      var placeAt = clampItemPos(wallCam.x, wallCam.y);
      var uid = nextWallItemUid(store.wall.placed);
      store.wall.placed.push({ id: it.id, uid: uid, x: placeAt.x, y: placeAt.y });
      saveStore();
      sePlace();
      renderWall();
      selectWall('item', uid);
    });
    tray.appendChild(b);
  });
  // 床の猫も同じトレイに並べる (タップで床に出す/選択)
  CAT_CATALOG.forEach(function (c) {
    if ((wall.catsOwned || []).indexOf(c.id) < 0) return;
    var placed = !!wallCatPlacedEntry(c.id);
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'decor-chip' + (placed ? ' placed' : '') +
      (wallSelected && wallSelected.kind === 'cat' && wallSelected.key === c.id ? ' sel' : '');
    b.innerHTML = '<img src="cats/' + c.id + '.webp" alt="">' +
      '<span class="decor-chip-name">' + c.name + '</span>' +
      '<span class="decor-chip-rarity">ねこ</span>' +
      '<span class="decor-chip-state">' + (placed ? '配置中' : '未配置') + '</span>';
    b.addEventListener('click', function () {
      if (!wallCatPlacedEntry(c.id)) {
        if (!Array.isArray(store.wall.catsPlaced)) store.wall.catsPlaced = [];
        store.wall.catsPlaced.push({ id: c.id, x: Math.min(0.95, Math.max(0.05, wallCam.x)) });
        saveStore();
        sePlace();
        renderWall();
      }
      selectWall('cat', c.id);
    });
    tray.appendChild(b);
  });
  $('wallFrameCount').textContent = wall.frames.length ? '額装 ' + wall.frames.length + ' 点を表示中' : '';
}
/* 額装ピッカー: 全画面のサムネイルグリッド (カメラロール風)。
 * 並べるのは実ピース形状の完成盤面サムネイルだけで、日付・難易度などの
 * 文字情報は一切出さない (旧ダイアログ版は大きな画像+テキストで横に
 * はみ出し、横スクロールが発生していた)。配置済みの記録は淡く+✓印で
 * 示し、タップできない。サムネイルは小 Canvas で描いてキャッシュし、
 * 開き直したときは再描画しない。 */
var frameThumbCache = new Map(); // recordKey -> canvas
var FRAME_THUMB_PX = 264;
function renderFrameThumb(rec) {
  var key = wallRecordKey(rec);
  if (frameThumbCache.has(key)) return Promise.resolve(frameThumbCache.get(key));
  return renderBoardCanvasAt(rec, FRAME_THUMB_PX).then(function (cv) {
    frameThumbCache.set(key, cv);
    return cv;
  });
}
function openFramePicker() {
  var grid = $('framePickerGrid');
  grid.innerHTML = '';
  var placedKeys = {};
  store.wall.frames.forEach(function (f) { placedKeys[f.recordKey] = true; });
  var recs = store.records.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.pieces - a.pieces; });
  $('framePickerEmpty').hidden = recs.length > 0;
  recs.forEach(function (r) {
    var key = wallRecordKey(r);
    var placed = !!placedKeys[key];
    var cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'frame-thumb' + (placed ? ' placed' : '');
    cell.disabled = placed;
    cell.setAttribute('aria-label', placed ? '壁に表示中のパズル' : 'このパズルを額装する');
    if (placed) {
      var mark = document.createElement('span');
      mark.className = 'frame-thumb-mark';
      mark.textContent = '✓';
      cell.appendChild(mark);
    }
    grid.appendChild(cell);
    renderFrameThumb(r).then(function (cv) {
      if (cell.isConnected) cell.insertBefore(cv, cell.firstChild);
    });
    if (!placed) {
      cell.addEventListener('click', function () {
        var placeAt = clampItemPos(wallCam.x, wallCam.y);
        store.wall.frames.push({ recordKey: key, x: placeAt.x, y: placeAt.y, w: 0.30, color: 'walnut' });
        saveStore();
        sePlace();
        navBack();
        renderWall();
        selectWall('frame', key);
      });
    }
  });
  $('framePickerView').hidden = false;
  navPush('framePicker');
}
function closeFramePicker() {
  $('framePickerView').hidden = true;
}

/* ---------- 壁の背景: 壁紙 + 床 + 巾木 (A 案 wall-feel-a) ----------
 * ステージ全面を 1 枚の背景 Canvas に描く。壁紙は巾木より上だけに適用し、
 * 下端に白い巾木とフローリングを描いて「部屋の壁」感を出す。床は見た目の
 * 追加のみで、配置データ (比率座標) は変わらない。描き直しは壁を開いた
 * 時・壁紙変更・ステージのリサイズ時だけ。柄の乱数は壁紙 id で固定する。 */
var WALL_FLOOR_RATIO = 0.115; // 床の高さ (ステージ高さ比)
var WALL_SKIRT_RATIO = 0.018; // 巾木の高さ (ステージ高さ比)

/* 4 点の星 (星空 / 月夜用。中心＋上下左右の尖り) */
function traceSparkStar(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r); ctx.quadraticCurveTo(cx, cy, cx + r, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy + r); ctx.quadraticCurveTo(cx, cy, cx - r, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy - r);
  ctx.closePath();
}
/* 壁紙 1 種の描画 (領域 x,y,w,h の中だけ)。kind ごとの小さな描画に分ける */
function paintWallpaperRegion(ctx, x, y, w, h, def) {
  var rng = rngFromString('paper:' + def.id);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = def.base;
  ctx.fillRect(x, y, w, h);
  var acc = def.accent ? hexToRgb(def.accent) : null;
  if (def.kind === 'stripe' && acc) {
    var gap = 46;
    ctx.fillStyle = rgbCss(acc, 1);
    for (var sx = 0; sx < w; sx += gap) ctx.fillRect(x + sx, y, 4, h);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (var sx2 = gap / 2; sx2 < w; sx2 += gap) ctx.fillRect(x + sx2, y, 1.5, h);
  } else if (def.kind === 'dot' && acc) {
    var dg = 52, drr = 3.4;
    ctx.fillStyle = rgbCss(acc, 1);
    for (var ry = 0, rowI = 0; ry < h + dg; ry += dg * 0.86, rowI++) {
      for (var cx = (rowI % 2) * dg / 2; cx < w + dg; cx += dg) {
        ctx.beginPath(); ctx.arc(x + cx, y + ry, drr, 0, Math.PI * 2); ctx.fill();
      }
    }
  } else if (def.kind === 'microdot' && acc) {
    var mg = 24;
    ctx.fillStyle = rgbCss(acc, 1);
    for (var my = mg / 2, mRow = 0; my < h + mg; my += mg, mRow++) {
      for (var mx = (mRow % 2) * mg / 2 + mg / 2; mx < w + mg; mx += mg) {
        ctx.beginPath(); ctx.arc(x + mx, y + my, 1.6, 0, Math.PI * 2); ctx.fill();
      }
    }
  } else if (def.kind === 'gingham' && acc) {
    var gb = 44;
    ctx.fillStyle = rgbCss(acc, 0.32);
    for (var gx = 0; gx < w; gx += gb * 2) ctx.fillRect(x + gx, y, gb, h);
    for (var gy = 0; gy < h; gy += gb * 2) ctx.fillRect(x, y + gy, w, gb);
  } else if (def.kind === 'floral' && acc) {
    var fg = 132, leaf = hexToRgb(def.leaf || '#A9BE9C');
    for (var fy2 = 0, fRow = 0; fy2 < h + fg; fy2 += fg, fRow++) {
      for (var fx = (fRow % 2) * fg / 2; fx < w + fg; fx += fg) {
        var cx2 = x + fx + rng() * 26, cy2 = y + fy2 + rng() * 26;
        ctx.fillStyle = rgbCss(leaf, 0.85);
        ctx.beginPath(); ctx.ellipse(cx2 + 7, cy2 + 8, 5, 2.4, 0.8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx2 - 7, cy2 + 7, 5, 2.4, -0.8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgbCss(acc, 1);
        for (var pi = 0; pi < 5; pi++) {
          var pa = (pi / 5) * Math.PI * 2 - Math.PI / 2;
          ctx.beginPath();
          ctx.arc(cx2 + Math.cos(pa) * 4.6, cy2 + Math.sin(pa) * 4.6, 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#EFC65E';
        ctx.beginPath(); ctx.arc(cx2, cy2, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
  } else if (def.kind === 'wood' && acc) {
    var bw = 118;
    ctx.fillStyle = rgbCss(acc, 0.3);
    for (var wx = bw; wx < w; wx += bw) ctx.fillRect(x + wx, y, 2.5, h);
    ctx.strokeStyle = rgbCss(acc, 0.22);
    ctx.lineWidth = 1.4;
    var streaks = Math.round((w * h) / 5200);
    for (var si = 0; si < streaks; si++) {
      var boardX = Math.floor(rng() * Math.ceil(w / bw)) * bw;
      var gx2 = x + boardX + 8 + rng() * (bw - 16), len = 26 + rng() * 62, gy2 = y + rng() * h;
      ctx.beginPath(); ctx.moveTo(gx2, gy2); ctx.lineTo(gx2 + (rng() - 0.5) * 2.5, gy2 + len); ctx.stroke();
    }
  } else if (def.kind === 'brick' && acc) {
    var bh = 36, bl = 92, mortar = 5;
    ctx.fillStyle = rgbCss(acc, 1);
    for (var by = 0, bRow = 0; by < h + bh; by += bh + mortar, bRow++) {
      for (var bx = (bRow % 2) * -(bl / 2); bx < w + bl; bx += bl + mortar) {
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x + bx, y + by, bl, bh, 3); else ctx.rect(x + bx, y + by, bl, bh);
        ctx.fill();
      }
    }
    var bShade = shadeColor(def.accent, 0.94);
    ctx.fillStyle = rgbCss(bShade, 0.5);
    for (var by2 = 0, bRow2 = 0; by2 < h + bh; by2 += bh + mortar, bRow2++) {
      for (var bx2 = (bRow2 % 2) * -(bl / 2); bx2 < w + bl; bx2 += bl + mortar) {
        ctx.fillRect(x + bx2 + 2, y + by2 + bh - 5, bl - 4, 3);
      }
    }
  } else if ((def.kind === 'starry' || def.kind === 'moonlit') && acc) {
    var stars = Math.round((w * h) / 2600);
    for (var ti = 0; ti < stars; ti++) {
      var tx = x + rng() * w, ty = y + rng() * h, tr = 2.4 + rng() * 5.2;
      ctx.fillStyle = rgbCss(acc, 0.35 + rng() * 0.6);
      traceSparkStar(ctx, tx, ty, tr);
      ctx.fill();
    }
    var dots = Math.round((w * h) / 1500);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (var di = 0; di < dots; di++) {
      ctx.beginPath(); ctx.arc(x + rng() * w, y + rng() * h, 1 + rng() * 1.3, 0, Math.PI * 2); ctx.fill();
    }
    if (def.kind === 'moonlit') {
      var moonX = x + w * 0.76, moonY = y + h * 0.22, moonR = Math.min(w, h) * 0.085;
      ctx.fillStyle = 'rgba(240,214,140,0.16)';
      ctx.beginPath(); ctx.arc(moonX, moonY, moonR * 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#F4E3AE';
      ctx.beginPath(); ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = def.base;
      ctx.beginPath(); ctx.arc(moonX + moonR * 0.42, moonY - moonR * 0.16, moonR * 0.86, 0, Math.PI * 2); ctx.fill();
      var sub = hexToRgb(def.sub || '#3A4A6B');
      ctx.fillStyle = rgbCss(sub, 0.85);
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y + h * 0.88);
      ctx.quadraticCurveTo(x + w * 0.3, y + h * 0.8, x + w * 0.58, y + h * 0.9);
      ctx.quadraticCurveTo(x + w * 0.8, y + h * 0.97, x + w, y + h * 0.9);
      ctx.lineTo(x + w, y + h);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}
/* 床 (フローリング) と白い巾木を壁の下端に描く。wallH = 壁紙の下端 y */
function paintWallFloorAndSkirt(ctx, W, H, wallH) {
  var skirtH = Math.max(4, Math.round(H * WALL_SKIRT_RATIO));
  var floorH = H - wallH - skirtH;
  if (floorH <= 0) return;
  var fy = wallH + skirtH;
  var rng = rngFromString('wall:floor');
  // 床: 上が明るく下へ少し濃くなる
  var gr = ctx.createLinearGradient(0, fy, 0, H);
  gr.addColorStop(0, '#C49E70');
  gr.addColorStop(1, '#A8865E');
  ctx.fillStyle = gr;
  ctx.fillRect(0, fy, W, floorH);
  // 板の継ぎ目 (横) と木目
  var rows = 3;
  ctx.fillStyle = 'rgba(120,88,55,0.45)';
  for (var r = 1; r < rows; r++) ctx.fillRect(0, fy + (floorH * r) / rows, W, Math.max(1, H * 0.0016));
  ctx.fillStyle = 'rgba(120,88,55,0.35)';
  for (var r2 = 0; r2 < rows; r2++) {
    var jx = rng() * W;
    ctx.fillRect(jx, fy + (floorH * r2) / rows, Math.max(1, H * 0.0016), floorH / rows);
  }
  ctx.lineWidth = 1;
  var streakN = Math.round((W * floorH) / 2400);
  for (var gi = 0; gi < streakN; gi++) {
    var gy3 = fy + rng() * floorH, gl = 24 + rng() * 70, gx3 = rng() * W;
    ctx.strokeStyle = rng() > 0.5 ? 'rgba(140,105,62,0.12)' : 'rgba(255,240,214,0.10)';
    ctx.beginPath(); ctx.moveTo(gx3, gy3); ctx.lineTo(gx3 + gl, gy3 + (rng() - 0.5) * 2); ctx.stroke();
  }
  // 床の上端に落ちる影 (巾木の直下)
  var sh = ctx.createLinearGradient(0, fy, 0, fy + floorH * 0.2);
  sh.addColorStop(0, 'rgba(90,66,38,0.30)');
  sh.addColorStop(1, 'rgba(90,66,38,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(0, fy, W, floorH * 0.2);
  // 白い巾木: 本体 + 上面ハイライト + 下端の影
  ctx.fillStyle = '#FAF6EC';
  ctx.fillRect(0, wallH, W, skirtH);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, wallH, W, Math.max(1, skirtH * 0.16));
  ctx.fillStyle = 'rgba(190,175,145,0.6)';
  ctx.fillRect(0, wallH + skirtH * 0.3, W, 1);
  ctx.fillStyle = 'rgba(105,84,55,0.25)';
  ctx.fillRect(0, wallH + skirtH - Math.max(1, skirtH * 0.22), W, Math.max(1, skirtH * 0.22));
}
/* 壁 1 枚の描画 (壁紙 → 巾木 → 床)。プレビュー (ピッカー/解放通知) と共用 */
function paintWallBase(ctx, W, H, def) {
  var floorH = Math.round(H * WALL_FLOOR_RATIO);
  var skirtH = Math.max(4, Math.round(H * WALL_SKIRT_RATIO));
  var wallH = Math.max(0, H - floorH - skirtH);
  paintWallpaperRegion(ctx, 0, 0, W, wallH, def);
  paintWallFloorAndSkirt(ctx, W, H, wallH);
}
/* ステージの背景 Canvas を (再) 描画する。壁を開いた時・壁紙変更・
 * リサイズ時にだけ呼ぶ (ドラッグ中は再描画しない) */
function paintWallBackdrop() {
  var stage = $('wallStage');
  var world = $('wallWorld');
  if (!world) return;
  var cv = world.querySelector('canvas.wall-bg');
  if (!cv) {
    cv = document.createElement('canvas');
    cv.className = 'wall-bg';
    cv.setAttribute('aria-hidden', 'true');
    world.insertBefore(cv, world.firstChild);
  }
  var d = wallWorldPx();
  var W = d.w, H = d.h;
  if (!W || !H) return;
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  var ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintWallBase(ctx, W, H, wallpaperById(store.wall.paper) || wallpaperById('kinari'));
}
/* 壁紙の小さな壁プレビューを Canvas に描く (ピッカー / 解放通知用) */
function paintPaperPreview(cv, def, w, h) {
  cv.width = w;
  cv.height = h;
  var ctx = cv.getContext('2d');
  if (ctx) paintWallBase(ctx, w, h, def);
}

/* ---- 壁紙ピッカー (額装ピッカーと同じ様式の全画面グリッド) ---- */
function openPaperPicker() {
  var grid = $('paperPickerGrid');
  grid.innerHTML = '';
  WALLPAPERS.forEach(function (p) {
    var unlocked = store.wall.paperUnlocks.indexOf(p.id) >= 0;
    var applied = store.wall.paper === p.id;
    var cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'paper-cell' + (unlocked ? '' : ' locked') + (applied ? ' applied' : '');
    cell.disabled = !unlocked;
    cell.setAttribute('aria-label', unlocked ? p.name + ' の壁紙にする' : p.name + ' (' + p.unlockAt + '回クリアで解放)');
    var cv = document.createElement('canvas');
    cv.className = 'paper-cell-canvas';
    cell.appendChild(cv);
    var nm = document.createElement('span');
    nm.className = 'paper-cell-name';
    nm.textContent = p.name;
    cell.appendChild(nm);
    var st = document.createElement('span');
    st.className = 'paper-cell-state';
    st.textContent = applied ? '使用中' : (!unlocked ? p.unlockAt + '回クリアで解放' : '');
    cell.appendChild(st);
    paintPaperPreview(cv, p, 264, 330);
    if (unlocked) {
      cell.addEventListener('click', function () {
        if (store.wall.paper !== p.id) {
          store.wall.paper = p.id;
          saveStore();
        }
        navBack();
        renderWall(); // 背景の再描画もここで起きる
      });
    }
    grid.appendChild(cell);
  });
  $('paperPickerView').hidden = false;
  navPush('paperPicker');
}
function closePaperPicker() {
  $('paperPickerView').hidden = true;
}
/* スタート画面の「壁の小物」行 (所持数と、未確認のごほうび/フレーム解放の通知) */
function updateStartWallRow() {
  var wall = store.wall;
  if (!wall) return;
  $('wallItemsInfo').textContent = '壁の小物 ' + wall.owned.length + ' / ' + WALL_CATALOG.length;
  $('rewardBtn').hidden = !wall.pending.length;
  var pendU = wall.pendingUnlocks, pendP = wall.pendingPaperUnlocks;
  var pendE = !!wall.pendingExpand;
  $('unlockBtn').hidden = !(pendU.length || pendP.length || pendE);
  if (pendE && !pendU.length && !pendP.length) {
    $('unlockBtn').textContent = '🖼 壁が広くなりました →';
  } else if (pendU.length && pendP.length) {
    $('unlockBtn').textContent = '🖼 新しいフレームと壁紙が使えるようになりました →';
  } else if (pendP.length === 1) {
    var pp = wallpaperById(pendP[0]);
    $('unlockBtn').textContent = '🖼 新しい壁紙『' + (pp ? pp.name : '') + '』が使えるようになりました →';
  } else if (pendP.length > 1) {
    $('unlockBtn').textContent = '🖼 新しい壁紙が ' + pendP.length + ' 種使えるようになりました →';
  } else if (pendU.length === 1) {
    var ust = frameStyleById(pendU[0]);
    $('unlockBtn').textContent = '🖼 新しいフレーム『' + (ust ? ust.name : '') + '』が使えるようになりました →';
  } else if (pendU.length > 1) {
    $('unlockBtn').textContent = '🖼 新しいフレームが ' + pendU.length + ' 種使えるようになりました →';
  }
}

/* ---------- 画面遷移 ----------
 * uiHome: スタート画面を表示しているか (プレイ中は false)
 * uiCollection: コレクションを表示しているか */
var uiHome = true;
var uiCollection = false;
var collectionBackToHome = false; // クリア画面経由で開いたコレクションの「戻る」はプレイ画面でなくスタート画面へ
var firstStart = true; // 初回だけ true。起動時は進捗があっても必ずスタート画面から (机へ自動復帰しない)
function applyVisibility() {
  $('startView').hidden = !uiHome || uiCollection || uiWall;
  $('playView').hidden = uiHome || uiCollection || uiWall;
  $('collectionView').hidden = !uiCollection;
  $('wallView').hidden = !uiWall;
  if (!uiHome && !uiCollection && !uiWall) resizeStage();
}
function showCollection() {
  uiCollection = true;
  navPush('collection');
  applyVisibility();
  renderCollection();
}
function showPlay() {
  uiCollection = false;
  applyVisibility();
}
/* スタート画面に戻る (設定の「スタート画面に戻る」と、クリア画面を閉じたときの共通動線) */
function goToStartScreen() {
  carry = null; // 画面を離れたら運び中は解除する (配置はせず、その場の座標のまま)
  if (state) persistProgress();
  bgmEnterTitle(); // 一度流れ始めた BGM はトップでも止めない (id 19 改訂: 中身は no-op)
  uiHome = true;
  uiCollection = false;
  replayStage = null; // スタートに戻ったら最新の未挑戦ステージへ
  if (state && state.pool) {
    if (syncPlayStage(state.pool) !== state.stage) startGame(state.pool);
    else renderStartScreen();
  }
  applyVisibility();
}
/* アプリに戻ってきたときもステージのずれを確認する (通常は変わらない) */
document.addEventListener('visibilitychange', function () {
  if (document.hidden || !uiHome) return;
  if (state && state.pool && syncPlayStage(state.pool) !== state.stage) startGame(state.pool);
});

/* ---------- 戻るジェスチャー (History API) ----------
 * スマホの戻るジェスチャー/ブラウザの戻る = history の popstate。
 * 画面・モーダルを1枚ずつ履歴に積み (navStack が対応表)、popstate で
 * 最上層だけを閉じる。画面上の戻る/閉じるボタンも history.back() に統一。
 * プレイ画面での戻るは、スタートへ直行せず設定シートを開く (ユーザー指定)。
 * 確認ダイアログ類 (confirm/freshConfirm/resetConfirm/shareChoice) は履歴に
 * 積まず、開いていれば popstate で「それだけ閉じて履歴を積み直す」。 */
var navStack = ['start'];
var navStale = 0;     // 履歴側にだけ残った古いエントリ数 (ホーム遷移/無言pop分)
var navPopping = false;
function navTop() { return navStack[navStack.length - 1]; }
function navPush(name) {
  if (navPopping || navTop() === name) return;
  navStack.push(name);
  try { history.pushState({ djNav: name }, ''); } catch (e) { /* file: 等 */ }
}
function navBack() { history.back(); }
/* 履歴を戻さずに最上層だけ取り除く (設定→コレクション等の横移動用)。
 * 履歴側のエントリは古エントリとして数え、基点での popstate で消化する */
function navSilentPop(name) {
  if (navTop() !== name) return;
  navStack.pop();
  navStale++;
}
/* スタート画面へ一気に戻る遷移 (設定の「スタート画面に戻る」/やりなおし) */
function navGoHome() {
  navStale += Math.max(0, navStack.length - 1);
  navStack = ['start'];
}
/* クリア画面から壁/コレクションへのジャンプ */
function navJumpTo(name) {
  navStale += Math.max(0, navStack.length - 1);
  navStack = ['start', name];
}
function navCloseTopConfirm() {
  var ids = ['resetConfirmModal', 'freshConfirmModal', 'confirmModal', 'shareChoiceModal', 'sortConfirmModal'];
  var closed = false;
  for (var i = 0; i < ids.length; i++) {
    if (!$(ids[i]).hidden) { $(ids[i]).hidden = true; closed = true; }
  }
  return closed;
}
function navCloseLayer(name) {
  if (name === 'settings') closeSettings();
  else if (name === 'credits') closeCredits();
  else if (name === 'preview') $('previewModal').hidden = true;
  else if (name === 'detail') $('detailModal').hidden = true;
  else if (name === 'reward') closeRewardReveal();
  else if (name === 'unlock') closeUnlockNotice();
  else if (name === 'result') {
    $('resultModal').hidden = true;
    navGoHome(); // クリア画面を閉じたらプレイには残らずスタート画面へ
    goToStartScreen();
  }
  else if (name === 'collection') {
    uiCollection = false;
    if (navTop() === 'play') showPlay();
    else goToStartScreen();
  }
  else if (name === 'wall') hideWall();
  else if (name === 'framePicker') closeFramePicker();
  else if (name === 'paperPicker') closePaperPicker();
  else if (name === 'play') goToStartScreen();
}
window.addEventListener('popstate', function () {
  if (navPopping) return;
  navPopping = true;
  try {
    if (navCloseTopConfirm()) {
      try { history.pushState({ djNav: navTop() }, ''); } catch (e) { /* ignore */ }
      return;
    }
    if (navStack.length <= 1) {
      if (navStale > 0) navStale--;
      return;
    }
    var top = navTop();
    if (top === 'play') {
      /* プレイ中の戻るは設定シートを開く (ユーザー指定 2026-11-09) */
      navStack.push('settings');
      try { history.pushState({ djNav: 'settings' }, ''); } catch (e) { /* ignore */ }
      openSettings();
      return;
    }
    navStack.pop();
    navCloseLayer(top);
  } finally { navPopping = false; }
});
try { history.replaceState({ djNav: 'start' }, ''); } catch (e) { /* ignore */ }
/* コレクション (ステージ制): 全ステージの絵を並べ、未クリアは「？」の
 * まま伏せる。クリアすると絵柄が解放されてサムネイルが出る。
 * 解放済みタイルのタップで記録詳細 (再プレイ導線つき) を開く */
function renderCollection() {
  var pool = state && state.pool;
  var entries = poolEntries(pool);
  var unlocked = unlockedImageKeys(store.records);
  var perDiff = DIFFICULTIES.map(function (d) {
    var c = store.records.filter(function (r) { return r.pieces === d; }).length;
    return d + 'ピース: ' + c;
  }).join(' ／ ');
  $('collectionStats').innerHTML =
    '<span class="stat">解放した絵 <b>' + unlocked.size + '</b> / ' + entries.length + '</span>' +
    '<span class="stat">総クリア数 <b>' + store.records.length + '</b></span>' +
    '<span class="stat">' + perDiff + '</span>';
  $('collectionEmpty').hidden = true;
  var grid = $('collectionGrid');
  grid.innerHTML = '';
  entries.forEach(function (entry, idx) {
    var stage = idx + 1;
    var key = poolEntryKey(entry);
    var recsForKey = store.records.filter(function (r) { return recordImageKey(r) === key; });
    if (!recsForKey.length) {
      var locked = document.createElement('div');
      locked.className = 'card locked';
      locked.innerHTML = '<span class="card-locked-mark">？</span>' +
        '<span class="card-body"><span class="card-date">ステージ ' + stage + '</span></span>';
      grid.appendChild(locked);
      return;
    }
    var best = recsForKey.slice().sort(function (a, b) { return a.bestTimeSec - b.bestTimeSec; })[0];
    var card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';
    var badges = '<span class="badge">' + best.pieces + 'ピース</span>' +
      (best.previewViewed ? '<span class="badge">完成図: 見た</span>' : '<span class="badge praise">完成図を見ずにクリア</span>');
    var thumb = entryThumbUrl(entry);
    var titleLine = entry && entry.type === 'url' && entry.title
      ? '<span class="card-title">' + escapeHtml(entry.title) + '</span>' : '';
    card.innerHTML = (thumb ? '<img loading="lazy" src="' + thumb + '" alt="">' : '') +
      '<span class="card-body"><span class="card-date">ステージ ' + stage + '</span>' + titleLine +
      '<span>クリアタイム ' + formatTime(best.bestTimeSec) + '</span>' + badges + '</span>';
    card.addEventListener('click', function () { openDetail(best); });
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
var detailDifficulty = 36; // コレクション詳細の再プレイ用に選んだ難易度
var detailSeq = 0; // 非同期読み込みの競合ガード (開き直したら古い描画を捨てる)

function openDetail(r) {
  detailRecord = r;
  var rewardNames = (store.wall.history[r.date] || []).map(function (id) {
    var it = wallItemById(id);
    return it ? it.name : id;
  });
  $('detailText').innerHTML =
    'ステージ: ' + (recordStage(r, state && state.pool) || '-') + '<br>難易度: ' + r.pieces + 'ピース' +
    (frameTier(r.pieces) ? ' <span class="upper-chip' + (frameTier(r.pieces) !== 'gold' ? ' ' + frameTier(r.pieces) : '') + '">上級クリア</span>' : '') +
    '<br>クリアタイム: ' + formatTime(r.bestTimeSec) +
    '<br>手数: ' + (r.moves != null ? r.moves : '-') +
    '<br>完成図: ' + (r.previewViewed ? '見た（' + r.previewCount + '回）' : '見ずにクリア') +
    (rewardNames.length ? '<br>この日に手に入れた小物: ' + rewardNames.join('、') : '') +
    (r.author ? '<br>作者: ' + r.author : '');
  var dEntry = entryForRecord(r);
  if (dEntry && dEntry.type === 'url') {
    var credit = dEntry.attribution ? escapeHtml(dEntry.attribution)
      : escapeHtml(dEntry.source || '') + (dEntry.license ? '（' + escapeHtml(dEntry.license) + '）' : '');
    $('detailText').innerHTML +=
      (dEntry.title ? '<br>作品: ' + escapeHtml(dEntry.title) : '') +
      (credit ? '<br>出典: ' + credit : '');
  }
  // 解放済みの絵はここから再プレイできる (抽選は初クリアのみなので出ない)
  detailDifficulty = r.pieces;
  buildDetailDiffSeg();
  $('detailModal').hidden = false;
  navPush('detail');
  renderDetailPuzzle(r);
}

/* 詳細モーダルの再プレイ用難易度チップ (全7種・選択は詳細内だけに効く) */
function buildDetailDiffSeg() {
  var seg = $('detailDiffSeg');
  if (!seg) return;
  seg.innerHTML = '';
  DIFFICULTIES.forEach(function (d) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'diff-chip' + (d === detailDifficulty ? ' active' : '');
    var num = document.createElement('span');
    num.className = 'diff-num';
    num.textContent = d + 'ピース';
    b.appendChild(num);
    var tier = frameTier(d);
    var star = document.createElement('span');
    star.className = 'diff-star ' + (tier || 'none');
    star.textContent = tier ? (tier === 'royal' ? '★★' : '★') : '';
    b.appendChild(star);
    if (detailRecord && findRecordForStage(recordStage(detailRecord, state && state.pool), d)) {
      b.classList.add('cleared');
      var badge = document.createElement('span');
      badge.className = 'diff-check-badge';
      badge.textContent = '✓';
      b.appendChild(badge);
    }
    b.setAttribute('aria-pressed', d === detailDifficulty ? 'true' : 'false');
    b.addEventListener('click', function () { detailDifficulty = d; buildDetailDiffSeg(); });
    seg.appendChild(b);
  });
}
/* コレクション詳細から再プレイ開始: そのステージを対象に、保存済みの
 * 進捗は消して新規に散らばす (記録は残り、ベストタイム更新だけが掛かる) */
function startReplayFromDetail() {
  if (!detailRecord || !state || !state.pool) return;
  var stage = recordStage(detailRecord, state.pool);
  if (!stage) return;
  $('detailModal').hidden = true;
  replayStage = stage;
  difficulty = detailDifficulty;
  store.lastDifficulty = difficulty;
  var dk = stageDate(stage);
  if (store.progress[dk]) delete store.progress[dk][difficulty];
  saveStore();
  uiCollection = false;
  uiHome = true;
  navGoHome();
  startGame(state.pool);
  applyVisibility();
  openBox();
}

/* 詳細用の写真を正方形キャンバスで用意する。読み込み失敗時はゲーム本体と
 * 同じ抽象画フォールバック (そのレコードの日付シード生成) をソースにする。 */
function loadDetailSource(r) {
  var size = Math.min(1080, imageSizeFor(r.pieces));
  var url = entryPhotoUrl(entryForRecord(r), size);
  if (!url) return Promise.resolve(makeFallbackCanvas(r.date));
  return loadImgCorsFallback(url).then(function (img) {
    var draw = function () {
      var side = Math.min(img.naturalWidth, img.naturalHeight);
      var cv = document.createElement('canvas');
      cv.width = size; cv.height = size;
      cv.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      return cv;
    };
    // load 直後 (デコード前) に描くと Firefox で帯状の描画欠けが出るため、
    // decode() の完了を待ってからキャンバスへ転写する
    if (img.decode) return img.decode().then(draw, draw);
    return draw();
  }, function () { return makeFallbackCanvas(r.date); });
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
/* 難易度セレクタ (ステージ制): 箱は1つ、難易度は全7種を1セットで出す。
 * チップは「Nピース」表記 (数字だけではピース数と伝わらないため)。
 * 目安時間は出さない (ユーザー指定) */
function buildDifficultySeg() {
  var seg = $('difficultySeg');
  seg.innerHTML = '';
  DIFFICULTIES.forEach(function (d) {
    var b = document.createElement('button');
    b.type = 'button';
    var sel = d === difficulty;
    b.className = 'diff-chip' + (sel ? ' active' : '');
    var num = document.createElement('span');
    num.className = 'diff-num';
    num.textContent = d + 'ピース';
    b.appendChild(num);
    var tier = frameTier(d);
    var star = document.createElement('span');
    star.className = 'diff-star ' + (tier || 'none');
    star.textContent = tier ? (tier === 'royal' ? '★★' : '★') : '';
    b.appendChild(star);
    /* 今のステージでクリア済みの難易度には右上に ✓ バッジ (ユーザー指定 A案) */
    var cleared = !!findRecordForStage(playStage, d);
    if (cleared) {
      b.classList.add('cleared');
      var badge = document.createElement('span');
      badge.className = 'diff-check-badge';
      badge.textContent = '✓';
      b.appendChild(badge);
    }
    b.setAttribute('aria-pressed', sel ? 'true' : 'false');
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
/* 箱は1つだけ (ステージ制)。タップで最新の未挑戦 (または再プレイ先) が開く */
function activeGiftBox() { return $('giftBox'); }
function onGiftBoxTap() { openBox(); }

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
    $('previewImg').src = entryPhotoUrl(state.entry, size) || '';
  }
  $('previewModal').hidden = false;
  navPush('preview');
}

/* ---------- 設定メニュー (開いている間はタイマー停止) ---------- */
var settingsAutoPaused = false;
function openSettings() {
  if (!state || state.phase !== 'play' || uiHome || uiCollection || uiWall) return;
  settingsAutoPaused = false;
  if (timerRunning()) { pauseTimer(); settingsAutoPaused = true; persistProgress(); }
  $('settingsModal').hidden = false;
  navPush('settings');
  setTimeout(function () { maybeTourAuto('settings'); }, 350); // 初回だけ設定のツアー
}
function closeSettings() {
  $('settingsModal').hidden = true;
  if (settingsAutoPaused) {
    settingsAutoPaused = false;
    resumeTimer();
    persistProgress();
  }
}
/* クレジットは設定シートの上に重ねて開く (閉じれば設定に戻る) */
function openCredits() { $('creditsModal').hidden = false; navPush('credits'); }
/* ---------- チュートリアル (コーチマーク式ツアー) ----------
 * その画面を初めて開いたときに、その画面の操作だけを実物の上で
 * 指し示す (画面別セグメント制)。設定/スタートの「チュートリアル」
 * 「あそびかた」からは全 7 ステップを通しで再生する (画面遷移も自動)。
 * 見た画面分は store.tourSeen に記録し、二度と自動では出さない */
var TOUR_STEP_DEFS = [
  { screen: 'start', sel: '#giftBox', title: '箱をタップして開始', text: 'タップすると、いまのステージのパズルが始まります。' },
  { screen: 'start', sel: '.start-difficulty', title: 'ピース数を選ぶ', text: '難易度はここで自由に選べます。クリアすると次のステージに進みます。' },
  { screen: 'play', sel: '#stageWrap', shrink: 0.55, bubbleBottom: true, title: 'ピースをつなげる', text: 'ピースをドラッグして、となり合うピースに近づけるとくっつきます。全部が1つの塊になったらクリアです。' },
  { screen: 'play', sel: '#settingsBtn', circle: true, title: '設定はここ', text: '歯車ボタン（または戻るジェスチャー）で設定が開きます。' },
  { screen: 'settings', sel: '#settingsHomeBtn', title: 'タイトルに戻る', text: '「スタート画面に戻る」でタイトルへ戻れます。中断したパズルは、タイトルの箱をタップすれば続きから遊べます。' },
  { screen: 'wall', sel: '#wallTray', title: '小物を置く', text: 'クリア報酬でもらった小物は、このトレイから壁に置けます。同じものも何個でも置けます。' },
  { screen: 'wall', sel: '#wallFrameBtn', title: '額装する', text: 'クリアした絵は額に入れて壁に飾れます。' }
];
var tour = null; // { steps: [通し番号...], pos, mode: 'auto'|'full' }
var tourTimer = null;
function tourSeenMap() {
  if (!store.tourSeen || typeof store.tourSeen !== 'object') store.tourSeen = { start: false, play: false, settings: false, wall: false };
  return store.tourSeen;
}
function tourMarkSeen(screens) {
  var seen = tourSeenMap(), changed = false;
  screens.forEach(function (sc) { if (!seen[sc]) { seen[sc] = true; changed = true; } });
  if (changed) saveStore();
}
/* ステップの画面が表示状態になるよう遷移する。戻り値は表示までの待ち ms */
function tourEnsureScreen(screen) {
  var settingsOpen = !$('settingsModal').hidden;
  if (screen === 'start') {
    if (uiWall) { hideWall(); navSilentPop('wall'); }
    if (settingsOpen) { closeSettings(); navSilentPop('settings'); }
    if (!uiHome) { navGoHome(); goToStartScreen(); }
    return 180;
  }
  if (screen === 'play') {
    if (uiWall) { hideWall(); navSilentPop('wall'); }
    if (settingsOpen) { closeSettings(); navSilentPop('settings'); }
    if (uiHome) { onGiftBoxTap(); return 900; }
    return 180;
  }
  if (screen === 'settings') {
    if (settingsOpen) return 120;
    if (uiWall) { hideWall(); navSilentPop('wall'); }
    if (uiHome) { onGiftBoxTap(); setTimeout(openSettings, 950); return 1250; }
    openSettings();
    return 320;
  }
  /* wall */
  if (uiWall) return 180;
  if (settingsOpen) { closeSettings(); navSilentPop('settings'); }
  if (!uiHome) { navGoHome(); goToStartScreen(); }
  showWall('home');
  return 500;
}
function tourRun(stepIndexes, mode) {
  if (tour || !stepIndexes.length) return;
  tour = { steps: stepIndexes.slice(), pos: 0, mode: mode };
  $('tourOverlay').hidden = false;
  tourShowStep();
}
function tourShowStep() {
  if (!tour) return;
  var def = TOUR_STEP_DEFS[tour.steps[tour.pos]];
  var wait = tourEnsureScreen(def.screen);
  if (tourTimer) clearTimeout(tourTimer);
  tourTimer = setTimeout(function () { tourTimer = null; if (tour) tourLayout(def); }, wait);
}
function tourLayout(def) {
  var el = document.querySelector(def.sel);
  if (!el) { tourAdvance(1); return; }
  var r = el.getBoundingClientRect();
  if (!r.width && !r.height) { tourAdvance(1); return; }
  if (def.shrink) {
    var nw = r.width * def.shrink, nh = r.height * def.shrink;
    r = { left: r.left + (r.width - nw) / 2, top: r.top + (r.height - nh) / 2, width: nw, height: nh };
    r.right = r.left + r.width; r.bottom = r.top + r.height;
  }
  var pad = 6;
  var hx = Math.max(2, r.left - pad), hy = Math.max(2, r.top - pad);
  var hw = Math.min(window.innerWidth - hx - 2, r.width + pad * 2);
  var hh = r.height + pad * 2;
  var hole = $('tourHole');
  hole.style.left = hx + 'px'; hole.style.top = hy + 'px';
  hole.style.width = hw + 'px'; hole.style.height = hh + 'px';
  hole.style.borderRadius = def.circle ? '50%' : '16px';
  $('tourTitle').textContent = def.title;
  $('tourText').textContent = def.text;
  $('tourCount').textContent = (tour.pos + 1) + ' / ' + tour.steps.length;
  $('tourPrevBtn').hidden = tour.pos === 0;
  $('tourNextBtn').textContent = tour.pos === tour.steps.length - 1 ? 'おわる' : 'つぎへ';
  var bubble = $('tourBubble');
  bubble.style.visibility = 'hidden';
  bubble.style.left = '24px'; bubble.style.top = '0px';
  var bh = bubble.offsetHeight, bw = bubble.offsetWidth;
  var cx = hx + hw / 2;
  var below = hy + hh + 26 + bh <= window.innerHeight - 10;
  var by = def.bubbleBottom ? window.innerHeight - bh - 14 : (below ? hy + hh + 26 : hy - 26 - bh);
  by = Math.max(10, Math.min(window.innerHeight - bh - 10, by));
  var bx = Math.max(12, Math.min(window.innerWidth - bw - 12, cx - bw / 2));
  bubble.style.left = bx + 'px'; bubble.style.top = by + 'px';
  bubble.style.visibility = '';
  $('tourArrowSvg').setAttribute('viewBox', '0 0 ' + window.innerWidth + ' ' + window.innerHeight);
  var ax = Math.max(bx + 34, Math.min(bx + bw - 34, cx));
  var x1, y1, x2, y2;
  if (by >= hy + hh) { x1 = ax; y1 = by - 4; x2 = cx; y2 = hy + hh + 4; }
  else { x1 = ax; y1 = by + bh + 4; x2 = cx; y2 = hy - 4; }
  var my = (y1 + y2) / 2;
  $('tourArrowPath').setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + my + ', ' + x2 + ' ' + my + ', ' + x2 + ' ' + y2);
}
function tourAdvance(dir) {
  if (!tour) return;
  var next = tour.pos + dir;
  if (next < 0) return;
  if (next >= tour.steps.length) { tourFinish(); return; }
  tour.pos = next;
  tourShowStep();
}
function tourFinish() {
  if (!tour) return;
  if (tourTimer) { clearTimeout(tourTimer); tourTimer = null; }
  var screens = [];
  tour.steps.forEach(function (i) { var sc = TOUR_STEP_DEFS[i].screen; if (screens.indexOf(sc) === -1) screens.push(sc); });
  var mode = tour.mode;
  tour = null;
  $('tourOverlay').hidden = true;
  tourMarkSeen(screens);
  if (mode === 'full') {
    /* 通し再生の終わりはスタート画面に落ち着かせる */
    if (!$('settingsModal').hidden) { closeSettings(); navSilentPop('settings'); }
    if (uiWall) { hideWall(); navSilentPop('wall'); }
    if (!uiHome) { navGoHome(); goToStartScreen(); }
  }
}
/* 設定/スタートから: 全ステップを通しで再生する */
function startFullTour() {
  if (tour) return;
  if (!$('settingsModal').hidden) { closeSettings(); navSilentPop('settings'); }
  tourRun([0, 1, 2, 3, 4, 5, 6], 'full');
}
/* 画面を初めて開いたときだけ、その画面のセグメントを自動で出す */
function maybeTourAuto(screen) {
  if (tour) return;
  if (tourSeenMap()[screen]) return;
  var seg = TOUR_SEGMENTS[screen];
  if (seg) tourRun(seg, 'auto');
}
window.addEventListener('resize', function () {
  if (tour) tourLayout(TOUR_STEP_DEFS[tour.steps[tour.pos]]);
});
function closeCredits() { $('creditsModal').hidden = true; }

/* ---------- やりなおす (進行を消して未開始の箱に戻る) ---------- */
function restartPuzzle() {
  navGoHome(); // どの画面からでも未開封の箱 (スタート画面) に戻る遷移
  if (store.progress[playDate]) delete store.progress[playDate][difficulty];
  saveStore();
  bgmEnterTitle(); // 一度流れ始めた BGM はトップでも止めない (id 19 改訂: 中身は no-op)
  uiHome = true;
  startGame(state.pool);
}

function wireControls() {
  $('zoomInBtn').addEventListener('click', function () { zoomBy(1.3); });
  // 全体表示: 机全体が見える初期視点へ戻す (迷子時の帰り道、机の有限化)
  $('fitViewBtn').addEventListener('click', function () {
    if (!state || !view()) return;
    state.views.desk = fitView();
    updateZoomLabel();
    draw();
  });
  $('zoomOutBtn').addEventListener('click', function () { zoomBy(1 / 1.3); });
  $('settingsBtn').addEventListener('click', openSettings);
  $('settingsSortBtn').addEventListener('click', function () { $('sortConfirmModal').hidden = false; });
  $('sortConfirmNoBtn').addEventListener('click', function () { $('sortConfirmModal').hidden = true; });
  $('sortConfirmYesBtn').addEventListener('click', function () {
    $('sortConfirmModal').hidden = true;
    closeSettings();
    navSilentPop('settings');
    sortSinglesByColor();
  });
  document.querySelectorAll('[data-theme-opt]').forEach(function (b) {
    b.addEventListener('click', function () { setUiTheme(b.getAttribute('data-theme-opt')); });
  });
  document.querySelectorAll('[data-opmode]').forEach(function (b) {
    b.addEventListener('click', function () { setCarryMode(b.getAttribute('data-opmode') === 'carry'); });
  });
  syncOpModeButtons();
  /* サウンド設定: 設定シートとスタート画面の両方に同じ設定のコントロールが
   * あり、変更は即保存 + 即適用、表示は syncAudioControls で両画面を一致
   * させる。クレジット一覧は BGM_TRACKS から生成する (曲名・作者・ライセンス)。 */
  syncAudioControls();
  $('bgmCredits').innerHTML = BGM_TRACKS.map(function (t) {
    return '<li>' + t.title + ' — ' + t.artist + '（' + t.license + '）</li>';
  }).join('');
  $('bgmToggle').addEventListener('change', function () { onBgmToggleChanged($('bgmToggle').checked); });
  $('bgmToggleStart').addEventListener('change', function () { onBgmToggleChanged($('bgmToggleStart').checked); });
  $('bgmVolume').addEventListener('input', function () { onBgmVolumeInput($('bgmVolume').value); });
  $('bgmVolumeStart').addEventListener('input', function () { onBgmVolumeInput($('bgmVolumeStart').value); });
  $('seToggle').addEventListener('change', function () { onSeToggleChanged($('seToggle').checked); });
  $('seToggleStart').addEventListener('change', function () { onSeToggleChanged($('seToggleStart').checked); });
  $('seVolume').addEventListener('input', function () { onSeVolumeInput($('seVolume').value); });
  $('seVolumeStart').addEventListener('input', function () { onSeVolumeInput($('seVolumeStart').value); });
  document.querySelectorAll('[data-settings-close]').forEach(function (el) {
    el.addEventListener('click', function () { navBack(); });
  });
  $('settingsCreditsBtn').addEventListener('click', openCredits);
  $('settingsTutorialBtn').addEventListener('click', startFullTour);
  $('startTutorialBtn').addEventListener('click', startFullTour);
  $('tourNextBtn').addEventListener('click', function () { tourAdvance(1); });
  $('tourPrevBtn').addEventListener('click', function () { tourAdvance(-1); });
  $('tourSkipBtn').addEventListener('click', function () { tourFinish(); });
  document.querySelectorAll('[data-credits-close]').forEach(function (el) {
    el.addEventListener('click', function () { navBack(); });
  });
  $('settingsPreviewBtn').addEventListener('click', function () {
    closeSettings();
    navSilentPop('settings');
    openPreview();
  });
  $('settingsHomeBtn').addEventListener('click', function () {
    closeSettings();
    navGoHome();
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
  var giftBoxElNow = $('giftBox');
  giftBoxElNow.addEventListener('click', function () { onGiftBoxTap(); });
  giftBoxElNow.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onGiftBoxTap(); }
  });
  $('collectionBtn').addEventListener('click', function () {
    collectionBackToHome = false;
    showCollection();
  });
  $('detailPlayBtn').addEventListener('click', startReplayFromDetail);
  $('collectionBack').addEventListener('click', function () { navBack(); });
  $('resumeClose').addEventListener('click', function () { $('resumeBanner').hidden = true; });
  document.querySelectorAll('[data-close]').forEach(function (el) {
    el.addEventListener('click', function () { navBack(); });
  });
  // クリア画面を閉じたらプレイ画面 (空の机) には残らず、スタート画面に戻す
  $('resultCloseBtn').addEventListener('click', function () { navBack(); });
  $('resultCollectionBtn').addEventListener('click', function () {
    $('resultModal').hidden = true;
    navJumpTo('collection');
    collectionBackToHome = true; // コレクションから戻る先もスタート画面にする
    showCollection();
  });
  /* クリア画面から壁へ: モーダルを閉じて壁画面を開く。壁の「戻る」は
   * クリア後の定線 (閉じる→スタート画面) に合わせて 'home' にする */
  $('resultWallBtn').addEventListener('click', function () {
    $('resultModal').hidden = true;
    navJumpTo('wall');
    showWall('home');
  });
  /* 共有は文字/画像の選択を挟む */
  $('resultShareBtn').addEventListener('click', function () { $('shareChoiceModal').hidden = false; });
  $('shareCancelBtn').addEventListener('click', function () { $('shareChoiceModal').hidden = true; });
  $('shareTextBtn').addEventListener('click', shareResultText);
  $('shareImageBtn').addEventListener('click', shareResultImage);
  /* クリア報酬: ごほうびリビール / フレーム解放通知 / 壁をかざる の導線 */
  $('rewardBtn').addEventListener('click', function () { showRewardReveal(); });
  $('rewardLaterBtn').addEventListener('click', function () { navBack(); });
  $('rewardWallBtn').addEventListener('click', function () {
    closeRewardReveal();
    navSilentPop('reward');
    showWall('home');
  });
  $('unlockBtn').addEventListener('click', function () { showUnlockNotice(); });
  $('unlockCloseBtn').addEventListener('click', function () { navBack(); });
  $('wallBtn').addEventListener('click', function () { showWall('home'); });
  // 壁帯プレビューのタップは「壁をかざる」と同じ導線 (PBI #24 案A)
  $('wallPreviewCanvas').addEventListener('click', function () { showWall('home'); });
  $('wallPreviewCanvas').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); showWall('home'); }
  });
  window.addEventListener('resize', function () { if (!$('startView').hidden) updateWallPreview(); });
  $('wallBack').addEventListener('click', function () { navBack(); });
  $('wallUnplaceBtn').addEventListener('click', function () { unplaceWallSelected(); });
  $('wallFrameBtn').addEventListener('click', function () { openFramePicker(); });
  $('framePickerBack').addEventListener('click', function () { navBack(); });
  $('wallPaperBtn').addEventListener('click', function () { openPaperPicker(); });
  $('wallShareBtn').addEventListener('click', function () { shareWallImage(); });
  $('paperPickerBack').addEventListener('click', function () { navBack(); });
  // 画面リサイズで壁ステージの大きさが変わったら壁を描き直す
  window.addEventListener('resize', function () { if (uiWall) renderWall(); });
  // 壁カメラのジェスチャ: 空き場所のドラッグでパン、2本指でピンチズーム、
  // ホイールでもズーム。アイテム上の操作は attachWallDrag が担当する
  var wallPtrs = new Map();
  var wallGesture = null;
  var wallStageEl = $('wallStage');
  wallStageEl.addEventListener('pointerdown', function (ev) {
    if (ev.target.closest && ev.target.closest('.wall-el')) return;
    if (ev.target.id === 'wallFitBtn') return;
    selectWall(null); // 壁の何もない所をタップで選択解除
    wallPtrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try { wallStageEl.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    if (wallPtrs.size === 1) {
      wallGesture = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, camX: wallCam.x, camY: wallCam.y };
    } else if (wallPtrs.size === 2) {
      var pts = Array.from(wallPtrs.values());
      var mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      wallGesture = {
        mode: 'pinch',
        d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
        zoom0: wallCam.zoom,
        wp: wallPointFromClient(mid.x, mid.y)
      };
    }
  });
  wallStageEl.addEventListener('pointermove', function (ev) {
    if (!wallPtrs.has(ev.pointerId) || !wallGesture) return;
    wallPtrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    var d = wallWorldPx();
    if (wallGesture.mode === 'pan' && wallPtrs.size === 1) {
      wallCam.x = wallGesture.camX - (ev.clientX - wallGesture.sx) / (wallCam.zoom * d.w);
      wallCam.y = wallGesture.camY - (ev.clientY - wallGesture.sy) / (wallCam.zoom * d.h);
      applyWallCam();
    } else if (wallGesture.mode === 'pinch' && wallPtrs.size === 2) {
      var pts = Array.from(wallPtrs.values());
      var d1 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      var mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      var rect = wallStageEl.getBoundingClientRect();
      wallCam.zoom = wallGesture.zoom0 * d1 / wallGesture.d0;
      clampWallCam();
      wallCamSetFromScreen(wallGesture.wp, mid.x - rect.left, mid.y - rect.top);
      applyWallCam();
    }
  });
  function wallPtrEnd(ev) {
    wallPtrs.delete(ev.pointerId);
    if (!wallPtrs.size) wallGesture = null;
    else if (wallPtrs.size === 1) {
      var p = Array.from(wallPtrs.values())[0];
      wallGesture = { mode: 'pan', sx: p.x, sy: p.y, camX: wallCam.x, camY: wallCam.y };
    }
  }
  wallStageEl.addEventListener('pointerup', wallPtrEnd);
  wallStageEl.addEventListener('pointercancel', wallPtrEnd);
  wallStageEl.addEventListener('lostpointercapture', wallPtrEnd);
  document.addEventListener('visibilitychange', function () { if (document.hidden) { wallPtrs.clear(); wallGesture = null; } });
  wallStageEl.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var rect = wallStageEl.getBoundingClientRect();
    var wp = wallPointFromClient(ev.clientX, ev.clientY);
    wallCam.zoom *= Math.exp(-ev.deltaY * 0.0015);
    clampWallCam();
    wallCamSetFromScreen(wp, ev.clientX - rect.left, ev.clientY - rect.top);
    applyWallCam();
  }, { passive: false });
  /* 全データリセット (設定シート内・危険操作): 専用の確認モーダルを挟み、
   * 確定したら保存キーを丸ごと消して再読み込みし、初期状態に戻す */
  $('settingsResetBtn').addEventListener('click', function () { $('resetConfirmModal').hidden = false; });
  $('resetNoBtn').addEventListener('click', function () { $('resetConfirmModal').hidden = true; });
  $('resetYesBtn').addEventListener('click', function () {
    resetAllData(localStorage, STORE_KEY);
    location.reload();
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
function giftPatternDef(patternId, uid) {
  var pal = THEMES[uiTheme].box[patternId] || THEMES[uiTheme].box['dots-red'];
  var pid = 'giftPat' + (uid || '');
  var body;
  switch (patternId) {
    case 'dots-red': // 細ドット
      body = '<rect width="30" height="30" fill="' + pal.bg + '"/>' +
        '<circle cx="8" cy="8" r="2.4" fill="' + pal.fg + '"/><circle cx="23" cy="23" r="2.4" fill="' + pal.fg + '"/>' +
        '<circle cx="23" cy="8" r="1.3" fill="' + pal.fg2 + '"/><circle cx="8" cy="23" r="1.3" fill="' + pal.fg2 + '"/>';
      return '<pattern id="' + pid + '" width="30" height="30" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'stripes-mint': // 細ストライプ
      body = '<rect width="22" height="22" fill="' + pal.bg + '"/><rect width="5" height="22" fill="' + pal.fg + '"/>';
      return '<pattern id="' + pid + '" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' + body + '</pattern>';
    case 'stars-navy': // 小さな星
      body = '<rect width="40" height="40" fill="' + pal.bg + '"/>' +
        '<polygon points="0,-3.6 1.1,-1.2 3.6,-1.2 1.6,0.9 2.3,3.5 0,2 -2.3,3.5 -1.6,0.9 -3.6,-1.2 -1.1,-1.2" transform="translate(11,12)" fill="' + pal.fg + '"/>' +
        '<polygon points="0,-2.4 0.7,-0.8 2.4,-0.8 1.1,0.6 1.6,2.3 0,1.3 -1.6,2.3 -1.1,0.6 -2.4,-0.8 -0.7,-0.8" transform="translate(30,30)" fill="' + pal.fg2 + '"/>' +
        '<circle cx="31" cy="9" r="1.1" fill="' + pal.fg2 + '"/><circle cx="7" cy="33" r="1.1" fill="' + pal.fg + '"/>';
      return '<pattern id="' + pid + '" width="40" height="40" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'gingham-pink': // 細ギンガム
      body = '<rect width="24" height="24" fill="' + pal.bg + '"/><rect width="24" height="12" fill="' + pal.fg + '" opacity="0.45"/><rect width="12" height="24" fill="' + pal.fg + '" opacity="0.45"/>';
      return '<pattern id="' + pid + '" width="24" height="24" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'confetti': // 小紋 (小さな粒と線)
      body = '<rect width="34" height="34" fill="' + pal.bg + '"/>' +
        '<rect x="5" y="7" width="5" height="1.8" fill="' + pal.fg + '" transform="rotate(30 7 8)"/>' +
        '<circle cx="24" cy="9" r="1.7" fill="' + pal.fg2 + '"/>' +
        '<rect x="15" y="18" width="1.8" height="5" fill="' + pal.fg2 + '" transform="rotate(-18 16 20)"/>' +
        '<circle cx="28" cy="27" r="1.4" fill="' + pal.fg + '"/>' +
        '<rect x="6" y="26" width="4.4" height="1.6" fill="' + pal.fg2 + '" transform="rotate(12 8 27)"/>' +
        '<circle cx="11" cy="16" r="1.2" fill="' + pal.fg + '"/>';
      return '<pattern id="' + pid + '" width="34" height="34" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'plaid': // 格子 (太バンド + 細ライン)
      body = '<rect width="36" height="36" fill="' + pal.bg + '"/>' +
        '<rect y="5" width="36" height="13" fill="' + pal.fg + '" opacity="0.38"/><rect x="5" width="13" height="36" fill="' + pal.fg + '" opacity="0.38"/>' +
        '<rect y="25" width="36" height="2.2" fill="' + pal.fg2 + '" opacity="0.85"/><rect x="25" width="2.2" height="36" fill="' + pal.fg2 + '" opacity="0.85"/>';
      return '<pattern id="' + pid + '" width="36" height="36" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'hearts': // ハート
      body = '<rect width="36" height="36" fill="' + pal.bg + '"/>' +
        '<path d="M0,2.8 C-0.6,0.8 -2.8,-0.8 -4.6,0.2 C-6.8,1.4 -6.6,4.8 -3.8,7.4 L0,10.6 L3.8,7.4 C6.6,4.8 6.8,1.4 4.6,0.2 C2.8,-0.8 0.6,0.8 0,2.8 Z" transform="translate(11,7)" fill="' + pal.fg + '"/>' +
        '<path d="M0,2.8 C-0.6,0.8 -2.8,-0.8 -4.6,0.2 C-6.8,1.4 -6.6,4.8 -3.8,7.4 L0,10.6 L3.8,7.4 C6.6,4.8 6.8,1.4 4.6,0.2 C2.8,-0.8 0.6,0.8 0,2.8 Z" transform="translate(27,23) scale(0.62)" fill="' + pal.fg2 + '"/>' +
        '<circle cx="29" cy="9" r="1.3" fill="' + pal.fg2 + '"/><circle cx="8" cy="29" r="1.3" fill="' + pal.fg + '"/>';
      return '<pattern id="' + pid + '" width="36" height="36" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'moons': // 三日月と星
      body = '<rect width="44" height="44" fill="' + pal.bg + '"/>' +
        '<path fill-rule="evenodd" fill="' + pal.fg + '" transform="translate(14,15)" d="M-8,0 A8,8 0 1 1 8,0 A8,8 0 1 1 -8,0 Z M-3.7,0 A6.2,6.2 0 1 1 8.7,0 A6.2,6.2 0 1 1 -3.7,0 Z"/>' +
        '<polygon points="0,-3 0.9,-0.9 3,0 0.9,0.9 0,3 -0.9,0.9 -3,0 -0.9,-0.9" transform="translate(33,11)" fill="' + pal.fg2 + '"/>' +
        '<circle cx="35" cy="30" r="1.5" fill="' + pal.fg2 + '"/><circle cx="10" cy="36" r="1.2" fill="' + pal.fg + '"/><circle cx="24" cy="24" r="1" fill="' + pal.fg2 + '"/>';
      return '<pattern id="' + pid + '" width="44" height="44" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'leaves': // 葉っぱ
      body = '<rect width="40" height="40" fill="' + pal.bg + '"/>' +
        '<g transform="translate(12,13) rotate(28)"><path d="M0,-7.5 C4.2,-3.5 4.2,3.5 0,8.5 C-4.2,3.5 -4.2,-3.5 0,-7.5 Z" fill="' + pal.fg + '"/><path d="M0,-5.5 L0,6.5" stroke="' + pal.bg + '" stroke-width="1.1"/></g>' +
        '<g transform="translate(30,30) rotate(-152) scale(0.78)"><path d="M0,-7.5 C4.2,-3.5 4.2,3.5 0,8.5 C-4.2,3.5 -4.2,-3.5 0,-7.5 Z" fill="' + pal.fg2 + '"/><path d="M0,-5.5 L0,6.5" stroke="' + pal.bg + '" stroke-width="1.1"/></g>' +
        '<circle cx="32" cy="9" r="1.4" fill="' + pal.fg2 + '"/><circle cx="8" cy="33" r="1.4" fill="' + pal.fg + '"/>';
      return '<pattern id="' + pid + '" width="40" height="40" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'waves': // 青海波 (同心円の鱗)
      body = '<rect width="36" height="36" fill="' + pal.bg + '"/>';
      [[0, 0], [18, 0], [36, 0], [9, 9], [27, 9], [0, 18], [18, 18], [36, 18], [9, 27], [27, 27], [0, 36], [18, 36], [36, 36]].forEach(function (c) {
        body += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="8.6" fill="' + pal.bg + '" stroke="' + pal.fg + '" stroke-width="1.7"/>' +
          '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="4.6" fill="none" stroke="' + pal.fg2 + '" stroke-width="1.3"/>';
      });
      return '<pattern id="' + pid + '" width="36" height="36" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'triangles': // 三角
      body = '<rect width="26" height="26" fill="' + pal.bg + '"/>' +
        '<polygon points="7,4 13,4 10,10" fill="' + pal.fg + '"/>' +
        '<polygon points="19,14 25,14 22,20" fill="' + pal.fg2 + '"/>' +
        '<polygon points="2,16 8,16 5,22" fill="' + pal.fg + '" opacity="0.65"/>' +
        '<circle cx="21" cy="6" r="1.2" fill="' + pal.fg2 + '"/>';
      return '<pattern id="' + pid + '" width="26" height="26" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'diamonds': // ダイヤ (ハーレクイン)
      body = '<rect width="30" height="30" fill="' + pal.bg + '"/>' +
        '<polygon points="15,2.5 24,15 15,27.5 6,15" fill="' + pal.fg + '" opacity="0.88"/>' +
        '<polygon points="15,11 19,15 15,19 11,15" fill="' + pal.fg2 + '"/>' +
        '<circle cx="2.5" cy="2.5" r="1.2" fill="' + pal.fg2 + '"/><circle cx="27.5" cy="27.5" r="1.2" fill="' + pal.fg2 + '"/>';
      return '<pattern id="' + pid + '" width="30" height="30" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'snow': // 雪の結晶 (6方向のアスター)
      function flake(cx, cy, r, col) {
        var s = '<g transform="translate(' + cx + ',' + cy + ')" stroke="' + col + '" stroke-width="1.7" stroke-linecap="round">';
        for (var i = 0; i < 3; i++) s += '<line x1="' + (-r) + '" y1="0" x2="' + r + '" y2="0" transform="rotate(' + (i * 60) + ')"/>';
        return s + '</g><circle cx="' + cx + '" cy="' + cy + '" r="1.6" fill="' + col + '"/>';
      }
      body = '<rect width="40" height="40" fill="' + pal.bg + '"/>' + flake(13, 13, 6.4, pal.fg) + flake(31, 30, 4.4, pal.fg2) +
        '<circle cx="33" cy="9" r="1.3" fill="' + pal.fg + '"/><circle cx="8" cy="34" r="1.3" fill="' + pal.fg2 + '"/>';
      return '<pattern id="' + pid + '" width="40" height="40" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'sakura': // 花びら (1枚ずつ散らす)
      function petal(cx, cy, rot, s, col) {
        return '<path d="M0,-6.5 C1.4,-4.2 3.4,-2.2 3.4,0.8 C3.4,3.8 1.8,5.8 0,7.2 C-1.8,5.8 -3.4,3.8 -3.4,0.8 C-3.4,-2.2 -1.4,-4.2 0,-6.5 Z" transform="translate(' + cx + ',' + cy + ') rotate(' + rot + ') scale(' + s + ')" fill="' + col + '"/>';
      }
      body = '<rect width="42" height="42" fill="' + pal.bg + '"/>' + petal(12, 12, 24, 1, pal.fg) + petal(31, 27, -38, 0.82, pal.fg) + petal(30, 9, 96, 0.6, pal.fg2) + petal(10, 33, -110, 0.55, pal.fg2);
      return '<pattern id="' + pid + '" width="42" height="42" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'clouds': // 雲 (もこもこの重なり)
      body = '<rect width="44" height="44" fill="' + pal.bg + '"/>';
      [[0, 12], [15, 12], [30, 12], [45, 12], [-7, 27], [8, 27], [23, 27], [38, 27], [0, 42], [15, 42], [30, 42], [45, 42]].forEach(function (c) {
        body += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="7.6" fill="' + pal.fg + '" opacity="0.30"/>';
      });
      body += '<circle cx="36" cy="19" r="1.4" fill="' + pal.fg2 + '"/><circle cx="12" cy="35" r="1.4" fill="' + pal.fg2 + '"/>';
      return '<pattern id="' + pid + '" width="44" height="44" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'checkers': // 市松
      body = '<rect width="26" height="26" fill="' + pal.bg + '"/>' +
        '<rect width="13" height="13" fill="' + pal.fg + '" opacity="0.85"/><rect x="13" y="13" width="13" height="13" fill="' + pal.fg + '" opacity="0.85"/>' +
        '<circle cx="19.5" cy="6.5" r="1.6" fill="' + pal.fg2 + '"/><circle cx="6.5" cy="19.5" r="1.6" fill="' + pal.fg2 + '"/>';
      return '<pattern id="' + pid + '" width="26" height="26" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'music': // 音符 (8分音符)
      function note(cx, cy, s, col) {
        return '<g transform="translate(' + cx + ',' + cy + ') scale(' + s + ')" fill="' + col + '">' +
          '<ellipse cx="0" cy="5.4" rx="3.1" ry="2.3" transform="rotate(-18 0 5.4)"/>' +
          '<rect x="2.5" y="-7" width="1.15" height="12.2"/>' +
          '<path d="M3.65,-7 C6.2,-6.2 7.2,-4.4 6.7,-1.8 C5.7,-3.6 4.7,-4.3 3.65,-4.5 Z"/></g>';
      }
      body = '<rect width="42" height="42" fill="' + pal.bg + '"/>' + note(12, 14, 1, pal.fg) + note(31, 31, 0.78, pal.fg2) +
        '<circle cx="33" cy="9" r="1.3" fill="' + pal.fg + '"/>';
      return '<pattern id="' + pid + '" width="42" height="42" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'polka-big': // 大ドット
      body = '<rect width="34" height="34" fill="' + pal.bg + '"/>' +
        '<circle cx="9" cy="9" r="4.6" fill="' + pal.fg + '"/><circle cx="26" cy="26" r="4.6" fill="' + pal.fg + '"/>' +
        '<circle cx="26" cy="9" r="1.9" fill="' + pal.fg2 + '"/><circle cx="9" cy="26" r="1.9" fill="' + pal.fg2 + '"/>';
      return '<pattern id="' + pid + '" width="34" height="34" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    case 'grid': // 方眼
      body = '<rect width="20" height="20" fill="' + pal.bg + '"/>' +
        '<path d="M20,0.5 L0,0.5 L0,20" fill="none" stroke="' + pal.fg + '" stroke-width="1" opacity="0.6"/>' +
        '<circle cx="10" cy="10" r="1.2" fill="' + pal.fg2 + '"/>';
      return '<pattern id="' + pid + '" width="20" height="20" patternUnits="userSpaceOnUse">' + body + '</pattern>';
    default: // floral-retro: 小花
      body = '<rect width="42" height="42" fill="' + pal.bg + '"/>' + giftFlowerSvg(12, 12, 0.8, pal.fg, pal.fg2) + giftFlowerSvg(32, 32, 0.55, pal.fg, pal.fg2) +
        '<circle cx="33" cy="10" r="1.4" fill="' + pal.fg2 + '"/><circle cx="9" cy="34" r="1.4" fill="' + pal.fg2 + '"/>';
      return '<pattern id="' + pid + '" width="42" height="42" patternUnits="userSpaceOnUse">' + body + '</pattern>';
  }
}
function giftBoxSvg(patternId, uid) {
  var pid = 'giftPat' + (uid || '');
  function face(points, shade) {
    var s = '<polygon points="' + points + '" fill="url(#' + pid + ')"/>';
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
    '<defs>' + giftPatternDef(patternId, uid) + shadowDefs + '</defs>' +
    shadow +
    face('316,128 352,84 352,114 316,158', 0.30) +  /* 右側面 */
    face('64,128 316,128 316,158 64,158', 0.16) +   /* 正面 */
    inside +
    lid +
    '</svg>';
}
/* 箱タップ → 蓋がパカッと開く (約0.42s) → 暗転 → 作業机へ。
 * 未開始なら開封してピースをぶちまけた机から、進行中・クリア済みなら
 * 散らばし直さずそのまま続きの机へ入る (id 20: 箱は常に出し、タップで
 * 続きから始める)。ピースが飛び散るアニメーションは作らない
 * (蓋パカッ＋暗転だけ)。開封自体はタイマーを開始しない
 * (タイマーは最初のピースを掴んだとき)。机へ入った時点で BGM を
 * 開始/再開する (id 19)。 */
function openBox() {
  if (!state || state.opening || !uiHome) return;
  var action = boxTapAction({ started: state.gameStarted, cleared: state.cleared, clusters: state.clusters });
  state.opening = true; // 開封アニメーション中の連打を無効化 (CSS 側でも pointer-events: none)
  seLid(); // 蓋が開く音 (紙の擦れ + ノック)
  var box = activeGiftBox();
  box.classList.add('opening');
  var veil = $('fadeVeil');
  setTimeout(function () { veil.classList.add('on'); }, 270); // 蓋が開ききる頃から暗転を始める
  setTimeout(function () {
    if (!state) return;
    if (action === 'open') {
      state.clusters = initialScatter(playDate, difficulty);
      selection.clear(); // 散らばった新しい塊に旧選択は引き継がない
      state.gameStarted = true;
      state.phase = 'play';
      persistProgress();
    }
    uiHome = false;
    navPush('play');
    applyVisibility();
    updateProgressUI();
    draw();
    bgmTryPlay(); // 机に入ったので BGM を開始 (初回) / 再開する (id 19)
    veil.classList.remove('on');
    box.classList.remove('opening'); // 次に箱を出すとき (やりなおし後) は閉じた状態から
    state.opening = false;
    setTimeout(function () { maybeTourAuto('play'); }, 500); // 初回だけプレイ画面のツアー
  }, 580);
}

/* スタート画面の表示内容: 箱は進行の有無にかかわらず常に出す (id 20)。
 * 開始済みの難易度では、箱の下に進捗サマリーと「はじめから」の小さな
 * 導線を出す (続きへ入るのは箱タップ。はじめからは確認モーダル経由)。
 * 起動時は進捗があっても必ずここから始め、続きはユーザーが選ぶ。 */
function renderStartScreen() {
  if (!state) return;
  var mode = startPanelMode({ started: state.gameStarted, cleared: state.cleared, clusters: state.clusters });
  var startedAlready = mode !== 'box';
  // 箱は1つ。柄はステージ番号で決まる
  var box = $('giftBox');
  box.classList.remove('opening');
  box.innerHTML = giftBoxSvg(BOX_PATTERNS[stageBoxPatternIndex(playStage)].id, '');
  box.hidden = false;
  box.classList.add('rippling');
  $('startHint').hidden = false;
  $('startHint').textContent = mode === 'resume' ? '箱をタップしてつづきから' : '箱をタップ';
  var totalPics = state.pool ? poolEntries(state.pool).length : 0;
  $('collectionCount').textContent = '解放した絵 ' + unlockedImageKeys(store.records).size + (totalPics ? ' / ' + totalPics : '') + '点';
  var cycNow = totalPics ? stageCycle(playStage, totalPics) : 0;
  $('stageNote').textContent = replayStage ? 'コレクションから再プレイ中' : (cycNow > 0 ? (cycNow + 1) + '周目のお題' : '');
  $('resumePanel').hidden = !startedAlready;
  if (startedAlready) {
    if (mode === 'cleared') {
      // クリア済みのステージ×難易度は進捗サマリーの代わりにクリア表示にする
      var rec = findRecordForStage(playStage, difficulty);
      var best = rec ? rec.bestTimeSec : currentElapsed();
      $('resumeInfo').textContent = difficulty + 'ピース ・ クリア済み ・ ベストタイム ' + formatTime(best);
    } else {
      var max = 0;
      state.clusters.forEach(function (c) { if (c.pieces.length > max) max = c.pieces.length; });
      $('resumeInfo').textContent = difficulty + 'ピース ・ 最大の塊 ' + max + ' / ' + difficulty + ' ・ ' + formatTime(currentElapsed());
    }
  }
  updateStartWallRow();
  updateWallPreview();
}

/* ---------- ゲーム開始 ---------- */
function startGame(pool) {
  carry = null;
  syncPlayStage(pool);
  state = newGameState(pool);
  selection.clear(); // 塊が作り直されるので選択は引き継がない
  cancelPressAndRect();
  buildDifficultySeg();
  if (firstStart) { uiHome = true; firstStart = false; } // ページを開き直したら必ずスタート画面から
  // スタート画面: 未開封なら包装された箱 (柄は日付×難易度グループで決定的)、開始済みなら続きからパネル
  renderStartScreen();
  $('fadeVeil').classList.remove('on');
  var cycLabel = poolEntries(pool).length ? stageCycle(playStage, poolEntries(pool).length) : 0;
  $('themeDateLabel').textContent = 'ステージ ' + playStage + (cycLabel > 0 ? '（' + (cycLabel + 1) + '周目）' : '');
  $('photoCredits').innerHTML = poolEntries(pool)
    .filter(function (e) { return e.type === 'url' && e.attribution; })
    .map(function (e) { return '<li>' + escapeHtml(e.title || '') + ' — ' + escapeHtml(e.attribution) + '</li>'; })
    .join('');
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
    state.bitmapFailures.clear();
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
    migrateProgressToStages(pool);
    startGame(pool);
    setTimeout(function () { maybeTourAuto('start'); }, 600); // 初回だけスタート画面のツアー
    resizeStage();
  })
  .catch(function () {
    $('themeDateLabel').textContent = '画像プールの読み込みに失敗しました';
    $('loadingOverlay').textContent = 'data/images.json を読み込めませんでした';
  });
})();
}
