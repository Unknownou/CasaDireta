# CasaDireta

Aluguer direto de quartos e casas em Maputo e Matola, **sem intermediários e sem taxas de visita**.
Frontend mobile-first (HTML + Tailwind CDN + JavaScript ES modules), pronto para ligar a um backend real,
ao **MozSMS** (OTP) e ao **PaySuite** (99 MT via M-Pesa / e-Mola).

## Como correr
1. Abra a pasta no VS Code e instale a extensão **Live Server**.
2. Botão direito em `index.html` → **Open with Live Server** (módulos ES precisam de HTTP).
3. No Chrome/Edge: F12 → Toggle Device Toolbar para ver como telemóvel.

Sem Live Server: `python -m http.server 5500` e abrir `http://localhost:5500`.

## Fluxo de acesso
`AUTH → OTP → 15 dias grátis (APP_MAIN) → bloqueio (SUBSCRIPTION_PAYWALL) → pagamento de 99 MT → APP_MAIN`

- O frontend local continua com um adaptador mock interno até o backend central ser ligado; não exibe códigos ou controles de teste na interface.

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

Na subscrição, a operadora é detetada automaticamente pelo prefixo: `84/85` = M-Pesa e `86/87` = e-Mola.
O backend deve repetir esta validação e não confiar numa operadora enviada pelo cliente.

> Demonstração: senhas em `localStorage` e textos legais ilustrativos. Não usar em produção sem backend seguro e revisão jurídica.

## Conversas, notificações e TUPC

O frontend expõe o contrato para `GET/POST /conversations/:id/messages` e para o registo de tokens em
`POST /notifications/push-token`. A ponte opcional `js/tupc.js` prepara a sincronização de identidade.
Para produção ainda é necessário um backend que persista mensagens, entregue eventos em tempo real e envie
Web Push/FCM. Notificações com o ecrã desligado exigem HTTPS, VAPID/FCM e integração nativa. O endpoint TUPC
deve ser fornecido pela equipa responsável e permanece desativado por defeito.
