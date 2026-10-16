// Envío de correos (recuperación de contraseña) mediante la API de Resend (https://resend.com).
// Requiere RESEND_API_KEY, MAIL_FROM y APP_URL. Sin ellas, la recuperación por correo queda
// desactivada y el panel lo indica; la contraseña se puede restablecer con el script del servidor.

export function createMailer(env = process.env, fetchImpl = globalThis.fetch) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM;
  const appUrl = (env.APP_URL || '').replace(/\/+$/, '');
  const configured = !!(apiKey && from && appUrl);
  return {
    configured,
    appUrl,
    async send({ to, subject, text }) {
      if (!configured) throw new Error('El envío de correos no está configurado.');
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`El servicio de correo respondió ${res.status}.`);
    },
  };
}
