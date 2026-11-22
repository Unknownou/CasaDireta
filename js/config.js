/* Configuração do frontend CasaDireta.
   Para ligar ao backend real: MOCK_MODE = false e API_BASE_URL = URL do servidor. */
export const MOCK_MODE = true;
export const API_BASE_URL = 'http://localhost:3000/api';
export const REQUEST_TIMEOUT_MS = 15000;

export const SUBSCRIPTION_PRICE_MT = 35;   // valor fixo (PaySuite: M-Pesa / e-Mola)
export const SUBSCRIPTION_DAYS = 30;       // dias de acesso por cada pagamento
export const OTP_RESEND_SECONDS = 30;      // contador do botão "Reenviar código" (MozSMS)
export const MOCK_OTP_CODE = '1234';       // só usado em MOCK_MODE
export const MOCK_LATENCY = [220, 520];    // atraso simulado (ms) em MOCK_MODE
