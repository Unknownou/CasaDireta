/* apiService.js — ÚNICO ponto de comunicação de dados do frontend.
 *
 * Cada função devolve sempre { ok:true, data } ou { ok:false, error:{ code, message, status } } (nunca lança).
 * Em MOCK_MODE usa js/mockBackend.js (localStorage); com MOCK_MODE=false faz fetch() real.
 *
 * O objeto "user" devolvido pelo servidor traz o controlo de acesso (a validação das datas é SEMPRE do servidor):
 *   { id, name, phone, mode:'inquilino'|'proprietario', trialStartedAt, trialEndsAt, subscribedUntil,
 *     subscriptionStatus:'TRIAL_ACTIVE'|'TRIAL_EXPIRED'|'SUBSCRIBED_ACTIVE', payments:[...] }   (datas em ms epoch UTC)
 *
 * Contrato HTTP esperado (JSON, Authorization: Bearer <token>):
 *   POST   /auth/register               { name, phone, password, role, acceptedTerms, termsVersion } -> { userId, phone }
 *   POST   /auth/login                  { phone, password }                           -> { userId, otpRequired:true }
 *   POST   /otp/request                 { phone, purpose:'register'|'login'|'reset' } -> { sent, resendIn }      (MozSMS)
 *   POST   /otp/verify                  { phone, code, purpose }                      -> { user, token } | { resetToken }
 *                                         (no 1.º OTP validado o servidor define trialStartedAt = agora e trialEndsAt = +15 dias)
 *   POST   /auth/reset-password         { phone, resetToken, newPassword }
 *   GET    /auth/me                                                                   -> user
 *   POST   /functions/v1/paysuite-webhook?action=create-subscription                  -> { paymentId, status } (Central/TUPC)
 *   GET    /functions/v1/paysuite-webhook?action=subscription-status&id=:id             -> { status:'pending'|'processing'|'active'|'failed', ... }
 *   GET    /subscriptions/status?userId=                                              -> { trialStartedAt, trialEndsAt, subscribedUntil, subscriptionStatus, payments }
 *   GET    /properties?q&zone&type&priceMin&priceMax&amenities&sort&includeRented     -> Property[]   (402 access_blocked se o acesso terminou)
 *   POST   /properties                  multipart: campos + photos_exterior[] + photos_interior[]
 *   PATCH  /properties/:id              { rented }
 *   POST   /properties/:id/events       { event:'view'|'contact' }
 *   POST   /reports                     { propertyId, reason }
 *   PATCH  /users/me                    { name, zone, job, age, habits, photo, mode }
 *   POST   /users/me/password           { currentPassword, newPassword }
 *   DELETE /users/me                    { password }
 *   GET    /conversations/:id/messages
 *   POST   /conversations/:id/messages  { toUserId, text, context }
 *   POST   /notifications/push-token    { token, platform, userAgent, appCode }
 *
 * O webhook do PaySuite chega ao BACKEND (nunca ao frontend); o frontend só consulta
 * GET /subscriptions/payments/:id até o estado deixar de ser 'pending'.
 */
import { API_BASE_URL, PAYMENT_API_BASE_URL, TUPC_REST_BASE_URL, SUPABASE_PUBLISHABLE_KEY, MOCK_MODE, TUPC_AUTH_MODE, REAL_PAYMENT_MODE, REQUEST_TIMEOUT_MS, APP_CODE, SUBSCRIPTION_PLAN_ID } from './config.js';
import { mock, setMockToken, devTools } from './mockBackend.js';
import { PRICES } from './utils.js';

let authToken = null;
export function setAuthToken(t) { authToken = t; setMockToken(t); }

async function request(method, path, { body, form, query, headers = {}, baseUrl = API_BASE_URL } = {}) {
  const url = new URL(baseUrl.replace(/\/$/, '') + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, Array.isArray(v) ? v.join(',') : v);
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method, signal: ctrl.signal,
      headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: form || (body ? JSON.stringify(body) : undefined)
    });
    let json = null; try { json = await res.json(); } catch (e) { /* sem corpo */ }
    if (!res.ok) throw Object.assign(new Error((json && json.message) || 'Erro no servidor. Tente novamente.'), { code: (json && json.code) || 'http_' + res.status, status: res.status });
    return json && 'data' in json ? json.data : json;
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('A ligação está lenta. Tente novamente.'), { code: 'timeout' });
    if (e instanceof TypeError) throw Object.assign(new Error('Sem ligação ao servidor. Verifique a internet.'), { code: 'network' });
    throw e;
  } finally { clearTimeout(timer); }
}

