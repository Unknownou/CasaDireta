/* store.js — gestor de estado global do CasaDireta.
 *
 * Máquina de estados rígida (recalculada SEMPRE a partir do estado e do relógio, a cada ecrã):
 *   AUTH -> OTP -> [fim do período grátis / subscrição terminada = SUBSCRIPTION_PAYWALL] -> APP_MAIN
 *   - sem sessão e sem código pendente ............................. AUTH
 *   - código OTP pedido e ainda não confirmado ...................... OTP
 *   - sessão válida e accessStatus === 'TRIAL_EXPIRED' ............... SUBSCRIPTION_PAYWALL (bloqueio total)
 *   - sessão válida e accessStatus 'TRIAL_ACTIVE' | 'SUBSCRIBED_ACTIVE' . APP_MAIN
 */
import * as api from './apiService.js';
import { subscribed, accessStatus, epoch } from './utils.js';

const KEY = 'casadireta:client';
const freshLocal = () => ({ favs: {}, interests: {}, contacts: {}, roommates: [], chats: [] });

export const store = {
  ready: false,
  user: null,          // utilizador autenticado (com trialStartedAt, trialEndsAt, subscribedUntil, subscriptionStatus, payments)
  token: null,         // só existe depois do OTP confirmado
  subscriptionChecked: false,
  pendingOtp: null,    // { purpose, phone, userId, sentAt, resendIn, verified, busy, resetToken, from }
  properties: [],      // cache de imóveis (detalhe, favoritos, minhas casas)
  propertiesLoading: false,
  propertiesError: '',
  notifications: [],   // avisos de casas novas/perto e mensagens
  roommates: [],
  local: freshLocal()  // dados só do cliente: favoritos, contactos, interesses, procuras de colega
};

const listeners = new Set();
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => fn(store));

export const getAccessStatus = () => accessStatus(store.user);
export const hasAccess = () => !!store.user && (!store.subscriptionChecked || subscribed(store.user));
export function currentScreen() {
  if (!store.user || !store.token) return store.pendingOtp && !store.pendingOtp.verified ? 'OTP' : 'AUTH';
  if (!store.subscriptionChecked) return 'APP_MAIN';
  return hasAccess() ? 'APP_MAIN' : 'SUBSCRIPTION_PAYWALL';
}

export function persist() {
  try {
    // Keep the bearer token only for this browser session; localStorage survives
    // shared-device use and makes token theft persist across browser restarts.
    sessionStorage.setItem(KEY, JSON.stringify({ token: store.token, local: store.local }));
    localStorage.removeItem(KEY);
  } catch (e) { /* storage indisponível: a sessão continua em memória */ }
}

export async function init() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (saved && saved.local) store.local = { ...freshLocal(), ...saved.local };
    // Remove dados de demonstração/orfãos antes da entrada em produção.
    store.local.roommates = (store.local.roommates || []).filter(r => r.userId);
    if (saved && saved.token) {
      api.setAuthToken(saved.token);
      const r = await api.getCurrentUser();
      if (r.ok) { store.user = r.data; store.token = saved.token; await enterMain(); }
      else api.setAuthToken(null);
    }
  } catch (e) { /* estado corrompido: começa limpo */ }
  store.ready = true; emit();
}

/* Depois do OTP: guarda a sessão e carrega os dados */
export async function startSession(user, token) {
  store.user = user; store.token = token; store.subscriptionChecked = false; store.pendingOtp = null;
  api.setAuthToken(token); persist();
  await enterMain(); emit();
}
export function endSession() {
  store.user = null; store.token = null; store.subscriptionChecked = false; store.pendingOtp = null; store.properties = [];
  api.setAuthToken(null); persist(); emit();
}
async function enterMain() {
  await Promise.race([
    refreshSubscription(),
    new Promise(resolve => setTimeout(resolve, 3500))
  ]);
  // Dados secundários não podem bloquear o primeiro render da aplicação.
  // Carregam em segundo plano para evitar spinner infinito quando uma API está lenta.
  if (hasAccess()) {
    void Promise.allSettled([refreshProperties(), refreshNotifications(), refreshRoommates()]);
  }
}
export async function refreshSubscription() {
  if (!store.user) return;
  const r = await api.getSubscriptionStatus(store.user.id);
  // Só concluímos a verificação quando o servidor devolve uma data de trial
  // ou de subscrição válida. Uma resposta incompleta/temporariamente inválida
  // não pode enviar uma conta nova para o paywall.
  const data = r.ok ? (r.data || {}) : null;
  const hasValidAccessDate = data && (epoch(data.trialEndsAt) > 0 || epoch(data.subscribedUntil) > 0);
  if (hasValidAccessDate) { store.user = { ...store.user, ...data }; store.subscriptionChecked = true; }
  emit();
}
export async function refreshUser() {
  const r = await api.getCurrentUser();
  if (r.ok) { store.user = r.data; emit(); }
}
export async function refreshProperties() {
  store.propertiesLoading = true; store.propertiesError = ''; emit();
  const r = await api.listProperties({ includeRented: true });
  if (r.ok) store.properties = r.data;
  else store.propertiesError = r.error?.message || 'Não foi possível carregar os anúncios.';
  store.propertiesLoading = false;
  emit();
}
export async function refreshRoommates() {
  const r = await api.listRoommates();
  if (r.ok) store.roommates = r.data || [];
}
export async function refreshNotifications() {
  if (!store.user) return;
  const r = await api.listNotifications({ unread: true });
  if (r.ok) store.notifications = r.data || [];
  emit();
}
export function setUser(u) { store.user = { ...store.user, ...u }; emit(); }
export function forgetLocalUser(id) { for (const k of ['favs', 'interests', 'contacts']) delete store.local[k][id]; persist(); }
export function resetAll() { store.local = freshLocal(); endSession(); }
