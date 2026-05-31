import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, Types } from 'mongoose';
import type { SoftDeleteModel } from 'mongoose-delete';
import type { IUser } from 'src/users/users.interface';
import { Company, CompanyDocument } from 'src/companies/schemas/company.schema';
import { Job, JobDocument } from 'src/jobs/schemas/job.schema';
import { Resume, ResumeDocument } from 'src/resumes/schemas/resume.schema';
import {
  Permission,
  PermissionDocument,
} from 'src/permissions/schemas/permission.schema';
import { Role, RoleDocument } from 'src/roles/schemas/role.schema';
import { User, UserDocument } from 'src/users/schemas/user.schema';

const RESUME_STATUSES = [
  'PENDING',
  'REVIEWING',
  'APPROVED',
  'REJECTED',
] as const;
const JOB_LEVELS = [
  'INTERN',
  'FRESHER',
  'JUNIOR',
  'MID',
  'SENIOR',
  'LEAD',
] as const;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

type StatusCounts = Record<(typeof RESUME_STATUSES)[number], number>;
type LevelCounts = Record<(typeof JOB_LEVELS)[number], number>;

interface WeeklySeries {
  labels: string[];
  values: number[];
}

interface RecentJobLean {
  _id: Types.ObjectId;
  name: string;
  company?: { name?: string; logo?: string };
  location?: string;
  level?: string;
  isActive?: boolean;
  createdAt?: Date;
}

interface RecentUserLean {
  _id: Types.ObjectId;
  name?: string;
  email?: string;
  role?: { name?: string } | null;
}

interface LatestResumeAgg {
  _id: Types.ObjectId;
  email: string;
  status: string;
  createdAt: Date;
  userId: Types.ObjectId;
  userName: string;
  jobName?: string;
}

interface RoleLean {
  _id: Types.ObjectId;
  name: string;
}

@Injectable()
export class StatsService {
  constructor(
    @InjectModel(Company.name)
    private companyModel: SoftDeleteModel<CompanyDocument>,
    @InjectModel(User.name)
    private userModel: SoftDeleteModel<UserDocument>,
    @InjectModel(Job.name)
    private jobModel: SoftDeleteModel<JobDocument>,
    @InjectModel(Resume.name)
    private resumeModel: SoftDeleteModel<ResumeDocument>,
    @InjectModel(Permission.name)
    private permissionModel: SoftDeleteModel<PermissionDocument>,
    @InjectModel(Role.name)
    private roleModel: SoftDeleteModel<RoleDocument>,
  ) {}

  // ─── helpers ──────────────────────────────────────────────

  private isAdmin(user: IUser): boolean {
    const roleName = user?.role?.name?.toUpperCase();
    return roleName === 'SUPER_ADMIN' || roleName === 'ADMIN';
  }

