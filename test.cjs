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

/* 4. 完成判定 (全部が1つの塊になった瞬間が完成。位置は問わない) */
{
  const n = 10, pieces = 100;
  const allIds = [];
  for (let id = 0; id < pieces; id++) allIds.push(id);
  ok(L.isComplete([{ pieces: allIds, surface: 'desk', gx: 3, gy: -2 }], n) === true, '全ピースが1つの塊なら完成 (場所はどこでも)');
  const singles = allIds.map(id => ({ pieces: [id], surface: 'desk', gx: 0, gy: 0 }));
  ok(L.isComplete(singles, n) === false, 'バラバラでは未完成');
  const two = [{ pieces: allIds.slice(0, 50), surface: 'desk', gx: 0, gy: 0 }, { pieces: allIds.slice(50), surface: 'desk', gx: 5, gy: 0 }];
  ok(L.isComplete(two, n) === false, '2つの塊では未完成');
  ok(L.isComplete([{ pieces: allIds.slice(1), surface: 'desk', gx: 0, gy: 0 }], n) === false, '1つ欠けた塊は未完成');
  ok(L.isComplete([], n) === false, '塊ゼロは未完成');
}

/* 5. 日付 → お題エントリが決定的 (厳選プール: picsum + URL エントリ混在) */
{
  const pool = JSON.parse(require('fs').readFileSync(__dirname + '/data/images.json', 'utf8'));
  const entries = L.poolEntries(pool);
  ok(pool.baseDate === '2026-11-07' && entries.length === 758, 'images.json: 基準日と 758 件のエントリ (picsum 365 + URL 393)');
  ok(entries.filter(e => e.type === 'picsum').length === 365, 'プール: picsum エントリ 365 件');
  const urls = entries.filter(e => e.type === 'url');
  ok(urls.length === 393 && urls.every(e => e.fullUrl && e.thumbUrl && e.source && e.license), 'プール: URL エントリ 393 件に URL/出典/ライセンスがある');
  ok(urls.filter(e => e.license.indexOf('CC BY') === 0).length === 122 && urls.filter(e => e.license.indexOf('CC BY') === 0).every(e => e.attribution), 'プール: CC BY 122 件は全て attribution 付き');
  ok(L.pickPoolEntry('2026-11-07', pool) === entries[0], '基準日 → entries[0]');
  ok(L.pickPoolEntry('2026-11-08', pool) === entries[1], '基準日+1 → entries[1]');
  ok(L.pickPoolEntry('2026-11-07', pool) === L.pickPoolEntry('2026-11-07', pool), '同じ日付では常に同じエントリ');
  const wrap = L.addDays('2026-11-07', entries.length);
  ok(L.pickPoolEntry(wrap, pool) === entries[0], 'プール一周で entries[0] に戻る');
  ok(L.pickPoolEntry('2026-11-06', pool) === entries[entries.length - 1], '基準日前日 → entries[末尾]');
  // 安定キーと往復解決
  ok(L.poolEntryKey({ type: 'picsum', id: 42 }) === 'p42' && L.poolEntryKey(urls[0]) === 'u' + urls[0].key, '安定キー: picsum=p{id} / URL=u{key}');
  ok(L.poolEntryByKey(pool, L.poolEntryKey(urls[0])) === urls[0], 'キーから URL エントリを引ける');
  ok(L.poolEntryByKey(pool, 'p' + entries.find(e => e.type === 'picsum').id).type === 'picsum', 'キーから picsum エントリを引ける');
  ok(L.poolEntryByKey(pool, 'u99999') === null && L.poolEntryByKey(pool, null) === null, '未知のキーは null');
  // URL 解決規則
  ok(L.entryPhotoUrl({ type: 'picsum', id: 7 }, 640) === 'https://picsum.photos/id/7/640/640', 'picsum はサイズ別 URL');
  ok(L.entryPhotoUrl(urls[0], 1080) === urls[0].fullUrl && L.entryThumbUrl(urls[0]) === urls[0].thumbUrl, 'URL エントリは fullUrl / thumbUrl を使う');
  ok(L.entryThumbUrl({ type: 'picsum', id: 7 }) === 'https://picsum.photos/id/7/400/400', 'picsum サムネイルは 400px');
  // 記録キーの互換: 旧・数値 imageId のみの記録も 'p{id}' として読める
  ok(L.recordImageKey({ imageId: 123 }) === 'p123', '旧記録: 数値 imageId → p123');
  ok(L.recordImageKey({ imageId: 123, imageKey: 'u28' }) === 'u28', '新記録: imageKey が優先');
  ok(L.recordImageKey({}) === null && L.recordImageKey(null) === null, 'キーなし記録は null');
  // 旧形式 { ids } のプールも読める (互換)
  const legacy = { baseDate: '2026-11-07', ids: [10, 20, 30] };
  ok(L.pickImageId('2026-11-08', legacy) === 20 && L.pickPoolEntry('2026-11-07', legacy).id === 10, '旧形式プールも互換読みできる');
  ok(L.pickImageId('2026-11-07', pool) === (entries[0].type === 'picsum' ? entries[0].id : null), 'pickImageId は picsum のときだけ ID を返す');
  // 過去の 2025 ピース記録も形状生成・詳細描画が落ちない (難易度リスト外でも動く)
  const e2025 = L.generateEdges('2026-11-07', 2025);
  ok(e2025 && L.detailRenderPlan(2025).sizePx > 0, '互換: 2025ピースの記録も辺生成・詳細プランが動く');
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
  ok(!!L.findRelativeSnap(otherSurface, [a], n), '面の概念なし: surface 値が違ってもくっつく');
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
  ok(L.BOX_PATTERNS.length === 20, '箱の包装柄は20種');
  ok(L.boxPatternForDate('2026-11-07').id === L.boxPatternForDate('2026-11-07').id, '箱の柄: 同じ日付で常に同じ柄');
  const seen = new Set();
  for (let d = 0; d < L.BOX_PATTERNS.length; d++) seen.add(L.boxPatternForDate(L.addDays('2026-11-07', d)).id);
  ok(seen.size === L.BOX_PATTERNS.length, '箱の柄: 連続20日で20柄すべてが順に現れる');
  ok(L.boxPatternForDate(L.addDays('2026-11-07', L.BOX_PATTERNS.length)).id === L.boxPatternForDate('2026-11-07').id, '箱の柄: 一周 (20日) で同じ柄へ戻る (ローテーション)');
  ok(L.boxPatternForDate('2026-11-06').id === L.BOX_PATTERNS[L.BOX_PATTERNS.length - 1].id, '箱の柄: 基準日前日は末尾の柄 (負の日数でも決定的)');
  // グループ指定: 同じ日でもグループごとに別の柄、ペア内は同じ、翌日は全グループ変わる
  ok(L.boxPatternIndex('2026-11-07', 0) === 0 && L.boxPatternIndex('2026-11-07', 1) === 1 && L.boxPatternIndex('2026-11-07', 2) === 2, '箱の柄 (グループ): 基準日はグループ 0/1/2 で別の柄');
  const g0 = L.boxPatternForDate('2026-11-08', 0), g1 = L.boxPatternForDate('2026-11-08', 1), g2 = L.boxPatternForDate('2026-11-08', 2);
  ok(g0.id !== g1.id && g1.id !== g2.id && g0.id !== g2.id, '箱の柄 (グループ): 同日の3グループが互いに異なる柄');
  ok(L.boxPatternForDate('2026-11-08', L.difficultyGroup(16)).id === L.boxPatternForDate('2026-11-08', L.difficultyGroup(36)).id, '箱の柄 (グループ): ペア内 (16と36) は同じ柄');
  ok(L.boxPatternForDate('2026-11-08', 1) === L.boxPatternForDate('2026-11-08', 1), '箱の柄 (グループ): 同日・同グループは決定的');
  ok([0, 1, 2].every(g => L.boxPatternForDate(L.addDays('2026-11-08', 1), g).id !== L.boxPatternForDate('2026-11-08', g).id), '箱の柄 (グループ): 翌日は全グループの柄が変わる');
  ok(L.boxPatternIndex('2026-11-08') === 1 && L.boxPatternIndex('2026-11-06') === L.BOX_PATTERNS.length - 1, '箱の柄 (グループ省略): 従来の日付のみ選択と一致 (旧挙動不変)');
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
  ok(L.DIFFICULTIES.length === 7 && L.DIFFICULTIES[0] === 16 && L.DIFFICULTIES[1] === 36 && L.DIFFICULTIES[6] === 1024 && !L.DIFFICULTIES.includes(2025) && !L.DIFFICULTIES.includes(784) && !L.DIFFICULTIES.includes(1225), '難易度は7段階: 16/64/1024追加・2025/784/1225廃止・デフォルト36');
  const e1 = L.generateEdges('2026-11-07', 36);
  const e2 = L.generateEdges('2026-11-07', 36);
  ok(e1.n === 6, '36ピースは 6×6 グリッド');
  ok(eq(e1.h, e2.h) && eq(e1.v, e2.v), '36ピース: 同じ日付で辺形状が完全一致');
  const e3 = L.generateEdges('2026-11-08', 36);
  ok(!eq(e1.h, e3.h), '36ピース: 日付が変わると辺形状も変わる');
  // 完成判定 (n=6): 全部が1つの塊になったときだけ完成
  const n = 6, pieces = 36;
  const ids36 = [];
  for (let id = 0; id < pieces; id++) ids36.push(id);
  ok(L.isComplete([{ pieces: ids36, surface: 'desk', gx: 0, gy: 0 }], n) === true, '36ピース: 全ピースが1つの塊で完成判定 = 真');
  ok(L.isComplete(ids36.map(id => ({ pieces: [id], surface: 'desk', gx: 0, gy: 0 })), n) === false, '36ピース: バラバラでは完成判定 = 偽');
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
  const c4 = { pieces: [3], surface: 'mat', gx: 2, gy: 2 };            // c1 と同じ位置 (旧マット側の値)
  const all = [c1, c2, c3, c4];
  ok(eq(L.clustersInRect(all, n, { x0: 1.5, y0: 1.5, x1: 2.5, y1: 2.5 }), [c1, c4]), '範囲選択: 矩形と交差したピースの塊が選ばれる');
  ok(eq(L.clustersInRect(all, n, { x0: 3, y0: 2, x1: 4, y1: 3 }), []), '範囲選択: 辺だけ接する矩形は交差とみなさない');
  ok(eq(L.clustersInRect(all, n, { x0: 7.5, y0: 0.5, x1: 8.5, y1: 1.5 }), [c3]), '範囲選択: 塊の1ピースでも交差すれば塊全体が選ばれる');
  ok(eq(L.clustersInRect(all, n, { x0: 5.5, y0: 5.5, x1: 9, y1: 9 }), [c2]), '範囲選択: 部分的な重なりでも選ばれる');
  ok(L.clustersInRect(all, n, { x0: -10, y0: -10, x1: 20, y1: 20 }).length === 4, '範囲選択: 全面が対象 (面の絞り込みなし)');
  // --- nearestClusterByCellDist (掴みの吸着 #3 B2): セル矩形への最短距離で最も近い塊を選ぶ ---
  const sA = { pieces: [0], surface: 'desk', gx: 2, gy: 2 };        // 矩形 [2,3]×[2,3]
  const sB = { pieces: [55], surface: 'desk', gx: 5, gy: 5 };       // 矩形 [5,6]×[5,6]
  const sM = { pieces: [11, 12], surface: 'desk', gx: 7, gy: 1 };   // 11が(7,1)、12が(8,1)
  const sAll = [sA, sB, sM];
  const near1 = L.nearestClusterByCellDist(sAll, n, 2.5, 2.5, 0.16, null);
  ok(near1 && near1.cluster === sA && near1.pieceId === 0 && near1.dist === 0, '吸着: セル矩形の中なら距離0でその塊を選ぶ');
  const near2 = L.nearestClusterByCellDist(sAll, n, 3.1, 2.5, 0.16, null);
  ok(near2 && near2.cluster === sA && approx(near2.dist, 0.1), '吸着: 矩形の外でも上限以内なら最も近い塊を選ぶ');
  ok(L.nearestClusterByCellDist(sAll, n, 3.2, 2.5, 0.16, null) === null, '吸着: 上限 (画面16px相当) を超えたら選ばない');
  const near4 = L.nearestClusterByCellDist(sAll, n, 8.5, 2.1, 0.16, null);
  ok(near4 && near4.cluster === sM && near4.pieceId === 12, '吸着: 複数ピースの塊では最も近いピースを返す');
  const sC = { pieces: [3], surface: 'desk', gx: 3, gy: 2 };        // 矩形 [3,4]×[2,3] (sA と辺を共有)
  const tie1 = L.nearestClusterByCellDist([sA, sC], n, 3, 2.5, 0.16, null);
  ok(tie1 && tie1.cluster === sC, '吸着: 同点では最前面 (配列の後方) を優先する');
  const tie2 = L.nearestClusterByCellDist([sC, sA], n, 3, 2.5, 0.16, null);
  ok(tie2 && tie2.cluster === sA, '吸着: 同点の優先は並び順 (最前面) に従う');
  ok(L.nearestClusterByCellDist(sAll, n, 2.5, 2.5, 0.16, function (cl) { return cl === sA; }) === null,
     '吸着: exclude された塊は候補から外れる (MP の他人リース中)');
  ok(L.nearestClusterByCellDist([], n, 0, 0, 0.16, null) === null, '吸着: 塊が無ければ null');
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

/* 17. 机背景の世界空間キャッシュ (deskBgRegionCells / deskBgPlan / deskBgBlit)
 * キャッシュはカメラに依存しない世界空間で作り、毎フレームは部分転写だけ。
 * 転写は「整数アラインしたソース矩形 + 等倍率デスト矩形」で、引き伸ばしや
 * 潰れ (異方スケール) が構造的に起こらないことをここで保証する。
 * 範囲を出たカメラでは null → 直接描画にフォールバックする。 */
{
  const CELLT = 100;
  // 範囲: どのステージでも「最小ズームで見える範囲 (散らばり中心)」を覆う
  for (const pieces of [36, 100, 2025]) {
    const s = L.scatterRect(pieces);
    for (const [W, H] of [[412, 915], [800, 600], [2560, 1440]]) {
      const r = L.deskBgRegionCells(pieces, W, H, CELLT);
      const fit = Math.min(W / (s.w * CELLT), H / (s.h * CELLT));
      const visW = 2 * W / (fit * CELLT), visH = 2 * H / (fit * CELLT);
      const cx = s.x0 + s.w / 2, cy = s.y0 + s.h / 2;
      ok(r.x0 <= cx - visW / 2 + 1e-9 && r.y0 <= cy - visH / 2 + 1e-9 &&
         r.x0 + r.w >= cx + visW / 2 - 1e-9 && r.y0 + r.h >= cy + visH / 2 - 1e-9,
        '背景範囲: 最小ズームの表示範囲を覆う (' + pieces + 'ピース, ' + W + 'x' + H + ')');
      ok(r.x0 <= s.x0 && r.y0 <= s.y0 && r.x0 + r.w >= s.x0 + s.w && r.y0 + r.h >= s.y0 + s.h,
        '背景範囲: 散らばり領域を内包する (' + pieces + 'ピース, ' + W + 'x' + H + ')');
      ok(eq(L.deskBgRegionCells(pieces, W, H, CELLT), r), '背景範囲: 決定的 (' + pieces + 'ピース, ' + W + 'x' + H + ')');
    }
  }
  // 計画: 全難易度 (縦長ステージ = 最大範囲) で最大寸法・最大面積に収まる
  const MAXD = 4096, MAXA = 8388608;
  for (const pieces of L.DIFFICULTIES) {
    const rc = L.deskBgRegionCells(pieces, 412, 915, CELLT);
    const plan = L.deskBgPlan(rc.w * CELLT, rc.h * CELLT, MAXD, MAXA);
    ok(!!plan, '背景計画: 生成できる (' + pieces + 'ピース)');
    ok(plan.wPx <= MAXD && plan.hPx <= MAXD, '背景計画: 最大寸法に収まる (' + pieces + 'ピース)');
    ok(plan.wPx * plan.hPx <= MAXA * 1.01, '背景計画: 最大面積にほぼ収まる (' + pieces + 'ピース, ' + plan.wPx + 'x' + plan.hPx + ')');
    ok(plan.R > 0 && plan.R <= 1.5, '背景計画: 解像度は 0〜1.5 px/単位 (' + pieces + 'ピース, R=' + plan.R.toFixed(3) + ')');
  }
  ok(L.deskBgPlan(0, 100, MAXD, MAXA) === null && L.deskBgPlan(100, -5, MAXD, MAXA) === null, '背景計画: 不正な範囲では null');
  ok(L.deskBgPlan(1e9, 1e9, MAXD, MAXA) === null, '背景計画: 解像度が細かすぎる場合は null (キャッシュしない)');
  // 転写: fit カメラ (散らばり領域がちょうど画面に収まる) では必ず成功し、
  // 等倍率・ソース範囲内・画面を覆う矩形が返る
  const CELL = 100;
  const stageW = 800, stageH = 600;
  const rc = L.deskBgRegionCells(36, stageW, stageH, CELL);
  const region = { x0: rc.x0 * CELL, y0: rc.y0 * CELL, w: rc.w * CELL, h: rc.h * CELL };
  const plan = L.deskBgPlan(region.w, region.h, MAXD, MAXA);
  const s = L.scatterRect(36);
  const fit = Math.min(stageW / (s.w * CELL), stageH / (s.h * CELL));
  const vFit = { scale: fit, fit: fit, tx: (stageW - s.w * CELL * fit) / 2 - s.x0 * CELL * fit, ty: (stageH - s.h * CELL * fit) / 2 - s.y0 * CELL * fit };
  const b = L.deskBgBlit(vFit, stageW, stageH, region, plan);
  ok(!!b, '背景転写: fit カメラで転写できる');
  ok(Number.isInteger(b.sx) && Number.isInteger(b.sy) && Number.isInteger(b.sw) && Number.isInteger(b.sh), '背景転写: ソース矩形は整数アライン');
  ok(b.sx >= 0 && b.sy >= 0 && b.sx + b.sw <= plan.wPx && b.sy + b.sh <= plan.hPx, '背景転写: ソース矩形はキャッシュ範囲内');
  ok(Math.abs(b.dw / b.sw - b.dh / b.sh) < 1e-9, '背景転写: 横と縦の倍率が一致 (引き伸ばし/潰れなし)');
  ok(Math.abs(b.dw / b.sw - vFit.scale / plan.R) < 1e-9, '背景転写: 倍率はカメラ/R に一致');
  ok(b.dx <= 0.5 && b.dy <= 0.5 && b.dx + b.dw >= stageW - 0.5 && b.dy + b.dh >= stageH - 0.5, '背景転写: 画面全体を覆う');
  // 最小ズーム (fit×0.5, 中心同じ) でも覆える
  const vMin = { scale: fit * 0.5, tx: stageW / 2 - (s.x0 + s.w / 2) * CELL * fit * 0.5, ty: stageH / 2 - (s.y0 + s.h / 2) * CELL * fit * 0.5 };
  ok(!!L.deskBgBlit(vMin, stageW, stageH, region, plan), '背景転写: 最小ズームでもキャッシュ範囲内');
  // ズームイン (fit×4) でも転写でき、ソース矩形は小さくなる
  const vMax = { scale: fit * 4, tx: stageW / 2 - (s.x0 + s.w / 2) * CELL * fit * 4, ty: stageH / 2 - (s.y0 + s.h / 2) * CELL * fit * 4 };
  const bMax = L.deskBgBlit(vMax, stageW, stageH, region, plan);
  ok(!!bMax && bMax.sw < b.sw, '背景転写: ズームインではソース矩形が狭まる');
  // 範囲外へ大きくパンしたら null (直接描画フォールバック)
  const vFar = { scale: fit, tx: vFit.tx + region.w * fit * 2, ty: vFit.ty };
  ok(L.deskBgBlit(vFar, stageW, stageH, region, plan) === null, '背景転写: キャッシュ範囲外のカメラでは null');
  ok(L.deskBgBlit(null, stageW, stageH, region, plan) === null && L.deskBgBlit(vFit, 0, stageH, region, plan) === null, '背景転写: 不正な入力では null');
}

/* 17b. ピースビットマップの健全性チェック (bitmapProbeOk / bitmapRetryPlan)
 * 写真面は必ず不透明なので、中心 alpha が全滅ならビットマップ異常。
 * 異常を恒常キャッシュしないための作り直しポリシーを固定する。 */
{
  ok(L.bitmapProbeOk([0, 0, 0, 0]) === false, 'プローブ: alpha がすべて0なら異常');
  ok(L.bitmapProbeOk([0, 0, 255, 0]) === true, 'プローブ: 1つでも不透明なら正常');
  ok(L.bitmapProbeOk([1]) === true, 'プローブ: わずかな alpha でも正常扱い');
  ok(L.bitmapProbeOk([]) === false && L.bitmapProbeOk(null) === false && L.bitmapProbeOk(undefined) === false, 'プローブ: サンプルなしは異常扱い');
  ok(eq(L.bitmapRetryPlan(0), { retryNow: true, giveUp: false }), '再試行: 失敗0回は即作り直し');
  ok(eq(L.bitmapRetryPlan(1), { retryNow: true, giveUp: false }), '再試行: 失敗1回目も即作り直し');
  ok(eq(L.bitmapRetryPlan(2), { retryNow: false, giveUp: false }), '再試行: 失敗2回目はキャッシュせず次回再試行');
  ok(eq(L.bitmapRetryPlan(3), { retryNow: false, giveUp: false }), '再試行: 失敗3回目もキャッシュしない');
  ok(eq(L.bitmapRetryPlan(4), { retryNow: false, giveUp: true }), '再試行: 失敗4回で諦めてキャッシュ (再生成ループ防止)');
  ok(eq(L.bitmapRetryPlan(99), { retryNow: false, giveUp: true }), '再試行: それ以上の失敗でも諦める');
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

/* 23. BGM クロスフェードの純粋ロジック (等パワー曲線とフェード長) */
{
  ok(L.BGM_FADE_SEC === 3, 'クロスフェード: 既定のフェード長は 3 秒');
  const c0 = L.crossfadeCurve(0), c1 = L.crossfadeCurve(1), cm = L.crossfadeCurve(0.5);
  ok(Math.abs(c0.out - 1) < 1e-9 && c0.in === 0, 'クロスフェード: t=0 で前曲のみ');
  ok(Math.abs(c1.in - 1) < 1e-9 && Math.abs(c1.out) < 1e-9, 'クロスフェード: t=1 で次曲のみ');
  ok(Math.abs(cm.out * cm.out + cm.in * cm.in - 1) < 1e-9, 'クロスフェード: 中点でも等パワー (out^2+in^2=1)');
  let mono = true, prev = 2;
  for (let t = 0; t <= 1.0001; t += 0.05) { const c = L.crossfadeCurve(t); if (c.out > prev + 1e-9) mono = false; prev = c.out; }
  ok(mono, 'クロスフェード: 前曲ゲインは単調減少');
  const cc = L.crossfadeCurve(7); // 範囲外はクランプ
  ok(Math.abs(cc.in - 1) < 1e-9, 'クロスフェード: t>1 は 1 にクランプ');
  ok(L.crossfadeDuration(200) === 3, 'フェード長: 長い曲は上限 3 秒');
  ok(L.crossfadeDuration(8) === 2, 'フェード長: 8 秒の曲は 1/4 = 2 秒');
  ok(L.crossfadeDuration(1) === 0 && L.crossfadeDuration(NaN) === 0, 'フェード長: 極端に短い/不明な曲はフェードなし');
}

/* BGM 同期 (マルチプレイ) の時間軸: 共有シードで全端末が同じ曲順になり、
 * 「開始からの経過秒 → 現在の曲と位置」が純関数で一致する。区間長は
 * ローカル再生の進み方 (短い曲は2回・末尾はフェードぶん前倒し) と一致
 * させる。途中参加・途中オン・タブ復帰はこの計算で合流する */
{
  const SECS13 = [212.8, 249.1, 255.2, 215.3, 134.8, 169.7, 194.8, 207.0, 192.0, 153.5, 164.0, 130.2, 133.4];
  // 区間長
  ok(Math.abs(L.bgmSegmentSec(212.8) - 209.8) < 1e-9, 'BGM同期: 区間長は曲長 − フェード (長い曲)');
  ok(L.bgmSegmentSec(60) === 117, 'BGM同期: 短い曲の区間は 2 回ぶん − フェード');
  ok(L.bgmSegmentSec(1.5) === 3, 'BGM同期: フェードできない極短曲は 2 回ぶんそのまま');
  ok(L.bgmSegmentSec(0) === 0 && L.bgmSegmentSec(-5) === 0 && L.bgmSegmentSec(NaN) === 0, 'BGM同期: 長さ不明の区間は 0');
  // 曲順の決定性 (同じシード → 全端末で同じ曲順)
  ok(eq(L.bgmCycleOrder(13, 42, 0), L.bgmCycleOrder(13, 42, 0)), 'BGM同期: 同じシードの0周目は一致する');
  ok(eq(L.bgmCycleOrder(13, 42, 3), L.bgmCycleOrder(13, 42, 3)), 'BGM同期: 同じシードの3周目も一致する');
  ok(!eq(L.bgmCycleOrder(13, 42, 0), L.bgmCycleOrder(13, 43, 0)), 'BGM同期: シードが違えば曲順も変わる');
  let permOk = true, seamOk2 = true;
  for (let seed = 1; seed <= 60; seed++) {
    for (let c = 0; c < 4; c++) {
      const o = L.bgmCycleOrder(13, seed, c);
      if (o.length !== 13 || new Set(o).size !== 13) permOk = false;
      if (c > 0 && L.bgmCycleOrder(13, seed, c - 1)[12] === o[0]) seamOk2 = false;
    }
  }
  ok(permOk, 'BGM同期: どの周も全曲1回ずつの順列 (60シード×4周)');
  ok(seamOk2, 'BGM同期: 一巡の継ぎ目で同じ曲が連続しない (60シード×4周)');
  ok(eq(L.bgmCycleOrder(1, 42, 5), [0]), 'BGM同期: 1曲だけなら常に [0]');
  // 時間軸: 先頭と境界
  const ord0 = L.bgmCycleOrder(13, 42, 0);
  const t0 = L.bgmTimelineAt(SECS13, 42, 0);
  ok(t0.index === ord0[0] && t0.offset === 0 && t0.cycle === 0 && t0.cyclePos === 0 && t0.seqPos === 0, 'BGM同期: 経過0は1曲目の頭');
  const seg0 = L.bgmSegmentSec(SECS13[ord0[0]]);
  const tMid = L.bgmTimelineAt(SECS13, 42, seg0 / 2);
  ok(tMid.index === ord0[0] && Math.abs(tMid.offset - seg0 / 2) < 1e-9, 'BGM同期: 区間の中ほどは同じ曲の途中');
  const tNext = L.bgmTimelineAt(SECS13, 42, seg0);
  ok(tNext.index === ord0[1] && tNext.offset === 0 && tNext.cyclePos === 1, 'BGM同期: 区間の境目は次曲の頭');
  const tNeg = L.bgmTimelineAt(SECS13, 42, -30);
  ok(tNeg.index === ord0[0] && tNeg.offset === 0, 'BGM同期: 負の経過は0として扱う');
  // 時間軸と「ローカル進行の歩行」が一致する (3周ぶんを細かくサンプル)
  {
    let walkOk = true;
    const totalCycle = SECS13.reduce((s, v) => s + L.bgmSegmentSec(v), 0);
    for (let t = 0; t < totalCycle * 3; t += 137.31) {
      // 歩行: 周と区間を前から積み上げて同じ t の位置を独立に求める
      let rest = t, expect = null;
      for (let c = 0; c < 4 && !expect; c++) {
        const o = L.bgmCycleOrder(13, 42, c);
        for (let j = 0; j < 13; j++) {
          const sg = L.bgmSegmentSec(SECS13[o[j]]);
          if (rest < sg) { expect = { index: o[j], offset: rest, cycle: c, cyclePos: j }; break; }
          rest -= sg;
        }
      }
      const got = L.bgmTimelineAt(SECS13, 42, t);
      if (!expect || !got || got.index !== expect.index || got.cycle !== expect.cycle ||
          got.cyclePos !== expect.cyclePos || Math.abs(got.offset - expect.offset) > 1e-6) walkOk = false;
    }
    ok(walkOk, 'BGM同期: 時間軸は曲順の歩行と3周ぶん一致する (途中参加・途中オンの合流位置)');
  }
  // 短い曲を含むリスト: offset は2回目の再生にも入る
  {
    const secsS = [60, 200, 45];
    const oS = L.bgmCycleOrder(3, 7, 0);
    const first = oS[0], segF = L.bgmSegmentSec(secsS[first]);
    const tIn = L.bgmTimelineAt(secsS, 7, segF - 0.5);
    ok(tIn.index === first && Math.abs(tIn.offset - (segF - 0.5)) < 1e-9, 'BGM同期: 短い曲リストでも区間内を指す');
    if (secsS[first] < 90) {
      const tSecond = L.bgmTimelineAt(secsS, 7, secsS[first] + 5);
      ok(tSecond.index === first && Math.abs(tSecond.offset - (secsS[first] + 5)) < 1e-9, 'BGM同期: 短い曲は offset が曲長を超えて2回目に入る');
    }
  }
  // 長さ0の曲は時間軸に現れない / 全て不明なら null
  {
    const secsZ = [100, 0, 120];
    let zeroSeen = false;
    for (let t = 0; t < 400; t += 7.7) {
      const p = L.bgmTimelineAt(secsZ, 3, t);
      if (p && p.index === 1) zeroSeen = true;
    }
    ok(!zeroSeen, 'BGM同期: 長さ0の曲は時間軸に現れない (区間0として読み飛ばす)');
    ok(L.bgmTimelineAt([0, 0], 3, 10) === null, 'BGM同期: 全曲長さ不明なら null');
    ok(L.bgmTimelineAt([], 3, 10) === null, 'BGM同期: 空リストなら null');
  }
  // 規範リストの検証
  {
    const good = L.sanitizeBgmSync({ seed: 123, files: ['a.mp3', 'b.mp3'], secs: [10, 20] });
    ok(good && good.seed === 123 && eq(good.files, ['a.mp3', 'b.mp3']) && eq(good.secs, [10, 20]), 'BGM同期: 規範リストの正常形は通る');
    ok(L.sanitizeBgmSync(null) === null && L.sanitizeBgmSync({}) === null, 'BGM同期: 欠けた規範リストは無効');
    ok(L.sanitizeBgmSync({ seed: 1, files: ['a.mp3'], secs: [10, 20] }) === null, 'BGM同期: files/secs の長さ不一致は無効');
    ok(L.sanitizeBgmSync({ seed: 1, files: [], secs: [] }) === null, 'BGM同期: 空の規範リストは無効');
    ok(L.sanitizeBgmSync({ seed: 1, files: ['a.mp3'], secs: [0] }) === null, 'BGM同期: 長さ0以下の曲を含むリストは無効');
    ok(L.sanitizeBgmSync({ seed: 1, files: ['a.mp3'], secs: [NaN] }) === null, 'BGM同期: 長さ NaN は無効');
    ok(L.sanitizeBgmSync({ seed: 1, files: [42], secs: [10] }) === null, 'BGM同期: ファイル名が文字列でなければ無効');
    ok(L.sanitizeBgmSync({ seed: NaN, files: ['a.mp3'], secs: [10] }) === null, 'BGM同期: シード NaN は無効');
    ok(L.sanitizeBgmSync({ seed: 7.9, files: ['a.mp3'], secs: [10] }).seed === 7, 'BGM同期: シードは整数化される');
  }
}

/* 24. 箱タップの分岐 (id 20: つづきがあっても箱を出す) */
{
  ok(L.boxTapAction(null) === 'open', '箱タップ: 進捗なしは新規オープン');
  ok(L.boxTapAction({ started: false, cleared: false, clusters: [] }) === 'open', '箱タップ: 未開始は新規オープン');
  ok(L.boxTapAction({ started: true, cleared: false, clusters: [{ pieces: [0] }] }) === 'resume', '箱タップ: 進行中はつづきから再開');
  ok(L.boxTapAction({ started: true, cleared: true, clusters: [{ pieces: [0] }] }) === 'resume', '箱タップ: クリア済みも箱から盤面へ入る');
}

/* 25. 壁インテリア (案B) の純粋ロジック: 壁カタログ + ランダム付与 + フレーム解放 + リセット */
{
  // カタログの健全性
  const ids = L.WALL_CATALOG.map(it => it.id);
  ok(L.WALL_CATALOG.length === 200, '壁: カタログは 200 点');
  ok(new Set(ids).size === ids.length && ids.every((id, i) => id === 'w' + String(i + 1).padStart(3, '0')), '壁: id は w001..w200 で一意・連番');
  ok(L.WALL_CATALOG.every(it => it.name && ['S', 'M', 'L'].includes(it.size)), '壁: 全点に名前・サイズ感がある');
  ok(L.WALL_CATALOG.filter(it => it.rarity === 3).length === 12, '壁: ★3 は 12 点');
  ok(L.WALL_CATALOG.filter(it => it.rarity === 2).length === 60, '壁: ★2 は 60 点');
  ok(L.WALL_CATALOG.filter(it => it.rarity === 1).length === 128, '壁: ★1 は 128 点');
  ok(L.wallItemById('w018').rarity === 3 && L.wallItemById('w028').rarity === 3 && L.wallItemById('w045').rarity === 3, '壁: ★3 は #18 ハーフリース / #28 折り鶴 / #45 星型ランタン');
  ok(L.WALL_SIZE_RATIO.S < L.WALL_SIZE_RATIO.M && L.WALL_SIZE_RATIO.M < L.WALL_SIZE_RATIO.L, '壁: サイズ比 S<M<L');
  ok(L.rarityLabel(L.wallItemById('w018')) === '★3' && L.rarityLabel(L.wallItemById('w001')) === '★1' && L.rarityLabel(null) === '', '壁: レア度ラベル');
  ok(L.RARITY_TABLE[1].weight > L.RARITY_TABLE[2].weight && L.RARITY_TABLE[2].weight > L.RARITY_TABLE[3].weight && L.RARITY_TABLE[3].weight > 0, 'レア度: 重みは ★1 > ★2 > ★3 の単調減少');

  // 季節ゲート
  const seasonal = {};
  L.WALL_CATALOG.filter(it => it.months).forEach(it => { seasonal[it.id] = it.months; });
  ok(eq(seasonal, { w001: [3, 4, 5], w003: [6], w004: [7, 8], w009: [10, 11], w015: [6, 7], w071: [6, 7], w128: [12, 1, 2], w143: [12, 1], w144: [12, 1], w145: [12, 1], w146: [12, 1], w147: [2], w148: [2], w149: [3], w150: [3], w151: [5], w152: [5], w153: [3, 4, 5], w154: [4, 5], w155: [6], w156: [7], w157: [7, 8], w158: [7, 8], w159: [7, 8], w160: [9, 10], w161: [10, 11], w162: [10], w163: [10], w164: [10], w165: [12], w166: [12], w167: [12], w168: [12, 1, 2], w169: [12], w170: [12], w171: [12], w172: [2] }), '壁: 季節ゲートは 37 点・月が仕様どおり');
  ok(L.wallDrawEligible(L.wallItemById('w001'), L.emptyWall(), 4) === true && L.wallDrawEligible(L.wallItemById('w001'), L.emptyWall(), 6) === false, '壁: 桜は春のみ抽選対象');

  // 抽選: 季節外は絶対に出ない / 所持済みは出ない / 全所持は null / ★3 は希少 (rng 全域スイープ)
  const seenDec = new Set();
  for (let i = 0; i < 400; i++) {
    const id = L.drawWallItem(L.emptyWall(), { month: 12 }, () => i / 400);
    if (id) seenDec.add(id);
  }
  ok([...seenDec].every(id => { const it = L.collectibleById(id); return !it || !it.months || it.months.includes(12); }), '壁抽選: 12月に出る季節物は12月ゲートのものだけ');
  ok([...seenDec].some(id => { const it = L.collectibleById(id); return it && it.months && it.months.includes(12); }), '壁抽選: 12月はクリスマス等の季節物が出る');
  ok(seenDec.size >= 30, '壁抽選: 通年アイテムには広く届く (' + seenDec.size + ' 種)');
  const seenJun = new Set();
  for (let i = 0; i < 400; i++) {
    const id = L.drawWallItem(L.emptyWall(), { month: 6 }, () => i / 400);
    if (id) seenJun.add(id);
  }
  ok(seenJun.has('w003') && seenJun.has('w015') && !seenJun.has('w001'), '壁抽選: 6月は あじさい/ラベンダー が出て 桜は出ない');
  let c1 = 0, c3 = 0; const N = 2000;
  for (let i = 0; i < N; i++) {
    const id = L.drawWallItem(L.emptyWall(), { month: 1 }, () => i / N);
    const r = L.collectibleById(id).rarity;
    if (r === 1) c1++; else if (r === 3) c3++;
  }
  ok(c3 > 0 && c3 < c1 / 5, '壁抽選: ★3 は出るが ★1 の 1/5 未満の頻度 (実測 ★3=' + c3 + ' ★1=' + c1 + ')');
  const oneW = L.emptyWall(); oneW.owned = ['w007'];
  ok(L.drawWallItem(oneW, { month: 6 }, () => 0) !== 'w007', '壁抽選: 所持済みは出ない');
  const allW = L.emptyWall(); allW.owned = ids.slice(); allW.catsOwned = L.CAT_CATALOG.map(c => c.id);
  ok(L.drawWallItem(allW, { month: 6 }, () => 0.5) === null, '壁抽選: 全所持なら null');

  // 床の猫: カタログ/スターター/抽選/付与/保存
  ok(L.CAT_CATALOG.length === 10 && eq(L.CAT_CATALOG.map(c => c.id), ['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10']), '猫: 10 匹のカタログ');
  ok(L.catById('c01').name.indexOf('白猫') === 0 && L.collectibleById('c10') === L.catById('c10') && L.collectibleById('w001') === L.wallItemById('w001'), '猫: catById / collectibleById の解決');
  ok(eq(L.emptyWall().catsOwned, ['c01']) && eq(L.emptyWall().catsPlaced, []), '猫: 新規は白猫を所持するが、最初から置きはしない (何も置かない初期状態)');
  const catMig = L.normalizeWall({ owned: [], placed: [], frames: [] });
  ok(eq(catMig.catsOwned, ['c01']) && eq(catMig.catsPlaced, []), '猫移行: 配置情報の無い旧セーブでも白猫は所持のみで、勝手に置かない');
  const catKeep = L.normalizeWall({ owned: [], placed: [], frames: [], catsOwned: ['c01', 'c04'], catsPlaced: [] });
  ok(eq(catKeep.catsOwned, ['c01', 'c04']) && eq(catKeep.catsPlaced, []), '猫保存: 空の配置 (全てしまった) は尊重される');
  const catNorm = L.normalizeWall({ owned: [], placed: [], frames: [], catsOwned: ['c04', 'c99'], catsPlaced: [{ id: 'c04', x: 1.4 }, { id: 'c05', x: 0.3 }, { id: 'c04', x: 0.2 }] });
  ok(eq(catNorm.catsOwned, ['c04', 'c01']) && eq(catNorm.catsPlaced, [{ id: 'c04', x: 0.97 }]), '猫保存: 未知/未所持/重複は落ち、x はクランプされる');
  const catPending = L.normalizeWall({ owned: [], placed: [], frames: [], pending: ['c07'] });
  ok(eq(catPending.pending, ['c07']), '猫保存: 未受取の猫は pending に残る');
  const gwCat = L.emptyWall();
  L.grantWallItems(gwCat, ['c04'], '2026-11-09');
  ok(eq(gwCat.catsOwned, ['c01', 'c04']) && gwCat.owned.indexOf('c04') < 0 && gwCat.seen.c04 === '2026-11-09', '猫付与: 猫は catsOwned に入り seen に日付が残る');
  const onlyCats = L.emptyWall(); onlyCats.owned = ids.slice();
  const drawnCats = new Set();
  for (let i = 0; i < 200; i++) drawnCats.add(L.drawWallItem(onlyCats, { month: 6 }, () => i / 200));
  ok([...drawnCats].every(id => id.charAt(0) === 'c') && drawnCats.size >= 5, '猫抽選: 壁アイテム全所持なら猫だけが出る (' + drawnCats.size + ' 種)');

  // 付与の適用 (所持 + seen 日付のみ。壁への自動配置はしない)
  const gw = L.emptyWall();
  L.grantWallItems(gw, ['w001', 'w001', 'w999'], '2026-11-08');
  ok(eq(gw.owned, ['w007', 'w030', 'w037', 'w001']) && gw.seen.w001 === '2026-11-08' && gw.placed.length === 0, '壁付与: 重複/未知は無視され seen に日付が残り、自動配置はされない');
  L.recordWallHistory(gw, '2026-11-08', ['w007']);
  L.recordWallHistory(gw, '2026-11-08', []);
  ok(eq(gw.history, { '2026-11-08': ['w007'] }), '壁付与: 履歴は日付キーで記録され、空配列では上書きしない');

  // フレームカタログと解放 (frame-design.md: 20 種・初期 2 種・タイプを散らした解放順)
  ok(L.FRAME_STYLES.length === 20, 'フレーム: 20 種');
  ok(eq(L.FRAME_STYLES.map(s => s.id), ['oak', 'walnut', 'black', 'ribbon', 'white', 'circle', 'pink', 'gold', 'flower', 'sky', 'antique', 'silver', 'cherry', 'starry', 'green', 'bronze', 'navy', 'rainbow', 'pearl', 'royal']), 'フレーム: 解放順が仕様どおり');
  ok(L.FRAME_STYLES.every(s => s.color && s.width > 0 && ['none', 'line', 'corners', 'ribbon', 'stars', 'flowers', 'pearl', 'crown'].includes(s.ornament) && ['rect', 'circle'].includes(s.shape)), 'フレーム: 全種に色・枠幅・装飾・形がある (データ駆動)');
  ok(L.frameStyleById('circle').shape === 'circle' && L.FRAME_STYLES.filter(s => s.shape === 'circle').length === 1, 'フレーム: 円形は まるフレーム だけ');
  ok(L.FRAME_STYLES.every(s => ['wood', 'metal', 'enamel', 'rainbow'].includes(s.material)), 'フレーム: 全種に素材 (wood/metal/enamel/rainbow) がある');
  ok(L.FRAME_STYLES.filter(s => s.ornament === 'line').every(s => !!s.line), 'フレーム: 細線の装飾には線色がある');
  ok(L.frameStyleById('gold').mat === '#F7F1E2' && L.frameStyleById('walnut').mat === '#F7F1E2' && L.frameStyleById('black').mat === null, 'フレーム: マットは生成り #F7F1E2 (oak/walnut/gold のみ)');
  // 描画ヘルパー (承認済みレシピの数値部分)
  ok(eq(L.shadeColor('#6E4C2C', 1), [110, 76, 44]) && eq(L.shadeColor('#6E4C2C', 0), [0, 0, 0]), 'フレーム描画: shadeColor は係数を掛ける');
  ok(eq(L.shadeColor('#FFFFFF', 1.13), [255, 255, 255]) && eq(L.shadeColor('#26314E', 0.82), [31, 40, 64]), 'フレーム描画: shadeColor は 255 で丸める');
  ok(eq(L.rainbowColorAt(0), [227, 169, 169]) && eq(L.rainbowColorAt(1), L.rainbowColorAt(0)) && eq(L.rainbowColorAt(-0.5), L.rainbowColorAt(0.5)), 'フレーム描画: 虹色は周囲を一周して戻る');
  ok(L.rainbowColorAt(0.25).every(v => v >= 0 && v <= 255), 'フレーム描画: 虹色の補間値は範囲内');
  const geoW = L.frameGeometry(200, L.frameStyleById('walnut'));
  ok(Math.abs(geoW.bw - 12) < 1e-9 && Math.abs(geoW.matW - 8.4) < 1e-9 && Math.abs(geoW.board - 159.2) < 1e-9 && Math.abs(geoW.pad - 32) < 1e-9 && Math.abs(geoW.size - 264) < 1e-9, 'フレーム描画: 寸法 (帯/マット/盤面/余白) がレシピどおり');
  const geoB = L.frameGeometry(200, L.frameStyleById('black'));
  ok(geoB.matW === 0 && Math.abs(geoB.board - 180) < 1e-9, 'フレーム描画: マットなしは盤面が帯の内側いっぱい');
  const fw = L.emptyWall();
  ok(eq(fw.frameUnlocks, ['oak', 'walnut']), 'フレーム: 初期解放は oak / walnut の 2 種');
  ok(eq(L.newFrameUnlocks(fw, 2), []) && eq(L.newFrameUnlocks(fw, 3), ['black']), 'フレーム: ランク3で ブラック 解放');
  ok(eq(L.newFrameUnlocks(fw, 5), ['black', 'ribbon']) && eq(L.newFrameUnlocks(fw, 9), ['black', 'ribbon', 'white', 'circle']), 'フレーム: 序盤に 色/装飾/形 が散らばって解放される');
  ok(L.newFrameUnlocks(fw, 27).length === 17 && L.newFrameUnlocks(fw, 28).length === 18, 'フレーム: ランク28で全 18 種解放');
  const fw2 = L.emptyWall();
  const added = L.applyFrameUnlocks(fw2, 9);
  ok(eq(added, ['black', 'ribbon', 'white', 'circle']) && eq(fw2.pendingUnlocks, added) && fw2.frameUnlocks.length === 6, 'フレーム: 解放が frameUnlocks と通知待ち (pendingUnlocks) に反映');
  ok(eq(L.applyFrameUnlocks(fw2, 9), []) && eq(L.applyFrameUnlocks(fw2, 4), []), 'フレーム: 解放は冪等 (再適用・巻き戻しなし)');

  // 保存形式の正規化 (壊れた/未知のデータを読んでも落ちない)
  const norm = L.normalizeWall({
    owned: ['w001', 'nope'], seen: { w001: '2026-11-08', nope: '2026-11-08' }, pending: ['w002', 'nope'],
    placed: [{ id: 'w001', x: 0.5, y: 0.4 }, { id: 'nope', x: 0, y: 0 }, { id: 'w003', x: 0.5, y: 0.4 }],
    frames: [{ recordKey: '2026-11-08|36|p1', x: 0.5, y: 0.38, w: 0.3, color: 'royal' }, { recordKey: 'bad', x: 0, y: 0, w: 1.5, color: 'walnut' }],
    frameUnlocks: ['black'], pendingUnlocks: ['gold', 'walnut'], lastDate: '2026-11-08', history: {}
  });
  ok(eq(norm.owned, ['w001', 'w007', 'w030', 'w037']) && eq(Object.keys(norm.seen), ['w001']) && eq(norm.pending, ['w002']), '壁保存: 未知の id は所持/初見/未受取から落ちる (初期アイテムは補われる)');
  ok(norm.placed.length === 1 && norm.placed[0].id === 'w001', '壁保存: 配置は所持アイテムのみ残る');
  const dup = L.normalizeWall({ owned: ['w001'], placed: [{ id: 'w001', x: 0.3, y: 0.3 }, { id: 'w001', x: 0.6, y: 0.6 }], frames: [] });
  ok(dup.placed.length === 2 && !!dup.placed[0].uid && !!dup.placed[1].uid && dup.placed[0].uid !== dup.placed[1].uid, '壁配置 (PBI21): 同じアイテムを複数置け、各配置に uid が付く');
  const dupKeep = L.normalizeWall({ owned: ['w001'], placed: [{ id: 'w001', uid: 'u7', x: 0.3, y: 0.3 }, { id: 'w001', x: 0.5, y: 0.5 }], frames: [] });
  ok(dupKeep.placed[0].uid === 'u7' && dupKeep.placed[1].uid === 'u8' && L.nextWallItemUid(dupKeep.placed) === 'u9', '壁配置 (PBI21): 既存 uid は保持され、新規は最大値+1 で採番される');
  ok(L.nextWallItemUid([]) === 'u1', '壁配置 (PBI21): 空なら u1 から');
  ok(norm.frames.length === 1 && norm.frames[0].color === 'walnut', '壁保存: 未解放スタイルの額は walnut に戻り、不正な記録キーは落ちる');
  ok(norm.frameUnlocks.includes('oak') && norm.frameUnlocks.includes('walnut') && norm.frameUnlocks.includes('black'), '壁保存: 初期スタイルは常に解放済み扱い');
  ok(eq(norm.pendingUnlocks, ['gold']), '壁保存: 解放通知待ちは unlockAt>0 のものだけ残る');
  ok(eq(L.normalizeWall(null), L.emptyWall()) && eq(L.normalizeWall('garbage'), L.emptyWall()), '壁保存: 壊れた値は空の形に初期化');

  // 初期インテリア 3 点 (w007 ユーカリリース / w030 葉っぱガーランド / w037 ハートガーランド)
  ok(eq(L.WALL_STARTER_ITEMS, ['w007', 'w030', 'w037']) && L.WALL_STARTER_ITEMS.every(id => !!L.wallItemById(id)), '初期アイテム: 3 点が仕様どおりで全てカタログに実在');
  ok(eq(L.emptyWall().owned, ['w007', 'w030', 'w037']) && L.emptyWall().placed.length === 0, '初期アイテム: 新規は 3 点所持・未配置 (トレイ) で開始');
  const mig1 = L.normalizeWall({ owned: ['w001'], placed: [], frames: [] });
  ok(eq(mig1.owned, ['w001', 'w007', 'w030', 'w037']), '初期アイテム移行: 既存セーブに不足分が補われる');
  const mig2 = L.normalizeWall({ owned: ['w037', 'w001'], placed: [], frames: [] });
  ok(eq(mig2.owned, ['w037', 'w001', 'w007', 'w030']), '初期アイテム移行: 所持済みは重複せず、欠けた分だけ末尾に補われる');
  ok(L.WALL_STARTER_ITEMS.every(id => !L.wallDrawEligible(L.wallItemById(id), L.emptyWall(), 1)), '初期アイテム: 所持済みなので付与抽選の対象に入らない');

  // 配置クランプ
  const cl = L.clampItemPos(-3, 7);
  ok(cl.x === 0 && cl.y === 1, '壁配置: 比率座標は 0..1 にクランプ');
  const cl2 = L.clampItemPos(0.25, 0.75);
  ok(cl2.x === 0.25 && cl2.y === 0.75, '壁配置: 範囲内はそのまま');

  // 全リセットヘルパー
  const box = { 'daily-jigsaw:v1': '{"records":[]}', other: 'keep' };
  const fakeStorage = {
    getItem: k => (k in box ? box[k] : null),
    removeItem: k => { delete box[k]; }
  };
  ok(L.resetAllData(fakeStorage, 'daily-jigsaw:v1') === true && !('daily-jigsaw:v1' in box) && box.other === 'keep', 'リセット: 対象キーだけを消して true を返す');
  ok(L.resetAllData(fakeStorage, 'daily-jigsaw:v1') === false, 'リセット: キーが無ければ false');
  ok(L.resetAllData(null, 'daily-jigsaw:v1') === false, 'リセット: storage が無くても落ちない');
}

/* 26. PWA: manifest / アイコン / Service Worker / index.html・app.js の配線 */
{
  const fs = require('fs');
  const path = require('path');
  const readText = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

  let manifest = null;
  try { manifest = JSON.parse(readText('manifest.webmanifest')); } catch (e) { /* 下の ok で落ちる */ }
  ok(!!manifest, 'PWA: manifest.webmanifest が JSON として妥当');
  ok(!!manifest && manifest.name === 'まいにちジグソー' && manifest.short_name === 'ジグソー', 'PWA: manifest の name / short_name');
  ok(!!manifest && manifest.start_url === '.' && manifest.scope === '.' && manifest.display === 'standalone', 'PWA: manifest の start_url / scope / display');
  ok(!!manifest && /^#[0-9a-f]{6}$/i.test(manifest.theme_color || '') && /^#[0-9a-f]{6}$/i.test(manifest.background_color || ''), 'PWA: manifest の theme_color / background_color が色指定');

  const icons = (manifest && manifest.icons) || [];
  ok(icons.some((i) => i.sizes === '192x192' && String(i.purpose || '').indexOf('any') !== -1)
    && icons.some((i) => i.sizes === '512x512' && String(i.purpose || '').indexOf('any') !== -1)
    && icons.some((i) => i.sizes === '512x512' && String(i.purpose || '').indexOf('maskable') !== -1),
    'PWA: アイコン 192/512 (any) と 512 (maskable) が宣言されている');
  ok(icons.length > 0 && icons.every((i) => fs.existsSync(path.join(__dirname, i.src))), 'PWA: 宣言されたアイコンファイルがすべて実在');
  ok(icons.every((i) => {
    const b = fs.readFileSync(path.join(__dirname, i.src));
    const wh = i.sizes.split('x').map(Number);
    return b.toString('latin1', 1, 4) === 'PNG' && b.readUInt32BE(16) === wh[0] && b.readUInt32BE(20) === wh[1];
  }), 'PWA: アイコンは宣言どおりの寸法の PNG');

  const sw = readText('sw.js');
  ok(sw.indexOf("addEventListener('install'") !== -1 && sw.indexOf("addEventListener('activate'") !== -1 && sw.indexOf("addEventListener('fetch'") !== -1,
    'PWA: sw.js に install / activate / fetch ハンドラがある');
  ok(/VERSION\s*=\s*'[^']+'/.test(sw) && sw.indexOf('caches.delete') !== -1, 'PWA: sw.js はバージョン付きキャッシュを持ち旧キャッシュを削除する');
  const precache = /var PRECACHE_URLS = \[([\s\S]*?)\];/.exec(sw);
  ok(!!precache && precache[1].indexOf('index.html') !== -1 && precache[1].indexOf('app.js') !== -1 && precache[1].indexOf('.mp3') === -1,
    'PWA: プリキャッシュは最小限で mp3 を含まない');
  ok(sw.indexOf("request.mode === 'navigate'") !== -1, 'PWA: sw.js はナビゲーションを NetworkFirst で扱う');

  const html = readText('index.html');
  ok(html.indexOf('rel="manifest"') !== -1 && html.indexOf('manifest.webmanifest') !== -1
    && html.indexOf('name="theme-color"') !== -1 && html.indexOf('rel="apple-touch-icon"') !== -1
    && html.indexOf('apple-mobile-web-app-capable') !== -1,
    'PWA: index.html に manifest リンク / theme-color / apple-touch-icon / モバイル向け meta がある');
  ok(L && readText('app.js').indexOf("serviceWorker.register('sw.js')") !== -1 || readText('app.js').indexOf('serviceWorker.register("sw.js")') !== -1,
    'PWA: app.js に Service Worker の登録コードがある');
}

/* 27. タイマー累積 (elapsedSeconds) とクリアタイムの保険、結果の共有文
 * 実機バグ「39手クリアなのにタイム 00:00」の回帰テスト。
 * 原因は onClear が state.cleared を立ててから経過を読んでいたこと:
 * cleared が立つと走行中セグメントが切り捨てられ、elapsedBase は
 * 一時停止時にしか畳み込まれないため、開始から一度も一時停止して
 * いないゲームでは記録が 0 秒になっていた。 */
{
  const t0 = 1000000;
  ok(L.elapsedSeconds({ base: 30, started: false, paused: false, cleared: false, timerStart: 0 }, t0) === 30,
    'タイマー: 未開始なら base のみ');
  ok(L.elapsedSeconds({ base: 30, started: true, paused: false, cleared: false, timerStart: t0 }, t0 + 65000) === 95,
    'タイマー: 走行中は base + 経過秒');
  ok(L.elapsedSeconds({ base: 30, started: true, paused: true, cleared: false, timerStart: t0 }, t0 + 65000) === 30,
    'タイマー: 一時停止中は増えない');
  ok(L.elapsedSeconds({ base: 95, started: true, paused: false, cleared: true, timerStart: t0 }, t0 + 65000) === 95,
    'タイマー: クリア済みは base のみ (クリア後に増えない)');
  ok(L.elapsedSeconds({ base: 0, started: true, paused: false, cleared: false, timerStart: 0 }, t0 + 65000) === 0,
    'タイマー: timerStart 不正 (0) では走行分を加えない');
  // クリア確定の正しい手順: cleared を立てる前に確定 → その後は固定
  const st = { base: 0, started: true, paused: false, cleared: false, timerStart: t0 };
  const atClear = L.elapsedSeconds(st, t0 + 125000);
  st.cleared = true; st.base = atClear;
  ok(atClear === 125 && L.elapsedSeconds(st, t0 + 999000) === 125,
    'タイマー: クリア確定は走行分 (125秒) を含み、その後増えない');
  // 旧バグの手順 (cleared 先行) では走行分が落ちて 0 になることの仕様確認
  ok(L.elapsedSeconds({ base: 0, started: true, paused: false, cleared: true, timerStart: t0 }, t0 + 125000) === 0,
    'タイマー: cleared 先行だと走行分が落ちる (旧バグの再現)');
  // 再開 (保存済み base + 新規セグメント) でも累積が失われない
  ok(L.elapsedSeconds({ base: 200, started: true, paused: false, cleared: false, timerStart: t0 }, t0 + 30000) === 230,
    'タイマー: 再開時は保存済み base に続きが加わる');
  // クリアタイムの保険
  ok(L.sanitizeClearTime(0, 39, 47) === 47, 'クリアタイム保険: 0秒+手数ありは保存済み進行から復元');
  ok(L.sanitizeClearTime(0, 39, 0) === 1, 'クリアタイム保険: 保存値も無ければ最低1秒');
  ok(L.sanitizeClearTime(83, 39, 47) === 83, 'クリアタイム保険: 正常な値はそのまま');
  ok(L.sanitizeClearTime(0, 0, 47) === 0, 'クリアタイム保険: 手数0なら0のまま');
  // 共有文: 結果 + ゲームURL + ハッシュタグを必ず含む
  const txt = L.buildShareText({ date: '2026-11-08', pieces: 36, timeSec: 205, moves: 58 });
  ok(txt.indexOf('https://daily-jigsaw.pages.dev') !== -1, '共有文: ゲームURLを含む');
  ok(txt.indexOf('#まいにちジグソー') !== -1, '共有文: ハッシュタグ #まいにちジグソー を含む');
  ok(txt.indexOf('2026-11-08') !== -1 && txt.indexOf('36ピース') !== -1 &&
     txt.indexOf('03:25') !== -1 && txt.indexOf('58手') !== -1,
    '共有文: 日付・難易度・タイム・手数を含む');
  ok(L.GAME_URL === 'https://daily-jigsaw.pages.dev', '共有: GAME_URL は公開URL');
}

/* 28. 壁紙 (wallpaper-design.md の 20 種): カタログ健全性 + 解放 + 保存移行
 * + 壁の土台 (床/巾木) とピッカーの配線チェック */
{
  // カタログの健全性と解放順
  ok(L.WALLPAPERS.length === 20, '壁紙: 20 種');
  ok(eq(L.WALLPAPERS.map(p => p.id), ['kinari', 'sage', 'pink', 'stripe', 'blue', 'dot', 'mint', 'floral', 'lemon', 'gingham', 'wood', 'lavender', 'brick', 'terracotta', 'starry', 'forest', 'gray', 'wine', 'gold', 'moonlit']), '壁紙: 解放順が仕様どおり');
  ok(eq(L.WALLPAPERS.map(p => p.unlockAt), [0, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28]), '壁紙: 解放ランクが仕様どおり (v57 ランク制)');
  ok(L.WALLPAPERS.every(p => p.name && /^#[0-9a-f]{6}$/i.test(p.base)), '壁紙: 全種に名前と地色がある');
  ok(L.WALLPAPERS.every(p => ['solid', 'stripe', 'dot', 'floral', 'gingham', 'wood', 'brick', 'starry', 'moonlit', 'microdot'].includes(p.kind)), '壁紙: 種別は定義済みのものだけ');
  ok(L.WALLPAPERS.filter(p => p.kind === 'solid').length === 11, '壁紙: 無地は 11 種');
  ok(L.WALLPAPERS.filter(p => p.kind !== 'solid').every(p => !!p.accent), '壁紙: 柄物には柄色 (accent) がある');
  ok(L.wallpaperById('moonlit').unlockAt === 28 && L.wallpaperById('nope') === null, '壁紙: wallpaperById は実在のみ・未知は null');
  ok(L.wallpaperById('kinari').base === '#F3E9D3', '壁紙: 生成りは現行の壁色 #F3E9D3');

  // 初期状態と解放判定
  const pw = L.emptyWall();
  ok(pw.paper === 'kinari' && eq(pw.paperUnlocks, ['kinari', 'sage']) && eq(pw.pendingPaperUnlocks, []), '壁紙: 初期は 生成り 適用・kinari/sage 解放・通知なし');
  ok(eq(L.newPaperUnlocks(pw, 1), []) && eq(L.newPaperUnlocks(pw, 2), ['pink']), '壁紙: ランク2で ダスティピンク 解放');
  ok(eq(L.newPaperUnlocks(pw, 8), ['pink', 'stripe', 'blue', 'dot']), '壁紙: ランク8までの解放が表順に並ぶ');
  ok(L.newPaperUnlocks(pw, 28).length === 18, '壁紙: ランク28で全 18 種解放');
  const pw2 = L.emptyWall();
  const addedP = L.applyPaperUnlocks(pw2, 16);
  ok(addedP.length === 8 && eq(pw2.pendingPaperUnlocks, addedP) && pw2.paperUnlocks.length === 10, '壁紙: 解放が paperUnlocks と通知待ち (pendingPaperUnlocks) に反映');
  ok(eq(L.applyPaperUnlocks(pw2, 16), []) && eq(L.applyPaperUnlocks(pw2, 5), []), '壁紙: 解放は冪等 (再適用・巻き戻しなし)');

  // 保存形式の移行: 壁紙フィールドを持たない旧セーブは初期値で補完される
  const legacy = L.normalizeWall({ owned: ['w001'], placed: [], frames: [] });
  ok(legacy.paper === 'kinari' && eq(legacy.paperUnlocks, ['kinari', 'sage']) && eq(legacy.pendingPaperUnlocks, []), '壁紙移行: 旧セーブは 生成り + 初期解放で補完');
  const kept = L.normalizeWall({ paper: 'starry', paperUnlocks: ['starry', 'kinari', 'sage', 'starry', 'nope'], pendingPaperUnlocks: ['moonlit', 'kinari', 'nope'] });
  ok(kept.paper === 'starry' && eq(kept.paperUnlocks, ['starry', 'kinari', 'sage']) && eq(kept.pendingPaperUnlocks, ['moonlit']), '壁紙移行: 解放済みの適用は保持・重複/未知は落ち・初期種は通知待ちから外れる');
  const unapplied = L.normalizeWall({ paper: 'starry', paperUnlocks: ['kinari', 'sage'] });
  ok(unapplied.paper === 'kinari', '壁紙移行: 未解放の壁紙が適用されていたら 生成り に戻す');
  const badPaper = L.normalizeWall({ paper: 'nope', paperUnlocks: 'garbage', pendingPaperUnlocks: 42 });
  ok(badPaper.paper === 'kinari' && eq(badPaper.paperUnlocks, ['kinari', 'sage']) && eq(badPaper.pendingPaperUnlocks, []), '壁紙移行: 壊れた値は初期値に落ちる');

  // 壁の広さ段階制 (段階0: 横1.5/縦1.2 → 段階1: 横3.0/縦1.4、累計15クリアで解放)
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok(eq(L.WALL_SIZE_STAGES, [{ w: 1.5, h: 1.2 }]) && eq(L.wallSizeOf(0), { w: 1.5, h: 1.2 }) && eq(L.wallSizeOf(1), { w: 1.5, h: 1.2 }) && eq(L.wallSizeOf(-1), { w: 1, h: 1 }), '壁: 広さは単一サイズ固定 (1.5x1.2、段階拡張は廃止。旧形式だけ移行用に 1x1)');
  ok(L.WALL_STAGE_ASPECT === 6 / 5 && L.WALL_BAND_CAP === 0.32, '壁: 窓のアスペクトは 6/5 (低く)、トップ帯の上限は画面高の32%');
  ok(L.emptyWall().sizeStage === 0 && L.emptyWall().pendingExpand === false, '壁拡張: 新規セーブは段階0・拡張未通知なし');
  ok(L.spreadWallX(0.5, 1, 1.5) === 0.5 && near(L.spreadWallX(0, 1, 1.5), 1 / 6) && near(L.spreadWallX(1, 1, 3), 2 / 3), '壁拡張: 横は中心基準で広がる (中心は不動、端は内側へ)');
  ok(L.spreadWallY(1, 1, 1.4) === 1 && near(L.spreadWallY(0, 1, 1.2), 1 / 6) && near(L.spreadWallY(0.5, 1.2, 1.4), 4 / 7), '壁拡張: 縦は床基準 (床=1は不動) で上方向へ広がる');
  const legW = L.normalizeWall({ owned: ['w007'], placed: [{ id: 'w007', x: 0, y: 1 }], frames: [] });
  ok(legW.sizeStage === 0 && near(legW.placed[0].x, 1 / 6) && legW.placed[0].y === 1, '壁拡張移行: 段階制前のセーブ (1.0x1.0) は段階0の広さへ座標移行');
  const keptW = L.normalizeWall({ sizeStage: 1, owned: ['w007'], placed: [{ id: 'w007', x: 0.2, y: 0.3 }], frames: [] });
  ok(keptW.sizeStage === 0 && keptW.placed[0].x === 0.2 && keptW.placed[0].y === 0.3, '壁移行: 拡張済み (段階1) セーブは座標そのまま固定サイズで引き継ぐ');
  const exW = L.emptyWall();
  exW.placed.push({ id: 'w007', x: 0.5, y: 0.5 });
  ok(L.applyWallExpand(exW, 99) === false && exW.sizeStage === 0 && exW.pendingExpand === false, '壁拡張廃止: 累計クリアが増えても壁は広がらない');
  ok(exW.placed[0].x === 0.5 && exW.placed[0].y === 0.5, '壁拡張廃止: 配置はそのまま');

  // 配線: index.html / app.js / style.css が壁紙 UI を持つ
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const appSrc = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  ok(html.indexOf('id="wallPaperBtn"') !== -1 && html.indexOf('id="paperPickerView"') !== -1 && html.indexOf('id="paperPickerGrid"') !== -1 && html.indexOf('id="paperPickerBack"') !== -1, '壁紙配線: index.html に 壁紙ボタンとピッカーがある');
  ok(appSrc.indexOf('paintWallBackdrop') !== -1 && appSrc.indexOf('paintWallpaperRegion') !== -1 && appSrc.indexOf('openPaperPicker') !== -1, '壁紙配線: app.js に背景ペインターとピッカーがある');
  ok(css.indexOf('.wall-bg') !== -1 && css.indexOf('#paperPickerGrid') !== -1 && css.indexOf('#wallStage::after') === -1, '壁紙配線: style.css に背景 Canvas とピッカーの様式があり、旧 ::after 巾木は撤去');
  ok(appSrc.indexOf('wallWorld') !== -1 && appSrc.indexOf('applyWallCam') !== -1 && appSrc.indexOf('wallFitBtn') !== -1 && css.indexOf('#wallWorld') !== -1, '壁拡張配線: ワールド層とカメラと全体ボタンがある');
  ok(html.indexOf('id="wallShareBtn"') !== -1 && appSrc.indexOf('shareWallImage') !== -1 && appSrc.indexOf('buildWallShareImage') !== -1, '壁共有配線: 壁画面に共有ボタンと壁全体の画像生成がある');
  ok(html.indexOf('id="sharePreviewModal"') !== -1 && html.indexOf('id="sharePreviewImg"') !== -1 && html.indexOf('id="sharePreviewCopyBtn"') !== -1, '共有プレビュー: 画像を見せてから共有/コピー/保存を選ぶモーダルがある');
  ok(appSrc.indexOf('openSharePreview(cv,') !== -1 && appSrc.indexOf("openSharePreview(cv, 'mainichi-jigsaw-wall.png')") !== -1, '共有プレビュー: クリア結果と壁の両方がプレビュー導線を通る');
  ok(css.indexOf('aspect-ratio: 6 / 5') !== -1, '壁窓: アスペクトは 6/5 (従来 4/5 より低い)');

  // 壁まわり改善 (2026-11-08 実機テスト): 壁でも BGM / 配置 SE / クレジット分離 / 壁紙名ラベルなし
  ok(appSrc.indexOf('function bgmOnTitle() { return uiHome && !uiWall && !bgm.started; }') !== -1, 'BGM: タイトル無音は「まだ一度も流れていない間」だけ。一度流れ始めたらトップに戻っても止めない (id 19 改訂)');
  ok(appSrc.indexOf('function bgmEnterTitle() { /* 流し続ける: 何もしない */ }') !== -1, 'BGM: トップに戻る動線 (bgmEnterTitle) は停止しない no-op');
  const showWallBody = appSrc.slice(appSrc.indexOf('function showWall(from)'), appSrc.indexOf('function hideWall()'));
  ok(showWallBody.indexOf('bgmTryPlay()') !== -1, '壁BGM: 壁を開くたびに開始/再開を試みる');
  ok(appSrc.indexOf('function seUnplace()') !== -1 && appSrc.indexOf('sePlaceOk()') !== -1, '壁SE: 配置可否ゲートと「しまう」音がある');
  const unplaceBody = appSrc.slice(appSrc.indexOf('function unplaceWallSelected()'), appSrc.indexOf('function renderWallTray()'));
  ok(unplaceBody.indexOf('seUnplace()') !== -1, '壁SE: しまう操作で控えめな音が鳴る');
  ok(html.indexOf('id="creditsModal"') !== -1 && html.indexOf('id="settingsCreditsBtn"') !== -1 && html.indexOf('id="bgmCredits"') !== -1 && html.indexOf('id="photoCredits"') !== -1, 'クレジット: 設定のボタンと専用モーダル (一覧はモーダル側) がある');
  const settingsBlock = html.slice(html.indexOf('id="settingsModal"'), html.indexOf('id="creditsModal"'));
  ok(settingsBlock.indexOf('bgmCredits') === -1 && settingsBlock.indexOf('photoCredits') === -1 && settingsBlock.indexOf('settingsCreditsBtn') !== -1, 'クレジット: 設定シート内に長い一覧は残っていない');
  ok(settingsBlock.indexOf('class="settings-actions"') !== -1 && settingsBlock.indexOf('class="settings-nav"') !== -1 && settingsBlock.indexOf('class="settings-other"') !== -1, '設定レイアウト確定形: 操作ボタン/行リスト/その他リンクのグループがある');
  ok(settingsBlock.indexOf('>みため<') !== -1 && settingsBlock.indexOf('>あそびかた<') !== -1 && settingsBlock.indexOf('>おと<') !== -1 && settingsBlock.indexOf('>そのほか<') !== -1, '設定レイアウト確定形: グループ見出しは みため/あそびかた/おと/そのほか');
  // 設定レイアウト v20 (2026-11-10 ユーザー指示): 戻る/やりなおす を最上段へ、
  // 完成図/色まとめは「おたすけ」セクション (ひらがな表記) にまとめる
  ok(settingsBlock.indexOf('class="settings-nav"') < settingsBlock.indexOf('>おたすけ<') && settingsBlock.indexOf('>おたすけ<') < settingsBlock.indexOf('>みため<'), '設定レイアウト v20: 順序は 行リスト (戻る/やりなおす) → おたすけ → みため');
  ok(settingsBlock.indexOf('>おたすけ<') !== -1 && settingsBlock.indexOf('>お助け<') === -1, '設定レイアウト v20: セクション名はひらがな「おたすけ」');
  ok(settingsBlock.indexOf('id="settingsPreviewBtn"') > settingsBlock.indexOf('>おたすけ<') && settingsBlock.indexOf('id="settingsSortBtn"') > settingsBlock.indexOf('>おたすけ<'), '設定レイアウト v20: 完成図を見る/色ごとにまとめる は おたすけ セクションの中');
  ok(settingsBlock.indexOf('>色ごとにまとめる<') !== -1 && settingsBlock.indexOf('お助け（色ごとの山にまとめる）') === -1, '設定レイアウト v20: ソートボタンのラベルは「色ごとにまとめる」 (旧長ラベルは廃止)');
  ok(/\.settings-actions \.settings-item \{[^}]*min-height: 42px/.test(css) && /\.settings-theme-btns \.btn \{[^}]*min-height: 42px/.test(css), '設定レイアウト v21: おたすけボタンの高さはあそびかたボタンと同じ 42px (コンパクトに統一)');
  ok(settingsBlock.indexOf('settingsPauseBtn') === -1 && settingsBlock.indexOf('settingsCollectionBtn') === -1 && settingsBlock.indexOf('settingsWallBtn') === -1, '設定レイアウト確定形: 一時停止/コレクション/壁ボタンは設定に無い (シート自体が一時停止、他はトップから)');
  ok(settingsBlock.indexOf('設定（一時停止中）') !== -1 && settingsBlock.indexOf('settings-close-x') !== -1, '設定レイアウト確定形: 見出しに一時停止中を表示し、閉じるは右上の✕');
  ok(settingsBlock.indexOf('swatch-btn') !== -1 && settingsBlock.indexOf('theme-swatch sw-walnut') !== -1, '設定レイアウト確定形: テーマは色タイル (スウォッチ) で選ぶ');
  ok(settingsBlock.indexOf('settingsHomeBtn') < settingsBlock.indexOf('settingsRestartBtn') && settingsBlock.indexOf('settingsRestartBtn') < settingsBlock.indexOf('>みため<'), '設定レイアウト確定形: やりなおすは スタート画面に戻る の直下');
  ok(settingsBlock.indexOf('settingsResetBtn') > settingsBlock.indexOf('settings-other'), '設定レイアウト確定形: データをリセットは そのほか の文字リンク内');
  ok(settingsBlock.indexOf('id="seVolume"') !== -1 && html.indexOf('id="seVolumeStart"') !== -1, 'SE音量: 設定シートとスタート画面の両方にスライダーがある');
  ok(appSrc.indexOf('var SE_MASTER_BASE = 3.0') !== -1 && appSrc.indexOf('store.seVolume') !== -1 && appSrc.indexOf('function applySeVolume()') !== -1 && appSrc.indexOf('createDynamicsCompressor') !== -1, 'SE音量: 基準ゲイン 3.0 (v60) × store.seVolume でマスターに反映 + 歪み防止リミッター');
  ok(html.indexOf('wallPaperInfo') === -1 && appSrc.indexOf('wallPaperInfo') === -1, '壁紙名ラベル: 壁画面の現在壁紙名テキストは撤去');

  // 画像共有のフォールバック: 保存に落ちたら必ず注記を出す (成功時・キャンセル時は出さない)
  ok(html.indexOf('id="appToast"') !== -1 && appSrc.indexOf('function showToast(') !== -1 && css.indexOf('#appToast') !== -1, '共有注記: 汎用トースト (要素/関数/CSS) がある');
  ok(appSrc.indexOf('このブラウザでは画像の直接共有ができないため、画像を保存しました') !== -1, '共有注記: 保存フォールバックの文言がある');
  const saveFbBody = appSrc.slice(appSrc.indexOf('function saveShareImageFallback('), appSrc.indexOf('function shareResultImage()'));
  ok(saveFbBody.indexOf('downloadShareImage(cv)') !== -1 && saveFbBody.indexOf('showToast(SHARE_SAVE_NOTE)') !== -1, '共有注記: 保存フォールバックは保存+注記をセットで行う');
  const shareImgBody = appSrc.slice(appSrc.indexOf('function shareResultImage()'), appSrc.indexOf('function runConfetti()'));
  ok(shareImgBody.indexOf('AbortError') !== -1 && (shareImgBody.match(/saveShareImageFallback\(cv\)/g) || []).length >= 3, '共有注記: toBlob不可/Blob失敗/未対応/share失敗 (キャンセル除く) の全経路が保存+注記に落ちる');

  // バッジ文言は「完成図を見ずにクリア」 (旧「完成図未確認」は残さない)
  ok(appSrc.indexOf('完成図未確認') === -1 && html.indexOf('完成図未確認') === -1, 'バッジ文言: 旧文言「完成図未確認」はコード/HTMLに残っていない');
  ok(appSrc.indexOf("'完成図を見ずにクリア'") !== -1 && html.indexOf('>完成図を見ずにクリア<') !== -1, 'バッジ文言: 共有画像とクリア画面の両方が新文言');
  const buildImgBody = appSrc.slice(appSrc.indexOf('function buildShareImage('), appSrc.indexOf('function downloadShareImage('));
  ok(buildImgBody.indexOf("measureText('クリア')") !== -1 && buildImgBody.indexOf('statShift') !== -1, '共有画像バッジ: 見出し実測幅で配置し、下行配置時は記録行を下げて重ねない');
}

/* 29. UIテーマ刷新 (2026-11-08): 机テクスチャ4種がテーマに。旧テーマは廃止し、
 * 保存値が旧値・未知値なら既定 'walnut' に落ちる。机は手続き描画ではなく
 * 承認済みテクスチャ画像 (desk-textures/) をそのまま敷く。 */
{
  const fsT = require('fs'), pathT = require('path');
  const readT = (p) => fsT.readFileSync(pathT.join(__dirname, p), 'utf8');
  const appSrcT = readT('app.js'), htmlT = readT('index.html'), cssT = readT('style.css'), swT = readT('sw.js');
  ok(eq(L.UI_THEME_IDS, ['walnut', 'oak', 'greenmat', 'linen']), 'テーマ: 新テーマは4種 (walnut/oak/greenmat/linen)');
  ok(L.UI_THEME_IDS.every(id => L.normalizeUiTheme(id) === id), 'テーマ: 有効なIDはそのまま通る');
  ok(['A', 'B', 'C', 'nordic', 'atelier', 'bogus', '', null, undefined].every(v => L.normalizeUiTheme(v) === 'walnut'), 'テーマ: 旧値・未知値は既定 walnut に落ちる (後継マッピングなし)');
  ok(L.UI_THEME_IDS.every(id => appSrcT.indexOf("tex: 'desk-textures/tex-" + id + ".jpg'") !== -1), 'テーマ: 全テーマにテクスチャ画像パスがある');
  ok(L.UI_THEME_IDS.every(id => fsT.existsSync(pathT.join(__dirname, 'desk-textures', 'tex-' + id + '.jpg'))), 'テーマ: テクスチャ画像ファイルが4種揃っている');
  ok(L.UI_THEME_IDS.every(id => (htmlT.match(new RegExp('data-theme-opt="' + id + '"', 'g')) || []).length >= 2), 'テーマ: 切替UI (スタート画面+設定シート) に4種が名前で並ぶ');
  ok(L.UI_THEME_IDS.every(id => cssT.indexOf('[data-theme="' + id + '"]') !== -1), 'テーマ: CSS変数ブロックが4種ある');
  ok(appSrcT.indexOf('nordic') === -1 && appSrcT.indexOf('atelier') === -1 && htmlT.indexOf('nordic') === -1 && htmlT.indexOf('atelier') === -1 && cssT.indexOf('nordic') === -1 && cssT.indexOf('atelier') === -1, 'テーマ: 旧テーマ (nordic/atelier) の残存なし');
  ok(appSrcT.indexOf('getWoodTile') === -1 && appSrcT.indexOf('function getDeskTexture(') !== -1, '机: 手続き木目タイルは廃止し、テクスチャ画像ローダーに置換');
  ok(appSrcT.indexOf('deskBgWorld = null;') !== -1, '机: テクスチャ読み込み完了で世界空間キャッシュを作り直す');
  ok(swT.indexOf('desk-textures') === -1, '机: テクスチャは SW プリキャッシュに入れない (ランタイムキャッシュ対象)');
}

/* 30. 難易度2グループ制 (2026-11-08): 7段階 / お題は難易度グループごと
 * ([16,36,64] / [100,225,400,1024] が同日内では別画像・グループ内では同じ画像) /
 * グループ内の順位で付く装飾ティア (36/225=銀・64/400=金・1024=特別装飾) */
{
  const fs2 = require('fs'), path2 = require('path');
  const read2 = (p) => fs2.readFileSync(path2.join(__dirname, p), 'utf8');
  const appSrc2 = read2('app.js'), html2 = read2('index.html'), css2 = read2('style.css');

  // 7段階 (1225廃止・64/1024追加)
  ok(eq(L.DIFFICULTIES, [16, 36, 64, 100, 225, 400, 1024]), '難易度: 7段階 [16,36,64,100,225,400,1024] (1225廃止)');
  ok(L.generateEdges('2026-11-08', 64).n === 8 && L.generateEdges('2026-11-08', 1024).n === 32, '難易度: 64 は 8x8・1024 は 32x32 グリッド');
  ok(appSrc2.indexOf('半日〜1日') === -1, '難易度: 想定時間ラベルからも 784 を削除');
  ok(appSrc2.indexOf('DIFFICULTIES.indexOf(store.lastDifficulty)') !== -1, '難易度: 保存済み lastDifficulty が一覧に無ければ 36 に落ちる既存フォールバックがある');

  // グループ対応 (2グループ制)
  ok(L.difficultyGroup(16) === 0 && L.difficultyGroup(36) === 0 && L.difficultyGroup(64) === 0, 'グループ: [16,36,64] → 0');
  ok(L.difficultyGroup(100) === 1 && L.difficultyGroup(225) === 1 && L.difficultyGroup(400) === 1 && L.difficultyGroup(1024) === 1, 'グループ: [100,225,400,1024] → 1');
  ok(L.difficultyGroup(1225) === 1, 'グループ: 旧 1225 は 1 (移行互換)');
  ok(L.difficultyGroup(784) === 0 && L.difficultyGroup(999) === 0 && L.difficultyGroup(undefined) === 0, 'グループ: 未知の値は 0');

  // グループ選択: 同日・別グループは別エントリ、グループ内は同じ、同グループは決定的
  const gpool = { baseDate: '2026-11-07', entries: [11, 22, 33, 44, 55, 66].map(id => ({ type: 'picsum', id: id })) };
  const gentries = L.poolEntries(gpool);
  ok(L.pickPoolEntry('2026-11-07', gpool, 0) === gentries[0] &&
     L.pickPoolEntry('2026-11-07', gpool, 1) === gentries[1], 'グループ選択: 基準日はグループ 0/1 で別エントリ');
  ok(L.pickPoolEntry('2026-11-08', gpool, 0) === gentries[2] &&
     L.pickPoolEntry('2026-11-08', gpool, 1) === gentries[3], 'グループ選択: 翌日もグループごとに別エントリへずれる');
  ok(L.pickPoolEntry('2026-11-08', gpool, L.difficultyGroup(16)) === L.pickPoolEntry('2026-11-08', gpool, L.difficultyGroup(64)) &&
     L.pickPoolEntry('2026-11-08', gpool, L.difficultyGroup(100)) === L.pickPoolEntry('2026-11-08', gpool, L.difficultyGroup(1024)), 'グループ選択: グループ内 (16と64 / 100と1024) は同じお題');
  ok(L.pickPoolEntry('2026-11-08', gpool, 1) === L.pickPoolEntry('2026-11-08', gpool, 1), 'グループ選択: 同日・同グループは決定的');
  ok(L.pickPoolEntry('2026-11-08', gpool) === gentries[1] && L.pickPoolEntry('2026-11-07', gpool) === gentries[0], 'グループ省略: 従来の日付のみ選択と一致 (旧挙動不変)');
  const realPool = JSON.parse(read2('data/images.json'));
  const rp = [0, 1].map(g => L.pickPoolEntry('2026-11-08', realPool, g));
  ok(rp[0] !== rp[1], 'グループ選択: 実プール (758件) でも2グループが別エントリ');

  // お題キーの保存/移行の配線 (newGameState / persistProgress)
  ok(appSrc2.indexOf('stageEntry(playStage, pool)') !== -1, 'お題: 新規開始はステージのお題を引く');
  ok(appSrc2.indexOf('poolEntryByKey(pool, prog.imgKey)') !== -1, 'お題: 保存済み imgKey を最優先で引く');
  ok(appSrc2.indexOf('prog.imgKey = state.imageKey') !== -1, 'お題: 開始確定 (persistProgress) で imgKey を保存する');

  // 箱の柄は難易度グループで引く (renderStartScreen)
  ok(appSrc2.indexOf('stageBoxPatternIndex(playStage)') !== -1 && html2.indexOf('id="giftBox"') !== -1 && html2.indexOf('id="giftBox0"') === -1, '箱の柄: スタート画面は箱1つをステージ番号の柄で描く');

  // 装飾ティアの対象
  ok(L.frameTier(100) === 'bronze', 'ティア: 100 が銅');
  ok(L.frameTier(225) === 'silver', 'ティア: 225 が銀');
  ok(L.frameTier(400) === 'gold' && L.frameTier(1225) === 'gold', 'ティア: 400 (と旧1225) が金');
  ok(L.frameTier(1024) === 'royal', 'ティア: 1024 が特別装飾 (royal)');
  ok(L.frameTier(16) === null && L.frameTier(36) === null && L.frameTier(64) === null && L.frameTier(784) === null && L.frameTier(0) === null, 'ティア: 16/36/64 等は対象外');
  ok(L.isUpperTier(100) && L.isUpperTier(225) && L.isUpperTier(400) && L.isUpperTier(1024), '上級: ティア対象はすべて isUpperTier');
  ok(!L.isUpperTier(16) && !L.isUpperTier(36) && !L.isUpperTier(64) && !L.isUpperTier(784) && !L.isUpperTier(0), '上級: 16/36/64 等は対象外');

  // 装飾ティアは額の外側4隅に付けるフラットな三角キャップ (案F6)。
  // 銀/金で色が変わり、最上位 (royal) は全周の金ラインが加わる (案B)。
  // 絵 (盤面) の中には何も描かない。額の豪華さは解放報酬の軸と混ざるため使わない
  ok(appSrc2.indexOf('function drawFrameCornerCaps(') !== -1, '額: コーナーキャップの描画部品がある');
  ok(appSrc2.indexOf('CAP_COLORS') !== -1 && appSrc2.indexOf("silver: { fill: '#b9bfc7'") !== -1, '額: 銀キャップの色定義がある');
  ok(appSrc2.indexOf("tier === 'royal'") !== -1, '額: 最上位は全周ライン付き (案B)');
  const frameBody = appSrc2.slice(appSrc2.indexOf('function paintFrameUnit('), appSrc2.indexOf('function drawFrameCornerCaps('));
  ok(frameBody.indexOf('if (upperPieces) drawFrameCornerCaps(') !== -1 && frameBody.indexOf('frameTier(upperPieces)') !== -1, '額: paintFrameUnit がティア対象のときだけティア色キャップを描く');
  ok(appSrc2.indexOf('drawUpperRibbon') === -1 && appSrc2.indexOf('drawCircleUpperRibbon') === -1, '盤面: 絵の中に描く旧リボン (斜め帯) は残っていない');
  ok(appSrc2.indexOf('isUpperTier(rec.pieces)') !== -1, '額: 対象レコード判定を paintWallFrameUnit が行う');
  const circleBody = appSrc2.slice(appSrc2.indexOf('function paintCircleFrameUnit('), appSrc2.indexOf('function buildWallFrameEl('));
  ok(circleBody.indexOf('drawCircleUpperArc(') !== -1 && circleBody.indexOf('frameTier(upperPieces)') !== -1, '額 (円形): リングの左上をティア色の弧に替える');
  ok(appSrc2.indexOf('upperTierGold') === -1 && appSrc2.indexOf('drawGoldRosette') === -1 && appSrc2.indexOf('drawBrassNameplate') === -1, '旧仕様: 額のピンストライプ/ロゼット/真鍮プレートは残っていない');

  // クリア画面の金のリボン風バッジ (既存バッジと縦に並ぶ)
  ok(html2.indexOf('id="resultUpperBadge"') !== -1 && html2.indexOf('>上級クリア<') !== -1, 'クリア画面: 「上級クリア」バッジ要素がある');
  ok(html2.indexOf('id="resultBadge"') < html2.indexOf('id="resultUpperBadge"'), 'クリア画面: 上級バッジは既存バッジの下に並ぶ');
  ok(appSrc2.indexOf("$('resultUpperBadge').hidden = !clearTier") !== -1 && appSrc2.indexOf('frameTier(difficulty)') !== -1, 'クリア画面: ティア対象のときだけバッジを出す');
  ok(css2.indexOf('.cert-badge-upper') !== -1, 'クリア画面: 金バッジの CSS がある');

  // スタート画面の難易度カード ★ (ティア色・最上位は ★★) とグループ見出し
  ok(appSrc2.indexOf("star.className = 'diff-star ' + (tier || 'none')") !== -1 && appSrc2.indexOf('frameTier(d)') !== -1, '難易度チップ: ティアに ★ を数字の下へ付ける配線がある');
  ok(appSrc2.indexOf("tier === 'royal' ? '★★' : '★'") !== -1, '難易度カード: 最上位は ★★');
  ok(css2.indexOf('.diff-star') !== -1 && css2.indexOf('.diff-star.silver') !== -1 && css2.indexOf('.diff-star.royal') !== -1, '難易度カード: ★ の CSS (銀/特別含む) がある');
  // スタート画面再設計 (2026-11-08): 箱カルーセル + ピース数チップ。
  // 「パズルA/B」の文言は出さず、箱の柄そのものでグループを区別する
  ok(html2.indexOf('id="boxCarousel"') === -1 && html2.indexOf('id="boxDots"') === -1 && appSrc2.indexOf('function syncBoxCarousel(') === -1 && css2.indexOf('.box-single') !== -1, '箱: カルーセルは廃止し箱1つを中央に置く');
  ok(appSrc2.indexOf("'パズルA'") === -1 && appSrc2.indexOf("'パズルB'") === -1 && html2.indexOf('パズルA') === -1, '箱カルーセル: 「パズルA/B」の文言は出さない');
  ok(appSrc2.indexOf("'diff-chip'") !== -1 && appSrc2.indexOf("d + 'ピース'") !== -1 && appSrc2.indexOf('DIFF_TIME_LABELS') === -1 && css2.indexOf('.diff-chip') !== -1 && css2.indexOf('.box-carousel') !== -1, '難易度チップ: 「Nピース」表記で箱の下にコンパクトに出し、目安時間は出さない');
  ok(css2.indexOf('.gift-box.rippling') !== -1 && css2.indexOf('scale(1.45)') !== -1, '箱の波紋: 手前の箱だけに大きく濃い波紋を出す');
  ok(html2.indexOf('class="nav-btn"') !== -1 && css2.indexOf('.nav-btn') !== -1, 'スタート導線: コレクション/壁はボタンらしい見た目');

  // コレクション詳細のチップ (ティア色)
  ok(appSrc2.indexOf('upper-chip') !== -1 && appSrc2.indexOf('frameTier(r.pieces)') !== -1 && appSrc2.indexOf('上級クリア') !== -1, 'コレクション詳細: ティア対象の記録にチップを出す');
  ok(css2.indexOf('.upper-chip') !== -1, 'コレクション詳細: チップの CSS がある');

  // コレクション一覧改修 (2026-11-10, sw v20): 最低3列・タイルは額入りの
  // 絵のみ (テキストは詳細に集約)・装飾と継ぎ目は最高クリア難易度で描く
  ok(L.topDifficultyRecord([{ pieces: 36 }, { pieces: 400 }, { pieces: 100 }]).pieces === 400, 'コレクション: 最高クリア難易度の記録を選ぶ');
  ok(L.topDifficultyRecord([{ pieces: 1024 }, { pieces: 1225 }]).pieces === 1225, 'コレクション: 旧1225も最大として扱う (ティアは金)');
  ok(L.topDifficultyRecord([]) === null && L.topDifficultyRecord(null) === null, 'コレクション: 記録が無ければ null');
  ok(L.collectionTilePlan(1024).n === 32 && L.collectionTilePlan(36).n === 6 && L.collectionTilePlan(225).n === 15, 'コレクションタイル: 行列はピース数の平方根');
  ok(L.collectionTilePlan(1024).perSeg < L.detailRenderPlan(1024).perSeg, 'コレクションタイル: 最重ケース (1024) は詳細より辺サンプリングを落として軽くする');
  ok(L.collectionTilePlan(1024).boardPx === 288, 'コレクションタイル: 盤面は壁帯と同じ 288px で描く');
  const colBody = appSrc2.slice(appSrc2.indexOf('function renderCollection()'), appSrc2.indexOf('function openDetail('));
  ok(colBody.indexOf('card-body') === -1 && colBody.indexOf('card-date') === -1 && colBody.indexOf('クリアタイム') === -1 && colBody.indexOf('card-title') === -1, 'コレクション一覧: タイルにテキスト情報を出さない (詳細に集約)');
  ok(colBody.indexOf('topDifficultyRecord(recsForKey)') !== -1 && colBody.indexOf('openDetail(best)') !== -1, 'コレクション一覧: 描画は最高難易度・詳細は従来の代表記録で開く');
  ok(colBody.indexOf('IntersectionObserver') !== -1 && colBody.indexOf('fillCollectionTile(') !== -1, 'コレクション一覧: 画面に入ったタイルから遅延描画する');
  const tileBody = appSrc2.slice(appSrc2.indexOf('function paintTileBoard('), appSrc2.indexOf('function renderTileBoardCanvas('));
  ok(tileBody.indexOf('generateEdges(rec.date, rec.pieces)') !== -1 && tileBody.indexOf('detailPiecePath(') !== -1 && tileBody.indexOf('strokePieceBevel(') !== -1, 'コレクションタイル: 継ぎ目は本物レンダラー (辺生成→輪郭パス→ベベル) で描く');
  ok(appSrc2.indexOf('collectionTileCache') !== -1 && appSrc2.indexOf('function buildCollectionTile(') !== -1 && appSrc2.indexOf("frameStyleById('oak')") !== -1, 'コレクションタイル: オーク額で統一し、描画結果をキャッシュする');
  ok(appSrc2.indexOf('paintFrameUnit(ctx, st, plan.frameU, board, board ? \'ready\' : \'loading\', seedKey, upper, COLLECTION_TILE_PAD)') !== -1, 'コレクションタイル: 額は壁と同じ paintFrameUnit でティア装飾ごと描く');
  ok(css2.indexOf('#collectionGrid { grid-template-columns: repeat(3, 1fr);') !== -1 && css2.indexOf('.card.framed-tile') !== -1, 'コレクション一覧: CSS は最低3列 + 額タイルは素通し');

  // 2026-11-08 追加分: 箱の柄分離 / 矢印 / 面の統合 / 共有の描画欠け対策 (ラウンド制・カルーセルは 2026-11-09 のステージ制で廃止)
  ok(appSrc2.indexOf("var pid = 'giftPat' + (uid || '')") !== -1 && appSrc2.indexOf("giftBoxSvg(BOX_PATTERNS[stageBoxPatternIndex(playStage)].id, '')") !== -1, '箱の柄: ステージ番号で柄を決める (箱は1つ)');
  ok(appSrc2.indexOf("stage.addEventListener('lostpointercapture', endPointer)") !== -1 && appSrc2.indexOf('function resetGestureState()') !== -1 && appSrc2.indexOf("ev.type === 'lostpointercapture'") !== -1, 'ジェスチャ: 中断で取り残された指 (ゴースト) を掃除し、1本指スワイプが拡大縮小にならない');
  ok(appSrc2.indexOf("wallStageEl.addEventListener('lostpointercapture', wallPtrEnd)") !== -1, '壁ジェスチャ: lostpointercapture でも指を掃除する');
  ok(appSrc2.indexOf('nextWallItemUid(store.wall.placed)') !== -1 && appSrc2.indexOf('wallPlacedByUid(wallSelected.key)') !== -1, '壁配置 (PBI21): トレイは uid 付きで新規配置し、選択/しまう は uid 単位');
  ok(appSrc2.indexOf('store.wall.placed.filter(function (p) { return p.uid !== wallSelected.key; })') !== -1, '壁配置 (PBI21): しまう は選択した1点だけを戻す');
  ok(L.TOUR_STEP_COUNT === 8 && L.TOUR_SEGMENTS.start.join() === '0,1' && L.TOUR_SEGMENTS.play.join() === '2,3' && L.TOUR_SEGMENTS.settings.join() === '4,5' && L.TOUR_SEGMENTS.wall.join() === '6,7', 'ツアー: 8ステップを画面別セグメントに配分する (おたすけ追加)');
  ok(appSrc2.indexOf("sel: '.settings-help'") !== -1 && appSrc2.indexOf('色ごとにまとめる') !== -1, 'ツアー: おたすけステップが設定のおたすけセクションを指す');
  ok(appSrc2.indexOf('tourRun([0, 1, 2, 3, 4, 5, 6, 7]') !== -1, 'ツアー: 全ステップ再生は8ステップ全てを含む');
  ok(require('fs').readFileSync(__dirname + '/index.html', 'utf8').indexOf('id="wallFrameBtn" class="btn" type="button">パズルを飾る</button>') !== -1 && require('fs').readFileSync(__dirname + '/index.html', 'utf8').indexOf('>額装する</button>') === -1, '壁: 額装ボタンは「パズルを飾る」表記 (ユーザー指示)');
  const htmlSB2 = require('fs').readFileSync(__dirname + '/index.html', 'utf8');
  ok(htmlSB2.indexOf('🎁') === -1 && htmlSB2.indexOf('🖼') === -1 && htmlSB2.indexOf('⚙') === -1 && htmlSB2.indexOf('btn-ico') !== -1, '絵文字排除: 通知ボタンと設定ボタンは絵文字でなく自前SVGアイコン (端末差をなくす)');
  ok(htmlSB2.indexOf('stroke-dasharray') === -1 && htmlSB2.indexOf('rotate(-28 9 6)') !== -1, 'アイコン幾何: 歯車は破線円でなく明示パス (歯の間隔が均等)、ギフトは楕円ループ (デザイナーレビュー承認案)');
  ok(css2.indexOf('#wallTray { display: grid;') !== -1 && css2.indexOf('overflow-x: auto; margin-top: 10px; padding: 10px 2px 14px') === -1, '壁トレイ: 横スクロールをやめ、複数列グリッドで下へ並べる');
  ok(appSrc2.indexOf('function tourRun(') !== -1 && appSrc2.indexOf("maybeTourAuto('start')") !== -1 && appSrc2.indexOf("maybeTourAuto('play')") !== -1 && appSrc2.indexOf("maybeTourAuto('settings')") !== -1 && appSrc2.indexOf("maybeTourAuto('wall')") !== -1, 'ツアー (コーチマーク式): 各画面の初回だけ自動で出す');
  ok(appSrc2.indexOf('function startFullTour()') !== -1 && appSrc2.indexOf('tourMarkSeen') !== -1 && appSrc2.indexOf('function openTutorial()') === -1, 'ツアー: あそびかたから全ステップ再生でき、旧モーダルは廃止');
  const htmlTour = require('fs').readFileSync(__dirname + '/index.html', 'utf8');
  ok(htmlTour.indexOf('id="tourOverlay"') !== -1 && htmlTour.indexOf('id="tutorialModal"') === -1, 'ツアー: index.html はコーチマーク用オーバーレイを持ち、旧モーダルは無い');
  ok(appSrc2.indexOf('function setCarryMode(') !== -1 && appSrc2.indexOf('function dropCarry()') !== -1 && appSrc2.indexOf('carryMode && !drag.movedFar') !== -1, '持ち運びモード: 設定で従来モードと切り替えでき、タップで持ち上げ/タップで置く');
  ok(appSrc2.indexOf('function edgeScrollStep()') !== -1 && appSrc2.indexOf('kickEdgeScroll()') !== -1 && appSrc2.indexOf('function positionDraggedCluster()') !== -1, 'ドラッグ改善: 端までドラッグすると画面が自動スクロールする');
  ok(htmlTour.indexOf('data-opmode="carry"') !== -1 && htmlTour.indexOf('data-opmode="drag"') !== -1, '持ち運びモード: 設定シートに操作モードの切替ボタンがある');
  ok(appSrc2.indexOf('function sortSinglesByColor(') !== -1 && appSrc2.indexOf('function clusterByColor(') !== -1 && appSrc2.indexOf('function colorBucketOf(') === -1 && appSrc2.indexOf('sortAnimStep') !== -1 && appSrc2.indexOf('c.pieces.length === 1') !== -1, 'お助け: バラのピースだけを相対的な色の開きで山にまとめる (塊は不動・固定色区分は廃止)');
  ok(htmlTour.indexOf('id="settingsSortBtn"') !== -1 && htmlTour.indexOf('id="sortConfirmModal"') !== -1 && htmlTour.indexOf('id="sortBtn"') === -1, 'お助け: 入口は設定シート内 + 実行前に確認モーダル (プレイ画面にボタンは無い)');
  ok(appSrc2.indexOf('function runSortSingles(') !== -1 && appSrc2.indexOf('function gridAvgColor(') !== -1 && appSrc2.indexOf('data/colors.json') !== -1, 'お助け: CORS 汚染でピクセルが読めない画像は平均色グリッドで色分けする');
  var colorsJsonT = JSON.parse(read2('data/colors.json'));
  var colorKeysT = Object.keys(colorsJsonT.colors || {});
  ok(colorsJsonT.grid === 16 && colorKeysT.length >= 390 && colorKeysT.every(function (k) { return Buffer.from(colorsJsonT.colors[k], 'base64').length === 768; }), 'お助け: 平均色グリッド (16x16) が全 URL 画像分そろっている');
  // 相対グルーピング (clusterByColor): 残っているピース同士の色の開きで分ける
  const grayLab = (v) => L.rgbToLab([v, v, v]);
  const grayGroups = L.clusterByColor([30, 80, 120, 160, 200, 240].map(grayLab));
  ok(grayGroups.length >= 3, 'お助け相対分け: 無彩色だけでも明暗の開きで複数山に分かれる (' + grayGroups.length + '山)');
  ok(eq(grayGroups.reduce((a, g) => a.concat(g), []).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]), 'お助け相対分け: 全ピースが漏れなくどこかの山に入る');
  ok(L.clusterByColor([118, 120, 122, 124].map(grayLab)).length === 1, 'お助け相対分け: 本当に似た色だけなら1山のまま (トースト側に倒れる)');
  const hueGroups = L.clusterByColor([[200, 40, 40], [210, 60, 50], [190, 50, 45], [40, 60, 200], [50, 70, 210], [45, 55, 190]].map((c) => L.rgbToLab(c)));
  ok(hueGroups.length >= 2 && hueGroups.some((g) => g.includes(0) && !g.includes(3)), 'お助け相対分け: 赤系と青系は別の山になる');
  const gradLabs = []; for (let gv = 100; gv <= 168; gv += 4) gradLabs.push(grayLab(gv));
  ok(L.clusterByColor(gradLabs).length >= 3, 'お助け相対分け: なだらかな明暗グラデーションでも濃さの近い同士で山に分かれる');
  const manyLabs = []; for (let mi = 0; mi < 40; mi++) manyLabs.push(L.rgbToLab([(mi * 6) % 256, (mi * 37) % 256, (mi * 91) % 256]));
  ok(L.clusterByColor(manyLabs).length <= 8, 'お助け相対分け: 山は最大8つまで');
  ok(css2.indexOf('bottom: calc(66px') === -1, '曲名トースト: 廃止した丸ボタンの分の上げ底 (66px) が残っていない');
  ok(html2.indexOf('id="boxPrev"') === -1 && html2.indexOf('id="boxNext"') === -1 && html2.indexOf('id="giftBox"') !== -1 && html2.indexOf('box-single wallband-box') !== -1, '箱: 矢印ボタンは廃止し箱1つだけを壁帯に重ねて出す (PBI #24 案A)');
  ok(html2.indexOf('id="startWallBand"') !== -1 && html2.indexOf('id="wallPreviewCanvas"') !== -1 && html2.indexOf('start-wallwrap') !== -1 && appSrc2.indexOf('function updateWallPreview(') !== -1 && appSrc2.indexOf('function renderWallPreviewCanvas(') !== -1 && appSrc2.indexOf('wallPreviewCache') !== -1, '壁帯プレビュー: スタート画面最上部に飾った壁を描き、壁が変わらない間はキャッシュを使う');
  ok(css2.indexOf('transform: translateY(47%);') !== -1 && css2.indexOf('margin: -26px -20px 71px;') !== -1 && css2.indexOf('width: min(73%, 340px);') !== -1, '壁帯の箱: v19 で幅 min(73%,340px) に縮小し、絵の天面 (SVG y=84) が帯下端から約12pxだけ床帯に入る translateY(47%) + はみ出し分を確保する margin-bottom 71px (要素基準で計算すると絵が帯から離れてタイトルに被る)');
  ok(JSON.stringify(L.CAT_CATALOG.map(function (c) { return c.w; })) === JSON.stringify([0.225, 0.255, 0.405, 0.225, 0.27, 0.42, 0.27, 0.285, 0.255, 0.345]), '猫サイズ: 全匹 ×1.5 (2026-11-10 ユーザー選択)');
  ok(appSrc2.indexOf('function withScreenFade(') !== -1 && appSrc2.indexOf('function screenFadeSwap(') !== -1 && appSrc2.indexOf("function showWallNow(from)") !== -1 && appSrc2.indexOf("function hideWallNow()") !== -1, '画面遷移の簡易暗転: 壁の出入りは fadeVeil で包み、遷移は暗転の中で実行する');
  ok(appSrc2.indexOf('function handlePopstate()') !== -1 && appSrc2.indexOf('screenFadeSwap(function () { handlePopstate(); })') !== -1, '画面遷移の簡易暗転: 戻る (popstate) の画面遷移も暗転で包む');
  ok(appSrc2.indexOf("cv.parentElement.style.opacity = '0'") !== -1 && appSrc2.indexOf("reveal();") !== -1, '壁の額: 読み込み中プレースホルダは見せず、本描画が終わるまで額を透明にして完成形だけ出す');
  ok(appSrc2.indexOf('wallPreviewReadyKey') !== -1 && appSrc2.indexOf("cv.style.opacity = '0'") !== -1 && appSrc2.indexOf('band.dataset.h') !== -1, '壁帯: 本描画が完成するまで帯を透明に保ち、透明な間は帯の高さを縮めない (戻る瞬間の潰れ対策)');
  ok(appSrc2.indexOf('COLLECTION_TILE_PAD = 0.045') !== -1 && css2.indexOf('gap: 6px') !== -1, 'コレクションタイル: 額の余白を 0.16→0.045 に詰め、グリッド間隔 10px→6px で写真を大きくする');
  ok(appSrc2.indexOf('innerWidth <= 700') === -1 && (appSrc2.match(/innerHeight \* WALL_BAND_CAP/g) || []).length >= 2 && L.WALL_BAND_CAP === 0.32, '壁帯: 高さ上限 (画面高の32%) は画面幅によらず常に効く (タブレット幅で帯が縦長化し帯内アスペクトが壁と食い違う不具合の修正)');
  ok(appSrc2.indexOf('wallCam.zoom = wallFitZoom();') !== -1 && appSrc2.indexOf("? '全体' : 'ズーム'") !== -1, '壁画面: 開いたときは常に全体表示で、ボタンは全体表示中は「ズーム」(押すと等倍)、ズーム中は「全体」');
  ok(appSrc2.indexOf('function snapRisk(') !== -1 && appSrc2.indexOf('Math.round(q.x) - rx === dc') !== -1, '初期散布: 隣同士が開始直後のドロップで吸着する配置 (グリッド丸め後一致 + 生距離) を候補から外す');
  var wallN = L.normalizeWall({ catsOwned: ['c01', 'c02', 'c03'], catsPlaced: [{ id: 'c02', x: 0.3 }, { id: 'c03', x: 0.6 }, { id: 'c01', x: 0.8 }] });
  ok(wallN.catsPlaced.length === 1 && wallN.catsPlaced[0].id === 'c02', '猫は同時に1匹だけ: 複数配置の旧セーブは先頭の1匹を残す');
  ok(appSrc2.indexOf("renderWallBoardFast(rec, boardPx)") !== -1 && appSrc2.indexOf('buildShareFrameCanvas(f, unit * k, 288)') !== -1, '壁帯プレビュー: 額の盤面は小サイズ描画で軽くする');
  ok(appSrc2.indexOf('renderWallPreviewCanvas(aspect)') !== -1 && appSrc2.indexOf('padX + f.x * W') !== -1 && appSrc2.indexOf('padX + p.x * W') !== -1, '壁帯プレビュー: 帯が横長な分は下地を左右延長し、額と小物と猫は壁座標のまま描く (横の切れ目なし)');
  ok(appSrc2.indexOf('wallPreviewAspect()') !== -1, '壁帯プレビュー: 帯のアスペクトで延長量を決める');
  ok(appSrc2.indexOf("wallPreviewKey() + '@'") === -1 && appSrc2.indexOf('wallPreviewCache = { key: key, cv: full }') !== -1, '壁帯プレビュー: キャッシュキーは壁の内容だけ (アスペクトを混ぜると起動直後のレイアウト揺れで装飾が出ないバグになる)');
  // 壁帯の縦つぶれ対策 (2026-11-10 実機報告): 壁から戻る間に URL バーで
  // innerHeight が変わると帯アスペクトがずれ、旧実装は引き伸ばし/レター
  // ボックスで誤魔化して壁が縦つぶれ+紙色余白になっていた。ずれが大きい
  // キャッシュは現在のアスペクトで描き直す
  const updBody = appSrc2.slice(appSrc2.indexOf('function updateWallPreview()'), appSrc2.indexOf('/* 壁画像で共有'));
  ok(updBody.indexOf('var drift = Math.abs(srcC.width / srcC.height - targetAspect);') !== -1 && updBody.indexOf('if (drift <= 0.02)') !== -1, '壁帯: キャッシュのアスペクトずれを検出し、一致したときだけそのまま貼る');
  ok(updBody.indexOf('0.15') === -1, '壁帯: 旧の引き伸ばし閾値 (0.15) は廃止 (ずれは描き直しで解消)');
  ok(updBody.indexOf("key + '@' + targetAspect.toFixed(3)") !== -1 && updBody.indexOf('renderWallPreviewCanvas(renderAspect)') !== -1, '壁帯: 描き直しは内容キー+アスペクトで多重起動を防ぎ、現在のアスペクトで描く');
  ok(updBody.indexOf('Math.abs(wallPreviewAspect() - renderAspect) > 0.02') !== -1, '壁帯: 描画中にアスペクトが動いた結果は採用せず描き直す');
  const previewBody = appSrc2.slice(appSrc2.indexOf('function renderWallPreviewCanvas('), appSrc2.indexOf('var wallPreviewCache'));
  const shareBody = appSrc2.slice(appSrc2.indexOf('function buildWallShareImage()'), appSrc2.indexOf('function downloadWallShareImage'));
  ok(previewBody.indexOf('ctx.ellipse(padX + p.x * W') !== -1 && previewBody.indexOf('ctx.drawImage(img, padX + p.x * W - wpx / 2, feetY - hpx') !== -1, '壁帯プレビュー: 猫も額・小物と同じ padX 付き座標で描く (padX 漏れで左にずれるバグの再発防止)');
  ok(shareBody.indexOf('padX') === -1, '壁共有画像: padX は存在しない (プレビュー専用の延長量。混入すると ReferenceError で共有が壊れる)');
  // 机の有限化 (PBI #27): クランプは平行移動のみ、範囲内は冪等でセーブが変わらない
  const deskRect36 = L.scatterRect(36);
  const clBounds = L.clusterCellBounds({ pieces: [0, 1, 7], gx: 2, gy: 3 }, 6);
  ok(clBounds.minX === 2 && clBounds.maxX === 4 && clBounds.minY === 3 && clBounds.maxY === 5, '有限化: 塊のセル範囲はアンカー基準で求まる');
  const insideCl = { pieces: [0, 1, 7], surface: 'desk', gx: 0, gy: 0 };
  ok(L.normalizeClustersToRect([insideCl], 6, deskRect36)[0] === insideCl, '有限化: 範囲内の塊は同じオブジェクトのまま (冪等・セーブ無変化)');
  const farCl = { pieces: [5], surface: 'desk', gx: -4000, gy: 9999 };
  const rescuedPos = L.clampClusterToRect(farCl, 6, deskRect36);
  const rescuedBounds = L.clusterCellBounds({ pieces: [5], gx: rescuedPos.gx, gy: rescuedPos.gy }, 6);
  ok(rescuedBounds.minX === deskRect36.x0 && rescuedBounds.maxY === deskRect36.y0 + deskRect36.h, '有限化: 遠くへ飛んだピースは最も近い机の端に着地する');
  const normFar = L.normalizeClustersToRect([farCl], 6, deskRect36)[0];
  ok(normFar !== farCl && normFar.pieces === farCl.pieces && normFar.gx === rescuedPos.gx, '有限化: 正規化は pieces を変えず位置だけ直す (合体は壊れない)');
  const allPieces36 = []; for (let api2 = 0; api2 < 36; api2++) allPieces36.push(api2);
  const bigCl = { pieces: allPieces36, surface: 'desk', gx: deskRect36.x0, gy: deskRect36.y0 };
  ok(L.clampClusterToRect(bigCl, 6, deskRect36).gx === bigCl.gx && L.clampClusterToRect(bigCl, 6, deskRect36).gy === bigCl.gy, '有限化: 盤面全体の塊でも机に収まり位置が壊れない');
  const grpT = L.clampClustersTranslation([{ pieces: [0], gx: -8, gy: 0 }, { pieces: [1], gx: -3, gy: 0 }], 6, deskRect36);
  ok(grpT.dx === 3 && grpT.dy === 0, '有限化: グループは和集合でクランプされ相対配置が保たれる');
  // 机の境界は散らばり領域の縦横4倍 (×2→まだ狭い→×4 でユーザー確定)
  const db36 = L.deskBounds(36);
  ok(db36.w === deskRect36.w * 4 && db36.h === deskRect36.h * 4 && db36.x0 === deskRect36.x0 - deskRect36.w * 1.5 && db36.y0 === deskRect36.y0 - deskRect36.h * 1.5, '有限化: 机の境界は散らばり領域を中心に縦横4倍');
  const edgeCl = { pieces: [0], surface: 'desk', gx: deskRect36.x0 - 3, gy: 0 };
  ok(L.normalizeClustersToRect([edgeCl], 6, db36)[0] === edgeCl, '有限化: 散らばり領域の外でも机の範囲内なら動かない (v11 の端より外が使える)');
  const farDb = L.clampClusterToRect(farCl, 6, db36);
  const farDbBounds = L.clusterCellBounds({ pieces: [5], gx: farDb.gx, gy: farDb.gy }, 6);
  ok(farDbBounds.minX === db36.x0 && farDbBounds.maxY === db36.y0 + db36.h, '有限化: 救済の着地点は広がった机の端');
  ok(appSrc2.indexOf('function deskRect() { return deskBounds(') !== -1, '有限化: クランプとカメラは deskBounds を境界に使う');
  ok(appSrc2.indexOf('function drawDeskBoundary(') !== -1 && appSrc2.indexOf('drawDeskBoundary(v);') !== -1, '有限化: 境界の外はベールで暗くし見える化する (見えない壁の解消)');
  ok(appSrc2.indexOf('function clampCamera(') !== -1 && (appSrc2.match(/clampCamera\(\);/g) || []).length >= 5, '有限化: カメラクランプがパン/ピンチ/端スクロール/ズーム/ホイールの全経路に入っている');
  ok(appSrc2.indexOf('normalizeClustersToRect(prog.clusters') !== -1 && appSrc2.indexOf('normalizeClustersInDesk(); // 保存は必ず') !== -1, '有限化: 読み込み時の救済と保存前の正規化が入っている');
  ok(html2.indexOf('id="fitViewBtn"') !== -1, '有限化: プレイ画面に全体表示ボタンがある');
  ok(html2.indexOf('themeCredit') === -1 && html2.indexOf('start-footer') === -1, 'トップ画面: コピーライト/クレジット表記を出さない');
  ok(appSrc2.indexOf('function syncPlayStage(') !== -1 && appSrc2.indexOf('nextStage(store.records, pool)') !== -1 && appSrc2.indexOf("'ステージ ' + playStage") !== -1 && appSrc2.indexOf('function maybeAdvanceRound(') === -1, 'ステージ制: 未挑戦ステージを順に進め、24時間ロックは無い');
  ok(appSrc2.indexOf('function processRewardsOnClear(firstClear)') !== -1 && appSrc2.indexOf('processRewardsOnClear(isFirstStageClear)') !== -1, 'ごほうび: ステージ初クリアのときだけ抽選する');
  ok(appSrc2.indexOf('function switchSurface(') === -1 && html2.indexOf('surfaceBtn') === -1 && html2.indexOf('dropZone') === -1, '面の統合: マット切替 UI (ボタン/ドロップゾーン) はない');
  ok(appSrc2.indexOf('img.decode()') !== -1 && appSrc2.indexOf('1600 / worldW') !== -1, '壁共有: decode 完了後に描き、合成サイズを抑えて帯状ノイズを防ぐ');
}

/* 26. ステージ制 (2026-11-09 転換): お題の決定・進行・移行の純ロジック */
{
  const fs3 = require('fs'), path3 = require('path');
  const read3 = (p) => fs3.readFileSync(path3.join(__dirname, p), 'utf8');
  const appSrc2 = read3('app.js'), html2 = read3('index.html');
  const spool = { baseDate: '2026-11-07', entries: [0, 1, 2, 3, 4].map(i => ({ type: 'picsum', id: 100 + i })) };
  // 1周目はプール順
  ok([1, 2, 3, 4, 5].every(s => L.stageEntryIndex(s, 5) === s - 1), 'ステージ: 1周目はプール順にお題が出る');
  ok(L.stageEntry(3, spool).id === 102, 'ステージ: stageEntry がプールの3件目を返す');
  // 2周目は決定的シャッフルの順列 (全件ちょうど1回ずつ)
  const cyc2 = [6, 7, 8, 9, 10].map(s => L.stageEntryIndex(s, 5));
  ok(new Set(cyc2).size === 5 && cyc2.every(i => i >= 0 && i < 5), 'ステージ: 2周目は全件をちょうど1回ずつ出す順列');
  ok([6, 7, 8, 9, 10].every(s => L.stageEntryIndex(s, 5) === L.stageEntryIndex(s, 5)), 'ステージ: 2周目の順序は決定的');
  ok(L.stageCycle(5, 5) === 0 && L.stageCycle(6, 5) === 1 && L.stageCycle(11, 5) === 2, 'ステージ: 周回数の数え方');
  ok(L.stageDate(1) === '2026-11-07' && L.stageDate(2) === '2026-11-08', 'ステージ: 日付キーは基準日 + ステージ-1日 (記録互換)');
  // 記録 → ステージ復元 (新規は stage フィールド、旧記録は画像キーの位置)
  ok(L.recordStage({ stage: 42, imageKey: 'p100', date: '2026-11-07' }, spool) === 42, 'ステージ: 新記録は stage フィールドを優先');
  ok(L.recordStage({ imageKey: 'p102', date: '2026-11-20', pieces: 36 }, spool) === 3, 'ステージ: 旧記録は画像キーの1周目位置から復元');
  ok(L.recordStage({ imageId: 104, date: '2026-11-20', pieces: 36 }, spool) === 5, 'ステージ: 旧 picsum 記録 (imageId のみ) も復元できる');
  // 次のステージ = クリア済みでない最小番号
  ok(L.nextStage([], spool) === 1, 'ステージ: 記録なしならステージ1');
  const recsA = [{ imageKey: 'p100', pieces: 36 }, { imageKey: 'p101', pieces: 100 }];
  ok(L.nextStage(recsA, spool) === 3, 'ステージ: 1,2 クリア済みなら次は3');
  ok(L.nextStage([{ imageKey: 'p101', pieces: 36 }], spool) === 1, 'ステージ: 途中のステージだけクリアでも未挑戦の最小が次');
  ok(L.nextStage(recsA.concat([{ stage: 3, imageKey: 'p102', pieces: 36 }]), spool) === 4, 'ステージ: stage フィールド持ちの記録も数える');
  // コレクション解放 = クリアした絵のキー集合
  ok(L.unlockedImageKeys(recsA).size === 2 && L.unlockedImageKeys(recsA).has('p100'), 'ステージ: 解放した絵のキーが集まる');
  // 箱の柄はステージで回る
  ok([1, 2, 3, 4, 5, 6].every(s => L.stageBoxPatternIndex(s) === s - 1) && L.stageBoxPatternIndex(7) === 6 && L.stageBoxPatternIndex(21) === 0, 'ステージ: 箱の柄はステージ番号で20種ローテーション');
  // 進捗移行と報酬配線 + コレクション再プレイ配線
  ok(appSrc2.indexOf('function migrateProgressToStages(') !== -1 && appSrc2.indexOf('store.stageMigrated') !== -1, 'ステージ移行: 旧進行中データを imgKey のステージへ移す');
  ok(appSrc2.indexOf('function startReplayFromDetail(') !== -1 && html2.indexOf('id="detailPlayBtn"') !== -1, 'コレクション: 解放済みの絵は詳細から再プレイできる');
  ok(html2.indexOf('id="streakBadge"') === -1 && appSrc2.indexOf('computeStreak') === -1, 'ステージ制: 連続クリア (streak) 表示は廃止');
  ok(L.buildShareText({ stage: 12, pieces: 36, timeSec: 65, moves: 40 }).indexOf('ステージ12') !== -1, '共有文: ステージ番号で組む');
}

/* 額サイズ3段階 + 壁画面サンプル箱 (2026-11-10 ユーザー設計/決定) */
{
  ok(eq(L.FRAME_SIZE_TIERS.map(t => t.w), [0.3, 0.45, 0.6]), '額サイズ: 段階は 小0.30 / 中0.45 / 大0.60 (v19 繰り下げ)');
  ok(Math.abs(Math.pow(0.6 / 0.3, 2) - 4) < 1e-9 && Math.abs((0.3 + 0.6) / 2 - 0.45) < 1e-9, '額サイズ: 大は小の面積4倍、中は幅の中間');
  ok(L.frameSizeTierOf(0.3) === 0 && L.frameSizeTierOf(0.28) === 0 && L.frameSizeTierOf(0.37) === 0 &&
     L.frameSizeTierOf(0.375) === 1 && L.frameSizeTierOf(0.45) === 1 && L.frameSizeTierOf(0.52) === 1 && L.frameSizeTierOf(0.525) === 1 &&
     L.frameSizeTierOf(0.53) === 2 && L.frameSizeTierOf(0.6) === 2, '額サイズ: 最も近い段階の判定 (境界 0.375 / 0.525、既存の 0.28 / 0.30 は新しい小)');
  const wsz0 = { w: 1.5, h: 1.2 };
  ok(eq(L.clampFrameCenter({ x: 0.5, y: 0.4, w: 0.3 }, wsz0), { x: 0.5, y: 0.4 }), '額サイズ: 壁に収まっている額の中心は動かない');
  const clL = L.clampFrameCenter({ x: 0.05, y: 0.97, w: 0.6 }, wsz0);
  ok(Math.abs(clL.x - 0.6 / 1.5 / 2) < 1e-9 && Math.abs(clL.y - (1 - 0.6 / 1.2 / 2)) < 1e-9, '額サイズ: 大 (0.60) への拡大ではみ出し分だけ中心を内側へ寄せる');
  const clS = L.clampFrameCenter({ x: 0.99, y: 0.01, w: 0.3 }, { w: 3.0, h: 1.4 });
  ok(Math.abs(clS.x - (1 - 0.3 / 3 / 2)) < 1e-9 && Math.abs(clS.y - 0.3 / 1.4 / 2) < 1e-9, '額サイズ: 拡張壁でもクランプが効く');
  // サンプル箱の換算は puppeteer 実測 (412x915 / 412x1047、帯と箱の実矩形から換算) と一致する (v19 の小さい箱で実測し直し)
  const art0 = L.sampleBoxArtRect(412, 915, wsz0);
  ok(Math.abs(art0.left - 0.2473) < 0.002 && Math.abs(art0.top - 0.9560) < 0.002 &&
     Math.abs(art0.width - 0.5054) < 0.002 && Math.abs(art0.height - 0.2079) < 0.002,
     'サンプル箱: 固定サイズのアートワーク範囲が実測と一致 (' + art0.left.toFixed(4) + ',' + art0.top.toFixed(4) + ',' + art0.width.toFixed(4) + ')');
  const art1 = L.sampleBoxArtRect(412, 915, { w: 3.0, h: 1.4 });
  ok(Math.abs(art1.left - 0.2473) < 0.002 && Math.abs(art1.width - 0.5054) < 0.002 && Math.abs(art1.top - 0.9246) < 0.002,
     'サンプル箱: 仮想の広い壁 (3.0x1.4) でも換算が成立する (' + art1.left.toFixed(4) + ',' + art1.width.toFixed(4) + ')');
  ok(Math.abs(art0.left + art0.width / 2 - 0.5) < 0.002 && Math.abs(art1.left + art1.width / 2 - 0.5) < 0.002, 'サンプル箱: 横は壁の中央に来る');
  ok(art0.top > 0.885 && art0.top + art0.height > 1, 'サンプル箱: 床帯 (下端11.5%) の内側から始まって下へはみ出す');
  const elr = L.sampleBoxElementRect(412, 915, wsz0, 1);
  ok(Math.abs(elr.width - art0.width / (288 / 416)) < 1e-9 &&
     Math.abs(elr.left + elr.width * (64 / 416) - art0.left) < 1e-9 &&
     Math.abs(elr.top + elr.height * (84 / 190) - art0.top) < 1e-9,
     'サンプル箱: 要素矩形からアートワーク矩形が復元できる');
  const fsB = require('fs'), pathB = require('path');
  const appSB = fsB.readFileSync(pathB.join(__dirname, 'app.js'), 'utf8');
  const htmlSB = fsB.readFileSync(pathB.join(__dirname, 'index.html'), 'utf8');
  const swSB = fsB.readFileSync(pathB.join(__dirname, 'sw.js'), 'utf8');
  const cssSB = fsB.readFileSync(pathB.join(__dirname, 'style.css'), 'utf8');
  ok(appSB.indexOf('function buildWallSampleBox(') !== -1 && appSB.indexOf('wallSampleBox') !== -1 && appSB.indexOf('function updateSampleBoxOpacity(') !== -1 &&
     appSB.indexOf('wall-samplebox-clip') !== -1 &&
     cssSB.indexOf('.wall-samplebox') !== -1 && cssSB.indexOf('.wall-samplebox-clip') !== -1 && cssSB.indexOf('pointer-events: none') !== -1, 'サンプル箱配線: 壁への描画・最前面・操作不可・濃さ連動 + 壁下端で切るクリップラッパーがある');
  ok(appSB.indexOf('function renderFrameSizeButtons(') !== -1 && appSB.indexOf('clampFrameCenter(fr, wallSize())') !== -1 &&
     htmlSB.indexOf('id="wallFrameSizes"') !== -1 && cssSB.indexOf('.frame-size-btn') !== -1, '額サイズ配線: 選択バーにサイズボタン群がありクランプ経由で保存する');
  ok(swSB.indexOf("VERSION = 'v60'") !== -1, 'sw: VERSION は v60');
  ok(appSB.indexOf("var APP_VERSION = 'v60'") !== -1 && htmlSB.indexOf('id="appVersion"') !== -1, '版表示: 設定画面の版表記が sw の VERSION と一致する');
  // ランクシステム (v57): XP 表と補間、倍率、ランク導出、称号、報酬表、移行
  ok(L.xpForPieces(16) === 15 && L.xpForPieces(36) === 30 && L.xpForPieces(64) === 50 && L.xpForPieces(100) === 75 && L.xpForPieces(225) === 130 && L.xpForPieces(400) === 200 && L.xpForPieces(1024) === 420, 'ランク: XP 表が仕様どおり');
  ok(L.xpForPieces(49) === 39 && L.xpForPieces(81) === 62 && L.xpForPieces(144) === 94, 'ランク: 表に無いピース数 (ハンデ等) は線形補間');
  ok(L.clearXp(100, false, false) === 75 && L.clearXp(100, true, false) === 113 && L.clearXp(100, false, true) === 90 && L.clearXp(225, true, true) === 234, 'ランク: 初クリア 1.5 倍・現像 1.2 倍');
  {
    const r0 = L.rankFromXp(0);
    ok(r0.rank === 1 && r0.into === 0 && r0.needed === 60 && r0.toNext === 60, 'ランク: 0 XP はランク1・次まで60');
    const r7 = L.rankFromXp(1575);
    ok(r7.rank === 7 && r7.into === 315 && r7.needed === 420 && r7.toNext === 105, 'ランク: 1575 XP はランク7 (あと105)');
    ok(L.rankFromXp(60).rank === 2 && L.rankFromXp(59).rank === 1 && L.rankFromXp(180).rank === 3, 'ランク: 境界 (60→2, 180→3)');
    const rMax = L.rankFromXp(999999);
    ok(rMax.rank === 30 && rMax.needed === 0 && rMax.toNext === 0, 'ランク: 上限は30で MAX');
  }
  ok(L.rankTitle(1) === 'かけだし' && L.rankTitle(4) === 'かけだし' && L.rankTitle(5) === 'ピース使い' && L.rankTitle(10) === '組み立て職人' && L.rankTitle(15) === 'パズル名人' && L.rankTitle(20) === '壁かざりマスター' && L.rankTitle(25) === 'レジェンド' && L.rankTitle(30) === 'レジェンド', 'ランク: 称号は5ランクごとの帯');
  {
    const all = [];
    for (let r = 2; r <= 28; r++) L.rankRewardsAt(r).forEach(x => all.push(x.kind + ':' + x.id));
    ok(all.length === 36 && new Set(all).size === 36, 'ランク: 報酬はランク2〜28に壁紙18+額縁18が重複なく並ぶ');
    ok(eq(L.rankRewardsAt(2).map(x => x.id), ['pink']) && eq(L.rankRewardsAt(20).map(x => x.id), ['lavender', 'silver']) && eq(L.rankRewardsAt(28).map(x => x.id), ['moonlit', 'royal']), 'ランク: 報酬内訳 (2=壁紙ピンク, 20=両方, 28=最終)');
    ok(L.rankRewardsAt(1).length === 0 && L.rankRewardsAt(29).length === 0, 'ランク: ランク1と29以降に報酬なし');
  }
  ok(L.migratedXp([{ stage: 1, pieces: 36 }, { stage: 1, pieces: 36 }, { stage: 2, pieces: 100, dev: true }]) === 45 + 30 + 135, 'ランク移行: ステージ初出のみ初クリア倍率 (45+30+135)');
  ok(L.migratedXp([]) === 0 && L.migratedXp(null) === 0, 'ランク移行: 記録なしは 0');
  // ランク配線: スタート行・ダイアログ・結果画面 XP ブロック・解放はランク判定
  ok(htmlSB.indexOf('id="rankRow"') !== -1 && htmlSB.indexOf('id="rankModal"') !== -1 && htmlSB.indexOf('id="rankLadder"') !== -1, 'ランク配線: スタート画面にランク行と詳細ダイアログがある');
  ok(htmlSB.indexOf('id="resultXp"') !== -1 && htmlSB.indexOf('id="resultXpRankup"') !== -1 && htmlSB.indexOf('id="resultXpReward"') !== -1, 'ランク配線: 結果画面に XP ブロックがある');
  ok(appSB.indexOf('store.xp += xpGain') !== -1 && appSB.indexOf('rankMigrated') !== -1 && appSB.indexOf('applyFrameUnlocks(wall, rankFromXp(store.xp).rank)') !== -1, 'ランク配線: クリアで XP 付与・移行・解放はランクで判定');
  ok(appSB.indexOf('paintRankRow();') !== -1 && appSB.indexOf('buildRankModal();') !== -1, 'ランク配線: ランク行の描画とダイアログ構築が呼ばれる');
  ok(appSB.indexOf("ランク ' + st.unlockAt + ' で解放") !== -1 && appSB.indexOf("ランク ' + p.unlockAt + ' で解放") !== -1 && appSB.indexOf("st.unlockAt + ' 回クリアで解放'") === -1 && appSB.indexOf("p.unlockAt + ' 回クリアで解放'") === -1 && appSB.indexOf("p.unlockAt + '回クリアで解放'") === -1, 'ランク配線: 解放条件の表記はランク制に替わり、旧・回数表記は残っていない');

  // hidden 属性 / JS の hidden 切替が CSS の display 指定に打ち消されないこと。
  // (v55: .cert-sub-actions の display:flex が #resultMpActions の hidden を
  //  無効化し、ソロのクリア画面にマルチ用ボタン「つぎのステージへ」が
  //  出て押しても反応しない事故があった。その同類を全部洗う)
  {
    const dispSels = [];
    const ruleRe = /([^{}]+)\{([^}]*)\}/g; let rm2;
    while ((rm2 = ruleRe.exec(cssSB))) {
      if (!/display\s*:\s*(flex|grid|block|inline-flex|inline-grid|inline-block)/.test(rm2[2])) continue;
      rm2[1].split(',').forEach(s => { s = s.trim(); if (/^[.#][A-Za-z0-9_-]+$/.test(s)) dispSels.push(s); });
    }
    const guardSels = new Set();
    const gRe = /([.#][A-Za-z0-9_-]+)\[hidden\]/g;
    while ((rm2 = gRe.exec(cssSB))) guardSels.add(rm2[1]);
    const idInfo = {};
    const tagRe = /<(\w+)([^>]*)>/g;
    while ((rm2 = tagRe.exec(htmlSB))) {
      const idM = rm2[2].match(/id="([^"]+)"/); if (!idM) continue;
      const clM = rm2[2].match(/class="([^"]+)"/);
      idInfo[idM[1]] = { classes: clM ? clM[1].split(/\s+/) : [], hiddenAttr: /(^|\s)hidden(\s|=|$)/.test(rm2[2]) };
    }
    const jsIds = new Set();
    const jsRe = /\$\('([A-Za-z0-9_-]+)'\)\.hidden\s*=/g;
    while ((rm2 = jsRe.exec(appSB))) jsIds.add(rm2[1]);
    const victims = [];
    Object.keys(idInfo).forEach(id => {
      const info = idInfo[id];
      if (!info.hiddenAttr && !jsIds.has(id)) return;
      dispSels.forEach(sel => {
        const hit = sel[0] === '.' ? info.classes.indexOf(sel.slice(1)) !== -1 : sel === '#' + id;
        if (hit && !guardSels.has(sel) && !guardSels.has('#' + id)) victims.push(id + ' via ' + sel);
      });
    });
    ok(victims.length === 0, 'hidden ガード: display 指定に hidden が打ち消される要素がない' + (victims.length ? ' (' + victims.join(', ') + ')' : ''));
    ok(cssSB.indexOf('.cert-sub-actions[hidden]') !== -1 && cssSB.indexOf('#wallFrameColors[hidden]') !== -1,
       'hidden ガード: 結果画面のマルチ用ボタン行と壁の額色行に [hidden] 規則がある');
  }
}

/* 初期散布は開始直後のドロップで勝手にくっつかない (2026-11-10 バグ修正) */
{
  const dates = ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'];
  let badGames = 0, checked = 0;
  [16, 36, 64].forEach(function (pieces) {
    const n = Math.round(Math.sqrt(pieces));
    dates.forEach(function (d) {
      let clusters = L.initialScatter(d, pieces);
      checked++;
      for (let id = 0; id < pieces; id++) {
        const idx = clusters.findIndex(function (c) { return c.pieces.length === 1 && c.pieces[0] === id; });
        if (idx < 0) continue;
        const cl = clusters[idx];
        const others = clusters.filter(function (_, i) { return i !== idx; });
        const dropped = { pieces: cl.pieces, surface: cl.surface, gx: L.snapToGrid(cl.gx), gy: L.snapToGrid(cl.gy) };
        const res = L.absorbMerges(others, dropped, n);
        if (res.merged) badGames++;
        clusters = res.clusters;
      }
    });
  });
  ok(badGames === 0 && checked === 18, '初期散布: 全ピースを掴んで即ドロップしても1つも合体しない (' + checked + ' ゲーム検証)');
}
/* マルチプレイ収束テスト (MULTIPLAYER_DESIGN §7 step 0 / T1):
 * 同じ drop イベント列を独立した2状態へ適用すると全ステップで canonical
 * ハッシュが一致し、途中 snapshot (全塊の deep copy) から再開しても
 * 同じ最終状態に収束する */
{
  const n = 6, pieces = 36;
  function cloneCs(cs) {
    return cs.map(function (c) { return { pieces: c.pieces.slice(), surface: c.surface, gx: c.gx, gy: c.gy }; });
  }
  function applyDrop(clusters, ev) {
    const idx = clusters.findIndex(function (c) { return L.clusterAnchorId(c) === ev.anchor; });
    const cl = clusters[idx];
    const others = clusters.filter(function (_, i) { return i !== idx; });
    return L.absorbMerges(others, { pieces: cl.pieces.slice(), surface: cl.surface, gx: ev.gx, gy: ev.gy }, n).clusters;
  }
  // 決定的なイベント列: ピース id 順に、そのピースを含む塊を正解位置へ落とす
  const events = [];
  {
    let gen = L.initialScatter('2026-11-11', pieces);
    for (let id = 0; id < pieces; id++) {
      const cl = gen.find(function (c) { return c.pieces.indexOf(id) >= 0; });
      const ah = L.pieceHome(L.clusterAnchorId(cl), n);
      const ev = { anchor: L.clusterAnchorId(cl), gx: ah.col, gy: ah.row };
      events.push(ev);
      gen = applyDrop(gen, ev);
    }
  }
  let a = L.initialScatter('2026-11-11', pieces);
  let b = cloneCs(L.initialScatter('2026-11-11', pieces));
  let stepMismatch = 0;
  events.forEach(function (ev) {
    a = applyDrop(a, ev);
    b = applyDrop(b, ev);
    if (L.canonicalStateHash(a) !== L.canonicalStateHash(b)) stepMismatch++;
  });
  ok(stepMismatch === 0 && events.length === pieces, '収束: 同じイベント列を2状態へ適用すると全ステップで canonical ハッシュが一致');
  ok(L.isComplete(a, n) && L.isComplete(b, n), '収束: イベント列の適用で両状態とも完成する');
  // snapshot 等価性: K 個適用した時点の全塊 deep copy から残りを適用する
  const K = 13;
  let c = L.initialScatter('2026-11-11', pieces);
  for (let i = 0; i < K; i++) c = applyDrop(c, events[i]);
  let d = cloneCs(c); // snapshot
  for (let i = K; i < events.length; i++) d = applyDrop(d, events[i]);
  ok(L.canonicalStateHash(d) === L.canonicalStateHash(a), '収束: 途中 snapshot から再開しても最終ハッシュが一致');
  // canonical ハッシュ自体の性質
  const base = L.initialScatter('2026-11-11', pieces);
  ok(L.canonicalStateHash(cloneCs(base).reverse()) === L.canonicalStateHash(base), 'canonical: 塊の配列順が違ってもハッシュは同じ');
  const qi = base.findIndex(function (cl) { return Math.round((cl.gx + 1e-7) * 1e6) === Math.round(cl.gx * 1e6); });
  const nudged = cloneCs(base);
  if (qi >= 0) nudged[qi].gx += 1e-7; // 量子 (1e-6 セル) 未満の座標差
  ok(qi >= 0 && L.canonicalStateHash(nudged) === L.canonicalStateHash(base), 'canonical: 1e-7 の座標差は量子化で吸収される');
  const moved = cloneCs(base);
  moved[0].gx += 0.01;
  ok(L.canonicalStateHash(moved) !== L.canonicalStateHash(base), 'canonical: 0.01 の座標差ではハッシュが変わる');
}

/* マルチプレイ (協力) UI 統合の配線 (MULTIPLAYER_DESIGN v3) */
{
  const fsM = require('fs'), pathM = require('path');
  const appM = fsM.readFileSync(pathM.join(__dirname, 'app.js'), 'utf8');
  const htmlM = fsM.readFileSync(pathM.join(__dirname, 'index.html'), 'utf8');
  const swM = fsM.readFileSync(pathM.join(__dirname, 'sw.js'), 'utf8');
  const cssM = fsM.readFileSync(pathM.join(__dirname, 'style.css'), 'utf8');
  ok(htmlM.indexOf('<script src="mp.js"></script>') !== -1 &&
     htmlM.indexOf('<script src="mp.js"></script>') < htmlM.indexOf('<script src="app.js"></script>'),
     'MP配線: mp.js が app.js より前に読み込まれる');
  ok(htmlM.indexOf('id="mpBtn"') !== -1 && htmlM.indexOf('id="mpModal"') !== -1 &&
     htmlM.indexOf('id="mpLobbyView"') !== -1 && htmlM.indexOf('id="mpRoomCode"') !== -1 &&
     htmlM.indexOf('id="mpVerifyCode"') !== -1 && htmlM.indexOf('id="mpRoster"') !== -1 &&
     htmlM.indexOf('id="mpBadge"') !== -1 && htmlM.indexOf('id="mpPinBtn"') !== -1 &&
     htmlM.indexOf('id="resultContrib"') !== -1,
     'MP配線: スタート導線・ロビー・バッジ・ピンボタン・貢献度表示の要素がある');
  ok(swM.indexOf("'mp.js'") !== -1 && swM.indexOf("endsWith('/mp.js')") !== -1,
     'MP配線: sw.js が mp.js をプリキャッシュし NetworkFirst 対象に含む');
  ok(appM.indexOf('var MP_LOGIC_VERSION = 5;') !== -1 &&
     appM.indexOf('hashState: function (clusters) { return canonicalStateHash(clusters); }') !== -1 &&
     appM.indexOf("t: 'grab-req'") !== -1 && appM.indexOf("t: 'drop'") !== -1 && appM.indexOf("t: 'sort'") !== -1,
     'MP配線: hooks が canonicalStateHash を使い、grab-req/drop/sort を送る');
  ok(appM.indexOf("if (mpInRoom() && mp.mode !== 'race') { mpSettleDrag(); return; }") !== -1 &&
     appM.indexOf('if (mpInRoom()) return; // 協力プレイはソロの進行中セーブと分離する') !== -1,
     'MP配線: settleDrag は協力/ターン制で seq 経路へ分岐し (レースはローカル確定)、persistProgress は協力中に無動作');
  ok(appM.indexOf('mpGuestClear') === -1 && appM.indexOf('rec.coop = true;') !== -1 &&
     appM.indexOf('function mpFillResultExtras()') !== -1,
     'MP配線: クリア記録は参加者全員が coop 付きで自分の store に保存する (旧・ゲスト抑止の分岐は廃止)');
  ok(appM.indexOf('function mpLoadPuzzle(') !== -1 && appM.indexOf('mp.session.setReady()') !== -1 &&
     appM.indexOf('function mpDoApplySnapshot(') !== -1 && appM.indexOf('function mpDrawOverlays(') !== -1,
     'MP配線: お題ロード + ready バリア、snapshot 適用、相手表示の重ね描きがある');
  ok(cssM.indexOf('#mpBadge') !== -1 && cssM.indexOf('.mp-pin-btn') !== -1 && cssM.indexOf('.mp-roster') !== -1,
     'MP配線: style.css にバッジ・ピンボタン・名簿のスタイルがある');
  ok(appM.indexOf('mp.contrib[ev.from] = (mp.contrib[ev.from] || 0) + (clustersBefore - state.clusters.length);') !== -1,
     'MP配線: 貢献度は mpOnDrop の適用側で「その drop で消えた塊の数」を数える (送信者の自己申告にしない)');
  ok(appM.indexOf('contribForDrop') === -1,
     'MP配線: 旧・ピース数方式の contribForDrop は廃止され参照が残っていない');
  ok(appM.indexOf("' 回接続</span>") !== -1 && appM.indexOf('ピース接続') === -1,
     'MP配線: クリア画面の貢献ラベルは回数表記 (○○ 回接続)');
  ok(appM.indexOf('function mpJoinRoom(codeArg)') !== -1 &&
     appM.indexOf('function mpTryInviteJoin(') !== -1 &&
     appM.indexOf('var invited = mpTryInviteJoin();') !== -1 &&
     appM.indexOf("if (!invited) setTimeout(function () { maybeTourAuto('start'); }, 600);") !== -1,
     'MP配線: 招待リンクの自動入室がブート完了後 (プール読み込み後) に組み込まれ、入室時はツアーを出さない');
  ok(appM.indexOf('function mpClearRoomParam(') !== -1 &&
     appM.indexOf("params.delete('room')") !== -1 &&
     appM.indexOf('history.replaceState(history.state') !== -1,
     'MP配線: mpClearRoomParam は room パラメータだけを replaceState で URL から消す');
  // 招待パラメータは入室中ずっと残す (LINE 内ブラウザ→Safari 開き直し対策)。
  // 消えるのはセッション終了時だけ: 退出 (mpLeaveRoom) と入室の最終失敗 (failed)
  const tijStart = appM.indexOf('function mpTryInviteJoin() {');
  const tijBody = appM.slice(tijStart, appM.indexOf('\n}', tijStart));
  ok(tijBody.indexOf('mpClearRoomParam') === -1 && tijBody.indexOf('mpJoinRoom(code)') !== -1,
     'MP配線: 自動入室はパラメータを消さずに開始する (残っている間のリロードは再入室になる)');
  const lvStart = appM.indexOf('function mpLeaveRoom() {');
  const lvBody = appM.slice(lvStart, appM.indexOf('\n}', lvStart));
  ok(lvBody.indexOf('mpClearRoomParam()') !== -1,
     'MP配線: 部屋を出たら (ホスト終了の room-ended 経由も含む) 招待パラメータを消す');
  const failStart = appM.indexOf("} else if (status === 'failed') {");
  const failBody = appM.slice(failStart, appM.indexOf("} else if (status === 'room-ended') {", failStart));
  ok(failBody.indexOf('mpClearRoomParam()') !== -1,
     'MP配線: 入室が最終的に失敗したら招待パラメータを消す (解散済みの部屋で繰り返さない)');
  ok(appM.indexOf('function mpInviteUrl(') !== -1 &&
     appM.indexOf('buildInviteUrl(location.origin, location.pathname, mp.code)') !== -1 &&
     appM.indexOf('このリンクを開くとそのまま参加できます') !== -1 &&
     appM.indexOf("部屋コード: ' + mp.code + ' https://daily-jigsaw.pages.dev'") === -1 &&
     appM.indexOf('招待リンクをコピーしました') !== -1,
     'MP配線: ロビーの共有/コピーはコード単体でなく招待リンク (origin + pathname + ?room=) を渡す');
  ok(htmlM.indexOf('招待リンクをコピー') !== -1 && htmlM.indexOf('id="mpRoomCode"') !== -1,
     'MP配線: コピーボタンは招待リンク用ラベルになり、大きな部屋コード表示は残る');
}

/* マルチプレイ: モード (協力/ターン制/レース) と次のステージの配線 */
{
  const fsX = require('fs'), pathX = require('path');
  const appX = fsX.readFileSync(pathX.join(__dirname, 'app.js'), 'utf8');
  const htmlX = fsX.readFileSync(pathX.join(__dirname, 'index.html'), 'utf8');
  const mpX = fsX.readFileSync(pathX.join(__dirname, 'mp.js'), 'utf8');
  const cssX = fsX.readFileSync(pathX.join(__dirname, 'style.css'), 'utf8');
  ok(htmlX.indexOf('id="mpModeSeg"') !== -1 && htmlX.indexOf('id="mpModeDesc"') !== -1 &&
     htmlX.indexOf('id="mpTurnBar"') !== -1 && htmlX.indexOf('id="mpTurnText"') !== -1 &&
     htmlX.indexOf('id="mpRaceBar"') !== -1 && htmlX.indexOf('id="resultTitle"') !== -1,
     'MPモード配線: ロビーのモード選択・手番バー・レース進捗バー・結果タイトルの要素がある');
  ok(appX.indexOf("var MP_MODES = ['coop', 'turn', 'race'];") !== -1 &&
     appX.indexOf('mode: mp.lobbyMode,') !== -1 &&
     appX.indexOf('mp.mode = ev.mode || \'coop\';') !== -1,
     'MPモード配線: モードはロビーで選び start イベントで全端末に一致させる');
  ok(appX.indexOf('validateGrab: function (fromId) {') !== -1 &&
     appX.indexOf("return 'not-your-turn';") !== -1 &&
     mpX.indexOf('hooks.validateGrab(fromId, ev)') !== -1,
     'MPモード配線: ターン制の grab はホスト検証 (validateGrab) で手番以外を却下する');
  ok(mpX.indexOf("case 'progress':") !== -1 && mpX.indexOf("case 'finish':") !== -1 &&
     mpX.indexOf("{ t: 'player-left', player: id }") !== -1,
     'MPモード配線: エンジンが progress/finish を検証し、対戦中の退出を player-left で seq 配信する');
  ok(appX.indexOf("case 'player-left': mpOnPlayerLeft(ev); break;") !== -1 &&
     appX.indexOf("case 'progress': mpOnRaceProgress(ev); break;") !== -1 &&
     appX.indexOf("case 'finish': mpOnRaceFinish(ev); break;") !== -1,
     'MPモード配線: 適用側が player-left / progress / finish を処理する');
  ok(appX.indexOf('function mpOnNextEvent(ev) {') !== -1 &&
     appX.indexOf("case 'next': mpOnNextEvent(ev); break;") !== -1 &&
     appX.indexOf('mp.session.hostNext({ stage: ns });') !== -1 &&
     appX.indexOf('mp.lobbyStage = ev.stage;') !== -1,
     'MPモード配線: 「つぎのステージへ」は即開始せずロビーへ戻り、ステージだけ引き継ぐ (ピース数は選び直す)');
  ok(appX.indexOf("if (mpInRoom() && mp.mode === 'race') { mpRaceAfterBoard(); return; }") !== -1 &&
     appX.indexOf("mp.session.sendEvent({ t: 'finish', elapsedSec: currentElapsed() });") !== -1 &&
     appX.indexOf('racePlacedCount(mp.pieces, state.clusters.length)') !== -1,
     'MPモード配線: レースはローカル確定のたびに進捗を数え、完成で本人の経過時間を載せた finish を送る');
  ok(appX.indexOf("if (mpInRoom() && mp.mode === 'race' && mp.finishSent) return;") !== -1 &&
     appX.indexOf("mp.mode === 'turn' && mpTurnPlayerId() !== mpMyId()") !== -1,
     'MPモード配線: レースは自分の完走後だけ入力を止め (他人の完走では止まらない)、ターン制の非手番もクライアント側で止める');
  ok(appX.indexOf("rec.race = true;") !== -1 && appX.indexOf('function mpRaceShowResult() {') !== -1 &&
     appX.indexOf('raceStandings(mp.turnOrder, mp.raceFinish, mp.leftPlayers, mp.raceProgress)') !== -1,
     'MPモード配線: レース記録は完走した全員が race 付きで書き、結果は順位表 (順位+タイム/分数/リタイア) で出す');
  ok(cssX.indexOf('#mpTurnBar') !== -1 && cssX.indexOf('#mpRaceBar') !== -1 && cssX.indexOf('#mpModeSeg') !== -1,
     'MPモード配線: style.css に手番バー・レース進捗バー・モード選択のスタイルがある');
}

/* マルチプレイ: ロビーではお題の完成図を見せない (「？」で伏せる) */
{
  const fsL = require('fs'), pathL = require('path');
  const appL = fsL.readFileSync(pathL.join(__dirname, 'app.js'), 'utf8');
  const htmlL = fsL.readFileSync(pathL.join(__dirname, 'index.html'), 'utf8');
  const cssL = fsL.readFileSync(pathL.join(__dirname, 'style.css'), 'utf8');
  ok(htmlL.indexOf('id="mpLobbyImgPh" class="card-locked-mark mp-lobby-ph">？<') !== -1,
     'MPロビー: お題の場所にはコレクション未クリアタイルと同じ「？」プレースホルダを出す');
  ok(appL.indexOf("$('mpLobbyImg').hidden = false") === -1 &&
     appL.indexOf('お題の画像を読み込めませんでした') === -1,
     'MPロビー: お題画像を表示に切り替えるコードがない (裏読み専用)');
  const fnStart = appL.indexOf('function mpRenderLobbyPuzzle() {');
  const fnBody = appL.slice(fnStart, appL.indexOf('\n}', fnStart));
  ok(fnBody.indexOf("ph.textContent = '？';") !== -1 && fnBody.indexOf('ph.hidden = false;') !== -1 &&
     fnBody.indexOf('img.hidden = true;') !== -1 && fnBody.indexOf('img.src = url;') !== -1,
     'MPロビー: 描画は「？」を出し、画像は隠したまま裏で読み込む');
  ok(cssL.indexOf('.mp-lobby-ph') !== -1 && cssL.indexOf('.mp-img-ph') === -1,
     'MPロビー: プレースホルダのスタイルは .mp-lobby-ph に移り、旧 .mp-img-ph は残っていない');
}

/* マルチプレイ改善 #1 + #7: 記録の永続化・全員への記録/報酬・ロビー復帰導線
 * (MP_IMPROVEMENTS_DESIGN #1 真因1/真因2 と #7) */
{
  const fsI = require('fs'), pathI = require('path');
  const appI = fsI.readFileSync(pathI.join(__dirname, 'app.js'), 'utf8');
  const cssI = fsI.readFileSync(pathI.join(__dirname, 'style.css'), 'utf8');
  // onClear: 記録を書いたら無条件に saveStore する (永続化は onClear の責務)
  const ocStart = appI.indexOf('function onClear() {');
  const ocBody = appI.slice(ocStart, appI.indexOf('/* ---------- クリア結果の共有', ocStart));
  ok(ocBody.indexOf('store.records.push(rec)') !== -1 &&
     ocBody.indexOf('saveStore();') > ocBody.indexOf('store.records.push(rec)') &&
     ocBody.indexOf('saveStore();') < ocBody.indexOf('persistProgress();'),
     'MP改善#1: onClear は記録を書いた直後に無条件で saveStore する (再読み込みで消えない)');
  ok(ocBody.indexOf('if (mpInRoom()) {') !== -1 && ocBody.indexOf('rec.coop = true;') !== -1 &&
     ocBody.indexOf('mpIsHost') === -1,
     'MP改善#7: coop 情報はホスト/ゲストを問わず部屋の全員の記録に付く');
  ok(ocBody.indexOf('processRewardsOnClear(isFirstStageClear)') !== -1 &&
     ocBody.indexOf('mpGuestClear') === -1,
     'MP改善#7: 報酬処理はゲストでも通常どおり走る (自分の初回判定)');
  // 注記文: 協力/ターンは全員に記録が付く文言、レース勝者はホスト/ゲスト共通
  ok(appI.indexOf('みんなの記録になります') !== -1 && appI.indexOf('あなたの記録にもなります') !== -1 &&
     appI.indexOf('あなたの記録・ごほうびはありません') === -1 &&
     appI.indexOf('このクリアはホストの記録になります') === -1,
     'MP改善#7: 結果画面の注記は「全員に記録が付く」文言に替わり、旧・ホストのみ文言は残っていない');
  ok(appI.indexOf('位でクリア！ このクリアはあなたの記録になります') !== -1 &&
     appI.indexOf('あなたの記録は付きません') === -1 &&
     appI.indexOf('ステージ記録は付きません（記録はホストが勝った時だけ付きます）') === -1,
     'MP改善#7: レースの注記は完走者全員が「あなたの記録になります」になり、旧・勝者のみ文言は残っていない');
  // ロビー復帰導線: mpBtn はセッションが生きていればロビーを開く
  ok(appI.indexOf('if (mp.session) mpShowLobby();') !== -1,
     'MP改善#1: スタート画面のボタンはセッションが生きていれば入口でなくロビーを開く');
  ok(appI.indexOf("$('mpBadge').addEventListener('click'") !== -1 &&
     appI.indexOf('if (mp.started && !mp.clearShown) return;') !== -1 &&
     cssI.indexOf('pointer-events: auto; cursor: pointer;') !== -1,
     'MP改善#1: 接続バッジはタップ可能で、対戦の合間だけロビーを開き直せる');
  // ロビーを閉じても解散しない: mpCloseModalFromNav は mpLeaveRoom を呼ばない
  const mcStart = appI.indexOf('function mpCloseModalFromNav() {');
  const mcBody = appI.slice(mcStart, appI.indexOf('\n}', mcStart));
  ok(mcBody.indexOf('mpLeaveRoom') === -1 && mcBody.indexOf("$('mpModal').hidden = true;") !== -1,
     'MP改善#1: ロビー/入口を閉じても部屋は解散しない (退出は明示操作だけ)');
  ok(appI.indexOf("$('mpLeaveBtn').addEventListener('click', function () { mpLeaveRoom(); });") !== -1,
     'MP改善#1: ロビーの「部屋を出る」は明示的に mpLeaveRoom を呼ぶ');
  // 結果画面を閉じても部屋に残る: navCloseLayer('result') の MP 分岐
  const ncStart = appI.indexOf("else if (name === 'result') {");
  const ncBody = appI.slice(ncStart, appI.indexOf("else if (name === 'collection')", ncStart));
  ok(ncBody.indexOf('if (mpInRoom())') !== -1 && ncBody.indexOf('mpUpdateBadge();') !== -1 &&
     ncBody.indexOf('goToStartScreen();') > ncBody.indexOf('mpUpdateBadge();'),
     'MP改善#1: 結果画面を閉じても協力中はスタートへ戻らずプレイ画面に残る');
  // next 適用時の saveStore 保険
  const nxStart = appI.indexOf('function mpOnNextEvent(ev) {');
  const nxBody = appI.slice(nxStart, appI.indexOf('\n}', nxStart));
  ok(nxBody.indexOf('saveStore();') !== -1 && nxBody.indexOf('saveStore();') < nxBody.indexOf('mp.lobbyStage = ev.stage;'),
     'MP改善#1: 「つぎのステージへ」の適用時にも saveStore の保険が走る');
}

/* マルチプレイ改善 #3 (改訂2): パン方式は設定で切替 + 吸着 (B2) を追加
 * v42 では2本指パン固定 (ユーザー判断で吸着なし) だったが、後に
 * 「元の1本指方式と設定で切り替えたい + 吸着も入れて」と再変更された */
{
  const fsP = require('fs'), pathP = require('path');
  const appP = fsP.readFileSync(pathP.join(__dirname, 'app.js'), 'utf8');
  const htmlP = fsP.readFileSync(pathP.join(__dirname, 'index.html'), 'utf8');
  // パン方式の設定: 既定は 'two' (2本指)、store に保存され即反映・再起動後も維持
  ok(appP.indexOf("var panMode = store.panMode === 'one' ? 'one' : 'two';") !== -1 &&
     appP.indexOf('function setPanMode(mode)') !== -1 &&
     appP.indexOf('store.panMode = panMode;') !== -1,
     'MP改善#3改訂2: パン方式は store.panMode に保存され、未保存なら2本指方式が既定');
  ok(htmlP.indexOf('data-panmode="two"') !== -1 && htmlP.indexOf('data-panmode="one"') !== -1 &&
     htmlP.indexOf('2本指でスクロール') !== -1 && htmlP.indexOf('1本指でスクロール') !== -1,
     'MP改善#3改訂2: 設定「あそびかた」にパン方式の切替ボタン (2本指/1本指) がある');
  ok(appP.indexOf("document.querySelectorAll('[data-panmode]')") !== -1 && appP.indexOf('syncPanModeButtons();') !== -1,
     'MP改善#3改訂2: パン方式ボタンが setPanMode に配線され、選択状態が同期される');
  // 'one' 方式: v41 以前の1本指パンを復活 (空き地ドラッグ / クリア後 / ピンチ復帰)
  ok(appP.indexOf("pressPending.carryTap || pressPending.isMouse || panMode === 'one'") !== -1 &&
     appP.indexOf('pressPending.moved = true;') !== -1,
     'MP改善#3改訂2: 空き地プレスはパン方式 one でパンに移行し、two では化けない');
  ok(appP.indexOf("if (ev.pointerType === 'mouse' || panMode === 'one') panStart = {") !== -1,
     'MP改善#3改訂2: クリア後の盤面はマウスに加えパン方式 one でも1本指パンできる');
  ok(appP.indexOf("wasPinch && pointers.size === 1 && panMode === 'one'") !== -1 &&
     appP.indexOf('panStart = { sx: restPt.x, sy: restPt.y, tx: view().tx, ty: view().ty };') !== -1,
     'MP改善#3改訂2: ピンチから1本指に戻ると、パン方式 one では残った指でパンを引き継ぐ');
  ok(appP.indexOf('pinch = {') !== -1 && appP.indexOf('clampZoom(pinch.scale0 * d / pinch.d0)') !== -1,
     'MP改善#3改訂2: 2本指ピンチ (中心移動=パン + 間隔=ズーム) は両方式で残る');
  ok(appP.indexOf('机を動かすときは2本指でドラッグします') !== -1,
     'MP改善#3改訂2: チュートリアルの文面は既定 (2本指方式) の説明のまま');
  // 吸着 (B2): 精密ヒット失敗時のみ・画面16px・MP では他人リース中を候補から除外
  ok(appP.indexOf('var GRAB_SUCTION_PX = 16;') !== -1 &&
     appP.indexOf('function hitClusterWithSuction(sx, sy)') !== -1 &&
     appP.indexOf('return mpInRoom() && mpLeaseBlocked(cl);') !== -1,
     'MP改善#3改訂2: 吸着は画面16px以内・MP では他人のリース中の塊を候補から外す');
  ok(appP.indexOf("if (pointerType === 'mouse') return hitCluster(sx, sy);") !== -1 &&
     appP.indexOf('grabHitCluster(p.x, p.y, ev.pointerType)') !== -1,
     'MP改善#3改訂2: 吸着はタッチ/ペンの掴み判定だけに乗り、マウスは精密判定のまま');
}

/* 端マージン (プレイ画面を一回り小さく + 設定でオンオフ):
 * iPhone Safari の端スワイプ (ブラウザバック) 対策。マージン自体は
 * CSS の #stageWrap.edge-margin が担い、切替時の視点保持は PureLogic の
 * viewAfterResizeKeepingCenter で担保する */
{
  const fsE = require('fs'), pathE = require('path');
  const appE = fsE.readFileSync(pathE.join(__dirname, 'app.js'), 'utf8');
  const htmlE = fsE.readFileSync(pathE.join(__dirname, 'index.html'), 'utf8');
  const cssE = fsE.readFileSync(pathE.join(__dirname, 'style.css'), 'utf8');
  // 純関数: 表示中心のワールド座標と絶対スケールが保たれ、fit だけ新しい値になる
  const vE = { scale: 0.2, fit: 0.2, tx: 10, ty: 20 };
  const rE = L.viewAfterResizeKeepingCenter(vE, 390, 844, 346, 800, 0.18);
  const cOldE = { x: (390 / 2 - vE.tx) / vE.scale, y: (844 / 2 - vE.ty) / vE.scale };
  const cNewE = { x: (346 / 2 - rE.tx) / rE.scale, y: (800 / 2 - rE.ty) / rE.scale };
  ok(Math.abs(cNewE.x - cOldE.x) < 1e-9 && Math.abs(cNewE.y - cOldE.y) < 1e-9 &&
     rE.scale === 0.2 && rE.fit === 0.18,
     '端マージン: viewAfterResizeKeepingCenter は表示中心のワールド座標と絶対スケールを保持し、fit だけ差し替える');
  // 逆方向 (マージンあり→なし) でも中心が保たれ、往復で元の視点に戻る
  const rE2 = L.viewAfterResizeKeepingCenter(rE, 346, 800, 390, 844, 0.2);
  ok(Math.abs(rE2.tx - vE.tx) < 1e-9 && Math.abs(rE2.ty - vE.ty) < 1e-9,
     '端マージン: マージンのオフ→オンの往復で視点がもとの tx/ty に戻る');
  // 不正な newFit は元の fit を維持する
  ok(L.viewAfterResizeKeepingCenter(vE, 390, 844, 346, 800, 0).fit === 0.2 &&
     L.viewAfterResizeKeepingCenter(vE, 390, 844, 346, 800, NaN).fit === 0.2,
     '端マージン: newFit が 0/NaN のときは元の fit を維持する');
  // 設定の保存と既定値: 旧セーブにキーが無ければオン
  ok(appE.indexOf('var edgeMargin = store.edgeMargin !== false;') !== -1 &&
     appE.indexOf('function setEdgeMargin(on)') !== -1 &&
     appE.indexOf('store.edgeMargin = edgeMargin;') !== -1,
     '端マージン: 設定は store.edgeMargin に保存され、未保存ならオンが既定');
  // 切替時はクラス付け外し + resizeStage の後で視点を保持する (fit は新しい実寸で再計算)
  ok(appE.indexOf('viewAfterResizeKeepingCenter(v, oldW, oldH, stageW, stageH, fitView().fit)') !== -1 &&
     appE.indexOf("classList.toggle('edge-margin', edgeMargin)") !== -1,
     '端マージン: 切替は edge-margin クラスの付け外し + resizeStage + 中心・スケール保持で視点をジャンプさせない');
  ok(appE.indexOf("document.querySelectorAll('[data-edgemargin]')") !== -1 &&
     appE.indexOf('syncEdgeMarginButtons();') !== -1 && appE.indexOf('applyEdgeMargin();') !== -1,
     '端マージン: ボタンが setEdgeMargin に配線され、起動時に保存済み設定が盤面へ反映される');
  ok(htmlE.indexOf('data-edgemargin="on"') !== -1 && htmlE.indexOf('data-edgemargin="off"') !== -1 &&
     htmlE.indexOf('端に余白あり') !== -1 && htmlE.indexOf('端に余白なし') !== -1,
     '端マージン: 設定「あそびかた」に余白あり/なしの切替ボタンがある');
  // CSS: 承認済みモックの数値 (左右22 / 上20 / 下24 / 角丸16)
  ok(cssE.indexOf('#stageWrap.edge-margin') !== -1 &&
     cssE.indexOf('inset: 20px 22px 24px;') !== -1 &&
     cssE.indexOf('border-radius: 16px;') !== -1,
     '端マージン: #stageWrap.edge-margin は左右22・上20・下24px の inset と角丸16px を持つ');
  // 入力・エッジスクロール・コーチマークは rect 基準なので inset してもずれない
  ok(appE.indexOf('var r = stage.getBoundingClientRect();') !== -1 &&
     appE.indexOf('var r = el.getBoundingClientRect();') !== -1,
     '端マージン: ポインタ座標とコーチマーク位置は getBoundingClientRect 基準で、マージンに自動追随する');
}

/* マルチプレイ改善 #6: 協力/ターン制での範囲選択・一括移動 */
{
  const fsG = require('fs'), pathG = require('path');
  const appG = fsG.readFileSync(pathG.join(__dirname, 'app.js'), 'utf8');
  const mpG = fsG.readFileSync(pathG.join(__dirname, 'mp.js'), 'utf8');
  ok(mpG.indexOf("case 'grab-group-req':") !== -1 && mpG.indexOf("case 'group-drop':") !== -1 &&
     mpG.indexOf("'group-drop': 1") !== -1 && mpG.indexOf('var GROUP_GRAB_MAX = 64;') !== -1,
     'MP改善#6: エンジンが grab-group/group-drop を検証し、group-drop はチェックサム対象・上限64塊');
  ok(mpG.indexOf("t: 'grab-group', clusters:") !== -1 && mpG.indexOf('epochs[a] = (leaseEpochs[a] || 0) + 1;') !== -1,
     'MP改善#6: grab-group-req は塊ごとの epoch を割り振って grab-group に変換される');
  ok(appG.indexOf("t: 'grab-group-req', clusters: gAnchors") !== -1 &&
     appG.indexOf("t: 'group-drop', leader: leader, items: items, order: order, epochs: epochs") !== -1 &&
     appG.indexOf('function mpSettleGroupDrag()') !== -1 && appG.indexOf('function mpOnGroupDrop(ev)') !== -1 &&
     appG.indexOf('function mpOnGrabGroup(ev)') !== -1,
     'MP改善#6: グルーは一括掴み要求・一括確定・エコー待ち再送・決定論的適用を持つ');
  ok(appG.indexOf('協力/ターン制では複数塊の移動は無効で') === -1 &&
     appG.indexOf('if (inSelection && selection.size > 1) {') !== -1,
     'MP改善#6: グループドラッグの生成はソロ/協力/ターン制で共通 (旧・無効化ゲートは撤去)');
  ok(appG.indexOf("rej.evType === 'grab-group-req'") !== -1 && appG.indexOf("rej.evType === 'group-drop'") !== -1,
     'MP改善#6: 一括掴み/一括移動の却下では全塊を掴み位置へ巻き戻す');
  // applyClusterDrop の noSnap (追随塊用): グリッド吸着せず合体判定だけ行う。
  // 1.4 は相対スナップ範囲 (0.35) の外なので、通常 drop はグリッド吸着 (→1)
  // で初めて合体し、noSnap ではそのまま残って合体しない
  const mkC = (pieces, gx, gy) => ({ pieces: pieces, surface: 'desk', gx: gx, gy: gy });
  const b1 = [mkC([0], 0, 0), mkC([1], 5, 5)];
  const ns = L.applyClusterDrop(b1, b1[1], 1.4, 0, 4, null, { noSnap: true });
  ok(!ns.merged && ns.cluster.gx === 1.4 && ns.cluster.gy === 0,
     'MP改善#6: noSnap ではグリッド吸着せず、正しい相対位置でなければ合体しない');
  const b2 = [mkC([0], 0, 0), mkC([1], 5, 5)];
  const sn = L.applyClusterDrop(b2, b2[1], 1.4, 0, 4, null);
  ok(sn.merged && sn.clusters.length === 1,
     'MP改善#6: 通常の drop は従来どおりグリッド吸着して合体する (noSnap は任意引数)');
  const b3 = [mkC([0], 0, 0), mkC([1], 5, 5)];
  const ex = L.applyClusterDrop(b3, b3[1], 1, 0, 4, null, { noSnap: true });
  ok(ex.merged && ex.clusters.length === 1,
     'MP改善#6: noSnap でも正確な相対位置なら合体する (追随塊の合体)');
}

/* マルチプレイ改善 #2: ゴースト補間・中継 coalesce・ping 集約・確定待ち枠 */
{
  const fsS = require('fs'), pathS = require('path');
  const appS = fsS.readFileSync(pathS.join(__dirname, 'app.js'), 'utf8');
  const mpS = fsS.readFileSync(pathS.join(__dirname, 'mp.js'), 'utf8');
  ok(appS.indexOf('var MP_GHOST_INTERP_MS = 120;') !== -1 &&
     appS.indexOf('function mpGhostPos(m, now)') !== -1 &&
     appS.indexOf('fx: curM.x, fy: curM.y, tx: data.x, ty: data.y') !== -1,
     'MP改善#2: ゴーストは最新位置へ即ジャンプせず 120ms 線形補間で描く (定数で A/B 切替)');
  ok(mpS.indexOf('var EPH_COALESCE_MS = 33;') !== -1 &&
     mpS.indexOf('function createEphCoalescer(send, intervalMs)') !== -1 &&
     mpS.indexOf("ephCoalescer.push(gid, m.kind + ':' + fromPeer.playerId") !== -1 &&
     mpS.indexOf('var EPH_COALESCE_KINDS = { move: 1, cursor: 1 };') !== -1,
     'MP改善#2: ホスト中継は move/cursor を宛先別 coalesce し、ping 等は即時のまま');
  const peStart = appS.indexOf("kind === 'ping' && data");
  const peBody = appS.slice(peStart, appS.indexOf("kind === 'lobby'", peStart));
  ok(peBody.indexOf('requestDraw();') !== -1 && peBody.indexOf(' draw();') === -1,
     'MP改善#2: ping 受信も即時 draw でなく requestDraw に統一');
  ok(appS.indexOf('sctx.setLineDash([6, 4]);') !== -1 &&
     appS.indexOf('drag.mpGrabbed') !== -1 &&
     appS.indexOf('mp.myLeases[clusterAnchorId(c)] == null') !== -1,
     'MP改善#2: 自分の掴みが確定待ちの間は弱い破線枠で予告表示する');
}

/* マルチプレイ改善 #5: 履歴ガード (根での戻るは2回で離脱) */
{
  const fsH = require('fs'), pathH = require('path');
  const appH = fsH.readFileSync(pathH.join(__dirname, 'app.js'), 'utf8');
  const cssH = fsH.readFileSync(pathH.join(__dirname, 'style.css'), 'utf8');
  ok(appH.indexOf("try { history.replaceState({ djNav: 'start' }, ''); } catch (e) { /* ignore */ }") !== -1 &&
     appH.indexOf("try { history.pushState({ djNav: 'start' }, ''); } catch (e) { /* ignore */ } // ガードエントリ") !== -1,
     'MP改善#5: 起動時に根エントリ + ガードエントリを1枚余分に積む');
  ok(appH.indexOf('function navHandleRootBack()') !== -1 &&
     appH.indexOf('もう一度戻ると終了します') !== -1 &&
     appH.indexOf('history.back(); // 離脱を許可する') !== -1,
     'MP改善#5: 根での初回 popstate は積み直し + トースト、武装中の2回目で離脱を許可する');
  const hpStart = appH.indexOf('function handlePopstate() {');
  const hpBody = appH.slice(hpStart, appH.indexOf("var top = navTop();", hpStart));
  ok(hpBody.indexOf('if (navStale > 0) { navStale--; return; }') !== -1 &&
     hpBody.indexOf('navHandleRootBack();') > hpBody.indexOf('navStale--'),
     'MP改善#5: 古エントリの消化 (navStale) が先で、消化し切った根 popstate だけがガード処理に入る');
  const npStart = appH.indexOf('function navPush(name) {');
  const npBody = appH.slice(npStart, appH.indexOf('\n}', npStart));
  ok(npBody.indexOf('navExitArmed = false;') !== -1 && npBody.indexOf('navExitArmed = false;') < npBody.indexOf('navStack.push(name);'),
     'MP改善#5: 画面遷移 (navPush) で離脱の武装は解除される');
  ok(cssH.indexOf('overscroll-behavior: none;') !== -1 &&
     cssH.indexOf('#stage { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none;') !== -1,
     'MP改善#5: overscroll-behavior / touch-action の現行設定は維持されている');
}

/* レース進捗とターン進行 (PureLogic) */
{
  ok(L.racePlacedCount(36, 36) === 0, 'レース進捗: 初期状態 (全バラ) は 0');
  ok(L.racePlacedCount(36, 13) === 23, 'レース進捗: はめた数 = 全ピース数 − 塊の数 (36-13=23)');
  ok(L.racePlacedCount(36, 1) === 35, 'レース進捗: 完成時は 全ピース数 − 1');
  ok(L.racePlacedCount(16, 1) === 15, 'レース進捗: 16ピース完成時は 15');
  const order = ['host', 'g1', 'g2'];
  ok(L.nextTurnIndex(order, {}, 0) === 1, 'ターン: 次は参加順の2人目');
  ok(L.nextTurnIndex(order, {}, 2) === 0, 'ターン: 末尾からは先頭へ回る');
  ok(L.nextTurnIndex(order, { g1: true }, 0) === 2, 'ターン: 退出済みの人は飛ばす');
  ok(L.nextTurnIndex(order, { g1: true, g2: true }, 0) === 0, 'ターン: 自分以外全員退出なら自分のまま');
  ok(L.nextTurnIndex([], {}, 0) === 0 && L.nextTurnIndex(order, null, 1) === 2, 'ターン: 空の並び・leftSet なしでも壊れない');
}

/* 招待リンク: ?room= パラメータ解析と URL 組み立て (PureLogic) */
{
  ok(L.inviteRoomCode('?room=ABC123') === 'ABC123', '招待: 正常なコードを取り出す');
  ok(L.inviteRoomCode('?debug=1&room=XYZ789') === 'XYZ789', '招待: 他のパラメータがあっても room を拾う');
  ok(L.inviteRoomCode('room=ABC123&x=1') === 'ABC123', '招待: 先頭の ? がなくてもよい');
  ok(L.inviteRoomCode('?room=abc123') === 'ABC123', '招待: 小文字は大文字にそろえる');
  ok(L.inviteRoomCode('?room=ABCI23') === null, '招待: Crockford にない文字 (I) は不正');
  ok(L.inviteRoomCode('?room=ABCO23') === null, '招待: Crockford にない文字 (O) は不正');
  ok(L.inviteRoomCode('?room=ABC12!') === null, '招待: 記号を含むコードは不正');
  ok(L.inviteRoomCode('?room=ABC12') === null, '招待: 5文字は長さ違いで不正');
  ok(L.inviteRoomCode('?room=ABC1234') === null, '招待: 7文字は長さ違いで不正');
  ok(L.inviteRoomCode('?room=') === null, '招待: 空のコードは不正');
  ok(L.inviteRoomCode('') === null && L.inviteRoomCode('?') === null &&
     L.inviteRoomCode('?foo=bar') === null && L.inviteRoomCode(null) === null,
     '招待: パラメータなしは null (通常起動)');
  ok(L.buildInviteUrl('https://daily-jigsaw.pages.dev', '/', 'ABC123') ===
     'https://daily-jigsaw.pages.dev/?room=ABC123',
     '招待: URL は origin + pathname + ?room=コード で組む');
  ok(L.buildInviteUrl('http://localhost:8931', '/index.html', 'XYZ789') ===
     'http://localhost:8931/index.html?room=XYZ789',
     '招待: pathname が /index.html の環境でもそのまま組む');
}

/* プロフィール (MP改善#4): 正規化 (PureLogic) と保存・共有・表示の配線 */
{
  ok(typeof L.normalizeProfile === 'function', 'MP改善#4: normalizeProfile が PureLogic にある');
  ok(L.normalizeProfile(null) === null && L.normalizeProfile(undefined) === null &&
     L.normalizeProfile('x') === null && L.normalizeProfile({}) === null,
     'MP改善#4: 未設定・空は null (現行表示にフォールバック)');
  const np1 = L.normalizeProfile({ name: '  たろう  ', icon: 'piece', color: 4 });
  ok(np1 && np1.name === 'たろう' && np1.icon === 'piece' && np1.color === 4,
     'MP改善#4: 名前・アイコン・色を通し、名前の前後空白を落とす');
  ok(L.normalizeProfile({ name: 'あいうえおかきくけ' }).name === 'あいうえおかきく',
     'MP改善#4: 名前は8文字で切る');
  ok(L.normalizeProfile({ name: '   ' }) === null, 'MP改善#4: 空白だけの名前は未設定扱い');
  ok(L.normalizeProfile({ icon: 'cat' }) === null && L.normalizeProfile({ icon: 'butterfly' }) === null,
     'MP改善#4: 確定セット外のアイコン (ねこ/ちょうは除外済み) は落とす');
  ok(L.PROFILE_ICON_IDS.length === 10 && L.PROFILE_ICON_IDS.indexOf('piece') !== -1 &&
     L.PROFILE_ICON_IDS.indexOf('bell') !== -1,
     'MP改善#4: アイコンは確定10点 (パズル〜すず)');
  ok(L.normalizeProfile({ color: 7 }).color === 7 && L.normalizeProfile({ color: 8 }) === null &&
     L.normalizeProfile({ color: -1 }) === null && L.normalizeProfile({ color: 2.9 }).color === 2,
     'MP改善#4: 色は 0..7 の整数だけを通す');
  const fsP = require('fs'), pathP = require('path');
  const appP = fsP.readFileSync(pathP.join(__dirname, 'app.js'), 'utf8');
  const htmlP = fsP.readFileSync(pathP.join(__dirname, 'index.html'), 'utf8');
  const mpP = fsP.readFileSync(pathP.join(__dirname, 'mp.js'), 'utf8');
  const cssP = fsP.readFileSync(pathP.join(__dirname, 'style.css'), 'utf8');
  ok(appP.indexOf("var MP_COLORS = ['#d9532b', '#2470c9', '#2f9e5f', '#8b46c7', '#b07d10', '#c94f7c', '#178a8a', '#8a5a33'];") !== -1 &&
     appP.indexOf("var MP_COLOR_NAMES = ['あか', 'あお', 'みどり', 'むらさき', 'おうど', 'もも', 'みず', 'ちゃ'];") !== -1,
     'MP改善#4: パレットは既存4色の順序を保ったまま8色に拡張');
  ok(appP.indexOf('store.profile = normalizeProfile(store.profile);') !== -1,
     'MP改善#4: store.profile は読み込み時に正規化される (旧セーブは null)');
  ok(appP.indexOf('function mpSendMyProfile()') !== -1 &&
     appP.indexOf('mp.session.setProfile(store.profile)') !== -1 &&
     appP.indexOf("status === 'open'") !== -1,
     'MP改善#4: プロフィールはセッションの setProfile で共有し、open で送り直す');
  ok(appP.indexOf('function mpOpenProfileEditor()') !== -1 &&
     appP.indexOf('function mpAvatarHtml(') !== -1 &&
     appP.indexOf('function mpAvatarSvgString(') !== -1,
     'MP改善#4: 編集シートとアバター描画の関数がある');
  ok(appP.indexOf("if (pr && pr.name) return pr.name;") !== -1,
     'MP改善#4: mpPlayerName はプロフィール名を優先する');
  ok(htmlP.indexOf('id="mpProfileModal"') !== -1 && htmlP.indexOf('id="mpProfName"') !== -1 &&
     htmlP.indexOf('id="mpProfIcons"') !== -1 && htmlP.indexOf('id="mpProfColors"') !== -1 &&
     htmlP.indexOf('id="mpProfileEditBtn"') !== -1 && htmlP.indexOf('id="mpProfileEditBtnLobby"') !== -1,
     'MP改善#4: 入口/ロビーのプロフィール行と編集シートの要素がある');
  ok(mpP.indexOf("msg.t === 'profile'") !== -1 && mpP.indexOf('profiles: profiles') !== -1 &&
     mpP.indexOf('resolveProfileColors') !== -1 && mpP.indexOf('var MP_LOGIC_VERSION') === -1,
     'MP改善#4: mp.js は profile を名簿で保持し welcome に同梱、色を調停する');
  ok(appP.indexOf('var MP_LOGIC_VERSION = 5;') !== -1,
     'MP改善#4: profile は追加型でバージョンを上げなかった (その後ハンデで 4、レース完走方式で 5 に上げた)');
  ok(cssP.indexOf('.mp-avatar') !== -1 && cssP.indexOf('.mp-prof-icons') !== -1 &&
     cssP.indexOf('#mpTurnDot.has-icon') !== -1,
     'MP改善#4: style.css にアバターと編集シートのスタイルがある');
  // アイコン SVG が確定10点ぶん app.js に埋め込まれている (gen_sample.py の ICONS が正)
  const iconIds = ['piece', 'star', 'flower', 'leaf', 'moon', 'bird', 'fish', 'mushroom', 'acorn', 'bell'];
  ok(iconIds.every(function (id) { return appP.indexOf("{ id: '" + id + "', name: '") !== -1; }),
     'MP改善#4: アイコン定義が10点そろっている');
}

/* 貢献度: くっつける操作の回数 = その drop で消えた塊の数
 * (mpOnDrop は applyClusterDrop 適用前後の state.clusters.length 差分で数える。
 *  ここでは実 PureLogic の applyClusterDrop で同じ差分を検証する) */
{
  var mkCl = function (pieces, gx, gy) { return { pieces: pieces, surface: 'desk', gx: gx, gy: gy }; };
  // 合体しない移動だけ: 塊数は変わらない → +0
  var s1 = [mkCl([0], 0, 0), mkCl([5], 10, 10)];
  var r1 = L.applyClusterDrop(s1, s1[1], 20, 20, 4, null);
  ok(s1.length - r1.clusters.length === 0 && !r1.merged, '貢献度: 合体なし (移動だけ) は 0');
  // バラ同士の合体 → +1
  var s2 = [mkCl([0], 0, 0), mkCl([1], 10, 10)];
  var r2 = L.applyClusterDrop(s2, s2[1], 1, 0, 4, null);
  ok(s2.length - r2.clusters.length === 1, '貢献度: バラ同士の合体は +1');
  // 大きな塊同士 (4+4) の合体でも消える塊は1つ → +1
  var s3 = [mkCl([0, 1, 4, 5], 0, 0), mkCl([2, 3, 6, 7], 2, 0)];
  var r3 = L.applyClusterDrop(s3, s3[0], 0, 0, 4, null);
  ok(s3.length - r3.clusters.length === 1, '貢献度: 大同士 (4+4) をくっつけても +1');
  // チェーン合体: バラを2つの塊の間に置いて両方取り込む → +2
  var s4 = [mkCl([0], 0, 0), mkCl([2], 2, 0), mkCl([1], 10, 10)];
  var r4 = L.applyClusterDrop(s4, s4[2], 1, 0, 4, null);
  ok(s4.length - r4.clusters.length === 2, '貢献度: チェーンで2塊取り込んだら +2');
}

/* レースのハンデ (RACE_HANDICAP_DESIGN + ユーザー決定でプラス方向のみ):
 * 段階 0..+4 は一辺 n への加算、実効ピース数 = (min(n + 段階, 32))² */
{
  const fsH = require('fs');
  const appH = fsH.readFileSync(__dirname + '/app.js', 'utf8');
  const mpH = fsH.readFileSync(__dirname + '/mp.js', 'utf8');
  const htmlH = fsH.readFileSync(__dirname + '/index.html', 'utf8');
  const cssH = fsH.readFileSync(__dirname + '/style.css', 'utf8');

  // 段階テーブル: 基準 36 (n=6) → 36/49/64/81/100
  ok([0, 1, 2, 3, 4].map(function (lv) { return L.handicapPieces(36, lv); }).join(',') === '36,49,64,81,100',
     'ハンデ: 基準36の段階テーブルは 36/49/64/81/100');
  // 基準 16 (n=4) → 16/25/36/49/64
  ok([0, 1, 2, 3, 4].map(function (lv) { return L.handicapPieces(16, lv); }).join(',') === '16,25,36,49,64',
     'ハンデ: 基準16の段階テーブルは 16/25/36/49/64');
  // 上限: n=32 で頭打ち (1024)、基準900 (n=30) +4 でも 1024
  ok(L.handicapPieces(1024, 4) === 1024 && L.handicapPieces(900, 4) === 1024,
     'ハンデ: 一辺は32で頭打ち (実効ピース数は最大1024)');
  // 非平方数の基準はそのまま返す / 不正な段階は 0 扱い
  ok(L.handicapPieces(30, 2) === 30 && L.handicapPieces(36, -1) === 36 && L.handicapPieces(36, 9) === 36,
     'ハンデ: 非平方数の基準は不変、不正な段階はハンデなしとして扱う');
  // 段階の無害化
  ok(L.sanitizeHandicapLevel(0) === 0 && L.sanitizeHandicapLevel(4) === 4 &&
     L.sanitizeHandicapLevel(5) === null && L.sanitizeHandicapLevel(-1) === null &&
     L.sanitizeHandicapLevel(2.5) === null && L.sanitizeHandicapLevel('2') === null &&
     L.normalizeHandicap(undefined) === 0 && L.normalizeHandicap(3) === 3,
     'ハンデ: 段階の無害化は整数 0..4 のみ通し、保存値の正規化は不正値を 0 に落とす');
  // racePiecesMap: 全員分の実効ピース数。段階が無い人は基準のまま
  var pm = L.racePiecesMap(36, ['host', 'g1', 'g2'], { host: 0, g1: 2, g2: 4 });
  ok(pm.host === 36 && pm.g1 === 64 && pm.g2 === 100,
     'ハンデ: racePiecesMap は各人の段階から実効ピース数を出す');
  var pm2 = L.racePiecesMap(36, ['host', 'g1'], {});
  ok(pm2.host === 36 && pm2.g1 === 36, 'ハンデ: 段階の申告が無い人は基準ピース数');
  // sanitizePiecesMap: 到達可能な値だけ・全員分そろっていること
  ok(L.sanitizePiecesMap({ host: 36, g1: 64 }, ['host', 'g1'], 36) !== null &&
     L.sanitizePiecesMap({ host: 36, g1: 50 }, ['host', 'g1'], 36) === null &&
     L.sanitizePiecesMap({ host: 36 }, ['host', 'g1'], 36) === null &&
     L.sanitizePiecesMap(null, ['host'], 36) === null,
     'ハンデ: piecesMap の検証は到達可能な平方数 + 全員分そろった場合のみ通す');
  // 同じ実効ピース数なら盤面シードが一致する (date + pieces で決定的)
  var seedA = L.generateEdges('2026-11-17', L.handicapPieces(36, 2));
  var seedB = L.generateEdges('2026-11-17', 64);
  ok(JSON.stringify(seedA) === JSON.stringify(seedB),
     'ハンデ: 実効ピース数が同じなら辺形状 (盤面) が一致する');
  // コレクション装飾: 最高ティアで決める (盤面密度とは分離)
  var rec = function (pieces) { return { pieces: pieces }; };
  ok(L.bestFrameTier([rec(100), rec(144)]) === 'bronze',
     'ハンデ: 100 の bronze 記録がある絵は 144 の記録があっても装飾は銅のまま');
  ok(L.bestFrameTier([rec(144)]) === null && L.bestFrameTier([]) === null,
     'ハンデ: 非標準ピース数だけの記録では装飾は付かない');
  ok(L.bestFrameTier([rec(225), rec(400)]) === 'gold' && L.bestFrameTier([rec(1024), rec(400)]) === 'royal',
     'ハンデ: 最高ティアは silver < gold < royal の順で選ばれる');
  ok(L.frameTierPieces('bronze') === 100 && L.frameTierPieces('silver') === 225 &&
     L.frameTierPieces('gold') === 400 && L.frameTierPieces('royal') === 1024 && L.frameTierPieces(null) === 0,
     'ハンデ: ティア→代表ピース数の換算');
  // 配線: ロビーのハンデ節とチップ、名簿バッジ
  ok(htmlH.indexOf('id="mpHandicapBlock"') !== -1 && htmlH.indexOf('id="mpHandicapSeg"') !== -1 &&
     htmlH.indexOf('id="mpHandicapNote"') !== -1 && htmlH.indexOf('あなたのハンデ（レース）') !== -1,
     'ハンデ配線: ロビーに自分のハンデ節 (チップ + 注記) がある');
  ok(appH.indexOf('function mpRenderHandicap()') !== -1 && appH.indexOf('mp-handicap-badge') !== -1 &&
     appH.indexOf('store.mpHandicap = lv;') !== -1,
     'ハンデ配線: ハンデ節の描画・名簿バッジ・保存の配線がある');
  ok(cssH.indexOf('#mpHandicapSeg') !== -1 && cssH.indexOf('.mp-handicap-badge') !== -1 &&
     cssH.indexOf('.diff-sub') !== -1,
     'ハンデ配線: style.css にハンデ節・バッジ・チップ2段目のスタイルがある');
  // 配線: start の piecesMap (レースのみ) と MP_LOGIC_VERSION 4
  ok(appH.indexOf('payload.piecesMap = racePiecesMap(mp.lobbyPieces, order, mpHandicapLevels());') !== -1 &&
     appH.indexOf('sanitizePiecesMap(ev.piecesMap, ev.order, ev.pieces)') !== -1,
     'ハンデ配線: start はレース時のみ piecesMap を載せ、受信側で検証する');
  ok(appH.indexOf('store.mpHandicap = normalizeHandicap(store.mpHandicap);') !== -1 &&
     appH.indexOf('mp.session.setHandicap(store.mpHandicap)') !== -1,
     'ハンデ配線: ハンデは store に永続化され、セッション層で共有される');
  // 配線: snapshot に basePieces / piecesMap を同梱し、再読込は自分の実効数基準
  ok(appH.indexOf('basePieces: mp.basePieces') !== -1 &&
     appH.indexOf('mp.pieces !== myPieces') !== -1,
     'ハンデ配線: snapshot の再読込判定は自分の実効ピース数基準');
  // 配線: コレクションタイルは最高ティアで装飾する
  ok(appH.indexOf('cv._tileTier = bestFrameTier(recsForKey)') !== -1 &&
     appH.indexOf('topDifficultyRecord(recsForKey)') !== -1,
     'ハンデ配線: コレクションタイルの装飾は最高ティア、盤面密度は最大ピース数の記録のまま');
  // mp.js 側: セッション層の共有とエンジンの上限検証
  ok(mpH.indexOf("msg.t === 'handicap'") !== -1 && mpH.indexOf('setHandicap: function') !== -1 &&
     mpH.indexOf('handicaps: handicaps') !== -1,
     'ハンデ配線: mp.js は {t:\'handicap\'} を横取りし welcome に同梱する');
  ok(mpH.indexOf('ev.placed > racePieces[fromId] - 1') !== -1,
     'ハンデ配線: progress の上限検証は送信者自身の実効ピース数基準');
}

/* レース完走方式 (2026-11-17 改訂): 最初の完走で終わらず、全員完走で
 * 最終結果。順位 = finish の seq 順、表示タイム = 本人の申告 elapsedSec。
 * 完走した全員が記録とごほうびをもらう */
{
  const fsR = require('fs');
  const appR = fsR.readFileSync(__dirname + '/app.js', 'utf8');
  const mpR = fsR.readFileSync(__dirname + '/mp.js', 'utf8');
  const htmlR = fsR.readFileSync(__dirname + '/index.html', 'utf8');

  // 申告タイムの検証
  ok(L.sanitizeRaceElapsed(83.9) === 83 && L.sanitizeRaceElapsed(0) === 0 &&
     L.sanitizeRaceElapsed(-1) === null && L.sanitizeRaceElapsed(NaN) === null &&
     L.sanitizeRaceElapsed('83') === null && L.sanitizeRaceElapsed(7 * 24 * 3600) === null,
     'レース完走: 申告タイムは 0 以上 7 日未満の有限数だけ通し整数秒に切り捨てる');
  // 終了判定: 全員完走で初めて true (最初の完走では終わらない)
  var rids = ['host', 'g1', 'g2'];
  var rfin = { g2: { rank: 1, elapsedSec: 50 } };
  ok(L.raceAllFinished(rids, rfin, {}) === false,
     'レース完走: 最初の1人が完走してもレースは終わらない');
  rfin.host = { rank: 2, elapsedSec: 70 };
  ok(L.raceAllFinished(rids, rfin, {}) === false,
     'レース完走: まだ対戦中の人がいれば終わらない');
  rfin.g1 = { rank: 3, elapsedSec: 65 };
  ok(L.raceAllFinished(rids, rfin, {}) === true,
     'レース完走: 全員完走で終了する');
  // 退出者はリタイアとして待機集合から外れる (記録なし)
  ok(L.raceAllFinished(rids, { g2: { rank: 1, elapsedSec: 50 }, host: { rank: 2, elapsedSec: 70 } }, { g1: true }) === true,
     'レース完走: 退出者は待たずに終了できる (リタイア)');
  ok(L.raceAllFinished(rids, {}, { g1: true, g2: true }) === false &&
     L.raceAllFinished([], {}, {}) === false,
     'レース完走: 完走者ゼロ (全員退出) や参加者なしでは成立しない');
  // 順位表: 完走者は順位順、対戦中は進捗が多い順、リタイアは最後
  var rrows = L.raceStandings(rids,
    { g1: { rank: 2, elapsedSec: 65 }, g2: { rank: 1, elapsedSec: 50 } },
    {}, { host: 9, g1: 15, g2: 15 });
  ok(rrows.map(function (r) { return r.id; }).join(',') === 'g2,g1,host' &&
     rrows[0].rank === 1 && rrows[0].elapsedSec === 50 &&
     rrows[2].finished === false && rrows[2].placed === 9,
     'レース完走: 順位表は完走者を順位 + タイムで並べ、対戦中は後ろに置く');
  var rrows2 = L.raceStandings(rids, { host: { rank: 1, elapsedSec: 40 } }, { g2: true }, { g1: 3 });
  ok(rrows2.map(function (r) { return r.id; }).join(',') === 'host,g1,g2' &&
     rrows2[2].left === true && rrows2[1].left === false,
     'レース完走: 順位表でリタイアは最後に回る');
  // 配線: finish の集計 (全員分・順位つき) と終了確定
  ok(appR.indexOf('mp.raceFinish[id] = { rank: rank, elapsedSec: sanitizeRaceElapsed(ev.elapsedSec) };') !== -1 &&
     appR.indexOf('if (!id || mp.raceFinish[id]) return;') !== -1 &&
     appR.indexOf('if (id === mpMyId()) {') !== -1,
     'レース完走配線: finish は全員分を順位付きで集計し、二重申告は数えず、自分の確定で onClear へ進む');
  ok(appR.indexOf('function mpCheckRaceDone() {') !== -1 &&
     appR.indexOf('raceAllFinished(mp.turnOrder, mp.raceFinish, mp.leftPlayers)') !== -1 &&
     appR.indexOf("showToast('レースが終了しました。最終結果は接続バッジから見られます');") !== -1,
     'レース完走配線: 全員完走で最終結果に確定し、結果画面を閉じている完走者にはトーストで知らせる');
  ok(appR.indexOf("$('resultNextBtn').hidden = !mpIsHost() || !mp.raceDone;") !== -1,
     'レース完走配線: 「つぎのステージへ」は全員完走が確定するまで出ない');
  ok(appR.indexOf('raceFinish: mp.raceFinish, raceDone: mp.raceDone,') !== -1 &&
     appR.indexOf('if (id === mpMyId() && !myBoardDone) return;') !== -1,
     'レース完走配線: snapshot は完走集計を持ち、再入室者は自分だけ完走済みにしない (他人の順位・タイムは復元する)');
  ok(appR.indexOf("if (mp.mode === 'race' && mp.raceDone) {") !== -1 &&
     appR.indexOf('リタイア') !== -1,
     'レース完走配線: レース終了後は接続バッジから最終結果を見直せ、退出者はリタイア表示になる');
  ok(mpR.indexOf('ev.elapsedSec !== undefined') !== -1,
     'レース完走配線: エンジンは finish の elapsedSec の形を検証する');
  ok(htmlR.indexOf('レースは勝者のみ') === -1 && htmlR.indexOf('レースもクリアした全員に付きます') !== -1 &&
     appR.indexOf("mp.session.sendEvent({ t: 'finish' });") === -1 &&
     appR.indexOf('あなたの記録は付きません') === -1,
     'レース完走配線: 旧・勝者のみ仕様の文言と finish 送信は残っていない');
}

/* マルチプレイ: BGM 同期の配線 (開始時に同じセットリストを全員で始める。
 * 進行共有はシード + 開始時刻 + 時間軸の純関数のみで、対戦中の同期通信
 * (ハートビート相乗り・ホストのスケジューラ共有) は存在しない) */
{
  const fsB = require('fs'), pathB = require('path');
  const appB = fsB.readFileSync(pathB.join(__dirname, 'app.js'), 'utf8');
  const mpB = fsB.readFileSync(pathB.join(__dirname, 'mp.js'), 'utf8');
  // 規範リストの実データ: 全曲に実測秒が付き、合計は全曲ぶん (約71分)
  const tbStart = appB.indexOf('var BGM_TRACKS = [');
  const tbBlock = appB.slice(tbStart, appB.indexOf('];', tbStart));
  const secVals = [];
  tbBlock.replace(/sec: ([0-9.]+)/g, function (m, v) { secVals.push(Number(v)); return m; });
  const fileCount = (tbBlock.match(/file: '/g) || []).length;
  ok(fileCount === 20 && secVals.length === 20 && secVals.every(function (v) { return v > 0; }),
     'BGM同期配線: BGM_TRACKS の全20曲に実測秒 (sec) が付いている (Ocean Memory は人の声が入っていたため 2026-11-21 削除)');
  const secSum = secVals.reduce(function (s, v) { return s + v; }, 0);
  ok(secSum > 4050 && secSum < 4150, 'BGM同期配線: 実測秒の合計が全曲ぶん (約68分) になっている');
  // start ペイロードに規範リスト + シードが載る
  ok(appB.indexOf('files: BGM_TRACKS.map(function (t) { return t.file; })') !== -1 &&
     appB.indexOf('secs: BGM_TRACKS.map(function (t) { return t.sec; })') !== -1 &&
     appB.indexOf('seed: Math.floor(Math.random() * 4294967296)') !== -1,
     'BGM同期配線: start に規範リスト (ファイル名+実測秒) と共有シードが載る');
  // 受信側は検証してから使い、既に鳴っているなら開始経過の位置へ切り替える
  ok(appB.indexOf('mp.bgmSync = sanitizeBgmSync(ev.bgmSync);') !== -1 &&
     appB.indexOf('if (mp.bgmSync && bgmOn && bgm.started) bgmSyncSeek(bgmSyncElapsed());') !== -1,
     'BGM同期配線: start の受信で規範リストを検証し、再生中なら共有位置へ切り替える');
  // snapshot にも同梱され、途中参加・再入室で復元される
  ok(appB.indexOf('bgmSync: mp.bgmSync,') !== -1 &&
     appB.indexOf('if (snap.bgmSync) mp.bgmSync = sanitizeBgmSync(snap.bgmSync);') !== -1 &&
     appB.indexOf('bgmSyncOnMatchStart();') !== -1,
     'BGM同期配線: snapshot に規範リストが同梱され、合流時に復元して位置を合わせる');
  // 開始・途中オン・タブ復帰はすべて「共有位置へのシーク」に分岐する
  ok(appB.indexOf('if (bgmSyncActive()) { bgmSyncSeek(bgmSyncElapsed()); return; }') !== -1 &&
     appB.indexOf('if (bgmSyncActive()) bgmSyncSeek(bgmSyncElapsed());') !== -1,
     'BGM同期配線: bgmStart / 再開 / 設定オン / タブ復帰が共有位置シークへ分岐する');
  // ロビー復帰・退出で同期を抜ける (曲は止めない)
  ok(appB.indexOf('bgmSyncExit(); // ロビーはローカル扱い') !== -1 &&
     appB.indexOf('bgmSyncExit(); // 部屋を出たらローカル再生に戻る') !== -1,
     'BGM同期配線: ロビー復帰と退出で同期モードを抜ける');
  // 旧方式 (定期同期通信) が入っていないこと: mp.js は BGM に一切触れず、
  // ephemeral の種別にも BGM は無い
  ok(mpB.indexOf('bgm') === -1 && appB.indexOf("kind === 'bgm'") === -1 &&
     appB.indexOf("sendEphemeral('bgm'") === -1 && appB.indexOf('bgmHeartbeat') === -1,
     'BGM同期配線: ハートビート相乗り等の定期同期通信は存在しない (mp.js は BGM 無関係)');
}

/* ============ マルチ堅牢化 (ゴースト対策 + ホスト復帰 Phase 1) ============ */
{
  const fsR = require('fs'), pathR = require('path');
  const appR = fsR.readFileSync(pathR.join(__dirname, 'app.js'), 'utf8');
  const mpR = fsR.readFileSync(pathR.join(__dirname, 'mp.js'), 'utf8');
  const htmlR = fsR.readFileSync(pathR.join(__dirname, 'index.html'), 'utf8');
  const cssR = fsR.readFileSync(pathR.join(__dirname, 'style.css'), 'utf8');

  // 準備バリアの期限 (30秒) と無応答 prune (60秒) がエンジンに配線されている
  ok(mpR.indexOf('BARRIER_TIMEOUT_MS = 30000') !== -1 &&
     mpR.indexOf('PRUNE_MS = 60000') !== -1 &&
     mpR.indexOf("onPlayerPruned(id, 'barrier')") !== -1 &&
     mpR.indexOf("onPlayerPruned(id, 'stale')") !== -1 &&
     mpR.indexOf('setPeerOpen') !== -1,
     '堅牢化: バリア期限30秒・無応答 prune 60秒・接続中表示の是正が配線されている');
  // バリア期限は start でだけ武装する (ロビーで誤発火しない)
  ok(mpR.indexOf("if (out.t === 'start') { started = true; resetBarrier(true); }") !== -1 &&
     mpR.indexOf("if (out.t === 'next') { resetBarrier(false); }") !== -1,
     '堅牢化: バリア期限は start でのみ武装し、next (ロビー復帰) では武装しない');
  // キック: シグナリング通知 + 台帳からの削除 + アプリの着地まで
  ok(mpR.indexOf("kind: 'kicked'") !== -1 &&
     mpR.indexOf('kickPlayer: kickPlayer') !== -1 &&
     appR.indexOf('mp.session.kickPlayer(p.playerId)') !== -1 &&
     appR.indexOf("status === 'kicked'") !== -1 &&
     appR.indexOf('ホストに部屋から外されました') !== -1,
     '堅牢化: キックがセッション層からアプリの着地まで配線されている');
  // 待機ベールに「誰待ちか」と外すボタン、ロビー名簿にも外すボタン
  ok(htmlR.indexOf('id="mpWaitActions"') !== -1 &&
     htmlR.indexOf('id="mpWaitLeaveBtn"') !== -1 &&
     appR.indexOf('mpRefreshWaitVeil') !== -1 &&
     appR.indexOf('さんを外す') !== -1 &&
     appR.indexOf("kb.textContent = '外す'") !== -1 &&
     cssR.indexOf('.mp-kick-btn') !== -1,
     '堅牢化: 待機ベールとロビー名簿に外すボタンがある');
  // IP 補助表示: srflx の印はホストの onPeers だけに付き、roster へは配らない
  ok(mpR.indexOf('parseSrflxAddress') !== -1 &&
     mpR.indexOf('sameLinePlayerIds') !== -1 &&
     mpR.indexOf("k !== 'sameLine'") !== -1 &&
     appR.indexOf('同じ回線から接続中') !== -1 &&
     cssR.indexOf('.mp-sameline') !== -1,
     '堅牢化: 同じ回線の印はホストだけに付き、アドレス自体は出ない');
  // ホスト復帰: 鍵ペア・welcome の公開鍵・challenge/proof・猶予・prevPlayerId
  ok(mpR.indexOf('generateHostKeyPair') !== -1 &&
     mpR.indexOf('hostPub: options.hostPublicJwk || null') !== -1 &&
     mpR.indexOf("kind: 'host-claim'") !== -1 &&
     mpR.indexOf("kind: 'host-challenge'") !== -1 &&
     mpR.indexOf("kind: 'host-proof'") !== -1 &&
     mpR.indexOf("setStatus('host-wait'") !== -1 &&
     mpR.indexOf('HOST_WAIT_MS = 60000') !== -1 &&
     mpR.indexOf('prevPlayerId: playerId || undefined') !== -1,
     '堅牢化: ホスト復帰の鍵・証明・猶予60秒・prevPlayerId が配線されている');
  // 復帰の資格情報は localStorage に保存し、入口ボタンから手動で戻る
  ok(appR.indexOf("var MP_HOST_ROOM_KEY = 'daily-jigsaw:hostRoom';") !== -1 &&
     appR.indexOf('function mpReclaimRoom()') !== -1 &&
     appR.indexOf('function mpHostRoomSave(') !== -1 &&
     htmlR.indexOf('id="mpReclaimBtn"') !== -1 &&
     htmlR.indexOf('id="mpReclaimCode"') !== -1,
     '堅牢化: 復帰の資格情報の保存と入口の戻るボタンがある');
  // 猶予の表示と文言 (残り秒数 / 是正した終了文言 / 復帰・対象外の通知)
  ok(appR.indexOf('ホストの再接続を待っています') !== -1 &&
     appR.indexOf('ホストと再接続できませんでした') !== -1 &&
     appR.indexOf('ホストが復帰しました') !== -1 &&
     appR.indexOf('対戦が始まっていた部屋には戻れません') !== -1,
     '堅牢化: 猶予カウントダウンと復帰まわりの文言が配線されている');
  // MP_LOGIC_VERSION は据え置き (追加型プロトコルで旧端末と混在安全なため)
  ok(appR.indexOf('var MP_LOGIC_VERSION = 5;') !== -1,
     '堅牢化: MP_LOGIC_VERSION は 5 のまま (上げる必要なし)');
}

/* ============ v52: 壁の高速化 / リース残留 / 再開バナー ============ */
{
  const fsV = require('fs'), pathV = require('path');
  const appV = fsV.readFileSync(pathV.join(__dirname, 'app.js'), 'utf8');
  const mpV = fsV.readFileSync(pathV.join(__dirname, 'mp.js'), 'utf8');
  const bodyOf = (src, start, end) => src.slice(src.indexOf(start), src.indexOf(end));

  // 壁用 URL: URL エントリは web サイズ (thumbUrl) 優先、picsum はサイズ指定
  const clev = { type: 'url', fullUrl: 'https://x/_print.jpg', thumbUrl: 'https://x/_web.jpg' };
  ok(L.wallPhotoUrl(clev, 1080) === 'https://x/_web.jpg', '壁写真: URL エントリは web サイズを優先する');
  ok(L.wallPhotoUrl({ type: 'url', fullUrl: 'https://x/f.jpg' }, 1080) === 'https://x/f.jpg', '壁写真: thumbUrl が無ければ fullUrl');
  ok(L.wallPhotoUrl({ type: 'picsum', id: 237 }, 1080) === 'https://picsum.photos/id/237/1080/1080', '壁写真: picsum はサイズ指定 URL');
  ok(L.wallPhotoUrl(null, 1080) === null, '壁写真: エントリが無ければ null');

  // 標準模様オーバーレイ: 決定的で、レコード固有のパターンとは別物
  const oe1 = L.wallOverlayEdges(36), oe2 = L.wallOverlayEdges(36);
  ok(eq(oe1.h, oe2.h) && eq(oe1.v, oe2.v), '標準模様: 同じピース数なら決定的に一致する');
  const recE = L.generateEdges('2026-11-08', 36);
  ok(!eq(oe1.h, recE.h), '標準模様: レコード (日付シード) の模様とは別パターン');
  ok(L.wallOverlayKey(36, 288) === '36:288' && L.wallOverlayKey(36, 960) !== L.wallOverlayKey(36, 288), '標準模様: キーはピース数×サイズ');

  // オーバーレイキャッシュ: 同じキーは使い回し (再生成されない)、上限で古いものから捨てる
  const oc = L.createWallOverlayCache(2);
  oc.set('a', 1); oc.set('b', 2);
  ok(oc.get('a') === 1 && oc.size() === 2, '標準模様キャッシュ: 入れたものが返る');
  oc.set('a', 3);
  ok(oc.size() === 2 && oc.get('a') === 3, '標準模様キャッシュ: 同じキーの再登録では件数が増えない');
  oc.set('c', 4);
  ok(oc.size() === 2 && !oc.has('b') && oc.has('c'), '標準模様キャッシュ: 上限で古いものから捨てる');

  // 壁の配線: 額と帯と壁共有は高速版、詳細とコレクションは実レンダラーのまま
  const paintWallBody = bodyOf(appV, 'function paintWallFrameUnit(', 'function renderWallBoardCanvas(');
  ok(paintWallBody.indexOf('renderWallBoardFast(rec)') !== -1, '壁高速化: 壁の額は高速盤面で描く');
  const overlayBody = bodyOf(appV, 'function wallSeamOverlay(', 'function renderWallBoardFast(');
  ok(overlayBody.indexOf('wallOverlayCache.get(key)') !== -1 && overlayBody.indexOf('wallOverlayEdges(pieces)') !== -1 &&
     overlayBody.indexOf('detailPiecePath(') !== -1 && overlayBody.indexOf('strokePieceBevel(') !== -1,
     '壁高速化: オーバーレイはキャッシュ優先で、実レンダラーと同じ部品 (輪郭パス+ベベル) で作る');
  const fastBody = bodyOf(appV, 'function renderWallBoardFast(', '/* 完成盤面を指定サイズで描く');
  ok(fastBody.indexOf('loadWallSource(rec)') !== -1 && fastBody.indexOf('wallSeamOverlay(rec.pieces, px)') !== -1,
     '壁高速化: 高速盤面は写真1回描画 + オーバーレイ重ね');
  const shareFrameBody = bodyOf(appV, 'function buildShareFrameCanvas(', 'function buildWallShareImage()');
  ok(shareFrameBody.indexOf('renderWallBoardFast(rec, boardPx)') !== -1, '壁高速化: 帯と壁共有画像も高速盤面');
  const detailSrcBody = bodyOf(appV, 'function loadDetailSource(', 'function loadWallSource(');
  ok(detailSrcBody.indexOf('entryPhotoUrl(') !== -1, '壁高速化: 詳細モーダルの写真は原寸のまま (画質を落とさない)');
  const wallSrcBody = bodyOf(appV, 'function loadWallSource(', 'function loadSquareSource(');
  ok(wallSrcBody.indexOf('wallPhotoUrl(') !== -1, '壁高速化: 壁の写真は web サイズ優先で読む');
  const detailBoardBody = bodyOf(appV, 'function paintDetailBoard(', 'function renderDetailPuzzle(');
  ok(detailBoardBody.indexOf('generateEdges(r.date, r.pieces)') !== -1, '壁高速化: 詳細モーダルの盤面は実レンダラーのまま変えない');

  // リース残留: アプリ側の配線 (エンジン側の挙動は mp-test [20])
  const advBody = bodyOf(appV, 'function mpAdvanceTurn()', 'function mpOnPlayerLeft(');
  ok(advBody.indexOf('releasePlayerLeases') !== -1 && advBody.indexOf('setTimeout(') !== -1 && advBody.indexOf('mpIsHost()') !== -1,
     'リース残留: 手番交代でホストが前の手番者のリースを全解放する (適用中を避けて遅延実行)');
  const onDropBody = bodyOf(appV, 'function mpOnDrop(ev)', '/* grab-group の適用');
  ok(onDropBody.indexOf('delete mp.myLeases[ev.cluster]') !== -1, 'リース残留: drop 確定エコーで myLeases を消す');
  const onGroupDropBody = bodyOf(appV, 'function mpOnGroupDrop(ev)', '/* ---------- ターン制 ---------- */');
  ok(onGroupDropBody.indexOf('delete mp.myLeases[it.cluster]') !== -1, 'リース残留: group-drop 確定エコーで myLeases を消す');
  const onRejectBody = bodyOf(appV, 'function mpOnReject(rej)', 'function mpOnEphemeral(');
  ok(onRejectBody.indexOf('delete mp.myLeases[a2]') !== -1 && onRejectBody.indexOf('delete mp.myLeases[a]') !== -1,
     'リース残留: drop / group-drop の却下でも myLeases を消す');
  ok(mpV.indexOf('function queueLeaseReleaseOnReject(') !== -1 && mpV.indexOf('function flushLeaseReleases(') !== -1 &&
     mpV.indexOf('function releaseAllLeasesOf(') !== -1 && mpV.indexOf('releasePlayerLeases: releaseAllLeasesOf') !== -1 &&
     mpV.indexOf('engine.releasePlayerLeases(bk.playerId)') !== -1,
     'リース残留: エンジンの却下時解放・一括解放・再入室時解放が配線されている');

  // 再開バナー: 起動時に出さず、机に入って約4秒だけ。MP では出さない
  ok(appV.indexOf("$('resumeBanner').hidden = !state.resumed;") === -1 && appV.indexOf('hideResumeBanner(); // 起動時は出さない') !== -1,
     '再開バナー: 起動時の表示状態セットは廃止');
  const showBannerBody = bodyOf(appV, 'function showResumeBanner()', 'function hideResumeBanner()');
  ok(showBannerBody.indexOf('mpInRoom()') !== -1 && showBannerBody.indexOf('}, 4000);') !== -1,
     '再開バナー: MP 中は出さず、約4秒で自動で消える');
  const openBoxBody = bodyOf(appV, 'function openBox()', '/* スタート画面の表示内容');
  ok(openBoxBody.indexOf('if (state.resumed) showResumeBanner();') !== -1, '再開バナー: 机に入った瞬間にだけ出す');
  const loadPuzzleBody = bodyOf(appV, 'function mpLoadPuzzle(', 'function mpOnBegin()');
  ok(loadPuzzleBody.indexOf('hideResumeBanner();') !== -1, '再開バナー: MP の盤面ロードで隠す');
}

/* ============ v53: 現像モード / 手触り ============ */
{
  const fsW = require('fs'), pathW = require('path');
  const appW = fsW.readFileSync(pathW.join(__dirname, 'app.js'), 'utf8');
  const htmlW = fsW.readFileSync(pathW.join(__dirname, 'index.html'), 'utf8');
  const bodyOfW = (src, start, end) => src.slice(src.indexOf(start), src.indexOf(end));

  // プレイスタイルの正規化: 'develop' だけが現像、それ以外は全部ふつう
  ok(L.normalizePlayMode('develop') === 'develop', '現像: develop はそのまま');
  ok(L.normalizePlayMode('normal') === 'normal' && L.normalizePlayMode(undefined) === 'normal' &&
     L.normalizePlayMode('weird') === 'normal' && L.normalizePlayMode(null) === 'normal',
     '現像: 未知値・未保存は normal に落とす');

  // 現像済み集合の復元: 2ピース以上の塊のピースだけが現像済み
  const rev = L.developRevealedFromClusters([
    { pieces: [1, 2], gx: 0, gy: 0 }, { pieces: [3], gx: 0, gy: 0 }, { pieces: [4, 5, 6], gx: 0, gy: 0 }
  ]);
  ok(eq(rev.slice().sort(), [1, 2, 4, 5, 6]), '現像: 復元は塊 (2+) のピースだけ');
  ok(eq(L.developRevealedFromClusters([]), []) && eq(L.developRevealedFromClusters(null), []), '現像: 空・null は空集合');

  // 合体ラダー: 初回は 0、短時間の連続で上がり、間が空くと戻る
  ok(L.mergeLadderStep(0, 0, 1000) === 0, 'ラダー: 初回は 0');
  ok(L.mergeLadderStep(0, 1000, 2000) === 1 && L.mergeLadderStep(1, 2000, 4999) === 2, 'ラダー: 3秒以内の連続で上がる');
  ok(L.mergeLadderStep(5, 1000, 4001) === 0, 'ラダー: 3秒を超えたらリセット');
  ok(L.mergeLadderStep(98, 1000, 1500) === 99 && L.mergeLadderStep(99, 1500, 2000) === 99, 'ラダー: 上限で止まる');
  ok(L.MERGE_LADDER_FREQS.length >= 4 && L.MERGE_LADDER_FREQS.every((f, i, a) => i === 0 || f > a[i - 1]),
     'ラダー: 周波数表は単調増加');

  // アニメーション曲線・進行度は 0..1 にクランプされる
  ok(L.easeOutCubic(0) === 0 && L.easeOutCubic(1) === 1 && L.easeOutCubic(-1) === 0 && L.easeOutCubic(2) === 1,
     '手触り: easeOutCubic は端点とクランプが正しい');
  ok(L.fxProgress(1000, 200, 1100) === 0.5 && L.fxProgress(1000, 200, 500) === 0 && L.fxProgress(1000, 200, 9999) === 1,
     '手触り: fxProgress は 0..1 に収まる');
  ok(L.fxProgress(0, 200, 1100) === 1 && L.fxProgress(1000, 0, 1100) === 1, '手触り: 不正な開始・長さは完了扱い');

  // 配線: モード切替 (HTML + JS)、白ピース描画、現像の永続化
  // v56: スタート画面のピース数/モードはチップ列からセレクトボックスへ変更
  ok(htmlW.indexOf('id="playModeSel"') !== -1 && htmlW.indexOf('id="difficultySel"') !== -1 &&
     htmlW.indexOf('id="difficultySeg"') === -1 && htmlW.indexOf('id="playModeSeg"') === -1,
     'トップ改修: ピース数とモードはセレクトボックスで、チップの置き場は無い');
  ok(htmlW.indexOf('id="modeInfoModal"') !== -1 && htmlW.indexOf('img/mode-normal.jpg') !== -1 &&
     htmlW.indexOf('img/mode-develop.jpg') !== -1 && htmlW.indexOf('id="modeInfoBtn"') !== -1,
     'トップ改修: モード説明は ⓘ ダイアログ (実画面の画像つき) の中だけに置く');
  ok(appW.indexOf('function onDifficultySelect()') !== -1 && appW.indexOf('function onPlayModeSelect()') !== -1 &&
     appW.indexOf("$('difficultySel').addEventListener('change', onDifficultySelect)") !== -1 &&
     appW.indexOf("$('playModeSel').addEventListener('change', onPlayModeSelect)") !== -1,
     'トップ改修: セレクトの変更ハンドラが配線されている');
  ok(appW.indexOf("o.textContent = d + 'ピース' + star + (cleared ? ' ✓' : '');") !== -1,
     'トップ改修: 難易度の選択肢に ★ とクリア済み ✓ が入る');
  ok(htmlW.indexOf('id="startPrefs"') !== -1 && htmlW.indexOf('id="startPrefsBtn"') !== -1 &&
     appW.indexOf("$('startPrefsBtn').addEventListener('click'") !== -1,
     'トップ改修: みため・おとは畳める置き場にまとめた');
  ok(appW.indexOf('function buildPlayModeSeg()') !== -1 && appW.indexOf('function onPlayModeChip(') !== -1 &&
     appW.indexOf('buildPlayModeSeg();') !== -1, '現像: モードチップの構築と切替が配線されている');
  ok(appW.indexOf('prog.dev = !!state.devMode;') !== -1 && appW.indexOf('dev: !!state.devMode,') !== -1,
     '現像: ランのモードが進行セーブとクリア記録に残る');
  const drawClusterBody = bodyOfW(appW, 'function drawClusterOn(', '/* マット画面');
  ok(drawClusterBody.indexOf('pieceBitmapPaper(id)') !== -1 && drawClusterBody.indexOf('devPieceAlpha(id, cl)') !== -1,
     '現像: 描画は白ピースの上に現像分だけ絵を重ねる');
  ok(appW.indexOf('function renderPieceBitmapPaper(') !== -1 && appW.indexOf('bitmapsPaper') !== -1,
     '現像: 白ピースビットマップの生成とキャッシュがある');
  const mpStateBody = bodyOfW(appW, 'function mpLoadPuzzle(', 'function mpOnBegin()');
  ok(mpStateBody.indexOf('devMode: false') !== -1, '現像: MP の盤面は現像モード対象外');

  // 配線: 手触り (影・吸い付き・沈み・ラダー音・完成の光)
  ok(appW.indexOf('function drawHeldShadow(') !== -1 && appW.indexOf('function clusterShadowCanvas(') !== -1 &&
     appW.indexOf('liftPx: 9 * liftP') !== -1, '手触り: 持ち上げ中の影と浮きが描画に配線されている');
  const settleBody = bodyOfW(appW, 'function settleDrag()', '/* 範囲選択のグループ確定');
  ok(settleBody.indexOf('mergeFeedback(res.cluster, cl.pieces, cl.gx, cl.gy)') !== -1 && settleBody.indexOf('dropSettle(res.cluster)') !== -1,
     '手触り: 置いた時は吸い付き、合体しなければ沈み込み');

  // 吸い付き量 (v54 ガクン修正): 差は「自分のアンカーの最終位置」との差。
  // 合体後のアンカーが相手側でも、相手の位置ではなく吸着分だけになる
  const dPullA = L.mergePullDelta(10, 10, { col: 2, row: 2 }, { col: 2, row: 2 }, 10.3, 9.8);
  ok(Math.abs(dPullA.dx - 0.3) < 1e-9 && Math.abs(dPullA.dy - -0.2) < 1e-9,
     '手触り: 吸い付き量は自アンカー基準 (離した位置との差)');
  const dPullB = L.mergePullDelta(5, 5, { col: 1, row: 1 }, { col: 3, row: 1 }, 7.25, 5.1);
  ok(Math.abs(dPullB.dx - 0.25) < 1e-9 && Math.abs(dPullB.dy - 0.1) < 1e-9,
     '手触り: 相手アンカーでも吸い付きは吸着分だけ (塊全体をずらさない)');
  const dPullC = L.mergePullDelta(5, 5, { col: 1, row: 3 }, { col: 1, row: 1 }, 5.1, 2.8);
  ok(Math.abs(dPullC.dx - 0.1) < 1e-9 && Math.abs(dPullC.dy - -0.2) < 1e-9,
     '手触り: 縦方向のアンカー差でも吸着分だけ');
  ok(appW.indexOf('function mergePullDelta(') !== -1 &&
     drawClusterBody.indexOf('pullAnims[pj].pieces.has(id)') !== -1 &&
     appW.indexOf('mergeAnims: []') !== -1,
     '手触り: 吸い付きは動かしたピースだけに付く (v54)');
  const seMergeBody = bodyOfW(appW, 'function seMerge()', 'function seClear()');
  ok(seMergeBody.indexOf('mergeLadderStep(') !== -1 && seMergeBody.indexOf('MERGE_LADDER_FREQS') !== -1,
     '手触り: 合体音はラダーで音階が上がる');
  const onClearBody = bodyOfW(appW, 'function onClear()', '/* ---------- クリア結果の共有');
  ok(onClearBody.indexOf('state.clearGloss = ') !== -1 && onClearBody.indexOf('setTimeout(presentResult, 1000)') !== -1 &&
     onClearBody.indexOf("mp.mode === 'race'") !== -1,
     '手触り: 完成時は光の帯を見せてから記録証 (レースは即時)');
  const drawBody = bodyOfW(appW, 'function draw() {', '/* ---------- ミニマップ');
  ok(drawBody.indexOf('state.clearGloss') !== -1 && drawBody.indexOf('drawHeldShadow(cl, v, liftP)') !== -1,
     '手触り: draw() が完成の光と持ち上げ影を描く');
}

console.log('\n結果: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
