# CasaDireta

Aluguer direto de quartos e casas em Maputo e Matola, **sem intermediários e sem taxas de visita**.
Frontend mobile-first (HTML + Tailwind CDN + JavaScript ES modules), pronto para ligar a um backend real,
ao **MozSMS** (OTP) e ao **PaySuite** (35 MT via M-Pesa / e-Mola).

## Como correr
1. Abra a pasta no VS Code e instale a extensão **Live Server**.
2. Botão direito em `index.html` → **Open with Live Server** (módulos ES precisam de HTTP).
3. No Chrome/Edge: F12 → Toggle Device Toolbar para ver como telemóvel.

Sem Live Server: `python -m http.server 5500` e abrir `http://localhost:5500`.

## Fluxo de acesso
`AUTH → OTP → 15 dias grátis (APP_MAIN) → bloqueio (SUBSCRIPTION_PAYWALL) → pagamento de 35 MT → APP_MAIN`

- OTP de teste: `1234`. Números terminados em `99` simulam falha de pagamento.
- No Perfil (apenas em `MOCK_MODE`): botões para simular o fim dos 15 dias e repô-los.

## Estrutura
```
index.html
css/style.css
js/
├─ config.js        # MOCK_MODE, API_BASE_URL, preço, dias
├─ utils.js         # constantes, formatadores, accessStatus()
├─ apiService.js    # único ponto de dados (contrato HTTP no topo do ficheiro)
├─ mockBackend.js   # "servidor" simulado em localStorage
├─ store.js         # estado global e máquina de estados
└─ app.js           # interface
```

## Ligar ao backend real
`js/config.js`: `MOCK_MODE = false` e `API_BASE_URL` do servidor. A validação das datas
(`trialEndsAt`, `subscribedUntil`) deve ser feita pelo servidor; o webhook do PaySuite chega ao backend.

> Demonstração: senhas em `localStorage` e textos legais ilustrativos. Não usar em produção sem backend seguro e revisão jurídica.
