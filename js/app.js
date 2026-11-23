/* app.js — camada de UI do CasaDireta (módulo ES).
   Dados: apiService.js · Estado e máquina de estados: store.js · Configuração: config.js */
import { store, init, currentScreen, persist, startSession, endSession, refreshSubscription, refreshProperties, refreshNotifications, refreshRoommates, refreshUser, setUser, forgetLocalUser, resetAll } from './store.js';
import * as api from './apiService.js';
import { enablePushNotifications } from './notificationService.js';
import { syncIdentity } from './tupc.js';
import { OTP_RESEND_SECONDS } from './config.js';
import { $, $$, esc, norm, num, mt, digits, validPhone, fmtPhone, first, initials, uid, fmtDate, fmtTime, roomsTxt, TYPES, AM, PRICES, ZONES, HOODS, ADV, HABITS, REPORTS, ic, icons, scene, photosOf, coverOf, photoCount, PRICE, DAY, TRIAL_DAYS, TERMS_VERSION, accessStatus, subscribed, daysLeft, homeOf, operatorForPhone } from './utils.js';

const L = new Proxy({}, { get: (_, k) => store.local[k] });   // dados locais do cliente (favoritos, contactos...)
const me = () => store.user;
const save = persist;
const isFav = (u, id) => (L.favs[u.id] || []).includes(id);

/* Estado de interface (memória) */
const newFilters = () => ({ q: '', zone: 'all', type: 'all', price: 'all', am: [], sort: 'new' });
const ui = { f: newFilters(), ft: null, otp: null, pay: null, w: null, receipt: null, mount: null, seen: {}, published: null, del: null, returnPayment: null };
let timers = [];
const setPath = (o, p, v) => { const k = p.split('.'); let c = o; while (k.length > 1) c = c[k.shift()]; c[k[0]] = v; };
const busy = {};
const once = (k, ms = 800) => { if (busy[k]) return false; busy[k] = 1; setTimeout(() => delete busy[k], ms); return true; };

/* ───────────── Máquina de estados + router ───────────── */
/* AUTH · OTP · SUBSCRIPTION_PAYWALL · APP_MAIN  — calculado SEMPRE a partir do estado guardado */

const view = $('#view'), chrome = $('#chrome'), sheet = $('#sheet'), toastEl = $('#toast');
const syncStamp = value => JSON.stringify((value || []).map(x => ({ id: x.id, updated: x.updated || x.updated_at, created: x.created || x.created_at, price: x.price || x.price_mzn, rented: x.rented, views: x.views, count: (x.ext || x.exterior_paths || []).length + (x.int || x.interior_paths || []).length })));
const AUTH_ROUTES = ['welcome', 'login', 'register', 'forgot', 'reset'];
const NAVR = ['home', 'roommates', 'favorites', 'profile', 'owner'];
const TENANT_R = ['home', 'roommates', 'favorites'];
const OWNER_R = ['owner', 'publish'];

