# Autenticação interna do Agenda Livre

## Objetivo

O sistema usa identidade própria por e-mail e senha. Não depende de ChatGPT, OpenAI, cabeçalhos injetados por proxy ou OAuth para autenticar administradores.

## Modelo

- `users`: identidade, hash de senha, status, bloqueio e dados de último acesso;
- `auth_sessions`: sessões opacas; o banco armazena apenas o hash do token;
- `platform_admins`: autorização de Admin Master vinculada por `user_id`;
- `tenant_members`: autorização dentro de uma empresa vinculada por `user_id`;
- `professionals`: entidade operacional separada da conta de acesso.

Uma mesma identidade pode pertencer a mais de uma empresa. O contexto de tenant é sempre validado no servidor a partir da sessão e do vínculo ativo.

## Senhas

`lib/auth/password.ts` usa PBKDF2-HMAC-SHA256 via Web Crypto, com 600.000 iterações, salt aleatório individual e hash de 256 bits. Senhas novas precisam ter de 12 a 128 caracteres.

O formato persistido é versionável:

```text
pbkdf2_sha256$600000$<salt-base64url>$<hash-base64url>
```

## Sessões

Após autenticação correta é gerado um token aleatório de 256 bits. O token em claro existe somente no cookie; `auth_sessions.token_hash` recebe SHA-256 do token.

O cookie é:

- `HttpOnly`;
- `SameSite=Lax`;
- `Secure` em produção;
- `Path=/`;
- expira após oito horas.

Em produção o nome usa o prefixo `__Host-`. Em desenvolvimento é usado um nome sem esse prefixo, pois HTTP local não aceita cookie `Secure`.

## Proteção contra abuso

- mensagem de falha de login é genérica;
- usuário inexistente executa uma verificação PBKDF2 fictícia para reduzir enumeração por tempo;
- cinco falhas consecutivas bloqueiam temporariamente a conta por 15 minutos;
- login, logout, troca de senha e provisionamento validam origem para mutações sensíveis;
- primeira senha criada administrativamente é temporária e força troca;
- troca de senha revoga as sessões existentes e cria uma nova;
- logout invalida a sessão no banco, não apenas o cookie.

## Bootstrap do primeiro Admin Master

1. Aplique as migrações:

```bash
npm run db:migrate:local
```

2. Crie a identidade master localmente:

```bash
AGENDA_BOOTSTRAP_EMAIL=admin@seudominio.com \
AGENDA_BOOTSTRAP_NAME="Administrador Master" \
AGENDA_BOOTSTRAP_PASSWORD="uma-senha-forte" \
npm run auth:bootstrap
```

3. Para D1 remoto, use:

```bash
npm run auth:bootstrap -- --remote --database NOME_DO_D1 --email admin@seudominio.com --name "Administrador Master" --password "uma-senha-forte"
```

Depois, acesse `/login`.

## Fluxo de criação de empresa

O Admin Master cria a empresa e informa o proprietário. Se o e-mail ainda não existir em `users`, o servidor cria uma identidade e retorna uma senha temporária uma única vez. Se já existir, somente cria o novo vínculo de tenant; a senha existente não é alterada.

O mesmo comportamento vale para novos membros criados no painel da empresa.

## Regras de autorização

- `/plataforma`: exige vínculo ativo em `platform_admins`;
- `/admin?tenant=<slug>`: exige vínculo ativo em `tenant_members`, salvo acesso de suporte do Admin Master;
- APIs administrativas repetem a checagem no servidor;
- dados enviados pelo cliente nunca definem autorização de tenant;
- `owner` não pode ser removido ou rebaixado por uma edição comum.

## Evoluções recomendadas antes de escala pública

- aplicar rate limit por IP/ASN no Cloudflare para `/api/auth/login`;
- MFA para Admin Master e, opcionalmente, proprietários;
- fluxo de recuperação de senha com token curto, de uso único e expiração;
- auditoria explícita de login, falha, bloqueio e troca de senha;
- política de revogação administrativa de todas as sessões do usuário.
