/* app.js 純粋ロジックの単体テスト: node test.cjs */
const L = require('./app.js');
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  NG -', name); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* 1. 同じシードで同じ辺形状になる (決定的生成) */
{
  const e1 = L.generateEdges('2026-11-07', 400);
  const e2 = L.generateEdges('2026-11-07', 400);
  ok(eq(e1.h, e2.h) && eq(e1.v, e2.v), '同じ日付×難易度で辺形状が完全一致');
  const e3 = L.generateEdges('2026-11-08', 400);
  ok(!eq(e1.h, e3.h), '日付が変わると辺形状も変わる');
  const s1 = L.sampleEdge(e1.h[5][5], 8), s2 = L.sampleEdge(e2.h[5][5], 8);
  ok(eq(s1, s2), 'サンプリング点列も決定的');
}

/* 2. 隣り合う辺同士の輪郭が相補 (制御点一致 = 同じ曲線を共有) */
{
  const edges = L.generateEdges('2026-11-07', 100);
  const n = edges.n;
  let allOk = true, checked = 0;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n - 1; col++) {
      const right = L.sideSamples(edges, col, row, 'right', 8);
      const left = L.sideSamples(edges, col + 1, row, 'left', 8); // 下→上の順
      const leftRev = left.slice().reverse();
      if (right.length !== leftRev.length) { allOk = false; break; }
      for (let i = 0; i < right.length; i++) {
        // 組み立て時は右ピースが x+1 に置かれるので、左辺の x に 1 を足して比較する
        if (Math.abs(right[i].x - (leftRev[i].x + 1)) > 1e-9 || Math.abs(right[i].y - leftRev[i].y) > 1e-9) { allOk = false; break; }
      }
      checked++;
    }
  }
  ok(allOk && checked === n * (n - 1), '縦方向の全内部境界で右辺と左辺の輪郭が一致 (' + checked + '境界)');
  let allOkH = true; checked = 0;
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n; col++) {
      const bottom = L.sideSamples(edges, col, row, 'bottom', 8);
      const top = L.sideSamples(edges, col, row + 1, 'top', 8);
      const bottomRev = bottom.slice().reverse(); // 下辺は右→左の周回順なので反転して左→右にそろえる
      if (bottomRev.length !== top.length) { allOkH = false; break; }
      for (let i = 0; i < bottomRev.length; i++) {
        // 組み立て時は下のピースが y+1 に置かれるので、上辺の y に 1 を足して比較する
        if (Math.abs(bottomRev[i].x - top[i].x) > 1e-9 || Math.abs(bottomRev[i].y - (top[i].y + 1)) > 1e-9) { allOkH = false; break; }
      }
      checked++;
    }
  }
  ok(allOkH && checked === (n - 1) * n, '横方向の全内部境界で下辺と上辺の輪郭が一致 (' + checked + '境界)');
}

/* 3. ノブが辺からはみ出さない / 高さと位置のバリエーション */
{
  let maxV = 0, minU = 1, maxU = 0, heights = new Set(), offsets = new Set(), allInside = true;
  for (const pieces of L.DIFFICULTIES) {
    for (const date of ['2026-11-07', '2026-12-25', '2027-03-14']) {
      const edges = L.generateEdges(date, pieces);
      const all = [];
      edges.h.forEach(r => r.forEach(e => e && all.push(e)));
      edges.v.forEach(r => r.forEach(e => e && all.push(e)));
      for (const e of all) {
        heights.add(Math.round(e.t / L.TABSIZE * 20));
        offsets.add(Math.round(e.b * 20));
        if (e.t < L.TABSIZE * 0.69 || e.t > L.TABSIZE * 1.31) allInside = false;
        const pts = L.sampleEdge(e, 16);
        pts.forEach(function (p, i) {
          maxV = Math.max(maxV, Math.abs(p.v));
          // 始点・終点は角のジッター (辺そのものの端点) なので除外し、ノブの隆起部分だけを見る
          if (i === 0 || i === pts.length - 1) return;
          if (Math.abs(p.v) > 0.05) { minU = Math.min(minU, p.u); maxU = Math.max(maxU, p.u); }
        });
      }
    }
  }
  ok(allInside, '全辺で t が tabsize×0.7〜1.3 の範囲内');
  ok(maxV <= 0.29, 'ノブ高さ最大 ' + maxV.toFixed(3) + ' (一辺の0.29以下)');
  ok(minU > 0.03 && maxU < 0.97, 'ノブの出っ張り部分は辺の内側 (u: ' + minU.toFixed(3) + '〜' + maxU.toFixed(3) + ')');
  ok(heights.size >= 8, 'ノブ高さのバリエーションあり (' + heights.size + '段階相当)');
  ok(offsets.size >= 5, 'ノブ中心位置のずれのバリエーションあり (' + offsets.size + '段階相当)');
}

/* 4. 完成判定 */
{
  const n = 10, pieces = 100;
  const clusters = [];
  for (let id = 0; id < pieces; id++) {
    const h = L.pieceHome(id, n);
    clusters.push({ pieces: [id], surface: 'mat', gx: h.col, gy: h.row });
  }
  ok(L.isComplete(clusters, n) === true, '全セル正解配置で完成判定 = 真');
  const moved = clusters.map(c => ({ ...c }));
  moved[42] = { ...moved[42], gx: moved[42].gx + 1 };
  ok(L.isComplete(moved, n) === false, '1つずらすと完成判定 = 偽');
  const desk = clusters.map(c => ({ ...c }));
  desk[0] = { ...desk[0], surface: 'desk' };
  ok(L.isComplete(desk, n) === false, '1つ机側にあると完成判定 = 偽');
  ok(L.isComplete(clusters.slice(1), n) === false, '1つ欠けると完成判定 = 偽');
  // 塊 (クラスター) 単位でも正しく判定できる
  const merged = [{ pieces: clusters.slice(0, 50).flatMap(c => c.pieces), surface: 'mat', gx: 0, gy: 0 }]
    .concat(clusters.slice(50));
  ok(L.isComplete(merged, n) === true, '塊にまとまっていても完成判定 = 真');
}

/* 5. 日付 → 画像ID が決定的 */
{
  const pool = JSON.parse(require('fs').readFileSync(__dirname + '/data/images.json', 'utf8'));
  ok(pool.baseDate === '2026-11-07' && Array.isArray(pool.ids) && pool.ids.length > 900, 'images.json: 基準日と ' + pool.ids.length + ' 件のID');
  ok(L.pickImageId('2026-11-07', pool) === pool.ids[0], '基準日 → ids[0]');
  ok(L.pickImageId('2026-11-08', pool) === pool.ids[1], '基準日+1 → ids[1]');
  ok(L.pickImageId('2026-11-07', pool) === L.pickImageId('2026-11-07', pool), '同じ日付では常に同じID');
  const wrap = L.addDays('2026-11-07', pool.ids.length);
  ok(L.pickImageId(wrap, pool) === pool.ids[0], 'プール一周で ids[0] に戻る');
  ok(L.pickImageId('2026-11-06', pool) === pool.ids[pool.ids.length - 1], '基準日前日 → ids[末尾]');
  // 日付移動は廃止 (常に今日のお題だけ開く): ?date= 解決用の関数は存在しない
  ok(L.resolvePlayDate === undefined, '日付移動は廃止: resolvePlayDate は存在しない');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(L.jstTodayString(new Date('2026-11-07T03:00:00Z'))), '今日 (JST) の文字列が取れる');
}

