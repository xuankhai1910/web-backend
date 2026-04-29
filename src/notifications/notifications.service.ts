import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import aqp from 'api-query-params';
import mongoose from 'mongoose';
import type { FilterQuery, Model } from 'mongoose';
import { Company } from 'src/companies/schemas/company.schema';
import { Job } from 'src/jobs/schemas/job.schema';
import { Role } from 'src/roles/schemas/role.schema';
import type { IUser } from 'src/users/users.interface';
import { User } from 'src/users/schemas/user.schema';
import { NotificationsGateway } from './notifications.gateway';
import { Notification } from './schemas/notification.schema';
import type {
  NotificationDocument,
  NotificationType,
  RecipientRole,
} from './schemas/notification.schema';

/**
 * Trạng thái CV → message Việt hoá hiển thị cho ứng viên.
 * Tách riêng để dễ chỉnh wording mà không đụng business logic.
 */
const STATUS_TEMPLATE: Record<
  string,
  (ctx: { jobName: string; companyName: string }) => {
    title: string;
    message: string;
  }
> = {
  REVIEWING: ({ jobName, companyName }) => ({
    title: 'CV đang được xem xét',
    message: `CV ứng tuyển công việc "${jobName}" tại ${companyName} của bạn đang được nhà tuyển dụng xem xét.`,
  }),
  APPROVED: ({ jobName, companyName }) => ({
    title: 'Chúc mừng! CV đã được chấp nhận',
    message: `Chúc mừng bạn đã ứng tuyển thành công công việc "${jobName}" tại ${companyName}. Hãy kiểm tra email từ nhà tuyển dụng hoặc bấm vào đây để xem chi tiết và liên hệ.`,
  }),
  REJECTED: ({ jobName, companyName }) => ({
    title: 'Rất tiếc, CV chưa phù hợp',
    message: `Xin lỗi, hiện tại CV của bạn chưa phù hợp. ${companyName} cho rằng bạn chưa phù hợp với vị trí "${jobName}". Hãy tiếp tục tìm kiếm các công việc khác phù hợp hơn nhé!`,
  }),
  PENDING: ({ jobName, companyName }) => ({
    title: 'CV đã được tiếp nhận',
    message: `CV ứng tuyển công việc "${jobName}" tại ${companyName} của bạn đã được tiếp nhận và đang chờ xử lý.`,
  }),
};

/** Role được coi là "HR của công ty" — nhận noti khi có ứng viên nộp CV. */
const HR_ROLE_NAMES = ['HR', 'COMPANY_ADMIN'];

