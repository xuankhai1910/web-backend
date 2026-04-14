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
import { SubscribersService } from "./subscribers.service";
import { CreateSubscriberDto } from "./dto/create-subscriber.dto";
import { UpdateSubscriberDto } from "./dto/update-subscriber.dto";
import {
	ResponseMessage,
	SkipCheckPermission,
	User,
} from "src/decorators/customize";
import type { IUser } from "src/users/users.interface";

@Controller("subscribers")
export class SubscribersController {
	constructor(private readonly subscribersService: SubscribersService) {}

	@ResponseMessage("Create subscriber success")
	@Post()
	create(
		@Body() createSubscriberDto: CreateSubscriberDto,
		@User() user: IUser,
	) {
		return this.subscribersService.create(createSubscriberDto, user);
	}

	@Post("skills")
	@ResponseMessage("Get subscriber's skills")
	@SkipCheckPermission()
	getSkills(@User() user: IUser) {
		return this.subscribersService.getSkills(user);
	}

	@Get()
	findAll(
		@Query("current") currentPage: string,
		@Query("pageSize") limit: string,
		@Query() qs: string,
	) {
		return this.subscribersService.findAll(+currentPage, +limit, qs);
	}

	@Get(":id")
	findOne(@Param("id") id: string) {
		return this.subscribersService.findOne(id);
	}

	@SkipCheckPermission()
	@ResponseMessage("Update subscriber success")
	@Patch()
	update(
		@Body() updateSubscriberDto: UpdateSubscriberDto,
		@User() user: IUser,
	) {
		return this.subscribersService.update(updateSubscriberDto, user);
	}

	@ResponseMessage("Delete subscriber success")
	@Delete(":id")
	remove(@Param("id") id: string, @User() user: IUser) {
		return this.subscribersService.remove(id, user);
	}
}
