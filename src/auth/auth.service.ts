import { Injectable } from "@nestjs/common";
import { UsersService } from "src/users/users.service";
import { JwtService } from "@nestjs/jwt";

@Injectable()
export class AuthService {
	constructor(
		private usersService: UsersService,
		private jwtService: JwtService,
	) {}

	// username /pass sẽ là do thư viện passport trả về
	async validateUser(username: string, pass: string): Promise<any> {
		const user = await this.usersService.findOneByUsername(username);
		if (user) {
			const isValid = this.usersService.isValidPassword(pass, user.password);
			if (isValid) {
				return user;
			}
		}
		// if (user && user.password === pass) {
		// 	const { password, ...result } = user;
		// 	return result;
		// }
		return null;
	}

	async login(user: any) {
		const payload = { username: user.email, sub: user._id };
		return {
			access_token: this.jwtService.sign(payload),
		};
	}
}
