/* mp-test.cjs — mp.js 同期エンジンの単体テスト (Node)
 * インメモリバスでホスト + ゲスト2台をつなぎ、モックゲームで検証する。
 * 合体ロジック自体は対象外 (モックの drop は座標の確定のみ)。
 * 実行: node mp-test.cjs
 */
'use strict';
const MP = require('./mp.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ok -', name); }
  else { failed++; console.log('  FAIL -', name); }
}
function eq(a, b, name) { ok(a === b, name + ' (=' + JSON.stringify(b) + ')'); }

/* ---------------- モックゲーム ---------------- */
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
function canonicalOf(clusters) {
  return clusters.slice().sort((a, b) => a.anchorId - b.anchorId)
    .map(c => [c.anchorId, Math.round(c.gx * 1e6), Math.round(c.gy * 1e6), c.pieces.length].join(','))
    .join('|');
}
function makeMockGame(nPieces) {
  let clusters = [];
  for (let i = 0; i < nPieces; i++) clusters.push({ anchorId: i, pieces: [i], gx: i, gy: 0 });
  const game = { nPieces };
  game.canonical = () => canonicalOf(clusters);
  game.hooks = {
    getClusters: () => clusters,
    clusterExists: id => clusters.some(c => c.anchorId === id),
    applyEvent: ev => {
      if (ev.t === 'drop') {
        const c = clusters.find(c => c.anchorId === ev.cluster);
        if (!c) throw new Error('no cluster');
        c.gx = ev.x; c.gy = ev.y;
      } else if (ev.t === 'sort') {
        ev.moves.forEach(mv => {
          const c = clusters.find(c => c.anchorId === mv.cluster);
          c.gx = mv.x; c.gy = mv.y;
        });
        const byId = {}; clusters.forEach(c => { byId[c.anchorId] = c; });
        clusters = ev.order.map(id => byId[id]);
      } else if (ev.t === 'start') {
        clusters.forEach((c, i) => { c.gx = i; c.gy = 0; });
      }
    },
    getSnapshot: () => ({ clusters: JSON.parse(JSON.stringify(clusters)) }),
    applySnapshot: snap => { clusters = JSON.parse(JSON.stringify(snap.clusters)); },
    allPieceIds: () => { const a = []; for (let i = 0; i < nPieces; i++) a.push(i); return a; },
    hashState: cs => fnv(canonicalOf(cs)),
    deskBounds: () => ({ x0: -100, y0: -100, x1: 100, y1: 100 }),
    logicVersion: 1,
    poolFingerprint: 'test-pool'
  };
  return game;
}

/* ---------------- リグ (ホスト + ゲスト2台 + バス) ---------------- */
function makeRig(opts) {
  opts = opts || {};
  const N = opts.pieces || 12;
  const hostGame = makeMockGame(N), g1Game = makeMockGame(N), g2Game = makeMockGame(N);
  const rejects = { host: [], g1: [], g2: [] };
  const dropEvTo = opts.dropEvTo || null; // { g2: Set<seq> } 配送を落とす設定
  let hostEngine, g1Engine, g2Engine;
  function deliver(to, msg) {
    if (dropEvTo && dropEvTo[to] && msg.t === 'ev' && dropEvTo[to].has(msg.seq)) return;
    const copy = JSON.parse(JSON.stringify(msg)); // 直列化を模す
    if (to === 'g1') g1Engine.receiveFromHost(copy);
    else if (to === 'g2') g2Engine.receiveFromHost(copy);
  }
  hostEngine = MP.createEngine({
    role: 'host', hooks: hostGame.hooks, now: opts.now,
    rateLimit: opts.rateLimit, leaseTimeoutMs: opts.leaseTimeoutMs,
    net: {
      broadcast: m => { deliver('g1', m); deliver('g2', m); },
      sendTo: (id, m) => deliver(id, m)
    },
    onReject: r => rejects.host.push(r)
  });
  const guestNet = id => ({ sendToHost: m => hostEngine.receive(id, JSON.parse(JSON.stringify(m))) });
  g1Engine = MP.createEngine({ role: 'guest', hooks: g1Game.hooks, now: opts.now, net: guestNet('g1'), onReject: r => rejects.g1.push(r) });
  g2Engine = MP.createEngine({ role: 'guest', hooks: g2Game.hooks, now: opts.now, net: guestNet('g2'), onReject: r => rejects.g2.push(r) });
  hostEngine.addPlayer('g1', 1, 1);
  hostEngine.addPlayer('g2', 2, 1);
  return { hostEngine, g1Engine, g2Engine, hostGame, g1Game, g2Game, rejects };
}
function allHashes(rig) {
  return [rig.hostGame, rig.g1Game, rig.g2Game].map(g => g.hooks.hashState(g.hooks.getClusters()));
}
function grabOk(engine, cluster) {
  engine.request({ t: 'grab-req', cluster });
  const lease = engine.getLease(cluster);
  return lease && lease.epoch;
}

