import { Inject, Injectable } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";

@Injectable()
export class OtpEmailAdapter {
  private transporter: Transporter | null | undefined;

  constructor(@Inject(RuntimeLogger) private readonly logger: RuntimeLogger) {}

  private getTransporter(): Transporter | null {
    if (this.transporter !== undefined) return this.transporter;
    const { SMTP_HOST: host, SMTP_PORT: port, SMTP_USER: user, SMTP_PASS: pass } = process.env;
    if (!host || !port || !user || !pass) {
      this.transporter = null;
      return null;
    }
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass },
    });
    return this.transporter;
  }

  async send(to: string, code: string): Promise<void> {
    const transporter = this.getTransporter();
    if (transporter === null) {
      this.logger.info({ event: "auth.otp.email.skipped", reason: "smtp_not_configured" }, "OTP email skipped");
      return;
    }
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
        to,
        subject: "Код входа — 3mf.tech",
        text: `Код для входа на 3mf.tech: ${code}\n\nДействителен 10 минут. Если это были не вы — просто проигнорируйте письмо.`,
      });
    } catch {
      this.logger.error({ event: "auth.otp.email.failed" }, "OTP email delivery failed");
    }
  }
}
