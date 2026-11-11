import nodemailer from "nodemailer";
import { env } from "@/lib/env.server";

const PORTS: { port: number; secure: boolean }[] = [
  { port: 465, secure: true },
  { port: 2465, secure: true },
  { port: 587, secure: false },
  { port: 2587, secure: false },
];

function password() {
  return env("RESEND_API_KEY") || "";
}

function fromAddress() {
  return env("EMAIL_FROM") || "VVVION SPACE <no-reply@vvvion.space>";
}

function friendly(err: unknown): Error {
  const raw = err instanceof Error ? err.message : "";
  if (/testing email|verify a domain|not verified|invalid `to` field/i.test(raw)) {
    console.error("mail rejected: sending domain is not accepted for this recipient");
  } else if (raw) {
    console.error("mail send failed");
  }
  return new Error("Письмо не ушло. Попробуйте ещё раз через минуту.");
}

export async function sendMail(input: { to: string; subject: string; text: string; html: string }) {
  let last: unknown = null;
  for (const target of PORTS) {
    const transport = nodemailer.createTransport({
      host: "smtp.resend.com",
      port: target.port,
      secure: target.secure,
      auth: { user: "resend", pass: password() },
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 12_000,
    });
    try {
      await transport.sendMail({
        from: fromAddress(),
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      return;
    } catch (err) {
      last = err;
      const message = err instanceof Error ? err.message : "";
      if (/testing email|verify a domain|not verified|invalid `to` field/i.test(message)) throw friendly(err);
    }
  }
  throw friendly(last);
}
