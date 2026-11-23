# Auditoria frontend — CasaDireta

Data: 23/11/2026

## Resultado

- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades encontradas.
- Dependência de produção: não há; Tailwind está apenas em `devDependencies`.
- A chave presente em `js/config.js` é uma chave publicável do Supabase. Não foi encontrada `service_role`, senha ou segredo privado no frontend.
- O frontend já usa `AbortController` nas requisições HTTP, com limite de 15 segundos.

## Correções aplicadas

- Downloads de imagens para edição e geração de URLs assinadas passaram a respeitar o mesmo timeout de 15 segundos; isso evita que o botão de guardar fique preso quando uma imagem não responde.
- O service worker agora assume o controlo após atualização e, ao tocar numa notificação, reutiliza uma janela CasaDireta já aberta quando possível.
- O carregamento do script de ícones deixou de bloquear a primeira renderização.
- O layout ganhou proteção contra overflow horizontal, suporte a ecrãs compactos/landscape e `content-visibility` para imagens fora da área visível.

## Pendências observadas

- A imagem `assets/casadireta-icon.png` tem aproximadamente 1,6 MB. Deve ser convertida para WebP/PNG otimizado numa próxima alteração visual; não foi substituída automaticamente para evitar alteração de identidade visual.
- Não foi possível medir Core Web Vitals reais sem uma sessão Chrome DevTools conectada. O relatório é baseado em inspeção do código e build local.
- O CSP permite scripts do `unpkg.com` e fontes Google. Para endurecer a segurança, o próximo passo seria self-host desses recursos com hash/SRI, mas isso pode alterar a renderização e não foi feito nesta correção pequena.

## Validação

- `npm run build` concluído com sucesso.
- `node --check js/apiService.js` concluído.
- `node --check service-worker.js` concluído.
- `git diff --check` sem erros.
