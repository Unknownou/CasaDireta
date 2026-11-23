/* utils.js — constantes, formatadores e helpers puros (sem estado, sem DOM além de ícones). */
export const PRICE = 99;
export function operatorForPhone(phone = '') {
  const digitsOnly = String(phone).replace(/\D/g, '');
  const local = digitsOnly.startsWith('258') ? digitsOnly.slice(3) : digitsOnly;
  if (/^(82|83|84|85)\d{7}$/.test(local)) return 'mpesa';
  if (/^(86|87)\d{7}$/.test(local)) return 'emola';
  return null;
}
export const DAY = 864e5;
export const OTP_CODE = '1234';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const num = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const mt = n => num(n) + ' MT';
export const digits = s => String(s || '').replace(/\D/g, '');
export const validPhone = p => /^(82|83|84|85|86|87)\d{7}$/.test(p);
export const fmtPhone = p => { const d = String(p || '').replace(/\D/g, ''), local = (d.startsWith('258') ? d.slice(3) : d).slice(-9); return `+258 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`; };
export const mzPhone = p => { const d = String(p || '').replace(/\D/g, ''); const local = d.startsWith('258') ? d.slice(3) : d; return local ? `258${local.slice(-9)}` : ''; };
export const first = n => String(n || '').trim().split(/\s+/)[0] || '';
export const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const fmtDate = ts => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? 'Data não disponível' : d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Maputo' }); };
export const fmtTime = ts => new Date(ts).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Maputo' });
export const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export const roomsTxt = n => (n >= 4 ? '4+ quartos' : n === 1 ? '1 quarto' : `${n} quartos`);

export const TYPES = { quarto: 'Quarto Individual', dep: 'Dependência', t1: 'Tipo 1', t2: 'Tipo 2', t3: 'Tipo 3+' };
export const TITLE = { quarto: 'Quarto individual', dep: 'Dependência', t1: 'Casa Tipo 1', t2: 'Casa Tipo 2', t3: 'Casa Tipo 3+' };
export const DEF_ROOMS = { quarto: 1, dep: 1, t1: 1, t2: 2, t3: 3 };
export const AM = {
  agua: ['droplets', 'Água 24h'],
  credelec: ['zap', 'Energia Credelec Independente'],
  quintal: ['fence', 'Quintal Murado'],
  paragem: ['bus', 'Perto da Paragem'],
  wc: ['bath', 'WC interno']
};
export const PRICES = {
  p1: { l: 'Até 2.500 MT', r: [0, 2500] },
  p2: { l: '2.500–5.000 MT', r: [2501, 5000] },
  p3: { l: '5.000–10.000 MT', r: [5001, 10000] },
  p4: { l: '+10.000 MT', r: [10001, 1e9] }
};
export const ZONES = ['Zimpeto', 'Polana Caniço', 'Maxaquene', 'Hulene', 'Coop', 'Alto Maé', 'Malhangalene', 'Matola'];
export const HOODS = [...ZONES, 'Matola T3', 'Malhampsene', 'UEM'];
export const ADV = ['1 mês adiantado + 1 caução', '2 meses adiantados', '3 meses adiantados', '1 mês adiantado', '1 mês adiantado + meio mês de caução', 'Água e energia incluídas, 1 mês adiantado'];
export const HABITS = ['Não fuma', 'Organizado', 'Sossegado', 'Estudioso', 'Trabalha de dia', 'Sem animais'];
export const REPORTS = { fee: 'Pede taxa de visita', rented: 'Já está alugado', fake: 'Fotos ou informação falsa', sus: 'Comportamento suspeito' };

/* ───────────── Ícones ───────────── */
export const ic = (n, c = 'w-5 h-5') => `<i data-lucide="${n}" class="${c}" aria-hidden="true"></i>`;
export const icons = () => { try { window.lucide && lucide.createIcons(); } catch (e) { /* offline: segue sem ícones */ } };