/* ================= 1. 順序: 同時 drop でも全端末が一致 ================= */
console.log('[1] 順序と収束');
{
  const rig = makeRig();
  rig.hostEngine.hostControl({ t: 'start', stage: 1, pieces: 36 });
  const e1 = grabOk(rig.g1Engine, 3);
  const e2 = grabOk(rig.g2Engine, 7);
  const eH = grabOk(rig.hostEngine, 9);
  ok(e1 && e2 && eH, '3人とも grab 成功');
  // 「同時」drop: ゲスト2 → ホスト → ゲスト1 の順に届いても seq 順に適用される
  rig.g2Engine.request({ t: 'drop', cluster: 7, epoch: e2, x: 20.5, y: -3.25 });
  rig.hostEngine.request({ t: 'drop', cluster: 9, epoch: eH, x: -8, y: 4 });
  rig.g1Engine.request({ t: 'drop', cluster: 3, epoch: e1, x: 1.125, y: 2.5 });
  const h = allHashes(rig);
  eq(h[1], h[0], 'ゲスト1の状態ハッシュがホストと一致');
  eq(h[2], h[0], 'ゲスト2の状態ハッシュがホストと一致');
  eq(rig.g1Game.canonical(), rig.hostGame.canonical(), 'ゲスト1の canonical が一致');
  eq(rig.g2Game.canonical(), rig.hostGame.canonical(), 'ゲスト2の canonical が一致');
  eq(rig.g1Engine.getWatermark(), rig.hostEngine.getWatermark(), 'ゲスト1の watermark 一致');
  eq(rig.g2Engine.getWatermark(), rig.hostEngine.getWatermark(), 'ゲスト2の watermark 一致');
  eq(rig.rejects.g1.length + rig.rejects.g2.length + rig.rejects.host.length, 0, '却下なし');
}

/* ================= 2. リース競合と不正 drop の却下 ================= */
console.log('[2] リースと検証');
{
  const rig = makeRig();
  rig.hostEngine.hostControl({ t: 'start', stage: 1 });
  const e1 = grabOk(rig.g1Engine, 10);
  ok(!!e1, 'ゲスト1が塊10を掴んだ');
  const wmBefore = rig.hostEngine.getWatermark();

  rig.g2Engine.request({ t: 'grab-req', cluster: 10 });
  eq(rig.rejects.g2.length, 1, '他人のリース中への grab が却下される');
  eq(rig.rejects.g2[0].reason, 'leased', '却下理由は leased');
  eq(rig.hostEngine.getWatermark(), wmBefore, '却下は seq を消費しない (grab)');

  rig.g2Engine.request({ t: 'drop', cluster: 10, epoch: e1, x: 0, y: 0 });
  eq(rig.rejects.g2[1].reason, 'not-holder', '保持者でない drop が not-holder で却下');
  eq(rig.hostEngine.getWatermark(), wmBefore, '却下は seq を消費しない (drop)');

  rig.g1Engine.request({ t: 'drop', cluster: 10, epoch: e1, x: 9999, y: 0 });
  eq(rig.rejects.g1[0].reason, 'coords', '範囲外座標の drop が coords で却下');
  rig.g1Engine.request({ t: 'drop', cluster: 10, epoch: e1, x: NaN, y: 0 });
  eq(rig.rejects.g1[1].reason, 'coords', 'NaN 座標の drop が coords で却下');
  rig.g1Engine.request({ t: 'grab-req', cluster: 999 });
  eq(rig.rejects.g1[2].reason, 'no-cluster', '存在しない塊への grab が no-cluster で却下');
  rig.g1Engine.request({ t: 'drop', cluster: 10, epoch: e1 + 99, x: 0, y: 0 });
  eq(rig.rejects.g1[3].reason, 'epoch', 'epoch 不一致の drop が epoch で却下');
  eq(rig.hostEngine.getWatermark(), wmBefore, '不正イベントはどれも seq を消費しない');

  rig.g1Engine.request({ t: 'drop', cluster: 10, epoch: e1, x: 5, y: 5 });
  eq(rig.hostEngine.getWatermark(), wmBefore + 1, '正規の drop は確定する');
  const h = allHashes(rig);
  eq(h[1], h[0], '検証テスト後もゲスト1が一致');
  eq(h[2], h[0], '検証テスト後もゲスト2が一致');
}

