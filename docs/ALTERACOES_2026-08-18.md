# Alterações estruturais — 18/08/2026

## Objetivo

Consolidar o Agenda Livre como SaaS multi-tenant sem recomeçar a arquitetura existente e sem alterar o fluxo funcional de checkout já utilizado pela interface pública.

## Alterações entregues

### Autenticação e tenant

- removido o arquivo legado de autenticação externa `app/chatgpt-auth.ts`;
- removidos fallbacks de tenant fixo do runtime (`app/` e `lib/`);
- `/admin` sem tenant não escolhe empresa silenciosamente: resolve o destino após autenticação;
- criada `/selecionar-empresa` para usuários com mais de um `tenant_members` ativo;
- usuário com um único tenant continua entrando diretamente no painel correspondente;
- Admin Master continua entrando em `/plataforma`;
- `/` agora é uma entrada neutra da plataforma; `/?tenant=<slug>` apenas redireciona explicitamente para `/empresa/<slug>` por compatibilidade;
- APIs públicas exigem tenant real e retornam `TENANT_REQUIRED` quando ausente.

### Google OAuth

- criada migration `0005_oauth_state_user.sql`;
- `oauth_states` agora possui `user_id` e índice próprio;
- o início do OAuth grava o usuário interno autenticado;
- o callback exige que o usuário atual seja o mesmo que iniciou o `state`;
- conexão, troca de calendário e desconexão geram registros em `audit_log`;
- estados OAuth iniciados antes da migration, sem `user_id`, precisam ser reiniciados caso ainda estejam pendentes.

### Empacotamento e arquitetura

- adicionado `.openai/hosting.json` não sensível com binding D1 `DB`, necessário pelo `vite.config.ts` e pelo empacotamento existente;
- removido `app.zip` aninhado;
- removida documentação antiga que contradizia a stack vigente;
- ADR atualizado para refletir o monólito modular em Cloudflare Workers + D1;
- README e documentação de autenticação/Google atualizados;
- `.env` real não faz parte do ZIP final; use `.env.example` e mantenha secrets fora de entregas.

## Pagamento

O checkout Stripe foi preservado síncrono nesta entrega porque a interface pública depende da resposta imediata `checkoutUrl`. Migrá-lo para Outbox exige uma alteração coordenada do contrato da API e do fluxo de redirecionamento/polling; não foi feita uma mudança parcial que pudesse degradar o pagamento existente.

## Validação executada

- aplicação sequencial de todas as migrations em SQLite: OK;
- presença de `oauth_states.user_id` e `oauth_states_user_idx`: OK;
- metadados JSON/Drizzle da migration 0005: OK;
- testes independentes de build: 18/18 passando;
- busca no runtime por tenant demo/origem antiga/autenticação externa: nenhuma ocorrência;
- `npm ci` não concluiu no ambiente de execução por indisponibilidade/lentidão do registry, portanto typecheck/lint/build completos não puderam ser certificados aqui;
- os dois testes `rendered-html` dependem de `dist/server/index.js` e devem ser executados após `npm ci && npm run build` em ambiente com dependências instaladas.

## Validação local recomendada

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm test
```

Depois aplique a migration nova no D1 do ambiente usando o processo de migrations já adotado pelo projeto.
