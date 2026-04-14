import { NestFactory, Reflector } from "@nestjs/core";
import { AppModule } from "./app.module";
import { join } from "path";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ConfigService } from "@nestjs/config";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { TransformInterceptor } from "./core/transform.interceptor";
import cookieParser from "cookie-parser";
import helmet from "helmet";

async function bootstrap() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule);
	app.set("trust proxy", 1);
	const configService = app.get(ConfigService);

	const reflector = app.get(Reflector);
	app.useGlobalGuards(new JwtAuthGuard(reflector));
	app.useGlobalInterceptors(new TransformInterceptor(reflector));

	app.useStaticAssets(join(__dirname, "..", "public"));
	app.setBaseViewsDir(join(__dirname, "..", "views"));
	app.setViewEngine("ejs");

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
		}),
	);

	//config cookie parser
	app.use(cookieParser());

	const port = Number(configService.get<string>("PORT")) || 3000;
	app.enableCors({
		origin: true,
		methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
		preflightContinue: false,
		credentials: true,
	});

	//Config versioning
	app.setGlobalPrefix("api");
	app.enableVersioning({
		type: VersioningType.URI,
		defaultVersion: ["1", "2"],
	});

	//Config helmet
	app.use(helmet());
	await app.listen(port);
}
bootstrap();
