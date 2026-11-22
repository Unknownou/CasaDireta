/* mockBackend.js — "servidor" simulado em localStorage (só usado com MOCK_MODE = true).
   Replica o que o backend real fará: regras de OTP, 15 dias grátis, pagamentos PaySuite e filtros. */
import { MOCK_LATENCY, MOCK_OTP_CODE, SUBSCRIPTION_PRICE_MT, SUBSCRIPTION_DAYS } from './config.js';
import { TITLE, DEF_ROOMS, ADV, DESCS, RULES, norm, uid, validPhone, DAY, TRIAL_DAYS, accessStatus } from './utils.js';
export function seedListings() {
  const rows = [
    ['quarto', 'Zimpeto', 'A 5 min da paragem do Zimpeto', 2200, ['agua', 'quintal', 'paragem'], 'Armando Macie', '842110233'],
    ['dep', 'Polana Caniço', 'Perto da Escola Secundária da Polana Caniço', 3500, ['agua', 'credelec', 'quintal', 'wc'], 'Celeste Nhantumbo', '853340871'],
    ['dep', 'Maxaquene', 'Junto ao mercado do Maxaquene', 2800, ['agua', 'paragem'], 'Joaquim Sitoe', '867720145'],
    ['t1', 'Hulene', 'Perto do Hospital de Hulene', 6500, ['agua', 'credelec', 'quintal', 'paragem', 'wc'], 'Rosa Chongo', '821003456'],
    ['t2', 'Zimpeto', 'A 10 min do Terminal do Zimpeto', 7000, ['agua', 'credelec', 'quintal', 'paragem', 'wc'], 'Eduardo Mabunda', '846651209'],
    ['quarto', 'Coop', 'Perto da UEM e da paragem da Coop', 3000, ['agua', 'paragem'], 'Teresa Cumbe', '875509982'],
    ['dep', 'Alto Maé', 'Duas ruas depois da paragem do Alto Maé', 4200, ['agua', 'credelec', 'paragem', 'wc'], 'Gaspar Langa', '832214780'],
    ['t1', 'Malhangalene', 'Perto da Av. Eduardo Mondlane', 9500, ['agua', 'credelec', 'quintal', 'paragem', 'wc'], 'Helena Tembe', '859812034'],
    ['quarto', 'Maxaquene', 'A 10 min a pé da UEM', 2500, ['agua', 'quintal'], 'Alberto Muianga', '843387761'],
    ['t2', 'Matola T3', 'Ao lado da paragem do T3, Matola', 8000, ['agua', 'credelec', 'quintal'], 'Fernanda Zandamela', '862275590'],
    ['dep', 'Malhampsene (Matola)', 'Atrás da bomba de combustível, Malhampsene', 2000, ['quintal', 'paragem'], 'Samuel Bila', '878843120'],
    ['t3', 'Matola T3', 'Rua do mercado do T3', 11000, ['agua', 'credelec', 'quintal', 'wc'], 'Ana Paula Mondlane', '847701239'],
    ['quarto', 'Malhangalene', 'Perto do Jardim dos Madgermanes', 4800, ['agua', 'credelec', 'wc'], 'Vasco Nhaca', '833190877'],
    ['t2', 'Alto Maé', 'Junto ao Mercado do Alto Maé', 12500, ['agua', 'credelec', 'quintal', 'paragem', 'wc'], 'Isabel Guambe', '854466012'],
    ['dep', 'Zimpeto', 'A 3 min do Mercado do Zimpeto', 2400, ['agua', 'paragem', 'wc'], 'Domingos Uamusse', '868830451']
  ];
  return rows.map((r, i) => ({
    id: 's' + (i + 1), type: r[0], rooms: DEF_ROOMS[r[0]], bairro: r[1], ref: r[2], price: r[3], am: r[4], owner: r[5], phone: r[6], ownerId: null,
    title: `${TITLE[r[0]]} · ${r[1]}`, adv: ADV[i % ADV.length], desc: DESCS[i % DESCS.length], rules: RULES[i % RULES.length],
    ext: [], int: [], rented: false, verified: true, views: 40 + ((i * 37) % 120), wa: 3 + ((i * 7) % 18), created: Date.now() - (i + 1) * DAY
  }));
}
export function seedRoommates() {
  const R = [
    ['Nélio Cossa', 22, 'Estudante de Engenharia Informática (UEM)', 'Zimpeto', 't2', 7000, 2, ['Não fuma', 'Organizado'], 'Estudo de manhã e faço trabalhos à noite. Procuro alguém tranquilo.'],
    ['Maria Fumo', 24, 'Enfermeira no Hospital Central', 'Polana Caniço', 't1', 6000, 2, ['Não fuma', 'Sossegado', 'Trabalha de dia'], 'Trabalho por turnos. Gosto de casa limpa e silenciosa.'],
    ['Edson Tivane', 21, 'Estudante de Economia', 'Malhangalene', 't2', 9000, 3, ['Estudioso', 'Organizado'], 'Já temos dois, falta um para completar a renda.'],
    ['Cátia Macuácua', 23, 'Estagiária num banco', 'Matola T3', 't2', 8000, 2, ['Não fuma', 'Sem animais'], 'Prefiro colega mulher. Perto da paragem do T3.'],
    ['Hélder Nhampossa', 26, 'Técnico de informática', 'Hulene', 't1', 6500, 2, ['Organizado', 'Trabalha de dia'], 'Trabalho fora todo o dia, a casa fica sossegada.'],
    ['Lúcia Bila', 20, 'Estudante de Direito', 'Coop', 't2', 7500, 3, ['Estudioso', 'Não fuma'], 'Procuro duas colegas para dividir perto da UEM.']
  ];
  return R.map((r, i) => ({
    id: 'r' + (i + 1), name: r[0], age: r[1], what: r[2], bairro: r[3], type: r[4], rent: r[5], people: r[6],
    share: Math.round(r[5] / r[6]), habits: r[7], msg: r[8], userId: null, created: Date.now() - (i + 1) * 3600e3 * 7
  }));
}

