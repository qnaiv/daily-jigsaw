/* =====================================================================
 * mp.js — まいにちジグソー マルチプレイ (協力) の通信・同期エンジン
 * 設計: MULTIPLAYER_DESIGN.md v3 (§2 接続 / §3 同期プロトコル)
 *
 * バニラ JS・外部ライブラリなし。ブラウザでは window.JigsawMP を公開し、
 * Node では module.exports する (同期エンジンの単体テスト用)。
 *
 * ---------------------------------------------------------------------
 * ゲーム本体 (app.js) との接続 = フックオブジェクト (hooks)
 * ---------------------------------------------------------------------
 * createRoom / joinRoom / manualHost / manualGuest の第1引数に渡す。
 *
 * hooks = {
 *   // 現在の全クラスタを返す。要素は { anchorId, pieces:[id...], gx, gy }
 *   // anchorId は clusterAnchorId (最小ピース id) と一致すること。
 *   getClusters(): Array<Cluster>,
 *
 *   // anchorId の塊が存在するか (検証用)
 *   clusterExists(anchorId): boolean,
 *
 *   // 任意: grab-req の追加検証 (ホスト側でのみ呼ばれる)。却下理由の
 *   // 文字列を返すとその理由で却下し、null を返すと通す。
 *   // ターン制モードの「手番以外は掴めない」に使う。
 *   validateGrab(fromId, ev): string|null,
 *
 *   // seq 順に確定したイベントを自端末の状態へ適用する。
 *   // ev は { t:'grab'|'release'|'lease-expire'|'drop'|'sort'|'start'|
 *   //        'begin'|'next'|'complete'|..., from, ... } (種別ごとの追加項目つき)
 *   // meta = { seq, from }。適用に失敗したら例外を投げてよい
 *   // (ホスト側では却下、ゲスト側では snapshot 要求になる)。
 *   applyEvent(ev, meta): void,
 *
 *   // snapshot 用の全状態を返す。{ clusters:[...], ...任意 } 形式で、
 *   // clusters 以外の項目はエンジンを素通りして相手側 applySnapshot に届く。
 *   getSnapshot(): object,
 *
 *   // snapshot を自端末の状態へ置き換える (エンジンがピース集合の
 *   // 分割検証を通した後にだけ呼ばれる)。
 *   applySnapshot(snap): void,
 *
 *   // 全ピース id の配列 (snapshot の分割検証用: 重複・欠落なしを照合)
 *   allPieceIds(): Array<id>,
 *
 *   // canonical チェックサム。引数 clusters に対する決定的ハッシュで、
 *   // PureLogic の canonicalStateHash と互換であること (契約)。
 *   // 戻り値は数値でも文字列でもよい (全端末で一致すればよい)。
 *   hashState(clusters): any,
 *
 *   // 座標検証用の机範囲 { x0, y0, x1, y1 } (世界座標・セル単位、内側が有効)
 *   deskBounds(): { x0, y0, x1, y1 },
 *
 *   // バージョン照合 (M9)。値でも関数でも可。
 *   logicVersion: number|string | () => number|string,
 *   poolFingerprint: string | () => string,
 * }
 *
 * コールバック (callbacks, 任意):
 * {
 *   onStatus(status, info): 接続状態の遷移
 *     status: 'signaling' | 'waiting' | 'connecting' | 'open' | 'failed'
 *             | 'closed' | 'room-ended'
 *   onPeers(peers): 在室一覧 [{ playerId, color, isHost, connected, name, icon, handicap }]
 *     color はプロフィールの希望色をホストが調停した最終色 (パレット
 *     index)。name / icon はプロフィール未設定なら null。handicap は
 *     レース用ハンデ段階 (整数 0..+4、未申告は 0)
 *   onVerifyCode(code): 照合コード (数字4桁文字列)。ロビーで口頭照合する
 *   onReject(rej): 自分のイベントがホストに却下された { reason, evType, mid }
 *   onEvent(ev, meta): seq 確定イベントの通知 (UI 表示用。状態適用は hooks 側)
 *   onEphemeral(kind, data, fromPlayerId): cursor / move / ping / heartbeat
 *   onError(err): 回復不能なエラー通知
 * }
 *
 * セッション (createRoom 等の戻り値):
 * {
 *   role: 'host'|'guest', code, guestId, playerId, engine,
 *   sendEvent(ev): 自分の操作イベントを送る (ホスト経由で seq が振られる)
 *   sendEphemeral(kind, data): cursor 等の軽い情報を送る (順序・到達保証なし)
 *   hostStart(payload): ホスト専用。start イベントを seq 付きで配信する
 *   hostNext(payload): ホスト専用。next イベントを seq 付きで配信する
 *   setReady(): 画像ロード完了をホストへ通知する (ready バリア)
 *   setProfile(profile): 自分のプロフィール { name, icon, color } を部屋へ
 *     共有する (MP改善#4)。ev チャンネルの { t:'profile' } で送る追加型の
 *     メッセージで、ゲームイベント (seq) には混ぜない。旧クライアントは
 *     未知の種別として無視するので MP_LOGIC_VERSION は上げない
 *   setHandicap(level): 自分のレース用ハンデ段階 (0..+4) を部屋へ共有する。
 *     プロフィールと同じセッション層方式 ({ t:'handicap' }、名簿に載せて
 *     再配信、welcome に同梱)。開始の瞬間にホストが全員分から start の
 *     piecesMap を確定させる (途中変更は次の対戦から効く)
 *   leave(): 部屋を閉じる / 退出する
 * }
 * ===================================================================== */
(function () {
'use strict';

/* ------------------------------------------------------------------ *
 * 定数
 * ------------------------------------------------------------------ */
// Supabase プロジェクト "fragments" (仲介A 用)。anon key はクライアント
// 配布前提の公開鍵 (RLS / Broadcast のみで使う)。埋め込み箇所はここだけ。
var SUPABASE_URL = 'https://rfyswmtzwepazvcjxzuq.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmeXN3bXR6d2VwYXp2Y2p4enVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyODk3MDQsImV4cCI6MjEwNzg2NTcwNH0.6TrpjPOUqnhW-o41v5itr5e6-0IW2RUkacbusT50Yhc';

var STUN_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' }
];

var CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
var SIGNAL_TOPIC_PREFIX = 'realtime:jigsaw-signal:';
var CONNECT_TIMEOUT_MS = 15000;   // 接続確立のタイムアウト (§2)
var PHX_HEARTBEAT_MS = 45000;     // Phoenix チャンネルの心拍 (Supabase 節約のため 45 秒間隔、2026-11-17 ユーザー決定。サーバ側制限 ~60 秒の範囲内)
var LEASE_TIMEOUT_MS = 25000;     // リース解放の判定 (設計 §3.3: 20〜30秒)
var SNAPREQ_MIN_INTERVAL_MS = 3000;
var EPH_BUFFERED_LIMIT = 64 * 1024; // ephemeral を送らない bufferedAmount 上限
var EPH_COALESCE_MS = 33;   // ホスト中継の coalesce 間隔 (宛先別)。0 で無効 (即時中継 = 旧挙動)。A/B 切替用
var EPH_COALESCE_KINDS = { move: 1, cursor: 1 }; // coalesce 対象 (最新値だけ意味のある種別)
var PROFILE_COLOR_COUNT = 8; // プロフィールの背景色パレット数 (app.js の MP_COLORS と同数)

/* プロフィール { name, icon, color } の無害化 (MP改善#4)。ワイヤ・保存の
 * 両経路で使う。name は最大8文字 (コードポイント単位)、icon は短い
 * 英小文字 id、color はパレット index。どれも不正なら null に落とし、
 * 全て null ならプロフィール自体を null (未設定) とする */
function sanitizeProfile(p) {
  if (!p || typeof p !== 'object') return null;
  var name = null, icon = null, color = null;
  if (typeof p.name === 'string') {
    var n = Array.from(p.name.trim()).slice(0, 8).join('');
    if (n) name = n;
  }
  if (typeof p.icon === 'string' && /^[a-z0-9-]{1,32}$/.test(p.icon)) icon = p.icon;
  if (typeof p.color === 'number' && isFinite(p.color)) {
    var c = Math.floor(p.color);
    if (c >= 0 && c < PROFILE_COLOR_COUNT) color = c;
  }
  if (name == null && icon == null && color == null) return null;
  return { name: name, icon: icon, color: color };
}

/* プレイヤー識別色の調停 (MP改善#4): 参加順に、プロフィールの希望色を
 * 優先して割り当てる。希望が埋まっていれば最も近い空き色 (index の距離、
 * 同距離なら大きい方を先に見る) へ寄せる。プロフィールが無い/色未指定の
 * 人は参加順の割当色 (assigned) を希望として扱う。players は参加順の
 * [{ playerId, color }]、profiles は playerId -> sanitize 済み profile。
 * 戻り値は playerId -> 最終色 index。全クライアントが同じ入力で同じ
 * 結果になる決定的な純粋関数 (ホストが正だが、手動方式では両端末が
 * 同じ計算で一致させる) */
function resolveProfileColors(players, profiles) {
  var used = {}, out = {};
  (players || []).forEach(function (pl) {
    var assigned = (typeof pl.color === 'number' && isFinite(pl.color) &&
      pl.color >= 0 && pl.color < PROFILE_COLOR_COUNT) ? Math.floor(pl.color) : 0;
    var prof = profiles ? profiles[pl.playerId] : null;
    var desired = (prof && typeof prof.color === 'number' &&
      prof.color >= 0 && prof.color < PROFILE_COLOR_COUNT) ? Math.floor(prof.color) : assigned;
    var c = desired;
    if (used[c]) {
      c = -1;
      for (var d = 1; d < PROFILE_COLOR_COUNT; d++) {
        if (desired + d < PROFILE_COLOR_COUNT && !used[desired + d]) { c = desired + d; break; }
        if (desired - d >= 0 && !used[desired - d]) { c = desired - d; break; }
      }
      if (c < 0) c = assigned; // 空きなし (8人超) の最終フォールバック。通常は起きない
    }
    used[c] = 1;
    out[pl.playerId] = c;
  });
  return out;
}

/* ハンデ段階の無害化 (レース用)。整数 0..+4 のみ通し、それ以外は null。
 * app.js の PureLogic.sanitizeHandicapLevel と同じ規則 */
function sanitizeHandicap(v) {
  if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v) return null;
  return (v >= 0 && v <= 4) ? v : null;
}