/* 6. 相対スナップとグリッド吸着 */
{
  const n = 10;
  const a = { pieces: [0], surface: 'desk', gx: 3, gy: 3 };
  const near = { pieces: [1], surface: 'desk', gx: 4.2, gy: 3.1 }; // ピース1はピース0の右隣が正解
  const snap = L.findRelativeSnap(near, [a], n);
  ok(!!snap && snap.gx === 4 && snap.gy === 3, '隣ピースの近くで相対スナップが発動し正しい相対位置に吸着');
  const far = { pieces: [1], surface: 'desk', gx: 6, gy: 6 };
  ok(L.findRelativeSnap(far, [a], n) === null, '離れていると相対スナップしない');
  const stranger = { pieces: [55], surface: 'desk', gx: 4.1, gy: 3.1 }; // 隣同士ではない
  ok(L.findRelativeSnap(stranger, [a], n) === null, '隣でないピースは絶対にくっつかない');
  const otherSurface = { pieces: [1], surface: 'mat', gx: 4.1, gy: 3.0 };
  ok(L.findRelativeSnap(otherSurface, [a], n) === null, '違う画面 (机/マット) ではくっつかない');
  ok(L.snapToGrid(2.4) === 2 && L.snapToGrid(2.5) === 3 && L.snapToGrid(-1.6) === -2, 'グリッド吸着は最寄りの整数へ');
}

/* 7. 初期散らばり配置 (自由配置: 密度ムラのある決定的ランダム、重なりは面積の半分未満) */
{
  const s1 = L.initialScatter('2026-11-07', 100);
  const s2 = L.initialScatter('2026-11-07', 100);
  ok(eq(s1, s2), '散らばり: 同じ日付×難易度で配置が完全一致 (決定的)');
  ok(s1.length === 100 && new Set(s1.flatMap(c => c.pieces)).size === 100, '散らばり: 全ピースがちょうど1回ずつ現れる');
  ok(s1.every(c => c.surface === 'desk' && c.pieces.length === 1), '散らばり: 全ピースが机の上に単体で置かれる');
  // 散らばり領域: 旧机ビュー (n+6)×(n+4) の約1.5〜2倍で、マット盤 (n×n) を含む
  const r = L.scatterRect(100);
  const n = 10;
  ok(r.w * r.h >= (n + 6) * (n + 4) * 1.5 && r.w * r.h <= (n + 6) * (n + 4) * 2.1, '散らばり領域: 旧机ビューの約1.5〜2倍の面積 (' + (r.w * r.h / ((n + 6) * (n + 4))).toFixed(2) + '倍)');
  ok(r.x0 <= 0 && r.y0 <= 0 && r.x0 + r.w >= n && r.y0 + r.h >= n, '散らばり領域: マット盤 (n×n) を含む');
  // 全ピースが領域内にピース全体 (1セル) ごと収まる
  ok(s1.every(c => c.gx >= r.x0 && c.gx + 1 <= r.x0 + r.w && c.gy >= r.y0 && c.gy + 1 <= r.y0 + r.h), '散らばり: 全ピースが散らばり領域内に収まる');
  // 等間隔グリッドではない: 大半のピースが整数座標からずれた自由座標にある
  const offGrid = s1.filter(c => Math.abs(c.gx - Math.round(c.gx)) > 0.05 || Math.abs(c.gy - Math.round(c.gy)) > 0.05).length;
  ok(offGrid >= 90, '散らばり: 等間隔グリッドではなく大半が自由座標 (' + offGrid + '/100)');
  // 領域の縦横いっぱいに広がっている
  const xs = s1.map(c => c.gx), ys = s1.map(c => c.gy);
  ok(Math.max(...xs) - Math.min(...xs) >= (r.w - 1) * 0.7 && Math.max(...ys) - Math.min(...ys) >= (r.h - 1) * 0.7, '散らばり: 領域の縦横いっぱいに広がっている');
  // 密度ムラ: 4×4 に区切ると一番濃い区画が平均の1.8倍以上
  const grid = new Array(16).fill(0);
  s1.forEach(c => {
    const gi = Math.min(3, Math.floor((c.gx - r.x0) / r.w * 4)), gj = Math.min(3, Math.floor((c.gy - r.y0) / r.h * 4));
    grid[gj * 4 + gi]++;
  });
  ok(Math.max(...grid) >= (100 / 16) * 1.8, '散らばり: 密度にムラがある (最濃区画 ' + Math.max(...grid) + ' / 平均 ' + (100 / 16).toFixed(1) + ')');
  // 重なりは面積の半分未満 (完全に隠れて掴めないピースを作らない)。同一座標もなし
  function worstPair(cs) {
    let w = 0;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const ox = 1 - Math.abs(cs[i].gx - cs[j].gx), oy = 1 - Math.abs(cs[i].gy - cs[j].gy);
      if (ox > 0 && oy > 0 && ox * oy > w) w = ox * oy;
    }
    return w;
  }
  ok(new Set(s1.map(c => c.gx + ',' + c.gy)).size === 100, '散らばり: 同一座標に重なるピースはない');
  ok(worstPair(s1) < 0.5, '散らばり: どの2ピースも重なりは面積の半分未満 (最大 ' + worstPair(s1).toFixed(2) + ')');
  const idsInOrder = s1.map(c => c.pieces[0]);
  ok(!eq(idsInOrder, idsInOrder.slice().sort((a, b) => a - b)), '散らばり: 重なり順 (z-order) がシャッフルされている');
  ok(!eq(s1, L.initialScatter('2026-11-08', 100)), '散らばり: 日付が変わると配置も変わる');
  ok(!eq(s1, L.initialScatter('2026-11-07', 225)), '散らばり: 難易度が変わると配置も変わる');
  // 全難易度 (36〜2025) で領域・重なりの条件を満たす
  for (const p of L.DIFFICULTIES) {
    const cs = L.initialScatter('2026-11-07', p), rr = L.scatterRect(p);
    ok(cs.length === p && new Set(cs.flatMap(c => c.pieces)).size === p &&
      cs.every(c => c.gx >= rr.x0 && c.gx + 1 <= rr.x0 + rr.w && c.gy >= rr.y0 && c.gy + 1 <= rr.y0 + rr.h) &&
      worstPair(cs) < 0.5,
      '散らばり: ' + p + 'ピースでも全ピースが領域内に収まり重なりは半分未満');
  }
}

/* 8. 箱の包装柄の決定性 (同じ日付なら誰でも同じ柄・完成写真は載せない前提の柄選択) */
{
  ok(L.BOX_PATTERNS.length === 6, '箱の包装柄は6種');
  ok(L.boxPatternForDate('2026-11-07').id === L.boxPatternForDate('2026-11-07').id, '箱の柄: 同じ日付で常に同じ柄');
  const seen = new Set();
  for (let d = 0; d < 6; d++) seen.add(L.boxPatternForDate(L.addDays('2026-11-07', d)).id);
  ok(seen.size === 6, '箱の柄: 連続6日で6柄すべてが順に現れる');
  ok(L.boxPatternForDate(L.addDays('2026-11-07', 6)).id === L.boxPatternForDate('2026-11-07').id, '箱の柄: 7日目に同じ柄へ戻る (ローテーション)');
  ok(L.boxPatternForDate('2026-11-06').id === L.BOX_PATTERNS[5].id, '箱の柄: 基準日前日は末尾の柄 (負の日数でも決定的)');
}

