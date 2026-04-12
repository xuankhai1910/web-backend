import { BadRequestException, Injectable } from "@nestjs/common";
import { CreateSubscriberDto } from "./dto/create-subscriber.dto";
import { UpdateSubscriberDto } from "./dto/update-subscriber.dto";
import { InjectModel } from "@nestjs/mongoose";
import { Subscriber, SubscriberDocument } from "./schemas/subscriber.schema";
import type { SoftDeleteModel } from "mongoose-delete";
import { IUser } from "src/users/users.interface";
import aqp from "api-query-params";
import mongoose from "mongoose";

@Injectable()
export class SubscribersService {
	constructor(
		@InjectModel(Subscriber.name)
		private subscriberModel: SoftDeleteModel<SubscriberDocument>,
	) {}

	async create(createSubscriberDto: CreateSubscriberDto, user: IUser) {
		const { name, email, skills } = createSubscriberDto;
		const isExist = await this.subscriberModel.findOne({ email });
		if (isExist) {
			throw new BadRequestException(`Email: ${email} already exists`);
		}
		const subscriber = await this.subscriberModel.create({
			name,
			email,
			skills,
			createdBy: { _id: user._id, email: user.email },
		});
		return {
			_id: subscriber._id,
			createdBy: subscriber?.createdBy,
		};
	}

	async findAll(currentPage: number, limit: number, qs: string) {
		const { filter, sort, projection, population } = aqp(qs);
		delete filter.current;
		delete filter.pageSize;
		let offset = (+currentPage - 1) * +limit;
		let defaultLimit = +limit ? +limit : 10;

		const totalItems = (await this.subscriberModel.find(filter)).length;
		const totalPages = Math.ceil(totalItems / defaultLimit);

		const result = await this.subscriberModel
			.find(filter)
			.skip(offset)
			.limit(defaultLimit)
			.sort(sort as any)
			.populate(population)
			.exec();

		return {
			meta: {
				current: currentPage, //trang hiện tại
				pageSize: limit, //số lượng bản ghi đã lấy
				pages: totalPages, //tổng số trang với điều kiện query
				total: totalItems, // tổng số phần tử (số bản ghi)
			},
			result, //kết quả query
		};
	}

	async findOne(id: string) {
		if (!mongoose.Types.ObjectId.isValid(id)) {
			throw new BadRequestException("Invalid subscriber id");
		}
		return await this.subscriberModel.findById(id);
	}

	async update(
		id: string,
		updateSubscriberDto: UpdateSubscriberDto,
		user: IUser,
	) {
		if (!mongoose.Types.ObjectId.isValid(id)) {
			throw new BadRequestException("Invalid subscriber id");
		}
		const { name, email, skills } = updateSubscriberDto;
		const updated = await this.subscriberModel.updateOne(
			{ _id: id },
			{
				name,
				email,
				skills,
				updatedBy: { _id: user._id, email: user.email },
			},
		);
		return updated;
	}

	async remove(id: string, user: IUser) {
		if (!mongoose.Types.ObjectId.isValid(id)) {
			throw new BadRequestException("Invalid subscriber id");
		}
		await this.subscriberModel.updateOne(
			{ _id: id },
			{
				deletedBy: { _id: user._id, email: user.email },
			},
		);
		return await this.subscriberModel.delete({ _id: id });
	}
}