/* onPeers / roster で配る1人分の形に整える (色は調停済みの最終色)。
 * handicaps (任意、playerId -> 段階) があれば各項目に handicap
 * (段階、未申告は 0) も載せる */
function peerListWithProfiles(players, profiles, connectedOf, handicaps) {
  var eff = resolveProfileColors(players, profiles);
  return players.map(function (p) {
    var prof = profiles ? profiles[p.playerId] : null;
    var hc = handicaps ? sanitizeHandicap(handicaps[p.playerId]) : null;
    return {
      playerId: p.playerId, color: eff[p.playerId], isHost: !!p.isHost,
      connected: connectedOf ? !!connectedOf(p) : true,
      name: prof ? prof.name : null, icon: prof ? prof.icon : null,
      handicap: hc == null ? 0 : hc
    };
  });
}

/* ------------------------------------------------------------------ *
 * 小物ユーティリティ
 * ------------------------------------------------------------------ */
function makeRoomCode(rand) {
  var r = rand || Math.random, out = '';
  for (var i = 0; i < 6; i++) out += CROCKFORD[Math.floor(r() * 32) % 32];
  return out;
}
function normalizeRoomCode(s) {
  return String(s == null ? '' : s).toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1')
    .split('').filter(function (c) { return CROCKFORD.indexOf(c) >= 0; }).join('');
}
function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' +
    Math.floor(Math.random() * 0xffffffff).toString(36);
}

/* base64url (ブラウザ / Node 両対応) */
function bytesToB64url(bytes) {
  var bin = '';
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(str) {
  var b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  var bin = atob(b64), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function utf8Encode(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  return new Uint8Array(Buffer.from(str, 'utf8'));
}
function utf8Decode(bytes) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  return Buffer.from(bytes).toString('utf8');
}
function streamToBytes(stream) {
  if (stream && typeof stream.getReader === 'function') {
    var reader = stream.getReader(), chunks = [], total = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(total), off = 0;
          chunks.forEach(function (c) { out.set(c, off); off += c.length; });
          return out;
        }
        chunks.push(r.value); total += r.value.length; return pump();
      });
    }
    return pump();
  }
  return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
}

/* ------------------------------------------------------------------ *
 * 仲介B: 手動コード (非トリクル SDP のコード化)
 * 接頭辞 'g.' = gzip 圧縮済み / 'r.' = 無圧縮 (CompressionStream 非対応時)
 * ------------------------------------------------------------------ */
function encodeManualCode(obj) {
  var bytes = utf8Encode(JSON.stringify(obj));
  function raw() { return 'r.' + bytesToB64url(bytes); }
  if (typeof CompressionStream === 'undefined') return Promise.resolve(raw());
  try {
    var cs = new CompressionStream('gzip');
    var writer = cs.writable.getWriter();
    writer.write(bytes); writer.close();
    return streamToBytes(cs.readable).then(function (zipped) {
      return 'g.' + bytesToB64url(zipped);
    }).catch(raw);
  } catch (e) { return Promise.resolve(raw()); }
}
function decodeManualCode(code) {
  code = String(code || '').trim();
  var gz = code.charAt(0) === 'g';
  var bytes = b64urlToBytes(code.slice(2));
  function done(b) { return JSON.parse(utf8Decode(b)); }
  if (!gz) return Promise.resolve(done(bytes));
  if (typeof DecompressionStream === 'undefined')
    return Promise.reject(new Error('この環境では圧縮コードを読めません'));
  var ds = new DecompressionStream('gzip');
  var writer = ds.writable.getWriter();
  writer.write(bytes); writer.close();
  return streamToBytes(ds.readable).then(done);
}

/* ------------------------------------------------------------------ *
 * 照合コード: SDP の DTLS フィンガープリントから数字4桁を導出 (I1)
 * offer の SDP はホスト・ゲスト双方が同じものを見るので一致する。
 * ------------------------------------------------------------------ */
function fingerprintCode(sdp) {
  var m = /a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/.exec(String(sdp || ''));
  if (!m) return null;
  var hex = m[1].replace(/:/g, ''), h = 0x811c9dc5;
  for (var i = 0; i < hex.length; i++) {
    h ^= hex.charCodeAt(i); h = (h * 0x01000193) >>> 0;
  }
  var code = String(h % 10000);
  while (code.length < 4) code = '0' + code;
  return code;
}

/* ================================================================== *
 * 同期エンジン (transport 非依存)
 *
 * createEngine({
 *   role: 'host' | 'guest',
 *   selfId: 自分の playerId (ホストは 'host'),
 *   hooks: 上記フック,
 *   net: {
 *     broadcast(msg): ホスト→全ゲスト (自分は含まない。ホストは内部で適用済み)
 *     sendTo(playerId, msg): ホスト→特定ゲスト
 *     sendToHost(msg): ゲスト→ホスト
 *   },
 *   now: () => ms (省略時 Date.now),
 *   rateLimit: { max, windowMs } (省略時 30件/1秒),
 *   leaseTimeoutMs, snapReqMinIntervalMs,
 *   onReject(rej), onEvent(ev, meta), onError(err), onBegin(), onPeersChange()
 * })
 *
 * ワイヤ形式:
 *   ゲスト→ホスト要求: { t:'req', ep, mid, ev:{...} }
 *   ゲスト→ホスト制御: { t:'ctl', ep, ctl:{ t:'ready'|'snapshot-req' } }
 *   ホスト→ゲスト確定: { t:'ev', ep, seq, from, ev:{...}, sum? }
 *   ホスト→ゲスト却下: { t:'reject', mid, reason, evType }
 *   ホスト→ゲスト盤面: { t:'snapshot', ep, upto, snap }
 *   ホスト→ゲスト入室: { t:'welcome', playerId, color, ep, started, lastSeq, profiles }
 *   プロフィール共有 (セッション層、エンジンは素通り): { t:'profile', name, icon, color }
 *   ホスト→ゲスト在室: { t:'roster', peers } (peers は調停済み色 + name/icon つき)
 * ================================================================== */
var HOST_ID = 'host';
var STATE_CHANGING = { drop: 1, sort: 1, start: 1, 'group-drop': 1 }; // sum を付ける種別
var GROUP_GRAB_MAX = 64; // 一括掴み/一括移動の塊数上限 (イベントサイズの歯止め)

