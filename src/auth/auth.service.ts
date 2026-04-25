import { BadRequestException, Injectable } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import { IUser } from 'src/users/users.interface';
import { RegisterUserDto } from 'src/users/dto/create-user.dto';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import ms from 'ms';
import { RolesService } from 'src/roles/roles.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private rolesService: RolesService,
  ) {}

  // username /pass sẽ là do thư viện passport trả về
  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.usersService.findOneByUsername(username);
    if (user) {
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
      let user = await this.usersService.findUserByToken(refreshToken);
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
