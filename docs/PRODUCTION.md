# CasaDireta — integração de produção

As credenciais de MozeSMS e PaySuite são mantidas exclusivamente nos secrets
do projeto Supabase partilhado com a Central/TUPC. Não devem ser colocadas no
frontend, neste repositório ou em variáveis públicas da Vercel.

## Secrets usados pela função partilhada

- MozeSMS: `MOZESMS_API_KEY`, `MOZESMS_API_SECRET`, `MOZESMS_BASE_URL`,
  `MOZESMS_SEND_PATH`, `MOZESMS_STATUS_PATH`, `MOZESMS_SENDER_ID`.
- PaySuite: `PAYSUITE_API_TOKEN`, `PAYSUITE_API_URL` (preferencial),
  `PAYSUITE_BASE_URL` (fallback), `PAYSUITE_WEBHOOK_SECRET` e
  `PAYSUITE_WEBHOOK_URL`.

O endpoint `paysuite-webhook` resolve automaticamente a operadora pelo prefixo
84/85/86/87. A subscrição CasaDireta usa o plano server-side
`casadireta_monthly_99_mzn`, com valor de 99 MZN e referências `SUB_CD_`.

## Validação

O teste real de OTP e pagamento ainda deve ser feito com um número de teste
autorizado e confirmação do fornecedor. Os valores dos secrets nunca devem ser
impressos em logs ou commitados.