/* 9. 机の上での合体 (相対スナップ): 正しい相対位置に置けば必ず1つの塊になり、塊として動かせる */
{
  const n = 10;
  const a = { pieces: [0], surface: 'desk', gx: 3, gy: 3 };
  const b = { pieces: [1], surface: 'desk', gx: 4, gy: 3 }; // ピース1はピース0の右隣が本来の位置
  const res = L.absorbMerges([a], b, n);
  ok(res.merged === true && res.clusters.length === 1 && res.cluster.pieces.length === 2, '机: 隣ピースを正しい相対位置に置くと1つの塊に合体する');
  // 塊として移動できる: 塊全体をずらしても相対配置が保たれる
  const movedCluster = { pieces: res.cluster.pieces.slice(), surface: 'desk', gx: res.cluster.gx + 5, gy: res.cluster.gy + 2 };
  const pos = L.piecePositions([movedCluster], n);
  ok(pos.get(0).gx + 1 === pos.get(1).gx && pos.get(0).gy === pos.get(1).gy && pos.get(0).surface === 'desk', '机: 合体した塊は相対配置を保ったまま塊ごと移動できる');
  // グリッド吸着と組み合わせ: 中途半端な位置で離しても、吸着で正しい相対位置に揃えば確実に合体
  const bFloat = { pieces: [1], surface: 'desk', gx: 4.4, gy: 2.6 };
  const res2 = L.absorbMerges([{ pieces: [0], surface: 'desk', gx: 3, gy: 3 }], bFloat, n);
  ok(res2.merged === true && res2.clusters.length === 1, '机: グリッド吸着で正しい相対位置に揃えば確実に合体する (合っているのにくっつかない、がない)');
  // 相対スナップ範囲内 (浮動小数) でも合体し、位置は正しい相対位置に吸着される
  const bNear = { pieces: [1], surface: 'desk', gx: 4.2, gy: 3.1 };
  const resNear = L.absorbMerges([{ pieces: [0], surface: 'desk', gx: 3, gy: 3 }], bNear, n);
  const posNear = L.piecePositions([resNear.cluster], n);
  ok(resNear.merged === true && posNear.get(1).gx === 4 && posNear.get(1).gy === 3, '机: 近傍で離しても正しい相対位置に吸着して合体する');
  // 塊同士の合体 (横2ピースの塊の下に、もう1つの横2ピースの塊を正しく置く)
  const c1 = { pieces: [0, 1], surface: 'desk', gx: 3, gy: 3 };
  const c2 = { pieces: [10, 11], surface: 'desk', gx: 3, gy: 4 };
  const res3 = L.absorbMerges([c1], c2, n);
  ok(res3.merged === true && res3.clusters.length === 1 && res3.cluster.pieces.length === 4, '机: 塊同士も正しい相対位置で合体する');
  // 橋渡しピースで2つの塊が連鎖合体する
  const left = { pieces: [0], surface: 'desk', gx: 3, gy: 3 };
  const right = { pieces: [2], surface: 'desk', gx: 5, gy: 3 };
  const bridge = { pieces: [1], surface: 'desk', gx: 4, gy: 3 };
  const resChain = L.absorbMerges([left, right], bridge, n);
  ok(resChain.merged === true && resChain.clusters.length === 1 && resChain.cluster.pieces.length === 3, '机: 間のピースを置くと両側の塊と連鎖合体する');
  // 正しい相対位置でなければ合体しない
  const wrong = { pieces: [1], surface: 'desk', gx: 5, gy: 3 };
  const res4 = L.absorbMerges([{ pieces: [0], surface: 'desk', gx: 3, gy: 3 }], wrong, n);
  ok(res4.merged === false && res4.clusters.length === 2, '机: 正しい相対位置でなければ合体しない');
  const stranger2 = { pieces: [55], surface: 'desk', gx: 4, gy: 3 };
  const res5 = L.absorbMerges([{ pieces: [0], surface: 'desk', gx: 3, gy: 3 }], stranger2, n);
  ok(res5.merged === false && res5.clusters.length === 2, '机: 隣同士でないピースは隣のマスに置いても合体しない');
  // マット上でも同様に合体する
  const m1 = { pieces: [0], surface: 'mat', gx: 0, gy: 0 };
  const m2 = { pieces: [1], surface: 'mat', gx: 1, gy: 0 };
  ok(L.absorbMerges([m1], m2, n).merged === true, 'マット: 隣ピースを正しい相対位置に置くと合体する');
  // 合体しなかった場合はグリッド吸着だけが適用される
  const lone = { pieces: [7], surface: 'desk', gx: 2.4, gy: 6.6 };
  const res6 = L.absorbMerges([], lone, n);
  ok(res6.merged === false && res6.cluster.gx === 2 && res6.cluster.gy === 7, '合体相手がいなければ最寄りグリッドに吸着するだけ');
}

/* 10. 最低難易度 36ピース (6×6) */
{
  ok(L.DIFFICULTIES.length === 7 && L.DIFFICULTIES[0] === 36 && L.DIFFICULTIES[6] === 2025, '難易度は7段階で最低が36ピース');
  const e1 = L.generateEdges('2026-11-07', 36);
  const e2 = L.generateEdges('2026-11-07', 36);
  ok(e1.n === 6, '36ピースは 6×6 グリッド');
  ok(eq(e1.h, e2.h) && eq(e1.v, e2.v), '36ピース: 同じ日付で辺形状が完全一致');
  const e3 = L.generateEdges('2026-11-08', 36);
  ok(!eq(e1.h, e3.h), '36ピース: 日付が変わると辺形状も変わる');
  // 完成判定 (n=6)
  const n = 6, pieces = 36;
  const clusters = [];
  for (let id = 0; id < pieces; id++) {
    const h = L.pieceHome(id, n);
    clusters.push({ pieces: [id], surface: 'mat', gx: h.col, gy: h.row });
  }
  ok(L.isComplete(clusters, n) === true, '36ピース: 全セル正解配置で完成判定 = 真');
  const moved = clusters.map(c => ({ ...c }));
  moved[7] = { ...moved[7], gy: moved[7].gy + 1 };
  ok(L.isComplete(moved, n) === false, '36ピース: 1つずらすと完成判定 = 偽');
  // 散らばり (n=6): 自由配置でも全ピースが領域内に出る
  const s36 = L.initialScatter('2026-11-07', 36);
  const r36 = L.scatterRect(36);
  ok(s36.length === 36 && new Set(s36.flatMap(c => c.pieces)).size === 36 &&
    s36.every(c => c.gx >= r36.x0 && c.gx + 1 <= r36.x0 + r36.w && c.gy >= r36.y0 && c.gy + 1 <= r36.y0 + r36.h),
    '36ピース: 散らばりは全ピースが散らばり領域内に机に出る');
}