function createEngine(opts) {
  opts = opts || {};
  var hooks = opts.hooks || {};
  var net = opts.net || {};
  var now = opts.now || function () { return Date.now(); };
  var rateMax = (opts.rateLimit && opts.rateLimit.max) || 30;
  var rateWindow = (opts.rateLimit && opts.rateLimit.windowMs) || 1000;
  var leaseTimeout = opts.leaseTimeoutMs || LEASE_TIMEOUT_MS;
  var snapMinInterval = opts.snapReqMinIntervalMs || SNAPREQ_MIN_INTERVAL_MS;
  var isHost = opts.role === 'host';
  var selfId = opts.selfId || (isHost ? HOST_ID : null);

  var epoch = 1;                 // 接続 epoch (再接続で上げ、旧イベントを無効化)
  var lastSeq = 0;               // ホスト: 採番済み最大 seq / ゲスト: 適用済み watermark
  var begun = false;
  var started = false;
  var racePieces = null;         // レースのハンデ: 確定した start の piecesMap (playerId -> 実効ピース数)

  /* プレイヤー台帳 (ホストが権威) */
  var players = {};              // id -> { color, ready, lastSeen, reqTimes:[] }
  var joinOrder = [];
  /* リース台帳 (ホストが権威、ゲストは確定イベントから写す) */
  var leases = {};               // anchorId -> { holder, epoch }
  var leaseEpochs = {};          // anchorId -> 最後に使った epoch

  /* ゲスト側: 欠番バッファと snapshot 要求の抑制 */
  var buffer = {};               // seq -> msg
  var snapPending = false, lastSnapReqAt = 0;

  function noop() {}
  var onReject = opts.onReject || noop;
  var onEvent = opts.onEvent || noop;
  var onError = opts.onError || noop;
  var onBegin = opts.onBegin || noop;
  var onPeersChange = opts.onPeersChange || noop;

  function hookVal(v) { return typeof v === 'function' ? v() : v; }
  function clusterExists(id) {
    if (typeof hooks.clusterExists === 'function') return !!hooks.clusterExists(id);
    var cs = hooks.getClusters ? hooks.getClusters() : [];
    for (var i = 0; i < cs.length; i++) if (cs[i].anchorId === id) return true;
    return false;
  }
  function stateHash() {
    if (typeof hooks.hashState !== 'function' || typeof hooks.getClusters !== 'function')
      return undefined;
    return hooks.hashState(hooks.getClusters());
  }
  function coordsOk(x, y) {
    if (typeof x !== 'number' || typeof y !== 'number' ||
        !isFinite(x) || !isFinite(y)) return false;
    if (typeof hooks.deskBounds !== 'function') return true;
    var b = hooks.deskBounds();
    return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  }

  /* ---------------- リース写し (確定イベントの適用で更新) ------------- */
  function leaseMirrorApply(ev) {
    if (ev.t === 'grab') {
      leases[ev.cluster] = { holder: ev.from, epoch: ev.epoch };
      leaseEpochs[ev.cluster] = ev.epoch;
    } else if (ev.t === 'grab-group') {
      // 一括掴み: 塊ごとに epoch が割り振られている
      (ev.clusters || []).forEach(function (a) {
        leases[a] = { holder: ev.from, epoch: (ev.epochs || {})[a] };
        leaseEpochs[a] = (ev.epochs || {})[a];
      });
    } else if (ev.t === 'release' || ev.t === 'lease-expire' || ev.t === 'drop') {
      delete leases[ev.cluster]; // drop = 離した時点でリース終了
    } else if (ev.t === 'group-drop') {
      (ev.items || []).forEach(function (it) { delete leases[it.cluster]; });
    } else if (ev.t === 'start' || ev.t === 'next') {
      leases = {}; // 新規盤面ではリースは全て消える
    }
  }

  /* ---------------- ホスト: 検証 ---------------------------------- */
  function rateOk(id) {
    var p = players[id]; if (!p) return false;
    var t = now(), q = p.reqTimes;
    while (q.length && q[0] <= t - rateWindow) q.shift();
    if (q.length >= rateMax) return false;
    q.push(t); return true;
  }
  // 戻り値: null = 問題なし / 文字列 = 却下理由
  function validate(fromId, ev) {
    if (!ev || typeof ev.t !== 'string') return 'bad-event';
    if (!players[fromId]) return 'unknown-player';
    if (!rateOk(fromId)) return 'rate';
    var L;
    switch (ev.t) {
      case 'grab-req':
        if (!clusterExists(ev.cluster)) return 'no-cluster';
        L = leases[ev.cluster];
        if (L && L.holder !== fromId) return 'leased';
        if (typeof hooks.validateGrab === 'function') {
          var vr = hooks.validateGrab(fromId, ev);
          if (vr) return vr;
        }
        return null;
      case 'grab-group-req': {
        // 一括掴みは全か無か (原子的): 1塊でも他人のリース中なら全体を却下する
        if (!Array.isArray(ev.clusters) || !ev.clusters.length ||
            ev.clusters.length > GROUP_GRAB_MAX) return 'bad-event';
        var gSeen = {};
        for (var gi = 0; gi < ev.clusters.length; gi++) {
          var ga = ev.clusters[gi];
          if (gSeen[ga]) return 'bad-event';
          gSeen[ga] = 1;
          if (!clusterExists(ga)) return 'no-cluster';
          L = leases[ga];
          if (L && L.holder !== fromId) return 'leased';
        }
        if (typeof hooks.validateGrab === 'function') {
          var gvr = hooks.validateGrab(fromId, ev);
          if (gvr) return gvr;
        }
        return null;
      }
      case 'group-drop': {
        // 形式と検証は sort の前例に倣う + 全 items のリース保持を必須にする
        if (!Array.isArray(ev.items) || !ev.items.length ||
            ev.items.length > GROUP_GRAB_MAX) return 'bad-event';
        if (!Array.isArray(ev.order) || !ev.epochs) return 'bad-event';
        var gcs = hooks.getClusters ? hooks.getClusters() : [];
        var gAnchors = {};
        gcs.forEach(function (c) { gAnchors[c.anchorId] = 1; });
        var iSeen = {};
        for (var ii = 0; ii < ev.items.length; ii++) {
          var it = ev.items[ii];
          if (!gAnchors[it.cluster] || iSeen[it.cluster]) return 'bad-event';
          iSeen[it.cluster] = 1;
          L = leases[it.cluster];
          if (!L || L.holder !== fromId) return 'not-holder';
          if (L.epoch !== ev.epochs[it.cluster]) return 'epoch';
          if (!coordsOk(it.x, it.y)) return 'coords';
        }
        if (!gAnchors[ev.leader] || !iSeen[ev.leader]) return 'bad-event';
        if (ev.order.length !== gcs.length) return 'bad-order';
        var oSeen = {};
        for (var oi = 0; oi < ev.order.length; oi++) {
          if (!gAnchors[ev.order[oi]] || oSeen[ev.order[oi]]) return 'bad-order';
          oSeen[ev.order[oi]] = 1;
        }
        return null;
      }
      case 'drop':
        L = leases[ev.cluster];
        if (!L) return 'not-holder';
        if (L.holder !== fromId) return 'not-holder';
        if (L.epoch !== ev.epoch) return 'epoch';
        if (!clusterExists(ev.cluster)) return 'no-cluster';
        if (!coordsOk(ev.x, ev.y)) return 'coords';
        return null;
      case 'release':
        L = leases[ev.cluster];
        if (!L || L.holder !== fromId) return 'not-holder';
        if (L.epoch !== ev.epoch) return 'epoch';
        return null;
      case 'sort': {
        if (!Array.isArray(ev.moves) || !Array.isArray(ev.order)) return 'bad-event';
        var i, anchors = {}, cs = hooks.getClusters ? hooks.getClusters() : [];
        cs.forEach(function (c) { anchors[c.anchorId] = 1; });
        for (i = 0; i < ev.moves.length; i++) {
          if (!anchors[ev.moves[i].cluster]) return 'no-cluster';
          if (!coordsOk(ev.moves[i].x, ev.moves[i].y)) return 'coords';
        }
        if (ev.order.length !== cs.length) return 'bad-order';
        var seen = {};
        for (i = 0; i < ev.order.length; i++) {
          if (!anchors[ev.order[i]] || seen[ev.order[i]]) return 'bad-order';
          seen[ev.order[i]] = 1;
        }
        return null;
      }
      case 'start': case 'next':
        return fromId === HOST_ID ? null : 'forbidden';
      case 'progress':
        // レースモードの進捗報告 (はめたピース数)。盤面は各自ローカル
        // なので共有状態は変えず、値の形だけを見る
        if (typeof ev.placed !== 'number' || !isFinite(ev.placed) || ev.placed < 0)
          return 'bad-event';
        // ハンデがあると各自の総数が違うので、上限は送信者自身の実効
        // ピース数 − 1 (完成値) で見る。piecesMap の無いレースでは
        // 従来どおり上限なし
        if (racePieces && typeof racePieces[fromId] === 'number' &&
            ev.placed > racePieces[fromId] - 1) return 'bad-event';
        return null;
      case 'finish':
        // レースモードの完成申告。勝者は seq 順に最初に適用された
        // finish で確定する (適用側の責務)
        return null;
      case 'complete':
        return null;
      default:
        return 'bad-event';
    }
  }

  /* レースのハンデ: 確定した start の piecesMap を覚え、progress の上限
   * 検証 (各自の実効ピース数) に使う。next で対戦が終わったら破棄する */
  function trackRacePieces(ev) {
    if (ev.t === 'start') {
      racePieces = (ev.mode === 'race' && ev.piecesMap && typeof ev.piecesMap === 'object')
        ? ev.piecesMap : null;
    } else if (ev.t === 'next') {
      racePieces = null;
    }
  }

  /* ---------------- ホスト: 採番と適用 ------------------------------ */
  // 検証を通ったイベントを seq 付きで確定する。戻り値 true = 確定した
  function sequence(fromId, ev) {
    var out = normalizeEvent(fromId, ev);
    var seq = lastSeq + 1;
    var msg = { t: 'ev', seq: seq, from: fromId, ev: out };
    // 自端末で適用できないイベントは確定しない (seq も消費しない)。
    // ep はセッション層が送信先ごとに捺す (接続 epoch はプレイヤー単位)。
    if (typeof hooks.applyEvent === 'function')
      hooks.applyEvent(out, { seq: seq, from: fromId });
    lastSeq = seq;
    if (fromId === selfId && players[fromId]) players[fromId].lastSeen = now();
    leaseMirrorApply(out);
    if (STATE_CHANGING[out.t]) {
      var s = stateHash();
      if (s !== undefined) msg.sum = s;
    }
    if (out.t === 'start') { started = true; resetBarrier(); }
    if (out.t === 'next') { resetBarrier(); }
    trackRacePieces(out);
    if (out.t === 'begin') begun = true;
    if (net.broadcast) net.broadcast(msg);
    onEvent(out, { seq: seq, from: fromId });
    if (out.t === 'begin') onBegin();
    return true;
  }
  // grab-req は「付与 (grab)」に変換してから確定する
  function normalizeEvent(fromId, ev) {
    if (ev.t === 'grab-req') {
      var ep = (leaseEpochs[ev.cluster] || 0) + 1;
      return { t: 'grab', cluster: ev.cluster, epoch: ep, from: fromId };
    }
    if (ev.t === 'grab-group-req') {
      var epochs = {};
      (ev.clusters || []).forEach(function (a) { epochs[a] = (leaseEpochs[a] || 0) + 1; });
      return {
        t: 'grab-group', clusters: (ev.clusters || []).slice(),
        leader: ev.leader, epochs: epochs, from: fromId
      };
    }
    var copy = {}; for (var k in ev) copy[k] = ev[k];
    copy.from = fromId;
    return copy;
  }
  function resetBarrier() {
    begun = false;
    for (var id in players) players[id].ready = false;
  }

  function reject(toId, mid, reason, evType) {
    var msg = { t: 'reject', mid: mid, reason: reason, evType: evType };
    if (toId === selfId) onReject(msg);
    else if (net.sendTo) net.sendTo(toId, msg);
  }

  /* ---------------- ホスト: 受信 ---------------------------------- */
  function hostReceive(fromId, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (players[fromId]) players[fromId].lastSeen = now();
    // 旧接続 (再接続前の epoch) から届いた残りは捨てる
    var expectedEp = players[fromId] && players[fromId].ep;
    if (msg.ep !== undefined && expectedEp !== undefined && msg.ep !== expectedEp) return;
    if (msg.t === 'ctl') { hostControl(fromId, msg.ctl || {}); return; }
    if (msg.t !== 'req') return;
    var ev = msg.ev || {};
    var reason = validate(fromId, ev);
    if (reason) { reject(fromId, msg.mid, reason, ev.t); return; }
    try { sequence(fromId, ev); }
    catch (e) { reject(fromId, msg.mid, 'apply-error', ev.t); }
  }
  function hostControl(fromId, ctl) {
    if (!players[fromId]) return;
    if (ctl.t === 'ready') {
      players[fromId].ready = true;
      maybeBegin();
    } else if (ctl.t === 'snapshot-req') {
      sendSnapshotTo(fromId);
    }
  }
  function maybeBegin() {
    if (begun || !started) return;
    for (var i = 0; i < joinOrder.length; i++)
      if (!players[joinOrder[i]].ready) return;
    try { sequence(HOST_ID, { t: 'begin' }); } catch (e) { /* 次の ready で再試行 */ }
  }
  function sendSnapshotTo(playerId) {
    if (typeof hooks.getSnapshot !== 'function') return;
    var msg = { t: 'snapshot', upto: lastSeq, snap: hooks.getSnapshot(), leases: engine.getLeases() }; // ep はセッション層が捺す
    if (playerId === selfId) guestApplySnapshot(msg);
    else if (net.sendTo) net.sendTo(playerId, msg);
  }

  /* ---------------- プレイヤー管理 (ホスト) -------------------------- */
  function addPlayer(id, color, ep) {
    if (!players[id]) { joinOrder.push(id); }
    players[id] = players[id] || { reqTimes: [] };
    players[id].color = color;
    if (ep !== undefined) players[id].ep = ep;
    players[id].ready = !!players[id].ready;
    players[id].lastSeen = now();
    onPeersChange();
    return players[id];
  }
  function removePlayer(id) {
    if (!players[id]) return;
    // 保持中リースを確定イベントで解放してから台帳を消す
    var held = [];
    for (var c in leases) if (leases[c].holder === id) held.push(c);
    held.forEach(function (cluster) {
      try { sequence(HOST_ID, { t: 'lease-expire', cluster: cluster, epoch: leases[cluster].epoch, by: id }); }
      catch (e) { delete leases[cluster]; }
    });
    // 対戦中の退出は seq 付きで全端末へ知らせる (ターン制の手番スキップ
    // などを全端末で同一に導出するため。ロビー段階では送らない)
    if (started) {
      try { sequence(HOST_ID, { t: 'player-left', player: id }); } catch (e) { /* ignore */ }
    }
    delete players[id];
    joinOrder = joinOrder.filter(function (x) { return x !== id; });
    onPeersChange();
    maybeBegin();
  }

  /* ---------------- ゲスト: 適用 ---------------------------------- */
  function guestApplySequenced(msg) {
    if (msg.ep !== undefined && msg.ep !== epoch) return;
    var seq = msg.seq;
    if (typeof seq !== 'number' || seq <= lastSeq) return; // 重複・過去は捨てる
    if (seq > lastSeq + 1) { // 欠番: バッファして snapshot で回復する
      buffer[seq] = msg;
      requestSnapshot(false);
      return;
    }
    applySequencedNow(msg);
    // バッファに続きがあれば流す
    while (buffer[lastSeq + 1]) {
      var nxt = buffer[lastSeq + 1];
      delete buffer[lastSeq + 1];
      applySequencedNow(nxt);
    }
  }
  function applySequencedNow(msg) {
    var ev = msg.ev || {};
    try {
      leaseMirrorApply(ev);
      if (typeof hooks.applyEvent === 'function')
        hooks.applyEvent(ev, { seq: msg.seq, from: msg.from });
    } catch (e) {
      onError({ kind: 'apply', error: e, seq: msg.seq });
      requestSnapshot(true);
      return;
    }
    lastSeq = msg.seq;
    if (ev.t === 'start') started = true;
    trackRacePieces(ev);
    if (ev.t === 'begin') { begun = true; onBegin(); }
    onEvent(ev, { seq: msg.seq, from: msg.from });
    // drop / sort のチェックサム検証 (M6)
    if (msg.sum !== undefined && STATE_CHANGING[ev.t]) {
      var s = stateHash();
      if (s !== undefined && s !== msg.sum) requestSnapshot(false);
    }
  }
  function guestApplySnapshot(msg) {
    if (msg.ep !== undefined && msg.ep !== epoch) return;
    if (typeof msg.upto === 'number' && msg.upto < lastSeq) return; // 古い盤面は捨てる
    if (!validateSnapshotPartition(msg.snap)) {
      onError({ kind: 'bad-snapshot' });
      snapPending = false;
      requestSnapshot(true);
      return;
    }
    try {
      if (typeof hooks.applySnapshot === 'function') hooks.applySnapshot(msg.snap);
    } catch (e) { onError({ kind: 'apply-snapshot', error: e }); return; }
    leases = {};
    (msg.leases || []).forEach(function (l) {
      leases[l.cluster] = { holder: l.holder, epoch: l.epoch };
      leaseEpochs[l.cluster] = l.epoch;
    });
    if (typeof msg.upto === 'number') lastSeq = msg.upto;
    snapPending = false;
    for (var s in buffer) if (+s <= lastSeq) delete buffer[s];
    while (buffer[lastSeq + 1]) {
      var nxt = buffer[lastSeq + 1];
      delete buffer[lastSeq + 1];
      applySequencedNow(nxt);
    }
    onEvent({ t: 'snapshot-applied' }, { seq: lastSeq, from: HOST_ID });
  }
  function validateSnapshotPartition(snap) {
    if (!snap || !Array.isArray(snap.clusters)) return false;
    if (typeof hooks.allPieceIds !== 'function') return true; // 照合材料が無い場合は通す
    var expected = {}, i, id;
    var all = hooks.allPieceIds();
    for (i = 0; i < all.length; i++) expected[all[i]] = 1;
    var count = 0;
    for (i = 0; i < snap.clusters.length; i++) {
      var ps = snap.clusters[i].pieces || [];
      for (var j = 0; j < ps.length; j++) {
        id = ps[j];
        if (!expected[id]) return false;   // 余分 or 重複
        delete expected[id]; count++;
      }
    }
    return count === all.length;            // 欠落なし
  }
  function requestSnapshot(force) {
    if (isHost) return;
    var t = now();
    if (!force && snapPending && t - lastSnapReqAt < snapMinInterval) return;
    snapPending = true; lastSnapReqAt = t;
    if (net.sendToHost) net.sendToHost({ t: 'ctl', ep: epoch, ctl: { t: 'snapshot-req' } });
  }

  /* ---------------- ゲスト: 受信 ---------------------------------- */
  function guestReceive(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'ev') guestApplySequenced(msg);
    else if (msg.t === 'snapshot') guestApplySnapshot(msg);
    else if (msg.t === 'reject') onReject(msg);
    else if (msg.t === 'welcome') {
      if (typeof msg.ep === 'number') epoch = msg.ep;
      if (typeof msg.lastSeq === 'number' && msg.lastSeq > 0 && !started)
        requestSnapshot(true); // 進行中の部屋への途中参加
    }
  }

  /* ---------------- 共通 API -------------------------------------- */
  var engine = {
    role: opts.role, selfId: selfId,
    // transport から呼ばれる受信口
    receive: function (fromId, msg) {
      if (isHost) hostReceive(fromId, msg);
      else guestReceive(msg);
    },
    receiveFromHost: function (msg) { guestReceive(msg); },
    // 自分の操作イベントを送る (ホストは自分のシーケンサを通す)
    request: function (ev) {
      var mid = makeId('m');
      if (isHost) {
        var reason = validate(selfId, ev);
        if (reason) { onReject({ t: 'reject', mid: mid, reason: reason, evType: ev && ev.t }); return mid; }
        try { sequence(selfId, ev); }
        catch (e) { onReject({ t: 'reject', mid: mid, reason: 'apply-error', evType: ev && ev.t }); }
      } else if (net.sendToHost) {
        net.sendToHost({ t: 'req', ep: epoch, mid: mid, ev: ev });
      }
      return mid;
    },
    // ready バリア: 自分の読み込み完了を申告する
    setReady: function () {
      if (isHost) {
        if (players[selfId]) players[selfId].ready = true;
        maybeBegin();
      } else if (net.sendToHost) {
        net.sendToHost({ t: 'ctl', ep: epoch, ctl: { t: 'ready' } });
      }
    },
    // ホスト専用: start / next の配信
    hostControl: function (ev) {
      if (!isHost) return;
      try { sequence(HOST_ID, ev); } catch (e) { onError({ kind: 'apply', error: e }); }
    },
    sendSnapshotTo: sendSnapshotTo,
    requestSnapshot: function () { requestSnapshot(true); },
    addPlayer: addPlayer,
    setPlayerEpoch: function (id, ep) { if (players[id]) players[id].ep = ep; },
    getPlayerEpoch: function (id) { return players[id] ? players[id].ep : undefined; },
    removePlayer: removePlayer,
    noteActivity: function (id) { if (players[id]) players[id].lastSeen = now(); },
    setEpoch: function (n) { epoch = n; },
    getEpoch: function () { return epoch; },
    getWatermark: function () { return lastSeq; },
    isBegun: function () { return begun; },
    isStarted: function () { return started; },
    getLease: function (cluster) { return leases[cluster] || null; },
    getLeases: function () {
      var out = [];
      for (var c in leases) out.push({ cluster: isNaN(+c) ? c : +c, holder: leases[c].holder, epoch: leases[c].epoch });
      return out;
    },
    getPlayers: function () {
      return joinOrder.map(function (id) {
        return { playerId: id, color: players[id].color, ready: !!players[id].ready, isHost: id === HOST_ID };
      });
    },
    // リースのタイムアウト検査 (セッション層が定期的に呼ぶ)
    tick: function () {
      if (!isHost) return;
      var t = now(), expired = [];
      for (var c in leases) {
        var holder = leases[c].holder;
        // 自分 (ホスト) のリースは失効させない: ホストの lastSeen は
        // hostReceive / noteActivity の対象がゲストだけのため誰も更新せず、
        // 部屋を作って leaseTimeout 経つと自分の掴みが即失効してしまう。
        // tick が回っていること自体がホストの生存証明になる
        if (holder === selfId) continue;
        var p = players[holder];
        if (!p || t - (p.lastSeen || 0) > leaseTimeout) expired.push(c);
      }
      expired.forEach(function (cluster) {
        try { sequence(HOST_ID, { t: 'lease-expire', cluster: isNaN(+cluster) ? cluster : +cluster, epoch: leases[cluster].epoch, by: leases[cluster].holder }); }
        catch (e) { delete leases[cluster]; }
      });
    }
  };
  if (isHost) addPlayer(HOST_ID, 0);
  return engine;
}

