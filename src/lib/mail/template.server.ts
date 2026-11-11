const COPY = {
  reset: {
    title: "Новый пароль",
    lead: "Вы просили сменить пароль на vvvion.space. Введите этот код на странице входа. Никому его не пересылайте.",
  },
  confirm: {
    title: "Подтверждение почты",
    lead: "Подтвердите, что этот адрес ваш. Код вводится в профиле. Без подтверждения нельзя сменить пароль и открыть подписку.",
  },
  change: {
    title: "Новая почта",
    lead: "Кто-то хочет привязать этот адрес к аккаунту VVVION. Если это вы, введите код в профиле. Если нет — письмо можно удалить.",
  },
} as const;

export type MailPurpose = keyof typeof COPY;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&" + "amp;")
    .replaceAll("<", "&" + "lt;")
    .replaceAll(">", "&" + "gt;")
    .replaceAll('"', "&" + "quot;")
    .replaceAll("'", "&" + "#39;");
}

function pretty(code: string) {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export function mailSubject(purpose: MailPurpose) {
  return `VVVION — ${COPY[purpose].title}`;
}

export function mailText(purpose: MailPurpose, code: string) {
  const copy = COPY[purpose];
  return `${copy.title}\n\n${copy.lead}\n\nКод: ${pretty(code)}\n\nКод действует 15 минут.\nhttps://vvvion.space`;
}

export function mailHtml(purpose: MailPurpose, code: string) {
  const copy = COPY[purpose];
  const title = escapeHtml(copy.title);
  const lead = escapeHtml(copy.lead);
  const shown = escapeHtml(pretty(code));
  return `<!doctype html>
<html lang="ru">
<body style="margin:0;padding:0;background:#0c0c0e;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0c0c0e;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141417;border:1px solid #2e2e34;border-radius:28px;">
          <tr>
            <td style="padding:28px 28px 0;font-family:Georgia,'Times New Roman',serif;font-size:13px;letter-spacing:0.28em;color:#c4b5e8;">VVVION SPACE</td>
          </tr>
          <tr>
            <td style="padding:10px 28px 0;font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:1.15;color:#f4f2ee;">${title}</td>
          </tr>
          <tr>
            <td style="padding:14px 28px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#b0ada6;">${lead}</td>
          </tr>
          <tr>
            <td align="center" style="padding:22px 28px 8px;">
              <div style="display:inline-block;background:#c4b5e8;color:#1b1526;border-radius:18px;padding:16px 22px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;letter-spacing:0.28em;font-weight:700;">${shown}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;line-height:1.5;color:#8a877f;">
              Код действует 15 минут. Если вы не просили это письмо, ничего делать не нужно.<br>
              <a href="https://vvvion.space" style="color:#c4b5e8;text-decoration:none;">vvvion.space</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
