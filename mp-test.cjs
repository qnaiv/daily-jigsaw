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

/* ================= 10. 貢献度: くっつける操作の回数だけを数える ================= */
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
        // 貢献度 = その drop で消えた塊の数 (適用前後の塊数の差分)
        const clustersBefore = client.state.clusters.length;
        const res = L.applyClusterDrop(client.state.clusters, cl, ev.x, ev.y, N,
          c => !!client.engine.getLease(anchorOf(c)));
        client.state.clusters = res.clusters;
        if (res.merged) client.contrib[ev.from] = (client.contrib[ev.from] || 0) + (clustersBefore - client.state.clusters.length);
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
  // エンジン再生成 (レート制限のバケツやリースを持ち越さずシナリオを分離する)
  function wireEngines() {
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
  }

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

  // バラ1つを2ピースの塊へ: 合体1回なので +1
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
  eq(guest.contrib.g1 || 0, 1, 'バラを2ピースの塊へ付けてもゲスト +1 (合体1回ぶん)');
  contribEq();

  // (a) 合体しない移動だけの drop: +0
  const hostBefore = host.contrib.host || 0;
  const single = host.state.clusters.find(c => c.pieces.length === 1);
  const countBefore = host.state.clusters.length;
  doDrop(host.engine, single, single.gx + 5.5, single.gy + 4.5);
  eq(host.state.clusters.length, countBefore, '遠くへの drop では合体しない');
  eq(host.contrib.host || 0, hostBefore, '移動だけの drop は貢献度 +0');
  contribEq();

  // 両端末の盤面と貢献度を指定レイアウトへ差し替える (手組みシナリオ用)
  function resetClients(clusters) {
    for (const c of [host, guest]) {
      c.state.clusters = JSON.parse(JSON.stringify(clusters)).map(x => ({ pieces: x.pieces, surface: 'desk', gx: x.gx, gy: x.gy }));
      c.contrib = {};
    }
  }
  const farSingles = skip => Array.from({ length: PIECES }, (_, i) => i)
    .filter(i => !skip.includes(i))
    .map(i => ({ pieces: [i], gx: 12 + (i % 4) * 2, gy: 12 + Math.floor(i / 4) * 2 }));

  // 大きな塊同士 (4+4) の合体でも +1 (ピース数は数えない)
  resetClients([
    { pieces: [0, 1, 4, 5], gx: 0, gy: 0 },
    { pieces: [2, 3, 6, 7], gx: 2, gy: 0 },
    ...farSingles([0, 1, 2, 3, 4, 5, 6, 7])
  ]);
  const bigA = host.state.clusters.find(c => c.pieces.length === 4);
  doDrop(host.engine, bigA, 0, 0);
  eq(host.contrib.host || 0, 1, '大同士 (4+4) をくっつけてもホスト +1');
  eq(host.state.clusters.length, 9, '大同士の合体で塊は1つ減る');
  contribEq();

  // チェーン合体: バラを2つの塊の間に置くと両方取り込んで +2
  resetClients([
    { pieces: [0], gx: 0, gy: 0 },
    { pieces: [2], gx: 2, gy: 0 },
    { pieces: [1], gx: 12, gy: 12 },
    ...farSingles([0, 1, 2])
  ]);
  const midPiece = host.state.clusters.find(c => c.pieces[0] === 1);
  doDrop(guest.engine, midPiece, 1, 0);
  eq(guest.contrib.g1 || 0, 2, 'チェーンで2塊取り込んだらゲスト +2');
  contribEq();

  // 残りを解き切る (本体が大きい手を優先し、小さい方を付ける = 終盤型の遊び方)
  function findMergeMove(clusters, moveSmaller) {
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
          const smallFirst = (c.pieces.length <= B.pieces.length) === !!moveSmaller;
          const cand = smallFirst ? { move: c, target: B, x: cx, y: cy } : { move: B, target: c, x: bx, y: by };
          if (!best || cand.target.pieces.length > best.target.pieces.length) best = cand;
        }
      }
    }
    return best;
  }
  // 完走シナリオ: 遊び方を変えても全員の貢献度合計は必ず ピース数 - 1 = 15
  function solveWith(moveSmaller, label) {
    wireEngines();
    resetClients(L.initialScatter(DATE, PIECES));
    let turn = 0, guard = 0;
    while (host.state.clusters.length > 1 && guard++ < 60) {
      const mv = findMergeMove(host.state.clusters, moveSmaller);
      if (!mv) break;
      doDrop(turn % 2 === 0 ? guest.engine : host.engine, mv.move, mv.x, mv.y);
      turn++;
    }
    eq(host.state.clusters.length, 1, label + ': 16ピースを最後まで解き切れる');
    eq(contribSum(host), PIECES - 1,
      label + ': 貢献度の合計がちょうど 15 (実: ' + contribSum(host) + ')');
    contribEq();
    eq(guest.hooks.hashState(guest.hooks.getClusters()), host.hooks.hashState(host.hooks.getClusters()), label + ': 最終状態のハッシュが一致');
  }
  solveWith(true, '小さい方を付ける遊び方');
  solveWith(false, '大きい方を動かす遊び方');
}