/* ================================================================== *
 * 仲介A: Supabase Realtime Broadcast (Phoenix プロトコル vsn=2.0.0)
 * チャンネルは部屋の間ずっと開く (M2)。25秒間隔で phx heartbeat。
 * ================================================================== */
function createSignaling(opts) {
  var topic = opts.topic;
  var ws = null, refSeq = 0, joinRef = null, joined = false;
  var hbTimer = null, reconnectTimer = null, backoff = 1000;
  var closedByUser = false, everOpened = false;

  function wsUrl() {
    return SUPABASE_URL.replace(/^http/, 'ws') +
      '/realtime/v1/websocket?apikey=' + encodeURIComponent(SUPABASE_ANON_KEY) +
      '&vsn=2.0.0';
  }
  function nextRef() { return String(++refSeq); }
  function rawSend(arr) {
    if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(arr)); } catch (e) {} }
  }
  function sendJoin() {
    joinRef = nextRef();
    rawSend([joinRef, joinRef, topic, 'phx_join', {
      config: { broadcast: { ack: false, self: false }, presence: { key: '' } }
    }]);
  }
  function startHeartbeat() {
    stopHeartbeat();
    hbTimer = setInterval(function () {
      rawSend([null, nextRef(), 'phoenix', 'heartbeat', {}]);
    }, PHX_HEARTBEAT_MS);
  }
  function stopHeartbeat() { if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } }

  function connect() {
    if (closedByUser) return;
    var sock;
    try { sock = new WebSocket(wsUrl()); } catch (e) { scheduleReconnect(); return; }
    ws = sock;
    sock.onopen = function () { backoff = 1000; sendJoin(); startHeartbeat(); };
    sock.onmessage = function (ev) {
      var arr; try { arr = JSON.parse(ev.data); } catch (e) { return; }
      if (!Array.isArray(arr)) return;
      var ref = arr[1], evTopic = arr[2], event = arr[3], payload = arr[4] || {};
      if (event === 'phx_reply' && ref === joinRef && payload.status === 'ok') {
        var first = !everOpened;
        joined = true; everOpened = true;
        if (opts.onOpen) opts.onOpen(first);
        if (!first && opts.onReopen) opts.onReopen();
      } else if (event === 'broadcast' && payload && payload.type === 'broadcast') {
        if (opts.onPayload) opts.onPayload(payload.payload || {});
      }
    };
    sock.onclose = function () {
      joined = false; stopHeartbeat();
      if (opts.onClose) opts.onClose();
      scheduleReconnect();
    };
    sock.onerror = function () { try { sock.close(); } catch (e) {} };
  }
  function scheduleReconnect() {
    if (closedByUser || reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null; connect();
    }, backoff);
    backoff = Math.min(backoff * 2, 10000);
  }

  connect();
  return {
    send: function (payload) {
      rawSend([joinRef, nextRef(), topic, 'broadcast',
        { type: 'broadcast', event: 'sig', payload: payload }]);
    },
    isJoined: function () { return joined; },
    close: function () {
      closedByUser = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      stopHeartbeat();
      if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    }
  };
}