async function call(mockFn, realFn, validationBaseUrl = API_BASE_URL, forceReal = false) {
  try {
    if (!navigator.onLine) throw Object.assign(new Error('Sem internet. Verifique os dados móveis.'), { code: 'network' });
    if (!MOCK_MODE) {
      const target = new URL(validationBaseUrl);
      if (target.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(target.hostname)) {
        throw Object.assign(new Error('Configuração de produção inválida: a API Central precisa de HTTPS.'), { code: 'production_config' });
      }
    }
    return { ok: true, data: (MOCK_MODE && !forceReal) ? await mockFn() : await realFn() };
  } catch (e) {
    return { ok: false, error: { code: e.code || 'unknown', message: e.message || 'Ocorreu um erro. Tente novamente.', status: e.status || 0 } };
  }
}
async function tupcRequest(method, path, options = {}) {
  return request(method, path, { ...options, baseUrl: TUPC_REST_BASE_URL, headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Accept-Profile': 'casadireta', 'Content-Profile': 'casadireta', Prefer: 'return=representation', ...(options.headers || {}) } });
}
function mapProperty(row, signed = {}) {
  return { id: row.id, type: row.type, rooms: row.rooms, bairro: row.bairro, ref: row.reference_text, price: row.price_mzn, am: row.amenities || [], owner: row.owner_name || 'Proprietário', phone: row.owner_phone || '', ownerId: row.owner_user_id, title: `${row.type} · ${row.bairro}`, adv: row.advance_terms, desc: row.description, rules: '', ext: (row.exterior_paths || []).map((p) => signed[p] || p), int: (row.interior_paths || []).map((p) => signed[p] || p), rented: row.rented, verified: row.verified, views: row.views, wa: row.contacts, created: Date.parse(row.created_at) };
}
async function signedObject(path) {
  try {
    const res = await fetch(`https://tpmsgvkdjzoidvyiwwfk.supabase.co/storage/v1/object/sign/casadireta-properties/${path}`, { method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
    const data = await res.json();
    return res.ok && data?.signedURL ? `https://tpmsgvkdjzoidvyiwwfk.supabase.co/storage/v1${data.signedURL}` : null;
  } catch { return null; }
}
async function signedMap(rows) {
  const paths = [...new Set(rows.flatMap((r) => [...(r.exterior_paths || []), ...(r.interior_paths || [])]))];
  const pairs = await Promise.all(paths.map(async (p) => [p, await signedObject(p)]));
  return Object.fromEntries(pairs.filter(([, v]) => v));
}

/* Fotos (data URL ou File) -> multipart */
async function toBlob(x) { return typeof x === 'string' ? (await fetch(x)).blob() : x; }
async function propertyFormData(p) {
  const { ext = [], int = [], ...rest } = p, f = new FormData();
  for (const [k, v] of Object.entries(rest)) f.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
  for (const [i, x] of ext.entries()) f.append('photos_exterior', await toBlob(x), `exterior-${i}.jpg`);
  for (const [i, x] of int.entries()) f.append('photos_interior', await toBlob(x), `interior-${i}.jpg`);
  return f;
}
/* Filtros da UI -> parâmetros numéricos/neutros do backend */
function toQuery(f = {}) {
  const pr = f.price && f.price !== 'all' ? PRICES[f.price].r : null;
  return {
    q: f.q || undefined, zone: f.zone && f.zone !== 'all' ? f.zone : undefined, type: f.type && f.type !== 'all' ? f.type : undefined,
    priceMin: pr ? pr[0] : undefined, priceMax: pr && pr[1] < 1e9 ? pr[1] : undefined,
    amenities: f.am && f.am.length ? f.am : undefined, sort: f.sort === 'price' ? 'price' : 'new', includeRented: f.includeRented ? 1 : undefined
  };
}

/* ── Autenticação + OTP (MozSMS) ── */
export const registerUser = p => call(() => mock.registerUser(p), () => request('POST', '/auth/register', { body: p }));
export const loginUser = p => call(
  () => mock.loginUser(p),
  async () => {
    const data = await request('POST', '/paysuite-webhook?action=casadireta-login', { baseUrl: PAYMENT_API_BASE_URL, body: { ...p, app_code: APP_CODE } });
    const sourceUser = data.user || {};
    return { ...data, token: data.token || data.session?.access_token, user: { id: sourceUser.id || data.user_id, name: sourceUser.user_metadata?.full_name || 'Utilizador CasaDireta', phone: p.phone, mode: data.role || sourceUser.user_metadata?.role || 'inquilino' } };
  },
  PAYMENT_API_BASE_URL, TUPC_AUTH_MODE
);
export const requestOtp = (phone, purpose, context = {}) => call(
  () => mock.requestOtp({ phone, purpose }),
  () => request('POST', `/paysuite-webhook?action=casadireta-request-otp`, { baseUrl: PAYMENT_API_BASE_URL, body: { ...context, phone, flow: purpose === 'register' ? 'signup' : purpose, app_code: APP_CODE } }),
  PAYMENT_API_BASE_URL, TUPC_AUTH_MODE
);
export const verifyOtp = (phone, code, purpose = 'login', context = {}) => call(
  () => mock.verifyOtp({ phone, code, purpose }),
  async () => {
    const data = await request('POST', `/paysuite-webhook?action=casadireta-verify-otp`, { baseUrl: PAYMENT_API_BASE_URL, body: { ...context, phone, code, flow: purpose === 'register' ? 'signup' : purpose, app_code: APP_CODE } });
    const sourceUser = data.user || {};
    return {
      ...data,
      token: data.token || data.session?.access_token,
      user: { id: sourceUser.id || data.user_id, name: sourceUser.user_metadata?.full_name || context.name || 'Utilizador CasaDireta', phone, mode: data.role || context.role || 'inquilino' }
    };
  },
  PAYMENT_API_BASE_URL, TUPC_AUTH_MODE
);
export const resetPassword = p => call(() => mock.resetPassword(p), () => request('POST', '/auth/reset-password', { body: p }));
export const getCurrentUser = () => call(
  () => mock.getCurrentUser(),
  async () => {
    const data = await request('GET', '/paysuite-webhook?action=casadireta-me', { baseUrl: PAYMENT_API_BASE_URL });
    return data.user || data;
  },
  PAYMENT_API_BASE_URL,
  TUPC_AUTH_MODE
);

/* ── Subscrição: preço e operadora são resolvidos no backend Central/TUPC ── */
export const createSubscription = ({ phone, role, idempotencyKey }) => call(
  () => mock.createSubscription35MT({ phone, role }),
  () => request('POST', '/paysuite-webhook?action=create-subscription', {
    baseUrl: PAYMENT_API_BASE_URL,
    body: { phone, role, app_code: APP_CODE, plan_id: SUBSCRIPTION_PLAN_ID },
    headers: { 'Idempotency-Key': idempotencyKey || crypto.randomUUID() }
  }), PAYMENT_API_BASE_URL, REAL_PAYMENT_MODE
);
export const createSubscription35MT = createSubscription;
export const getPaymentStatus = id => call(() => mock.getPaymentStatus(id), () => request('GET', `/paysuite-webhook?action=subscription-status&id=${encodeURIComponent(id)}`, { baseUrl: PAYMENT_API_BASE_URL }), PAYMENT_API_BASE_URL, REAL_PAYMENT_MODE);
export const getSubscriptionStatus = userId => call(
  () => mock.getSubscriptionStatus(userId),
  () => request('GET', `/paysuite-webhook?action=subscription-status&user_id=${encodeURIComponent(userId || '')}`, { baseUrl: PAYMENT_API_BASE_URL }),
  PAYMENT_API_BASE_URL,
  TUPC_AUTH_MODE
);

/* ── Imóveis ── */
export const listProperties = (filters = {}) => { const q = toQuery(filters); return call(() => mock.listProperties(q), () => request('GET', `/paysuite-webhook?action=casadireta-properties&${new URLSearchParams({ q: q.q || '', zone: q.zone || '', type: q.type || '', priceMin: q.priceMin || '', priceMax: q.priceMax || '', includeRented: filters.includeRented ? '1' : '0' }).toString()}`, { baseUrl: PAYMENT_API_BASE_URL }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE); };
export const listRoommates = () => call(() => [], () => request('GET', '/paysuite-webhook?action=casadireta-roommates', { baseUrl: PAYMENT_API_BASE_URL }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE);
export const createRoommatePost = data => call(() => data, () => request('POST', '/paysuite-webhook?action=casadireta-roommates', { baseUrl: PAYMENT_API_BASE_URL, body: data }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE);
export const createProperty = data => call(() => mock.createProperty(data), async () => request('POST', '/paysuite-webhook?action=casadireta-properties', { baseUrl: PAYMENT_API_BASE_URL, form: await propertyFormData(data) }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE);
export const updateProperty = (id, patch) => call(() => mock.updateProperty(id, patch), () => request('PATCH', `/paysuite-webhook?action=casadireta-property-update&id=${encodeURIComponent(id)}`, { baseUrl: PAYMENT_API_BASE_URL, body: patch }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE);
export const trackProperty = (id, event) => call(() => mock.trackProperty(id, event), () => request('POST', `/paysuite-webhook?action=casadireta-property-track&id=${encodeURIComponent(id)}`, { baseUrl: PAYMENT_API_BASE_URL, body: { event } }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE);
export const reportProperty = p => call(() => mock.reportProperty(p), () => Promise.resolve({ ok: true }), TUPC_REST_BASE_URL, TUPC_AUTH_MODE);
export const listChatMessages = conversationId => call(() => mock.listChatMessages({ conversationId }), () => request('GET', `/paysuite-webhook?action=casadireta-messages&id=${encodeURIComponent(conversationId)}`, { baseUrl: PAYMENT_API_BASE_URL }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE);
export const sendChatMessage = (conversationId, data) => call(() => mock.sendChatMessage({ conversationId, ...data }), () => request('POST', `/paysuite-webhook?action=casadireta-messages&id=${encodeURIComponent(conversationId)}`, { baseUrl: PAYMENT_API_BASE_URL, body: data }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE);
export const registerPushToken = data => call(() => ({ registered: false, mode: 'mock' }), async () => { const subscription = JSON.parse(data.token); return request('POST', '/paysuite-webhook?action=casadireta-push', { baseUrl: PAYMENT_API_BASE_URL, body: { endpoint: subscription.endpoint, subscription, platform: data.platform || 'web', user_agent: data.userAgent || '' } }); }, PAYMENT_API_BASE_URL, TUPC_AUTH_MODE);
export const listNotifications = (q = {}) => { const query = toQuery({ ...q, appCode: APP_CODE }); return call(() => mock.listNotifications(query), () => request('GET', `/paysuite-webhook?action=casadireta-notifications&unread=${q.unread ? 'true' : 'false'}`, { baseUrl: PAYMENT_API_BASE_URL }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE); };
export const markNotificationsRead = ids => call(() => mock.markNotificationsRead({ ids }), () => request('POST', '/paysuite-webhook?action=casadireta-notifications-read', { baseUrl: PAYMENT_API_BASE_URL, body: { ids } }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE);

/* ── Perfil e conta ── */
export const updateUserProfile = d => call(() => mock.updateUserProfile(d), () => request('PATCH', '/paysuite-webhook?action=casadireta-profile', { baseUrl: PAYMENT_API_BASE_URL, body: d }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE);
export const changePassword = d => call(() => mock.changePassword(d), () => request('POST', '/users/me/password', { body: d }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE);
export const deleteUserAccount = (d = {}) => call(() => mock.deleteUserAccount(d), () => request('DELETE', '/users/me', { body: d }));

/* Suporte partilhado com a Central/TUPC, disponível nos dois modos de perfil. */
export const listSupportCases = () => call(() => [], () => request('GET', '/paysuite-webhook?action=casadireta-support-cases', { baseUrl: PAYMENT_API_BASE_URL }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE);
export const createSupportCase = data => call(() => data, () => request('POST', '/paysuite-webhook?action=casadireta-support-cases', { baseUrl: PAYMENT_API_BASE_URL, body: data }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE);
export const listSupportMessages = id => call(() => [], () => request('GET', `/paysuite-webhook?action=casadireta-support-messages&id=${encodeURIComponent(id)}`, { baseUrl: PAYMENT_API_BASE_URL }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE);
export const sendSupportMessage = (id, data) => call(() => data, () => request('POST', `/paysuite-webhook?action=casadireta-support-messages&id=${encodeURIComponent(id)}`, { baseUrl: PAYMENT_API_BASE_URL, body: data }), PAYMENT_API_BASE_URL, TUPC_AUTH_MODE);

/* Só para demonstração (não existe no backend real): simular fim/reposição dos 15 dias grátis */
export const dev = devTools;