/* ───────────── Backend simulado ───────────── */
const DBKEY = 'casadireta:mockdb';
export class ApiError extends Error { constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; } }
const fail = (code, message, status) => { throw new ApiError(code, message, status); };
const wait = (min = MOCK_LATENCY[0], max = MOCK_LATENCY[1]) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

function loadDb() {
  try { const r = JSON.parse(localStorage.getItem(DBKEY)); if (r && r.users && r.listings) return r; } catch (e) { /* ignora */ }
  return { users: [], listings: seedListings(), reports: [], otps: {}, resets: {}, payments: [], tokens: {}, chats: [], notifications: [] };
}
let db = loadDb();
const saveDb = () => { try { localStorage.setItem(DBKEY, JSON.stringify(db)); } catch (e) { fail('storage_full', 'Memória do telemóvel cheia. Remova fotos grandes.', 507); } };
const clone = x => JSON.parse(JSON.stringify(x));
const pub = u => { const { pw, ...r } = clone(u); r.subscriptionStatus = accessStatus(u); return r; };
let token = null;
export const setMockToken = t => { token = t; };
const authUser = () => { const u = db.users.find(x => x.id === db.tokens[token]); if (!u) fail('unauthorized', 'Sessão expirada. Entre novamente.', 401); return u; };
const needAccess = u => {
  if (accessStatus(u) === 'TRIAL_EXPIRED') fail('access_blocked', u.payments.length ? 'A sua subscrição terminou. Pague 99 MT para continuar.' : 'Os seus 15 dias grátis terminaram. Por favor, pague a subscrição de 99 MT para continuar a usufruir do CasaDireta.', 402);
};
const PAY_METHODS = { mpesa: { name: 'M-Pesa', pre: ['84', '85'] }, emola: { name: 'e-Mola', pre: ['86', '87'] } };
const startTrial = u => { if (!u.trialStartedAt) { u.trialStartedAt = Date.now(); u.trialEndsAt = u.trialStartedAt + TRIAL_DAYS * DAY; } };