/* 11. 範囲選択 (長押し) の純粋ロジック: 矩形×塊の交差判定 / 追随移動 / グループ確定 */
{
  const n = 10;
  const approx = (a, b) => Math.abs(a - b) < 1e-9;
  // --- clustersInRect ---
  const c1 = { pieces: [0], surface: 'desk', gx: 2, gy: 2 };          // ピース矩形 [2,3]×[2,3]
  const c2 = { pieces: [55], surface: 'desk', gx: 5, gy: 5 };
  const c3 = { pieces: [11, 12], surface: 'desk', gx: 7, gy: 1 };      // ピース11が(7,1)、12が(8,1)
  const c4 = { pieces: [3], surface: 'mat', gx: 2, gy: 2 };            // c1 と同じ位置だがマット側
  const all = [c1, c2, c3, c4];
  ok(eq(L.clustersInRect(all, n, { x0: 1.5, y0: 1.5, x1: 2.5, y1: 2.5 }, 'desk'), [c1]), '範囲選択: 矩形と交差したピースの塊が選ばれる');
  ok(eq(L.clustersInRect(all, n, { x0: 3, y0: 2, x1: 4, y1: 3 }, 'desk'), []), '範囲選択: 辺だけ接する矩形は交差とみなさない');
  ok(eq(L.clustersInRect(all, n, { x0: 7.5, y0: 0.5, x1: 8.5, y1: 1.5 }, 'desk'), [c3]), '範囲選択: 塊の1ピースでも交差すれば塊全体が選ばれる');
  ok(eq(L.clustersInRect(all, n, { x0: 5.5, y0: 5.5, x1: 9, y1: 9 }, 'desk'), [c2]), '範囲選択: 部分的な重なりでも選ばれる');
  ok(eq(L.clustersInRect(all, n, { x0: -10, y0: -10, x1: 20, y1: 20 }, 'mat'), [c4]), '範囲選択: 面 (机/マット) で絞れる');
  ok(L.clustersInRect(all, n, { x0: -10, y0: -10, x1: 20, y1: 20 }).length === 4, '範囲選択: 面を指定しなければ両面が対象');
  // --- shiftClusters ---
  const src = [{ pieces: [0, 1], surface: 'desk', gx: 3.5, gy: 2.25 }];
  const shifted = L.shiftClusters(src, 2, -1);
  ok(shifted[0].gx === 5.5 && shifted[0].gy === 1.25 && shifted[0].surface === 'desk' && eq(shifted[0].pieces, [0, 1]), '追随移動: 指定量だけ平行移動し面とピースを保持する');
  ok(src[0].gx === 3.5 && src[0].gy === 2.25 && shifted[0] !== src[0] && shifted[0].pieces !== src[0].pieces, '追随移動: 元の塊は変更しない (新しい塊を返す)');
  // --- absorbMerges の noSnap (追随塊用: 合体判定だけ行い、単独のグリッド吸着はしない) ---
  const aBlk = { pieces: [0], surface: 'desk', gx: 3, gy: 3 };
  const fFloat = { pieces: [1], surface: 'desk', gx: 4.3, gy: 3.2 }; // 正しい相対位置 (4,3) から 0.36 離れていて相対スナップ圏外
  const rNo = L.absorbMerges([aBlk], fFloat, n, { noSnap: true });
  ok(rNo.merged === false && rNo.cluster.gx === 4.3 && rNo.cluster.gy === 3.2, 'noSnap: 合体しない塊は自由座標のまま動かない');
  const rSnap = L.absorbMerges([aBlk], fFloat, n);
  ok(rSnap.merged === true && rSnap.clusters.length === 1, '通常版: 同じ位置でもグリッド吸着して合体する (noSnap との対比)');
  const fExact = { pieces: [1], surface: 'desk', gx: 4, gy: 3 };
  ok(L.absorbMerges([aBlk], fExact, n, { noSnap: true }).merged === true, 'noSnap: ちょうど正しい相対位置なら合体する');
  const fNear = { pieces: [1], surface: 'desk', gx: 4.2, gy: 3.0 };
  const rNear = L.absorbMerges([aBlk], fNear, n, { noSnap: true });
  const posNearSel = L.piecePositions([rNear.cluster], n);
  ok(rNear.merged === true && posNearSel.get(1).gx === 4 && posNearSel.get(1).gy === 3, 'noSnap: 相対スナップ圏内なら吸着して合体する');
  // --- グループ確定の合成 (UI の settleGroupDrag と同じ手順を純粋関数で再現) ---
  function settleGroupSim(leader, followers, others, nn) {
    const anchorId = L.clusterAnchorId(leader);
    const before = L.piecePositions([leader], nn).get(anchorId);
    const res = L.absorbMerges(others, { pieces: leader.pieces, surface: leader.surface, gx: leader.gx, gy: leader.gy }, nn);
    const after = L.piecePositions([res.cluster], nn).get(anchorId);
    const dx = after.gx - before.gx, dy = after.gy - before.gy;
    let allC = res.clusters.concat(L.shiftClusters(followers, dx, dy));
    const queue = allC.slice(res.clusters.length);
    while (queue.length) {
      const f = queue.shift();
      if (allC.indexOf(f) < 0) continue;
      const r2 = L.absorbMerges(allC.filter(c => c !== f), { pieces: f.pieces, surface: f.surface, gx: f.gx, gy: f.gy }, nn, { noSnap: true });
      allC = r2.clusters;
    }
    return allC;
  }
  // 掴んだ塊がグリッド吸着し、隣の選択塊が追随して合体する
  const lead = { pieces: [0], surface: 'desk', gx: 10.5, gy: 10.25 };
  const foll = { pieces: [1], surface: 'desk', gx: 11.5, gy: 10.25 }; // ピース1はピース0の右隣 (相対オフセット正確)
  const g1 = settleGroupSim(lead, [foll], [], n);
  const g1pos = L.piecePositions(g1, n);
  ok(g1.length === 1 && g1pos.get(0).gx === 11 && g1pos.get(0).gy === 10 && g1pos.get(1).gx === 12 && g1pos.get(1).gy === 10,
    'グループ確定: 掴んだ塊の吸着に追随して隣の選択塊が合体する');
  // 合体しない選択塊は、追随した自由座標のまま (相対配置を保持し、個別に吸着しない)
  const follFar = { pieces: [55], surface: 'desk', gx: 20.5, gy: 15.75 };
  const g2 = settleGroupSim(lead, [follFar], [], n);
  const g2f = g2.find(c => c.pieces.indexOf(55) >= 0);
  ok(g2.length === 2 && approx(g2f.gx, 21) && approx(g2f.gy, 15.5), 'グループ確定: 合体しない塊は追随量だけ動き、自由座標を保つ');
}

