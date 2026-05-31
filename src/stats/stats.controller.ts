import { Controller, Get, Inject } from '@nestjs/common';
import { StatsService } from './stats.service';
import {
  ResponseMessage,
  SkipCheckPermission,
  User,
} from 'src/decorators/customize';
import type { IUser } from 'src/users/users.interface';

@Controller('stats')
export class StatsController {
  constructor(
    @Inject(StatsService) private readonly statsService: StatsService,
  ) {}

  // Admin-only: SUPER_ADMIN bypasses the global permission check; other roles
  // need the matching permission row (see INIT_PERMISSIONS, module STATS).
  @ResponseMessage('Lấy thống kê tổng quan hệ thống thành công')
  @Get('admin/overview')
  adminOverview() {
    return this.statsService.adminOverview();
  }

  // HR (or admin): valid JWT only; the service scopes results to the caller's
  // company and rejects a company-less non-admin caller.
  @ResponseMessage('Lấy thống kê tuyển dụng thành công')
  @Get('hr/overview')
  hrOverview(@User() user: IUser) {
    return this.statsService.hrOverview(user);
  }
}