/* ================= 3. 欠番 → snapshot 回復 ================= */
console.log('[3] 欠番と snapshot 回復');
{
  const dropSet = new Set([3, 4]); // ゲスト2へ seq 3,4 を落とす
  const rig = makeRig({ dropEvTo: { g2: dropSet } });
  rig.hostEngine.hostControl({ t: 'start', stage: 2 });              // seq 1
  const e1 = grabOk(rig.g1Engine, 1);                                  // seq 2
  rig.g1Engine.request({ t: 'drop', cluster: 1, epoch: e1, x: 3, y: 3 }); // seq 3 (g2 欠落)
  const e2 = grabOk(rig.g1Engine, 2);                                  // seq 4 (g2 欠落)
  rig.g1Engine.request({ t: 'drop', cluster: 2, epoch: e2, x: 6, y: 6 }); // seq 5 → 欠番検知
  eq(rig.g2Engine.getWatermark(), rig.hostEngine.getWatermark(), 'ゲスト2が snapshot で watermark 復帰');
  const h = allHashes(rig);
  eq(h[2], h[0], 'ゲスト2の状態ハッシュが snapshot でホストと一致');
  eq(rig.g2Game.canonical(), rig.hostGame.canonical(), 'ゲスト2の canonical が一致');
  // 回復後も通常イベントが流れる
  const e3 = grabOk(rig.g2Engine, 5);
  rig.g2Engine.request({ t: 'drop', cluster: 5, epoch: e3, x: -2, y: -2 });
  eq(allHashes(rig)[2], allHashes(rig)[0], '回復後の drop でも一致が続く');
}

/* ================= 4. リースのタイムアウト ================= */
console.log('[4] リースタイムアウト (25秒)');
{
  let fakeNow = 1000000;
  const rig = makeRig({ now: () => fakeNow, leaseTimeoutMs: 25000 });
  rig.hostEngine.hostControl({ t: 'start', stage: 1 });
  const e1 = grabOk(rig.g1Engine, 7);
  ok(!!e1, 'ゲスト1が掴んだ');
  rig.g2Engine.request({ t: 'grab-req', cluster: 7 });
  eq(rig.rejects.g2[0].reason, 'leased', 'タイムアウト前は掴めない');
  fakeNow += 26000; // 保持者からの通信が途絶えた想定
  rig.hostEngine.tick();
  eq(rig.hostEngine.getLease(7), null, '25秒途絶でリースが解放される');
  eq(rig.g2Engine.getLease(7), null, 'ゲスト側の写しも解放される');
  const e2 = grabOk(rig.g2Engine, 7);
  ok(!!e2, '解放後はゲスト2が掴める');
}

/* ================= 5. レート制限 ================= */
console.log('[5] レート制限');
{
  const rig = makeRig({ rateLimit: { max: 3, windowMs: 60000 } });
  rig.g1Engine.request({ t: 'grab-req', cluster: 1 });
  rig.g1Engine.request({ t: 'grab-req', cluster: 2 });
  rig.g1Engine.request({ t: 'grab-req', cluster: 3 });
  rig.g1Engine.request({ t: 'grab-req', cluster: 4 });
  eq(rig.rejects.g1.length, 1, '上限超えが1件却下される');
  eq(rig.rejects.g1[0].reason, 'rate', '却下理由は rate');
  eq(rig.hostEngine.getWatermark(), 3, 'seq は上限分だけ進む');
}

/* ================= 6. sort (z-order 込み) の収束 ================= */
console.log('[6] sort の収束');
{
  const rig = makeRig();
  rig.hostEngine.hostControl({ t: 'start', stage: 1 });
  const clusters = rig.g1Game.hooks.getClusters();
  const moves = clusters.slice(0, 4).map((c, i) => ({ cluster: c.anchorId, x: -10 + i, y: 8 }));
  const order = clusters.map(c => c.anchorId).reverse();
  rig.g1Engine.request({ t: 'sort', moves, order });
  eq(rig.g1Game.canonical(), rig.hostGame.canonical(), 'ゲスト1 (送信者) が一致');
  eq(rig.g2Game.canonical(), rig.hostGame.canonical(), 'ゲスト2も並び順まで一致');
  const h = allHashes(rig);
  eq(h[2], h[0], 'ハッシュも一致');
}