/* 12. コレクション詳細の完成盤面レイアウト / 描画プラン */
{
  for (const pieces of L.DIFFICULTIES) {
    const n = Math.round(Math.sqrt(pieces));
    const lay = L.completedBoardLayout(pieces, 960);
    ok(lay.n === n && Math.abs(lay.cellPx * (n + 2) - 960) < 1e-6 && lay.ox === lay.cellPx && lay.oy === lay.cellPx && Math.abs(lay.boardPx - lay.cellPx * n) < 1e-6,
      '完成盤面レイアウト: ' + pieces + 'ピースは n=' + n + '、余白1セルで盤が収まる');
    const plan = L.detailRenderPlan(pieces);
    ok(plan.n === n && plan.sizePx > 0 && plan.perSeg >= 5 && plan.perSeg <= 10,
      '詳細描画プラン: ' + pieces + 'ピース (sizePx=' + plan.sizePx + ', perSeg=' + plan.perSeg + ')');
  }
  const planMax = L.detailRenderPlan(2025), planMin = L.detailRenderPlan(36);
  ok(planMax.perSeg < planMin.perSeg && planMax.sizePx < planMin.sizePx, '詳細描画プラン: 最大難易度は解像度とサンプリングを落として軽量化する');
  // 詳細の辺シード (レコード日付×難易度) が決定的で、完成盤面の全ピース輪郭が作れること
  const de1 = L.generateEdges('2026-11-03', 225), de2 = L.generateEdges('2026-11-03', 225);
  let outlineOk = true;
  for (let id = 0; id < 225; id++) {
    const home = L.pieceHome(id, 15);
    const pts = L.pieceOutlinePoints(de1, home.col, home.row, L.detailRenderPlan(225).perSeg);
    if (pts.length < 8) { outlineOk = false; break; }
    pts.forEach(p => { if (!isFinite(p.x) || !isFinite(p.y)) outlineOk = false; });
  }
  ok(outlineOk && JSON.stringify(de1.h) === JSON.stringify(de2.h) && JSON.stringify(de1.v) === JSON.stringify(de2.v),
    '詳細の辺生成は決定的で、全ピースの輪郭点が有限値で作れる');
}

/* 13. 木目タイル敷きのオフセット計算 (回帰: パターン変換に頼らず drawImage で敷く) */
{
  ok(L.woodTileOrigin(0, 100) === 0, 'タイル原点: オフセット0なら0');
  ok(L.woodTileOrigin(100, 100) === 0, 'タイル原点: ちょうどタイル幅ぶんなら0');
  ok(L.woodTileOrigin(30, 100) === -70, 'タイル原点: 正のオフセットは1タイル手前から敷く');
  ok(L.woodTileOrigin(-30, 100) === -30, 'タイル原点: 負のオフセットでもそのまま位相が合う');
  ok(L.woodTileOrigin(-100, 100) === 0, 'タイル原点: 負のタイル幅ぶんでも0');
  ok(Math.abs(L.woodTileOrigin(250.5, 100) - (-49.5)) < 1e-9, 'タイル原点: 小数のオフセットにも対応');
  ok(L.woodTileOrigin(50, 0) === 0 && L.woodTileOrigin(50, -10) === 0, 'タイル原点: 不正なタイル幅では0 (描画側でフォールバック)');
  // 任意のオフセットで「結果は (-size, 0]」かつ「offset - result は size の整数倍」
  let propOk = true;
  for (const off of [-12345.678, -512, -0.001, 0.001, 511.9, 512, 9876.543]) {
    for (const size of [512 * 0.17, 512 * 0.34, 512 * 1.36]) {
      const r = L.woodTileOrigin(off, size);
      const k = (off - r) / size;
      if (!(r > -size && r <= 0 && Math.abs(k - Math.round(k)) < 1e-6)) propOk = false;
    }
  }
  ok(propOk, 'タイル原点: 負座標・小ズームでも常に範囲内かつワールドに位相が固定される');
}

/* 14. マット盤の外側タップ判定 (盤外タップ → 机に戻る) */
{
  ok(L.isOutsideBoardCell(-0.1, 5, 10) === true, '盤外判定: 盤の左は外');
  ok(L.isOutsideBoardCell(5, -1, 10) === true, '盤外判定: 盤の上は外');
  ok(L.isOutsideBoardCell(10, 5, 10) === true, '盤外判定: 右端 (gx == n) は外');
  ok(L.isOutsideBoardCell(5, 10, 10) === true, '盤外判定: 下端 (gy == n) は外');
  ok(L.isOutsideBoardCell(0, 0, 10) === false, '盤外判定: 左上セルは内');
  ok(L.isOutsideBoardCell(9.99, 9.99, 10) === false, '盤外判定: 右下セル内は内');
  ok(L.isOutsideBoardCell(5.5, 5.5, 10) === false, '盤外判定: 中央は内');
}

/* 15. ミニマップのレイアウト計算 */
{
  const r = L.scatterRect(100); // {x0:-3, y0:-3, w:22, h:20}
  const lay = L.minimapLayout(r, 120, 106);
  ok(Math.abs(lay.scale - Math.min(120 / r.w, 106 / r.h)) < 1e-9, 'ミニマップ: アスペクト維持のスケール');
  ok(lay.w <= 120 && lay.h <= 106, 'ミニマップ: 最大サイズに収まる');
  ok(Math.abs(lay.ox - (120 - lay.w) / 2) < 1e-9 && Math.abs(lay.oy - (106 - lay.h) / 2) < 1e-9, 'ミニマップ: 中央寄せされる');
  ok(Math.abs(lay.w / lay.h - r.w / r.h) < 1e-9, 'ミニマップ: ワールドのアスペクト比を保つ');
  const wide = L.minimapLayout({ x0: 0, y0: 0, w: 40, h: 10 }, 120, 106);
  ok(Math.abs(wide.w - 120) < 1e-9 && Math.abs(wide.h - 30) < 1e-9 && wide.oy > 0, 'ミニマップ: 横長ワールドは横いっぱい・縦中央');
  const tall = L.minimapLayout({ x0: 0, y0: 0, w: 10, h: 40 }, 120, 106);
  ok(Math.abs(tall.h - 106) < 1e-9 && Math.abs(tall.w - 26.5) < 1e-9 && tall.ox > 0, 'ミニマップ: 縦長ワールドは縦いっぱい・横中央');
  // 全難易度で散らばり領域がミニマップに収まる
  let allFit = true;
  for (const p of L.DIFFICULTIES) {
    const l2 = L.minimapLayout(L.scatterRect(p), 120, 106);
    if (!(l2.w <= 120 + 1e-9 && l2.h <= 106 + 1e-9 && l2.scale > 0)) allFit = false;
  }
  ok(allFit, 'ミニマップ: 全難易度の散らばり領域が収まる');
}

