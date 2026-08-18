# Agenda Livre

SaaS multiempresa para agendamentos públicos. Cada empresa possui página própria, equipe com agendas individuais, catálogo N:N de atividades, painel, integração de agenda e pagamento opcional.

## Hierarquia entregue

```text
Agenda Livre (Admin Master)
└── Empresa
    ├── Administradores
    ├── Profissionais
    ├── Atividades
    ├── Disponibilidades
    ├── Bloqueios
    ├── Agendamentos
    └── Integrações
```

O Admin Master cria, configura, publica e arquiva empresas. Cada empresa recebe um proprietário, URL pública própria e, opcionalmente, o primeiro profissional. Dentro do painel da empresa, proprietário e administradores mantêm toda a estrutura operacional sem acessar dados de outros clientes.

## O que já existe

- formulário público em três etapas;
- Admin Master com visão geral, cadastro, edição e arquivamento seguro de empresas;
- provisionamento atômico de empresa, proprietário e primeira agenda profissional;
- painel administrativo responsivo;
- CRUD de administradores, profissionais, atividades e bloqueios;
- gestão de agendamentos e identidade do site da empresa;
- profissionais administráveis, independentes dos usuários que acessam o painel;
- atividades configuráveis com duração, preço e vínculo com vários profissionais;
- disponibilidade semanal, bloqueios e compromissos por profissional;
- banco relacional isolado por `tenant_id`;
- cálculo de horários usando fuso da empresa;
- simultaneidade entre profissionais e proteção contra sobreposição na mesma agenda;
- criação idempotente de agendamentos;
- padrão Transactional Outbox para notificações e integrações;
- integração Google Agenda por profissional, via OAuth 2.0, e convite ao cliente;
- pagamento opcional por checkout hospedado;
- webhook de confirmação de pagamento;
- e-mails transacionais com retentativas;
- histórico de auditoria;
- autenticação interna por e-mail e senha, com sessão opaca em cookie `HttpOnly`;
- RBAC entre Admin Master e membros da empresa, sem dependência de identidade externa.

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

## Rotas principais

| Método | Rota | Finalidade |
| --- | --- | --- |
| `GET` | `/empresa/:slug` | Site público exclusivo da empresa |
| `GET` | `/plataforma` | Painel do Admin Master |
| `GET` | `/plataforma/empresas` | Cadastro e listagem de empresas |
| `GET/PATCH/DELETE` | `/api/platform/tenants/:id` | Detalhe, configuração e arquivamento da empresa |
| `GET/POST` | `/api/platform/tenants` | Listagem e provisionamento atômico de empresas |
| `GET` | `/api/public/catalog` | Empresa e catálogo público |
| `GET` | `/api/public/availability` | Horários para atividade, data e profissional opcional |
| `POST` | `/api/public/bookings` | Reserva idempotente e grava eventos assíncronos |
| `GET/POST` | `/api/admin/professionals` | Consulta e criação de profissionais |
| `PATCH` | `/api/admin/professionals/:id` | Perfil, publicação e atividades do profissional |
| `GET/POST` | `/api/admin/services` | Consulta e criação de atividades |
| `PATCH` | `/api/admin/services/:id` | Edição e publicação de atividade |
| `GET/PUT` | `/api/admin/availability` | Leitura e gravação da semana de cada profissional |
| `GET/POST` | `/api/admin/members` | Administradores e equipe operacional da empresa |
| `PATCH/DELETE` | `/api/admin/members/:id` | Acesso, papel e desativação de membro |
| `GET/POST` | `/api/admin/blocked-periods` | Bloqueios globais ou por profissional |
| `PATCH/DELETE` | `/api/admin/blocked-periods/:id` | Edição e remoção de bloqueio |
| `GET` | `/api/admin/appointments` | Agenda completa com filtros de profissional e status |
| `PATCH` | `/api/admin/appointments/:id` | Atualização de status do agendamento |
| `GET/PATCH` | `/api/admin/company` | Dados, marca e conteúdo do site da empresa |
| `GET` | `/api/admin/dashboard` | Métricas e compromissos do painel |
| `GET` | `/api/admin/integrations/google/start` | Início do OAuth para um profissional |
| `GET` | `/api/admin/integrations/google/callback` | Conclusão segura do OAuth |
| `POST` | `/api/internal/outbox` | Entrega de agenda e notificações |
| `POST` | `/api/webhooks/stripe` | Confirmação assinada de pagamento |
| `GET` | `/agendamento/:token` | Confirmação pública e retorno do checkout |

## Autenticação interna

A página pública não exige conta. Os painéis usam autenticação própria do Agenda Livre por e-mail e senha; não há dependência de ChatGPT, OpenAI, cabeçalhos de proxy ou outro provedor de identidade externo.

A identidade fica em `users`, a autorização master em `platform_admins` e os vínculos por empresa em `tenant_members`. As senhas são derivadas com PBKDF2-HMAC-SHA256, salt individual e 600.000 iterações. A sessão usa token aleatório de alta entropia; somente o hash SHA-256 do token é persistido em `auth_sessions`. O navegador recebe cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção e com expiração de oito horas.

Cada API protegida refaz a autorização no servidor. O `tenant_id` nunca é aceito como prova de acesso: a empresa é resolvida a partir da sessão e do vínculo ativo do usuário. Proprietário e administrador gerenciam a empresa; o Admin Master pode prestar suporte em qualquer tenant ativo. Profissionais continuam separados das contas de login.

Depois de aplicar as migrações, crie o primeiro Admin Master pela CLI:

```bash
AGENDA_BOOTSTRAP_EMAIL=admin@seudominio.com \
AGENDA_BOOTSTRAP_NAME="Administrador Master" \
AGENDA_BOOTSTRAP_PASSWORD="troque-esta-senha-forte" \
npm run auth:bootstrap
```

Para um D1 remoto:

```bash
npm run auth:bootstrap -- --remote --database NOME_DO_D1 --email admin@seudominio.com --name "Administrador Master" --password "troque-esta-senha-forte"
```

O comando não imprime a senha. Proprietários e administradores criados pelo sistema recebem uma senha temporária exibida uma única vez quando uma nova identidade é provisionada e precisam trocá-la no primeiro login.

## Modelo multi-profissional

`professionals` pertence à empresa e `professional_services` materializa a relação N:N entre equipe e catálogo. O `professional_id` resolvido fica gravado em toda reserva. Duração, preço e buffers também são copiados para o compromisso, preservando o histórico mesmo se o catálogo mudar. Na escolha “qualquer profissional”, o servidor seleciona deterministicamente uma agenda livre antes da inserção.

## Processamento assíncrono

O endpoint `/api/internal/outbox` deve ser chamado por um agendador usando `Authorization: Bearer <OUTBOX_SECRET>`. Cada execução processa até 20 eventos, recupera bloqueios abandonados e aplica retentativa com backoff. Google Agenda, Stripe e Resend permanecem opcionais; o agendamento funciona sem essas credenciais.

## Validação

```bash
npm run lint
npm test
```

Os testes aplicam todas as migrações em SQLite real e comprovam provisionamento hierárquico, arquivamento sem perda, isolamento entre empresas, relação N:N, simultaneidade entre profissionais e bloqueio de sobreposição na mesma agenda.

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Prompt para continuar em outro Work](docs/PROMPT_CONTINUAR.md)
- [Autenticação interna](docs/AUTHENTICATION.md)