/* ================= 8. ホスト自身のリースは失効しない ================= */
console.log('[8] ホストのリース自己失効 (回帰)');
{
  let fakeNow = 1000000;
  const rig = makeRig({ now: () => fakeNow, leaseTimeoutMs: 25000 });
  const applied = [];
  const origApply = rig.hostGame.hooks.applyEvent;
  rig.hostGame.hooks.applyEvent = ev => { applied.push(ev); origApply(ev); };
  rig.hostEngine.hostControl({ t: 'start', stage: 1 });
  fakeNow += 30000; // 部屋を作ってから30秒 (ロビーで待つ間に過ぎる時間)
  const eH = grabOk(rig.hostEngine, 4);
  ok(!!eH, 'ホストが掴める');
  fakeNow += 500;
  rig.hostEngine.tick();
  ok(!applied.some(ev => ev.t === 'lease-expire' && ev.cluster === 4),
    'ホスト保持中のリースに lease-expire が飛ばない');
  ok(!!rig.hostEngine.getLease(4), 'tick 後もホストのリースが残る');
  // 置いて掴み直し、25秒境界をまたいでも保持できる (間欠的に掴める/掴めないの回帰)
  rig.hostEngine.request({ t: 'drop', cluster: 4, epoch: eH, x: 2, y: 2 });
  const eH2 = grabOk(rig.hostEngine, 6);
  ok(!!eH2, 'ホストが掴み直せる');
  fakeNow += 30000;
  rig.hostEngine.tick();
  ok(!!rig.hostEngine.getLease(6), '25秒経過後の再 grab も保持される');
  rig.hostEngine.request({ t: 'drop', cluster: 6, epoch: eH2, x: 3, y: 3 });
  const h = allHashes(rig);
  eq(h[1], h[0], 'ゲスト1と一致');
  eq(h[2], h[0], 'ゲスト2と一致');
}

