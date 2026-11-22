# Descoberta do backend Central/TUPC

## Evidência local

O checkout Central analisado está em:

```text
C:\Users\Administrator\Documents\Codex\deligo-staging-consumer
```

Ele já contém:

- `send-phone-otp` e `verify-phone-otp`;
- `core.profiles` e memberships por aplicação;
- `payments.*` e ledger central em preparação;
- `paysuite-webhook` com assinatura HMAC;
- `mestre24-create-subscription-payment` como exemplo de criação de cobrança;
- dispatcher central de notificações e storage preparado.

## Limites encontrados

O exemplo Mestre24 não deve ser copiado diretamente: usa schema, preço,
referências e ciclo próprios. O webhook central também contém caminhos legados
`public.wallets`/`public.wallet_ledger` e caminhos modernos `payments.*`.
Antes de CasaDireta entrar no fluxo financeiro, a Central precisa declarar uma
única autoridade de ledger e impedir dupla liquidação.

## Adaptação necessária para CasaDireta

Criar no backend Central, após revisão financeira:

1. `casadireta-create-subscription-payment` com `app_code = casadireta`;
2. plano server-side `casadireta_monthly_99_mzn`;
3. referência única com prefixo próprio, por exemplo `SUB_CD_`;
4. associação ao utilizador autenticado em `core.profiles`;
5. aplicação do evento em `payments.payment_transactions`;
6. lançamento único e equilibrado em `payments.wallet_ledger_entries`;
7. branch explícito no webhook para `SUB_CD_`;
8. reconciliação e reversão específicas da aplicação;
9. membership `casadireta` e bucket de imóveis com RLS.

Foi preparada no checkout local da Central a migration
`572_register_casadireta_platform_app.sql`. Ela regista o app `casadireta`,
adiciona-o ao catálogo TUPC, ativa somente MozeSMS e storage Supabase, e deixa
M-Pesa/e-Mola explicitamente desativados enquanto o contrato financeiro não
estiver homologado. Ela ainda não foi aplicada ao projeto remoto.

Também foi preparada `573_casadireta_subscription_contract.sql`, com o plano
server-side de 99 MZN e ciclos de subscrição idempotentes em `casadireta.*`,
ligados por `payment_transaction_id` ao ledger moderno. O modelo permite que o
frontend consulte o próprio ciclo, mas não permite escrita financeira pelo
cliente. A função de criação e o branch do webhook ainda precisam ser
implementados e homologados juntos; por isso estas migrations não devem ser
aplicadas isoladamente em produção.

Nenhuma dessas alterações foi aplicada remotamente neste turno. A presença do
código local não prova que as migrations, secrets ou funções estejam publicadas
no ambiente usado pela Central.

## Verificação read-only do Supabase de staging

Projeto consultado: `Deligo-Platform-Staging` (`tpmsgvkdjzoidvyiwwfk`), estado
`ACTIVE_HEALTHY`, região `eu-west-1`. A inspeção não alterou dados nem schema.

Há uma base adequada para reutilização: `core.profiles`,
`core.user_app_memberships`, `core.user_devices` e as tabelas centrais
`payments.payment_transactions`, `payments.wallet_accounts`,
`payments.wallet_ledger_entries`, `payments.idempotency_keys` e
`payments.paysuite_webhook_events`.

As políticas observadas protegem leitura de perfil, dispositivos e saldos para
o próprio utilizador/admin; escrita financeira permanece reservada ao backend
(por exemplo, `idempotency_keys` só tem política para `service_role`). Isto é
compatível com o desenho CasaDireta, desde que o frontend nunca escreva no
ledger diretamente.

O advisor de segurança ainda reporta 267 tabelas com RLS ativo sem políticas
e proteção contra palavras-passe comprometidas desativada. A contagem é do
projeto inteiro, não apenas das tabelas CasaDireta, mas é um bloqueador para
declarar a Central pronta para produção financeira sem revisão por schema.

## Estado das alterações locais

No checkout da Central foram preparadas as migrations `572_register_casadireta_platform_app.sql` e `573_casadireta_subscription_contract.sql`, além da Edge Function `casadireta-create-subscription-payment`. A função valida o token, exige `Idempotency-Key`, usa o telefone canónico de `core.profiles`, deteta a operadora no servidor e fixa o valor em 99 MZN. `deno check` passou.

No frontend, notificações in-app são geradas para inquilinos quando uma casa é publicada e destacadas quando o bairro coincide com a zona do perfil; o cliente consulta `/notifications` a cada 30 segundos. Push com tela desligada continua dependente da VAPID e do dispatcher central, portanto não é declarado operacional sem essas credenciais/configuração.

## Aplicação no staging

As migrations `572`, `573`, `574`, `575` e `576` foram aplicadas ao projeto staging
`tpmsgvkdjzoidvyiwwfk`. O bucket privado `casadireta-properties` existe com
limite de 8 MB, MIME limitado a JPEG/PNG/WebP e quatro políticas RLS por pasta
do utilizador. A função `paysuite-webhook` foi publicada na versão 41 com o
branch `SUB_CD_` e as rotas autenticadas `POST /paysuite-webhook?action=create-subscription`
e `GET /paysuite-webhook?action=subscription-status&id=...`.

O projeto atingiu o limite de Edge Functions, por isso não foi criada uma nova
função nem substituída qualquer função de outro app. O frontend CasaDireta usa
agora a rota central existente: ela autentica o utilizador, associa a membership
`casadireta`, fixa o plano `casadireta_monthly_99_mzn`, cria referência `SUB_CD_`
e exige idempotência. O código standalone permanece no checkout local para um
futuro upgrade, mas não é necessário para o fluxo publicado.

A migration `576_casadireta_reversal_rpc.sql` também foi aplicada. A RPC de
reversão é idempotente, exclusiva de `service_role`, atualiza a transação
original para reembolso/reversão e lança o par inverso no mesmo ledger moderno.
O webhook foi republicado na versão 41 para encaminhar falhas/reembolsos
CasaDireta para essa RPC.

## Verificação atual

- A versão Vercel publicada foi aberta e as telas de boas-vindas, entrada e
  criação de conta renderizaram sem erros JavaScript; o único aviso foi o uso
  do Tailwind CDN, que deve ser substituído por build local antes de uma
  otimização final de performance.
- No staging, `casadireta.subscription_cycles` e
  `casadireta.subscription_plans` têm RLS e políticas; o bucket de imóveis é
  privado e limitado a JPEG/PNG/WebP.
- As rotas financeiras sem Bearer token retornam `401` tanto para criação como
  para consulta de estado.
- O advisor Supabase ainda reporta 267 tabelas RLS sem políticas no projeto
  partilhado, além de avisos de índices duplicados. A contagem é transversal a
  outros aplicativos; não foi alterada para evitar regressão fora do escopo.
- O frontend continua em `MOCK_MODE` porque os contratos reais de auth, perfil,
  imóveis, conversas e dispatcher de push ainda não estão publicados como uma
  API CasaDireta/TUPC verificável. Não é seguro mudar este flag apenas porque o
  pagamento já tem uma rota partilhada.
