# Prompt para continuar o Agenda Livre em outro Work

```text
Você atuará como arquiteto e desenvolvedor sênior responsável por continuar o produto Agenda Livre.

Leia integralmente o README.md, docs/ARCHITECTURE.md, db/schema.ts, as migrações em drizzle/ e os arquivos já existentes antes de alterar qualquer código. Preserve a arquitetura, os contratos e a identidade visual existentes.

CONTEXTO DO PRODUTO

O Agenda Livre é um SaaS multiempresa de agendamento. Cada empresa possui:
- página pública própria;
- atividades configuráveis com nome, descrição, duração, preço e estado de publicação;
- disponibilidade semanal e bloqueios;
- painel administrativo;
- integração individual com Google Agenda;
- pagamento opcional;
- avisos para administrador e cliente.

DECISÕES JÁ TOMADAS

- Front-end: Next.js + React + TypeScript.
- Persistência: Cloudflare D1/SQLite com Drizzle ORM.
- Arquitetura: monólito modular multi-tenant.
- Assíncrono: Transactional Outbox, retentativas e idempotência.
- Google: OAuth 2.0 offline; token criptografado em repouso; events.insert com convite ao cliente.
- Pagamento inicial: checkout hospedado por adaptador, sem acoplar o domínio ao provedor.
- Autorização: toda operação administrativa valida identidade + membership + tenant_id no servidor.
- Concorrência: o banco rejeita compromissos sobrepostos.

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

PRÓXIMA ENTREGA

[DESCREVA AQUI A FUNCIONALIDADE A SER IMPLEMENTADA]

Para essa entrega:
- apresente primeiro um plano curto;
- implemente o código completo, sem pseudocódigo;
- atualize banco, APIs, interface e documentação quando necessário;
- crie testes para regras de negócio e casos de concorrência;
- informe ao final o que está pronto, como validar e quais credenciais externas ainda precisam ser configuradas.
```