/** Loose ObjectId-like type. Chấp nhận string, Types.ObjectId, hoặc Schema.Types.ObjectId. */
type ObjectIdLike =
  | string
  | mongoose.Types.ObjectId
  | mongoose.Schema.Types.ObjectId;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    @InjectModel(Job.name)
    private readonly jobModel: Model<Job>,
    @InjectModel(Company.name)
    private readonly companyModel: Model<Company>,
    @InjectModel(Role.name)
    private readonly roleModel: Model<Role>,
    @Inject(forwardRef(() => NotificationsGateway))
    private readonly gateway: NotificationsGateway,
  ) {}

  // ────────────────────────────────────────────────────────────
  // PUBLIC TRIGGERS — gọi từ ResumesService
  // ────────────────────────────────────────────────────────────

  /**
   * Sự kiện: ứng viên nộp CV.
   *  - Tạo `RESUME_SUBMITTED` cho chính ứng viên (xác nhận).
   *  - Fan-out `NEW_RESUME_RECEIVED` cho HR / COMPANY_ADMIN của công ty đó.
   *
   * Best-effort: lỗi ở bước này KHÔNG được làm fail luồng nộp CV.
   */
  async notifyResumeSubmitted(params: {
    resumeId: ObjectIdLike;
    jobId?: ObjectIdLike | null;
    companyId?: ObjectIdLike | null;
    actor: IUser;
  }) {
    try {
      const { resumeId, jobId, companyId, actor } = params;
      const submittedAt = new Date();

      // Lookup tên job + company song song. Fallback dùng tên placeholder.
      const [jobName, companyName, hrRecipients] = await Promise.all([
        this.lookupJobName(jobId),
        this.lookupCompanyName(companyId),
        this.findHrRecipients(companyId, actor._id),
      ]);

      const applicantName = actor.name || actor.email;
      const baseData = {
        resumeId: String(resumeId),
        jobId: jobId ? String(jobId) : undefined,
        jobName,
        companyId: companyId ? String(companyId) : undefined,
        companyName,
        applicantId: String(actor._id),
        applicantEmail: actor.email,
        applicantName,
        submittedAt: submittedAt.toISOString(),
      };

      // 1) Confirm cho ứng viên
      const userNoti = this.buildNoti({
        recipientId: actor._id,
        recipientRole: 'USER',
        type: 'RESUME_SUBMITTED',
        title: 'Bạn đã ứng tuyển thành công',
        message: `Bạn đã ứng tuyển vào công việc "${jobName}" tại ${companyName} lúc ${this.formatTime(submittedAt)}.`,
        ctaUrl: `/profile/resumes/${String(resumeId)}`,
        data: baseData,
        actor,
      });

      // 2) Fan-out cho HR
      const hrNotis = hrRecipients.map((hr) =>
        this.buildNoti({
          recipientId: hr._id,
          recipientRole: hr.recipientRole,
          type: 'NEW_RESUME_RECEIVED',
          title: `Công việc "${jobName}" vừa nhận được đơn ứng tuyển`,
          message: `Ứng viên ${applicantName} đã ứng tuyển vào lúc ${this.formatTime(submittedAt)}. Bấm vào đây để xem CV của ứng viên.`,
          ctaUrl: `/hr/resumes/${String(resumeId)}`,
          data: baseData,
          actor,
        }),
      );

      // Batch insert: 1 round-trip duy nhất, scale tốt cho công ty nhiều HR.
      const created = await this.notificationModel.insertMany(
        [userNoti, ...hrNotis],
        { ordered: false },
      );

      // Push realtime — mỗi doc tới đúng owner.
      await this.broadcastCreated(created);
    } catch (err) {
      this.logSafely('notifyResumeSubmitted failed', err);
    }
  }

  /**
   * Sự kiện: HR đổi trạng thái CV.
   * Tạo `RESUME_STATUS_CHANGED` cho chủ CV. Bỏ qua nếu:
   *  - status mới === status cũ (idempotent — không spam noti).
   *  - chủ CV chính là actor (HR tự nộp + tự đổi).
   *  - không xác định được chủ CV.
   */
  async notifyResumeStatusChanged(params: {
    resumeId: ObjectIdLike;
    ownerId?: ObjectIdLike | null;
    jobId?: ObjectIdLike | null;
    companyId?: ObjectIdLike | null;
    prevStatus?: string;
    newStatus: string;
    actor: IUser;
  }) {
    try {
      const {
        resumeId,
        ownerId,
        jobId,
        companyId,
        prevStatus,
        newStatus,
        actor,
      } = params;

      if (!ownerId) return;
      if (prevStatus && prevStatus === newStatus) return;
      if (String(ownerId) === String(actor._id)) return;

      const tpl = STATUS_TEMPLATE[newStatus];
      if (!tpl) return; // status lạ — không bắn noti

      const [jobName, companyName] = await Promise.all([
        this.lookupJobName(jobId),
        this.lookupCompanyName(companyId),
      ]);

      const updatedAt = new Date();
      const { title, message } = tpl({ jobName, companyName });

      // APPROVED → đẩy về trang job để liên hệ; còn lại → trang quản lý CV.
      const ctaUrl =
        newStatus === 'APPROVED' && jobId
          ? `/jobs/${String(jobId)}`
          : `/profile/resumes/${String(resumeId)}`;

      const noti = this.buildNoti({
        recipientId: ownerId,
        recipientRole: 'USER',
        type: 'RESUME_STATUS_CHANGED',
        title,
        message,
        ctaUrl,
        data: {
          resumeId: String(resumeId),
          jobId: jobId ? String(jobId) : undefined,
          jobName,
          companyId: companyId ? String(companyId) : undefined,
          companyName,
          status: newStatus,
          prevStatus,
          updatedAt: updatedAt.toISOString(),
        },
        actor,
      });

      const created = await this.notificationModel.create(noti);
      await this.broadcastCreated([created]);
    } catch (err) {
      this.logSafely('notifyResumeStatusChanged failed', err);
    }
  }

  // ────────────────────────────────────────────────────────────
  // CRUD CHO CONTROLLER
  // ────────────────────────────────────────────────────────────

  async findAll(currentPage: number, limit: number, qs: string, user: IUser) {
    const { filter, sort, projection } = aqp(qs);
    delete (filter as Record<string, unknown>).current;
    delete (filter as Record<string, unknown>).pageSize;

    // BẮT BUỘC scope theo recipientId — client không được phép xem noti của user khác.
    (filter as Record<string, unknown>).recipientId = user._id;
    const dbFilter = filter as unknown as FilterQuery<NotificationDocument>;

    const offset = (+currentPage - 1) * +limit;
    const defaultLimit = +limit ? +limit : 10;

    const [totalItems, result] = await Promise.all([
      this.notificationModel.countDocuments(dbFilter),
      this.notificationModel
        .find(dbFilter)
        .skip(offset)
        .limit(defaultLimit)
        .sort((sort as Record<string, 1 | -1>) ?? { createdAt: -1 })
        .select(projection as never)
        .lean()
        .exec(),
    ]);

    return {
      meta: {
        current: currentPage,
        pageSize: limit,
        pages: Math.ceil(totalItems / defaultLimit),
        total: totalItems,
      },
      result,
    };
  }

  async unreadCount(user: IUser): Promise<{ unread: number }> {
    const unread = await this.notificationModel.countDocuments({
      recipientId: user._id,
      isRead: false,
    } as FilterQuery<NotificationDocument>);
    return { unread };
  }

  async markRead(id: string, user: IUser) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Notification id không hợp lệ');
    }
    const result = await this.notificationModel.updateOne(
      {
        _id: id,
        recipientId: user._id,
        isRead: false,
      } as FilterQuery<NotificationDocument>,
      { isRead: true, readAt: new Date() },
    );

    if (result.matchedCount === 0) {
      // Có thể đã đọc rồi hoặc không thuộc user này — phân biệt bằng exists().
      const exists = await this.notificationModel.exists({
        _id: id,
        recipientId: user._id,
      } as FilterQuery<NotificationDocument>);
      if (!exists) {
        throw new NotFoundException(
          'Không tìm thấy thông báo hoặc không có quyền',
        );
      }
    } else {
      // Sync multi-tab + cập nhật badge.
      this.gateway.emitRead(String(user._id), { id });
      void this.broadcastUnreadCount(user);
    }
    return result;
  }

  async markAllRead(user: IUser) {
    const result = await this.notificationModel.updateMany(
      {
        recipientId: user._id,
        isRead: false,
      } as FilterQuery<NotificationDocument>,
      { isRead: true, readAt: new Date() },
    );
    if (result.modifiedCount > 0) {
      this.gateway.emitRead(String(user._id), { all: true });
      this.gateway.emitUnreadCount(String(user._id), 0);
    }
    return result;
  }

  async remove(id: string, user: IUser) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Notification id không hợp lệ');
    }
    const result = await this.notificationModel.deleteOne({
      _id: id,
      recipientId: user._id,
    } as FilterQuery<NotificationDocument>);
    if (result.deletedCount === 0) {
      throw new NotFoundException(
        'Không tìm thấy thông báo hoặc không có quyền',
      );
    }
    this.gateway.emitDeleted(String(user._id), id);
    void this.broadcastUnreadCount(user);
    return result;
  }

  // ────────────────────────────────────────────────────────────
  // HELPERS
  // ────────────────────────────────────────────────────────────

  /**
   * Tìm những user "HR của công ty" để fan-out noti.
   * Tiêu chí:
   *  - `company._id === companyId`
   *  - `role.name ∈ HR_ROLE_NAMES` (loại NORMAL_USER)
   *  - khác `actorId` (tránh self-noti khi HR tự nộp CV)
   *
   * Tối ưu: 2 query nhỏ + dùng index `{ 'company._id': 1 }` (đã có ở user query phổ biến).
   */
  private async findHrRecipients(
    companyId: ObjectIdLike | null | undefined,
    actorId: ObjectIdLike,
  ): Promise<
    Array<{ _id: mongoose.Types.ObjectId; recipientRole: RecipientRole }>
  > {
    if (!companyId) return [];

    // Lookup role IDs phù hợp (chỉ 2 role) — chỉ cần `_id`.
    const hrRoles = await this.roleModel
      .find({ name: { $in: HR_ROLE_NAMES } })
      .select('_id name')
      .lean();
    if (hrRoles.length === 0) return [];

    const roleMap = new Map(hrRoles.map((r) => [String(r._id), r.name]));

    // Mongoose strict types không support dot-notation cho embedded doc;
    // ép kiểu để giữ query đúng format MongoDB.
    const users = await (
      this.userModel.find as unknown as (
        f: Record<string, unknown>,
      ) => ReturnType<typeof this.userModel.find>
    )({
      'company._id': companyId,
      role: { $in: hrRoles.map((r) => r._id) },
      _id: { $ne: actorId },
    })
      .select('_id role')
      .lean();

    return users.map((u) => ({
      _id: u._id as mongoose.Types.ObjectId,
      recipientRole:
        roleMap.get(String(u.role)) === 'COMPANY_ADMIN'
          ? 'COMPANY_ADMIN'
          : 'HR',
    }));
  }

  private async lookupJobName(jobId?: ObjectIdLike | null): Promise<string> {
    if (!jobId || !mongoose.Types.ObjectId.isValid(String(jobId))) {
      return 'công việc';
    }
    const job = await this.jobModel.findById(jobId).select('name').lean();
    return job?.name?.trim() || 'công việc';
  }

  private async lookupCompanyName(
    companyId?: ObjectIdLike | null,
  ): Promise<string> {
    if (!companyId || !mongoose.Types.ObjectId.isValid(String(companyId))) {
      return 'công ty';
    }
    const company = await this.companyModel
      .findById(companyId)
      .select('name')
      .lean();
    return company?.name?.trim() || 'công ty';
  }

  private buildNoti(params: {
    recipientId: ObjectIdLike;
    recipientRole: RecipientRole;
    type: NotificationType;
    title: string;
    message: string;
    ctaUrl: string;
    data: Record<string, unknown>;
    actor: IUser;
  }): Partial<Notification> {
    return {
      recipientId:
        params.recipientId as unknown as mongoose.Schema.Types.ObjectId,
      recipientRole: params.recipientRole,
      type: params.type,
      title: params.title,
      message: params.message,
      ctaUrl: params.ctaUrl,
      data: params.data,
      isRead: false,
      createdBy: {
        _id: params.actor._id as unknown as mongoose.Schema.Types.ObjectId,
        email: params.actor.email,
      },
    };
  }

  /**
   * Push realtime cho từng noti vừa tạo, đồng thời gửi unread-count mới.
   * Group theo recipient để chỉ tính count 1 lần / user.
   */
  private async broadcastCreated(
    notis: Array<NotificationDocument | Notification>,
  ) {
    const grouped = new Map<
      string,
      Array<NotificationDocument | Notification>
    >();
    for (const n of notis) {
      const key = String((n as NotificationDocument).recipientId ?? '');
      if (!key) continue;
      const list = grouped.get(key);
      if (list) list.push(n);
      else grouped.set(key, [n]);
    }

    await Promise.all(
      Array.from(grouped.entries()).map(async ([userId, list]) => {
        for (const n of list) this.gateway.emitNew(userId, n);
        const unread = await this.notificationModel.countDocuments({
          recipientId: new mongoose.Types.ObjectId(userId),
          isRead: false,
        } as FilterQuery<NotificationDocument>);
        this.gateway.emitUnreadCount(userId, unread);
      }),
    );
  }

  private async broadcastUnreadCount(user: IUser) {
    try {
      const { unread } = await this.unreadCount(user);
      this.gateway.emitUnreadCount(String(user._id), unread);
    } catch (err) {
      this.logSafely('broadcastUnreadCount failed', err);
    }
  }

  private formatTime(d: Date): string {
    // vi-VN, Asia/Ho_Chi_Minh — đảm bảo nội dung đẹp ở mọi server timezone.
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  }

  private logSafely(prefix: string, err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.error(`${prefix}: ${msg}`);
  }
}