/* ================= 11. ターン制 (実 PureLogic + 実グルーの手番導出) ================= */
console.log('[11] ターン制モード');
{
  const L = require('./app.js');
  const PIECES = 16, N = 4, DATE = '2026-11-11';
  const anchorOf = c => L.clusterAnchorId(c);
  const ORDER = ['host', 'g1', 'g2'];
  function makeClient() {
    const client = { engine: null, state: { clusters: L.initialScatter(DATE, PIECES) }, turnIdx: 0, leftPlayers: {}, rejects: [] };
    client.resolveIdx = () => {
      for (let i = 0; i < ORDER.length; i++) {
        const j = (client.turnIdx + i) % ORDER.length;
        if (!client.leftPlayers[ORDER[j]]) return j;
      }
      return client.turnIdx;
    };
    client.turnPlayer = () => ORDER[client.resolveIdx()];
    client.hooks = {
      getClusters: () => client.state.clusters.map(c => ({ anchorId: anchorOf(c), pieces: c.pieces.slice(), gx: c.gx, gy: c.gy })),
      clusterExists: id => client.state.clusters.some(c => anchorOf(c) === id),
      // app.js の hooks.validateGrab と同じ判定 (ホストのエンジンでのみ呼ばれる)
      validateGrab: fromId => (client.turnPlayer() !== fromId ? 'not-your-turn' : null),
      applyEvent: ev => {
        if (ev.t === 'drop') {
          const cl = client.state.clusters.find(c => anchorOf(c) === ev.cluster);
          if (!cl) throw new Error('no cluster');
          const res = L.applyClusterDrop(client.state.clusters, cl, ev.x, ev.y, N,
            c => !!client.engine.getLease(anchorOf(c)));
          client.state.clusters = res.clusters;
          // app.js mpOnDrop と同じ: 合体した drop でのみ手番が1つ進む
          if (res.merged) client.turnIdx = L.nextTurnIndex(ORDER, client.leftPlayers, client.resolveIdx());
        } else if (ev.t === 'player-left') {
          client.leftPlayers[ev.player] = true;
        }
      },
      getSnapshot: () => ({ clusters: JSON.parse(JSON.stringify(client.hooks.getClusters())) }),
      applySnapshot: snap => { client.state.clusters = snap.clusters.map(c => ({ pieces: c.pieces.slice(), surface: 'desk', gx: c.gx, gy: c.gy })); },
      allPieceIds: () => Array.from({ length: PIECES }, (_, i) => i),
      hashState: cs => L.canonicalStateHash(cs),
      deskBounds: () => ({ x0: -100, y0: -100, x1: 100, y1: 100 }),
      logicVersion: 2, poolFingerprint: 't'
    };
    return client;
  }
  const host = makeClient(), g1 = makeClient(), g2 = makeClient();
  const clients = { host, g1, g2 };
  function wire(client, role, id) {
    client.engine = MP.createEngine({
      role, hooks: client.hooks,
      net: role === 'host' ? {
        broadcast: m => { g1.engine.receiveFromHost(JSON.parse(JSON.stringify(m))); g2.engine.receiveFromHost(JSON.parse(JSON.stringify(m))); },
        sendTo: (pid, m) => clients[pid].engine.receiveFromHost(JSON.parse(JSON.stringify(m)))
      } : { sendToHost: m => host.engine.receive(id, JSON.parse(JSON.stringify(m))) },
      onReject: r => client.rejects.push(r)
    });
  }
  wire(host, 'host'); wire(g1, 'guest', 'g1'); wire(g2, 'guest', 'g2');
  host.engine.addPlayer('g1', 1, 1);
  host.engine.addPlayer('g2', 2, 1);
  host.engine.hostControl({ t: 'start', stage: 1, pieces: PIECES, mode: 'turn', order: ORDER });

  function doDrop(engine, mover, x, y) {
    const anchor = anchorOf(mover);
    engine.request({ t: 'grab-req', cluster: anchor });
    const lease = engine.getLease(anchor);
    if (!lease) throw new Error('grab failed: ' + anchor);
    engine.request({ t: 'drop', cluster: anchor, epoch: lease.epoch, x, y });
  }
  function adjoinCoord(clusters, mover) {
    const pos = L.piecePositions(clusters, N);
    for (const p of mover.pieces) {
      const hp = L.pieceHome(p, N);
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const qc = hp.col + d[0], qr = hp.row + d[1];
        if (qc < 0 || qr < 0 || qc >= N || qr >= N) continue;
        const q = qr * N + qc;
        const B = clusters.find(cc => cc.pieces.includes(q));
        if (!B || B === mover) continue;
        const qp = pos.get(q);
        if (!qp) continue;
        const anch = L.pieceHome(anchorOf(mover), N);
        return { x: qp.gx - d[0] - (hp.col - anch.col), y: qp.gy - d[1] - (hp.row - anch.row) };
      }
    }
    return null;
  }
  const turnsEq = label => {
    eq(g1.turnPlayer(), host.turnPlayer(), label + ': ゲスト1の手番導出がホストと一致');
    eq(g2.turnPlayer(), host.turnPlayer(), label + ': ゲスト2の手番導出がホストと一致');
  };

  // 初手はホスト。非手番の grab はホスト検証で却下される
  eq(host.turnPlayer(), 'host', 'ターン: 初手は参加順の先頭 (ホスト)');
  g1.engine.request({ t: 'grab-req', cluster: anchorOf(g1.state.clusters[0]) });
  eq(g1.rejects[g1.rejects.length - 1].reason, 'not-your-turn', 'ターン: 非手番 (ゲスト1) の grab が not-your-turn で却下');
  g2.engine.request({ t: 'grab-req', cluster: anchorOf(g2.state.clusters[0]) });
  eq(g2.rejects[g2.rejects.length - 1].reason, 'not-your-turn', 'ターン: 非手番 (ゲスト2) の grab も却下');

  // 手番のホストが合体しない drop → 手番は続く
  const single = host.state.clusters.find(c => c.pieces.length === 1);
  const countBefore = host.state.clusters.length;
  doDrop(host.engine, single, single.gx + 5.5, single.gy + 4.5);
  eq(host.state.clusters.length, countBefore, 'ターン: 遠くへの drop では合体しない');
  eq(host.turnPlayer(), 'host', 'ターン: 合体しなかった drop では手番は進まない');
  turnsEq('無合体 drop 後');

  // 手番のホストが合体する drop → 次の人へ
  let pair = null;
  for (const c of host.state.clusters) { const r = adjoinCoord(host.state.clusters, c); if (r) { pair = { mover: c, coord: r }; break; } }
  ok(!!pair, 'ターン: 合体できる手が見つかる');
  doDrop(host.engine, pair.mover, pair.coord.x, pair.coord.y);
  eq(host.turnPlayer(), 'g1', 'ターン: 合体した drop で手番がゲスト1へ進む');
  turnsEq('合体 drop 後');
  host.engine.request({ t: 'grab-req', cluster: anchorOf(host.state.clusters[0]) });
  eq(host.rejects[host.rejects.length - 1].reason, 'not-your-turn', 'ターン: 手番を渡したホストの grab は却下される');

  // ゲスト1のチェーン合体 (2塊取り込み) でも手番は1つだけ進む
  const farSingles = skip => Array.from({ length: PIECES }, (_, i) => i)
    .filter(i => !skip.includes(i))
    .map(i => ({ pieces: [i], gx: 12 + (i % 4) * 2, gy: 12 + Math.floor(i / 4) * 2 }));
  const layout = [
    { pieces: [0], gx: 0, gy: 0 },
    { pieces: [2], gx: 2, gy: 0 },
    { pieces: [1], gx: 12, gy: 12 },
    ...farSingles([0, 1, 2])
  ];
  for (const c of [host, g1, g2]) c.state.clusters = JSON.parse(JSON.stringify(layout)).map(x => ({ pieces: x.pieces, surface: 'desk', gx: x.gx, gy: x.gy }));
  const midPiece = g1.state.clusters.find(c => c.pieces[0] === 1);
  const cntBeforeChain = g1.state.clusters.length;
  doDrop(g1.engine, midPiece, 1, 0);
  eq(g1.state.clusters.length, cntBeforeChain - 2, 'ターン: チェーンで2塊取り込む');
  eq(host.turnPlayer(), 'g2', 'ターン: チェーン合体でも手番は1つだけ進む (ゲスト2へ)');
  turnsEq('チェーン後');

  // 手番プレイヤー (ゲスト2) が退出 → 手番は自動で次 (ホスト) へ
  host.engine.removePlayer('g2');
  eq(host.turnPlayer(), 'host', 'ターン: 手番プレイヤーの退出で手番が次へ進む');
  eq(g1.turnPlayer(), 'host', 'ターン: 退出後の手番導出がゲスト1でも一致');
  ok(!!g1.leftPlayers.g2 && !!host.leftPlayers.g2, 'ターン: player-left が seq 経由で全端末に届く');
  eq(g1.hooks.hashState(g1.hooks.getClusters()), host.hooks.hashState(host.hooks.getClusters()), 'ターン: 最終状態のハッシュが一致');
}

