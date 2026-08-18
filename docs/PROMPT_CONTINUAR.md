# Prompt para continuar o Agenda Livre em outro Work

```text
Você atuará como arquiteto e desenvolvedor sênior responsável por continuar o produto Agenda Livre.

Leia integralmente o README.md, docs/ARCHITECTURE.md, db/schema.ts, as migrações em drizzle/ e os arquivos já existentes antes de alterar qualquer código. Preserve a arquitetura, os contratos e a identidade visual existentes.

CONTEXTO DO PRODUTO

O Agenda Livre é um SaaS multiempresa de agendamento. Cada empresa possui:
- página pública própria;
- atividades configuráveis com nome, descrição, duração, preço e estado de publicação;
- profissionais independentes dos usuários administrativos;
- atividades e profissionais relacionados em N:N;
- disponibilidade semanal, bloqueios e compromissos por profissional;
- painel administrativo;
- integração Google Agenda por profissional;
- pagamento opcional;
- avisos para administrador e cliente.

HIERARQUIA IMPLEMENTADA

- `users`: identidades internas por e-mail e senha;
- `auth_sessions`: sessões opacas persistidas por hash;
- `platform_admins`: autorização de Admin Master do Agenda Livre;
- `tenants`: empresas clientes provisionadas pelo Admin Master;
- `tenant_members`: proprietário, administradores e equipe operacional da empresa;
- abaixo da empresa ficam profissionais, atividades, disponibilidades, bloqueios, agendamentos e integrações;
- `/plataforma` contém a gestão master e `/admin?tenant=<slug>` contém a gestão da empresa;
- `/empresa/<slug>` é o site público de cada cliente.

DECISÕES JÁ TOMADAS

- Front-end: Next.js + React + TypeScript.
- Persistência: Cloudflare D1/SQLite com Drizzle ORM.
- Arquitetura: monólito modular multi-tenant.
- Assíncrono: Transactional Outbox, retentativas e idempotência.
- Google: OAuth 2.0 offline; token criptografado em repouso; events.insert com convite ao cliente.
- Pagamento inicial: checkout hospedado por adaptador, sem acoplar o domínio ao provedor.
- Autenticação: interna por e-mail e senha; PBKDF2-HMAC-SHA256; sessão opaca em cookie HttpOnly; sem dependência de ChatGPT/OpenAI ou headers de proxy.
- Autorização: toda operação administrativa valida `user_id` da sessão + membership + tenant_id no servidor.
- Provisionamento: empresa, proprietário, profissional inicial opcional e auditoria são gravados atomicamente.
- Arquivamento: empresas são desativadas logicamente; o histórico é preservado.
- Concorrência: o banco rejeita compromissos sobrepostos somente na mesma agenda e permite simultaneidade entre profissionais.
- Histórico: agendamentos guardam snapshots de duração, buffers e preço.

REGRAS OBRIGATÓRIAS

1. Não remover tenant_id nem confiar em tenant vindo do navegador para autorização.
2. Não colocar tokens, chaves ou segredos no cliente, no Git ou em logs.
3. Não chamar Google, e-mail ou outros serviços dentro da transação do agendamento.
4. Toda operação que possa repetir deve ser idempotente.
5. Preservar confirmação do horário quando o pagamento opcional falhar.
6. Alterações de schema exigem migração Drizzle revisada.
7. Manter adaptadores externos em lib/integrations.
8. Manter o site público simples, rápido, acessível e responsivo.
9. Executar build, testes e verificação visual antes de finalizar.
10. Documentar novas decisões arquiteturais relevantes.
11. Não confundir `tenant_members` (acesso administrativo) com `professionals` (atendimento).
12. Toda consulta de agenda deve filtrar `tenant_id` e `professional_id`; a opção “qualquer profissional” precisa ser resolvida antes da gravação.
13. Operações da plataforma devem validar `platform_admins`; operações da empresa devem validar `tenant_members` ou o modo de suporte master.
14. Nunca converter arquivamento de empresa em exclusão física sem uma política explícita de retenção e confirmação adicional.
15. Nunca reintroduzir autenticação por cabeçalho externo; identidade administrativa deve vir de `users` + `auth_sessions`.
16. Senhas nunca podem ser persistidas ou registradas em texto puro; credenciais temporárias só podem ser exibidas uma vez.

PRÓXIMA ENTREGA

[DESCREVA AQUI A FUNCIONALIDADE A SER IMPLEMENTADA]

Para essa entrega:
- apresente primeiro um plano curto;
- implemente o código completo, sem pseudocódigo;
- atualize banco, APIs, interface e documentação quando necessário;
- crie testes para regras de negócio e casos de concorrência;
- informe ao final o que está pronto, como validar e quais credenciais externas ainda precisam ser configuradas.
```
