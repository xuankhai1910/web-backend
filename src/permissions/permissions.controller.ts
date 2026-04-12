import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	Delete,
	Query,
} from "@nestjs/common";
import { PermissionsService } from "./permissions.service";
import { CreatePermissionDto } from "./dto/create-permission.dto";
import { UpdatePermissionDto } from "./dto/update-permission.dto";
import { ResponseMessage, User } from "src/decorators/customize";
import type { IUser } from "src/users/users.interface";

@Controller("permissions")
export class PermissionsController {
	constructor(private readonly permissionsService: PermissionsService) {}

	@ResponseMessage("Create permission success")
	@Post()
	create(
		@Body() createPermissionDto: CreatePermissionDto,
		@User() user: IUser,
	) {
		return this.permissionsService.create(createPermissionDto, user);
	}

	@ResponseMessage("Get all permissions success")
	@Get()
	findAll(
		@Query("current") currentPage: string,
		@Query("pageSize") limit: string,
		@Query() qs: string,
	) {
		return this.permissionsService.findAll(+currentPage, +limit, qs);
	}

	@ResponseMessage("Get permission success")
	@Get(":id")
	findOne(@Param("id") id: string) {
		return this.permissionsService.findOne(id);
	}

	@ResponseMessage("Update permission success")
	@Patch(":id")
	update(
		@Param("id") id: string,
		@Body() updatePermissionDto: UpdatePermissionDto,
		@User() user: IUser,
	) {
		return this.permissionsService.update(id, updatePermissionDto, user);
	}

	@ResponseMessage("Delete permission success")
	@Delete(":id")
	remove(@Param("id") id: string, @User() user: IUser) {
		return this.permissionsService.remove(id, user);
	}
}