const parse = () => { const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?'); const [r, ...p] = path.split('/'); return { r: r || '', p, q: new URLSearchParams(query) }; };
const nav = to => { if (location.hash === '#/' + to) render(); else location.hash = '#/' + to; };
const redirect = to => { if (location.hash === '#/' + to) render(); else location.replace('#/' + to); };

function render() {
  if (!store.ready) return;
  timers.forEach(clearInterval); timers = [];
  closeSheet();
  const { r, p, q } = parse(), u = me(), sc = currentScreen();
  const V = { welcome: vWelcome, register: vRegister, otp: vOtp, login: vLogin, forgot: vForgot, reset: vReset, home: vHome, listing: vListing, roommates: vRoommates, favorites: vFavorites, profile: vProfile, owner: vOwner, publish: vPublish, pay: vPay, receipt: vReceipt, published: vPublished };

  /* Route Guard: cada estado só deixa ver as suas telas */
  if (sc === 'AUTH') {
    if (!AUTH_ROUTES.includes(r)) return redirect('welcome');
    if (r === 'reset' && !(store.pendingOtp && store.pendingOtp.verified)) return redirect('forgot');
  } else if (sc === 'OTP') {
    if (r !== 'otp') return redirect('otp');
  } else if (sc === 'SUBSCRIPTION_PAYWALL') {
    if (r !== 'pay') return redirect('pay');
  } else {
    const prop = u.mode === 'proprietario';
    if (!V[r] || r === '' || AUTH_ROUTES.includes(r) || r === 'otp') return redirect(homeOf(u));
    if (!prop && OWNER_R.includes(r)) return redirect('home');
    if (prop && TENANT_R.includes(r)) return redirect('owner');
    if (r === 'listing') { const l = store.properties.find(x => x.id === p[0]); if (prop && !(l && l.ownerId === u.id)) return redirect('owner'); }
  }
  if (r !== 'pay') ui.pay = null;

  ui.mount = null;
  const fn = V[r];
  view.innerHTML = fn ? fn(p[0]) : vNotFound();
  view.scrollTop = 0;
  renderChrome(r, sc === 'APP_MAIN' ? u : null);
  icons();
  if (ui.mount) { ui.mount(); ui.mount = null; }
  const returnedPayment = q.get('payment');
  if (r === 'pay' && returnedPayment && returnedPayment !== ui.returnPayment && u) {
    ui.returnPayment = returnedPayment;
    ui.pay = { method: methodForPhone(u.phone) || 'mpesa', phone: localAccountPhone(u.phone), status: 'processing', token: uid(), paymentId: returnedPayment, error: '' };
    void pollPayment(ui.pay.token);
  }
}

function renderChrome(r, u) {
  if (!u || !NAVR.includes(r)) { chrome.innerHTML = ''; return; }
  const items = u.mode === 'proprietario'
    ? [['owner', 'layout-list', 'Minhas Casas'], ['publish', 'circle-plus', 'Publicar'], ['profile', 'user', 'Perfil']]
    : [['home', 'home', 'Início'], ['roommates', 'users', 'Dividir'], ['favorites', 'heart', 'Favoritos'], ['profile', 'user', 'Perfil']];
  const fab = r === 'owner' ? `<button data-act="add" class="absolute right-4 bottom-24 z-30 h-14 px-5 rounded-full bg-brand text-white font-bold shadow-xl flex items-center gap-2 active:scale-95">${ic('plus', 'w-5 h-5')} Nova casa</button>` : '';
  const unread = store.notifications?.length || 0;
  chrome.innerHTML = `${fab}${unread ? `<button data-act="notifications" class="fixed right-4 top-4 z-30 w-11 h-11 rounded-full bg-white shadow border border-slate-100 text-brand" aria-label="${unread} notificações novas">${ic('bell', 'w-5 h-5 mx-auto')}<span class="absolute -right-1 -top-1 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[10px] grid place-items-center">${unread > 9 ? '9+' : unread}</span></button>` : ''}<nav class="bg-white border-t border-slate-200 flex pb-[env(safe-area-inset-bottom)]" aria-label="Navegação principal">${items.map(([to, i, l]) => `
    <button data-act="go" data-to="${to}" class="flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[11px] font-semibold ${to === r ? 'text-brand' : 'text-slate-500'}" ${to === r ? 'aria-current="page"' : ''}>${ic(i, 'w-6 h-6')}${l}</button>`).join('')}</nav>`;
}

/* ───────────── Pequenos componentes ───────────── */
const top = (title, back = true, right = '') => `
  <header class="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-100 px-2.5 sm:px-4 min-h-14 flex items-center gap-2">
    ${back ? `<button data-act="back" class="inline-flex shrink-0 items-center gap-1.5 min-h-10 px-2.5 rounded-xl text-brand font-bold text-sm hover:bg-emerald-50 active:bg-emerald-100" aria-label="Voltar">${ic('arrow-left', 'w-5 h-5 shrink-0')}<span>Voltar</span></button>` : ''}
    <h1 class="font-extrabold text-[16px] sm:text-[17px] flex-1 min-w-0 truncate ${back ? '' : 'pl-2'}">${title}</h1>${right}
  </header>`;
const err = id => `<p id="e-${id}" class="text-xs text-red-600 font-medium mt-1 min-h-[1rem]" role="alert"></p>`;
const phoneField = (id, val = '', bind = '') => { const raw = String(val || '').replace(/\D/g, ''), local = raw.startsWith('258') ? raw.slice(3) : raw, binding = bind ? ` data-bind="${bind}"` : ''; return `<div class="field-wrap" id="w-${id}"><span class="prefix">+258</span><input id="${id}" type="tel" inputmode="numeric" autocomplete="tel-national" data-digits${binding} placeholder="84 123 4567" value="${esc(local.slice(-9))}" aria-label="Número de telemóvel"></div>`; };
const pwField = (id, ph = 'Senha', ac = 'current-password') => `<div class="field-wrap" id="w-${id}"><input id="${id}" type="password" autocomplete="${ac}" placeholder="${ph}" aria-label="${ph}"><button type="button" data-act="eye" data-target="${id}" class="px-3 text-slate-500" aria-label="Mostrar ou ocultar senha">${ic('eye')}</button></div>`;
const heart = (id, on, cls = '') => `<button data-act="fav" data-id="${id}" class="w-9 h-9 rounded-full bg-white/95 shadow grid place-items-center ${cls}" aria-label="${on ? 'Remover dos favoritos' : 'Guardar nos favoritos'}" aria-pressed="${on}">${ic('heart', on ? 'w-5 h-5 fill-red-500 text-red-500' : 'w-5 h-5 text-slate-700')}</button>`;
const badgeVerified = (c = '', t = 'Proprietário Verificado') => `<span class="inline-flex items-center gap-1 bg-amber-500 text-ink text-[11px] font-bold px-2 py-1 rounded-full ${c}">${ic('badge-check', 'w-3.5 h-3.5')}${t}</span>`;
const empty = (icon, title, text, btn = '') => `<div class="text-center py-14 px-8"><div class="w-20 h-20 mx-auto rounded-full bg-emerald-50 text-brand grid place-items-center">${ic(icon, 'w-9 h-9')}</div><h2 class="mt-4 font-extrabold text-lg">${title}</h2><p class="text-sm text-slate-500 mt-1">${text}</p>${btn}</div>`;
const primaryBtn = (label, act, extra = '', cls = '') => `<button data-act="${act}" ${extra} class="w-full py-3.5 rounded-xl bg-brand text-white font-bold text-[15px] active:scale-[.98] shadow-sm ${cls}">${label}</button>`;
const avatar = (u, cls = 'w-20 h-20 text-2xl', ring = 'bg-white text-brand') => u && u.photo
  ? `<img src="${u.photo}" alt="Foto de ${esc(u.name)}" class="${cls} rounded-full object-cover bg-white shrink-0">`
  : `<span class="${cls} rounded-full ${ring} font-extrabold grid place-items-center shrink-0">${initials(u ? u.name : '?')}</span>`;

function toast(msg) {
  toastEl.innerHTML = `<div class="t">${esc(msg)}</div>`;
  clearTimeout(toast.t); toast.t = setTimeout(() => (toastEl.innerHTML = ''), 2800);
}
function showNotifications() {
  const items = store.notifications || [];
  openSheet('Notificações', items.length ? `<div class="space-y-3">${items.map(n => { const parts = String(n.type || '').split(':'); const reply = parts[0] === 'roommate_message' && parts[1] && parts[2]; return `<article class="rounded-xl bg-emerald-50 p-3"><p class="font-bold text-sm">${esc(n.title)}</p><p class="text-xs text-slate-600 mt-1">${esc(n.body)}</p><p class="text-[11px] text-slate-400 mt-2">${fmtDate(n.created)}</p>${reply ? `<button data-act="notification-reply" data-roommate-id="${esc(parts[1])}" data-from-user-id="${esc(parts[2])}" class="mt-3 w-full py-2.5 rounded-xl bg-brand text-white text-sm font-bold">Responder</button>` : ''}</article>`; }).join('')}</div>` : '<p class="text-sm text-slate-500 py-8 text-center">Ainda não há notificações.</p>');
  if (items.length) api.markNotificationsRead(items.map(n => n.id)).then(() => { store.notifications = []; renderChrome(parse().r, me()); });
}
function openSheet(title, body) {
  sheet.innerHTML = `<div class="absolute inset-0 z-40 flex items-end bg-ink/50 fade-in" data-act="backdrop"><div role="dialog" aria-modal="true" aria-label="${esc(title)}" class="sheet-in w-full max-h-[90%] overflow-y-auto bg-white rounded-t-3xl p-5 pb-7">
    <div class="flex items-center justify-between mb-3"><h2 class="font-extrabold text-lg">${title}</h2><button data-act="close" class="w-9 h-9 grid place-items-center rounded-full bg-slate-100" aria-label="Fechar">${ic('x')}</button></div>${body}</div></div>`;
  icons();
}
let liveChatTimer = 0;
function closeSheet() { if (liveChatTimer) { clearInterval(liveChatTimer); liveChatTimer = 0; } sheet.innerHTML = ''; }
function setErr(id, msg) {
  const e = $('#e-' + id); if (e) e.textContent = msg || '';
  const w = $('#w-' + id) || $('#' + id); if (w) w.classList.toggle('field-err', !!msg);
}
const clearErrs = () => { $$('[id^="e-"]').forEach(e => { e.textContent = ''; }); $$('.field-err').forEach(e => e.classList.remove('field-err')); };
const focusFirstErr = () => { const e = $$('[id^="e-"]').find(x => x.textContent.trim()); if (e) e.scrollIntoView({ block: 'center', behavior: 'smooth' }); };

/* Rede: avisos amigáveis para offline / ligação lenta */
const net = document.createElement('div');
net.id = 'netbar'; net.className = 'absolute top-0 inset-x-0 z-50'; $('#shell').appendChild(net);
function updateNet() {
  const c = navigator.connection, slow = c && (/(^|-)2g$/.test(c.effectiveType || '') || c.saveData);
  if (!navigator.onLine) net.innerHTML = `<div class="bg-red-600 text-white text-xs font-semibold px-4 py-2 text-center">Sem internet. Verifique os dados móveis. As ações são guardadas neste telemóvel.</div>`;
  else if (slow) net.innerHTML = `<div class="bg-amber-500 text-ink text-xs font-semibold px-4 py-2 text-center">Ligação lenta. Aguarde, não toque várias vezes no mesmo botão.</div>`;
  else net.innerHTML = '';
}
addEventListener('online', () => { updateNet(); toast('Internet de volta'); });
addEventListener('offline', updateNet);
try { navigator.connection && navigator.connection.addEventListener('change', updateNet); } catch (e) { /* ignora */ }

/* ───────────── AUTH: boas-vindas, entrar, criar conta, recuperar ───────────── */
const authTabs = a => `<div class="p-4 pb-0"><div class="flex items-center gap-2 mb-4"><img src="assets/casadireta-icon.png" alt="CasaDireta" class="w-9 h-9 rounded-xl object-cover shadow-sm"><span class="font-extrabold text-lg">Casa<span class="text-brand">Direta</span></span></div>
  <div class="grid grid-cols-2 bg-slate-200/70 rounded-xl p-1" role="tablist">
    <button role="tab" aria-selected="${a === 'login'}" data-act="go" data-to="login" class="py-2.5 rounded-lg text-sm font-bold ${a === 'login' ? 'bg-white shadow text-brand' : 'text-slate-600'}">Entrar</button>
    <button role="tab" aria-selected="${a === 'register'}" data-act="go" data-to="register" class="py-2.5 rounded-lg text-sm font-bold ${a === 'register' ? 'bg-white shadow text-brand' : 'text-slate-600'}">Criar Conta</button></div></div>`;

function vWelcome() {
  return `<section class="min-h-full flex flex-col text-white px-6 pt-12 pb-8 bg-gradient-to-b from-brand via-brand to-ink">
    <div class="flex items-center gap-2.5"><img src="assets/casadireta-icon.png" alt="CasaDireta" class="w-11 h-11 rounded-2xl object-cover shadow-sm"><span class="text-2xl font-extrabold tracking-tight">Casa<span class="text-amber-400">Direta</span></span></div>
    <div class="mt-10 flex-1">
      <p class="inline-flex items-center gap-1.5 bg-amber-500 text-ink text-xs font-bold px-3 py-1.5 rounded-full">${ic('badge-check', 'w-4 h-4')} Sem taxas de visita</p>
      <h1 class="mt-4 text-[2rem] leading-[1.15] font-extrabold">Encontre quartos e casas direto com o proprietário.</h1>
      <p class="mt-2 text-lg font-semibold text-emerald-100">Zero intermediários.</p>
      <ul class="mt-8 space-y-3 text-[15px]">
        <li class="flex gap-3 items-center">${ic('phone', 'w-5 h-5 text-amber-400')} Fale direto no WhatsApp do dono</li>
        <li class="flex gap-3 items-center">${ic('banknote', 'w-5 h-5 text-amber-400')} 15 dias grátis. Depois, 99 MT por 30 dias</li>
        <li class="flex gap-3 items-center">${ic('users', 'w-5 h-5 text-amber-400')} Encontre colegas para dividir a renda</li>
      </ul>
    </div>
    <p class="text-center text-sm text-emerald-100/90 mb-4">Aluguer direto, sem intermediários e sem taxas de visita</p>
    <div class="space-y-3">
      <button data-act="go" data-to="login" class="w-full py-3.5 rounded-xl bg-white text-brand font-bold text-[15px] active:scale-[.98]">Entrar</button>
      <button data-act="go" data-to="register" class="w-full py-3.5 rounded-xl bg-amber-500 text-ink font-bold text-[15px] active:scale-[.98]">Criar Conta</button>
    </div></section>`;
}

function vRegister() {
  return `${authTabs('register')}
  <form class="p-5 space-y-4" data-submit="register" novalidate>
    <div><label class="text-sm font-bold" for="name">Nome completo</label><input id="name" class="field mt-1.5" autocomplete="name" placeholder="Ex.: Ana Maria Sitoe">${err('name')}</div>
    <fieldset><legend class="text-sm font-bold mb-1.5">O seu perfil</legend>
      <div class="space-y-2.5">
        <label class="block cursor-pointer"><input type="radio" name="role" value="inquilino" class="peer sr-only"><div class="flex gap-3 items-center p-3.5 rounded-xl border-2 border-slate-200 bg-white peer-checked:border-brand peer-checked:bg-emerald-50 peer-focus-visible:ring-2 ring-brand-light"><span class="w-10 h-10 rounded-full bg-emerald-100 text-brand grid place-items-center">${ic('search')}</span><b class="text-[15px]">Sou Inquilino (Procuro Casa)</b></div></label>
        <label class="block cursor-pointer"><input type="radio" name="role" value="proprietario" class="peer sr-only"><div class="flex gap-3 items-center p-3.5 rounded-xl border-2 border-slate-200 bg-white peer-checked:border-brand peer-checked:bg-emerald-50 peer-focus-visible:ring-2 ring-brand-light"><span class="w-10 h-10 rounded-full bg-amber-100 text-amber-700 grid place-items-center">${ic('key-round')}</span><b class="text-[15px]">Sou Proprietário (Tenho Casa)</b></div></label>
      </div>${err('role')}
    </fieldset>
    <div><label class="text-sm font-bold" for="phone">Número de telemóvel</label><div class="mt-1.5">${phoneField('phone')}</div>${err('phone')}</div>
    <div><label class="text-sm font-bold" for="pw">Criar senha</label><div class="mt-1.5">${pwField('pw', 'Mínimo 6 caracteres', 'new-password')}</div>${err('pw')}</div>
    <div><label class="text-sm font-bold" for="pw2">Confirmar senha</label><div class="mt-1.5">${pwField('pw2', 'Repita a senha', 'new-password')}</div>${err('pw2')}</div>
    <div><label class="flex gap-3 items-start text-sm cursor-pointer"><input type="checkbox" id="terms" class="mt-0.5 w-5 h-5 accent-emerald-700 shrink-0"><span>Li e aceito os <button type="button" data-act="terms" class="text-brand font-bold underline">Termos e Condições</button> e a <button type="button" data-act="terms" class="text-brand font-bold underline">Política de Privacidade</button></span></label>${err('terms')}</div>
    <button class="w-full py-3.5 rounded-xl bg-brand text-white font-bold active:scale-[.98]">Criar Conta e Receber Código</button>
  </form>`;
}
function vLogin() {
  return `${authTabs('login')}
  <form class="p-5 space-y-4" data-submit="login" novalidate>
    <div><label class="text-sm font-bold" for="phone">Número de telemóvel</label><div class="mt-1.5">${phoneField('phone')}</div>${err('phone')}</div>
    <div><label class="text-sm font-bold" for="pw">Senha</label><div class="mt-1.5">${pwField('pw')}</div>${err('pw')}</div>
    <div class="text-right"><button type="button" data-act="go" data-to="forgot" class="text-sm font-bold text-brand">Esqueci a senha</button></div>
    <button class="w-full py-3.5 rounded-xl bg-brand text-white font-bold active:scale-[.98]">Entrar</button>
    <p class="text-xs text-center text-slate-500">Por segurança, enviamos sempre um código SMS ao entrar.</p>
  </form>`;
}
function vForgot() {
  return `${top('Recuperar senha')}
  <form class="p-5 space-y-4" data-submit="forgot" novalidate>
    <p class="text-sm text-slate-600">Indique o número da sua conta. Enviamos um código por SMS para definir uma nova senha.</p>
    <div><label class="text-sm font-bold" for="phone">Número de telemóvel</label><div class="mt-1.5">${phoneField('phone')}</div>${err('phone')}</div>
    <button class="w-full py-3.5 rounded-xl bg-brand text-white font-bold active:scale-[.98]">Enviar código</button>
  </form>`;
}
function vReset() {
  return `${top('Nova senha', false)}
  <form class="p-5 space-y-4" data-submit="reset" novalidate>
    <p class="text-sm text-slate-600">Número verificado. Defina a nova senha para <b>${fmtPhone(store.pendingOtp.phone)}</b>.</p>
    <div><label class="text-sm font-bold" for="pw">Nova senha</label><div class="mt-1.5">${pwField('pw', 'Mínimo 6 caracteres', 'new-password')}</div>${err('pw')}</div>
    <div><label class="text-sm font-bold" for="pw2">Repetir senha</label><div class="mt-1.5">${pwField('pw2', 'Repita a senha', 'new-password')}</div>${err('pw2')}</div>
    <button class="w-full py-3.5 rounded-xl bg-brand text-white font-bold active:scale-[.98]">Guardar nova senha</button>
  </form>`;
}


/* ───────────── OTP (MozSMS) ───────────── */
async function startOtp(purpose, phone, userId, from, context = {}) {
  const r = await api.requestOtp(phone, purpose, context);
  if (!r.ok) return r;
  store.pendingOtp = { purpose, phone, userId, from, context, sentAt: Date.now(), resendIn: (r.data && (r.data.resendIn || r.data.expiresIn)) || OTP_RESEND_SECONDS, verified: false, busy: false, resetToken: null };
  nav('otp');
  return r;
}
function vOtp() {
  const o = store.pendingOtp;
  ui.mount = () => {
    $('#otp0')?.focus();
    const tick = () => {
      const left = Math.max(0, o.resendIn - Math.floor((Date.now() - o.sentAt) / 1000)), b = $('#resend');
      if (!b) return;
      b.disabled = left > 0 || o.busy;
      b.textContent = left > 0 ? `Reenviar código em ${left}s` : 'Reenviar código';
      b.className = 'text-sm font-bold ' + (b.disabled ? 'text-slate-400' : 'text-brand');
    };
    tick(); timers.push(setInterval(tick, 1000));
  };
  return `<div class="p-6 text-center">
    <div class="w-16 h-16 mx-auto mt-4 rounded-full bg-emerald-50 text-brand grid place-items-center">${ic('message-circle', 'w-8 h-8')}</div>
    <h1 class="mt-4 text-xl font-extrabold">Introduza o código</h1>
    <p class="mt-1.5 text-sm text-slate-600">Enviamos um código de 6 dígitos via SMS para<br><b class="text-ink">${fmtPhone(o.phone)}</b></p>
    <button data-act="change-number" class="mt-1 text-sm font-bold text-brand underline">Alterar número</button>
    <div id="otpRow" class="mt-6 flex justify-center gap-2">${[0, 1, 2, 3, 4, 5].map(i => `<input id="otp${i}" class="otp-input" inputmode="numeric" maxlength="1" autocomplete="${i ? 'off' : 'one-time-code'}" aria-label="Dígito ${i + 1}">`).join('')}</div>
    <p id="otpStatus" class="text-sm text-slate-600 mt-3 min-h-[1.25rem]" aria-live="polite"></p>
    <p id="e-otp" class="text-sm text-red-600 font-semibold min-h-[1.25rem]" role="alert"></p>
    <div class="mt-2">${primaryBtn('Confirmar Código', 'otp-confirm')}</div>
    <button id="resend" data-act="resend" class="mt-4 text-sm font-bold text-slate-400" disabled>Reenviar código em ${o.resendIn}s</button>
  </div>`;
}
function setOtpBusy(on) {
  $$('.otp-input').forEach(i => { i.disabled = on; });
  const b = $('[data-act=otp-confirm]'); if (b) { b.disabled = on; b.textContent = on ? 'A verificar...' : 'Confirmar Código'; }
  const s = $('#otpStatus'); if (s) s.textContent = on ? 'A verificar o código...' : '';
}
async function verifyOtp(code) {
  const o = store.pendingOtp; if (!o || o.busy || o.verified) return;
  $('#e-otp').textContent = '';
  o.busy = true; setOtpBusy(true);
  const r = await api.verifyOtp(o.phone, code, o.purpose, o.context || {});
  o.busy = false;
  if (!$('#otpRow')) return;
  setOtpBusy(false);
  if (!r.ok) {
    $('#e-otp').textContent = r.error.message;
    const row = $('#otpRow'); row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
    $$('.otp-input').forEach(i => { i.value = ''; }); $('#otp0').focus(); return;
  }
  if (o.purpose === 'reset') { o.verified = true; o.resetToken = r.data.resetToken; nav('reset'); return; }
  o.verified = true;
  await startSession(r.data.user, r.data.token);
  syncIdentity({ user: r.data.user }).catch(() => {});
  toast('Número verificado');
  nav(homeOf(me()));      // o guard encaminha para o bloqueio se o período grátis já terminou
}

/* ───────────── Fim do período grátis / subscrição de 99 MT (PaySuite · M-Pesa / e-Mola) ───────────── */
const METHODS = { mpesa: { name: 'M-Pesa', op: 'Vodacom', pre: ['82', '83', '84', '85'], c: 'bg-red-50 text-red-600' }, emola: { name: 'e-Mola', op: 'Movitel', pre: ['86', '87'], c: 'bg-orange-50 text-orange-600' } };
const methodForPhone = phone => operatorForPhone(phone);
const localAccountPhone = phone => { const d = digits(phone); return d.startsWith('258') ? d.slice(3) : d; };
const redraw = () => { view.innerHTML = vPay(); icons(); };

function vPay() {
  const u = me();
  const locked = currentScreen() === 'SUBSCRIPTION_PAYWALL';
  if (!ui.pay) ui.pay = { method: methodForPhone(u.phone) || 'mpesa', phone: localAccountPhone(u.phone), status: 'idle', token: null, error: '' };
  const p = ui.pay;
  p.phone = localAccountPhone(p.phone || u.phone);
  const methodKey = METHODS[p.method] ? p.method : (methodForPhone(p.phone) || methodForPhone(u.phone) || 'mpesa');
  p.method = methodKey;
  const m = METHODS[methodKey];
  if (p.status === 'processing') {
    return `<div class="p-6 text-center">
      <div class="spinner mx-auto mt-16"></div>
      <h1 class="mt-6 text-lg font-extrabold">A aguardar confirmação no telemóvel...</h1>
      <p class="mt-2 text-sm text-slate-600">Enviamos um pedido de <b>${mt(PRICE)}</b> via ${m.name} para <b>${fmtPhone(p.phone)}</b>. Confirme o PIN no seu telemóvel.</p>
      <p class="mt-5 text-xs text-slate-500">Aguarde a abertura do checkout PaySuite. Não feche esta página.</p>
      <button data-act="pay-cancel" class="mt-4 text-sm font-bold text-slate-500 underline">Cancelar</button>
    </div>`;
  }
  if (p.status === 'failed') {
    return `<div class="p-6 text-center">
      <div class="w-20 h-20 mx-auto mt-10 rounded-full bg-red-100 text-red-600 grid place-items-center">${ic('circle-x', 'w-11 h-11')}</div>
      <h1 class="mt-4 text-xl font-extrabold">Pagamento não concluído</h1>
      <p class="mt-2 text-sm text-slate-600">${esc(p.error)}</p>
      <div class="mt-6">${primaryBtn('Tentar novamente', 'pay-retry')}</div>
    </div>`;
  }
  const paid = Array.isArray(u.payments) && u.payments.length > 0;
  const active = accessStatus(u) === 'SUBSCRIBED_ACTIVE';
  const freeDays = daysLeft(u.trialEndsAt);
  const lead = locked
    ? (paid ? 'A sua subscrição terminou. Pague 99 MT para continuar a usufruir do CasaDireta.' : 'Os seus 15 dias grátis terminaram. Por favor, pague a subscrição de 99 MT para continuar a usufruir do CasaDireta.')
    : active ? 'A sua subscrição está ativa. Pode renovar antecipadamente por mais 30 dias.' : `Ainda tem ${freeDays} ${freeDays === 1 ? 'dia' : 'dias'} grátis de uso completo.`;
  const perks = ['Feed de casas, detalhes e contacto direto com proprietários', 'Publicar anúncios com fotos do exterior e do interior', 'Sem taxas de visita nem intermediários'];
  return `${top('Subscrição de 99 MT')}
  <div class="p-5 ${locked ? 'pt-3' : ''}">
    <div class="rounded-3xl bg-gradient-to-br from-brand to-ink text-white p-5">
      <p class="text-[11px] font-bold tracking-wider text-amber-400 uppercase">${locked ? (paid ? 'Subscrição terminada' : 'Fim do período grátis') : 'Subscrição CasaDireta'}</p>
      <h1 class="mt-1 text-[18px] leading-snug font-extrabold">${lead}</h1>
      ${!locked && !active ? `<p class="mt-2 text-sm text-emerald-100">Se quiser, pode pagar agora antecipadamente e receber mais 30 dias de subscrição, mantendo os dias grátis restantes.</p>` : ''}
      <div class="mt-4 flex items-end gap-2"><span class="text-4xl font-extrabold">${PRICE} MT</span><span class="text-sm text-emerald-100 pb-1.5">pagamento único · 30 dias</span></div>
      <ul class="mt-4 space-y-2 text-sm">${perks.map(x => `<li class="flex gap-2 items-start">${ic('circle-check', 'w-5 h-5 text-amber-400 shrink-0')}<span>${x}</span></li>`).join('')}</ul>
    </div>
    <h2 class="mt-6 font-extrabold">Carteira móvel</h2>
    <div class="mt-2 rounded-xl border-2 border-brand bg-emerald-50 p-3.5 flex items-center gap-3" aria-live="polite">
      <span class="w-10 h-10 rounded-full grid place-items-center ${m.c}">${ic('smartphone')}</span><div><b id="payOperatorName" class="block">${m.name}</b><span id="payOperatorHint" class="text-xs text-slate-600">${m.op} · detetada automaticamente pelo prefixo ${m.pre.join(' / ')}</span></div></div>
    <div class="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm"><span class="font-bold">Número para pagamento:</span> ${fmtPhone(p.phone)}<br><span class="text-xs text-slate-600">A operadora é detetada automaticamente pelo prefixo do seu número.</span></div>
    <div class="mt-3">${primaryBtn(`Pagar ${PRICE} MT${locked ? ' e Continuar' : ' Agora'}`, 'pay')}</div>
  </div>`;
}
async function startPay() {
  const p = ui.pay;
  const ph = localAccountPhone(me().phone || p.phone);
  clearErrs();
  if (!validPhone(ph)) return payFailed(p.token, 'O número da conta não é válido para pagamentos móveis. Atualize o seu perfil.');
  const detected = methodForPhone(ph);
  if (!detected) return payFailed(p.token, 'Não foi possível identificar a operadora do número da conta.');
  p.method = detected;
  if (p.status === 'processing') return;
  p.phone = ph; p.status = 'processing'; p.token = uid(); p.error = '';
  const tk = p.token; redraw();
  const r = await api.createSubscription({ phone: ph, role: me().mode, idempotencyKey: tk });
  if (!ui.pay || ui.pay.token !== tk) return;
  if (!r.ok) return payFailed(tk, r.error.message);
  if (r.data.checkout_url) { window.location.assign(r.data.checkout_url); return; }
  return payFailed(tk, 'O PaySuite não devolveu o checkout. Nenhum pagamento foi confirmado. Tente novamente.');
}
function payFailed(tk, msg) { if (!ui.pay || ui.pay.token !== tk) return; ui.pay.status = 'failed'; ui.pay.error = msg; redraw(); }
async function pollPayment(tk) {
  const started = Date.now();
  while (Date.now() - started < 60000) {
    await new Promise(r => setTimeout(r, 1200));
    const p = ui.pay; if (!p || p.token !== tk || p.status !== 'processing') return;
    const r = await api.getPaymentStatus(p.paymentId);
    if (!r.ok) { if (r.error.code === 'network' || r.error.code === 'timeout') continue; return payFailed(tk, r.error.message); }
    if (['paid', 'settled', 'completed', 'active', 'SUBSCRIBED_ACTIVE'].includes(String(r.data.status))) return finishPay(tk, r.data);
    if (['failed', 'cancelled', 'canceled'].includes(String(r.data.status))) return payFailed(tk, r.data.message || 'Pagamento não confirmado. Tente novamente.');
  }
  payFailed(tk, 'Não recebemos a confirmação a tempo. Se o valor foi debitado, aguarde alguns minutos e tente de novo.');
}
async function finishPay(tk, d) {
  if (!ui.pay || ui.pay.token !== tk) return;
  await refreshSubscription();
  await refreshProperties();
  const p = ui.pay, method = d.method || p.method || 'mpesa';
  ui.receipt = { amount: d.amount || (d.amount_minor ? d.amount_minor / 100 : PRICE), method: METHODS[method]?.name || method, phone: d.phone || p.phone, ref: d.reference || d.provider_reference || d.paymentId || p.paymentId, date: d.paidAt || d.paid_at || Date.now(), until: d.validUntil || d.period_ends_at || d.subscribedUntil || Date.now() + 30 * DAY };
  ui.pay = null;
  nav('receipt');
}
function vReceipt() {
  const r = ui.receipt;
  if (!r) { redirect(homeOf(me())); return ''; }
  const row = (a, b) => `<div class="flex justify-between gap-4 py-2.5 border-b border-dashed border-slate-200 text-sm"><span class="text-slate-500">${a}</span><b class="text-right">${b}</b></div>`;
  return `<div class="p-6">
    <div class="text-center pt-4"><div class="w-20 h-20 mx-auto rounded-full bg-emerald-100 text-brand grid place-items-center">${ic('circle-check', 'w-11 h-11')}</div>
    <h1 class="mt-4 text-2xl font-extrabold">Pagamento confirmado</h1>
    <p class="text-sm text-slate-600 mt-1">Subscrição ativa. Acesso completo por mais 30 dias.</p></div>
    <div class="mt-6 bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
      <p class="text-[11px] font-bold tracking-wider uppercase text-slate-400 mb-1">Comprovativo digital</p>
      ${row('Serviço', 'Subscrição CasaDireta (30 dias)')}${row('Valor', mt(r.amount))}${row('Carteira', r.method)}${row('Número', fmtPhone(r.phone))}
      ${row('Referência', r.ref)}${row('Data', `${fmtDate(r.date)}, ${fmtTime(r.date)}`)}${row('Estado', 'Ativo')}${row('Válido até', fmtDate(r.until))}
    </div>
    <div class="mt-6">${primaryBtn('Entrar no CasaDireta', 'receipt-next')}</div></div>`;
}

/* ───────────── APP_MAIN · Inquilino: feed com filtros em tempo real ───────────── */

function vHome() {
  const u = me();
  ui.mount = () => refreshHome(true);
  return `<div class="bg-brand text-white px-4 pt-5 pb-4 rounded-b-3xl">
      <div class="flex items-center justify-between"><div><p class="text-xs text-emerald-100">Olá, ${esc(first(u.name))}</p><h1 class="text-lg font-extrabold leading-tight">Casas direto com o dono</h1></div>${accessBadge(u)}</div>
      <div class="mt-3 flex gap-2">
        <div class="relative flex-1"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">${ic('search', 'w-5 h-5')}</span><input id="q" type="search" data-bind="f.q" data-after="refresh" value="${esc(ui.f.q)}" placeholder="Bairro ou ponto de referência" aria-label="Pesquisar" class="w-full h-12 pl-10 pr-3 rounded-xl text-ink placeholder-slate-400 text-sm outline-none"></div>
        <button data-act="open-filter" class="relative w-12 h-12 rounded-xl bg-white text-brand grid place-items-center" aria-label="Comodidades">${ic('sliders-horizontal')}<span id="fbadge"></span></button>
      </div></div>
    <div class="px-4 pt-3 space-y-2.5">
      <div class="flex gap-2 items-center"><label for="zoneSel" class="text-xs font-bold text-slate-500 shrink-0">Zona / Bairro</label>
        <select id="zoneSel" data-bind="f.zone" data-after="refresh" class="field !h-10 !text-sm flex-1"><option value="all">Todos</option>${ZONES.map(z => `<option ${ui.f.zone === z ? 'selected' : ''}>${z}</option>`).join('')}</select></div>
      <div id="typeChips" class="flex gap-2 overflow-x-auto no-scrollbar" aria-label="Tipo de casa"></div>
      <div id="priceChips" class="flex gap-2 overflow-x-auto no-scrollbar" aria-label="Preço"></div>
    </div>
    <div id="feed" class="px-4 pb-6 pt-3 space-y-4"></div>`;
}
function refreshHome(initial) {
  if (parse().r !== 'home') return;
  $('#typeChips').innerHTML = [['all', 'Todos'], ...Object.entries(TYPES)].map(([k, l]) => `<button data-act="f-type" data-v="${k}" class="chip" aria-pressed="${ui.f.type === k}">${l}</button>`).join('');
  $('#priceChips').innerHTML = `<button data-act="f-sort" class="chip" aria-pressed="${ui.f.sort === 'price'}">${ic('arrow-up-narrow-wide', 'w-4 h-4')}Menor Preço</button>` +
    [['all', 'Todos'], ...Object.entries(PRICES).map(([k, v]) => [k, v.l])].map(([k, l]) => `<button data-act="f-price" data-v="${k}" class="chip" aria-pressed="${ui.f.price === k}">${l}</button>`).join('');
  const n = ui.f.am.length;
  $('#fbadge').innerHTML = n ? `<span class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 text-ink text-[11px] font-extrabold grid place-items-center">${n}</span>` : '';
  const q = $('#q'); if (q && q.value !== ui.f.q) q.value = ui.f.q;
  if (initial) {
    $('#feed').innerHTML = [1, 2, 3].map(() => `<div class="bg-white rounded-2xl overflow-hidden border border-slate-100"><div class="skeleton aspect-[16/10]"></div><div class="p-3.5 space-y-2"><div class="skeleton h-4 w-2/3 rounded"></div><div class="skeleton h-3 w-1/2 rounded"></div><div class="skeleton h-6 w-1/3 rounded"></div></div></div>`).join('');
    refreshFeed();
  } else refreshFeed();
  icons();
}

let feedTk = 0;
async function refreshFeed() {
  const feed = $('#feed'); if (!feed) return;
  const tk = ++feedTk;
  const r = await api.listProperties(ui.f);
  if (tk !== feedTk || !$('#feed')) return;
  const u = me();
  if (!r.ok) {
    if (r.error.code === 'access_blocked') { await refreshUser(); return render(); }
    feed.innerHTML = empty('wifi-off', 'Não foi possível carregar os anúncios', 'Verifique a sua ligação à internet e tente novamente.', `<button data-act="retry-feed" class="mt-5 px-5 py-2.5 rounded-xl bg-brand text-white font-bold text-sm">Tentar novamente</button>`);
    icons(); return;
  }
  const list = r.data;
  feed.innerHTML = list.length
    ? `<p class="text-sm text-slate-500 font-semibold">${list.length} ${list.length === 1 ? 'imóvel encontrado' : 'imóveis encontrados'}${ui.f.sort === 'price' ? ' · do menor preço' : ''}</p>${list.map(l => card(l, u)).join('')}`
    : empty('search', 'Nenhuma casa encontrada', 'Experimente outra zona ou retire alguns filtros.', `<button data-act="clear-filters" class="mt-5 px-5 py-2.5 rounded-xl bg-brand text-white font-bold text-sm">Limpar filtros</button>`);
  icons();
}

function card(l, u) {
  return `<article data-act="open" data-id="${l.id}" tabindex="0" role="link" aria-label="${esc(l.title)}, ${mt(l.price)} por mês" class="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100 active:scale-[.99] transition cursor-pointer">
    <div class="relative aspect-[16/10] bg-slate-200"><img src="${coverOf(l)}" alt="" loading="lazy" decoding="async" class="w-full h-full object-cover">
      <span class="absolute top-2.5 left-2.5 bg-ink/85 text-white text-[11px] font-bold px-2.5 py-1 rounded-full">${TYPES[l.type]}</span>
      <span class="absolute top-2.5 right-2.5">${heart(l.id, isFav(u, l.id))}</span>
      <span class="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1 bg-ink/80 text-white text-[11px] font-bold px-2 py-1 rounded-full">${ic('camera', 'w-3.5 h-3.5')}${photoCount(l)}</span>
      ${badgeVerified('absolute bottom-2.5 left-2.5', 'Verificado')}</div>
    <div class="p-3.5"><h3 class="font-bold leading-snug">${esc(l.title)}</h3>
      <p class="text-[13px] text-slate-500 mt-0.5 flex items-center gap-1">${ic('map-pin', 'w-3.5 h-3.5 shrink-0')}<span class="truncate">${esc(l.bairro)} · ${roomsTxt(l.rooms)}</span></p>
      <p class="text-[11px] text-slate-400 mt-1">Publicado em ${fmtDate(l.created)}, ${fmtTime(l.created)}</p>
      <p class="mt-2 text-[24px] leading-none font-extrabold text-brand">${num(l.price)} MT<span class="text-xs font-semibold text-slate-500">/mês</span></p>
      <div class="mt-3 grid grid-cols-2 gap-2"><button data-act="open" data-id="${l.id}" class="py-2.5 rounded-xl bg-slate-100 font-bold text-sm">Ver detalhes</button><button data-act="contact" data-id="${l.id}" class="py-2.5 rounded-xl bg-brand-light text-white font-bold text-sm flex items-center justify-center gap-1.5">${ic('message-circle', 'w-4 h-4')}Contactar</button></div></div></article>`;
}
function openFilter() {
  ui.ft = { am: [...ui.f.am] };
  drawFilter();
}
function drawFilter() {
  const t = ui.ft;
  openSheet('Comodidades', `
    <div class="flex flex-wrap gap-2">${['agua', 'credelec', 'quintal', 'paragem'].map(k => `<button data-act="ft-am" data-v="${k}" class="chip" aria-pressed="${t.am.includes(k)}">${ic(AM[k][0], 'w-4 h-4')}${AM[k][1]}</button>`).join('')}</div>
    <div class="mt-6 flex gap-3"><button data-act="ft-clear" class="px-5 py-3.5 rounded-xl border-2 border-slate-200 font-bold text-sm">Limpar</button><button data-act="ft-apply" class="flex-1 py-3.5 rounded-xl bg-brand text-white font-bold">Aplicar filtros</button></div>`);
}
function contactSheet(l) {
  const wa = `https://wa.me/258${l.phone}?text=${encodeURIComponent(`Olá ${first(l.owner)}! Vi o anúncio "${l.title}" (${num(l.price)} MT/mês) na CasaDireta. Ainda está disponível?`)}`;
  openSheet('Contactar proprietário', `<div class="flex items-center gap-3 mb-4">${ownerAvatar(l, 'w-12 h-12')}<div><b class="block">${esc(l.owner)}</b>${badgeVerified('mt-1')}</div></div>
    <div class="space-y-3"><a href="${wa}" target="_blank" rel="noopener" data-act="wa" data-id="${l.id}" class="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-brand-light text-white font-extrabold">${ic('message-circle')} Falar no WhatsApp</a>
    <a href="tel:+258${l.phone}" data-act="call" data-id="${l.id}" class="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-ink text-white font-bold">${ic('phone')} Ligar · ${fmtPhone(l.phone)}</a></div>`);
}
function ownerAvatar(l, cls) {
  const ou = l.ownerId && me() && l.ownerId === me().id ? me() : null;
  return ou ? avatar(ou, `${cls} text-base`, 'bg-brand text-white') : `<span class="${cls} rounded-full bg-brand text-white font-extrabold grid place-items-center shrink-0">${initials(l.owner)}</span>`;
}

/* ───────────── Detalhe do imóvel (Exterior / Interior) ───────────── */
function galHtml(l, tab) {
  const ph = photosOf(l)[tab];
  if (!ph.length) return `<div class="aspect-[4/3] bg-slate-200 grid place-items-center text-sm font-semibold text-slate-500">Sem fotos do ${tab === 'int' ? 'interior' : 'exterior'}</div>`;
  return `<div id="gal" class="flex overflow-x-auto snap-x snap-mandatory no-scrollbar aspect-[4/3] bg-slate-200">${ph.map((p, i) => `<img src="${p}" alt="Foto ${i + 1} do ${tab === 'int' ? 'interior' : 'exterior'}" ${i ? 'loading="lazy"' : ''} class="w-full h-full object-cover shrink-0 snap-center">`).join('')}</div>
    <span id="gcount" class="absolute bottom-3 right-3 bg-ink/75 text-white text-xs font-bold px-2.5 py-1 rounded-full">1/${ph.length}</span>
    <div id="dots" class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">${ph.map((_, i) => `<span class="w-1.5 h-1.5 rounded-full ${i ? 'bg-white/50' : 'bg-white'}"></span>`).join('')}</div>`;
}
function mountGal() {
  const g = $('#gal'); if (!g) return;
  const n = g.children.length;
  g.addEventListener('scroll', () => { const i = Math.round(g.scrollLeft / g.clientWidth); $('#gcount').textContent = `${i + 1}/${n}`; $$('#dots span').forEach((d, k) => { d.className = 'w-1.5 h-1.5 rounded-full ' + (k === i ? 'bg-white' : 'bg-white/50'); }); }, { passive: true });
}
function vListing(id) {
  const l = store.properties.find(x => x.id === id), u = me();
  if (!l) return vNotFound();
  const mine = l.ownerId === u.id;
  if (!mine && !ui.seen[id]) { ui.seen[id] = 1; l.views++; api.trackProperty(id, 'view'); }
  ui.mount = mountGal;
  const ph = photosOf(l);
  const wa = `https://wa.me/258${l.phone}?text=${encodeURIComponent(`Olá ${first(l.owner)}! Vi o anúncio "${l.title}" (${num(l.price)} MT/mês) na CasaDireta. Ainda está disponível?`)}`;
  const contacts = `<div class="grid grid-cols-2 gap-2.5 mt-3">
      <a href="tel:+258${l.phone}" data-act="call" data-id="${l.id}" class="flex items-center justify-center gap-1.5 py-3 rounded-xl bg-ink text-white font-bold text-sm">${ic('phone', 'w-4 h-4')} Ligar Direto</a>
      <a href="${wa}" target="_blank" rel="noopener" data-act="wa" data-id="${l.id}" class="flex items-center justify-center gap-1.5 py-3 rounded-xl bg-brand-light text-white font-bold text-sm">${ic('message-circle', 'w-4 h-4')} WhatsApp</a></div>
      <p class="text-center text-xs text-slate-500 mt-2">${fmtPhone(l.phone)}</p>`;
  const actions = mine ? `
    <div class="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-sm"><b class="text-brand">Este é o seu anúncio.</b><br>${l.views} visualizações · ${l.wa} contactos.<button data-act="toggle-rent" data-id="${l.id}" class="mt-3 w-full py-3 rounded-xl bg-white border-2 border-brand text-brand font-bold">${l.rented ? 'Marcar como Disponível' : 'Marcar como Já Alugado'}</button></div>`
    : l.rented ? `<div class="rounded-2xl bg-slate-100 p-4 text-sm font-semibold text-slate-600 flex gap-2">${ic('info', 'w-5 h-5 shrink-0')} Este imóvel já foi alugado.</div>` : `
    <button data-act="roomies" data-id="${l.id}" class="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl border-2 border-brand text-brand font-bold active:scale-[.98]">${ic('users', 'w-5 h-5')} Procurar Colega para Dividir Renda</button>
    <button data-act="report" data-id="${l.id}" class="mx-auto flex items-center gap-1.5 text-xs text-slate-500 font-semibold py-2">${ic('flag', 'w-3.5 h-3.5')} Reportar (Já foi alugado / Taxa de visita)</button>`;
  const row = (a, b) => `<div class="flex justify-between gap-3 py-2.5 border-b border-slate-100 last:border-0 text-sm"><span class="text-slate-500">${a}</span><b class="text-right">${b}</b></div>`;
  return `<div class="relative"><div id="galWrap" class="relative">${galHtml(l, 'ext')}</div>
      <div class="absolute top-3 left-3 right-3 flex justify-between z-10"><button data-act="back" class="w-10 h-10 rounded-full bg-white/95 shadow grid place-items-center" aria-label="Voltar">${ic('arrow-left')}</button>${heart(l.id, isFav(u, l.id), 'w-10 h-10')}</div></div>
    <div class="flex gap-2 px-4 pt-3" role="tablist" aria-label="Fotos"><button role="tab" data-act="gtab" data-id="${l.id}" data-tab="ext" class="chip" aria-pressed="true">${ic('home', 'w-4 h-4')}Fotos do Exterior (${ph.ext.length})</button><button role="tab" data-act="gtab" data-id="${l.id}" data-tab="int" class="chip" aria-pressed="false">${ic('door-open', 'w-4 h-4')}Fotos do Interior (${ph.int.length})</button></div>
    <div class="p-4 space-y-5">
      <div><h1 class="text-xl font-extrabold leading-snug">${esc(l.title)}</h1>
        <p class="text-3xl font-extrabold text-brand mt-2">${num(l.price)} MT<span class="text-sm font-semibold text-slate-500">/mês</span></p></div>
      <section class="rounded-2xl bg-white border border-slate-200 px-4 py-1"><h2 class="font-extrabold pt-3 pb-1">Resumo</h2>
        ${row('Tipo', TYPES[l.type] || l.type || 'Imóvel')}${row('Quartos', roomsTxt(l.rooms))}${row('Zona', esc(l.bairro))}${row('Referência', esc(l.ref))}${row('Preço', `${num(l.price)} MT/mês`)}${row('Condições', esc(l.adv || 'A combinar'))}${row('Publicado em', `${fmtDate(l.created)}, ${fmtTime(l.created)}`)}</section>
      <section><h2 class="font-extrabold mb-1.5">Detalhes da casa</h2><p class="text-sm text-slate-700 leading-relaxed">${esc(l.desc || 'Sem descrição.')}</p>
        <div class="mt-3 flex flex-wrap gap-2">${(l.am || []).filter(k => AM[k]).map(k => `<span class="inline-flex items-center gap-1.5 bg-emerald-50 text-brand text-xs font-bold px-3 py-1.5 rounded-full">${ic(AM[k][0], 'w-4 h-4')}${AM[k][1]}</span>`).join('')}</div></section>
      <section><h2 class="font-extrabold mb-2">Regras da casa</h2><ul class="space-y-1.5 text-sm text-slate-700">${(l.rules || []).map(r => `<li class="flex gap-2">${ic('check', 'w-4 h-4 text-brand mt-0.5 shrink-0')}${esc(r)}</li>`).join('') || '<li class="text-sm text-slate-500">Sem regras adicionais.</li>'}</ul></section>
      ${l.rented || mine ? '' : `<section class="rounded-2xl bg-white border border-slate-200 p-4"><div class="flex items-center gap-3">${ownerAvatar(l, 'w-14 h-14')}<div><b class="block text-[15px]">${esc(l.owner)}</b>${badgeVerified('mt-1', 'Verificado')}</div></div>${contacts}</section>`}
      <div class="space-y-3">${actions}</div>
    </div>`;
}

/* ───────────── Dividir renda ───────────── */
function vRoommates() {
  const u = me(), mineIds = L.interests[u.id] || [];
  const chats = (L.chats || []).filter(c => c.userId === u.id);
  const list = [...store.roommates].sort((a, b) => b.created - a.created);
  return `${top('Dividir renda', false)}
  <div class="p-4 space-y-4">
    <div class="rounded-2xl bg-gradient-to-br from-brand to-ink text-white p-4"><h2 class="font-extrabold text-lg leading-snug">Encontre colega para dividir a renda</h2><p class="text-sm text-emerald-100 mt-1">Casas T1 e T2 ficam muito mais baratas a dois ou a três.</p><div class="mt-3 flex flex-wrap gap-2"><button data-act="post-form" class="px-4 py-2.5 rounded-xl bg-amber-500 text-ink font-bold text-sm flex items-center gap-1.5">${ic('plus', 'w-4 h-4')} Publicar a minha procura</button>${chats.length ? `<button data-act="saved-chats" class="px-4 py-2.5 rounded-xl bg-white/15 text-white font-bold text-sm">${ic('message-circle', 'w-4 h-4')} Conversas (${chats.length})</button>` : ''}</div></div>
    ${list.map(r => roomCard(r, u, mineIds)).join('')}
  </div>`;
}
function roomCard(r, u, mineIds) {
  const own = r.userId === u.id, sent = mineIds.includes(r.id);
  return `<article class="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
    <div class="flex gap-3 items-center"><span class="w-11 h-11 rounded-full bg-emerald-100 text-brand font-extrabold grid place-items-center">${initials(r.name)}</span><div class="min-w-0"><b class="block truncate">${esc(r.name)}, ${r.age} anos</b><span class="text-xs text-slate-500">${esc(r.what)}</span></div></div>
    <p class="mt-3 text-[15px] leading-snug">Procuro colega para dividir <b>${r.type.toUpperCase()}</b> de <b>${mt(r.rent)}</b> no <b>${esc(r.bairro)}</b> <span class="text-brand font-extrabold">(${mt(r.share)} cada)</span></p>
    ${r.msg ? `<p class="mt-1.5 text-sm text-slate-600">“${esc(r.msg)}”</p>` : ''}
    <div class="mt-2.5 flex flex-wrap gap-1.5">${r.habits.map(h => `<span class="text-[11px] font-semibold bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full">${esc(h)}</span>`).join('')}</div>
    ${own ? `<div class="mt-3 flex items-center gap-2"><span class="text-xs font-bold text-brand flex-1">A sua publicação</span><button data-act="room-delete" data-id="${r.id}" class="text-xs font-bold text-red-600 border border-red-200 rounded-lg px-2.5 py-1.5">Apagar publicação</button></div>` : `<button data-act="chat" data-id="${r.id}" class="mt-3 w-full py-3 rounded-xl font-bold text-sm ${sent ? 'bg-emerald-50 text-brand border border-emerald-200' : 'bg-brand text-white'}">${sent ? 'Interesse enviado · Abrir conversa' : 'Tenho Interesse / Conversar'}</button>`}</article>`;
}
function postForm(pre = {}) {
  const u = me();
  openSheet('Publicar a minha procura', `
    <div class="space-y-3">
      <div class="grid grid-cols-2 gap-3"><div><label class="text-xs font-bold" for="pf-type">Tipo de casa</label><select id="pf-type" class="field mt-1"><option value="t2" ${pre.type === 't2' ? 'selected' : ''}>T2</option><option value="t1" ${pre.type === 't1' ? 'selected' : ''}>T1</option><option value="t3" ${pre.type === 't3' ? 'selected' : ''}>T3+</option></select></div>
        <div><label class="text-xs font-bold" for="pf-people">Dividir entre</label><select id="pf-people" class="field mt-1"><option value="2">2 pessoas</option><option value="3">3 pessoas</option></select></div></div>
      <div><label class="text-xs font-bold" for="pf-bairro">Bairro</label><input id="pf-bairro" list="hoods-list" class="field mt-1" value="${esc(pre.bairro || u.zone || '')}" placeholder="Ex.: Zimpeto"></div>
      <div><label class="text-xs font-bold" for="pf-rent">Renda total (MT/mês)</label><input id="pf-rent" inputmode="numeric" data-digits="6" class="field mt-1" value="${pre.rent || ''}" placeholder="7000"></div>
      <div class="grid grid-cols-3 gap-3"><div class="col-span-2"><label class="text-xs font-bold" for="pf-what">Curso ou trabalho</label><input id="pf-what" class="field mt-1" value="${esc(u.job || '')}" placeholder="Ex.: Estudante de Direito"></div><div><label class="text-xs font-bold" for="pf-age">Idade</label><input id="pf-age" inputmode="numeric" data-digits="2" class="field mt-1" value="${u.age || ''}" placeholder="22"></div></div>
      <div><span class="text-xs font-bold">Hábitos</span><div class="mt-1.5 flex flex-wrap gap-2" id="pf-habits">${HABITS.map(h => `<button type="button" data-act="chip" class="chip" aria-pressed="${(u.habits || []).includes(h)}">${h}</button>`).join('')}</div></div>
      <div><label class="text-xs font-bold" for="pf-msg">Mensagem (opcional)</label><textarea id="pf-msg" rows="2" maxlength="140" class="field mt-1" placeholder="Fale um pouco sobre si"></textarea></div>
      <p id="e-pf" class="text-xs text-red-600 font-semibold min-h-[1rem]" role="alert"></p>
      <button data-act="post-save" class="w-full py-3.5 rounded-xl bg-brand text-white font-bold">Publicar</button>
      <datalist id="hoods-list">${HOODS.map(h => `<option value="${h}">`).join('')}</datalist>
    </div>`);
}
async function chatSheet(r) {
  const u = me();
  L.interests[u.id] = [...new Set([...(L.interests[u.id] || []), r.id])]; save();
  const conversationId = [u.id, r.userId || r.id].sort().join(':');
  L.chats = [...(L.chats || []).filter(c => c.conversationId !== conversationId), { conversationId, userId: u.id, otherUserId: r.userId || r.id, roommateId: r.id, name: r.name, bairro: r.bairro, updated: Date.now() }]; save();
  const existing = await api.listChatMessages(conversationId);
  const messages = existing.ok ? existing.data : [];
  openSheet(`Conversa com ${esc(first(r.name))}`, `
    <div id="chat" class="space-y-2 min-h-[120px] max-h-[40vh] overflow-y-auto" aria-live="polite">
      ${messages.length ? messages.map(m => `<div class="${m.fromUserId === u.id ? 'ml-auto bg-brand text-white rounded-br-sm' : 'bg-slate-100 rounded-bl-sm'} max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm">${esc(m.text)}</div>`).join('') : `<div class="max-w-[85%] bg-slate-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm">Olá! Vi que também procura casa. Ainda precisa de colega? (${esc(r.bairro)}, ${mt(r.share)} cada)</div>`}</div>
    <div class="mt-3 flex gap-2"><input id="chatIn" class="field flex-1" placeholder="Escreva uma mensagem" value="Olá ${esc(first(r.name))}, tenho interesse em dividir. Podemos falar?" aria-label="Mensagem"><button data-act="chat-send" data-id="${r.id}" class="w-12 rounded-xl bg-brand text-white grid place-items-center" aria-label="Enviar">${ic('send')}</button></div>
    <p class="mt-2 text-[11px] text-slate-500">As mensagens ficam associadas a esta conversa.</p>`);
  const send = document.querySelector('[data-act="chat-send"]');
  if (send) send.dataset.conversationId = conversationId;
  liveChatTimer = setInterval(async () => {
    const box = $('#chat');
    if (!box || !document.querySelector('[data-act="chat-send"]')) return;
    const fresh = await api.listChatMessages(conversationId);
    if (!fresh.ok) return;
    const html = fresh.data.map(m => `<div class="${m.fromUserId === u.id ? 'ml-auto bg-brand text-white rounded-br-sm' : 'bg-slate-100 rounded-bl-sm'} max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm">${esc(m.text)}</div>`).join('');
    if (box.innerHTML !== html) { const wasBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 32; box.innerHTML = html || '<div class="text-sm text-slate-500">Ainda não há mensagens.</div>'; if (wasBottom) box.scrollTop = box.scrollHeight; }
  }, 2500);
}
function openSavedChats() {
  const chats = [...(L.chats || [])].sort((a, b) => b.updated - a.updated);
  openSheet('Conversas guardadas', chats.length ? `<div class="divide-y divide-slate-100">${chats.map(c => `<button data-act="saved-chat-open" data-roommate-id="${esc(c.roommateId)}" class="w-full text-left py-3 flex items-center gap-3"><span class="w-10 h-10 rounded-full bg-emerald-100 text-brand grid place-items-center">${ic('message-circle')}</span><span class="flex-1"><b class="block text-sm">${esc(c.name || 'Colega')}</b><span class="text-xs text-slate-500">${esc(c.bairro || 'Dividir renda')}</span></span>${ic('chevron-right', 'w-4 h-4 text-slate-400')}</button>`).join('')}</div>` : '<p class="text-sm text-slate-500 py-8 text-center">Ainda não há conversas guardadas.</p>');
}

/* ───────────── Favoritos ───────────── */
function vFavorites() {
  const u = me(), ids = L.favs[u.id] || [], list = ids.map(id => store.properties.find(l => l.id === id)).filter(Boolean);
  return `${top('Favoritos', false)}<div class="p-4 space-y-4">${list.length ? list.map(l => card(l, u)).join('') : empty('heart', 'Ainda não guardou casas', 'Toque no coração de qualquer anúncio para o guardar aqui.', `<button data-act="go" data-to="home" class="mt-5 px-5 py-2.5 rounded-xl bg-brand text-white font-bold text-sm">Ver casas</button>`)}</div>`;
}

/* ───────────── Perfil e definições ───────────── */

const accessBadge = u => {
  const s = accessStatus(u), cls = 'text-[11px] bg-amber-500 text-ink font-bold px-2.5 py-1 rounded-full';
  if (s === 'TRIAL_ACTIVE') { const d = daysLeft(u.trialEndsAt); return `<span class="${cls}">Período grátis: ${d} ${d === 1 ? 'dia restante' : 'dias restantes'}</span>`; }
  if (s === 'SUBSCRIBED_ACTIVE') return `<span class="${cls}">Subscrição ativa · ${daysLeft(u.subscribedUntil)} dias</span>`;
  return '';
};
function vProfile() {
  const u = me(), prop = u.mode === 'proprietario', s = accessStatus(u);
  const payments = Array.isArray(u.payments) ? u.payments : [];
  const last = payments[0];
  const favs = (L.favs[u.id] || []).filter(id => store.properties.some(l => l.id === id)).length;
  const log = L.contacts[u.id] || [];
  const posts = store.roommates.filter(r => r.userId === u.id).length, sent = (L.interests[u.id] || []).length;
  const mine = store.properties.filter(l => l.ownerId === u.id);
  const row = (icon, label, val, act = '', extra = '') => `<button ${act ? `data-act="${act}" ${extra}` : 'disabled'} class="w-full flex items-center gap-3 py-3 border-b border-slate-100 last:border-0 text-left"><span class="w-9 h-9 rounded-full bg-slate-100 text-slate-700 grid place-items-center shrink-0">${ic(icon, 'w-4.5 h-4.5')}</span><span class="flex-1 text-sm font-semibold">${label}</span>${val ? `<span class="text-xs text-slate-500 font-semibold">${val}</span>` : ''}${act ? ic('chevron-right', 'w-4 h-4 text-slate-400') : ''}</button>`;
  const accessLine = s === 'SUBSCRIBED_ACTIVE'
    ? `<b class="text-sm text-brand">Subscrição ativa — ${daysLeft(u.subscribedUntil)} dias restantes</b><p class="text-xs text-slate-500 mt-0.5">Válida até ${fmtDate(u.subscribedUntil)}</p>`
    : `<b class="text-sm text-brand">Período grátis: ${daysLeft(u.trialEndsAt)} dias restantes</b><p class="text-xs text-slate-500 mt-0.5">Termina a ${fmtDate(u.trialEndsAt)}. Depois, 99 MT por 30 dias.</p>`;
  return `<div class="bg-gradient-to-b from-brand to-brand-dark text-white px-5 pt-8 pb-6 rounded-b-3xl text-center">
      <div class="relative inline-block">${avatar(u)}
        <label class="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-amber-500 text-ink grid place-items-center cursor-pointer shadow" aria-label="Alterar foto de perfil">${ic('camera', 'w-4.5 h-4.5')}<input id="avatarIn" type="file" accept="image/*" class="sr-only"></label></div>
      <h1 class="mt-3 text-xl font-extrabold">${esc(u.name)}</h1><p class="text-sm text-emerald-100">${fmtPhone(u.phone)}</p>
      <div class="mt-2 flex justify-center gap-2">${badgeVerified('', 'Conta Verificada')}<span class="inline-block bg-white/15 text-white text-[11px] font-bold px-2.5 py-1 rounded-full">${prop ? 'Proprietário' : 'Inquilino'}</span></div></div>
    <div class="p-4 space-y-4">
      <section class="bg-white rounded-2xl border border-slate-100 px-4 py-1"><h2 class="font-extrabold pt-3 pb-1">Acesso ao CasaDireta</h2>
        <div class="py-3 flex items-center justify-between gap-3"><div>${accessLine}<p class="text-xs text-slate-500 mt-1">${last ? `Último pagamento: ${fmtDate(last.date)}, ${fmtTime(last.date)} · ${last.method}` : 'Ainda sem pagamentos'}</p></div>
          <button data-act="go" data-to="pay" class="px-3.5 py-2 rounded-lg bg-brand text-white text-xs font-bold shrink-0">${s === 'SUBSCRIBED_ACTIVE' ? 'Renovar' : 'Pagar'} ${PRICE} MT</button></div></section>
      ${prop ? `<section class="bg-white rounded-2xl border border-slate-100 px-4 py-1"><h2 class="font-extrabold pt-3 pb-1">As minhas casas</h2>
        ${row('layout-list', 'Casas publicadas', String(mine.length), 'go', 'data-to="owner"')}${row('eye', 'Visualizações', String(mine.reduce((a, l) => a + l.views, 0)))}${row('message-circle', 'Contactos', String(mine.reduce((a, l) => a + l.wa, 0)))}</section>`
      : `<section class="bg-white rounded-2xl border border-slate-100 px-4 py-1"><h2 class="font-extrabold pt-3 pb-1">Atividade</h2>
        ${row('heart', 'Casas guardadas', String(favs), 'go', 'data-to="favorites"')}${row('phone', 'Contactos abertos com proprietários', String(log.length), log.length ? 'contacts-log' : '')}${row('users', 'Pedidos de divisão de renda', `${sent} enviados · ${posts} publicados`, 'go', 'data-to="roommates"')}</section>`}
      <section class="bg-white rounded-2xl border border-slate-100 px-4 py-1"><h2 class="font-extrabold pt-3 pb-1">Os meus dados</h2>
        ${row('map-pin', prop ? 'Zona' : 'Bairro onde procuro', esc(u.zone || 'Por definir'))}
        ${prop ? '' : row('user', 'Perfil para dividir renda', u.age || u.job ? esc(`${u.age ? u.age + ' anos' : ''}${u.age && u.job ? ' · ' : ''}${u.job || ''}`) : 'Opcional')}
        ${row('pencil', 'Editar perfil', '', 'edit-profile')}</section>
      <section class="bg-white rounded-2xl border border-slate-100 px-4 py-1"><h2 class="font-extrabold pt-3 pb-1">Definições e segurança</h2>
        ${row('camera', 'Alterar foto de perfil', '', 'pick-avatar')}${row('bell', 'Ativar notificações', '', 'enable-push')}${row('life-buoy', 'Ajuda e suporte Central', '', 'support')}${row('lock', 'Trocar senha', '', 'chpw')}${row('file-text', 'Termos e Condições / Privacidade', '', 'terms')}${row('repeat', `Alternar para Modo ${prop ? 'Inquilino' : 'Proprietário'}`, '', 'switch-mode')}${row('log-out', 'Sair', '', 'logout')}</section>
      <section class="bg-white rounded-2xl border border-slate-100 p-4"><h2 class="font-extrabold mb-1">Histórico de pagamentos</h2>
        ${payments.length ? payments.map(p => `<div class="flex justify-between items-center py-2.5 border-b border-slate-100 last:border-0 text-sm"><div><b class="block">Subscrição CasaDireta (30 dias)</b><span class="text-xs text-slate-500">${fmtDate(p.date)}, ${fmtTime(p.date)} · ${p.method} · ${p.ref}</span></div><b>${mt(p.amount)}</b></div>`).join('') : '<p class="text-sm text-slate-500 py-2">Ainda sem pagamentos. Está no período grátis.</p>'}</section>
      <button data-act="del-account" class="w-full py-3.5 rounded-xl border-2 border-red-200 text-red-600 font-bold flex items-center justify-center gap-2">${ic('trash-2', 'w-5 h-5')} Eliminar conta</button>
    </div>`;
}
const termsHtml = () => `<div class="space-y-4 text-sm text-slate-700 leading-relaxed">
  <section><h3 class="font-extrabold text-ink">Responsabilidade da plataforma</h3><p>A CasaDireta é uma aplicação da <b>DeliGo Triunfal, Lda.</b>, responsável pela operação e manutenção do serviço. Todos os direitos sobre a aplicação, marca, código, conteúdos e funcionalidades são reservados à DeliGo Triunfal, Lda.</p></section>
  <section><h3 class="font-extrabold text-ink">1. 15 dias grátis e subscrição de 99 MT</h3>
    <p>Quando valida o seu número por SMS pela primeira vez, a conta ganha <b>15 dias grátis</b>, com acesso completo, tanto para <b>inquilinos</b> como para <b>proprietários</b>.</p>
    <p class="mt-1.5">Terminados os 15 dias, o acesso é <b>bloqueado automaticamente</b> até pagar a subscrição de <b>99 MT</b>, que dá <b>30 dias</b> de acesso completo. Não há renovação automática: só paga quando confirmar o pagamento no seu telemóvel.</p>
    <ul class="mt-1.5 list-disc pl-5 space-y-1"><li><b>Inquilino:</b> ver o feed de casas, os detalhes e fotos, contactar o proprietário por WhatsApp ou chamada e usar o espaço de divisão de renda.</li><li><b>Proprietário:</b> publicar anúncios com fotos do exterior e do interior, gerir “Disponível / Já Alugado” e receber contactos diretos.</li></ul>
    <p class="mt-1.5">Existe uma subscrição por conta e vale para os dois modos. Os 99 MT pagam o acesso à plataforma: não são comissão, não garantem o arrendamento e não são reembolsáveis, salvo falha técnica comprovada.</p></section>
  <section><h3 class="font-extrabold text-ink">2. Pagamentos (M-Pesa e e-Mola)</h3><p>Os pagamentos são feitos por M-Pesa (Vodacom) ou e-Mola (Movitel) através do parceiro de pagamentos PaySuite. A CasaDireta nunca vê nem guarda o seu PIN. Guardamos apenas a referência, o valor, a data e o número usado.</p></section>
  <section><h3 class="font-extrabold text-ink">3. Zero taxa de visita e anúncios verdadeiros</h3><p>É proibido cobrar taxa de visita, de reserva ou de “contacto”. É proibido publicar anúncios falsos, fotos de outros imóveis ou casas já alugadas. Os anúncios denunciados são revistos e as contas podem ser suspensas.</p></section>
  <section><h3 class="font-extrabold text-ink">4. Como usamos os seus dados</h3><p>Usamos o nome, o telemóvel, a foto, as preferências e os anúncios apenas para o funcionamento da CasaDireta: verificar a conta, mostrar o seu perfil e anúncios e permitir contacto direto entre inquilinos e proprietários.</p>
    <p class="mt-1.5">O seu número é partilhado com o serviço de SMS (MozSMS) para enviar o código de verificação e com o PaySuite e a operadora para processar o pagamento. Não vendemos os seus dados. Pode alterá-los ou <b>eliminar a conta</b> a qualquer momento no Perfil; os anúncios e dados pessoais são apagados.</p></section>
  <section><h3 class="font-extrabold text-ink">5. Segurança</h3><p>Nunca partilhe o seu PIN. Desconfie de quem pede dinheiro antes de ver a casa e denuncie o anúncio na própria app.</p></section>
  <p class="text-xs text-slate-400">Versão ${TERMS_VERSION} · atualizada a 22 Nov 2026. Texto de demonstração, a rever por um jurista antes do lançamento.</p></div>`;

/* ───────────── Proprietário: Minhas Casas e Publicar ───────────── */
function vOwner() {
  const u = me(), normalizePhone = v => String(v || '').replace(/\D/g, '').replace(/^258/, ''), mine = store.properties.filter(l => l.ownerId === u.id || (normalizePhone(l.phone) && normalizePhone(l.phone) === normalizePhone(u.phone)));
  if (store.propertiesLoading && !store.properties.length) return `${top('Minhas Casas', false, accessBadge(u))}<div class="p-4"><div class="skeleton h-32 rounded-2xl"></div></div>`;
  if (store.propertiesError && !store.properties.length) return `${top('Minhas Casas', false, accessBadge(u))}${empty('wifi-off', 'Não foi possível carregar as suas casas', 'Verifique a sua ligação à internet e tente novamente.', '<button data-act="retry-properties" class="mt-5 px-5 py-2.5 rounded-xl bg-brand text-white font-bold text-sm">Tentar novamente</button>')}`;
  const views = mine.reduce((a, l) => a + l.views, 0), wa = mine.reduce((a, l) => a + l.wa, 0);
  return `${top('Minhas Casas', false, accessBadge(u))}
  <div class="p-4 space-y-4 pb-28">
    <div class="grid grid-cols-3 gap-2.5 text-center">
      <div class="bg-white rounded-2xl border border-slate-100 p-3">${ic('eye', 'w-5 h-5 mx-auto text-brand')}<b class="block text-xl mt-1">${views}</b><span class="text-[11px] text-slate-500">Visualizações</span></div>
      <div class="bg-white rounded-2xl border border-slate-100 p-3">${ic('message-circle', 'w-5 h-5 mx-auto text-brand')}<b class="block text-xl mt-1">${wa}</b><span class="text-[11px] text-slate-500">Contactos</span></div>
      <div class="bg-white rounded-2xl border border-emerald-200 p-3">${ic('badge-check', 'w-5 h-5 mx-auto text-brand')}<b class="block text-sm mt-1.5">${accessStatus(u) === 'SUBSCRIBED_ACTIVE' ? 'Subscrito' : 'Grátis'}</b><span class="text-[11px] text-slate-500">${daysLeft(accessStatus(u) === 'SUBSCRIBED_ACTIVE' ? u.subscribedUntil : u.trialEndsAt)} dias</span></div>
    </div>
    ${mine.length ? mine.map(l => `
      <article class="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 flex gap-3 ${l.rented ? 'opacity-80' : ''}">
        <img src="${coverOf(l)}" alt="" class="w-24 h-24 rounded-xl object-cover shrink-0 ${l.rented ? 'grayscale' : ''}" loading="lazy">
        <div class="flex-1 min-w-0"><button data-act="open" data-id="${l.id}" class="text-left font-bold leading-snug line-clamp-2">${esc(l.title)}</button>
          <p class="text-brand font-extrabold">${num(l.price)} MT/mês</p><p class="text-[11px] text-slate-500">${roomsTxt(l.rooms)} · ${l.views} visitas · ${l.wa} contactos</p><p class="text-[11px] text-slate-400 mt-0.5">Publicado em ${fmtDate(l.created)}, ${fmtTime(l.created)}</p>
          <div class="mt-1.5 flex items-center gap-2"><button role="switch" aria-checked="${!l.rented}" data-act="toggle-rent" data-id="${l.id}" class="switch" aria-label="Disponível"></button><span class="text-xs font-bold px-2 py-0.5 rounded-full ${l.rented ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'}">${l.rented ? 'Já Alugado' : 'Disponível'}</span><button data-act="edit-property" data-id="${l.id}" class="ml-auto text-xs font-bold text-brand border border-brand rounded-lg px-2.5 py-1.5">Editar</button></div></div></article>`).join('')
      : empty('building', 'Ainda sem casas publicadas', 'Publique a sua primeira casa ou quarto e receba contactos diretos.', `<button data-act="add" class="mt-5 px-5 py-3 rounded-xl bg-brand text-white font-bold text-sm">Publicar Casa</button>`)}
  </div>`;
}

const newDraft = u => { const rawPhone = String(u.phone || '').replace(/\D/g, ''), phone = rawPhone.startsWith('258') ? rawPhone.slice(3) : rawPhone; return { type: '', rooms: '', bairro: u.zone || '', ref: '', price: '', adv: ADV[0], am: [], desc: '', ext: [], int: [], phone, agree: false }; };
function vPublish() {
  const u = me();
  if (!ui.w) ui.w = newDraft(u);
  const w = ui.w;
  const pickChip = (group, val, label, on) => `<button type="button" data-act="pick" data-group="${group}" data-val="${val}" class="chip" aria-pressed="${on}">${label}</button>`;
  const photoBlock = (kind, label) => `<div class="min-w-0"><div class="flex items-start gap-3 justify-between"><span class="text-sm font-bold leading-5">${label}</span><span class="shrink-0 text-xs text-slate-500" id="pcount-${kind}">${w[kind].length}/5</span></div>
      <div id="grid-${kind}" class="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2"></div>
      <div class="mt-2"><label for="photo-${kind}" class="w-full min-h-12 inline-flex items-center justify-center gap-2 px-3 py-3 rounded-xl border-2 border-dashed border-brand text-brand text-sm font-bold cursor-pointer hover:bg-emerald-50 active:bg-emerald-100">${ic('image-plus', 'w-5 h-5 shrink-0')}<span>Adicionar fotos</span></label><input id="photo-${kind}" type="file" accept="image/jpeg,image/png,image/webp" multiple data-kind="${kind}" aria-label="Selecionar fotos ${kind === 'int' ? 'do interior' : 'do exterior'}" class="photo-in sr-only">${err('ph-' + kind)}</div>`;
  ui.mount = () => { drawPhotos('ext'); drawPhotos('int'); };
  return `${top(ui.editingId ? 'Editar Casa' : 'Publicar Nova Casa', true)}
    <div class="w-full max-w-2xl mx-auto p-4 sm:p-5 space-y-5 pb-8">
    <div><span class="text-sm font-bold">Tipo de casa</span><div class="mt-2 flex flex-wrap gap-2">${Object.entries(TYPES).map(([k, v]) => pickChip('w.type', k, v, w.type === k)).join('')}</div>${err('type')}</div>
    <div><span class="text-sm font-bold">Quantidade de quartos</span><div class="mt-2 flex gap-2">${['1', '2', '3', '4+'].map(v => pickChip('w.rooms', v, v, w.rooms === v)).join('')}</div>${err('rooms')}</div>
    <div><label class="text-sm font-bold" for="w-bairro">Zona / Bairro</label><input id="w-bairro" list="hoods-list" data-bind="w.bairro" class="field mt-1.5" value="${esc(w.bairro)}" placeholder="Ex.: Zimpeto">${err('w-bairro')}</div>
    <div><label class="text-sm font-bold" for="w-ref">Ponto de referência</label><input id="w-ref" data-bind="w.ref" class="field mt-1.5" value="${esc(w.ref)}" placeholder="Ex.: A 5 min da paragem do Zimpeto">${err('w-ref')}</div>
    <div><label class="text-sm font-bold" for="w-price">Preço mensal (MT)</label><div class="field-wrap mt-1.5" id="w-w-price"><input id="w-price" inputmode="numeric" data-digits="6" data-bind="w.price" value="${esc(w.price)}" placeholder="3500"><span class="px-3 font-bold text-slate-500">MT</span></div>${err('w-price')}</div>
    <div><label class="text-sm font-bold" for="w-adv">Condições (adiantamento)</label><select id="w-adv" data-bind="w.adv" class="field mt-1.5">${ADV.map(a => `<option ${a === w.adv ? 'selected' : ''}>${a}</option>`).join('')}</select>
      <div class="mt-2 flex flex-wrap gap-2">${Object.entries(AM).map(([k, v]) => `<button type="button" data-act="chip" data-group="w.am" data-val="${k}" class="chip" aria-pressed="${w.am.includes(k)}">${ic(v[0], 'w-4 h-4')}${{ agua: 'Água incluída/24h', credelec: 'Credelec próprio', quintal: 'Quintal seguro', paragem: 'Perto da paragem', wc: 'WC interno' }[k]}</button>`).join('')}</div></div>
    <div><label class="text-sm font-bold" for="w-desc">Detalhes / Descrição da casa</label><textarea id="w-desc" data-bind="w.desc" rows="3" maxlength="300" class="field mt-1.5" placeholder="Ex.: Quarto arejado, rua calma, sem barulho depois das 22h.">${esc(w.desc)}</textarea>${err('w-desc')}</div>
    ${photoBlock('ext', 'Fotos do Exterior (fachada, quintal, rua)')}
    ${photoBlock('int', 'Fotos do Interior (quarto, sala, WC)')}
    <div><label class="text-sm font-bold" for="w-phone">Contacto do proprietário (chamada e WhatsApp)</label><div class="mt-1.5">${phoneField('w-phone', w.phone, 'w.phone')}</div>${err('w-phone')}</div>
    <div><label class="flex gap-3 items-start text-sm bg-amber-50 border border-amber-300 rounded-xl p-3 cursor-pointer"><input type="checkbox" id="w-agree" data-bind="w.agree" ${w.agree ? 'checked' : ''} class="mt-1 w-5 h-5 accent-emerald-700"><span>Declaro ser o proprietário/responsável direto e <b>não cobrar taxa de visita</b>.</span></label>${err('agree')}</div>
    ${primaryBtn(ui.editingId ? 'Guardar alterações' : 'Publicar Casa', 'w-publish')}
    <datalist id="hoods-list">${HOODS.map(h => `<option value="${h}">`).join('')}</datalist>
  </div>`;
}
function drawPhotos(kind) {
  const g = $('#grid-' + kind); if (!g) return;
  const list = ui.w[kind];
  g.innerHTML = list.map((p, i) => `<div class="relative aspect-square rounded-xl overflow-hidden bg-slate-200"><img src="${p}" alt="Miniatura ${i + 1}" class="w-full h-full object-cover"><span class="absolute bottom-1 left-1 ${i === 0 ? '' : 'hidden'} bg-brand text-white text-[10px] font-bold px-1.5 py-0.5 rounded">Capa</span><button type="button" data-act="photo-cover" data-kind="${kind}" data-i="${i}" class="absolute bottom-1 right-1 ${i === 0 ? 'hidden' : ''} px-1.5 py-1 rounded bg-white/90 text-brand text-[10px] font-bold">Usar como capa</button><button type="button" data-act="photo-del" data-kind="${kind}" data-i="${i}" class="absolute top-1 right-1 w-7 h-7 rounded-full bg-ink/80 text-white grid place-items-center" aria-label="Remover foto">${ic('trash-2', 'w-3.5 h-3.5')}</button></div>`).join('')
    || `<div class="col-span-3 py-6 text-center text-sm text-slate-500 bg-slate-100 rounded-xl">Ainda sem fotos</div>`;
  $('#pcount-' + kind).textContent = `${list.length}/5`;
  icons();
}
/* Compressão leve: valida tipo/tamanho, redimensiona e guarda JPEG a 72%. */
const readPhoto = (file, max = 900, q = .72, square = false) => new Promise(res => {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) return res(null);
  const fr = new FileReader();
  fr.onerror = () => res(null);
  fr.onload = () => {
    const img = new Image();
    img.onerror = () => res(null);
    img.onload = () => {
      const c = document.createElement('canvas'), ctx = c.getContext('2d');
      if (square) { const s = Math.min(img.width, img.height); c.width = c.height = max; ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, max, max); }
      else { const k = Math.min(1, max / Math.max(img.width, img.height)); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); ctx.drawImage(img, 0, 0, c.width, c.height); }
      res(c.toDataURL('image/jpeg', q));
    };
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
});

