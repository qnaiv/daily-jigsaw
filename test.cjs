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
  ok(L.resolvePlayDate('2999-01-01', '2026-11-07') === '2026-11-07', '未来日は今日にクランプ');
  ok(L.resolvePlayDate('2026-11-01', '2026-11-07') === '2026-11-01', '過去日はそのまま');
  ok(L.resolvePlayDate('garbage', '2026-11-07') === '2026-11-07', '不正な日付は今日にクランプ');
  ok(L.resolvePlayDate('2026-02-30', '2026-11-07') === '2026-11-07', '実在しない日付は今日にクランプ');
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

console.log('\n結果: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