/* ================================================================== *
 * WebRTC セッション層
 * ================================================================== */
function hookVal(hooks, name) {
  var v = hooks ? hooks[name] : undefined;
  return typeof v === 'function' ? v() : v;
}
function loadGuestId() {
  try {
    var id = window.localStorage.getItem('daily-jigsaw:guestId');
    if (id) return id;
    id = makeId('guest');
    window.localStorage.setItem('daily-jigsaw:guestId', id);
    return id;
  } catch (e) { return makeId('guest'); }
}
function waitIceComplete(pc, timeoutMs) {
  return new Promise(function (resolve) {
    if (pc.iceGatheringState === 'complete') return resolve();
    var done = false;
    function finish() { if (!done) { done = true; resolve(); } }
    pc.addEventListener('icegatheringstatechange', function () {
      if (pc.iceGatheringState === 'complete') finish();
    });
    setTimeout(finish, timeoutMs || 8000);
  });
}
function sendEph(ch, obj) {
  if (!ch || ch.readyState !== 'open') return;
  if (ch.bufferedAmount > EPH_BUFFERED_LIMIT) return; // 詰まっていたら捨てる (M7)
  try { ch.send(JSON.stringify(obj)); } catch (e) {}
}

/* ephemeral 中継の coalesce: 宛先 (destKey) × スロット (slotKey) ごとに
 * 最新値だけを保持し、一定間隔でまとめて送る。move/cursor は最新値しか
 * 意味がないので、ホストの送信回数を「宛先 × フレーム数」に抑えられる。
 * 喪失許容の eph の範囲内でのみ使う (ev には使わない) */
function createEphCoalescer(send, intervalMs) {
  var pending = {}; // destKey -> { slotKey -> msg }
  var timer = null;
  function flush() {
    timer = null;
    var all = pending;
    pending = {};
    for (var dk in all) for (var sk in all[dk]) send(all[dk][sk]);
  }
  return {
    push: function (destKey, slotKey, msg) {
      if (!pending[destKey]) pending[destKey] = {};
      pending[destKey][slotKey] = msg;
      if (!timer && intervalMs > 0) timer = setTimeout(flush, intervalMs);
    },
    flush: flush,
    dispose: function () {
      if (timer) { clearTimeout(timer); timer = null; }
      pending = {};
    }
  };
}

