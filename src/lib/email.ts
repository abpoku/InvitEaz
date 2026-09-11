import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null | undefined;

function getTransporter() {
  if (transporter !== undefined) return transporter;

  if (process.env.SMTP_HOST && process.env.SMTP_PORT) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  } else {
    transporter = null; // no SMTP configured — fall back to console logging
  }
  return transporter;
}

export async function sendEmail(input: { to: string; subject: string; html: string; text?: string }) {
  const t = getTransporter();
  const from = process.env.EMAIL_FROM || "InvitEaz <notifications@inviteaz.app>";

  if (!t) {
    // Dev / no-SMTP fallback: log so the flow is still fully testable end to end.
    // eslint-disable-next-line no-console
    console.log(`\n--- 📧 EMAIL (no SMTP configured, logging only) ---\nTo: ${input.to}\nSubject: ${input.subject}\n\n${input.text || input.html.replace(/<[^>]+>/g, " ")}\n--- end email ---\n`);
    return { delivered: false, logged: true };
  }

  await t.sendMail({ from, to: input.to, subject: input.subject, html: input.html, text: input.text });
  return { delivered: true, logged: false };
}

export function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}