/* 16. 起動フロー: スタート画面のパネル判定と「はじめから」確認の要否
 * (ページを開き直したら必ずスタート画面。進行中は つづきから/はじめから を選べる) */
{
  // progressIsStarted: started フラグ or 塊の残存で開始済み (旧保存互換)
  ok(L.progressIsStarted(null) === false, '開始判定: 進捗なしは未開始');
  ok(L.progressIsStarted({ started: false, clusters: [] }) === false, '開始判定: 空の進捗は未開始');
  ok(L.progressIsStarted({ started: true, clusters: [] }) === true, '開始判定: started フラグで開始済み');
  ok(L.progressIsStarted({ clusters: [{ pieces: [0] }] }) === true, '開始判定: started なしの旧保存でも塊が残れば開始済み');
  // startPanelMode: 未開始=箱 / 進行中=resume / クリア済み=cleared
  ok(L.startPanelMode(null) === 'box', 'パネル判定: 進捗なしは箱');
  ok(L.startPanelMode({ started: false, cleared: false, clusters: [] }) === 'box', 'パネル判定: 未開始は箱');
  ok(L.startPanelMode({ started: true, cleared: false, clusters: [{ pieces: [0] }] }) === 'resume', 'パネル判定: 進行中は つづきから/はじめから');
  ok(L.startPanelMode({ started: true, cleared: true, clusters: [{ pieces: [0] }] }) === 'cleared', 'パネル判定: クリア済みはベストタイム表示が優先');
  ok(L.startPanelMode({ cleared: true, clusters: [] }) === 'cleared', 'パネル判定: クリア済みは塊が無くても cleared');
  // freshStartNeedsConfirm: 消える進捗があるときだけ確認モーダルを出す
  ok(L.freshStartNeedsConfirm(null) === false, '確認要否: 進捗なしは確認不要');
  ok(L.freshStartNeedsConfirm({ started: false, clusters: [] }) === false, '確認要否: 未開始は確認不要');
  ok(L.freshStartNeedsConfirm({ started: true, clusters: [] }) === true, '確認要否: 進行中は確認が必要');
  ok(L.freshStartNeedsConfirm({ cleared: true, clusters: [] }) === true, '確認要否: クリア済みの再プレイも確認が必要');
}

/* 17. 机背景キャッシュのキー (deskBgKey)
 * テーマ・ステージ寸法・dpr・カメラがすべて一致したときだけキャッシュを
 * 使い回す。カメラ精度はミニマップ変化検知 (camKey) と同じ丸めにする。 */
{
  const v = { scale: 0.5, tx: 120.34, ty: -56.78 };
  const k = L.deskBgKey('walnut', 800, 600, 2, v);
  ok(L.deskBgKey('walnut', 800, 600, 2, { scale: 0.5, tx: 120.34, ty: -56.78 }) === k, '背景キー: 同条件なら同じキー (キャッシュが効く)');
  ok(L.deskBgKey('nordic', 800, 600, 2, v) !== k, '背景キー: テーマが変われば別キー');
  ok(L.deskBgKey('walnut', 801, 600, 2, v) !== k, '背景キー: ステージ幅が変われば別キー');
  ok(L.deskBgKey('walnut', 800, 601, 2, v) !== k, '背景キー: ステージ高さが変われば別キー');
  ok(L.deskBgKey('walnut', 800, 600, 1, v) !== k, '背景キー: dpr が変われば別キー');
  ok(L.deskBgKey('walnut', 800, 600, 2, { scale: 0.51, tx: 120.34, ty: -56.78 }) !== k, '背景キー: ズームが変われば別キー');
  ok(L.deskBgKey('walnut', 800, 600, 2, { scale: 0.5, tx: 121.34, ty: -56.78 }) !== k, '背景キー: パン (tx) が変われば別キー');
  ok(L.deskBgKey('walnut', 800, 600, 2, { scale: 0.5, tx: 120.34, ty: -55.78 }) !== k, '背景キー: パン (ty) が変われば別キー');
  // 丸め精度未満のカメラ差は同一キー (ミニマップ検知と同じ精度 = 検知とずれない)
  ok(L.deskBgKey('walnut', 800, 600, 2, { scale: 0.50001, tx: 120.31, ty: -56.81 }) === k, '背景キー: 丸め未満のカメラ差は同一キー');
}

/* 18. ピースの立体感 (pieceRelief)
 * 厚みはセル比 3.7%・ベベル幅 2.2% (スライダープレビューで決めた確定値)。
 * 小セルでは最小限に抑え、厚みは最大 8px・ベベルは 1px〜6px に収まる。
 * 見た目だけの量で、判定には使わない。 */
{
  ok(eq(L.pieceRelief(0), { thickness: 0, bevel: 0 }), '立体感: cellPx=0 では無効');
  ok(eq(L.pieceRelief(-10), { thickness: 0, bevel: 0 }), '立体感: 負の cellPx では無効');
  ok(eq(L.pieceRelief(NaN), { thickness: 0, bevel: 0 }), '立体感: NaN では無効');
  const r36 = L.pieceRelief(180); // 36ピース: boardPx 1080 / 6セル
  ok(Math.abs(r36.thickness - 180 * 0.037) < 1e-9, '立体感: 大セル (180px) の厚みはセル比3.7% = 6.66px');
  ok(Math.abs(r36.bevel - 180 * 0.022) < 1e-9, '立体感: 大セル (180px) のベベル幅はセル比2.2% = 3.96px');
  const cell2025 = 2048 / 45; // 2025ピースの実セルサイズ
  const r2025 = L.pieceRelief(cell2025);
  ok(r2025.thickness >= 1 && r2025.thickness <= cell2025 * 0.04, '立体感: 小セル (2025ピース) でも 1px 以上・セル比4%以下');
  const rSmall = L.pieceRelief(20);
  ok(rSmall.thickness > 0 && rSmall.thickness <= 20 * 0.04, '立体感: 極小セルではセル比4%以下に抑える');
  const rHuge = L.pieceRelief(1000);
  ok(rHuge.thickness <= 8 && rHuge.bevel <= 6, '立体感: 巨大セルでも厚み8px・ベベル6pxまでに制限');
  // 実在する難易度のセルサイズ全部で、ベベルが 1px 以上・セル比5%以下
  const cells = L.DIFFICULTIES.map(function (d) { return L.imageSizeFor(d) / Math.round(Math.sqrt(d)); });
  ok(cells.every(function (c) { const r = L.pieceRelief(c); return r.bevel >= 1 && r.bevel <= c * 0.05; }), '立体感: ベベルは全難易度で 1px 以上・セル比5%以下');
  // セルが小さいほど厚みも単調に小さくなる (難易度を上げて厚みが増える逆転なし)
  const sorted = cells.slice().sort(function (a, b) { return a - b; });
  let mono = true;
  for (let i = 1; i < sorted.length; i++) {
    if (L.pieceRelief(sorted[i]).thickness < L.pieceRelief(sorted[i - 1]).thickness) mono = false;
  }
  ok(mono, '立体感: 厚みはセルサイズに対して単調');
}