/* ---------------- ホスト (部屋コード方式) ------------------------- */
function createRoom(hooks, callbacks, options) {
  callbacks = callbacks || {}; options = options || {};
  var code = options.code || makeRoomCode();
  var closed = false;
  var peers = {};        // guestId -> peer
  var book = {};         // guestId -> { playerId, color, epoch }
  var bookSeq = 0;
  var profiles = {};     // playerId -> sanitize 済みプロフィール (MP改善#4)
  var handicaps = {};    // playerId -> ハンデ段階 (プロフィールと同じ共有方式)

  function setStatus(s, info) { if (callbacks.onStatus) callbacks.onStatus(s, info); }
  function notifyPeers() {
    if (!engine) return; // 生成中の addPlayer からの発火 (engine 未代入) は無視
    // 色はプロフィールの希望をホストが調停した最終色を配る (識別色の正)
    var list = peerListWithProfiles(engine.getPlayers(), profiles, function (p) {
      return p.isHost ? true : !!(findPeerByPlayer(p.playerId) || {}).open;
    }, handicaps);
    if (callbacks.onPeers) callbacks.onPeers(list);
    // ゲストにも在室一覧を配る
    for (var gid in peers) sendEv(peers[gid], { t: 'roster', peers: list });
  }
  function findPeerByPlayer(playerId) {
    for (var gid in peers) if (peers[gid].playerId === playerId) return peers[gid];
    return null;
  }

  var engine = createEngine({
    role: 'host', hooks: hooks,
    net: {
      broadcast: function (msg) { for (var gid in peers) sendEv(peers[gid], msg); },
      sendTo: function (playerId, msg) { sendEv(findPeerByPlayer(playerId), msg); }
    },
    onReject: callbacks.onReject, onError: callbacks.onError,
    onEvent: function (ev, meta) { if (callbacks.onEvent) callbacks.onEvent(ev, meta); },
    onBegin: function () { setStatus('open'); },
    onPeersChange: function () { notifyPeers(); }
  });

  function sendEv(peer, msg) {
    if (!peer || !peer.evCh || peer.evCh.readyState !== 'open') return;
    var m = {}; for (var k in msg) m[k] = msg[k];
    m.ep = peer.epoch;
    try { peer.evCh.send(JSON.stringify(m)); } catch (e) {}
  }

  var sig = createSignaling({
    topic: SIGNAL_TOPIC_PREFIX + code,
    onOpen: function (first) { if (first) setStatus('waiting', { code: code }); },
    onPayload: function (p) {
      if (closed || !p || !p.kind) return;
      if (p.kind === 'want') handleWant(p);
      else if (p.to !== 'host') return;
      else if (p.kind === 'answer') {
        var peer = peers[p.from];
        if (peer && peer.pc) peer.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp }).catch(function () {});
      } else if (p.kind === 'ice') {
        var peer2 = peers[p.from];
        if (peer2 && peer2.pc && p.candidate)
          peer2.pc.addIceCandidate(p.candidate).catch(function () {});
      } else if (p.kind === 'bye') {
        closePeer(p.from);
        var bk = book[p.from];
        if (bk) engine.removePlayer(bk.playerId);
      }
    }
  });
  setStatus('signaling', { code: code });

  function handleWant(p) {
    if (closed) return;
    var gid = p.from;
    if (!gid) return;
    // バージョン照合 (M9): 不一致は理由を返して参加させない
    if (String(p.logicVersion) !== String(hookVal(hooks, 'logicVersion')) ||
        String(p.poolFingerprint) !== String(hookVal(hooks, 'poolFingerprint'))) {
      sig.send({ kind: 'deny', from: 'host', to: gid, reason: 'version' });
      return;
    }
    var bk = book[gid];
    if (engine.isStarted() && !bk) return; // 開始後は既知の guestId 以外締める (§2-5)
    if (peers[gid]) closePeer(gid);        // 再入室: 旧接続を捨てて作り直す
    if (!bk) {
      bookSeq++;
      bk = book[gid] = { playerId: 'g' + bookSeq, color: bookSeq, epoch: 0 };
    }
    bk.epoch++;
    var peer = {
      guestId: gid, playerId: bk.playerId, color: bk.color, epoch: bk.epoch,
      pc: null, evCh: null, ephCh: null, open: false,
      restartTried: false, timer: null, verify: null
    };
    peers[gid] = peer;
    engine.addPlayer(bk.playerId, bk.color, bk.epoch);
    startPeerConnection(peer);
    setStatus('connecting', { playerId: bk.playerId });
  }

  function startPeerConnection(peer) {
    armConnectTimer(peer); // offer 生成が滞っても期限で failPeer させる
    var pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    peer.pc = pc;
    peer.evCh = pc.createDataChannel('ev', { ordered: true });
    peer.ephCh = pc.createDataChannel('eph', { ordered: false, maxRetransmits: 0 });
    var evOpen = false, ephOpen = false;
    peer.evCh.onopen = function () { evOpen = true; maybePeerOpen(peer, evOpen, ephOpen); };
    peer.ephCh.onopen = function () { ephOpen = true; maybePeerOpen(peer, evOpen, ephOpen); };
    peer.evCh.onmessage = function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg && msg.t === 'profile') {
        // プロフィールはゲームイベントではないのでエンジンに渡さず、
        // 名簿 (profiles) に保持して roster で再配信する (MP改善#4)
        var sp = sanitizeProfile(msg);
        if (sp) profiles[peer.playerId] = sp; else delete profiles[peer.playerId];
        notifyPeers();
        return;
      }
      if (msg && msg.t === 'handicap') {
        // ハンデもプロフィールと同じセッション層: 名簿に保持して再配信
        var sh = sanitizeHandicap(msg.level);
        handicaps[peer.playerId] = sh == null ? 0 : sh;
        notifyPeers();
        return;
      }
      engine.receive(peer.playerId, msg);
    };
    peer.ephCh.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      engine.noteActivity(peer.playerId);
      if (callbacks.onEphemeral) callbacks.onEphemeral(m.kind, m.data, peer.playerId);
      relayEph(peer, m); // 他ゲストにも中継する (スター型)
    };
    pc.onicecandidate = function (ev) {
      if (ev.candidate)
        sig.send({ kind: 'ice', from: 'host', to: peer.guestId, candidate: ev.candidate.toJSON() });
    };
    pc.oniceconnectionstatechange = function () {
      var st = pc.iceConnectionState;
      if (st === 'failed') onPeerIceFailed(peer);
      else if (st === 'closed') { /* closePeer 側で処理 */ }
    };
    pc.createOffer().then(function (offer) {
      return pc.setLocalDescription(offer).then(function () { return offer; });
    }).then(function (offer) {
      peer.verify = fingerprintCode(offer.sdp);
      sig.send({ kind: 'offer', from: 'host', to: peer.guestId, sdp: offer.sdp });
      armConnectTimer(peer);
    }).catch(function () { failPeer(peer, 'offer-error'); });
  }
  function maybePeerOpen(peer, evOpen, ephOpen) {
    if (!evOpen || !ephOpen || peer.open) return;
    peer.open = true;
    if (peer.timer) { clearTimeout(peer.timer); peer.timer = null; }
    sendEv(peer, {
      t: 'welcome', playerId: peer.playerId, color: peer.color,
      started: engine.isStarted(), lastSeq: engine.getWatermark(), verify: peer.verify,
      profiles: profiles, // 途中参加者にも既知のプロフィール一式を同梱する (MP改善#4)
      handicaps: handicaps // ハンデも同様に同梱する
    });
    if (callbacks.onVerifyCode && peer.verify) callbacks.onVerifyCode(peer.verify);
    notifyPeers();
    setStatus('open', { playerId: peer.playerId });
    if (engine.isStarted()) engine.sendSnapshotTo(peer.playerId); // 途中参加・復帰
  }
  function armConnectTimer(peer) {
    if (peer.timer) clearTimeout(peer.timer);
    peer.timer = setTimeout(function () {
      if (!peer.open) failPeer(peer, 'timeout');
    }, CONNECT_TIMEOUT_MS);
  }
  function onPeerIceFailed(peer) {
    if (closed || !peer.pc) return;
    if (!peer.restartTried) {
      // ICE restart は1回だけ試す (ホストが offer 発信者なので再交渉できる)
      peer.restartTried = true;
      try { peer.pc.restartIce(); } catch (e) {}
      peer.pc.createOffer().then(function (offer) {
        return peer.pc.setLocalDescription(offer).then(function () { return offer; });
      }).then(function (offer) {
        sig.send({ kind: 'offer', from: 'host', to: peer.guestId, sdp: offer.sdp, restart: true });
        armConnectTimer(peer);
      }).catch(function () { failPeer(peer, 'ice'); });
    } else {
      failPeer(peer, 'ice');
    }
  }
  function failPeer(peer, reason) {
    var playerId = peer.playerId;
    var wasOpen = peer.open;
    closePeer(peer.guestId);
    engine.removePlayer(playerId);
    if (callbacks.onPeerLost) callbacks.onPeerLost(playerId, reason);
    if (!wasOpen) {
      // 一度も開かなかった接続の失敗はロビーにも出す (従来は onPeerLost だけで
      // 状態文が「相手と接続しています…」のまま残った)。他のゲストが
      // つながっている時はセッション全体の失敗にはしない
      var anyOpen = false;
      for (var gid in peers) if (peers[gid].open) { anyOpen = true; break; }
      if (!anyOpen) setStatus('failed', { reason: reason });
    }
    notifyPeers();
  }
  function closePeer(gid) {
    var peer = peers[gid];
    if (!peer) return;
    delete peers[gid];
    if (peer.timer) clearTimeout(peer.timer);
    try { peer.pc && peer.pc.close(); } catch (e) {}
  }
  var ephCoalescer = createEphCoalescer(function (it) {
    if (it.peer.open) sendEph(it.peer.ephCh, { kind: it.kind, data: it.data, from: it.from });
  }, EPH_COALESCE_MS);
  function relayEph(fromPeer, m) {
    for (var gid in peers) {
      var p = peers[gid];
      if (p === fromPeer || !p.open) continue;
      if (EPH_COALESCE_MS > 0 && EPH_COALESCE_KINDS[m.kind]) {
        // move/cursor は宛先ごとに最新値だけを保持して間引いて送る
        ephCoalescer.push(gid, m.kind + ':' + fromPeer.playerId,
          { peer: p, kind: m.kind, data: m.data, from: fromPeer.playerId });
      } else {
        sendEph(p.ephCh, { kind: m.kind, data: m.data, from: fromPeer.playerId });
      }
    }
  }

  var tickTimer = setInterval(function () { engine.tick(); }, 1000);

  return makeSessionFacade({
    role: 'host', code: code, engine: engine, hooks: hooks, callbacks: callbacks,
    sendEphemeral: function (kind, data) {
      for (var gid in peers)
        if (peers[gid].open) sendEph(peers[gid].ephCh, { kind: kind, data: data, from: HOST_ID });
    },
    setProfile: function (p) {
      var sp = sanitizeProfile(p);
      if (sp) profiles[HOST_ID] = sp; else delete profiles[HOST_ID];
      notifyPeers(); // roster で全ゲストへ再配信する
    },
    setHandicap: function (level) {
      var sh = sanitizeHandicap(level);
      handicaps[HOST_ID] = sh == null ? 0 : sh;
      notifyPeers(); // roster で全ゲストへ再配信する
    },
    leave: function () {
      if (closed) return;
      closed = true;
      clearInterval(tickTimer);
      ephCoalescer.dispose();
      sig.send({ kind: 'bye', from: 'host', to: null });
      for (var gid in peers) closePeer(gid);
      sig.close();
      setStatus('closed');
    }
  });
}

