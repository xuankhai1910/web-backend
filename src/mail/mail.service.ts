import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  constructor(
    private mailerService: MailerService,
    private configService: ConfigService,
  ) {}

  async sendPasswordResetEmail({
    to,
    receiver,
    resetUrl,
  }: {
    to: string;
    receiver: string;
    resetUrl: string;
  }) {
    const authUser = this.configService.get<string>('EMAIL_AUTH_USER');

    return this.mailerService.sendMail({
      to,
      from: authUser
        ? `"DevMarket" <${authUser}>`
        : '"DevMarket" <support@example.com>',
      subject: 'Đặt lại mật khẩu DevMarket',
      template: 'password-reset',
      context: {
        receiver,
        resetUrl,
        expiresIn: '15 phút',
      },
    });
  }
}
