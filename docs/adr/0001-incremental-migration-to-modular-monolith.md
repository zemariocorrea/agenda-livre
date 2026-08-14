# ADR 0001 — Migração incremental para monólito modular

- Status: Aceito
- Data: 2026-08-14

## Contexto

O código recebido possui um aplicativo Next.js/Vinext executado em Cloudflare Workers, com D1 e Drizzle. A arquitetura-alvo do produto de onboarding define Next.js no front-end, NestJS no back-end, PostgreSQL, Prisma, MinIO, API REST versionada e monólito modular.

Mover o aplicativo atual imediatamente para `apps/web` ou substituir D1/Drizzle de uma só vez cria risco desnecessário de regressão e dificulta identificar a causa dos erros atuais.

## Decisão

A migração será incremental.

1. O aplicativo Next.js atual permanece temporariamente na raiz como legado executável.
2. O novo backend nasce isolado em `apps/api`.
3. PostgreSQL e MinIO são adicionados em `infrastructure/docker-compose.yml`.
4. Novos endpoints do produto de onboarding são implementados apenas em `/api/v1` no NestJS.
5. Endpoints legados do Next.js serão removidos somente depois que o fluxo correspondente existir e estiver testado no NestJS.
6. A mudança definitiva do Next.js para `apps/web` será feita em uma etapa própria, depois que scripts de build/preview deixarem de depender de caminhos relativos da raiz.

## Consequências

### Positivas

- preserva o front-end atual durante a transição;
- reduz o tamanho de cada mudança;
- permite comparar o comportamento antigo e novo;
- cria uma fronteira explícita para o domínio de onboarding.

### Negativas

- durante a migração existirão dois runtimes HTTP no repositório;
- D1/Drizzle coexistirão temporariamente com PostgreSQL/Prisma;
- scripts de desenvolvimento precisarão indicar claramente qual runtime está sendo iniciado.

## Próxima revisão

Revisar este ADR quando o primeiro fluxo autenticado do onboarding estiver funcionando ponta a ponta no NestJS. Nesse momento, avaliar a movimentação do Next.js para `apps/web` e a remoção dos endpoints legados equivalentes.