/* ---------------- ゲスト (部屋コード方式) -------------------------- */
function joinRoom(code, hooks, callbacks, options) {
  callbacks = callbacks || {}; options = options || {};
  code = normalizeRoomCode(code);
  var guestId = options.guestId || loadGuestId();
  var closed = false, failed = false;
  var pc = null, evCh = null, ephCh = null;
  var isOpen = false, restartTried = false, rejoinCount = 0;
  var connectTimer = null, restartTimer = null;
  var playerId = null;
  var welcomeProfiles = {}; // welcome に同梱された既知プロフィール (MP改善#4)
  var welcomeHandicaps = {}; // welcome に同梱された既知ハンデ (playerId -> 段階)
  /* 接続確立までの絶対期限。want の再送やシグナリング再接続 (onReopen) で
   * タイマーを延長し続けると failed が永遠に発火しないため、期限は入室時に
   * 一度だけ決め、armConnectTimer は残り時間しか張らない */
  var connectDeadline = Date.now() + CONNECT_TIMEOUT_MS;
  var everOpened = false;

  function setStatus(s, info) { if (callbacks.onStatus) callbacks.onStatus(s, info); }

  var engine = createEngine({
    role: 'guest', hooks: hooks,
    net: { sendToHost: function (msg) { sendEvRaw(msg); } },
    onReject: callbacks.onReject, onError: callbacks.onError,
    onEvent: function (ev, meta) { if (callbacks.onEvent) callbacks.onEvent(ev, meta); },
    onBegin: function () { setStatus('open'); }
  });
  function sendEvRaw(msg) {
    if (!evCh || evCh.readyState !== 'open') return;
    try { evCh.send(JSON.stringify(msg)); } catch (e) {}
  }

  var sig = createSignaling({
    topic: SIGNAL_TOPIC_PREFIX + code,
    onOpen: function (first) { if (first) sendWant(); },
    onReopen: function () { if (!closed && !isOpen) sendWant(); },
    onPayload: function (p) {
      if (closed || !p || p.to !== guestId) return;
      if (p.kind === 'offer') handleOffer(p.sdp);
      else if (p.kind === 'ice') { if (pc && p.candidate) pc.addIceCandidate(p.candidate).catch(function () {}); }
      else if (p.kind === 'deny') { failed = true; setStatus('failed', { reason: p.reason || 'denied' }); }
      else if (p.kind === 'bye') { setStatus('room-ended'); teardown(); }
    }
  });
  setStatus('signaling', { code: code });
  armConnectTimer(); // シグナリング自体がつながらない場合も期限で failed にする

  function sendWant() {
    if (closed || failed) return;
    setStatus('connecting', { code: code });
    sig.send({
      kind: 'want', from: guestId, to: 'host',
      logicVersion: hookVal(hooks, 'logicVersion'),
      poolFingerprint: hookVal(hooks, 'poolFingerprint')
    });
    armConnectTimer();
  }
  function armConnectTimer() {
    if (connectTimer) clearTimeout(connectTimer);
    var remain = Math.max(0, connectDeadline - Date.now());
    connectTimer = setTimeout(function () {
      if (!isOpen && !closed) { failed = true; setStatus('failed', { reason: 'timeout' }); }
    }, remain);
  }
  function createPc() {
    pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pc.ondatachannel = function (ev) {
      var ch = ev.channel;
      if (ch.label === 'ev') { evCh = ch; wireEvChannel(); }
      else if (ch.label === 'eph') { ephCh = ch; wireEphChannel(); }
      maybeOpen();
    };
    pc.onicecandidate = function (ev) {
      if (ev.candidate)
        sig.send({ kind: 'ice', from: guestId, to: 'host', candidate: ev.candidate.toJSON() });
    };
    pc.oniceconnectionstatechange = function () {
      var st = pc.iceConnectionState;
      if (st !== 'failed') return;
      if (!restartTried) {
        // ホスト側の ICE restart offer を待つ
        restartTried = true;
        restartTimer = setTimeout(function () { rejoin(); }, CONNECT_TIMEOUT_MS);
      } else rejoin();
    };
  }
  function wireEvChannel() {
    evCh.onmessage = function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.t === 'welcome') {
        playerId = msg.playerId;
        session.playerId = playerId;
        if (callbacks.onVerifyCode && msg.verify) callbacks.onVerifyCode(msg.verify);
        if (msg.profiles && typeof msg.profiles === 'object') welcomeProfiles = msg.profiles;
        if (msg.handicaps && typeof msg.handicaps === 'object') welcomeHandicaps = msg.handicaps;
        if (callbacks.onPeers) {
          // roster が届くまでの仮一覧にも、welcome 同梱のプロフィールを反映する
          var hp = welcomeProfiles[HOST_ID], sp = welcomeProfiles[playerId];
          var hh = sanitizeHandicap(welcomeHandicaps[HOST_ID]);
          var sh = sanitizeHandicap(welcomeHandicaps[playerId]);
          callbacks.onPeers([
            { playerId: HOST_ID, color: 0, isHost: true, connected: true,
              name: hp ? hp.name : null, icon: hp ? hp.icon : null,
              handicap: hh == null ? 0 : hh },
            { playerId: playerId, color: msg.color, isHost: false, connected: true,
              name: sp ? sp.name : null, icon: sp ? sp.icon : null,
              handicap: sh == null ? 0 : sh }
          ]);
        }
      } else if (msg.t === 'roster') {
        if (callbacks.onPeers) callbacks.onPeers((msg.peers || []).map(function (p) {
          // roster 側に無い項目は welcome 同梱分で補う (旧ホストとの混在用)
          if ((p.name == null || p.icon == null) && welcomeProfiles[p.playerId]) {
            var wp = welcomeProfiles[p.playerId];
            return { playerId: p.playerId, color: p.color, isHost: p.isHost, connected: p.connected,
              name: p.name != null ? p.name : wp.name, icon: p.icon != null ? p.icon : wp.icon,
              handicap: typeof p.handicap === 'number' ? p.handicap : 0 };
          }
          return p;
        }));
        return;
      }
      engine.receiveFromHost(msg);
    };
  }
  function wireEphChannel() {
    ephCh.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (callbacks.onEphemeral) callbacks.onEphemeral(m.kind, m.data, m.from);
    };
  }
  function maybeOpen() {
    if (isOpen || !evCh || !ephCh) return;
    if (evCh.readyState !== 'open' && evCh.readyState !== 'connecting') return;
    var check = function () {
      if (evCh.readyState === 'open' && ephCh.readyState === 'open') {
        isOpen = true; everOpened = true; restartTried = false; rejoinCount = 0;
        if (connectTimer) clearTimeout(connectTimer);
        if (restartTimer) clearTimeout(restartTimer);
        setStatus('open', { code: code });
      }
    };
    evCh.onopen = check; ephCh.onopen = check; check();
  }
  function handleOffer(sdp) {
    if (closed || failed) return;
    if (!pc) createPc();
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    var verify = fingerprintCode(sdp);
    if (verify && callbacks.onVerifyCode) callbacks.onVerifyCode(verify);
    pc.setRemoteDescription({ type: 'offer', sdp: sdp }).then(function () {
      return pc.createAnswer();
    }).then(function (answer) {
      return pc.setLocalDescription(answer).then(function () { return answer; });
    }).then(function (answer) {
      sig.send({ kind: 'answer', from: guestId, to: 'host', sdp: answer.sdp });
    }).catch(function () { rejoin(); });
  }
  function rejoin() {
    if (closed || failed) return;
    if (rejoinCount >= 3) { failed = true; setStatus('failed', { reason: 'ice' }); return; }
    rejoinCount++;
    if (everOpened) connectDeadline = Date.now() + CONNECT_TIMEOUT_MS; // 一度つながった後の復帰には新しい期限を与える
    teardownPc();
    restartTried = false; isOpen = false;
    sendWant(); // 既知 guestId なので開始後でも再入室できる
  }
  function teardownPc() {
    if (pc) { try { pc.close(); } catch (e) {} }
    pc = null; evCh = null; ephCh = null; isOpen = false;
  }
  function teardown() {
    closed = true;
    if (connectTimer) clearTimeout(connectTimer);
    if (restartTimer) clearTimeout(restartTimer);
    teardownPc();
    sig.close();
  }

  var session = makeSessionFacade({
    role: 'guest', code: code, guestId: guestId, engine: engine,
    hooks: hooks, callbacks: callbacks,
    sendEphemeral: function (kind, data) { sendEph(ephCh, { kind: kind, data: data }); },
    setProfile: function (p) {
      // ev チャンネルでホストへ送る (ホストが調停して roster で返してくる)
      var sp = sanitizeProfile(p);
      var m = { t: 'profile' };
      if (sp) {
        if (sp.name != null) m.name = sp.name;
        if (sp.icon != null) m.icon = sp.icon;
        if (sp.color != null) m.color = sp.color;
      }
      sendEvRaw(m);
    },
    setHandicap: function (level) {
      // ハンデも ev チャンネルでホストへ送る (名簿に載って roster で返る)
      var sh = sanitizeHandicap(level);
      sendEvRaw({ t: 'handicap', level: sh == null ? 0 : sh });
    },
    leave: function () {
      if (closed) return;
      sig.send({ kind: 'bye', from: guestId, to: 'host' });
      teardown();
      setStatus('closed');
    }
  });
  // heartbeat (ephemeral): ホスト側のリース生存判定に使う
  var hb = setInterval(function () {
    if (!closed && isOpen) sendEph(ephCh, { kind: 'heartbeat', data: null });
  }, 3000);
  var origLeave = session.leave;
  session.leave = function () { clearInterval(hb); origLeave(); };
  return session;
}

