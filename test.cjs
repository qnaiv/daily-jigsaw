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
  ok(eq(L.emptyWall().catsOwned, ['c01']) && eq(L.emptyWall().catsPlaced, [{ id: 'c01', x: 0.5 }]), '猫: 新規は白猫が床の中央にいる');
  const catMig = L.normalizeWall({ owned: [], placed: [], frames: [] });
  ok(eq(catMig.catsOwned, ['c01']) && eq(catMig.catsPlaced, [{ id: 'c01', x: 0.5 }]), '猫移行: 旧セーブにも白猫が補われ床に出る');
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
  ok(eq(L.newFrameUnlocks(fw, 2), []) && eq(L.newFrameUnlocks(fw, 3), ['black']), 'フレーム: 3 回で ブラック 解放');
  ok(eq(L.newFrameUnlocks(fw, 5), ['black', 'ribbon']) && eq(L.newFrameUnlocks(fw, 12), ['black', 'ribbon', 'white', 'circle']), 'フレーム: 序盤に 色/装飾/形 が散らばって解放される');
  ok(L.newFrameUnlocks(fw, 209).length === 17 && L.newFrameUnlocks(fw, 210).length === 18, 'フレーム: 210 回で全 18 種解放');
  const fw2 = L.emptyWall();
  const added = L.applyFrameUnlocks(fw2, 12);
  ok(eq(added, ['black', 'ribbon', 'white', 'circle']) && eq(fw2.pendingUnlocks, added) && fw2.frameUnlocks.length === 6, 'フレーム: 解放が frameUnlocks と通知待ち (pendingUnlocks) に反映');
  ok(eq(L.applyFrameUnlocks(fw2, 12), []) && eq(L.applyFrameUnlocks(fw2, 4), []), 'フレーム: 解放は冪等 (再適用・巻き戻しなし)');

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
  ok(eq(L.WALLPAPERS.map(p => p.unlockAt), [0, 0, 3, 5, 8, 12, 16, 20, 25, 30, 40, 50, 60, 75, 90, 110, 130, 155, 180, 210]), '壁紙: 解放回数が仕様どおり');
  ok(L.WALLPAPERS.every(p => p.name && /^#[0-9a-f]{6}$/i.test(p.base)), '壁紙: 全種に名前と地色がある');
  ok(L.WALLPAPERS.every(p => ['solid', 'stripe', 'dot', 'floral', 'gingham', 'wood', 'brick', 'starry', 'moonlit', 'microdot'].includes(p.kind)), '壁紙: 種別は定義済みのものだけ');
  ok(L.WALLPAPERS.filter(p => p.kind === 'solid').length === 11, '壁紙: 無地は 11 種');
  ok(L.WALLPAPERS.filter(p => p.kind !== 'solid').every(p => !!p.accent), '壁紙: 柄物には柄色 (accent) がある');
  ok(L.wallpaperById('moonlit').unlockAt === 210 && L.wallpaperById('nope') === null, '壁紙: wallpaperById は実在のみ・未知は null');
  ok(L.wallpaperById('kinari').base === '#F3E9D3', '壁紙: 生成りは現行の壁色 #F3E9D3');

  // 初期状態と解放判定
  const pw = L.emptyWall();
  ok(pw.paper === 'kinari' && eq(pw.paperUnlocks, ['kinari', 'sage']) && eq(pw.pendingPaperUnlocks, []), '壁紙: 初期は 生成り 適用・kinari/sage 解放・通知なし');
  ok(eq(L.newPaperUnlocks(pw, 2), []) && eq(L.newPaperUnlocks(pw, 3), ['pink']), '壁紙: 3 回で ダスティピンク 解放');
  ok(eq(L.newPaperUnlocks(pw, 12), ['pink', 'stripe', 'blue', 'dot']), '壁紙: 12 回までの解放が表順に並ぶ');
  ok(L.newPaperUnlocks(pw, 210).length === 18, '壁紙: 210 回で全 18 種解放');
  const pw2 = L.emptyWall();
  const addedP = L.applyPaperUnlocks(pw2, 30);
  ok(addedP.length === 8 && eq(pw2.pendingPaperUnlocks, addedP) && pw2.paperUnlocks.length === 10, '壁紙: 解放が paperUnlocks と通知待ち (pendingPaperUnlocks) に反映');
  ok(eq(L.applyPaperUnlocks(pw2, 30), []) && eq(L.applyPaperUnlocks(pw2, 5), []), '壁紙: 解放は冪等 (再適用・巻き戻しなし)');

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
  ok(eq(L.WALL_SIZE_STAGES, [{ w: 1.5, h: 1.2 }, { w: 3.0, h: 1.4 }]) && L.WALL_EXPAND_CLEARS === 15, '壁拡張: 段階表 (横1.5→3.0 / 縦1.2→1.4) と解放条件 (累計15クリア)');
  ok(L.emptyWall().sizeStage === 0 && L.emptyWall().pendingExpand === false, '壁拡張: 新規セーブは段階0・拡張未通知なし');
  ok(L.spreadWallX(0.5, 1, 1.5) === 0.5 && near(L.spreadWallX(0, 1, 1.5), 1 / 6) && near(L.spreadWallX(1, 1, 3), 2 / 3), '壁拡張: 横は中心基準で広がる (中心は不動、端は内側へ)');
  ok(L.spreadWallY(1, 1, 1.4) === 1 && near(L.spreadWallY(0, 1, 1.2), 1 / 6) && near(L.spreadWallY(0.5, 1.2, 1.4), 4 / 7), '壁拡張: 縦は床基準 (床=1は不動) で上方向へ広がる');
  const legW = L.normalizeWall({ owned: ['w007'], placed: [{ id: 'w007', x: 0, y: 1 }], frames: [] });
  ok(legW.sizeStage === 0 && near(legW.placed[0].x, 1 / 6) && legW.placed[0].y === 1, '壁拡張移行: 段階制前のセーブ (1.0x1.0) は段階0の広さへ座標移行');
  const keptW = L.normalizeWall({ sizeStage: 1, owned: ['w007'], placed: [{ id: 'w007', x: 0.2, y: 0.3 }], frames: [] });
  ok(keptW.sizeStage === 1 && keptW.placed[0].x === 0.2 && keptW.placed[0].y === 0.3, '壁拡張移行: 段階が保存されたセーブは座標そのまま保持');
  const exW = L.emptyWall();
  exW.placed.push({ id: 'w007', x: 0.5, y: 0.5 });
  ok(L.applyWallExpand(exW, 14) === false && exW.sizeStage === 0, '壁拡張: 累計14クリアでは広がらない');
  ok(L.applyWallExpand(exW, 15) === true && exW.sizeStage === 1 && exW.pendingExpand === true, '壁拡張: 累計15クリアで段階1に広がり通知待ちになる');
  ok(exW.placed[0].x === 0.5 && near(exW.placed[0].y, 4 / 7), '壁拡張: 広げるとき配置は 中心x不変・床基準y で移る');
  ok(L.applyWallExpand(exW, 99) === false && exW.sizeStage === 1, '壁拡張: 段階1が上限 (無限には広がらない)');

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

  // 壁まわり改善 (2026-11-08 実機テスト): 壁でも BGM / 配置 SE / クレジット分離 / 壁紙名ラベルなし
  ok(appSrc.indexOf('function bgmOnTitle() { return uiHome && !uiWall; }') !== -1, '壁BGM: タイトル判定は壁画面を例外にする (壁では流れる)');
  const showWallBody = appSrc.slice(appSrc.indexOf('function showWall(from)'), appSrc.indexOf('function hideWall()'));
  ok(showWallBody.indexOf('bgmTryPlay()') !== -1, '壁BGM: 壁を開くたびに開始/再開を試みる');
  ok(appSrc.indexOf('function seUnplace()') !== -1 && appSrc.indexOf('sePlaceOk()') !== -1, '壁SE: 配置可否ゲートと「しまう」音がある');
  const unplaceBody = appSrc.slice(appSrc.indexOf('function unplaceWallSelected()'), appSrc.indexOf('function renderWallTray()'));
  ok(unplaceBody.indexOf('seUnplace()') !== -1, '壁SE: しまう操作で控えめな音が鳴る');
  ok(html.indexOf('id="creditsModal"') !== -1 && html.indexOf('id="settingsCreditsBtn"') !== -1 && html.indexOf('id="bgmCredits"') !== -1 && html.indexOf('id="photoCredits"') !== -1, 'クレジット: 設定のボタンと専用モーダル (一覧はモーダル側) がある');
  const settingsBlock = html.slice(html.indexOf('id="settingsModal"'), html.indexOf('id="creditsModal"'));
  ok(settingsBlock.indexOf('bgmCredits') === -1 && settingsBlock.indexOf('photoCredits') === -1 && settingsBlock.indexOf('settingsCreditsBtn') !== -1, 'クレジット: 設定シート内に長い一覧は残っていない');
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

  // 2026-11-08 追加分: 箱の柄分離 / 矢印 / 面の統合 / 共有の描画欠け対策 (ラウンド制・カルーセルは 2026-11-09 のステージ制で廃止)
  ok(appSrc2.indexOf("var pid = 'giftPat' + (uid || '')") !== -1 && appSrc2.indexOf("giftBoxSvg(BOX_PATTERNS[stageBoxPatternIndex(playStage)].id, '')") !== -1, '箱の柄: ステージ番号で柄を決める (箱は1つ)');
  ok(appSrc2.indexOf('nextWallItemUid(store.wall.placed)') !== -1 && appSrc2.indexOf('wallPlacedByUid(wallSelected.key)') !== -1, '壁配置 (PBI21): トレイは uid 付きで新規配置し、選択/しまう は uid 単位');
  ok(appSrc2.indexOf('store.wall.placed.filter(function (p) { return p.uid !== wallSelected.key; })') !== -1, '壁配置 (PBI21): しまう は選択した1点だけを戻す');
  ok(appSrc2.indexOf('function openTutorial()') !== -1 && appSrc2.indexOf('if (!store.tutorialSeen) openTutorial();') !== -1, 'チュートリアル (PBI22): 初回だけ自動表示する');
  ok(appSrc2.indexOf('store.tutorialSeen = true') !== -1 && appSrc2.indexOf("navPush('tutorial')") !== -1, 'チュートリアル (PBI22): 閉じたら既読化し、nav レイヤーで開く');
  ok(html2.indexOf('id="boxPrev"') === -1 && html2.indexOf('id="boxNext"') === -1 && html2.indexOf('class="box-single"') !== -1, '箱: 矢印ボタンは廃止し箱1つだけを出す');
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

console.log('\n結果: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
