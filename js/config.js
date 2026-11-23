/* Configuração do frontend CasaDireta.
   Para ligar ao backend real: MOCK_MODE = false e API_BASE_URL = URL do servidor. */
export const MOCK_MODE = false;
export const API_BASE_URL = 'http://localhost:3000/api';
// Rota financeira partilhada do TUPC/Central (não consome uma Edge Function nova).
export const PAYMENT_API_BASE_URL = 'https://tpmsgvkdjzoidvyiwwfk.supabase.co/functions/v1';
export const TUPC_REST_BASE_URL = 'https://tpmsgvkdjzoidvyiwwfk.supabase.co/rest/v1';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_VPBqfA_NVrvTs3fRqA49iw_NdOhXRTC';
export const TUPC_AUTH_MODE = true;
export const REAL_PAYMENT_MODE = true;
export const TUPC_BASE_URL = '';
export const APP_CODE = 'casadireta';
export const SUBSCRIPTION_PLAN_ID = 'casadireta_monthly_99_mzn';
export const LEGAL_TERMS_URL = 'https://www.deligotriunfal.site/termos';
export const PRIVACY_POLICY_URL = 'https://www.deligotriunfal.site/privacidade';
// Deliberately empty until Central/TUPC publishes CasaDireta's web-push key.
// A guessed or reused VAPID key would register devices in the wrong tenant.
export const PUSH_VAPID_PUBLIC_KEY = '';
export const REQUEST_TIMEOUT_MS = 15000;

export const SUBSCRIPTION_PRICE_MT = 99;   // valor fixo (PaySuite: M-Pesa / e-Mola)
export const SUBSCRIPTION_DAYS = 30;       // dias de acesso por cada pagamento
export const OTP_RESEND_SECONDS = 30;      // contador do botão "Reenviar código" (MozSMS)
export const MOCK_OTP_CODE = '1234';       // só usado em MOCK_MODE
export const MOCK_LATENCY = [220, 520];    // atraso simulado (ms) em MOCK_MODE
