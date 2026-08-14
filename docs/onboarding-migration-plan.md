# Plano incremental de migração — Agenda Livre para Onboarding

## Estado atual confirmado

O aplicativo existente é um Next.js/Vinext executado com Cloudflare Workers. A persistência atual usa D1/Drizzle. O endpoint público de catálogo depende diretamente do binding `cloudflare:workers` `DB`.

O D1 local incluído no ZIP foi inspecionado e estava vazio (zero tabelas). Depois de aplicar `0000_magical_talos.sql` e `0001_silly_miracleman.sql`, o tenant `clinica-aurora` e seus três serviços passaram a existir. Essa é a causa concreta encontrada para o `500` do catálogo quando o binding D1 está presente, mas o schema local ainda não foi migrado.

O build do ZIP original também não é portátil: os arquivos executáveis perderam permissões e o `node_modules` empacotado não contém o binding nativo Linux exigido pelo Rolldown. O código-fonte deve ser distribuído sem `node_modules` e reinstalado no ambiente de destino.

## Etapa A — baseline legado

- [x] preservar o Next.js atual na raiz;
- [x] identificar o acoplamento do catálogo ao D1;
- [x] confirmar que o D1 enviado estava sem tabelas/migrations;
- [x] aplicar as migrations localmente e confirmar `clinica-aurora` + 3 serviços;
- [x] retornar `503 Service Unavailable` quando o binding D1 não existir;
- [x] incluir `correlationId` no erro do catálogo;
- [x] adicionar teste de regressão estrutural para o caso;
- [ ] reinstalar dependências do app legado no ambiente de desenvolvimento;
- [ ] iniciar `npm run legacy:dev`;
- [ ] aplicar `npm run db:migrate:local`;
- [ ] confirmar `GET /api/public/catalog?tenant=clinica-aurora` com HTTP 200.

## Etapa B — backend novo em paralelo

- [x] criar `apps/api`;
- [x] configurar NestJS com TypeScript strict;
- [x] configurar prefixo `/api/v1`;
- [x] configurar Swagger;
- [x] adicionar `application/problem+json` global;
- [x] adicionar `correlationId`;
- [x] configurar Prisma/PostgreSQL;
- [x] criar health e readiness;
- [x] criar modelos mínimos `Tenant`, `User`, `UserRole` e `Session`;
- [x] adicionar PostgreSQL e MinIO via Docker Compose;
- [ ] instalar dependências de `apps/api`;
- [ ] gerar Prisma Client;
- [ ] criar primeira migration PostgreSQL;
- [ ] validar health/readiness contra o container PostgreSQL.

## Etapa C — autenticação e TenantContext

Próxima implementação funcional, após o backend novo estar executando:

1. `auth/domain` — sessão opaca e regras de expiração/revogação;
2. `auth/application` — criar e revogar sessão;
3. `auth/infrastructure` — persistência Prisma;
4. `auth/presentation/http` — `POST /auth/sessions` e `DELETE /auth/sessions/current`;
5. `users/application` — leitura do usuário atual;
6. `GET /me`;
7. middleware/guard que resolve sessão, usuário, tenant e roles;
8. TenantContext obrigatório nos repositórios;
9. teste de isolamento tenant A → tenant B.

## Regra de migração

Nenhum endpoint legado será removido por antecipação. Cada remoção deve ocorrer somente depois que seu substituto no NestJS estiver implementado, testado e consumido pelo front-end.