async function wizardPublish(btn) {
  if (!once('publish', 1500)) return;
  const w = ui.w; clearErrs(); let ok = true;
  // Em edição, preservar o contacto já associado à conta mesmo quando veio
  // com o prefixo internacional +258 ou quando o anúncio antigo não o tinha.
  const normalizeLocalPhone = value => { const d = digits(value); return d.startsWith('258') ? d.slice(3) : d; };
  w.phone = normalizeLocalPhone(w.phone);
  if (ui.editingId && !validPhone(w.phone)) { const accountPhone = normalizeLocalPhone(me().phone); if (validPhone(accountPhone)) w.phone = accountPhone; }
  const bad = (id, m) => { setErr(id, m); ok = false; };
  if (!w.type) bad('type', 'Escolha o tipo de casa.');
  if (!w.rooms) bad('rooms', 'Escolha a quantidade de quartos.');
  if (w.bairro.trim().length < 3) bad('w-bairro', 'Indique a zona ou bairro.');
  if (w.ref.trim().length < 5) bad('w-ref', 'Indique um ponto de referência.');
  if (!(+w.price >= 500)) bad('w-price', 'Indique um preço válido (mínimo 500 MT).');
  if (w.desc.trim().length < 10) bad('w-desc', 'Escreva uma descrição curta (mínimo 10 letras).');
  if (!w.ext.length) bad('ph-ext', 'Adicione pelo menos 1 foto do exterior.');
  if (!w.int.length) bad('ph-int', 'Adicione pelo menos 1 foto do interior.');
  if (!validPhone(digits(w.phone))) bad('w-phone', 'Número inválido (82–87 + 7 dígitos).');
  if (!w.agree) bad('agree', 'Tem de aceitar o termo de compromisso.');
  if (!ok) { focusFirstErr(); return; }
  const done = withBusy(btn, ui.editingId ? 'A guardar...' : 'A publicar...');
  const data = { type: w.type, rooms: w.rooms === '4+' ? 4 : +w.rooms, bairro: w.bairro.trim(), ref: w.ref.trim(), price: +w.price, adv: w.adv, am: w.am, desc: w.desc.trim(), phone: digits(w.phone), ext: w.ext, int: w.int };
  const r = ui.editingId ? await api.updateProperty(ui.editingId, data) : await api.createProperty(data);
  done();
  if (!r.ok) {
    if (r.error.code === 'access_blocked') { await refreshUser(); return render(); }
    return toast(r.error.message);
  }
  await refreshProperties();
  const wasEditing = Boolean(ui.editingId); ui.published = r.data.id || ui.editingId; ui.w = null; ui.editingId = null;
  nav(wasEditing ? 'owner' : 'published');
}

