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
 *   POST   /subscriptions/35mt          { phone, method:'mpesa'|'emola', role }       -> { paymentId, reference, status:'pending' }  (PaySuite)
 *   GET    /subscriptions/payments/:id                                                -> { status:'pending'|'paid'|'failed', ... }
 *   GET    /subscriptions/status?userId=                                              -> { trialStartedAt, trialEndsAt, subscribedUntil, subscriptionStatus, payments }
 *   GET    /properties?q&zone&type&priceMin&priceMax&amenities&sort&includeRented     -> Property[]   (402 access_blocked se o acesso terminou)
 *   POST   /properties                  multipart: campos + photos_exterior[] + photos_interior[]
 *   PATCH  /properties/:id              { rented }
 *   POST   /properties/:id/events       { event:'view'|'contact' }
 *   POST   /reports                     { propertyId, reason }
 *   PATCH  /users/me                    { name, zone, job, age, habits, photo, mode }
 *   POST   /users/me/password           { currentPassword, newPassword }
 *   DELETE /users/me                    { password }
 *
 * O webhook do PaySuite chega ao BACKEND (nunca ao frontend); o frontend só consulta
 * GET /subscriptions/payments/:id até o estado deixar de ser 'pending'.
 */
import { API_BASE_URL, MOCK_MODE, REQUEST_TIMEOUT_MS } from './config.js';
import { mock, setMockToken, devTools } from './mockBackend.js';
import { PRICES } from './utils.js';

let authToken = null;
export function setAuthToken(t) { authToken = t; setMockToken(t); }

async function request(method, path, { body, form, query } = {}) {
  const url = new URL(API_BASE_URL.replace(/\/$/, '') + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, Array.isArray(v) ? v.join(',') : v);
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method, signal: ctrl.signal,
      headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
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

async function call(mockFn, realFn) {
  try {
    if (!navigator.onLine) throw Object.assign(new Error('Sem internet. Verifique os dados móveis.'), { code: 'network' });
    return { ok: true, data: MOCK_MODE ? await mockFn() : await realFn() };
  } catch (e) {
    return { ok: false, error: { code: e.code || 'unknown', message: e.message || 'Ocorreu um erro. Tente novamente.', status: e.status || 0 } };
  }
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
export const loginUser = p => call(() => mock.loginUser(p), () => request('POST', '/auth/login', { body: p }));
export const requestOtp = (phone, purpose) => call(() => mock.requestOtp({ phone, purpose }), () => request('POST', '/otp/request', { body: { phone, purpose } }));
export const verifyOtp = (phone, code, purpose = 'login') => call(() => mock.verifyOtp({ phone, code, purpose }), () => request('POST', '/otp/verify', { body: { phone, code, purpose } }));
export const resetPassword = p => call(() => mock.resetPassword(p), () => request('POST', '/auth/reset-password', { body: p }));
export const getCurrentUser = () => call(() => mock.getCurrentUser(), () => request('GET', '/auth/me'));

/* ── Subscrição de 35 MT (PaySuite) ── */
export const createSubscription35MT = ({ phone, method, role }) => call(() => mock.createSubscription35MT({ phone, method, role }), () => request('POST', '/subscriptions/35mt', { body: { phone, method, role, amount: 35 } }));
export const getPaymentStatus = id => call(() => mock.getPaymentStatus(id), () => request('GET', `/subscriptions/payments/${id}`));
export const getSubscriptionStatus = userId => call(() => mock.getSubscriptionStatus(userId), () => request('GET', '/subscriptions/status', { query: { userId } }));

/* ── Imóveis ── */
export const listProperties = (filters = {}) => { const q = toQuery(filters); return call(() => mock.listProperties(q), () => request('GET', '/properties', { query: q })); };
export const createProperty = data => call(() => mock.createProperty(data), async () => request('POST', '/properties', { form: await propertyFormData(data) }));
export const updateProperty = (id, patch) => call(() => mock.updateProperty(id, patch), () => request('PATCH', `/properties/${id}`, { body: patch }));
export const trackProperty = (id, event) => call(() => mock.trackProperty(id, event), () => request('POST', `/properties/${id}/events`, { body: { event } }));
export const reportProperty = p => call(() => mock.reportProperty(p), () => request('POST', '/reports', { body: p }));

/* ── Perfil e conta ── */
export const updateUserProfile = d => call(() => mock.updateUserProfile(d), () => request('PATCH', '/users/me', { body: d }));
export const changePassword = d => call(() => mock.changePassword(d), () => request('POST', '/users/me/password', { body: d }));
export const deleteUserAccount = (d = {}) => call(() => mock.deleteUserAccount(d), () => request('DELETE', '/users/me', { body: d }));

/* Só para demonstração (não existe no backend real): simular fim/reposição dos 15 dias grátis */
export const dev = devTools;
