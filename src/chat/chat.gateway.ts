import { Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type {
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { FilterQuery, Model } from 'mongoose';
import type { Server, Socket } from 'socket.io';
import { User } from 'src/users/schemas/user.schema';
import { Conversation } from './schemas/conversation.schema';
import type { ConversationDocument } from './schemas/conversation.schema';

/** Role được coi là "HR của công ty" — join chung room công ty. */
const HR_ROLE_NAMES = ['HR', 'COMPANY_ADMIN'];

/** Ép ObjectId-like về string an toàn (runtime value là Types.ObjectId). */
const idStr = (v: unknown): string => String(v);

interface SocketState {
  userId?: string;
  side?: 'CANDIDATE' | 'HR';
  companyId?: string;
}

/**
 * Realtime gateway cho chat HR ↔ ứng viên.
 *
 * Thiết kế (mirror `NotificationsGateway`):
 *  - Namespace `/chat`, JWT trong `socket.handshake.auth.token` (hoặc query/header).
 *  - Mỗi user join room `user:<userId>` (sync multi-tab).
 *  - HR còn join `company:<companyId>:hr` → emit 1 lần tới cả hộp thư chung công ty.
 *  - Mọi action GHI đi qua REST; gateway chỉ PUSH (message / read / unread / presence).
 *  - Presence suy ra từ chính room membership của Socket.IO, không map thủ công.
 */
@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: true, credentials: true },
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
  ) {}

  onModuleInit() {
    this.logger.log('Chat gateway namespace: /chat');
  }

  // ─── CONNECTION LIFECYCLE ─────────────────────────────────

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        client.emit('error', {
          code: 'UNAUTHORIZED',
          message: 'Missing token',
        });
        client.disconnect(true);
        return;
      }

      const payload = await this.jwtService.verifyAsync<{ _id?: string }>(
        token,
        { secret: this.configService.get<string>('JWT_ACCESS_TOKEN_SECRET') },
      );
      const userId = payload?._id;
      if (!userId) {
        client.emit('error', {
          code: 'UNAUTHORIZED',
          message: 'Invalid token',
        });
        client.disconnect(true);
        return;
      }

      // Tra cứu role + company để biết user là HR hay ứng viên.
      const user = await this.userModel
        .findById(userId)
        .select('role company')
        .populate('role', 'name')
        .lean();
      const roleName = (user?.role as unknown as { name?: string } | undefined)
        ?.name;
      const companyId = user?.company?._id
        ? idStr(user.company._id)
        : undefined;
      const isHr =
        !!roleName && HR_ROLE_NAMES.includes(roleName) && !!companyId;

      const state = client.data as SocketState;
      state.userId = userId;
      state.side = isHr ? 'HR' : 'CANDIDATE';
      state.companyId = isHr ? companyId : undefined;

      // Tính transition online TRƯỚC khi join (đếm socket hiện có của room).
      const userWasOnline = await this.roomHasSockets(this.userRoom(userId));
      const companyWasOnline =
        isHr && companyId
          ? await this.roomHasSockets(this.companyRoom(companyId))
          : true;

      await client.join(this.userRoom(userId));
      if (isHr && companyId) await client.join(this.companyRoom(companyId));

      // Phát presence khi vừa chuyển offline → online.
      if (isHr && companyId) {
        if (!companyWasOnline) {
          await this.broadcastCompanyPresence(companyId, true);
        }
      } else if (!userWasOnline) {
        await this.broadcastCandidatePresence(userId, true);
      }

      this.logger.debug(`Chat connect: ${userId} (${state.side})`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Auth failed';
      client.emit('error', { code: 'UNAUTHORIZED', message });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    // Tại thời điểm `disconnect`, socket ĐÃ rời các room → đếm còn lại là chính xác.
    const { userId, side, companyId } = client.data as SocketState;
    if (!userId) return;
    try {
      if (side === 'HR' && companyId) {
        if (!(await this.roomHasSockets(this.companyRoom(companyId)))) {
          await this.broadcastCompanyPresence(companyId, false);
        }
      } else if (!(await this.roomHasSockets(this.userRoom(userId)))) {
        await this.broadcastCandidatePresence(userId, false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.warn(`presence on disconnect failed: ${msg}`);
    }
  }

  // ─── PUBLIC EMIT API (gọi từ ChatService) ─────────────────

  /** Tin mới → hộp thư chung của công ty. */
  emitMessageToCompany(companyId: string, payload: unknown) {
    this.safeTo(this.companyRoom(companyId), 'chat:message', payload);
  }

  /** Tin mới → mọi tab của 1 user (ứng viên, hoặc echo cho HR gửi). */
  emitMessageToUser(userId: string, payload: unknown) {
    this.safeTo(this.userRoom(userId), 'chat:message', payload);
  }

  /** Báo phía kia đã đọc (để hiện "Đã xem"). target = room đích. */
  emitReadToCompany(companyId: string, payload: unknown) {
    this.safeTo(this.companyRoom(companyId), 'chat:read', payload);
  }

  emitReadToUser(userId: string, payload: unknown) {
    this.safeTo(this.userRoom(userId), 'chat:read', payload);
  }

  /** Cập nhật badge tổng chưa đọc cho mọi tab của 1 user. */
  emitUnreadTotalToUser(userId: string, total: number) {
    this.safeTo(this.userRoom(userId), 'chat:unread-total', { total });
  }

  /** Cập nhật badge cho cả HR của công ty (shared inbox). */
  emitUnreadTotalToCompany(companyId: string, total: number) {
    this.safeTo(this.companyRoom(companyId), 'chat:unread-total', { total });
  }

  // ─── PRESENCE QUERY (dùng cho list response trả presence ban đầu) ──

  async isUserOnline(userId: string): Promise<boolean> {
    return this.roomHasSockets(this.userRoom(userId));
  }

  async isCompanyOnline(companyId: string): Promise<boolean> {
    return this.roomHasSockets(this.companyRoom(companyId));
  }

  // ─── INTERNALS ────────────────────────────────────────────

  private userRoom(userId: string): string {
    return `user:${userId}`;
  }

  private companyRoom(companyId: string): string {
    return `company:${companyId}:hr`;
  }

  private async roomHasSockets(room: string): Promise<boolean> {
    try {
      const sockets = await this.server?.in(room).fetchSockets();
      return (sockets?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /** Ứng viên online/offline → báo cho HR của các công ty ứng viên đang chat. */
  private async broadcastCandidatePresence(userId: string, online: boolean) {
    const convs = await this.conversationModel
      .find({ candidateId: userId } as FilterQuery<ConversationDocument>)
      .select('companyId')
      .lean();
    const companyIds = new Set(convs.map((c) => idStr(c.companyId)));
    for (const companyId of companyIds) {
      this.safeTo(this.companyRoom(companyId), 'chat:presence', {
        scope: 'user',
        userId,
        online,
      });
    }
  }

  /** Công ty online/offline → báo cho ứng viên đang chat với công ty đó. */
  private async broadcastCompanyPresence(companyId: string, online: boolean) {
    const convs = await this.conversationModel
      .find({ companyId } as FilterQuery<ConversationDocument>)
      .select('candidateId')
      .lean();
    const candidateIds = new Set(convs.map((c) => idStr(c.candidateId)));
    for (const candidateId of candidateIds) {
      this.safeTo(this.userRoom(candidateId), 'chat:presence', {
        scope: 'company',
        companyId,
        online,
      });
    }
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = (client.handshake.auth as { token?: string } | undefined)
      ?.token;
    if (authToken) return authToken;
    const queryToken = client.handshake.query?.token;
    if (typeof queryToken === 'string') return queryToken;
    const header = client.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return undefined;
  }

  /** Emit không bao giờ throw (server có thể chưa init / room rỗng). */
  private safeTo(room: string, event: string, payload: unknown) {
    try {
      this.server?.to(room).emit(event, payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.warn(`Emit ${event} → ${room} thất bại: ${message}`);
    }
  }
}