/* ================= 9. リース中の塊が他人の drop で消えない ================= */
console.log('[9] リース中の塊の消失防止 (実 PureLogic + 実グルー適用)');
{
  const L = require('./app.js');
  const PIECES = 16, N = 4, DATE = '2026-11-11';
  function makeClient() {
    const client = { engine: null, state: { clusters: L.initialScatter(DATE, PIECES) } };
    const anchorOf = c => L.clusterAnchorId(c);
    client.hooks = {
      getClusters: () => client.state.clusters.map(c => ({ anchorId: anchorOf(c), pieces: c.pieces.slice(), gx: c.gx, gy: c.gy })),
      clusterExists: id => client.state.clusters.some(c => anchorOf(c) === id),
      applyEvent: ev => {
        if (ev.t !== 'drop') return;
        const cl = client.state.clusters.find(c => anchorOf(c) === ev.cluster);
        if (!cl) throw new Error('no cluster');
        // app.js mpOnDrop と同じ適用経路 (実物の applyClusterDrop)
        const res = L.applyClusterDrop(client.state.clusters, cl, ev.x, ev.y, N,
          c => !!client.engine.getLease(anchorOf(c)));
        client.state.clusters = res.clusters;
      },
      getSnapshot: () => ({ clusters: JSON.parse(JSON.stringify(client.hooks.getClusters())) }),
      applySnapshot: snap => {
        client.state.clusters = snap.clusters.map(c => ({ pieces: c.pieces.slice(), surface: 'desk', gx: c.gx, gy: c.gy }));
      },
      allPieceIds: () => Array.from({ length: PIECES }, (_, i) => i),
      hashState: cs => L.canonicalStateHash(cs),
      deskBounds: () => ({ x0: -100, y0: -100, x1: 100, y1: 100 }),
      logicVersion: 1, poolFingerprint: 't'
    };
    return client;
  }
  const host = makeClient(), guest = makeClient();
  host.engine = MP.createEngine({
    role: 'host', hooks: host.hooks,
    net: {
      broadcast: m => guest.engine.receiveFromHost(JSON.parse(JSON.stringify(m))),
      sendTo: (id, m) => guest.engine.receiveFromHost(JSON.parse(JSON.stringify(m)))
    }
  });
  guest.engine = MP.createEngine({
    role: 'guest', hooks: guest.hooks,
    net: { sendToHost: m => host.engine.receive('g1', JSON.parse(JSON.stringify(m))) }
  });
  host.engine.addPlayer('g1', 1, 1);
  const total = cl => cl.state.clusters.reduce((s, c) => s + c.pieces.length, 0);
  const anchorOf = c => L.clusterAnchorId(c);
  const hashesEq = () => eq(
    guest.hooks.hashState(guest.hooks.getClusters()),
    host.hooks.hashState(host.hooks.getClusters()), '両端末のハッシュが一致');

  const X = anchorOf(guest.state.clusters[0]);
  guest.engine.request({ t: 'grab-req', cluster: X });
  ok(!!host.engine.getLease(X), 'ゲストが塊Xをリース中');
  const Ycl = host.state.clusters.find(c => anchorOf(c) !== X);
  const Y = anchorOf(Ycl);
  host.engine.request({ t: 'grab-req', cluster: Y });
  host.engine.request({ t: 'drop', cluster: Y, epoch: host.engine.getLease(Y).epoch, x: Ycl.gx + 2.5, y: Ycl.gy + 1.5 });
  eq(total(host), PIECES, 'ホスト側で全ピースが残る');
  eq(total(guest), PIECES, 'ゲスト側で全ピースが残る');
  ok(host.state.clusters.some(c => anchorOf(c) === X), 'リース中の塊Xが残る');
  hashesEq();

  // リースされていない正しい隣同士は合体し、その間も X は無事
  let merged = false;
  outer:
  for (const c of host.state.clusters.slice()) {
    if (anchorOf(c) === X) continue;
    const pos = L.piecePositions(host.state.clusters, N);
    for (const p of c.pieces) {
      const hp = L.pieceHome(p, N);
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const qc = hp.col + d[0], qr = hp.row + d[1];
        if (qc < 0 || qr < 0 || qc >= N || qr >= N) continue;
        const q = qr * N + qc;
        const B = host.state.clusters.find(cc => cc.pieces.includes(q));
        if (!B || B === c || anchorOf(B) === X) continue;
        const qp = pos.get(q), pp = pos.get(p);
        if (!qp || !pp) continue;
        const anch = L.pieceHome(anchorOf(c), N);
        const tx = qp.gx - d[0] - (hp.col - anch.col);
        const ty = qp.gy - d[1] - (hp.row - anch.row);
        host.engine.request({ t: 'grab-req', cluster: anchorOf(c) });
        const lease = host.engine.getLease(anchorOf(c));
        if (!lease) continue;
        const beforeCount = host.state.clusters.length;
        host.engine.request({ t: 'drop', cluster: anchorOf(c), epoch: lease.epoch, x: tx, y: ty });
        if (host.state.clusters.length < beforeCount) { merged = true; break outer; }
      }
    }
  }
  ok(merged, 'リースされていない隣接塊とは合体する');
  eq(total(host), PIECES, '合体後もホスト側で全ピースが残る');
  eq(total(guest), PIECES, '合体後もゲスト側で全ピースが残る');
  ok(host.state.clusters.some(c => anchorOf(c) === X), '合体後もリース中の塊Xが残る');
  hashesEq();
}