function vPublished() {
  const l = store.properties.find(x => x.id === ui.published);
  if (!l) { redirect('owner'); return ''; }
  return `<div class="p-6 text-center">
    <div class="w-20 h-20 mx-auto mt-6 rounded-full bg-emerald-100 text-brand grid place-items-center">${ic('circle-check', 'w-11 h-11')}</div>
    <h1 class="mt-4 text-2xl font-extrabold">Casa publicada!</h1>
    <p class="text-sm text-slate-600 mt-1">Já está em Minhas Casas e no feed dos inquilinos.</p>
    <div class="mt-5 text-left">${card(l, me())}</div>
    <div class="mt-6 space-y-3">
      ${primaryBtn('Ir para Minhas Casas', 'go', 'data-to="owner"')}
      <button data-act="see-feed" class="w-full py-3.5 rounded-xl border-2 border-brand text-brand font-bold">Ver no feed de inquilinos</button></div></div>`;
}
function vNotFound() { return `${top('Ups', true)}${empty('search', 'Página não encontrada', 'Esta página já não existe.', `<button data-act="go" data-to="home" class="mt-5 px-5 py-2.5 rounded-xl bg-brand text-white font-bold text-sm">Voltar ao início</button>`)}`; }

/* ───────────── Ações (cliques) ───────────── */

