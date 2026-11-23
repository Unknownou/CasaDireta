# CasaDireta — revisão de segurança

Data: 23/11/2026

## Resumo

Foram revistos o frontend JavaScript, as migrações Supabase/RLS, a
configuração Vercel e o wrapper Android/Play Store. Foram corrigidas três
exposições críticas no escopo CasaDireta: mutações diretas pelo papel
`authenticated`, captura de áudio sem necessidade e dependências npm críticas.

## Correções aplicadas

### SEC-01 — DML direto no Supabase

As migrações anteriores concediam `insert/update/delete` a `authenticated` em
propriedades, conversas, mensagens, notificações e push subscriptions. Isso
permitia contornar a validação central feita pelas Edge Functions.

Correção: `supabase/migrations/581_casadireta_lock_client_dml.sql` revoga essas
operações para o browser. Escritas devem passar pelas funções Central/TUPC,
que validam ownership, payload, papel, auditoria e pagamento. A política de
mensagens também exige que o destinatário seja o outro participante da
conversa.

### SEC-02 — Capacidade de microfone não utilizada

O Android declarava `RECORD_AUDIO` e expunha uma interface JavaScript capaz de
iniciar gravações. Não existe funcionalidade CasaDireta que exija áudio.

Correção: removidos a permissão, o `WebChromeClient` de áudio, o
`JavascriptInterface` `CasaDiretaAudio` e o código de `MediaRecorder` em
`android/app/src/main/java/mz/casadireta/app/MainActivity.java`.

### SEC-03 — Dependências npm críticas

`npm audit --omit=dev --audit-level=high` identificava versões vulneráveis de
`@capacitor/android` e `tar`.

Correção: `package-lock.json` atualizado para Capacitor 7.6.10 e `tar` 7.5.23.
O mesmo comando passou a reportar 0 vulnerabilidades.

## Riscos restantes

### Alta — backend Central/TUPC fora deste checkout

O código das Edge Functions partilhadas não está presente. Não é possível
confirmar aqui a verificação do webhook PaySuite, idempotência, rate limiting,
cookies/sessões, autorização dos endpoints, ou proteção dos secrets MozSMS e
PaySuite. Esses secrets não aparecem no frontend auditado.

### Alta — política de leitura de imóveis ampla

`supabase/migrations/578_casadireta_marketplace.sql:81-82` permite que qualquer
utilizador autenticado leia todas as colunas de `casadireta.properties`,
incluindo `owner_phone`. Confirmar se o endpoint Central devolve apenas os
campos necessários; idealmente separar dados públicos do contacto privado ou
usar uma view segura.

### Alta — função `track_property` é `SECURITY DEFINER`

`supabase/migrations/580_casadireta_property_events.sql:2-13` incrementa
contadores com base num UUID fornecido pelo cliente. Deve manter apenas a
contagem autorizada no backend, aplicar rate limiting/anti-abuso e impedir
eventos artificiais em escala.

### Média — gravação de mensagens via função central

O frontend envia `toUserId` e `conversationId`; a função Central deve ignorar
identidade fornecida pelo cliente, derivar o remetente da sessão e validar os
dois participantes no servidor. A migração adiciona defesa de camada RLS para
acesso direto, mas não substitui essa validação na Edge Function.

### Média — uploads e storage

O frontend aceita `image/*`. A Edge Function/storage precisa validar MIME real,
tamanho, dimensões, extensão, paths pertencentes ao utilizador e URLs
assinadas. Não confiar em data URLs ou nomes enviados pelo browser.

### Média — Play Store

O manifesto mantém apenas `INTERNET` e `POST_NOTIFICATIONS` após a correção.
O APK ainda não foi validado neste ambiente porque o Gradle encontrou Java 8;
o Android Gradle Plugin exige Java 11 ou superior. É necessário executar o
build/release com JDK 17, validar o AAB assinado e confirmar no Play Console a
declaração de notificações e Data Safety.

## Segredos

Foi encontrada uma chave publicável do Supabase em `js/config.js`; isso é
compatível com frontend, desde que RLS e Edge Functions estejam corretos. Não
foi encontrada `service_role`, chave privada VAPID, token PaySuite, segredo
MozSMS ou keystore no checkout. O `.gitignore` ignora `.env`, por isso os
secrets do ambiente remoto não podem ser confirmados por inspeção local.

## Validação

- `npm audit --omit=dev --audit-level=high`: passou, 0 vulnerabilidades.
- `node --check js/apiService.js`: passou.
- `node --check js/app.js`: passou.
- `node --check service-worker.js`: passou.
- `git diff --check`: passou, com avisos apenas de conversão LF/CRLF.
- Android `:app:assembleDebug`: bloqueado por Java 8; requer JDK 11+.
