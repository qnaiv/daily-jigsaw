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

/* 7. 初期散らばり配置 (ぶちまけた状態: ベースセル + ±0.4セルのずらし + z-order シャッフル) */
{
  const s1 = L.initialScatter('2026-11-07', 100);
  const s2 = L.initialScatter('2026-11-07', 100);
  ok(eq(s1, s2), '散らばり: 同じ日付×難易度で配置が完全一致 (決定的)');
  ok(s1.length === 100 && new Set(s1.flatMap(c => c.pieces)).size === 100, '散らばり: 全ピースがちょうど1回ずつ現れる');
  ok(s1.every(c => c.surface === 'desk' && c.pieces.length === 1), '散らばり: 全ピースが机の上に単体で置かれる');
  ok(new Set(s1.map(c => Math.round(c.gx) + ',' + Math.round(c.gy))).size === 100, '散らばり: ベースセルは重ならない (重なりは部分的なずらしだけ)');
  const jittered = s1.filter(c => Math.abs(c.gx - Math.round(c.gx)) > 0.05 || Math.abs(c.gy - Math.round(c.gy)) > 0.05).length;
  ok(jittered >= 50, '散らばり: 過半数のピースに「ぶちまけた」位置ずらしが入っている (' + jittered + '/100)');
  ok(s1.every(c => Math.abs(c.gx - Math.round(c.gx)) <= 0.4 + 1e-9 && Math.abs(c.gy - Math.round(c.gy)) <= 0.4 + 1e-9), '散らばり: ずらしは±0.4セル以内');
  const n = 10;
  ok(s1.every(c => c.gx >= -3 && c.gx <= n + 2 && c.gy >= -1 && c.gy < n + 3), '散らばり: 机ビューの範囲内に収まる (画面外に出ない)');
  const idsInOrder = s1.map(c => c.pieces[0]);
  ok(!eq(idsInOrder, idsInOrder.slice().sort((a, b) => a - b)), '散らばり: 重なり順 (z-order) がシャッフルされている');
  ok(!eq(s1, L.initialScatter('2026-11-08', 100)), '散らばり: 日付が変わると配置も変わる');
  ok(!eq(s1, L.initialScatter('2026-11-07', 225)), '散らばり: 難易度が変わると配置も変わる');
  const sBig = L.initialScatter('2026-11-07', 2025);
  ok(sBig.length === 2025 && new Set(sBig.map(c => Math.round(c.gx) + ',' + Math.round(c.gy))).size === 2025, '散らばり: 2025ピースでもベースセルは重ならず全ピース出る');
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
  // 散らばり (n=6)
  const s36 = L.initialScatter('2026-11-07', 36);
  ok(s36.length === 36 && new Set(s36.map(c => Math.round(c.gx) + ',' + Math.round(c.gy))).size === 36, '36ピース: 散らばりはベースセルが重ならず全ピース机に出る');
}

console.log('\n結果: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