/* ───────────── Fotos ilustrativas (SVG, zero dados) ───────────── */
export const PAL = [['#0F766E', '#99F6E4'], ['#1E293B', '#CBD5E1'], ['#B45309', '#FDE68A'], ['#4338CA', '#C7D2FE'], ['#BE123C', '#FECDD3'], ['#047857', '#A7F3D0']];
export function scene(seed, i) {
  const [c1, c2] = PAL[(hash(seed) + i) % PAL.length], k = i % 3;
  let g;
  if (k === 0) g = `<rect y="150" width="400" height="150" fill="${c2}" opacity=".55"/><rect x="95" y="95" width="210" height="110" rx="4" fill="#fff"/><path d="M80 98 200 35 320 98Z" fill="${c1}"/><rect x="180" y="140" width="40" height="65" fill="${c1}"/><rect x="115" y="120" width="45" height="38" fill="${c2}"/><rect x="240" y="120" width="45" height="38" fill="${c2}"/><rect x="40" y="195" width="320" height="10" fill="#0F172A" opacity=".15"/>`;
  else if (k === 1) g = `<rect y="190" width="400" height="110" fill="#0F172A" opacity=".18"/><rect x="250" y="50" width="100" height="90" rx="3" fill="#fff" opacity=".9"/><path d="M300 50v90M250 95h100" stroke="${c1}" stroke-width="4"/><rect x="50" y="150" width="170" height="60" rx="8" fill="#fff"/><rect x="50" y="135" width="60" height="30" rx="8" fill="${c2}"/><rect x="40" y="205" width="190" height="10" rx="3" fill="${c1}"/>`;
  else g = `<rect y="200" width="400" height="100" fill="${c2}" opacity=".6"/><rect x="0" y="130" width="400" height="75" fill="#fff" opacity=".8"/><circle cx="90" cy="95" r="45" fill="${c1}"/><rect x="85" y="130" width="10" height="75" fill="#0F172A" opacity=".5"/><circle cx="330" cy="50" r="22" fill="#F59E0B"/>`;
  const label = ['Exterior · fachada', 'Interior · quarto', 'Exterior · quintal'][k];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c2}"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/>${g}<text x="12" y="288" font-family="sans-serif" font-size="14" fill="#0F172A" opacity=".55">Foto ilustrativa · ${label}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
export const photoCache = new Map();
/* Devolve { ext: [...], int: [...] }. Anúncios de demonstração geram imagens SVG leves. */
export function photosOf(l) {
  if ((l.ext && l.ext.length) || (l.int && l.int.length)) return { ext: l.ext || [], int: l.int || [] };
  if (!photoCache.has(l.id)) photoCache.set(l.id, { ext: [scene(l.id, 0), scene(l.id, 2)], int: [scene(l.id, 1), scene(l.id, 4)] });
  return photoCache.get(l.id);
}
export const coverOf = l => { const p = photosOf(l); return p.ext[0] || p.int[0]; };
export const photoCount = l => { const p = photosOf(l); return p.ext.length + p.int.length; };
export const RULES = [
  ['Sem barulho após 22h', 'Água incluída na renda', 'Proibido fumar dentro de casa'],
  ['Sem visitas depois das 21h', 'Energia (credelec) paga pelo inquilino', 'Manter o quintal limpo'],
  ['Sem barulho após 22h', 'Sem animais', 'Caução devolvida à saída']
];
export const DESCS = [
  'Quarto arejado em casa de família, com janela e porta com cadeado. Ambiente calmo, ideal para estudante ou trabalhador.',
  'Dependência independente, entrada própria e boa ventilação. Fica numa rua tranquila e bem iluminada.',
  'Espaço limpo e bem cuidado, com cozinha partilhada. O proprietário mora no mesmo quintal.',
  'Casa recém-pintada, sala e cozinha separadas. Rua com transporte regular durante todo o dia.'
];
/* ── Acesso: 15 dias grátis -> bloqueio -> subscrição de 99 MT (a data final é validada pelo servidor) ── */
export const TRIAL_DAYS = 15;
export const TERMS_VERSION = 2;
export const epoch = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};
export const accessStatus = (u, now = Date.now()) => {
  if (!u) return null;
  const paidUntil = epoch(u.subscribedUntil);
  const trialUntil = epoch(u.trialEndsAt);
  if (paidUntil > now) return 'SUBSCRIBED_ACTIVE';
  if (!trialUntil) return null; // nunca bloquear uma conta por uma data ausente/inválida
  return trialUntil > now ? 'TRIAL_ACTIVE' : 'TRIAL_EXPIRED';
};
export const subscribed = u => !!u && accessStatus(u) !== 'TRIAL_EXPIRED';
export const daysLeft = ts => Math.max(0, Math.ceil((epoch(ts) - Date.now()) / DAY));
export const homeOf = u => (u.mode === 'proprietario' ? 'owner' : 'home');
