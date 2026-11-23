# CasaDireta — integração de produção com Central/TUPC

## Estado atual

O frontend mantém `MOCK_MODE` para imóveis, conversas e notificações enquanto
esses contratos ainda não estão publicados. Auth/OTP, restauração de sessão e
subscrição já usam as rotas TUPC CasaDireta publicadas no `paysuite-webhook`
(versão live 44).

## Bloqueio externo para ativar produção

Para concluir a troca de todos os módulos falta publicar ou indicar um contrato
Central/TUPC que cubra, para `app_code = casadireta`:

1. sessão/auth e OTP MozSMS, incluindo os papéis `inquilino` e
   `proprietario`;
2. leitura/atualização de `core.profiles`;
3. CRUD de imóveis e upload para `casadireta-properties`;
4. conversas persistentes entre proprietário e inquilino;
5. notificações in-app e dispatcher Web Push/FCM.

O ramo CasaDireta foi adicionado à função Central existente, sem alterar o
comportamento dos outros aplicativos. As rotas são:

```text
POST /functions/v1/paysuite-webhook?action=casadireta-request-otp
POST /functions/v1/paysuite-webhook?action=casadireta-verify-otp
GET  /functions/v1/paysuite-webhook?action=casadireta-me
```

O segundo ramo cria/atualiza `core.profiles`, membership `casadireta` e wallet
`casadireta:user:<auth_uid>`. O código OTP é armazenado apenas como hash e a
password não é persistida no desafio. A validação feita sem dados válidos
retorna erros controlados; ainda falta homologar um SMS real com uma conta de
teste autorizada.

## Contrato de pagamento preparado

O frontend chama:

```text
POST /functions/v1/paysuite-webhook?action=create-subscription
GET  /payments/subscriptions/:paymentId

Para o frontend CasaDireta, o estado é consultado em:
GET  /functions/v1/paysuite-webhook?action=subscription-status&id=:paymentId
```

O pedido envia apenas `phone`, `role`, `planId` e `appCode`. O preço de 99 MZN,
a operadora e a conta de receita devem ser resolvidos no backend.

```json
{
  "phone": "258841234501",
  "role": "proprietario",
  "planId": "casadireta_monthly_99_mzn",
  "appCode": "casadireta"
}
```

## Receita Central

Cada confirmação deve ser processada exclusivamente pelo backend Central/TUPC:

1. criar intenção idempotente;
2. resolver o MSISDN e a operadora no servidor;
3. chamar PaySuite com segredo server-side;
4. validar o webhook assinado;
5. gravar `payment_transactions`;
6. lançar `wallet_ledger_entries` em grupo equilibrado;
7. marcar `application = casadireta` e `revenue_owner = central`;
8. permitir reconciliação e reversão auditadas.

O frontend nunca confirma pagamento, escreve no ledger ou escolhe a conta de
receita.

O browser também não deve enviar diretamente o token de sessão CasaDireta ao
TUPC. A troca de identidade deve ser feita no backend Central, com uma sessão
central emitida para o cliente depois de autenticação e autorização.

## Gates antes de ativar produção

- URL e contrato Central/TUPC confirmados;
- `MOCK_MODE=false` apenas após staging validado;
- API de produção em HTTPS e nunca `localhost`;
- auth/OTP central com cookies/sessões seguras;
- PaySuite sandbox, callback HTTPS e assinatura verificados;
- idempotência, replay protection e reconciliação testadas;
- autoridade única do ledger `payments.*` confirmada;
- conta de receita Central e regras de taxa/split aprovadas;
- bucket de imóveis com Storage RLS e URLs assinadas;
- limites, rate limits, auditoria e rollback aprovados;
- backup restaurável e testes de concorrência aprovados.
