// 공통 도구: 연결 · 서버 시계 · 실시간 구독(+자동 대비책) · 등대 불빛 계산
const C = window.APP_CONFIG;
const db = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const show = id => $$('.view').forEach(v => v.hidden = v.id !== id);

const CATS = { sci: '🔬 과학', soc: '🗺️ 사회', word: '📖 낱말·속담', brain: '🧠 상식' };
const SEA = ['🐙', '🐳', '🦀', '🐢', '🐬', '🦭', '🦑', '🐠'];

async function rpc(fn, args) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

let offset = 0;                                   // 서버 시계와의 차이 = S - (t0+t1)/2
async function syncClock() {
  const t0 = Date.now(); const s = await rpc('server_time'); const t1 = Date.now();
  offset = new Date(s).getTime() - (t0 + t1) / 2;
}
const now = () => Date.now() + offset;
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

function throttle(fn, ms) {
  let last = 0, pend = null;
  return () => {
    const d = Date.now() - last;
    if (d >= ms) { last = Date.now(); fn(); }
    else if (!pend) pend = setTimeout(() => { pend = null; last = Date.now(); fn(); }, ms - d);
  };
}

// 구독 + 6초 안에 안 되면 1.5초마다 가져오기 + 10초마다 전체 다시 맞춤
function startSync(tables, refresh) {
  let ok = false; const t0 = Date.now(); const timers = [];
  const ch = db.channel('c' + Math.random().toString(36).slice(2));
  tables.forEach(t => ch.on('postgres_changes', { event: '*', schema: 'public', table: t.table, filter: t.filter }, () => refresh()));
  const badge = v => { const b = $('#sync'); if (b) { b.textContent = v ? '● 실시간 연결됨' : '● 자동 새로고침 중'; b.className = 'sync ' + (v ? 'on' : 'off'); } };
  badge(false);
  ch.subscribe(s => { ok = s === 'SUBSCRIBED'; badge(ok); });
  timers.push(setInterval(() => { if (!ok && Date.now() - t0 > 6000) refresh(); }, 1500));
  timers.push(setInterval(refresh, 10000));
  return { stop() { timers.forEach(clearInterval); db.removeChannel(ch); } };
}

// 지금 불빛(0~100). DB의 _eff 함수와 같은 식: 폭풍 15초 동안은 2배로 꺼짐
function lightNow(l, room) {
  const t = now(), at = Date.parse(l.light_at);
  const dt = Math.max(0, (t - at) / 1000); let ov = 0;
  if (room.storm_until) { const se = Date.parse(room.storm_until); ov = Math.max(0, (Math.min(t, se) - Math.max(at, se - 15000)) / 1000); }
  return Math.max(0, Math.min(100, l.light - room.decay * Math.max(l.n, 1) * (dt + ov)));
}
const byJoin = a => a.sort((x, y) => new Date(x.joined_at) - new Date(y.joined_at));

// 결과: 별 등급 + 여러 종류의 상 (순위 대신)
function starsOf(pl, room) {
  if (room.ended_reason === 'dark') return 0;
  const rate = pl.reduce((a, p) => a + p.correct, 0) / Math.max(1, pl.length) / (room.duration / 60);
  return rate >= 6.5 ? 3 : rate >= 4.5 ? 2 : 1;
}
function awardsOf(pl) {
  const best = k => { const m = Math.max(0, ...pl.map(p => p[k])); return m > 0 ? pl.filter(p => p[k] === m) : []; };
  return [['🌟 별빛 요정', 'correct', '개 정답'], ['🔥 콤보 왕', 'best_streak', '연속 정답'], ['💪 도전왕', 'solved', '문제 도전']]
    .map(([t, k, u]) => { const w = best(k); return w.length ? { t, names: w.map(p => p.animal + p.nickname).join(', '), v: w[0][k] + u } : null; })
    .filter(Boolean);
}
