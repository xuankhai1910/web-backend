import {
	Body,
	Controller,
	Get,
	Post,
	Render,
	Req,
	Res,
	UseGuards,
} from "@nestjs/common";
import { LocalAuthGuard } from "./local-auth.guard";
import { AuthService } from "./auth.service";
import { Public, ResponseMessage, User } from "src/decorators/customize";
import { RegisterUserDto, UserLoginDto } from "src/users/dto/create-user.dto";
import { UsersService } from "src/users/users.service";
import type { Request, Response } from "express";
import type { IUser } from "src/users/users.interface";
import { RolesService } from "src/roles/roles.service";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { ApiBody, ApiTags } from "@nestjs/swagger";

@Controller("auth")
export class AuthController {
	constructor(
		private authService: AuthService,
		private userService: UsersService,
		private rolesService: RolesService,
	) {}

	@Throttle({ default: { limit: 5, ttl: 60000 } })
	@UseGuards(LocalAuthGuard)
	@ResponseMessage("Login successful")
	@Public()
	@ApiBody({ type: UserLoginDto })
	@Post("/login")
	handleLogin(@Req() req, @Res({ passthrough: true }) response: Response) {
		return this.authService.login(req.user, response);
	}

	@Public()
	@Get("/profile")
	getProfile(@Req() req) {
		return req.user;
	}

	@ResponseMessage("User registered successfully")
	@Public()
	@Post("/register")
	async register(@Body() registerUserDto: RegisterUserDto) {
		return this.authService.register(registerUserDto);
	}

	@ResponseMessage("Get user's account successfully")
	@Get("account")
	async handleGetAccount(@User() user: IUser) {
		const temp = (await this.rolesService.findOne(user.role._id)) as any;
		user.permissions = temp.permissions;
		return { user };
	}

	@Public()
	@ResponseMessage("Get user's refresh token successfully")
	@Get("refresh")
	handleRefreshToken(
		@Req() request: Request,
		@Res({ passthrough: true }) response: Response,
	) {
		const refreshToken = request.cookies["refresh_token"];
		return this.authService.processNewToken(refreshToken, response);
	}

	@ResponseMessage("Logged out successfully")
	@Post("logout")
	handleLogout(
		@Res({ passthrough: true }) response: Response,
		@User() user: IUser,
	) {
		return this.authService.logout(user._id.toString(), response);
	}
}