const logContact = (l, how) => {
  const u = me(); if (!u) return;
  if (l.ownerId !== u.id) { l.wa++; api.trackProperty(l.id, 'contact'); }
  const arr = L.contacts[u.id] || (L.contacts[u.id] = []);
  arr.unshift({ id: l.id, title: l.title, owner: l.owner, how, date: Date.now() }); arr.length = Math.min(arr.length, 30);
  save();
};

let searchT;
const A = {
  go: t => nav(t.dataset.to),
  back: () => (history.length > 1 ? history.back() : nav(me() ? homeOf(me()) : 'welcome')),
  close: closeSheet,
  backdrop: (t, e) => { if (e.target === t) closeSheet(); },
  eye: t => { const i = $('#' + t.dataset.target); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; t.innerHTML = ic(show ? 'eye-off' : 'eye'); icons(); },
  terms: () => openSheet('Termos e Condições e Privacidade', termsHtml()),
  'enable-push': async () => {
    const r = await enablePushNotifications();
    toast(r.ok ? 'Notificações ativadas.' : r.reason === 'vapid_key_required' ? 'Falta configurar a chave VAPID no backend.' : 'Este navegador não permite notificações push aqui.');
  },

  'otp-confirm': () => { const code = [0, 1, 2, 3, 4, 5].map(k => $('#otp' + k).value).join(''); if (code.length < 6) { $('#e-otp').textContent = 'Introduza os 6 dígitos.'; return; } verifyOtp(code); },
  resend: async t => {
    if (t.disabled) return;
    const o = store.pendingOtp, r = await api.requestOtp(o.phone, o.purpose, o.context || {});
    if (!r.ok) return toast(r.error.message);
    o.sentAt = Date.now(); toast('Novo código enviado');
  },
  'change-number': () => { const from = store.pendingOtp.from || 'login'; store.pendingOtp = null; nav(from); },
  logout: () => { endSession(); ui.w = null; ui.pay = null; ui.f = newFilters(); nav('welcome'); },

  open: t => nav('listing/' + t.dataset.id),
  contact: t => { const l = store.properties.find(x => x.id === t.dataset.id); if (l) contactSheet(l); },
  gtab: t => {
    const l = store.properties.find(x => x.id === t.dataset.id); if (!l) return;
    $('#galWrap').innerHTML = galHtml(l, t.dataset.tab);
    $$('[data-act="gtab"]').forEach(b => b.setAttribute('aria-pressed', b === t));
    mountGal();
  },
  fav: t => {
    const u = me(), id = t.dataset.id, set = new Set(L.favs[u.id] || []);
    set.has(id) ? set.delete(id) : set.add(id);
    L.favs[u.id] = [...set]; save();
    const on = set.has(id);
    t.setAttribute('aria-pressed', on);
    t.innerHTML = ic('heart', on ? 'w-5 h-5 fill-red-500 text-red-500' : 'w-5 h-5 text-slate-700'); icons();
    toast(on ? 'Guardado nos favoritos' : 'Removido dos favoritos');
    if (parse().r === 'favorites') render();
  },
  refresh: () => { clearTimeout(searchT); searchT = setTimeout(() => refreshHome(), 180); },
  'f-type': t => { ui.f.type = t.dataset.v; refreshHome(); },
  'f-price': t => { ui.f.price = t.dataset.v; refreshHome(); },
  'f-sort': () => { ui.f.sort = ui.f.sort === 'price' ? 'new' : 'price'; refreshHome(); },
  'open-filter': openFilter,
  'ft-am': t => { const k = t.dataset.v, a = ui.ft.am; ui.ft.am = a.includes(k) ? a.filter(x => x !== k) : [...a, k]; drawFilter(); },
  'ft-clear': () => { ui.ft = { am: [] }; drawFilter(); },
  'ft-apply': () => { ui.f.am = ui.ft.am; closeSheet(); refreshHome(); },
  'clear-filters': () => { ui.f = newFilters(); const z = $('#zoneSel'); if (z) z.value = 'all'; refreshHome(); },

  wa: t => { const l = store.properties.find(x => x.id === t.dataset.id); if (l) logContact(l, 'WhatsApp'); },
  call: t => { const l = store.properties.find(x => x.id === t.dataset.id); if (l) logContact(l, 'Chamada'); },
  'contacts-log': () => {
    const log = L.contacts[me().id] || [];
    openSheet('Contactos abertos', `<div class="divide-y divide-slate-100">${log.slice(0, 15).map(c => `<button data-act="open" data-id="${c.id}" class="w-full text-left py-3 flex justify-between gap-3"><span><b class="block text-sm">${esc(c.title)}</b><span class="text-xs text-slate-500">${esc(c.owner)} · ${c.how}</span></span><span class="text-xs text-slate-400 shrink-0">${fmtDate(c.date)}</span></button>`).join('')}</div>`);
  },
  roomies: t => {
    const l = store.properties.find(x => x.id === t.dataset.id), u = me(), mineIds = L.interests[u.id] || [];
    const near = store.roommates.filter(r => norm(l.bairro).includes(norm(r.bairro)) || l.type === r.type).slice(0, 4);
    const list = near.length ? near : store.roommates.slice(0, 3);
    openSheet('Colegas para dividir', `<p class="text-sm text-slate-600 mb-3">Jovens interessados em dividir renda. Se este imóvel é caro para si, divida.</p>
      <div class="space-y-3">${list.map(r => roomCard(r, u, mineIds)).join('')}</div>
      <button data-act="post-form" data-bairro="${esc(l.bairro)}" data-type="${['t1', 't3'].includes(l.type) ? l.type : 't2'}" data-rent="${l.price}" class="mt-4 w-full py-3.5 rounded-xl border-2 border-brand text-brand font-bold">Publicar o meu interesse neste imóvel</button>`);
  },
  report: t => {
    openSheet('Denunciar anúncio', `<form data-submit="report" data-id="${t.dataset.id}" class="space-y-2.5">${Object.entries(REPORTS).map(([k, v], i) => `<label class="flex items-center gap-3 p-3.5 rounded-xl border-2 border-slate-200 has-[:checked]:border-brand has-[:checked]:bg-emerald-50 cursor-pointer"><input type="radio" name="reason" value="${k}" ${i ? '' : 'checked'} class="accent-emerald-700 w-5 h-5"><span class="font-semibold text-sm">${v}</span></label>`).join('')}
      <button class="w-full py-3.5 rounded-xl bg-ink text-white font-bold mt-2">Enviar denúncia</button></form>`);
  },
  'toggle-rent': async t => {
    const l = store.properties.find(x => x.id === t.dataset.id); if (!l) return;
    const r = await api.updateProperty(l.id, { rented: !l.rented });
    if (!r.ok) return toast(r.error.message);
    await refreshProperties();
    toast(r.data.rented ? 'Marcado como Já Alugado' : 'Marcado como Disponível');
    render();
  },

  'post-form': t => postForm(t.dataset.bairro ? { bairro: t.dataset.bairro, type: t.dataset.type, rent: t.dataset.rent } : {}),
  chip: t => {
    const on = t.getAttribute('aria-pressed') === 'true'; t.setAttribute('aria-pressed', !on);
    if (t.dataset.group) { const a = t.dataset.group.split('.').reduce((o, k) => o[k], ui), v = t.dataset.val; setPath(ui, t.dataset.group, on ? a.filter(x => x !== v) : [...a, v]); }
  },
  pick: t => {
    setPath(ui, t.dataset.group, t.dataset.val);
    $$(`[data-act="pick"][data-group="${t.dataset.group}"]`).forEach(b => b.setAttribute('aria-pressed', b === t));
  },
  'post-save': async () => {
    if (!once('post')) return;
    const u = me(), g = id => $('#' + id).value.trim();
    const bairro = g('pf-bairro'), rent = +g('pf-rent'), what = g('pf-what'), age = +g('pf-age');
    const e = $('#e-pf');
    if (bairro.length < 3 || rent < 500 || what.length < 3 || age < 16) { e.textContent = 'Preencha bairro, renda, curso/trabalho e idade (mín. 16).'; return; }
    const people = +g('pf-people');
    const data = { age, what, bairro, type: g('pf-type'), rent, people, habits: $$('#pf-habits .chip[aria-pressed="true"]').map(c => c.textContent), msg: g('pf-msg') };
    const r = await api.createRoommatePost(data);
    if (!r.ok) { e.textContent = r.error.message; return; }
    store.roommates.unshift(r.data); closeSheet(); toast('Procura publicada!');
    if (parse().r === 'roommates') render(); else nav('roommates');
  },
  chat: t => { const r = store.roommates.find(x => x.id === t.dataset.id); if (r) chatSheet(r); },
  'room-delete': async t => { if (!window.confirm('Apagar esta publicação de dividir renda?')) return; const r = await api.deleteRoommatePost(t.dataset.id); if (!r.ok) return toast(r.error.message); store.roommates = store.roommates.filter(x => x.id !== t.dataset.id); toast('Publicação apagada'); render(); },
  'chat-send': async t => {
    const inp = $('#chatIn'), txt = inp.value.trim(), box = $('#chat'); if (!txt) return;
    const r = store.roommates.find(x => x.id === t.dataset.id), u = me();
    const conversationId = t.dataset.conversationId || [u.id, r?.userId || t.dataset.id].sort().join(':');
    const sent = await api.sendChatMessage(conversationId, { toUserId: r?.userId || t.dataset.id, text: txt, context: { roommateId: t.dataset.id } });
    if (!sent.ok) return toast(sent.error.message);
    box.insertAdjacentHTML('beforeend', `<div class="ml-auto max-w-[85%] bg-brand text-white rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm">${esc(txt)}</div>`);
    inp.value = ''; box.scrollTop = box.scrollHeight;
    L.chats = (L.chats || []).map(c => c.conversationId === conversationId ? { ...c, updated: Date.now() } : c); save();
  },
  'saved-chats': () => openSavedChats(),
  'saved-chat-open': t => { const post = store.roommates.find(r => r.id === t.dataset.roommateId); const savedChat = (L.chats || []).find(c => c.roommateId === t.dataset.roommateId); if (!post && !savedChat) return toast('Esta conversa já não está disponível.'); closeSheet(); chatSheet(post || { id: savedChat.roommateId, userId: savedChat.otherUserId, name: savedChat.name || 'Colega', bairro: savedChat.bairro || '', share: 0 }); },
  notifications: () => showNotifications(),
  'notification-reply': t => { const post = store.roommates.find(r => r.id === t.dataset.roommateId); if (!post) return toast('Esta publicação já não está disponível.'); closeSheet(); chatSheet({ ...post, userId: t.dataset.fromUserId, name: 'colega interessado' }); },

  method: t => { ui.pay.phone = digits($('#payPhone')?.value) || ui.pay.phone; ui.pay.method = methodForPhone(ui.pay.phone) || ui.pay.method; redraw(); },
  pay: startPay,
  'pay-retry': () => { ui.pay.status = 'idle'; ui.pay.token = null; redraw(); },
  'retry-feed': () => refreshFeed(),
  'retry-properties': () => refreshProperties(),
  'pay-cancel': () => { ui.pay.status = 'idle'; ui.pay.token = null; redraw(); toast('Pagamento cancelado'); },
  'receipt-next': () => { ui.receipt = null; nav(homeOf(me())); },

  add: () => nav('publish'),
  'edit-property': t => { const l = store.properties.find(x => x.id === t.dataset.id); if (!l) return; const normalizeLocalPhone = value => { const d = digits(value); return d.startsWith('258') ? d.slice(3) : d; }; const listingPhone = normalizeLocalPhone(l.phone); const accountPhone = normalizeLocalPhone(me().phone); ui.editingId = l.id; ui.w = { type: l.type, rooms: l.rooms >= 4 ? '4+' : String(l.rooms), bairro: l.bairro || '', ref: l.ref || '', price: l.price || '', adv: l.adv || ADV[0], am: [...(l.am || [])], desc: l.desc || '', ext: [...(l.ext || [])], int: [...(l.int || [])], phone: validPhone(listingPhone) ? listingPhone : accountPhone, agree: true }; nav('publish'); },
  'w-publish': wizardPublish,
  'photo-del': t => { ui.w[t.dataset.kind].splice(+t.dataset.i, 1); drawPhotos(t.dataset.kind); },
  'photo-cover': t => { const list = ui.w[t.dataset.kind], i = +t.dataset.i; if (i > 0) { const [photo] = list.splice(i, 1); list.unshift(photo); drawPhotos(t.dataset.kind); toast('Foto de capa escolhida'); } },
  'see-feed': async () => { const r = await api.updateUserProfile({ mode: 'inquilino' }); if (r.ok) setUser(r.data); ui.f = newFilters(); nav('home'); },

  'switch-mode': async () => {
    const next = me().mode === 'proprietario' ? 'inquilino' : 'proprietario';
    const r = await api.updateUserProfile({ mode: next });
    if (!r.ok) return toast(r.error.message);
    setUser(r.data); toast(`Modo ${next === 'proprietario' ? 'Proprietário' : 'Inquilino'}`); nav(homeOf(me()));
  },
  'pick-avatar': () => $('#avatarIn') && $('#avatarIn').click(),
  support: async () => {
    const r = await api.listSupportCases();
    const cases = r.ok ? (r.data || []) : [];
    openSheet('Ajuda e suporte', `<div class="space-y-4">
      <p class="text-sm text-slate-600">Fale com a equipa da Central. O pedido fica associado ao seu perfil CasaDireta e pode receber respostas aqui.</p>
      <form data-submit="support" class="space-y-3" novalidate>
        <div><label class="text-xs font-bold" for="support-body">Mensagem</label><textarea id="support-body" class="field mt-1 min-h-28" required placeholder="Explique o que precisa..."></textarea></div>
        <p id="e-support" class="text-xs text-red-600 font-semibold min-h-[1rem]" role="alert"></p>
        <button class="w-full py-3.5 rounded-xl bg-brand text-white font-bold">Enviar pedido</button>
      </form>
      <div><h3 class="font-extrabold mb-2">Os meus pedidos</h3>${cases.length ? `<div class="divide-y divide-slate-100">${cases.map(c => `<button data-act="support-case" data-id="${esc(c.id)}" class="w-full text-left py-3"><b class="block text-sm">${esc(c.subject)}</b><span class="text-xs text-slate-500">${esc(c.status)} · ${fmtDate(c.updated_at || c.created_at)}</span></button>`).join('')}</div>` : '<p class="text-sm text-slate-500">Ainda não enviou nenhum pedido.</p>'}</div>
    </div>`);
  },
  'support-case': async t => {
    const r = await api.listSupportMessages(t.dataset.id); if (!r.ok) return toast(r.error.message);
    const messages = r.data || [];
    const renderMessages = rows => rows.length ? rows.map(m => `<div class="rounded-xl p-3 ${m.author_type === 'staff' ? 'bg-slate-100' : 'bg-emerald-50'}"><p class="text-xs font-bold">${m.author_type === 'staff' ? 'Central DeliGo' : 'Você'}</p><p class="text-sm mt-1 whitespace-pre-wrap">${esc(m.body)}</p><p class="text-[11px] text-slate-400 mt-1">${fmtDate(m.created_at)} ${fmtTime(m.created_at)}</p></div>`).join('') : '<p class="text-sm text-slate-500">Sem mensagens ainda.</p>';
    openSheet('Conversa com a Central', `<div class="space-y-3"><div id="support-chat-messages" class="space-y-2 max-h-72 overflow-y-auto">${renderMessages(messages)}</div><form data-submit="support-reply" data-id="${esc(t.dataset.id)}" class="space-y-2"><textarea id="support-reply-body" class="field min-h-24" placeholder="Escreva uma resposta..."></textarea><button class="w-full py-3 rounded-xl bg-brand text-white font-bold">Enviar resposta</button></form><p class="text-[11px] text-slate-500">A conversa atualiza automaticamente.</p></div>`);
    timers.push(setInterval(async () => { const fresh = await api.listSupportMessages(t.dataset.id); const box = $('#support-chat-messages'); if (fresh.ok && box) box.innerHTML = renderMessages(fresh.data || []); }, 5000));
  },
  'edit-profile': () => {
    const u = me(), prop = u.mode === 'proprietario';
    openSheet('Editar perfil', `<div class="space-y-3">
      <div><label class="text-xs font-bold" for="pe-name">Nome completo</label><input id="pe-name" class="field mt-1" value="${esc(u.name)}"></div>
      <div><label class="text-xs font-bold" for="pe-zone">${prop ? 'Zona' : 'Bairro / Zona onde procuro'}</label><select id="pe-zone" class="field mt-1"><option value="">Escolha o bairro/zona</option>${HOODS.map(h => `<option value="${esc(h)}" ${u.zone === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></div>
      ${prop ? '' : `<p class="text-xs font-bold text-slate-500 pt-1">Perfil para Dividir Renda (opcional)</p>
      <div class="grid grid-cols-3 gap-3"><div class="col-span-2"><label class="text-xs font-bold" for="pe-job">Estudante / Trabalhador</label><input id="pe-job" class="field mt-1" value="${esc(u.job || '')}" placeholder="Ex.: Estudante de Direito"></div><div><label class="text-xs font-bold" for="pe-age">Idade</label><input id="pe-age" inputmode="numeric" data-digits="2" class="field mt-1" value="${u.age || ''}"></div></div>
      <div class="flex flex-wrap gap-2" id="pe-habits">${HABITS.map(h => `<button type="button" data-act="chip" class="chip" aria-pressed="${(u.habits || []).includes(h)}">${h}</button>`).join('')}</div>`}
      <p id="e-pe" class="text-xs text-red-600 font-semibold min-h-[1rem]" role="alert"></p>
      <button data-act="save-profile" class="w-full py-3.5 rounded-xl bg-brand text-white font-bold">Guardar</button>
      <datalist id="hoods-list">${HOODS.map(h => `<option value="${h}">`).join('')}</datalist></div>`);
  },
  'save-profile': async t => {
    const name = $('#pe-name').value.trim();
    if (name.length < 5 || name.split(/\s+/).length < 2) { $('#e-pe').textContent = 'Escreva o nome completo.'; return; }
    const data = { name, zone: $('#pe-zone').value.trim() };
    if ($('#pe-job')) { data.job = $('#pe-job').value.trim(); data.age = +$('#pe-age').value || ''; data.habits = $$('#pe-habits .chip[aria-pressed="true"]').map(c => c.textContent); }
    const done = withBusy(t), r = await api.updateUserProfile(data); done();
    if (!r.ok) { $('#e-pe').textContent = r.error.message; return; }
    setUser(r.data); await refreshUser(); await refreshProperties(); closeSheet(); toast('Perfil atualizado e guardado'); render();
  },
  chpw: () => openSheet('Trocar senha', `<form data-submit="chpw" class="space-y-3" novalidate>
      <div><label class="text-xs font-bold" for="cp0">Senha atual</label><div class="mt-1">${pwField('cp0', 'Senha atual')}</div>${err('cp0')}</div>
      <div><label class="text-xs font-bold" for="cp1">Nova senha</label><div class="mt-1">${pwField('cp1', 'Mínimo 6 caracteres', 'new-password')}</div>${err('cp1')}</div>
      <div><label class="text-xs font-bold" for="cp2">Confirmar nova senha</label><div class="mt-1">${pwField('cp2', 'Repita a nova senha', 'new-password')}</div>${err('cp2')}</div>
      <button class="w-full py-3.5 rounded-xl bg-brand text-white font-bold">Guardar nova senha</button>
      <p class="text-[11px] text-slate-500">Esqueceu a senha atual? Saia da conta e use “Esqueci a senha” no ecrã de entrada (código SMS).</p></form>`),
  'del-account': () => openSheet('Eliminar conta', `<div class="space-y-3">
      <div class="rounded-xl bg-red-50 border border-red-200 p-3.5 text-sm text-red-800 space-y-1.5"><b>Passo 1 de 2 · O que acontece:</b>
        <ul class="list-disc pl-5 space-y-1"><li>O seu perfil, nome, número e foto são apagados.</li><li>Todos os seus anúncios ativos deixam de aparecer.</li><li>A subscrição de 99 MT em curso é perdida, sem reembolso.</li><li>Esta ação não pode ser desfeita.</li></ul></div>
      <button data-act="del-step2" class="w-full py-3.5 rounded-xl bg-red-600 text-white font-bold">Continuar</button>
      <button data-act="close" class="w-full py-3 text-sm font-bold text-slate-500">Cancelar</button></div>`),
  'del-step2': () => openSheet('Confirmar eliminação', `<form data-submit="delete" class="space-y-3" novalidate>
      <p class="text-sm text-slate-700"><b>Passo 2 de 2.</b> Digite a sua senha para confirmar que quer eliminar a conta ${fmtPhone(me().phone)}.</p>
      <div>${pwField('dpw', 'Senha')}${err('dpw')}</div>
      <button class="w-full py-3.5 rounded-xl bg-red-600 text-white font-bold">Eliminar definitivamente</button>
      <button type="button" data-act="close" class="w-full py-3 text-sm font-bold text-slate-500">Cancelar</button></form>`),
};


document.addEventListener('click', e => {
  const t = e.target.closest('#shell [data-act]');
  if (!t) return;
  const fn = A[t.dataset.act];
  if (fn) { if (t.tagName === 'A' && !['wa', 'call'].includes(t.dataset.act)) e.preventDefault(); fn(t, e); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSheet();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('article[data-act="open"]')) { e.preventDefault(); A.open(e.target); }
  if (e.target.classList?.contains('otp-input') && e.key === 'Backspace' && !e.target.value) { const p = $('#otp' + (+e.target.id.slice(3) - 1)); if (p) { p.value = ''; p.focus(); } }
});
document.addEventListener('paste', e => {
  if (!e.target.classList?.contains('otp-input')) return;
  const d = digits(e.clipboardData.getData('text')).slice(0, 6); if (!d) return;
  e.preventDefault(); [...d].forEach((c, i) => { $('#otp' + i).value = c; }); $('#otp' + Math.min(d.length, 5)).focus();
  if (d.length === 6) setTimeout(() => verifyOtp(d), 120);
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.classList.contains('otp-input')) {
    t.value = t.value.replace(/\D/g, '').slice(-1);
    const i = +t.id.slice(3);
    if (t.value && i < 5) $('#otp' + (i + 1)).focus();
    const code = [0, 1, 2, 3, 4, 5].map(k => $('#otp' + k).value).join('');
    if (code.length === 6) setTimeout(() => verifyOtp(code), 120);
    return;
  }
  if (t.dataset && t.dataset.digits !== undefined) {
    const max = +t.dataset.digits || 9; let v = t.value.replace(/\D/g, '');
    if (max === 9) v = v.replace(/^258(?=\d{9})/, '');
    t.value = v.slice(0, max);
    if (t.id === 'payPhone' && ui.pay) {
      const detected = methodForPhone(t.value);
      if (detected) {
        ui.pay.method = detected;
        const m = METHODS[detected];
        if ($('#payOperatorName')) $('#payOperatorName').textContent = m.name;
        if ($('#payOperatorHint')) $('#payOperatorHint').textContent = `${m.op} · detetada automaticamente pelo prefixo ${m.pre.join(' / ')}`;
      }
    }
  }
  if (t.dataset && t.dataset.bind) {
    setPath(ui, t.dataset.bind, t.type === 'checkbox' ? t.checked : t.value);
    if (t.dataset.after && A[t.dataset.after]) A[t.dataset.after](t);
  }
});

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.classList.contains('photo-in')) {
    const k = t.dataset.kind, room = 5 - ui.w[k].length;
    const files = [...t.files].slice(0, room);
    if (t.files.length > room) toast('Máximo 5 fotos por secção');
    for (const f of files) { const d = await readPhoto(f); if (d) ui.w[k].push(d); }
    t.value = ''; drawPhotos(k);
    t.closest('.min-w-0')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else if (t.id === 'avatarIn' && t.files[0]) {
    const d = await readPhoto(t.files[0], 320, .75, true);
    if (!d) return toast('Não foi possível ler a foto.');
    const r = await api.updateUserProfile({ photo: d });
    if (!r.ok) return toast(r.error.message);
    setUser(r.data); toast('Foto de perfil atualizada'); render();
  }
});

/* Botão com estado de carregamento (evita cliques repetidos em ligações lentas) */
function withBusy(btn, label = 'A processar...') {
  if (!btn) return () => {};
  const html = btn.innerHTML; btn.disabled = true;
  btn.innerHTML = `<span class="inline-flex items-center justify-center gap-2"><span class="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin"></span>${label}</span>`;
  return () => { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = html; icons(); } };
}
const fieldErr = (e, map = {}) => { const id = map[e.code]; if (id) { setErr(id, e.message); focusFirstErr(); } else toast(e.message); };

const H = {
  async support(form, v) {
    const body = v('support-body').trim(), u = me();
    if (body.length < 1) return setErr('support', 'Escreva a mensagem.');
    const button = form.querySelector('button'), done = withBusy(button);
    const r = await api.createSupportCase({ requester_user_id: u.id, requester_name: u.name, requester_phone: u.phone, description: body, category: 'general', priority: 'normal' });
    done(); if (!r.ok) return toast(r.error.message); closeSheet(); toast('Pedido enviado à Central.');
  },
  async 'support-reply'(form, v) {
    const body = v('support-reply-body').trim(); if (!body) return toast('Escreva uma mensagem.');
    const r = await api.sendSupportMessage(form.dataset.id, { author_user_id: me().id, author_name: me().name, body });
    if (!r.ok) return toast(r.error.message); closeSheet(); toast('Resposta enviada.');
  },
  async register(form, v) {
    const name = v('name').trim(), phone = digits(v('phone')), pw = v('pw'), pw2 = v('pw2'), role = (document.querySelector('input[name=role]:checked') || {}).value;
    let ok = true;
    if (name.length < 5 || name.split(/\s+/).filter(Boolean).length < 2) { setErr('name', 'Escreva o nome completo (nome e apelido).'); ok = false; }
    if (!role) { setErr('role', 'Escolha o seu perfil.'); ok = false; }
    if (!validPhone(phone)) { setErr('phone', 'Número inválido. Use 82, 83, 84, 85, 86 ou 87 + 7 dígitos.'); ok = false; }
    if (pw.length < 6) { setErr('pw', 'A senha precisa de pelo menos 6 caracteres.'); ok = false; }
    else if (pw !== pw2) { setErr('pw2', 'As senhas não coincidem.'); ok = false; }
    if (!$('#terms').checked) { setErr('terms', 'Tem de aceitar os Termos e Condições.'); ok = false; }
    if (!ok) return focusFirstErr();
    const o = await startOtp('register', phone, null, 'register', { name, password: pw, role });
    if (!o.ok) toast(o.error.message);
  },
  async login(form, v) {
    const phone = digits(v('phone')), pw = v('pw');
    if (!validPhone(phone)) return setErr('phone', 'Número inválido.');
    if (!pw) return setErr('pw', 'Escreva a sua senha.');
    const r = await api.loginUser({ phone, password: pw });
    if (!r.ok) return toast(r.error.code === 'account_deleted' ? 'Esta conta não existe mais. Por favor, crie uma nova conta.' : r.error.message);
    await startSession(r.data.user, r.data.token);
    syncIdentity({ user: r.data.user }).catch(() => {});
    toast('Sessão iniciada');
    nav(homeOf(me()));
  },
  async forgot(form, v) {
    const phone = digits(v('phone'));
    if (!validPhone(phone)) return setErr('phone', 'Número inválido.');
    const o = await startOtp('reset', phone, null, 'forgot');
    if (!o.ok) fieldErr(o.error, { not_found: 'phone' });
  },
  async reset(form, v) {
    const pw = v('pw'), pw2 = v('pw2'), o = store.pendingOtp;
    if (pw.length < 6) return setErr('pw', 'A senha precisa de pelo menos 6 caracteres.');
    if (pw !== pw2) return setErr('pw2', 'As senhas não coincidem.');
    const r = await api.resetPassword({ phone: o.phone, resetToken: o.resetToken, newPassword: pw });
    if (!r.ok) return fieldErr(r.error, { weak_password: 'pw' });
    store.pendingOtp = null; toast('Senha alterada. Entre com a nova senha.'); nav('login');
  },
  async chpw(form, v) {
    const cur = v('cp0'), n1 = v('cp1'), n2 = v('cp2');
    if (!cur) return setErr('cp0', 'Escreva a senha atual.');
    if (n1.length < 6) return setErr('cp1', 'A nova senha precisa de pelo menos 6 caracteres.');
    if (n1 !== n2) return setErr('cp2', 'As senhas não coincidem.');
    const r = await api.changePassword({ currentPassword: cur, newPassword: n1 });
    if (!r.ok) return fieldErr(r.error, { wrong_password: 'cp0', weak_password: 'cp1', same_password: 'cp1' });
    closeSheet(); toast('Senha alterada com sucesso');
  },
  async delete(form, v) {
    const pw = v('dpw'); if (!pw) return setErr('dpw', 'Escreva a sua senha.');
    const id = me().id;
    const r = await api.deleteUserAccount({ password: pw });
    if (!r.ok) return fieldErr(r.error, { wrong_password: 'dpw' });
    forgetLocalUser(id); endSession(); ui.w = null; ui.pay = null; ui.f = newFilters();
    nav('welcome'); toast('Conta eliminada');
  },
  async report(form) {
    const reason = (form.querySelector('input[name=reason]:checked') || {}).value;
    const r = await api.reportProperty({ propertyId: form.dataset.id, reason });
    if (!r.ok) return toast(r.error.message);
    closeSheet(); toast('Obrigado. A denúncia foi enviada à equipa CasaDireta.');
  },
  async support(form) {
    const description = $('#support-body').value.trim();
    if (description.length < 10) { $('#e-support').textContent = 'Escreva pelo menos 10 caracteres.'; return; }
    const r = await api.createSupportCase({ description, category: 'geral' });
    if (!r.ok) { $('#e-support').textContent = r.error.message; return; }
    closeSheet(); toast('Pedido enviado à Central.');
  }
};
document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-submit]'); if (!form) return;
  e.preventDefault();
  const kind = form.dataset.submit;
  if (!once('submit:' + kind, 600)) return;
  clearErrs();
  const done = withBusy(form.querySelector('button:not([type=button])'));
  try { await H[kind](form, id => ($('#' + id) ? $('#' + id).value : '')); } finally { done(); }
});

/* ───────────── Arranque ───────────── */
addEventListener('hashchange', render);
updateNet();
view.innerHTML = `<div class="h-full grid place-items-center"><div class="spinner"></div></div>`;
init().then(() => {
  if (!location.hash) location.replace('#/welcome'); else render();
  setInterval(async () => {
    if (!store.user || currentScreen() !== 'APP_MAIN') return;
    const before = (store.notifications || []).map(n => n.id).join(',');
    await refreshNotifications();
    const after = (store.notifications || []).map(n => n.id).join(',');
    if (before !== after) { render(); if (after && before) toast('Tem notificações novas.'); }
  }, 5000);
  // Sincronização viva para todos os perfis: novas casas e publicações aparecem
  // sem refresh manual; as chamadas continuam a funcionar como fallback quando
  // o canal realtime estiver indisponível ou o browser perder a ligação.
  setInterval(async () => {
    if (!store.user || currentScreen() !== 'APP_MAIN' || !navigator.onLine) return;
    const propertiesBefore = syncStamp(store.properties);
    const roommatesBefore = syncStamp(store.roommates);
    await Promise.allSettled([refreshProperties(), refreshRoommates()]);
    // Não reconstruir o DOM se nada mudou: recriar as tags <img> fazia a
    // capa piscar e voltar a descarregar no Tecno a cada sincronização.
    const changed = propertiesBefore !== syncStamp(store.properties) || roommatesBefore !== syncStamp(store.roommates);
    if (changed && ['home', 'roommates', 'owner'].includes(parse().r)) render();
  }, 10000);
});
window.__casadireta = { store, currentScreen, api };
