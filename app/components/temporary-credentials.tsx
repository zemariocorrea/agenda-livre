"use client";

import { useState } from "react";

type Credentials = { email: string; temporaryPassword: string };

export function TemporaryCredentials({ credentials, title = "Acesso criado", onClose, actionLabel, onAction }: {
  credentials: Credentials;
  title?: string;
  onClose: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(`E-mail: ${credentials.email}\nSenha temporária: ${credentials.temporaryPassword}`);
    setCopied(true);
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="credential-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">Credencial temporária</p><h2>{title}</h2></div><button aria-label="Fechar" onClick={onClose} type="button">×</button></div>
      <p>Copie estes dados agora. A senha temporária não será exibida novamente e deverá ser alterada no primeiro acesso.</p>
      <dl className="credential-box"><div><dt>E-mail</dt><dd>{credentials.email}</dd></div><div><dt>Senha temporária</dt><dd><code>{credentials.temporaryPassword}</code></dd></div></dl>
      <div className="modal-actions"><button className="admin-ghost" onClick={copy} type="button">{copied ? "Copiado" : "Copiar acesso"}</button>{onAction && <button className="platform-primary" onClick={onAction} type="button">{actionLabel ?? "Continuar"}</button>}</div>
    </section>
  </div>;
}
