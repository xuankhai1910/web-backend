import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import type { FilterQuery, Model } from 'mongoose';
import { Company } from 'src/companies/schemas/company.schema';
import { Resume } from 'src/resumes/schemas/resume.schema';
import { User } from 'src/users/schemas/user.schema';
import type { IUser } from 'src/users/users.interface';
import { ChatGateway } from './chat.gateway';
import { Conversation } from './schemas/conversation.schema';
import type {
  ChatSide,
  ConversationDocument,
} from './schemas/conversation.schema';
import { Message } from './schemas/message.schema';
import type { MessageDocument } from './schemas/message.schema';

type ObjId = mongoose.Types.ObjectId;

/** Thông tin đối phương (ứng viên hoặc công ty) cần để render hội thoại. */
interface OtherParty {
  name?: string;
  email?: string;
  avatar?: string;
  logo?: string;
}

/** Ép ObjectId-like về string an toàn (runtime value là Types.ObjectId). */
const idStr = (v: unknown): string => String(v);

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(Resume.name) private readonly resumeModel: Model<Resume>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
    @Inject(forwardRef(() => ChatGateway))
    private readonly gateway: ChatGateway,
  ) {}

  // ────────────────────────────────────────────────────────────
  // HR: mở hội thoại (chỉ với ứng viên ĐÃ nộp CV vào công ty)
  // ────────────────────────────────────────────────────────────

  async startConversation(
    hrUser: IUser,
    dto: { resumeId?: string; candidateId?: string },
  ) {
    const companyId = hrUser.company?._id;
    if (!companyId) {
      throw new ForbiddenException('Tài khoản HR chưa gắn với công ty nào');
    }

    let candidateId: string | undefined;
    let relatedJobId: ObjId | undefined;
    let relatedResumeId: ObjId | undefined;

    if (dto.resumeId) {
      if (!mongoose.Types.ObjectId.isValid(dto.resumeId)) {
        throw new BadRequestException('resumeId không hợp lệ');
      }
      const resume = await this.resumeModel
        .findById(dto.resumeId)
        .select('userId companyId jobId')
        .lean();
      if (!resume)
        throw new NotFoundException('Không tìm thấy hồ sơ ứng tuyển');
      if (idStr(resume.companyId) !== String(companyId)) {
        throw new ForbiddenException('Hồ sơ này không thuộc công ty của bạn');
      }
      if (!resume.userId) {
        throw new BadRequestException(
          'Ứng viên của hồ sơ này chưa có tài khoản',
        );
      }
      candidateId = idStr(resume.userId);
      relatedJobId = resume.jobId as unknown as ObjId;
      relatedResumeId = resume._id as unknown as ObjId;
    } else if (dto.candidateId) {
      if (!mongoose.Types.ObjectId.isValid(dto.candidateId)) {
        throw new BadRequestException('candidateId không hợp lệ');
      }
      // Ràng buộc: ứng viên phải đã từng nộp CV vào công ty này.
      const resume = await this.resumeModel
        .findOne({
          userId: dto.candidateId,
          companyId,
        } as Record<string, unknown>)
        .sort({ createdAt: -1 })
        .select('jobId')
        .lean();
      if (!resume) {
        throw new BadRequestException(
          'Ứng viên chưa nộp hồ sơ vào công ty của bạn',
        );
      }
      candidateId = dto.candidateId;
      relatedJobId = resume.jobId as unknown as ObjId;
    } else {
      throw new BadRequestException('Cần resumeId hoặc candidateId');
    }

    // Upsert theo (candidateId, companyId): mở lại trả về hội thoại cũ.
    const conv = await this.conversationModel
      .findOneAndUpdate(
        { candidateId, companyId } as Record<string, unknown>,
        {
          $setOnInsert: {
            candidateId,
            companyId,
            relatedJobId,
            relatedResumeId,
            candidateUnread: 0,
            companyUnread: 0,
            createdBy: { _id: hrUser._id, email: hrUser.email },
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean();

    return this.enrichOne(conv as ConversationDocument, 'HR');
  }

  // ────────────────────────────────────────────────────────────
  // List hội thoại (scope theo phía)
  // ────────────────────────────────────────────────────────────

  async listConversations(
    viewer: IUser,
    side: ChatSide,
    currentPage: number,
    limit: number,
  ) {
    const filter = this.sideFilter(viewer, side);
    const offset = (Math.max(1, +currentPage || 1) - 1) * (+limit || 20);
    const defaultLimit = +limit > 0 ? +limit : 20;

    const [totalItems, convs] = await Promise.all([
      this.conversationModel.countDocuments(filter),
      this.conversationModel
        .find(filter)
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .skip(offset)
        .limit(defaultLimit)
        .lean(),
    ]);

    const result = await this.enrichList(convs as ConversationDocument[], side);

    return {
      meta: {
        current: +currentPage || 1,
        pageSize: defaultLimit,
        pages: Math.ceil(totalItems / defaultLimit),
        total: totalItems,
      },
      result,
    };
  }

  // ────────────────────────────────────────────────────────────
  // List tin nhắn trong 1 hội thoại
  // ────────────────────────────────────────────────────────────

  async listMessages(
    viewer: IUser,
    conversationId: string,
    side: ChatSide,
    currentPage: number,
    limit: number,
  ) {
    const conv = await this.getConversationOrThrow(conversationId);
    this.assertParticipant(viewer, side, conv);

    const defaultLimit = +limit > 0 ? +limit : 30;
    const offset = (Math.max(1, +currentPage || 1) - 1) * defaultLimit;

    const msgFilter = {
      conversationId,
    } as FilterQuery<MessageDocument>;
    const [totalItems, newestFirst] = await Promise.all([
      this.messageModel.countDocuments(msgFilter),
      this.messageModel
        .find(msgFilter)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(defaultLimit)
        .lean(),
    ]);

    return {
      meta: {
        current: +currentPage || 1,
        pageSize: defaultLimit,
        pages: Math.ceil(totalItems / defaultLimit),
        total: totalItems,
      },
      // Trả ASC để FE render từ cũ → mới.
      result: newestFirst.reverse(),
      conversation: await this.enrichOne(conv, side),
    };
  }

  // ────────────────────────────────────────────────────────────
  // Gửi tin
  // ────────────────────────────────────────────────────────────

  async sendMessage(
    viewer: IUser,
    conversationId: string,
    side: ChatSide,
    content: string,
  ) {
    const text = (content ?? '').trim();
    if (!text) throw new BadRequestException('Nội dung tin nhắn trống');
    if (text.length > 4000) {
      throw new BadRequestException('Tin nhắn quá dài (tối đa 4000 ký tự)');
    }

    const conv = await this.getConversationOrThrow(conversationId);
    this.assertParticipant(viewer, side, conv);

    const now = new Date();
    const message = await this.messageModel.create({
      conversationId: conv._id as unknown as mongoose.Schema.Types.ObjectId,
      senderId: viewer._id as unknown as mongoose.Schema.Types.ObjectId,
      senderType: side,
      content: text,
    } as Partial<Message>);

    // Người gửi coi như đã đọc tới hiện tại; phía kia +1 chưa đọc.
    const update =
      side === 'HR'
        ? {
            $set: {
              lastMessage: text.slice(0, 500),
              lastMessageAt: now,
              lastSenderType: side,
              companyUnread: 0,
              companyLastReadAt: now,
            },
            $inc: { candidateUnread: 1 },
          }
        : {
            $set: {
              lastMessage: text.slice(0, 500),
              lastMessageAt: now,
              lastSenderType: side,
              candidateUnread: 0,
              candidateLastReadAt: now,
            },
            $inc: { companyUnread: 1 },
          };
    await this.conversationModel.updateOne({ _id: conv._id }, update);

    const candidateId = idStr(conv.candidateId);
    const companyId = idStr(conv.companyId);

    // Push tin tới cả 2 phía (1 phía là người nhận, 1 phía là echo multi-tab).
    const payload = { conversationId, message };
    this.gateway.emitMessageToUser(candidateId, payload);
    this.gateway.emitMessageToCompany(companyId, payload);

    // Cập nhật badge tổng cho cả 2 phía.
    await Promise.all([
      this.pushCandidateUnreadTotal(candidateId),
      this.pushCompanyUnreadTotal(companyId),
    ]);

    return message;
  }

  // ────────────────────────────────────────────────────────────
  // Đánh dấu đã đọc cả hội thoại
  // ────────────────────────────────────────────────────────────

  async markRead(viewer: IUser, conversationId: string, side: ChatSide) {
    const conv = await this.getConversationOrThrow(conversationId);
    this.assertParticipant(viewer, side, conv);

    const now = new Date();
    const update =
      side === 'HR'
        ? { $set: { companyUnread: 0, companyLastReadAt: now } }
        : { $set: { candidateUnread: 0, candidateLastReadAt: now } };
    await this.conversationModel.updateOne({ _id: conv._id }, update);

    const candidateId = idStr(conv.candidateId);
    const companyId = idStr(conv.companyId);
    const readPayload = { conversationId, readerSide: side, readAt: now };

    if (side === 'HR') {
      // Báo ứng viên "đã xem" + cập nhật badge cho HR công ty.
      this.gateway.emitReadToUser(candidateId, readPayload);
      await this.pushCompanyUnreadTotal(companyId);
    } else {
      this.gateway.emitReadToCompany(companyId, readPayload);
      await this.pushCandidateUnreadTotal(candidateId);
    }

    return { readAt: now };
  }

  async unreadTotal(viewer: IUser, side: ChatSide): Promise<{ total: number }> {
    if (side === 'HR') {
      const companyId = viewer.company?._id;
      if (!companyId) return { total: 0 };
      return { total: await this.companyUnreadTotal(String(companyId)) };
    }
    return { total: await this.candidateUnreadTotal(idStr(viewer._id)) };
  }

  // ────────────────────────────────────────────────────────────
  // HELPERS
  // ────────────────────────────────────────────────────────────

  private sideFilter(viewer: IUser, side: ChatSide): Record<string, unknown> {
    if (side === 'HR') {
      const companyId = viewer.company?._id;
      // Không có công ty → không match gì (tránh lộ hội thoại công ty khác).
      return { companyId: companyId ?? new mongoose.Types.ObjectId() };
    }
    return { candidateId: viewer._id };
  }

  private async getConversationOrThrow(
    id: string,
  ): Promise<ConversationDocument> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Conversation id không hợp lệ');
    }
    const conv = await this.conversationModel.findById(id).lean();
    if (!conv) throw new NotFoundException('Không tìm thấy hội thoại');
    return conv as ConversationDocument;
  }

  private assertParticipant(
    viewer: IUser,
    side: ChatSide,
    conv: ConversationDocument,
  ) {
    if (side === 'CANDIDATE') {
      if (idStr(conv.candidateId) !== idStr(viewer._id)) {
        throw new ForbiddenException('Bạn không thuộc hội thoại này');
      }
    } else {
      const companyId = viewer.company?._id;
      if (!companyId || idStr(conv.companyId) !== String(companyId)) {
        throw new ForbiddenException('Hội thoại không thuộc công ty của bạn');
      }
    }
  }

  private async enrichList(convs: ConversationDocument[], side: ChatSide) {
    if (convs.length === 0) return [];
    if (side === 'HR') {
      const ids = [...new Set(convs.map((c) => idStr(c.candidateId)))];
      const users = await this.userModel
        .find({ _id: { $in: ids } })
        .select('name email avatar')
        .lean();
      const map = new Map(users.map((u) => [String(u._id), u]));
      return Promise.all(
        convs.map((c) =>
          this.enrichOne(c, side, map.get(idStr(c.candidateId))),
        ),
      );
    }
    const ids = [...new Set(convs.map((c) => idStr(c.companyId)))];
    const companies = await this.companyModel
      .find({ _id: { $in: ids } })
      .select('name logo')
      .lean();
    const map = new Map(companies.map((co) => [String(co._id), co]));
    return Promise.all(
      convs.map((c) => this.enrichOne(c, side, map.get(idStr(c.companyId)))),
    );
  }

  /** Chuẩn hoá 1 conversation theo góc nhìn của `side` (kèm presence đối phương). */
  private async enrichOne(
    conv: ConversationDocument,
    side: ChatSide,
    other?: OtherParty,
  ) {
    const isHr = side === 'HR';
    const candidateId = idStr(conv.candidateId);
    const companyId = idStr(conv.companyId);

    let party: OtherParty | undefined = other;
    if (!party) {
      party = isHr
        ? ((await this.userModel
            .findById(candidateId)
            .select('name email avatar')
            .lean()) ?? undefined)
        : ((await this.companyModel
            .findById(companyId)
            .select('name logo')
            .lean()) ?? undefined);
    }

    const otherOnline = isHr
      ? await this.gateway.isUserOnline(candidateId)
      : await this.gateway.isCompanyOnline(companyId);

    return {
      _id: conv._id,
      candidateId,
      companyId,
      relatedJobId: conv.relatedJobId,
      relatedResumeId: conv.relatedResumeId,
      lastMessage: conv.lastMessage,
      lastMessageAt: conv.lastMessageAt,
      lastSenderType: conv.lastSenderType,
      unread: isHr ? conv.companyUnread : conv.candidateUnread,
      myLastReadAt: isHr ? conv.companyLastReadAt : conv.candidateLastReadAt,
      otherLastReadAt: isHr ? conv.candidateLastReadAt : conv.companyLastReadAt,
      otherParty: isHr
        ? {
            _id: candidateId,
            name: party?.name || party?.email || 'Ứng viên',
            avatar: party?.avatar ?? null,
          }
        : {
            _id: companyId,
            name: party?.name || 'Công ty',
            logo: party?.logo ?? null,
          },
      otherOnline,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  }

  private async candidateUnreadTotal(candidateId: string): Promise<number> {
    const r = await this.conversationModel.aggregate<{ t: number }>([
      { $match: { candidateId: new mongoose.Types.ObjectId(candidateId) } },
      { $group: { _id: null, t: { $sum: '$candidateUnread' } } },
    ]);
    return r[0]?.t ?? 0;
  }

  private async companyUnreadTotal(companyId: string): Promise<number> {
    const r = await this.conversationModel.aggregate<{ t: number }>([
      { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
      { $group: { _id: null, t: { $sum: '$companyUnread' } } },
    ]);
    return r[0]?.t ?? 0;
  }

  private async pushCandidateUnreadTotal(candidateId: string) {
    const total = await this.candidateUnreadTotal(candidateId);
    this.gateway.emitUnreadTotalToUser(candidateId, total);
  }

  private async pushCompanyUnreadTotal(companyId: string) {
    const total = await this.companyUnreadTotal(companyId);
    this.gateway.emitUnreadTotalToCompany(companyId, total);
  }
}
