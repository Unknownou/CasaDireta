import * as api from './apiService.js';
import { PUSH_VAPID_PUBLIC_KEY } from './config.js';
function vapidKey(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
export async function enablePushNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return { ok: false, reason: 'unsupported' };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };
  if (!PUSH_VAPID_PUBLIC_KEY) return { ok: false, reason: 'vapid_key_required' };
  const registration = await navigator.serviceWorker.register('./service-worker.js');
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey(PUSH_VAPID_PUBLIC_KEY) });
  return api.registerPushToken({ token: JSON.stringify(subscription), platform: 'web', userAgent: navigator.userAgent });
}