/* ================= 10. 貢献度: 新しくつながったピース数だけを数える ================= */
console.log('[10] 貢献度カウント (実 PureLogic + 実グルー適用)');
{
  const L = require('./app.js');
  const PIECES = 16, N = 4, DATE = '2026-11-11';
  const anchorOf = c => L.clusterAnchorId(c);
  function makeClient() {
    const client = { engine: null, state: { clusters: L.initialScatter(DATE, PIECES) }, contrib: {} };
    client.hooks = {
      getClusters: () => client.state.clusters.map(c => ({ anchorId: anchorOf(c), pieces: c.pieces.slice(), gx: c.gx, gy: c.gy })),
      clusterExists: id => client.state.clusters.some(c => anchorOf(c) === id),
      applyEvent: ev => {
        if (ev.t !== 'drop') return;
        const cl = client.state.clusters.find(c => anchorOf(c) === ev.cluster);
        if (!cl) throw new Error('no cluster');
        // app.js mpOnDrop と同じ適用経路 + 同じ貢献度計算 (適用側で数える)
        const before = cl.pieces.length;
        const res = L.applyClusterDrop(client.state.clusters, cl, ev.x, ev.y, N,
          c => !!client.engine.getLease(anchorOf(c)));
        client.state.clusters = res.clusters;
        if (res.merged) client.contrib[ev.from] = (client.contrib[ev.from] || 0) + L.contribForDrop(before, res.cluster.pieces.length);
      },
      getSnapshot: () => ({ clusters: JSON.parse(JSON.stringify(client.hooks.getClusters())) }),
      applySnapshot: snap => { client.state.clusters = snap.clusters.map(c => ({ pieces: c.pieces.slice(), surface: 'desk', gx: c.gx, gy: c.gy })); },
      allPieceIds: () => Array.from({ length: PIECES }, (_, i) => i),
      hashState: cs => L.canonicalStateHash(cs),
      deskBounds: () => ({ x0: -100, y0: -100, x1: 100, y1: 100 }),
      logicVersion: 1, poolFingerprint: 't'
    };
    return client;
  }
  const host = makeClient(), guest = makeClient();
  host.engine = MP.createEngine({
    role: 'host', hooks: host.hooks,
    net: {
      broadcast: m => guest.engine.receiveFromHost(JSON.parse(JSON.stringify(m))),
      sendTo: (id, m) => guest.engine.receiveFromHost(JSON.parse(JSON.stringify(m)))
    }
  });
  guest.engine = MP.createEngine({
    role: 'guest', hooks: guest.hooks,
    net: { sendToHost: m => host.engine.receive('g1', JSON.parse(JSON.stringify(m))) }
  });
  host.engine.addPlayer('g1', 1, 1);

  function doDrop(engine, mover, x, y) {
    const anchor = anchorOf(mover);
    engine.request({ t: 'grab-req', cluster: anchor });
    const lease = engine.getLease(anchor);
    if (!lease) throw new Error('grab failed: ' + anchor);
    engine.request({ t: 'drop', cluster: anchor, epoch: lease.epoch, x, y });
  }
  // mover のピース p が、他塊のピース q と正しい隣 (p の home + d = q の home) に
  // なるような drop 座標を返す。無ければ null
  function adjoinCoord(clusters, mover, targetCluster) {
    const pos = L.piecePositions(clusters, N);
    for (const p of mover.pieces) {
      const hp = L.pieceHome(p, N);
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const qc = hp.col + d[0], qr = hp.row + d[1];
        if (qc < 0 || qr < 0 || qc >= N || qr >= N) continue;
        const q = qr * N + qc;
        const B = clusters.find(cc => cc.pieces.includes(q));
        if (!B || B === mover) continue;
        if (targetCluster && B !== targetCluster) continue;
        const qp = pos.get(q);
        if (!qp) continue;
        const anch = L.pieceHome(anchorOf(mover), N);
        return { x: qp.gx - d[0] - (hp.col - anch.col), y: qp.gy - d[1] - (hp.row - anch.row), other: B };
      }
    }
    return null;
  }
  const contribSum = c => Object.values(c.contrib).reduce((s, v) => s + v, 0);
  const contribEq = () => eq(JSON.stringify(host.contrib), JSON.stringify(guest.contrib), '貢献度が両端末で一致');

  // (b) バラ同士の合体: +1
  let firstPair = null;
  for (const c of host.state.clusters) { const r = adjoinCoord(host.state.clusters, c, null); if (r) { firstPair = { mover: c, coord: r }; break; } }
  ok(!!firstPair, '隣接するバラ同士が見つかる');
  doDrop(host.engine, firstPair.mover, firstPair.coord.x, firstPair.coord.y);
  eq(host.contrib.host || 0, 1, 'バラ同士の合体でホスト +1');
  contribEq();

  // (b) バラ1つを2ピースの塊へ: +1 (旧公式なら +2 になる水増しケース)
  const twoCluster = host.state.clusters.find(c => c.pieces.length === 2);
  ok(!!twoCluster, '2ピースの塊ができている');
  let attach = null;
  for (const c of host.state.clusters) {
    if (c.pieces.length !== 1) continue;
    const r = adjoinCoord(host.state.clusters, c, twoCluster);
    if (r) { attach = { mover: c, coord: r }; break; }
  }
  ok(!!attach, '2ピースの塊に付けられるバラがある');
  doDrop(guest.engine, attach.mover, attach.coord.x, attach.coord.y);
  eq(guest.contrib.g1 || 0, 1, 'バラを2ピースの塊へ付けてもゲスト +1 (付けた先のサイズは数えない)');
  contribEq();

  // (a) 合体しない移動だけの drop: +0
  const hostBefore = host.contrib.host || 0;
  const single = host.state.clusters.find(c => c.pieces.length === 1);
  const countBefore = host.state.clusters.length;
  doDrop(host.engine, single, single.gx + 5.5, single.gy + 4.5);
  eq(host.state.clusters.length, countBefore, '遠くへの drop では合体しない');
  eq(host.contrib.host || 0, hostBefore, '移動だけの drop は貢献度 +0');
  contribEq();

  // 残りを解き切る (本体が大きい手を優先し、小さい方を付ける = 終盤型の遊び方)
  function findMergeMove(clusters) {
    const pos = L.piecePositions(clusters, N);
    let best = null;
    for (const c of clusters) {
      for (const p of c.pieces) {
        const hp = L.pieceHome(p, N);
        for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const qc = hp.col + d[0], qr = hp.row + d[1];
          if (qc < 0 || qr < 0 || qc >= N || qr >= N) continue;
          const q = qr * N + qc;
          const B = clusters.find(cc => cc.pieces.includes(q));
          if (!B || B === c) continue;
          const qp = pos.get(q), pp = pos.get(p);
          if (!qp || !pp) continue;
          const hq = L.pieceHome(q, N);
          const anchC = L.pieceHome(anchorOf(c), N);
          const cx = qp.gx - d[0] - (hp.col - anchC.col), cy = qp.gy - d[1] - (hp.row - anchC.row);
          const anchB = L.pieceHome(anchorOf(B), N);
          const bx = pp.gx + d[0] - (hq.col - anchB.col), by = pp.gy + d[1] - (hq.row - anchB.row);
          const cand = c.pieces.length <= B.pieces.length ? { move: c, target: B, x: cx, y: cy } : { move: B, target: c, x: bx, y: by };
          if (!best || cand.target.pieces.length > best.target.pieces.length) best = cand;
        }
      }
    }
    return best;
  }
  let turn = 0, guard = 0;
  while (host.state.clusters.length > 1 && guard++ < 40) {
    const mv = findMergeMove(host.state.clusters);
    if (!mv) break;
    doDrop(turn % 2 === 0 ? guest.engine : host.engine, mv.move, mv.x, mv.y);
    turn++;
  }
  eq(host.state.clusters.length, 1, '16ピースを最後まで解き切れる');
  // (c) 合計が妥当な範囲 (旧公式では同じ遊び方で 100 超にもなる)
  const totalContrib = contribSum(host);
  ok(totalContrib >= PIECES - 1 && totalContrib <= PIECES * 2,
    '貢献度の合計が妥当な範囲 (実: ' + totalContrib + ' / 16ピース)');
  contribEq();
  eq(guest.hooks.hashState(guest.hooks.getClusters()), host.hooks.hashState(host.hooks.getClusters()), '最終状態のハッシュが一致');
}

