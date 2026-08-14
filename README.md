# Agenda Livre

SaaS multiempresa para agendamentos públicos. Cada empresa possui página própria, catálogo de atividades, disponibilidade, painel, integração de agenda e pagamento opcional.

## O que já existe

- formulário público em três etapas;
- painel administrativo responsivo;
- atividades configuráveis com duração e preço;
- disponibilidade semanal por responsável;
- banco relacional isolado por `tenant_id`;
- cálculo de horários usando fuso da empresa;
- proteção de concorrência contra sobreposição de compromissos;
- criação idempotente de agendamentos;
- padrão Transactional Outbox para notificações e integrações;
- integração Google Agenda por OAuth 2.0 e convite ao cliente;
- pagamento opcional por checkout hospedado;
- webhook de confirmação de pagamento;
- e-mails transacionais com retentativas;
- histórico de auditoria.

## Stack

- Next.js 16 + React 19;
- TypeScript;
- Cloudflare Workers;
- Cloudflare D1 (SQLite) + Drizzle ORM;
- Google Calendar API;
- Stripe Checkout;
- Resend Email API.

## Executar localmente

```bash
npm install
npm run dev
```

Na primeira execução local, mantenha o servidor aberto e, em outro terminal, aplique as migrações e os dados demonstrativos:

```bash
npm run db:migrate:local
```

Depois, atualize a página. O comando é idempotente e aplica apenas migrações ainda não registradas no banco local.

Para gerar uma nova migração após alterar o schema:

```bash
npm run db:generate
```

## Variáveis de ambiente

Copie `.env.example` para `.env.local` e configure apenas os adaptadores utilizados. Nunca salve valores reais no repositório.

| Variável | Uso |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth do Google Agenda |
| `GOOGLE_CLIENT_SECRET` | Troca e renovação de token Google |
| `INTEGRATION_ENCRYPTION_KEY` | Chave AES-256 em Base64 para tokens de integrações |
| `STRIPE_SECRET_KEY` | Criação do checkout opcional |
| `STRIPE_WEBHOOK_SECRET` | Validação do webhook Stripe |
| `RESEND_API_KEY` | Envio de confirmações por e-mail |
| `EMAIL_FROM` | Remetente verificado dos e-mails |
| `OUTBOX_SECRET` | Proteção do processador de eventos assíncronos |
| `BOOTSTRAP_ADMIN_EMAIL` | E-mail autorizado a assumir o tenant demonstrativo no primeiro acesso |

## Rotas principais

| Método | Rota | Finalidade |
| --- | --- | --- |
| `GET` | `/api/public/catalog` | Empresa e catálogo público |
| `GET` | `/api/public/availability` | Horários calculados para data e atividade |
| `POST` | `/api/public/bookings` | Reserva idempotente e grava eventos assíncronos |
| `GET/POST` | `/api/admin/services` | Consulta e criação de atividades |
| `PATCH` | `/api/admin/services/:id` | Edição e publicação de atividade |
| `GET/PUT` | `/api/admin/availability` | Leitura e gravação da semana disponível |
| `GET` | `/api/admin/dashboard` | Métricas e compromissos do painel |
| `GET` | `/api/admin/integrations/google/start` | Início do OAuth do Google |
| `GET` | `/api/admin/integrations/google/callback` | Conclusão segura do OAuth |
| `POST` | `/api/internal/outbox` | Entrega de agenda e notificações |
| `POST` | `/api/webhooks/stripe` | Confirmação assinada de pagamento |
| `GET` | `/agendamento/:token` | Confirmação pública e retorno do checkout |

## Autenticação

A página pública não exige conta. O painel e suas APIs usam o usuário autenticado fornecido pelo ambiente de hospedagem e validam sua associação em `tenant_members`. O acesso ao painel nunca é usado como autorização suficiente: cada operação confere o `tenant_id` no servidor.

No primeiro acesso ao tenant demonstrativo, o e-mail definido em `BOOTSTRAP_ADMIN_EMAIL` pode assumir o registro de proprietário que termina em `.example`. Essa troca só ocorre quando o usuário autenticado coincide exatamente com a variável configurada.

## Processamento assíncrono

O endpoint `/api/internal/outbox` deve ser chamado por um agendador usando `Authorization: Bearer <OUTBOX_SECRET>`. Cada execução processa até 20 eventos, recupera bloqueios abandonados e aplica retentativa com backoff. Google Agenda, Stripe e Resend permanecem opcionais; o agendamento funciona sem essas credenciais.

Para transformar o projeto em um SaaS hospedado fora do ambiente atual, mantenha a interface `adminTenant` e troque somente o adaptador de identidade por Auth.js, Clerk, Supabase Auth ou outro provedor escolhido.

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Prompt para continuar em outro Work](docs/PROMPT_CONTINUAR.md)

## Migração incremental para o produto de onboarding

Este repositório está em transição. O aplicativo Next.js/Vinext atual permanece temporariamente na raiz para preservar o baseline, enquanto o novo backend de onboarding é desenvolvido em `apps/api`.

Comandos adicionados:

```bash
# infraestrutura nova
npm run infra:up
npm run infra:down

# backend NestJS novo
npm run api:install
cp apps/api/.env.example apps/api/.env
npm run api:prisma:generate
npm run api:prisma:migrate
npm run api:dev

# aplicativo legado
npm run legacy:dev
# em outro terminal, após o D1 local ser criado
npm run db:migrate:local
```

A API nova usa `/api/v1`, com liveness em `/api/v1/health`, readiness em `/api/v1/readiness` e Swagger em `/api/v1/docs`.

Consulte `docs/adr/0001-incremental-migration-to-modular-monolith.md` e `docs/onboarding-migration-plan.md` antes de mover o frontend para `apps/web` ou remover D1/Drizzle.
