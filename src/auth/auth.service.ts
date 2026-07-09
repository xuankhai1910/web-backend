import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import { IUser } from 'src/users/users.interface';
import { RegisterUserDto } from 'src/users/dto/create-user.dto';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import ms from 'ms';
import { RolesService } from 'src/roles/roles.service';
import { createHash, randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { MailService } from 'src/mail/mail.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/password.dto';

const RESET_PASSWORD_TOKEN_TTL_MS = 15 * 60 * 1000;
const RESET_PASSWORD_RESPONSE =
  'Nếu email tồn tại trong hệ thống, chúng tôi đã gửi liên kết đặt lại mật khẩu';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private rolesService: RolesService,
    private mailService: MailService,
  ) {}

  // username /pass sẽ là do thư viện passport trả về
  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.usersService.findOneByUsername(username);
    if (user) {
      // Tài khoản tạo qua Google không có mật khẩu local
      if (!user.password) {
        throw new BadRequestException(
          'Tài khoản này sử dụng đăng nhập với Google',
        );
      }
      const isValid = this.usersService.isValidPassword(pass, user.password);
      if (isValid) {
        const userRole = user.role as unknown as { _id: string; name: string };
        const temp = await this.rolesService.findOne(userRole._id);

        const objUser = {
          ...user.toObject(),
          permissions: temp?.permissions ?? [],
        };
        return objUser;
      }
    }
    // if (user && user.password === pass) {
    // 	const { password, ...result } = user;
    // 	return result;
    // }
    return null;
  }

  async login(user: IUser, response: Response) {
    const { _id, name, email, role, permissions, company } = user;
    const payload = {
      sub: 'token login',
      iss: 'from server',
      _id,
      name,
      email,
      role,
      company,
    };
    const refresh_token = this.createRefreshToken(payload);

    //update user with refresh token
    await this.usersService.updateUserToken(refresh_token, _id.toString());

    //Set refresh token in cookies
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    response.cookie('refresh_token', refresh_token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: Number(
        ms(this.configService.get<string>('JWT_REFRESH_EXPIRE') as any),
      ),
    });

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        _id,
        name,
        email,
        role,
        company,
        permissions,
      },
    };
  }

  async register(registerUserDto: RegisterUserDto) {
    return this.usersService.register(registerUserDto);
  }

  // Đăng nhập với Google: verify ID token rồi tái dùng login() để cấp token + cookie.
  async loginWithGoogle(idToken: string, response: Response) {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      throw new BadRequestException('Google OAuth chưa được cấu hình');
    }

    let payload: import('google-auth-library').TokenPayload | undefined;
    try {
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({
        idToken,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch (error) {
      throw new BadRequestException('Google token không hợp lệ');
    }

    if (!payload?.email || payload.email_verified !== true) {
      throw new BadRequestException('Email Google chưa được xác thực');
    }

    const user = await this.usersService.findOrCreateGoogleUser({
      email: payload.email,
      name: payload.name || payload.email,
      googleId: payload.sub,
      avatar: payload.picture,
    });

    return this.login(user as unknown as IUser, response);
  }

  async changePassword(user: IUser, dto: ChangePasswordDto) {
    this.assertPasswordConfirmation(dto.newPassword, dto.confirmPassword);

    const foundUser = await this.usersService.findByIdWithPassword(
      user._id.toString(),
    );
    if (!foundUser) {
      throw new BadRequestException('Tài khoản không tồn tại');
    }

    if (!foundUser.password) {
      throw new BadRequestException(
        'Tài khoản đăng nhập bằng Google không thể đổi mật khẩu',
      );
    }

    const isCurrentPasswordValid = this.usersService.isValidPassword(
      dto.currentPassword,
      foundUser.password,
    );
    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Mật khẩu hiện tại không đúng');
    }

    await this.usersService.updatePassword(
      foundUser._id.toString(),
      dto.newPassword,
    );

    return { success: true };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim();
    const user = await this.usersService.findOneByEmail(email);

    if (!user) {
      return { message: RESET_PASSWORD_RESPONSE };
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(token);
    const expiresAt = new Date(Date.now() + RESET_PASSWORD_TOKEN_TTL_MS);

    await this.usersService.setPasswordResetToken(
      user._id.toString(),
      tokenHash,
      expiresAt,
    );

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const resetUrl = `${frontendUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;

    try {
      await this.mailService.sendPasswordResetEmail({
        to: user.email,
        receiver: user.name || user.email,
        resetUrl,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${user.email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return { message: RESET_PASSWORD_RESPONSE };
  }

  async resetPassword(dto: ResetPasswordDto) {
    this.assertPasswordConfirmation(dto.newPassword, dto.confirmPassword);

    const tokenHash = this.hashResetToken(dto.token);
    const user =
      await this.usersService.findUserByPasswordResetToken(tokenHash);

    if (!user) {
      throw new BadRequestException(
        'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
      );
    }

    await this.usersService.updatePassword(
      user._id.toString(),
      dto.newPassword,
      {
        clearRefreshToken: true,
      },
    );

    return { success: true };
  }

  private assertPasswordConfirmation(
    password: string,
    confirmPassword: string,
  ) {
    if (password !== confirmPassword) {
      throw new BadRequestException('Xác nhận mật khẩu không khớp');
    }
  }

  private hashResetToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  createRefreshToken = (payload: any) => {
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_TOKEN_SECRET'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRE') as any,
    });
    return refreshToken;
  };

  processNewToken = async (refreshToken: string, response: Response) => {
    try {
      this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_TOKEN_SECRET'),
      });
      const user = await this.usersService.findUserByToken(refreshToken);
      if (user) {
        //Update refresh_token
        const { _id, name, email, role, company } = user;
        const payload = {
          sub: 'token refresh',
          iss: 'from server',
          _id,
          name,
          email,
          role,
          company,
        };
        const refresh_token = this.createRefreshToken(payload);

        //update user with refresh token
        await this.usersService.updateUserToken(refresh_token, _id.toString());

        // fetch user role
        const userRole = user.role as unknown as { _id: string; name: string };
        const temp = await this.rolesService.findOne(userRole._id);

        //Set refresh token in cookies
        const isProd =
          this.configService.get<string>('NODE_ENV') === 'production';
        response.clearCookie('refresh_token');

        response.cookie('refresh_token', refresh_token, {
          httpOnly: true,
          secure: isProd,
          sameSite: isProd ? 'none' : 'lax',
          maxAge: Number(
            ms(this.configService.get<string>('JWT_REFRESH_EXPIRE') as any),
          ),
        });

        return {
          access_token: this.jwtService.sign(payload),
          user: {
            _id,
            name,
            email,
            role,
            company,
            permissions: temp?.permissions ?? [],
          },
        };
      } else {
        throw new BadRequestException(
          'Refresh token không hợp lệ, vui lòng đăng nhập lại',
        );
      }
    } catch (error) {
      throw new BadRequestException(
        'Refresh token không hợp lệ, vui lòng đăng nhập lại',
      );
    }
  };

  logout = async (userId: string, response: Response) => {
    //Xóa refresh token trong database
    await this.usersService.updateUserToken('', userId);
    response.clearCookie('refresh_token');
    return 'oke';
  };
}