/* 19. BGM プレイリストの規則 (シャッフル一巡 / 短い曲は2回)
 * 再生順は順列 (全曲1回ずつ) で、一巡の継ぎ目では同じ曲が連続しない。
 * 短い曲 (90秒未満) は2回再生する。長さ不明の曲を短い扱いにすると
 * ループ条件が壊れるので、0/負/NaN は必ず「短くない」側に倒す。 */
{
  const order = L.shuffledOrder(13, L.mulberry32(12345));
  ok(order.length === 13 && eq(order.slice().sort(function (a, b) { return a - b; }), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 'シャッフル一巡: 13曲すべてをちょうど1回ずつ含む');
  ok(eq(L.shuffledOrder(13, L.mulberry32(999)), L.shuffledOrder(13, L.mulberry32(999))), 'シャッフルはシード決定的');
  ok(eq(L.shuffledOrder(0, Math.random), []), 'シャッフル: 0曲でも空配列');
  ok(eq(L.shuffledOrder(1, Math.random), [0]), 'シャッフル: 1曲だけなら [0]');
  let seamOk = true;
  for (let seed = 1; seed <= 300; seed++) {
    if (L.nextShuffleOrder(13, L.mulberry32(seed), 5)[0] === 5) seamOk = false;
  }
  ok(seamOk, 'シャッフル継ぎ目: 一巡の境で同じ曲が連続しない (300シード)');
  ok(eq(L.nextShuffleOrder(1, Math.random, 0), [0]), 'シャッフル継ぎ目: 1曲だけなら入れ替え不要で [0]');
  // 一巡ぶん再生し切ると全曲が1回ずつ流れる (UI 側の進み方の前提)
  const seen = new Set(L.nextShuffleOrder(13, L.mulberry32(7), -1));
  ok(seen.size === 13, '一巡で全曲が重複なく流れる');
  ok(L.BGM_SHORT_TRACK_SEC === 90, '短い曲の閾値は 90 秒');
  ok(L.isShortTrack(45) === true && L.isShortTrack(89.9) === true, '短い曲: 90秒未満は真');
  ok(L.isShortTrack(90) === false && L.isShortTrack(212) === false, '短い曲: 90秒以上は偽');
  ok(L.isShortTrack(0) === false && L.isShortTrack(-3) === false && L.isShortTrack(NaN) === false, '短い曲: 長さ不明 (0/負/NaN) は偽 (無限ループ防止)');
  ok(L.trackPlays(60) === 2 && L.trackPlays(89) === 2, '再生回数: 短い曲は 2 回');
  ok(L.trackPlays(90) === 1 && L.trackPlays(255) === 1 && L.trackPlays(0) === 1, '再生回数: 通常の曲と長さ不明は 1 回');
}

/* 20. ピース形状プロファイル (古典的ノブの寸法を実測で固定する)
 * 最初期の実装は「制御点を headHalf に置けば頭幅になる」という誤解で、実測
 * すると頭幅 0.13〜0.20・首は最小 0.076・付け根幅は最大 0.84 まで広がり、
 * タブが細長く垂れて見えた。5ベジェ版は頭の下にえぐれを作ったため「細い首＋
 * 笠状の頭」の二段変形 (鏡餅) になった。現行は楕円頭＋S字フィレットの単一
 * ノブで、首は頭の 0.74〜0.78 倍に保つ (2026-11-08 実機指摘)。
 * ここでは生成した辺を細密にサンプリングし、輪郭の実寸 (セル比) が古典的
 * ノブの範囲に収まることを全辺で保証する。幅は高さ方向の帯ごとに
 * 「その高さでの輪郭の横幅」を測る。 */
{
  function tabProfile(e) {
    const pts = L.sampleEdge(e, 96), s = e.sign;
    const tab = pts.map(p => ({ u: p.u, h: p.v * s })).filter(p => p.h > 0.004);
    const t = Math.max.apply(null, tab.map(p => p.h));
    const BINS = 40, widths = new Array(BINS).fill(null);
    tab.forEach(p => {
      const b = Math.min(BINS - 1, Math.floor(p.h / t * BINS));
      if (!widths[b]) widths[b] = { min: p.u, max: p.u };
      else { widths[b].min = Math.min(widths[b].min, p.u); widths[b].max = Math.max(widths[b].max, p.u); }
    });
    for (let b = 0; b < BINS; b++) { // 空ビンは隣から補間
      if (widths[b]) continue;
      let lo = b - 1; while (lo >= 0 && !widths[lo]) lo--;
      let hi = b + 1; while (hi < BINS && !widths[hi]) hi++;
      if (lo >= 0 && hi < BINS) widths[b] = { min: (widths[lo].min + widths[hi].min) / 2, max: (widths[lo].max + widths[hi].max) / 2 };
      else if (lo >= 0) widths[b] = widths[lo];
      else if (hi < BINS) widths[b] = widths[hi];
    }
    const band = (lo, hi, fn) => {
      let out = fn === 'min' ? Infinity : -Infinity;
      for (let i = 0; i < BINS; i++) {
        const ctr = (i + 0.5) / BINS;
        if (ctr < lo || ctr >= hi || !widths[i]) continue;
        const w = widths[i].max - widths[i].min;
        out = fn === 'min' ? Math.min(out, w) : Math.max(out, w);
      }
      return out;
    };
    const es = L.edgeSegments(e);
    return {
      t: t,
      neck: band(0.10, 0.55, 'min'),   // 首域 (高さ10〜55%) の最小幅
      head: band(0.55, 0.97, 'max'),   // 頭域 (高さ55〜97%) の最大幅
      base: es.segs[es.segs.length - 1].x3 - es.lineTo.u // 付け根の遷移幅 xs..xe
    };
  }
  let heightOk = true, neckOk = true, headOk = true, ratioOk = true, baseOk = true, worst = null;
  for (const pieces of [36, 100, 400, 2025]) {
    for (const date of ['2026-11-07', '2026-11-08', '2026-12-25', '2027-03-14']) {
      const edges = L.generateEdges(date, pieces);
      const all = [];
      edges.h.forEach(r => r.forEach(e => e && all.push(e)));
      edges.v.forEach(r => r.forEach(e => e && all.push(e)));
      for (const e of all) {
        const p = tabProfile(e);
        if (!(p.t >= 0.15 && p.t <= 0.25)) { heightOk = false; worst = p; }
        if (!(p.neck >= 0.15 && p.neck <= 0.20)) { neckOk = false; worst = p; }
        if (!(p.head >= 0.21 && p.head <= 0.25)) { headOk = false; worst = p; }
        if (!(p.neck >= p.head * 0.70 && p.neck <= p.head * 0.82)) { ratioOk = false; worst = p; }
        if (!(p.base >= 0.30 && p.base <= 0.38)) { baseOk = false; worst = p; }
      }
    }
  }
  const wj = worst ? ' (違反例: ' + JSON.stringify(worst) + ')' : '';
  ok(heightOk, '形状: タブ高さは全辺で 0.15〜0.25 (約20%)' + wj);
  ok(neckOk, '形状: 首幅は全辺で 0.15〜0.20 (細い首にしない)' + wj);
  ok(headOk, '形状: 頭幅は全辺で 0.21〜0.25 (丸い頭の実寸)' + wj);
  ok(ratioOk, '形状: 首は頭の 0.70〜0.82 倍 (単一ノブの比率)' + wj);
  ok(baseOk, '形状: 付け根の遷移幅は全辺で 0.30〜0.38 (裾を広げすぎない)' + wj);
}

/* 21. ピース形状プロファイルの単峰性 (二段変形の再発防止)
 * 5ベジェ版は「細い首の上に笠状の頭が乗る」二段変形になり、幅プロファイルに
 * 首と頭の間に余分な極小・極大が現れた。現行仕様では、幅プロファイルは
 * 有効域 (高さ10%以上) で「付け根から首まで単調減少 → 頭まで単調増加 →
 * 頂まで単調減少」の3区間だけからなり、極小は首の1回・極大は頭の1回だけ。
 * ノブ曲線だけの点列 (直線部の点を除く) で測る。頭/首比もここで固定する。 */
{
  function knobProfile(e) {
    const ptsAll = L.sampleEdge(e, 96), s = e.sign;
    const pts = ptsAll.slice(2, ptsAll.length - 1); // 直線部の2点と終点を除いたノブ曲線のみ
    const tab = pts.map(p => ({ u: p.u, h: p.v * s })).filter(p => p.h > 0.004);
    const t = Math.max.apply(null, tab.map(p => p.h));
    const BINS = 40, widths = new Array(BINS).fill(null);
    tab.forEach(p => {
      const b = Math.min(BINS - 1, Math.floor(p.h / t * BINS));
      if (!widths[b]) widths[b] = { min: p.u, max: p.u };
      else { widths[b].min = Math.min(widths[b].min, p.u); widths[b].max = Math.max(widths[b].max, p.u); }
    });
    for (let b = 0; b < BINS; b++) { // 空ビンは隣から補間
      if (widths[b]) continue;
      let lo = b - 1; while (lo >= 0 && !widths[lo]) lo--;
      let hi = b + 1; while (hi < BINS && !widths[hi]) hi++;
      if (lo >= 0 && hi < BINS) widths[b] = { min: (widths[lo].min + widths[hi].min) / 2, max: (widths[lo].max + widths[hi].max) / 2 };
      else if (lo >= 0) widths[b] = widths[lo];
      else if (hi < BINS) widths[b] = widths[hi];
    }
    const w = widths.map(x => x.max - x.min);
    let startIdx = 0; while ((startIdx + 0.5) / BINS < 0.10) startIdx++;
    let neckIdx = startIdx, neckMin = Infinity;
    for (let i = startIdx; i < BINS; i++) { if ((i + 0.5) / BINS < 0.60 && w[i] < neckMin) { neckMin = w[i]; neckIdx = i; } }
    let headIdx = neckIdx, headMax = -Infinity;
    for (let i = neckIdx; i < BINS; i++) if (w[i] > headMax) { headMax = w[i]; headIdx = i; }
    const TOL = 0.01;
    let uni = headIdx > neckIdx;
    for (let i = startIdx; i < neckIdx && uni; i++) if (w[i + 1] > w[i] + TOL) uni = false;
    for (let i = neckIdx; i < headIdx && uni; i++) if (w[i + 1] < w[i] - TOL) uni = false;
    for (let i = headIdx; i < BINS - 1 && uni; i++) if (w[i + 1] > w[i] + TOL) uni = false;
    return { uni: uni, ratio: headMax / neckMin, neckIdx: neckIdx, headIdx: headIdx };
  }
  let uniOk = true, ratioOk = true, worst = null;
  for (const pieces of [36, 100, 400, 2025]) {
    for (const date of ['2026-11-07', '2026-11-08', '2026-12-25', '2027-03-14']) {
      const edges = L.generateEdges(date, pieces);
      const all = [];
      edges.h.forEach(r => r.forEach(e => e && all.push(e)));
      edges.v.forEach(r => r.forEach(e => e && all.push(e)));
      for (const e of all) {
        const p = knobProfile(e);
        if (!p.uni) { uniOk = false; worst = p; }
        if (!(p.ratio >= 1.2 && p.ratio <= 1.45)) { ratioOk = false; worst = p; }
      }
    }
  }
  const wj = worst ? ' (違反例: ' + JSON.stringify(worst) + ')' : '';
  ok(uniOk, '形状: 幅プロファイルは全辺で単峰 (極小は首1回・極大は頭1回、二段変形なし)' + wj);
  ok(ratioOk, '形状: 頭/首比は全辺で 1.2〜1.45' + wj);
}

/* 22. 辺の端点と角の一致 (バリの再発防止)
 * 旧実装は edgeSegments の端点を (0, s*a) / (1, s*e) とし、辺の端点自体が
 * ジッター分ずれていたため、角で横辺の終端と縦辺の始端が一致せず輪郭に
 * 段差 (バリ) が残った (実測: 角の接続ギャップ最大 0.063・中央値 0.035)。
 * 端点は角 (0,0)/(1,0) に完全一致し、組み立てた輪郭の角接続も完全一致する
 * こと、そして輪郭ポリゴンが自己交差しないことを全数で保証する。 */
{
  const seedSets = [
    ['2026-11-07', 36], ['2026-11-08', 36], ['2026-11-08', 100],
    ['2026-12-25', 400], ['2027-03-14', 2025]
  ];
  // (1) 全辺で sampleEdge の始点 (0,0)・終点 (1,0) に完全一致
  let endOk = true, totalEdges = 0;
  for (const [date, pieces] of seedSets) {
    const edges = L.generateEdges(date, pieces);
    const all = [];
    edges.h.forEach(r => r.forEach(e => e && all.push(e)));
    edges.v.forEach(r => r.forEach(e => e && all.push(e)));
    for (const e of all) {
      totalEdges++;
      const pts = L.sampleEdge(e, 8);
      const f = pts[0], l = pts[pts.length - 1];
      if (!(f.u === 0 && f.v === 0 && l.u === 1 && l.v === 0)) endOk = false;
    }
  }
  ok(endOk, 'バリ: 全辺 (' + totalEdges + ' 本) で sampleEdge の始点=(0,0)・終点=(1,0) に完全一致');
  // (2) セル輪郭の角接続が完全一致 (辺の終点 === 次の辺の始点、盤端含む)
  let cornerOk = true, totalCorners = 0, worstGap = 0;
  const sideNames = ['top', 'right', 'bottom', 'left'];
  for (const [date, pieces] of seedSets) {
    const edges = L.generateEdges(date, pieces), n = edges.n;
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
      const sp = sideNames.map(s => L.sideSamples(edges, col, row, s, 8));
      for (let k = 0; k < 4; k++) {
        totalCorners++;
        const eP = sp[k][sp[k].length - 1], sP = sp[(k + 1) % 4][0];
        const gap = Math.hypot(eP.x - sP.x, eP.y - sP.y);
        if (gap > worstGap) worstGap = gap;
        if (gap !== 0) cornerOk = false;
      }
    }
  }
  ok(cornerOk, 'バリ: 全セル角 (' + totalCorners + ' 箇所) で接続ギャップ = 0 (最大 ' + worstGap + ')');
  // (3) 輪郭ポリゴンの自己交差なし (非隣接セグメント同士の交差を全数チェック)
  function segInt(p1, p2, p3, p4) {
    const d1 = (p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x);
    const d2 = (p4.x - p3.x) * (p2.y - p3.y) - (p4.y - p3.y) * (p2.x - p3.x);
    const d3 = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
    const d4 = (p2.x - p1.x) * (p4.y - p1.y) - (p2.y - p1.y) * (p4.x - p1.x);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  function outlineSelfIntersects(pts) {
    const m = pts.length;
    for (let i = 0; i < m; i++) {
      for (let j = i + 2; j < m; j++) {
        if (i === 0 && j === m - 1) continue; // 周回で隣接
        if (segInt(pts[i], pts[(i + 1) % m], pts[j], pts[(j + 1) % m])) return true;
      }
    }
    return false;
  }
  let crossOk = true, checkedCells = 0;
  for (const [date, pieces] of [['2026-11-07', 36], ['2026-11-08', 100], ['2026-12-25', 400]]) {
    const edges = L.generateEdges(date, pieces), n = edges.n;
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
      checkedCells++;
      if (outlineSelfIntersects(L.pieceOutlinePoints(edges, col, row, 8))) crossOk = false;
    }
  }
  ok(crossOk, 'バリ: 輪郭ポリゴンに自己交差なし (' + checkedCells + ' セル全数)');
}

console.log('\n結果: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