/* ================= 7. ユーティリティ ================= */
console.log('[7] ユーティリティ');
{
  const code = MP.makeRoomCode(() => 0.999);
  eq(code.length, 6, '部屋コードは6文字');
  ok(/^[0-9A-HJKMNP-TV-Z]{6}$/.test(code), '部屋コードは Crockford Base32');
  eq(MP.normalizeRoomCode('o-il 123'), '011123', 'コード正規化 (O→0, I/L→1)');
  const sdp = 'v=0\r\na=fingerprint:sha-256 12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0\r\n';
  const fc = MP.fingerprintCode(sdp);
  ok(/^\d{4}$/.test(fc), '照合コードは数字4桁');
  eq(MP.fingerprintCode(sdp), fc, '照合コードは決定的');
}
MP.encodeManualCode({ v: 1, kind: 'offer', sdp: 'dummy-sdp' }).then(codeStr => {
  ok(/^[gr]\./.test(codeStr), '手動コードに接頭辞が付く');
  return MP.decodeManualCode(codeStr);
}).then(obj => {
  eq(obj.kind, 'offer', '手動コードの往復 (kind)');
  eq(obj.sdp, 'dummy-sdp', '手動コードの往復 (sdp)');
  console.log('\n' + passed + ' passed / ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}).catch(err => {
  console.error('手動コードの往復で例外:', err);
  process.exit(1);
});