/* ================= 12. レース (進捗共有と勝者確定) ================= */
console.log('[12] レースモード (3人)');
{
  const L = require('./app.js');
  const TOTAL = 16;
  function makeRaceClient() {
    const client = { clusters: TOTAL, progress: {}, winner: null, rejects: [] };
    client.hooks = {
      getClusters: () => { const a = []; for (let i = 0; i < client.clusters; i++) a.push({ anchorId: i, pieces: [i], gx: i, gy: 0 }); return a; },
      clusterExists: id => id < client.clusters,
      applyEvent: ev => {
        // app.js の適用側と同じ: progress は写し、finish は最初の1つだけが勝者
        if (ev.t === 'progress') client.progress[ev.from] = ev.placed;
        else if (ev.t === 'finish' && !client.winner) client.winner = ev.from;
      },
      getSnapshot: () => ({ clusters: client.hooks.getClusters() }),
      applySnapshot: () => {},
      allPieceIds: () => Array.from({ length: TOTAL }, (_, i) => i),
      hashState: () => 0,
      deskBounds: () => ({ x0: -100, y0: -100, x1: 100, y1: 100 }),
      logicVersion: 2, poolFingerprint: 't'
    };
    // 自分の盤面で1回合体させる (app.js mpRaceAfterBoard と同じ報告規則)
    client.mergeOnce = () => {
      client.clusters--;
      client.engine.request({ t: 'progress', placed: L.racePlacedCount(TOTAL, client.clusters) });
      if (client.clusters === 1) client.engine.request({ t: 'finish' });
    };
    return client;
  }
  const host = makeRaceClient(), g1 = makeRaceClient(), g2 = makeRaceClient();
  const clients = { host, g1, g2 };
  function wire(client, role, id) {
    client.engine = MP.createEngine({
      role, hooks: client.hooks,
      net: role === 'host' ? {
        broadcast: m => { g1.engine.receiveFromHost(JSON.parse(JSON.stringify(m))); g2.engine.receiveFromHost(JSON.parse(JSON.stringify(m))); },
        sendTo: (pid, m) => clients[pid].engine.receiveFromHost(JSON.parse(JSON.stringify(m)))
      } : { sendToHost: m => host.engine.receive(id, JSON.parse(JSON.stringify(m))) },
      onReject: r => client.rejects.push(r)
    });
  }
  wire(host, 'host'); wire(g1, 'guest', 'g1'); wire(g2, 'guest', 'g2');
  host.engine.addPlayer('g1', 1, 1);
  host.engine.addPlayer('g2', 2, 1);
  host.engine.hostControl({ t: 'start', stage: 9, pieces: TOTAL, mode: 'race', order: ['host', 'g1', 'g2'] });

  const progressEq = label => {
    eq(JSON.stringify(g1.progress), JSON.stringify(host.progress), label + ': ゲスト1の進捗表がホストと一致');
    eq(JSON.stringify(g2.progress), JSON.stringify(host.progress), label + ': ゲスト2の進捗表がホストと一致');
  };

  g1.mergeOnce(); g1.mergeOnce();
  eq(host.progress.g1, 2, 'レース: ゲスト1のはめた数が 2 と共有される (16-14)');
  host.mergeOnce();
  eq(g2.progress.host, 1, 'レース: ホストのはめた数が 1 と共有される');
  progressEq('序盤');

  // 不正な進捗 (負数) はホスト検証で却下される
  g1.engine.request({ t: 'progress', placed: -3 });
  eq(g1.rejects[g1.rejects.length - 1].reason, 'bad-event', 'レース: 負数の進捗は bad-event で却下');
  eq(host.progress.g1, 2, 'レース: 却下された進捗は反映されない');

  // ゲスト2が先に完成 → 勝者はゲスト2で全端末一致
  for (let i = 0; i < 15; i++) g2.mergeOnce();
  eq(host.winner, 'g2', 'レース: 最初に完成したゲスト2が勝者 (ホスト側)');
  eq(g1.winner, 'g2', 'レース: 勝者がゲスト1側でも一致');
  eq(g2.winner, 'g2', 'レース: 勝者がゲスト2側でも一致');
  eq(host.progress.g2, TOTAL - 1, 'レース: 勝者のはめた数は 全ピース数 − 1 = 15');

  // ホストが遅れて完成しても勝者は覆らない (seq 順で一意)
  for (let i = 0; i < 14; i++) host.mergeOnce();
  eq(host.winner, 'g2', 'レース: 遅れた finish では勝者は変わらない (ホスト側)');
  eq(g1.winner, 'g2', 'レース: 遅れた finish では勝者は変わらない (ゲスト1側)');
  eq(g2.winner, 'g2', 'レース: 遅れた finish では勝者は変わらない (ゲスト2側)');

  // 結果集計: 3人全員分が全端末でそろう
  progressEq('最終');
  eq(JSON.stringify(host.progress), JSON.stringify({ g1: 2, host: 15, g2: 15 }),
    'レース: 最終進捗は全員分 {ホスト:15, ゲスト1:2, ゲスト2:15}');
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
/* ================= 8. 一括移動 (grab-group / group-drop) ================= */
console.log('[8] 一括移動');
function extendGroupMock(game) {
  const orig = game.hooks.applyEvent;
  game.hooks.applyEvent = ev => {
    if (ev.t === 'group-drop') {
      const cs = game.hooks.getClusters();
      ev.items.forEach(it => {
        const c = cs.find(c => c.anchorId === it.cluster);
        if (c) { c.gx = it.x; c.gy = it.y; }
      });
      const byId = {}; cs.forEach(c => { byId[c.anchorId] = c; });
      const ordered = ev.order.map(id => byId[id]).filter(Boolean);
      if (ordered.length === cs.length) cs.splice(0, cs.length, ...ordered);
    } else orig(ev);
  };
}
{
  // 原子性: 1塊でも他人が掴んでいたら全体が却下され、部分取得は起きない
  const rig = makeRig();
  [rig.hostGame, rig.g1Game, rig.g2Game].forEach(extendGroupMock);
  rig.hostEngine.hostControl({ t: 'start', stage: 1, pieces: 12 });
  const e5 = grabOk(rig.g1Engine, 5);
  ok(!!e5, '一括: ゲスト1が塊5を単独で掴んだ');
  rig.g2Engine.request({ t: 'grab-group-req', clusters: [3, 5, 7], leader: 3 });
  eq(rig.rejects.g2[rig.rejects.g2.length - 1].reason, 'leased', '一括: 他人のリースを含む一括掴みは leased で全体却下');
  ok(!rig.hostEngine.getLease(3) && !rig.hostEngine.getLease(7), '一括: 却下時に部分取得は起きない (3,7 は無リース)');
  eq(rig.hostEngine.getLease(5).holder, 'g1', '一括: 既存のリースは壊れない');
  rig.g1Engine.request({ t: 'release', cluster: 5, epoch: e5 });

  // 正常系: 一括掴み → 全端末でリース一致 → group-drop で収束
  rig.g1Engine.request({ t: 'grab-group-req', clusters: [1, 2, 3], leader: 1 });
  const L1 = rig.g1Engine.getLease(1), L2 = rig.g1Engine.getLease(2), L3 = rig.g1Engine.getLease(3);
  ok(L1 && L2 && L3 && L1.holder === 'g1', '一括: 3塊まとめてリースが付く');
  eq(rig.g2Engine.getLease(2).epoch, L2.epoch, '一括: epoch が全端末で一致');
  const order = rig.g1Game.hooks.getClusters().map(c => c.anchorId);
  rig.g1Engine.request({
    t: 'group-drop', leader: 1,
    items: [
      { cluster: 1, x: 30, y: 30 }, { cluster: 2, x: 31, y: 30 }, { cluster: 3, x: 32, y: 30 }
    ],
    order: order,
    epochs: { 1: L1.epoch, 2: L2.epoch, 3: L3.epoch }
  });
  const h = allHashes(rig);
  eq(h[1], h[0], '一括: group-drop 後にゲスト1がホストと一致');
  eq(h[2], h[0], '一括: group-drop 後にゲスト2がホストと一致');
  ok(!rig.hostEngine.getLease(1) && !rig.g1Engine.getLease(2), '一括: group-drop でリースは全て解放される');
  const moved = rig.g2Game.hooks.getClusters().find(c => c.anchorId === 3);
  eq(moved.gx, 32, '一括: 追随塊の位置も全端末で適用される');

  // 検証: 保持していない塊を含む group-drop は not-holder
  rig.g2Engine.request({
    t: 'group-drop', leader: 4,
    items: [{ cluster: 4, x: 0, y: 0 }],
    order: order, epochs: { 4: 1 }
  });
  eq(rig.rejects.g2[rig.rejects.g2.length - 1].reason, 'not-holder', '一括: リースしていない塊の group-drop は not-holder');

  // 検証: epoch 不一致は epoch、順列でない order は bad-order
  rig.g1Engine.request({ t: 'grab-group-req', clusters: [6, 7], leader: 6 });
  const M6 = rig.g1Engine.getLease(6), M7 = rig.g1Engine.getLease(7);
  rig.g1Engine.request({
    t: 'group-drop', leader: 6,
    items: [{ cluster: 6, x: 1, y: 1 }, { cluster: 7, x: 2, y: 1 }],
    order: order, epochs: { 6: M6.epoch + 9, 7: M7.epoch }
  });
  eq(rig.rejects.g1[rig.rejects.g1.length - 1].reason, 'epoch', '一括: epoch 不一致の group-drop は epoch で却下');
  rig.g1Engine.request({
    t: 'group-drop', leader: 6,
    items: [{ cluster: 6, x: 1, y: 1 }, { cluster: 7, x: 2, y: 1 }],
    order: order.slice(1), epochs: { 6: M6.epoch, 7: M7.epoch }
  });
  eq(rig.rejects.g1[rig.rejects.g1.length - 1].reason, 'bad-order', '一括: 全塊の順列でない order は bad-order');
  rig.g1Engine.request({
    t: 'group-drop', leader: 6,
    items: [{ cluster: 6, x: 1, y: 1 }, { cluster: 7, x: 2, y: 1 }],
    order: order, epochs: { 6: M6.epoch, 7: M7.epoch }
  });
  const h2 = allHashes(rig);
  eq(h2[1], h2[0], '一括: 正しい group-drop では収束する');
  eq(h2[2], h2[0], '一括: 正しい group-drop ではゲスト2も収束する');
}
{
  // ターン制の検証フック (validateGrab) が一括掴みにも効く
  const rig = makeRig();
  [rig.hostGame, rig.g1Game, rig.g2Game].forEach(extendGroupMock);
  rig.hostGame.hooks.validateGrab = fromId => (fromId === 'g2' ? 'not-your-turn' : null);
  rig.hostEngine.hostControl({ t: 'start', stage: 1, pieces: 12 });
  rig.g2Engine.request({ t: 'grab-group-req', clusters: [1, 2], leader: 1 });
  eq(rig.rejects.g2[rig.rejects.g2.length - 1].reason, 'not-your-turn', '一括: 手番以外の一括掴みは validateGrab で却下');
  rig.g1Engine.request({ t: 'grab-group-req', clusters: [1, 2], leader: 1 });
  ok(!!rig.g1Engine.getLease(1), '一括: 手番の人の一括掴みは通る');
}
{
  // 上限: 65塊は bad-event、64塊は通る
  const rig = makeRig({ pieces: 70 });
  [rig.hostGame, rig.g1Game, rig.g2Game].forEach(extendGroupMock);
  rig.hostEngine.hostControl({ t: 'start', stage: 1, pieces: 70 });
  const many = []; for (let i = 0; i < 65; i++) many.push(i);
  rig.g1Engine.request({ t: 'grab-group-req', clusters: many, leader: 0 });
  eq(rig.rejects.g1[rig.rejects.g1.length - 1].reason, 'bad-event', '一括: 上限 (64) を超える一括掴みは bad-event');
  rig.g1Engine.request({ t: 'grab-group-req', clusters: many.slice(0, 64), leader: 0 });
  ok(!!rig.g1Engine.getLease(63), '一括: 64塊ちょうどは通る');
  eq(MP.GROUP_GRAB_MAX, 64, '一括: 上限は GROUP_GRAB_MAX = 64');
}

/* ================= 9. 中継 coalesce (#2) ================= */
console.log('[9] coalesce');
{
  const sent = [];
  const co = MP.createEphCoalescer(m => sent.push(m), 33);
  eq(MP.EPH_COALESCE_MS, 33, 'coalesce: 間隔定数は 33ms (0 で無効化できる A/B 切替)');
  co.push('g1', 'move:g2', { v: 1 });
  co.push('g1', 'move:g2', { v: 2 });
  co.push('g1', 'move:g2', { v: 3 });
  co.flush();
  eq(sent.length, 1, 'coalesce: 同じ宛先×スロットは最新値だけが送られる');
  eq(sent[0].v, 3, 'coalesce: 送られるのは最後の値');
  co.push('g1', 'cursor:g2', { v: 4 });
  co.push('g2', 'move:g2', { v: 5 });
  co.flush();
  eq(sent.length, 3, 'coalesce: スロット/宛先が違えば別々に送られる');
  co.push('g1', 'move:g2', { v: 6 });
  co.dispose();
  co.flush();
  eq(sent.length, 3, 'coalesce: dispose 後は保留分が送られない');
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
