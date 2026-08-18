# Google Calendar no Agenda Livre

## Modelo de negócio

Existe um único OAuth Client do Google para toda a plataforma. As credenciais globais ficam no ambiente da aplicação. Cada empresa conecta a própria conta Google pelo painel e os tokens ficam no D1 criptografados e associados ao `tenant_id`.

A empresa pode manter uma agenda padrão (`professional_id IS NULL`). Cada profissional pode conectar uma agenda exclusiva. Quando existe conexão profissional ela tem prioridade; caso contrário o sistema usa a agenda padrão da empresa. Se nenhuma conexão existir, o Agenda Livre continua operando somente com a agenda interna.

```text
Plataforma
└── OAuth Client Google (global)
    ├── Empresa A
    │   ├── agenda padrão
    │   ├── Profissional 1 -> agenda própria
    │   └── Profissional 2 -> fallback da empresa
    └── Empresa B
        └── agenda padrão própria
```

## 1. Criar o projeto no Google Cloud

1. Acesse o Google Cloud Console e crie ou selecione o projeto da plataforma.
2. Ative **Google Calendar API**.
3. Em **Google Auth platform > Branding**, configure nome, suporte, domínio, política de privacidade e demais dados exibidos no consentimento.
4. Em **Audience**, escolha o público adequado. Para desenvolvimento externo, mantenha em Testing e cadastre as contas Google utilizadas como Test users.
5. Em **Data Access**, adicione somente estes escopos:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/calendar.events.freebusy`
6. Em **Clients**, crie um OAuth Client do tipo **Web application**.

## 2. Redirect URIs

Cadastre exatamente as URLs usadas pela aplicação.

Desenvolvimento:

```text
http://localhost:5173/api/admin/integrations/google/callback
```

Produção, exemplo:

```text
https://app.seudominio.com/api/admin/integrations/google/callback
```

A URI enviada ao Google deve ser idêntica a uma URI cadastrada no OAuth Client.

## 3. Ambiente local

Preencha `.env` (não versione valores reais):

```env
GOOGLE_CLIENT_ID=seu-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=seu-client-secret
GOOGLE_REDIRECT_URI=http://localhost:5173/api/admin/integrations/google/callback
GOOGLE_AVAILABILITY_FAIL_OPEN=false

INTEGRATION_ENCRYPTION_KEY=BASE64_DE_32_BYTES
OUTBOX_SECRET=SEGREDO_ALEATORIO
```

Gere a chave AES-256:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Gere o segredo da outbox:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Depois reinicie `npm run dev`, pois variáveis de ambiente são lidas no startup.

## 4. Cloudflare em produção

Mantenha segredos no mecanismo de Secrets da Cloudflare. No mínimo:

```text
GOOGLE_CLIENT_SECRET
INTEGRATION_ENCRYPTION_KEY
OUTBOX_SECRET
```

O `GOOGLE_CLIENT_ID` não é uma senha, mas pode permanecer na configuração do ambiente. `GOOGLE_REDIRECT_URI` deve apontar para a URL pública de produção.

Nunca grave refresh tokens no `.env`. Cada autorização de empresa/profissional fica em `integration_connections.encrypted_credentials`, criptografada com AES-GCM pela chave global `INTEGRATION_ENCRYPTION_KEY`.

## 5. Como a empresa conecta

1. Login da empresa.
2. Abra `/admin?tenant=SLUG`.
3. Entre em **Integrações**.
4. Opcionalmente conecte a **Agenda padrão da empresa**.
5. Opcionalmente conecte a agenda exclusiva de cada profissional.
6. Após o consentimento Google, o sistema volta ao painel.
7. Use **Escolher calendário** para trocar `primary` por outro calendário da conta que possua permissão de escrita.
8. **Desconectar** revoga o token no Google quando possível e remove as credenciais locais.

## 6. Prioridade de agenda

Para um agendamento do profissional P:

```text
1. conexão Google do profissional P
2. agenda padrão Google da empresa
3. nenhuma conexão: somente Agenda Livre
```

A mesma prioridade é usada para criação de eventos e para consulta Free/Busy.

## 7. Sincronização de eventos

O agendamento público grava primeiro no D1 e cria um evento `appointment.created` na Transactional Outbox. O endpoint interno processa o evento e cria o compromisso no Google. Isso mantém o agendamento principal independente de uma indisponibilidade temporária do Google.

Quando um agendamento é cancelado no painel, é gerado `appointment.cancelled`. O processador remove o evento correspondente do Google e envia atualização aos convidados.

Eventos do Google possuem `extendedProperties.private.appointmentId`, permitindo relacionar o compromisso externo ao registro interno. O `google_event_id` também é persistido em `appointments`.

## 8. Free/Busy e dupla marcação

Ao consultar os horários públicos, o sistema considera:

```text
Disponibilidade semanal
- agendamentos internos
- bloqueios manuais
- Free/Busy do Google conectado
= horários oferecidos
```

Por padrão `GOOGLE_AVAILABILITY_FAIL_OPEN=false`. Se uma integração já conectada falhar, a consulta retorna indisponibilidade temporária em vez de ignorar o Google e correr risco de dupla marcação.

Se a operação preferir continuidade mesmo com risco de conflito externo:

```env
GOOGLE_AVAILABILITY_FAIL_OPEN=true
```

## 9. Outbox

A integração assíncrona depende de chamadas ao endpoint:

```text
POST /api/internal/outbox
Authorization: Bearer <OUTBOX_SECRET>
```

Em produção configure um agendador/cron para chamar esse endpoint periodicamente. Cada execução processa os eventos pendentes e possui retentativas com backoff.

## 10. Rotas Google

```text
GET    /api/admin/integrations/google/start
GET    /api/admin/integrations/google/callback
GET    /api/admin/integrations/google
PATCH  /api/admin/integrations/google
DELETE /api/admin/integrations/google
GET    /api/admin/integrations/google/calendars
```

Parâmetros principais:

```text
tenant=slug-da-empresa
professionalId=id-do-profissional   # opcional
```

Sem `professionalId`, a conexão representa a agenda padrão da empresa.

## 11. Publicação do OAuth

Durante desenvolvimento, usuários externos precisam estar cadastrados como test users quando o aplicativo estiver em Testing. Antes de disponibilizar o SaaS para clientes reais, mova o OAuth para produção e conclua as exigências de verificação aplicáveis aos escopos solicitados. Aplicativos externos em Testing podem receber refresh tokens com vida curta, inadequados para uso contínuo em produção.

## 12. Segurança aplicada

- OAuth Client global; nenhum segredo por tenant no `.env`.
- `state` OAuth aleatório, persistido apenas como SHA-256 e com validade de 10 minutos.
- callback exige sessão válida e papel de gerente da empresa.
- `refresh_token` criptografado com AES-256-GCM antes de ir ao D1.
- escolha de calendário é validada novamente contra a CalendarList da conta.
- somente calendários com permissão `owner` ou `writer` são oferecidos.
- desconexão limpa credenciais mesmo se o token já tiver sido revogado externamente.
- mutações administrativas usam proteção de origem/CSRF já existente no projeto.