/* ---------------- 手動コード方式 (仲介B、2人専用) ------------------- */
function manualBase(role, hooks, callbacks) {
  var pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
  var state = { pc: pc, evCh: null, ephCh: null, open: false, verify: null, profiles: {}, handicaps: {} };
  /* 手動方式には roster の仕組みがないので、プロフィールが揃うたびに
   * 2人分の在室一覧を組み直して onPeers で渡す。色の調停は両端末が
   * 同じ profiles から resolveProfileColors で決定的に計算して一致させる */
  state.emitPeers = function () {
    if (!callbacks.onPeers) return;
    var players = [
      { playerId: HOST_ID, color: 0, isHost: true },
      { playerId: 'g1', color: 1, isHost: false }
    ];
    callbacks.onPeers(peerListWithProfiles(players, state.profiles, function () { return state.open; }, state.handicaps));
  };
  var engine = createEngine({
    role: role, hooks: hooks,
    net: role === 'host' ? {
      broadcast: function (msg) { sendEv(state, msg); },
      sendTo: function (id, msg) { sendEv(state, msg); }
    } : {
      sendToHost: function (msg) { sendEv(state, msg); }
    },
    onReject: callbacks.onReject, onError: callbacks.onError,
    onEvent: function (ev, meta) { if (callbacks.onEvent) callbacks.onEvent(ev, meta); }
  });
  function sendEv(st, msg) {
    if (!st.evCh || st.evCh.readyState !== 'open') return;
    var m = {}; for (var k in msg) m[k] = msg[k];
    m.ep = 1;
    try { st.evCh.send(JSON.stringify(m)); } catch (e) {}
  }
  state.sendEv = sendEv;
  pc.oniceconnectionstatechange = function () {
    if (pc.iceConnectionState === 'failed' && callbacks.onStatus)
      callbacks.onStatus('failed', { reason: 'ice' }); // 手動方式は再交渉の経路がない
  };
  return { pc: pc, state: state, engine: engine };
}
function wireManualChannels(role, ctx, onOpen, callbacks) {
  var pc = ctx.pc, state = ctx.state, engine = ctx.engine;
  function attach(ch) {
    if (ch.label === 'ev') state.evCh = ch; else state.ephCh = ch;
    ch.onmessage = function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (ch.label === 'eph') {
        if (role === 'host') engine.noteActivity('g1');
        if (callbacks && callbacks.onEphemeral)
          callbacks.onEphemeral(msg.kind, msg.data, msg.from || (role === 'host' ? 'g1' : HOST_ID));
        return;
      }
      if (msg && msg.t === 'profile') {
        // プロフィールはエンジンに渡さず名簿に保持する (MP改善#4)
        var senderId = role === 'host' ? 'g1' : HOST_ID;
        var sp = sanitizeProfile(msg);
        if (sp) state.profiles[senderId] = sp; else delete state.profiles[senderId];
        state.emitPeers();
        return;
      }
      if (msg && msg.t === 'handicap') {
        // ハンデもエンジンに渡さず名簿に保持する (プロフィールと同じ方式)
        var hSenderId = role === 'host' ? 'g1' : HOST_ID;
        var sh = sanitizeHandicap(msg.level);
        state.handicaps[hSenderId] = sh == null ? 0 : sh;
        state.emitPeers();
        return;
      }
      if (role === 'host') engine.receive('g1', msg);
      else engine.receiveFromHost(msg);
    };
    ch.onopen = function () {
      if (state.evCh && state.ephCh &&
          state.evCh.readyState === 'open' && state.ephCh.readyState === 'open' &&
          !state.open) {
        state.open = true; state.emitPeers(); onOpen();
      }
    };
  }
  return attach;
}
/* 手動方式の setProfile: 自分の分を名簿に入れ、相手へ { t:'profile' } で
 * 送り、両端末が同じ名簿から色を調停できるようにする */
function manualSetProfile(state, myId, p) {
  var sp = sanitizeProfile(p);
  if (sp) state.profiles[myId] = sp; else delete state.profiles[myId];
  var m = { t: 'profile' };
  if (sp) {
    if (sp.name != null) m.name = sp.name;
    if (sp.icon != null) m.icon = sp.icon;
    if (sp.color != null) m.color = sp.color;
  }
  state.sendEv(state, m);
  state.emitPeers();
}
/* 手動方式の setHandicap: 自分の分を名簿に入れ、相手へ { t:'handicap' }
 * で送る。両端末が同じ名簿を持つので段階も一致する */
function manualSetHandicap(state, myId, level) {
  var sh = sanitizeHandicap(level);
  state.handicaps[myId] = sh == null ? 0 : sh;
  state.sendEv(state, { t: 'handicap', level: state.handicaps[myId] });
  state.emitPeers();
}
function manualHost(hooks, callbacks, options) {
  callbacks = callbacks || {};
  var ctx = manualBase('host', hooks, callbacks);
  var pc = ctx.pc, state = ctx.state, engine = ctx.engine;
  var attach = wireManualChannels('host', ctx, function () {
    engine.addPlayer('g1', 1, 1);
    state.sendEv(state, {
      t: 'welcome', playerId: 'g1', color: 1,
      started: engine.isStarted(), lastSeq: engine.getWatermark(), verify: state.verify
    });
    if (callbacks.onStatus) callbacks.onStatus('open');
    if (engine.isStarted()) engine.sendSnapshotTo('g1');
  }, callbacks);
  state.evCh = pc.createDataChannel('ev', { ordered: true });
  state.ephCh = pc.createDataChannel('eph', { ordered: false, maxRetransmits: 0 });
  attach(state.evCh); attach(state.ephCh);
  var offerPromise = pc.createOffer().then(function (offer) {
    return pc.setLocalDescription(offer).then(function () { return offer; });
  });
  var session = makeSessionFacade({
    role: 'host', code: null, engine: engine, hooks: hooks, callbacks: callbacks,
    sendEphemeral: function (kind, data) { sendEph(state.ephCh, { kind: kind, data: data, from: HOST_ID }); },
    setProfile: function (p) { manualSetProfile(state, HOST_ID, p); },
    setHandicap: function (level) { manualSetHandicap(state, HOST_ID, level); },
    leave: function () { try { pc.close(); } catch (e) {} if (callbacks.onStatus) callbacks.onStatus('closed'); }
  });
  session.getOfferCode = function () {
    return offerPromise.then(function (offer) {
      state.verify = fingerprintCode(offer.sdp);
      if (callbacks.onVerifyCode && state.verify) callbacks.onVerifyCode(state.verify);
      return waitIceComplete(pc);
    }).then(function () {
      return encodeManualCode({ v: 1, kind: 'offer', sdp: pc.localDescription.sdp });
    });
  };
  session.acceptAnswer = function (codeStr) {
    return decodeManualCode(codeStr).then(function (obj) {
      if (!obj || obj.kind !== 'answer') throw new Error('answer コードではありません');
      return pc.setRemoteDescription({ type: 'answer', sdp: obj.sdp });
    });
  };
  return session;
}
function manualGuest(hooks, callbacks, options) {
  callbacks = callbacks || {};
  var ctx = manualBase('guest', hooks, callbacks);
  var pc = ctx.pc, state = ctx.state, engine = ctx.engine;
  var attach = wireManualChannels('guest', ctx, function () {
    if (callbacks.onStatus) callbacks.onStatus('open');
  }, callbacks);
  pc.ondatachannel = function (ev) { attach(ev.channel); };
  var session = makeSessionFacade({
    role: 'guest', code: null, engine: engine, hooks: hooks, callbacks: callbacks,
    sendEphemeral: function (kind, data) { sendEph(state.ephCh, { kind: kind, data: data }); },
    setProfile: function (p) { manualSetProfile(state, 'g1', p); },
    setHandicap: function (level) { manualSetHandicap(state, 'g1', level); },
    leave: function () { try { pc.close(); } catch (e) {} if (callbacks.onStatus) callbacks.onStatus('closed'); }
  });
  session.playerId = 'g1';
  session.acceptOffer = function (codeStr) {
    return decodeManualCode(codeStr).then(function (obj) {
      if (!obj || obj.kind !== 'offer') throw new Error('offer コードではありません');
      var verify = fingerprintCode(obj.sdp);
      if (verify && callbacks.onVerifyCode) callbacks.onVerifyCode(verify);
      return pc.setRemoteDescription({ type: 'offer', sdp: obj.sdp });
    }).then(function () { return pc.createAnswer(); })
      .then(function (answer) {
        return pc.setLocalDescription(answer).then(function () { return answer; });
      }).then(function () { return waitIceComplete(pc); })
      .then(function () {
        return encodeManualCode({ v: 1, kind: 'answer', sdp: pc.localDescription.sdp });
      });
  };
  return session;
}

/* ---------------- セッション共通の顔 -------------------------------- */
function makeSessionFacade(o) {
  var session = {
    role: o.role, code: o.code || null, guestId: o.guestId || null,
    playerId: o.role === 'host' ? HOST_ID : (o.playerId || null),
    engine: o.engine,
    sendEvent: function (ev) { return o.engine.request(ev); },
    sendEphemeral: o.sendEphemeral,
    setProfile: function (p) { if (o.setProfile) o.setProfile(p); },
    setHandicap: function (level) { if (o.setHandicap) o.setHandicap(level); },
    hostStart: function (payload) {
      var ev = { t: 'start' }; for (var k in (payload || {})) ev[k] = payload[k];
      o.engine.hostControl(ev);
    },
    hostNext: function (payload) {
      var ev = { t: 'next' }; for (var k in (payload || {})) ev[k] = payload[k];
      o.engine.hostControl(ev);
    },
    setReady: function () { o.engine.setReady(); },
    leave: o.leave
  };
  return session;
}

/* ---------------- 公開 API ------------------------------------------ */
var api = {
  createRoom: createRoom,
  joinRoom: joinRoom,
  manualHost: manualHost,
  manualGuest: manualGuest,
  createEngine: createEngine,
  makeRoomCode: makeRoomCode,
  normalizeRoomCode: normalizeRoomCode,
  encodeManualCode: encodeManualCode,
  decodeManualCode: decodeManualCode,
  fingerprintCode: fingerprintCode,
  HOST_ID: HOST_ID,
  sanitizeProfile: sanitizeProfile,
  sanitizeHandicap: sanitizeHandicap,
  resolveProfileColors: resolveProfileColors,
  peerListWithProfiles: peerListWithProfiles,
  PROFILE_COLOR_COUNT: PROFILE_COLOR_COUNT,
  GROUP_GRAB_MAX: GROUP_GRAB_MAX,
  EPH_COALESCE_MS: EPH_COALESCE_MS,
  createEphCoalescer: createEphCoalescer,
  _internals: { createSignaling: createSignaling, SUPABASE_URL: SUPABASE_URL }
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.JigsawMP = api;
})();
