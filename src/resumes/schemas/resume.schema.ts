import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { HydratedDocument } from "mongoose";
import { Company } from "src/companies/schemas/company.schema";
import { Job } from "src/jobs/schemas/job.schema";

export type ResumeDocument = HydratedDocument<Resume>;

@Schema({ timestamps: true })
export class Resume {
	@Prop({ required: true })
	email: string;

	@Prop()
	userId: mongoose.Schema.Types.ObjectId;

	@Prop()
	url: string;

	@Prop()
	status: string;

	@Prop({ type: mongoose.Schema.Types.ObjectId, ref: Company.name })
	companyId: mongoose.Schema.Types.ObjectId;

	@Prop({ type: mongoose.Schema.Types.ObjectId, ref: Job.name })
	jobId: mongoose.Schema.Types.ObjectId;

	@Prop({ type: mongoose.Schema.Types.Array })
	history: {
		status: string;
		updatedAt: Date;
		updatedBy: {
			_id: mongoose.Schema.Types.ObjectId;
			email: string;
		};
	}[];

	// Kết quả chấm độ phù hợp giữa CV của ứng viên và tin tuyển dụng đã ứng
	// tuyển. Được HR tính theo yêu cầu (nút "Phân tích") qua CvAnalysisService;
	// lưu lại để danh sách có thể xếp hạng/lọc mà không phải tính lại.
	@Prop({ type: Object })
	match: {
		score: number; // 0..1
		matchedSkills: string[];
		breakdown: {
			skillScore: number;
			titleScore: number;
			desiredTitleScore: number;
			specializationScore: number;
			levelScore: number;
			locationScore: number;
			vectorScore: number;
		};
		analyzedBy: string; // 'ai' | 'keyword'
		analyzedAt: Date;
		jobId: mongoose.Schema.Types.ObjectId; // = jobId tại thời điểm phân tích
	};

	@Prop()
	createdAt: Date;

	@Prop()
	updatedAt: Date;

	@Prop({ type: Object })
	createdBy: {
		_id: mongoose.Schema.Types.ObjectId;
		email: string;
	};

	@Prop({ type: Object })
	updatedBy: {
		_id: mongoose.Schema.Types.ObjectId;
		email: string;
	};

	@Prop({ type: Object })
	deletedBy: {
		_id: mongoose.Schema.Types.ObjectId;
		email: string;
	};
}

export const ResumeSchema = SchemaFactory.createForClass(Resume);

// Hỗ trợ HR sắp xếp danh sách hồ sơ của công ty theo độ phù hợp (sort=-match.score).
ResumeSchema.index({ companyId: 1, "match.score": -1 });
