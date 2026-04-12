import { Module } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { UsersModule } from "src/users/users.module";
import { PassportModule } from "@nestjs/passport";
import { LocalStrategy } from "./passport/local.strategy";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtStrategy } from "./passport/jwt.strategy";
import { AuthController } from "./auth.controller";
import { UsersService } from "src/users/users.service";
import { RolesModule } from "src/roles/roles.module";

@Module({
	imports: [
		UsersModule,
		PassportModule,
		RolesModule,

		JwtModule.registerAsync({
			imports: [ConfigModule],
			useFactory: async (configService: ConfigService) => ({
				secret: configService.get<string>("JWT_ACCESS_TOKEN_SECRET"),
				signOptions: {
					expiresIn: configService.get<string>("JWT_ACCESS_EXPIRE") as any,
				},
			}),
			inject: [ConfigService],
		}),
	],
	providers: [AuthService, LocalStrategy, JwtStrategy],
	exports: [AuthService, JwtModule],
	controllers: [AuthController],
})
export class AuthModule {}
