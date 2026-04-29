import { Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type {
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

/**
 * Realtime gateway cho notifications.
 *
 * Thiết kế:
 *  - Namespace `/notifications` để tách khỏi các gateway khác trong tương lai.
 *  - Mỗi client phải gửi JWT trong `socket.handshake.auth.token` (hoặc query `?token=`).
 *  - Sau khi auth thành công, socket auto join room `user:<userId>`. BE chỉ cần
 *    `server.to('user:'+id).emit(...)` là tất cả tab/devices của user nhận được.
 *  - Mọi action ghi (mark-read / delete) đều đi qua REST controller, gateway chỉ
 *    push event xuống — tránh logic trùng lặp + dễ unit test.
 */
@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    // Lấy lại config CORS như HTTP. Để rộng vì JWT là source of truth cho auth.
    origin: true,
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    // Server có thể chưa init nếu module chưa bootstrap xong — log defer.
    this.logger.log('Notifications gateway namespace: /notifications');
  }

  // ─── CONNECTION LIFECYCLE ─────────────────────────────────

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        this.logger.warn(`Socket ${client.id} thiếu token → disconnect`);
        client.emit('error', {
          code: 'UNAUTHORIZED',
          message: 'Missing token',
        });
        client.disconnect(true);
        return;
      }

      const payload = await this.jwtService.verifyAsync<{ _id?: string }>(
        token,
        {
          secret: this.configService.get<string>('JWT_ACCESS_TOKEN_SECRET'),
        },
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

      // Lưu lại để dùng lại khi cần và join room riêng cho user.
      (client.data as { userId?: string }).userId = userId;
      await client.join(this.roomFor(userId));

      this.logger.debug(`User ${userId} connected via socket ${client.id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Auth failed';
      this.logger.warn(`Socket ${client.id} auth failed: ${message}`);
      client.emit('error', { code: 'UNAUTHORIZED', message });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = (client.data as { userId?: string }).userId;
    if (userId) {
      this.logger.debug(`User ${userId} disconnected (socket ${client.id})`);
    }
  }

  // ─── PUBLIC EMIT API (gọi từ NotificationsService) ────────

  /** Push 1 notification mới tới mọi tab/device của user. */
  emitNew(userId: string, payload: unknown) {
    this.safeEmit(userId, 'notification:new', payload);
  }

  /** Cập nhật badge unread cho user. */
  emitUnreadCount(userId: string, unread: number) {
    this.safeEmit(userId, 'notification:unread-count', { unread });
  }

  /** Sync khi mark-read 1 hoặc tất cả. Giúp đồng bộ multi-tab. */
  emitRead(userId: string, payload: { id: string } | { all: true }) {
    this.safeEmit(userId, 'notification:read', payload);
  }

  /** Sync khi xoá noti ở 1 tab → các tab khác cập nhật. */
  emitDeleted(userId: string, id: string) {
    this.safeEmit(userId, 'notification:deleted', { id });
  }

  // ─── INTERNALS ────────────────────────────────────────────

  private roomFor(userId: string): string {
    return `user:${userId}`;
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = (client.handshake.auth as { token?: string } | undefined)
      ?.token;
    if (authToken) return authToken;

    const queryToken = client.handshake.query?.token;
    if (typeof queryToken === 'string') return queryToken;

    // Fallback: Authorization: Bearer <token>
    const header = client.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return undefined;
  }

  /**
   * Wrap emit để không bao giờ throw khi server chưa init / room rỗng.
   * Notification là best-effort: socket fail không được làm vỡ flow gọi.
   */
  private safeEmit(userId: string, event: string, payload: unknown) {
    try {
      this.server?.to(this.roomFor(userId)).emit(event, payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.warn(`Emit ${event} cho user ${userId} thất bại: ${message}`);
    }
  }
}