  /** Monday (UTC, midnight) of the current week. */
  private currentWeekStart(): Date {
    const now = new Date();
    const day = now.getUTCDay(); // 0 = Sun … 6 = Sat
    const diffToMonday = (day + 6) % 7;
    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - diffToMonday,
      ),
    );
  }

  /** Ordered list of the last `n` week-start Dates (oldest → newest). */
  private lastNWeekStarts(n: number): Date[] {
    const monday = this.currentWeekStart().getTime();
    const starts: Date[] = [];
    for (let i = n - 1; i >= 0; i--)
      starts.push(new Date(monday - i * WEEK_MS));
    return starts;
  }

  /**
   * Dense weekly count series over the last `weeks` weeks, bucketed by the
   * `createdAt` of matching documents. Aggregation bypasses the soft-delete
   * plugin, so `deleted` is excluded explicitly.
   */
  private async weeklySeries(
    model: Model<any>,
    weeks: number,
    scope: Record<string, unknown> = {},
  ): Promise<WeeklySeries> {
    const starts = this.lastNWeekStarts(weeks);
    const rows: { _id: Date; count: number }[] = await model.aggregate([
      {
        $match: {
          deleted: { $ne: true },
          createdAt: { $gte: starts[0] },
          ...scope,
        },
      },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$createdAt',
              unit: 'week',
              startOfWeek: 'monday',
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);
    const byWeek = new Map(
      rows.map((r) => [new Date(r._id).getTime(), r.count]),
    );
    return {
      labels: starts.map((s) => s.toISOString()),
      values: starts.map((s) => byWeek.get(s.getTime()) ?? 0),
    };
  }

  /** Count documents grouped by a string field, returned as a plain map. */
  private async countByField(
    model: Model<any>,
    field: string,
    scope: Record<string, unknown> = {},
  ): Promise<Record<string, number>> {
    const rows: { _id: string; count: number }[] = await model.aggregate([
      { $match: { deleted: { $ne: true }, ...scope } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    ]);
    const out: Record<string, number> = {};
    for (const r of rows) if (r._id != null) out[String(r._id)] = r.count;
    return out;
  }

  private toStatusCounts(map: Record<string, number>): StatusCounts {
    return RESUME_STATUSES.reduce((acc, s) => {
      acc[s] = map[s] ?? 0;
      return acc;
    }, {} as StatusCounts);
  }

  private since30d(): Date {
    return new Date(Date.now() - 30 * DAY_MS);
  }

  // ─── ADMIN OVERVIEW ───────────────────────────────────────

  async adminOverview() {
    const since = this.since30d();

    const [
      companies,
      users,
      jobs,
      resumes,
      newCompanies,
      newUsers,
      newJobs,
      newResumes,
      resumeStatusMap,
      jobLevelMap,
      roleIdMap,
      permModuleMap,
      resSeries,
      jobSeries,
      companiesSpark,
      usersSpark,
      recentJobs,
      recentUsers,
      roles,
    ] = await Promise.all([
      this.companyModel.countDocuments({}),
      this.userModel.countDocuments({}),
      this.jobModel.countDocuments({}),
      this.resumeModel.countDocuments({}),
      this.companyModel.countDocuments({ createdAt: { $gte: since } }),
      this.userModel.countDocuments({ createdAt: { $gte: since } }),
      this.jobModel.countDocuments({ createdAt: { $gte: since } }),
      this.resumeModel.countDocuments({ createdAt: { $gte: since } }),
      this.countByField(this.resumeModel, 'status'),
      this.countByField(this.jobModel, 'level'),
      this.countByField(this.userModel, 'role'),
      this.countByField(this.permissionModel, 'module'),
      this.weeklySeries(this.resumeModel, 10),
      this.weeklySeries(this.jobModel, 10),
      this.weeklySeries(this.companyModel, 8),
      this.weeklySeries(this.userModel, 8),
      this.jobModel
        .find({})
        .sort('-createdAt')
        .limit(5)
        .select('name company location isActive')
        .lean<RecentJobLean[]>(),
      this.userModel
        .find({})
        .sort('-createdAt')
        .limit(5)
        .select('name email role')
        .populate('role', 'name')
        .lean<RecentUserLean[]>(),
      this.roleModel.find({}).select('name').lean<RoleLean[]>(),
    ]);

    const roleNameById = new Map(roles.map((r) => [String(r._id), r.name]));
    const userByRole = Object.entries(roleIdMap)
      .map(([id, value]) => ({
        name: roleNameById.get(id) ?? 'UNKNOWN',
        value,
      }))
      .sort((a, b) => b.value - a.value);

    const permByModule = Object.entries(permModuleMap)
      .map(([module, value]) => ({ module, value }))
      .sort((a, b) => b.value - a.value);

    const jobByLevel = JOB_LEVELS.reduce((acc, l) => {
      acc[l] = jobLevelMap[l] ?? 0;
      return acc;
    }, {} as LevelCounts);

    return {
      totals: { companies, users, jobs, resumes },
      new30: {
        companies: newCompanies,
        users: newUsers,
        jobs: newJobs,
        resumes: newResumes,
      },
      resumeByStatus: this.toStatusCounts(resumeStatusMap),
      jobByLevel,
      userByRole,
      permByModule,
      series: {
        labels: resSeries.labels,
        resumes: resSeries.values,
        jobs: jobSeries.values,
      },
      sparks: {
        companies: companiesSpark.values,
        users: usersSpark.values,
        jobs: jobSeries.values.slice(-8),
        resumes: resSeries.values.slice(-8),
      },
      recentJobs: recentJobs.map((j) => ({
        _id: j._id,
        name: j.name,
        company: { name: j.company?.name, logo: j.company?.logo },
        location: j.location,
        isActive: j.isActive,
      })),
      recentUsers: recentUsers.map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        role: { name: u.role?.name },
      })),
    };
  }

  // ─── HR OVERVIEW ──────────────────────────────────────────

  async hrOverview(user: IUser) {
    const companyId = user?.company?._id;
    if (!this.isAdmin(user) && !companyId) {
      throw new ForbiddenException(
        'Chỉ HR có công ty hoặc quản trị viên mới xem được thống kê này',
      );
    }

    // Scope: HR → their company; admin (no company) → global.
    const coOid = companyId
      ? new mongoose.Types.ObjectId(String(companyId))
      : null;
    const resumeScope: Record<string, unknown> = coOid
      ? { companyId: coOid }
      : {};
    const jobScope: Record<string, unknown> = coOid
      ? { 'company._id': coOid }
      : {};

    const [
      activeJobs,
      totalJobs,
      totalResumes,
      resumeStatusMap,
      resSeries,
      jobsSpark,
      pendingSpark,
      latestResumesRaw,
      recentJobs,
    ] = await Promise.all([
      this.jobModel.countDocuments({ ...jobScope, isActive: true }),
      this.jobModel.countDocuments(jobScope),
      this.resumeModel.countDocuments(resumeScope),
      this.countByField(this.resumeModel, 'status', resumeScope),
      this.weeklySeries(this.resumeModel, 10, resumeScope),
      this.weeklySeries(this.jobModel, 8, jobScope),
      this.weeklySeries(this.resumeModel, 8, {
        ...resumeScope,
        status: 'PENDING',
      }),
      this.resumeModel.aggregate<LatestResumeAgg>([
        { $match: { deleted: { $ne: true }, ...resumeScope } },
        { $sort: { createdAt: -1 } },
        { $limit: 6 },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        {
          $lookup: {
            from: 'jobs',
            localField: 'jobId',
            foreignField: '_id',
            as: 'job',
          },
        },
        {
          $project: {
            email: 1,
            status: 1,
            createdAt: 1,
            userId: 1,
            userName: {
              $ifNull: [{ $arrayElemAt: ['$user.name', 0] }, '$email'],
            },
            jobName: { $arrayElemAt: ['$job.name', 0] },
          },
        },
      ]),
      this.jobModel
        .find(jobScope)
        .sort('-createdAt')
        .limit(5)
        .select('name location level isActive createdAt')
        .lean<RecentJobLean[]>(),
    ]);

    const resumeByStatus = this.toStatusCounts(resumeStatusMap);
    const approved = resumeByStatus.APPROVED;
    const approvalRate = totalResumes
      ? Math.round((approved / totalResumes) * 100)
      : 0;

    return {
      kpis: {
        activeJobs,
        totalJobs,
        totalResumes,
        pending: resumeByStatus.PENDING,
      },
      approvalRate,
      resumeByStatus,
      series: { labels: resSeries.labels, resumes: resSeries.values },
      sparks: {
        jobs: jobsSpark.values,
        resumes: resSeries.values.slice(-8),
        pending: pendingSpark.values,
      },
      latestResumes: latestResumesRaw.map((r) => ({
        _id: r._id,
        email: r.email,
        status: r.status,
        createdAt: r.createdAt,
        userId: { _id: r.userId, name: r.userName },
        jobId: { name: r.jobName },
      })),
      recentJobs: recentJobs.map((j) => ({
        _id: j._id,
        name: j.name,
        location: j.location,
        level: j.level,
        isActive: j.isActive,
        createdAt: j.createdAt,
      })),
    };
  }
}
