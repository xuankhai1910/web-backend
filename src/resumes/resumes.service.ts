import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateUserCvDto } from './dto/create-resume.dto';
import type { IUser } from 'src/users/users.interface';
import { InjectModel } from '@nestjs/mongoose';
import { Resume, ResumeDocument } from './schemas/resume.schema';
import type { SoftDeleteModel } from 'mongoose-delete';
import mongoose from 'mongoose';
import aqp from 'api-query-params';
import { NotificationsService } from 'src/notifications/notifications.service';

const ALLOWED_STATUSES = [
  'PENDING',
  'REVIEWING',
  'APPROVED',
  'REJECTED',
] as const;
export type ResumeStatus = (typeof ALLOWED_STATUSES)[number];

@Injectable()
export class ResumesService {
  private readonly logger = new Logger(ResumesService.name);

  constructor(
    @InjectModel(Resume.name)
    private resumeModel: SoftDeleteModel<ResumeDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── ACCESS HELPERS ───────────────────────────────────────

  private isAdmin(user: IUser): boolean {
    const roleName = user?.role?.name?.toUpperCase();
    return roleName === 'SUPER_ADMIN' || roleName === 'ADMIN';
  }

  /**
   * Scope a Mongo filter to resources the user is allowed to see:
   *  - admin: no extra filter
   *  - HR (has company): resumes of their company
   *  - normal user: resumes they own
   */
  private scopeFilter(user: IUser): Record<string, unknown> {
    if (this.isAdmin(user)) return {};
    if (user?.company?._id) return { companyId: user.company._id };
    return { userId: user._id };
  }

  /** Reject obvious path-traversal / absolute paths in client-provided URLs. */
  private assertSafeUrl(url: string): void {
    if (
      !url ||
      typeof url !== 'string' ||
      url.includes('..') ||
      url.startsWith('/') ||
      url.startsWith('\\') ||
      /^[a-zA-Z]:[\\/]/.test(url)
    ) {
      throw new BadRequestException('URL CV không hợp lệ');
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────

  async create(createUserCvDto: CreateUserCvDto, user: IUser) {
    const { url, companyId, jobId } = createUserCvDto;
    const { email, _id } = user;

    this.assertSafeUrl(url);

    // Prevent reusing a CV URL that already belongs to a different user.
    const conflict = await this.resumeModel.findOne({
      url,
      userId: { $ne: _id },
    });
    if (conflict) {
      throw new ForbiddenException('Bạn không có quyền sử dụng URL CV này');
    }

    const newCV = await this.resumeModel.create({
      url,
      companyId,
      email,
      jobId,
      userId: _id,
      status: 'PENDING',
      createdBy: { _id, email },
      history: [
        {
          status: 'PENDING',
          updatedAt: new Date(),
          updatedBy: { _id: user._id, email: user.email },
        },
      ],
    });

    // Best-effort: tạo noti cho ứng viên + fan-out HR công ty.
    // Không await để không làm chậm response API; service nội bộ đã try/catch.
    void this.notificationsService.notifyResumeSubmitted({
      resumeId: newCV._id,
      jobId,
      companyId,
      actor: user,
    });

    return {
      _id: newCV._id,
      createdAt: newCV.createdAt,
    };
  }

  async findAll(currentPage: number, limit: number, qs: string, user: IUser) {
    const { filter, sort, projection, population } = aqp(qs);
    delete filter.current;
    delete filter.pageSize;

    // Always merge access scope LAST so client-supplied query params
    // cannot widen visibility beyond what the role permits.
    Object.assign(filter, this.scopeFilter(user));

    let offset = (+currentPage - 1) * +limit;
    let defaultLimit = +limit ? +limit : 10;

    const collation = { locale: 'vi', strength: 1 };

    const totalItems = await this.resumeModel
      .countDocuments(filter)
      .collation(collation);
    const totalPages = Math.ceil(totalItems / defaultLimit);

    const result = await this.resumeModel
      .find(filter)
      .collation(collation)
      .skip(offset)
      .limit(defaultLimit)
      .sort(sort as any)
      .populate(population)
      .select(projection as any)
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

  async findOne(id: string, user: IUser) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('cannot find resume with id: ' + id);
    }
    const resume = await this.resumeModel.findOne({
      _id: id,
      ...this.scopeFilter(user),
    });
    if (!resume) {
      throw new NotFoundException('Không tìm thấy CV hoặc không có quyền xem');
    }
    return resume;
  }

  async findByUsers(user: IUser) {
    return await this.resumeModel
      .find({ userId: user._id })
      .sort('-createdAt')
      .populate([
        {
          path: 'companyId',
          select: { name: 1 },
        },
        {
          path: 'jobId',
          select: { name: 1 },
        },
      ]);
  }

  async update(id: string, status: string, user: IUser) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('cannot find resume with id: ' + id);
    }
    if (!ALLOWED_STATUSES.includes(status as ResumeStatus)) {
      throw new BadRequestException(
        `Trạng thái không hợp lệ. Cho phép: ${ALLOWED_STATUSES.join(', ')}`,
      );
    }

    // Lấy snapshot trước khi update để biết prevStatus + chủ CV (cho noti).
    const before = await this.resumeModel
      .findOne({ _id: id, ...this.scopeFilter(user) })
      .select('status userId jobId companyId')
      .lean();

    if (!before) {
      throw new NotFoundException(
        'Không tìm thấy CV hoặc không có quyền cập nhật',
      );
    }

    const updated = await this.resumeModel.updateOne(
      { _id: id, ...this.scopeFilter(user) },
      {
        status,
        updatedBy: { _id: user._id, email: user.email },
        $push: {
          history: {
            status,
            updatedAt: new Date(),
            updatedBy: { _id: user._id, email: user.email },
          },
        },
      },
    );

    if (updated.matchedCount === 0) {
      throw new NotFoundException(
        'Không tìm thấy CV hoặc không có quyền cập nhật',
      );
    }

    // Best-effort: bắn noti cho chủ CV. Service đã handle idempotency
    // (prevStatus === newStatus → bỏ qua) và trường hợp HR tự nộp tự đổi.
    void this.notificationsService.notifyResumeStatusChanged({
      resumeId: id,
      ownerId: before.userId,
      jobId: before.jobId,
      companyId: before.companyId,
      prevStatus: before.status,
      newStatus: status,
      actor: user,
    });

    return updated;
  }

  async remove(id: string, user: IUser) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('cannot find resume with id: ' + id);
    }

    const filter = { _id: id, ...this.scopeFilter(user) };
    const target = await this.resumeModel.findOne(filter).select('_id');
    if (!target) {
      throw new NotFoundException('Không tìm thấy CV hoặc không có quyền xoá');
    }

    await this.resumeModel.updateOne(filter, {
      deletedBy: { _id: user._id, email: user.email },
    });
    return this.resumeModel.delete(filter);
  }
}