export const mock = {
  async registerUser({ name = '', phone = '', password = '', role, acceptedTerms, termsVersion }) {
    await wait();
    if (name.trim().length < 5 || name.trim().split(/\s+/).length < 2) fail('invalid_name', 'Escreva o nome completo (nome e apelido).', 422);
    if (!validPhone(phone)) fail('invalid_phone', 'Número inválido. Use 82, 83, 84, 85, 86 ou 87 + 7 dígitos.', 422);
    if (password.length < 6) fail('weak_password', 'A senha precisa de pelo menos 6 caracteres.', 422);
    if (!['inquilino', 'proprietario'].includes(role)) fail('invalid_role', 'Escolha o seu perfil.', 422);
    if (!acceptedTerms) fail('terms_required', 'Tem de aceitar os Termos e Condições.', 422);
    let u = db.users.find(x => x.phone === phone);
    if (u && u.verified) fail('phone_taken', 'Este número já tem conta. Use “Entrar”.', 409);
    if (u) Object.assign(u, { name: name.trim(), pw: password, mode: role });
    else {
      u = { id: uid(), name: name.trim(), phone, pw: password, mode: role, verified: false, trialStartedAt: 0, trialEndsAt: 0, subscribedUntil: 0, payments: [], created: Date.now() };
      db.users.push(u);
    }
    u.termsVersion = termsVersion || 2; u.termsAcceptedAt = Date.now();
    saveDb();
    return { userId: u.id, phone };
  },
  async loginUser({ phone = '', password = '' }) {
    await wait();
    const u = db.users.find(x => x.phone === phone);
    if (!u) fail('not_found', 'Não encontramos uma conta com este número.', 404);
    if (u.pw !== password) fail('invalid_credentials', 'Senha incorreta.', 401);
    return { userId: u.id, otpRequired: true };
  },
  async requestOtp({ phone, purpose }) {
    await wait();
    if (!db.users.find(x => x.phone === phone)) fail('not_found', 'Não encontramos uma conta com este número.', 404);
    db.otps[`${phone}:${purpose}`] = { code: MOCK_OTP_CODE, exp: Date.now() + 5 * 60e3, sentAt: Date.now(), attempts: 0 };
    saveDb();
    return { sent: true, resendIn: 30, expiresIn: 300, provider: 'mock-mozsms' };
  },
  async verifyOtp({ phone, code, purpose }) {
    await wait();
    const key = `${phone}:${purpose}`, o = db.otps[key];
    if (!o) fail('no_code', 'Peça um novo código.', 400);
    if (o.attempts >= 5) fail('too_many_attempts', 'Demasiadas tentativas. Peça um novo código.', 429);
    if (Date.now() > o.exp) fail('code_expired', 'O código expirou. Peça um novo.', 400);
    if (String(code) !== o.code) {
      o.attempts++; saveDb();
      fail('invalid_code', o.attempts >= 5 ? 'Demasiadas tentativas. Peça um novo código.' : `Código incorreto. Restam ${5 - o.attempts} tentativa(s).`, 400);
    }
    delete db.otps[key];
    const u = db.users.find(x => x.phone === phone);
    if (!u) fail('not_found', 'Conta não encontrada.', 404);
    if (purpose === 'reset') { const t = 'rst_' + uid() + uid(); db.resets[phone] = t; saveDb(); return { resetToken: t }; }
    u.verified = true; startTrial(u);      // 1.º OTP validado => começam os 15 dias grátis
    const t = 'tok_' + uid() + uid(); db.tokens[t] = u.id; saveDb();
    return { user: pub(u), token: t };
  },
  async resetPassword({ phone, resetToken, newPassword = '' }) {
    await wait();
    if (!resetToken || db.resets[phone] !== resetToken) fail('invalid_token', 'Pedido de recuperação inválido. Recomece.', 400);
    if (newPassword.length < 6) fail('weak_password', 'A senha precisa de pelo menos 6 caracteres.', 422);
    db.users.find(x => x.phone === phone).pw = newPassword; delete db.resets[phone]; saveDb();
    return { ok: true };
  },
  async getCurrentUser() { await wait(80, 160); return pub(authUser()); },

  /* ── Subscrição 99 MT (PaySuite simulado: pendente ~2,4 s; números terminados em 99 falham) ── */
  async createSubscription35MT({ phone, method, role }) {
    await wait();
    const u = authUser();
    if (!validPhone(phone)) fail('invalid_phone', 'Número inválido. Use 84, 85, 86 ou 87 + 7 dígitos.', 422);
    const detected = Object.entries(PAY_METHODS).find(([, value]) => value.pre.includes(phone.slice(0, 2)));
    if (!detected) fail('invalid_phone', 'Não foi possível identificar a operadora pelo prefixo.', 422);
    method = detected[0];
    const m = detected[1];
    const p = { id: uid(), reference: 'CD' + uid().toUpperCase().slice(0, 8), userId: u.id, phone, method, role: role || u.mode, amount: SUBSCRIPTION_PRICE_MT, status: 'pending', createdAt: Date.now(), willFail: phone.endsWith('99') };
    db.payments.push(p); saveDb();
    return { paymentId: p.id, reference: p.reference, status: 'pending', amount: p.amount, method };
  },
  async getPaymentStatus(id) {
    await wait(120, 260);
    const u = authUser(), p = db.payments.find(x => x.id === id && x.userId === u.id);
    if (!p) fail('not_found', 'Pagamento não encontrado.', 404);
    if (p.status === 'pending' && Date.now() - p.createdAt >= 2400) {
      if (p.willFail) { p.status = 'failed'; p.message = 'Pagamento recusado ou não confirmado no telemóvel. Tente novamente.'; }
      else {
        p.status = 'paid'; p.paidAt = Date.now();
        const base = Math.max(p.paidAt, u.subscribedUntil || 0);          // acesso completo por mais 30 dias
        p.validUntil = base + SUBSCRIPTION_DAYS * DAY; u.subscribedUntil = p.validUntil;
        u.payments.unshift({ id: p.id, amount: p.amount, method: PAY_METHODS[p.method].name, phone: p.phone, ref: p.reference, date: p.paidAt });
      }
      saveDb();
    }
    return clone(p);
  },
  async getSubscriptionStatus() {
    await wait(80, 160);
    const u = authUser();
    return { trialStartedAt: u.trialStartedAt, trialEndsAt: u.trialEndsAt, subscribedUntil: u.subscribedUntil || 0, subscriptionStatus: accessStatus(u), payments: clone(u.payments) };
  },

  /* ── Imóveis ── */
  async listProperties(q = {}) {
    await wait(120, 260);
    const u = authUser(); needAccess(u);
    let list = db.listings.filter(l => {
      if (l.rented && !q.includeRented) return false;
      if (q.zone && !norm(l.bairro).includes(norm(q.zone))) return false;
      if (q.type && l.type !== q.type) return false;
      if (q.priceMin !== undefined && l.price < q.priceMin) return false;
      if (q.priceMax !== undefined && l.price > q.priceMax) return false;
      if (q.amenities && !q.amenities.every(k => l.am.includes(k))) return false;
      if (q.q && !norm(`${l.bairro} ${l.ref} ${l.title}`).includes(norm(q.q.trim()))) return false;
      return true;
    });
    list = list.sort((a, b) => (q.sort === 'price' ? a.price - b.price : b.created - a.created));
    return clone(list);
  },
  async createProperty(d) {
    await wait(300, 600);
    const u = authUser(); needAccess(u);
    if (!d.type || !d.rooms || !(d.price >= 500)) fail('invalid_property', 'Preencha tipo, quartos e preço.', 422);
    if (!d.ext || !d.ext.length || !d.int || !d.int.length) fail('photos_required', 'Adicione fotos do exterior e do interior.', 422);
    if (!validPhone(d.phone)) fail('invalid_phone', 'Contacto inválido.', 422);
    const l = {
      id: 'u' + uid(), type: d.type, rooms: d.rooms, bairro: d.bairro, ref: d.ref, price: +d.price, am: d.am || [], owner: u.name, phone: d.phone, ownerId: u.id,
      title: `${TITLE[d.type]} · ${d.bairro}`, adv: d.adv, desc: d.desc, rules: RULES[0], ext: d.ext, int: d.int, rented: false, verified: true, views: 0, wa: 0, created: Date.now()
    };
    db.listings.unshift(l);
    db.users.filter(x => x.id !== u.id && x.verified && x.mode === 'inquilino').forEach(target => {
      const sameZone = target.zone && norm(target.zone) === norm(l.bairro);
      if (sameZone || !target.zone) db.notifications.push({ id: 'n' + uid(), userId: target.id, type: sameZone ? 'nearby_property' : 'new_property', title: sameZone ? 'Nova casa perto de si' : 'Nova casa publicada', body: `${l.title} em ${l.bairro}`, propertyId: l.id, read: false, created: Date.now() });
    });
    saveDb();
    return clone(l);
  },
  async listNotifications({ unread } = {}) {
    await wait(60, 140);
    const u = authUser();
    return clone(db.notifications.filter(n => n.userId === u.id && (!unread || !n.read)).sort((a, b) => b.created - a.created).slice(0, 50));
  },
  async markNotificationsRead({ ids = [] } = {}) {
    await wait(40, 100);
    const u = authUser();
    const wanted = new Set(Array.isArray(ids) ? ids : []);
    db.notifications.forEach(n => { if (n.userId === u.id && wanted.has(n.id)) n.read = true; });
    saveDb();
    return { updated: wanted.size };
  },
  async updateProperty(id, patch) {
    await wait(120, 260);
    const u = authUser(), l = db.listings.find(x => x.id === id);
    if (!l) fail('not_found', 'Anúncio não encontrado.', 404);
    if (l.ownerId !== u.id) fail('forbidden', 'Só o proprietário pode alterar este anúncio.', 403);
    if (typeof patch.rented === 'boolean') l.rented = patch.rented;
    saveDb(); return clone(l);
  },
  async trackProperty(id, event) {
    const l = db.listings.find(x => x.id === id);
    if (l) { if (event === 'view') l.views++; if (event === 'contact') l.wa++; saveDb(); }
    return { ok: true };
  },
  async reportProperty({ propertyId, reason }) {
    await wait(120, 260);
    const u = authUser();
    db.reports.push({ id: uid(), propertyId, reason, by: u.id, date: Date.now() }); saveDb();
    return { ok: true };
  },

  /* ── Conversas (contrato compatível com o backend real) ── */
  async listChatMessages({ conversationId }) {
    await wait(80, 180);
    const u = authUser();
    return clone(db.chats.filter(x => x.conversationId === conversationId && (x.fromUserId === u.id || x.toUserId === u.id)).sort((a, b) => a.created - b.created));
  },
  async sendChatMessage({ conversationId, toUserId, text, context = {} }) {
    await wait(120, 260);
    const u = authUser();
    if (!toUserId || !text || text.trim().length < 1) fail('invalid_message', 'Escreva uma mensagem.', 422);
    const row = { id: 'm' + uid(), conversationId, fromUserId: u.id, toUserId, text: text.trim().slice(0, 1000), context, created: Date.now(), readAt: 0 };
    db.chats.push(row); saveDb();
    return clone(row);
  },

  /* ── Perfil e conta ── */
  async updateUserProfile(d) {
    await wait(150, 320);
    const u = authUser();
    if (d.mode && !['inquilino', 'proprietario'].includes(d.mode)) fail('invalid_role', 'Perfil inválido.', 422);
    for (const k of ['name', 'zone', 'job', 'age', 'habits', 'photo', 'mode']) if (k in d) u[k] = d[k];
    if ('name' in d) db.listings.filter(l => l.ownerId === u.id).forEach(l => { l.owner = u.name; });
    saveDb(); return pub(u);
  },
  async changePassword({ currentPassword, newPassword = '' }) {
    await wait(200, 400);
    const u = authUser();
    if (currentPassword !== u.pw) fail('wrong_password', 'Senha atual incorreta.', 403);
    if (newPassword.length < 6) fail('weak_password', 'A nova senha precisa de pelo menos 6 caracteres.', 422);
    if (newPassword === currentPassword) fail('same_password', 'A nova senha tem de ser diferente da atual.', 422);
    u.pw = newPassword; saveDb(); return { ok: true };
  },
  async deleteUserAccount({ password }) {
    await wait(250, 500);
    const u = authUser();
    if (password !== u.pw) fail('wrong_password', 'Senha incorreta.', 403);
    db.users = db.users.filter(x => x.id !== u.id);
    db.listings = db.listings.filter(l => l.ownerId !== u.id);
    for (const [t, id] of Object.entries(db.tokens)) if (id === u.id) delete db.tokens[t];
    saveDb(); return { ok: true };
  }
};

/* Ferramentas de teste (só em MOCK_MODE): simular o fim e a reposição dos 15 dias grátis */
export const devTools = {
  reset() { try { localStorage.removeItem(DBKEY); } catch (e) { /* ignora */ } db = loadDb(); },
  expireTrial() { const u = authUser(); u.trialEndsAt = Date.now() - 1000; u.subscribedUntil = 0; saveDb(); },
  resetTrial() { const u = authUser(); u.trialStartedAt = Date.now(); u.trialEndsAt = u.trialStartedAt + TRIAL_DAYS * DAY; u.subscribedUntil = 0; saveDb(); }
};
