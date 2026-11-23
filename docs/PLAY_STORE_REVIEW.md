# CasaDireta — revisão para Google Play

Data da revisão: 23/11/2026

## Estado local verificado

| Item | Estado |
|---|---|
| Tipo de app | Capacitor Android, web app empacotado em `dist/` |
| Application ID | `mz.casadireta.app` |
| Versão atual | `1.0.1` / versionCode `2` |
| Target SDK | 35 |
| Ícone | `casadireta_icon` no Android e `assets/casadireta-icon.png` no web/PWA |
| Manifesto | Válido; `exported=true` na Activity principal e FileProvider não exportado |
| HTTPS | HTTP claro desativado no Android (`usesCleartextTraffic=false`) |
| Permissões | INTERNET, RECORD_AUDIO, POST_NOTIFICATIONS |
| Localização/câmara | Não declaradas |
| Termos/privacidade | Texto final dentro da app, com DeliGo Triunfal, Lda. e direitos reservados; ainda falta URL pública |
| Screenshots | Não há conjunto oficial de screenshots de loja no repositório |

`npm audit --omit=dev --audit-level=high` encontrou 3 vulnerabilidades transitivas no toolchain Capacitor (`@capacitor/android` e `tar`, incluindo 1 alta e 2 críticas). Não executei `npm audit fix` automaticamente porque pode atualizar o runtime nativo e alterar o APK; isso requer uma rodada própria de atualização, testes e revisão.

## Permissões e justificações

- `INTERNET`: autenticação, imóveis, mensagens, notificações e pagamentos.
- `RECORD_AUDIO`: gravação opcional de mensagens de voz. Deve ser descrita na ficha da Play Store e pedida apenas quando o utilizador iniciar a gravação.
- `POST_NOTIFICATIONS`: notificações de mensagens, casas novas e suporte. Deve ser pedida em contexto, depois de o utilizador tocar em “Ativar notificações”.

Não adicionar permissões de localização, contactos, SMS, câmara ou armazenamento amplo sem uma funcionalidade aprovada que as exija.

## Checklist Data Safety — preparar, confirmar na Play Console

Dados potencialmente recolhidos pelo app:

- número de telefone, nome e credenciais de conta;
- foto de perfil, bairro, idade, profissão e preferências, quando preenchidos;
- fotos e dados dos imóveis publicados;
- mensagens de chat e, opcionalmente, áudio gravado;
- token de notificações push e dados técnicos mínimos do dispositivo;
- estado, referência, valor e data da subscrição; o PIN do pagamento não deve ser recolhido pelo app.

Finalidades prováveis: funcionamento da conta, autenticação/OTP, comunicação entre utilizadores, publicação e pesquisa de imóveis, suporte, segurança/prevenção de fraude e processamento da subscrição.

Destinatários/partilha a confirmar com os contratos reais: TUPC/Supabase para operação da conta e dados, MozSMS para OTP, PaySuite/operadora para pagamento e serviço push para notificações. A resposta final da Data Safety deve ser confirmada com os proprietários dessas integrações.

Segurança a declarar apenas após confirmação operacional: transmissão por HTTPS, eliminação de conta disponível no Perfil e política de retenção para cópias de segurança, suporte, pagamentos e mensagens.

## Termos e política de privacidade

O texto atual dentro da app menciona DeliGo Triunfal, Lda., eliminação de conta, OTP, PaySuite, MozSMS e dados tratados. Porém, contém a indicação “Texto de demonstração, a rever por um jurista antes do lançamento”. Isto é bloqueador de lançamento: publicar uma URL pública de política de privacidade e termos finais, com entidade responsável, contacto, bases/finalidades, retenção, partilha, direitos, eliminação e tratamento de menores.

## Screenshots e ficha da loja

Preparar no mínimo 4 screenshots reais, sem números de teste, OTP, tokens ou dados pessoais:

1. ecrã inicial/pesquisa de casas;
2. detalhe do imóvel com fotos e contacto;
3. publicar/editar casa para proprietário;
4. mensagens e notificações;
5. opcional: dividir renda e perfil.

Usar capturas em telemóvel real ou emulador, sem molduras enganosas, com texto legível e a mesma versão do APK/AAB. Preparar também nome “CasaDireta”, descrição curta, descrição completa, categoria, email de suporte, ícone de 512×512 e imagem promocional se aplicável.

## Ainda depende da conta Play Console

- aceitar acordos de desenvolvedor e completar verificação da conta;
- confirmar propriedade/uso do package `mz.casadireta.app`;
- configurar assinatura Play App Signing e proteger a keystore de upload;
- gerar e validar um AAB release assinado, não apenas APK debug;
- preencher Data Safety, classificação de conteúdo, público-alvo e anúncios;
- publicar URL pública de privacidade e termos finais;
- carregar screenshots, ícone, textos, email de suporte e ficha da loja;
- executar teste interno/fechado com contas de teste e confirmar login, OTP, notificações, chat, fotos e pagamento;
- submeter para revisão. Nenhuma submissão foi feita por esta revisão local.

## Validação local

- Build web/Tailwind concluído.
- Build Android release concluído com JDK 21 e AAB assinado gerado em `outputs/CasaDireta-1.0.1-release.aab`.
- O checkout PaySuite é real e usa `paysuite-webhook?action=create-subscription`; não há função separada porque o projeto atingiu o limite de Edge Functions.
- O desbloqueio é fechado por segurança: só acontece após estado autoritativo `SUBSCRIBED_ACTIVE`, valor 99 MT e `subscribedUntil` futuro devolvidos pela Central.
- Não foi executada cobrança real nesta auditoria, por não existir um número/conta de homologação autorizado nesta sessão.
