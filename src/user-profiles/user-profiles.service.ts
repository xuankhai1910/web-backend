import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { FilterQuery } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import type { SoftDeleteModel } from 'mongoose-delete';
import {
  UserProfile,
  UserProfileDocument,
} from './schemas/user-profile.schema';
import { CreateUserProfileDto } from './dto/create-user-profile.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import type { IUser } from 'src/users/users.interface';
import { User, UserDocument } from 'src/users/schemas/user.schema';
import { ProfileEmbeddingService } from './profile-embedding.service';

@Injectable()
export class UserProfilesService {
  private readonly logger = new Logger(UserProfilesService.name);

  constructor(
    @InjectModel(UserProfile.name)
    private profileModel: SoftDeleteModel<UserProfileDocument>,
    @InjectModel(User.name)
    private userModel: SoftDeleteModel<UserDocument>,
    private readonly profileEmbedding: ProfileEmbeddingService,
  ) {}

  /** Fire-and-forget embedding refresh — never blocks the response. */
  private scheduleEmbeddingRefresh(profileId: unknown) {
    void this.profileEmbedding.refreshEmbedding(profileId);
  }

  // ─── HELPERS ──────────────────────────────────────────────

  private isAdminOrHr(user: IUser): boolean {
    const role = user?.role?.name?.toUpperCase();
    return role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';
  }

  private async syncJobSeekingWithPublicProfile(
    dto: Pick<CreateUserProfileDto, 'isPublic'>,
    user: IUser,
  ) {
    if (typeof dto.isPublic !== 'boolean') return;
    await this.userModel.updateOne(
      { _id: user._id },
      {
        isJobSeeking: dto.isPublic,
        updatedBy: { _id: user._id, email: user.email },
      },
    );
  }

  /**
   * Compute completion score (0-100) by section weight:
   *  personalInfo 20, summary 10, experiences 25, education 15,
   *  skills 15, projects 10, certifications 5
   */
  private computeCompletionScore(profile: Partial<UserProfile>): number {
    let score = 0;
    const p = profile.personalInfo;
    if (p && (p.fullName || p.email || p.phone || p.address)) score += 20;
    if (profile.summary && profile.summary.trim().length > 0) score += 10;
    if (profile.experiences && profile.experiences.length > 0) score += 25;
    if (profile.education && profile.education.length > 0) score += 15;
    if (profile.skills && profile.skills.length > 0) score += 15;
    if (profile.projects && profile.projects.length > 0) score += 10;
    if (profile.certifications && profile.certifications.length > 0) score += 5;
    return Math.min(score, 100);
  }

  // ─── CRUD ─────────────────────────────────────────────────

  /**
   * Upsert profile by userId. Each user has exactly one profile.
   */
  async upsert(dto: CreateUserProfileDto, user: IUser) {
    const existing = await this.profileModel.findOne({ userId: user._id });

    const merged: Partial<UserProfile> = {
      ...(existing ? existing.toObject() : {}),
      ...dto,
    } as Partial<UserProfile>;
    const completionScore = this.computeCompletionScore(merged);

    if (existing) {
      await this.profileModel.updateOne(
        { _id: existing._id },
        {
          ...dto,
          completionScore,
          updatedBy: { _id: user._id, email: user.email },
        },
      );
      await this.syncJobSeekingWithPublicProfile(dto, user);
      this.scheduleEmbeddingRefresh(existing._id);
      return this.profileModel.findById(existing._id);
    }

    const created = await this.profileModel.create({
      ...dto,
      userId: user._id,
      completionScore,
      createdBy: { _id: user._id, email: user.email },
    } as Partial<UserProfile>);

    // Link profileId on user
    await this.userModel.updateOne(
      { _id: user._id },
      {
        profileId: created._id,
        ...(typeof dto.isPublic === 'boolean'
          ? { isJobSeeking: dto.isPublic }
          : {}),
      },
    );

    this.scheduleEmbeddingRefresh(created._id);
    return created;
  }

  async findMine(user: IUser) {
    const profile = await this.profileModel.findOne({ userId: user._id });
    if (!profile) {
      throw new NotFoundException('Bạn chưa tạo hồ sơ CV');
    }
    return profile;
  }

  async patchMine(dto: UpdateUserProfileDto, user: IUser) {
    const existing = await this.profileModel.findOne({ userId: user._id });
    if (!existing) {
      throw new NotFoundException('Bạn chưa tạo hồ sơ CV');
    }

    // Merge for completionScore calculation
    const merged: Partial<UserProfile> = {
      ...existing.toObject(),
      ...dto,
    } as Partial<UserProfile>;
    const completionScore = this.computeCompletionScore(merged);

    await this.profileModel.updateOne(
      { _id: existing._id },
      {
        ...dto,
        completionScore,
        updatedBy: { _id: user._id, email: user.email },
      },
    );
    await this.syncJobSeekingWithPublicProfile(dto, user);
    this.scheduleEmbeddingRefresh(existing._id);
    return this.profileModel.findById(existing._id);
  }

  async removeMine(user: IUser) {
    const existing = await this.profileModel.findOne({ userId: user._id });
    if (!existing) {
      throw new NotFoundException('Bạn chưa tạo hồ sơ CV');
    }
    await this.profileModel.updateOne(
      { _id: existing._id },
      { deletedBy: { _id: user._id, email: user.email } },
    );
    await this.profileModel.delete({ _id: existing._id });
    await this.userModel.updateOne(
      { _id: user._id },
      { isJobSeeking: false, $unset: { profileId: '' } },
    );
    return { deleted: true };
  }

  async findOne(id: string, user: IUser | undefined) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('ID hồ sơ không hợp lệ');
    }
    const profile = await this.profileModel.findById(id);
    if (!profile) {
      throw new NotFoundException('Không tìm thấy hồ sơ CV');
    }
    const isOwner = user && profile.userId?.toString() === user._id?.toString();
    if (!profile.isPublic && !isOwner && !(user && this.isAdminOrHr(user))) {
      throw new ForbiddenException('Hồ sơ này không công khai');
    }
    return profile;
  }

  async findPublicByUserId(userId: string) {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('ID người dùng không hợp lệ');
    }

    const foundUser = await this.userModel
      .findById(userId)
      .select('_id name isJobSeeking profileId')
      .lean();

    if (!foundUser) {
      throw new NotFoundException('Hồ sơ này hiện chưa khả dụng');
    }

    const publicProfileFilter: FilterQuery<UserProfileDocument> = {
      userId: new mongoose.Types.ObjectId(userId),
      isPublic: true,
    };
    const profile = await this.profileModel.findOne(publicProfileFilter).lean();

    if (!profile) {
      throw new NotFoundException('Hồ sơ này hiện chưa khả dụng');
    }

    const publicPersonalInfo = { ...(profile.personalInfo || {}) } as Partial<
      UserProfile['personalInfo']
    >;
    delete publicPersonalInfo.dateOfBirth;

    return {
      user: {
        _id: foundUser._id,
        name: foundUser.name,
        isJobSeeking: true,
      },
      profile: {
        _id: profile._id,
        userId: profile.userId,
        title: profile.title,
        personalInfo: publicPersonalInfo,
        summary: profile.summary,
        experiences: profile.experiences,
        education: profile.education,
        projects: profile.projects,
        skills: profile.skills,
        certifications: profile.certifications,
        awards: profile.awards,
        languages: profile.languages,
        templateId: profile.templateId,
        isPublic: profile.isPublic,
        completionScore: profile.completionScore,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
    };
  }

  /**
   * Internal helper for ResumesService: find profile by user id
   * (used when applying with a `profile:<userId>` URL).
   */
  async findByUserId(userId: string | mongoose.Types.ObjectId) {
    const filter: FilterQuery<UserProfileDocument> = { userId };
    return this.profileModel.findOne(filter);
  }

  // ─── EXPORT TO FILE ───────────────────────────────────────

  /**
   * Render profile to a printable HTML file under public/images/pdf.
   * Returns the public file path. The frontend / a separate worker can
   * convert this to PDF (puppeteer / browser print). Keeping the implementation
   * dependency-free preserves the project's current toolchain.
   */
  async exportPdfMine(user: IUser) {
    const profile = await this.findMine(user);
    const html = this.renderHtml(profile);

    const baseDir = path.join(process.cwd(), 'public', 'images', 'pdf');
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const fileName = `profile-${user._id}-${Date.now()}.html`;
    const filePath = path.join(baseDir, fileName);
    fs.writeFileSync(filePath, html, 'utf8');

    return {
      fileName,
      filePath: `images/pdf/${fileName}`,
      url: `/images/pdf/${fileName}`,
      templateId: profile.templateId,
    };
  }

  /**
   * Resolve a profile reference URL (`profile:<userId>` or just `profile:`)
   * into a generated HTML/PDF artifact stored under public/images/pdf.
   * Returns the relative URL to be saved in the Resume document.
   */
  async resolveProfileUrl(refUrl: string, user: IUser): Promise<string> {
    if (!refUrl?.startsWith('profile:')) {
      throw new BadRequestException('URL hồ sơ không hợp lệ');
    }
    const refUserId =
      refUrl.slice('profile:'.length).trim() || String(user._id);
    if (refUserId !== String(user._id)) {
      throw new ForbiddenException('Bạn chỉ có thể dùng hồ sơ của chính mình');
    }
    const profile = await this.profileModel.findOne({ userId: user._id });
    if (!profile) {
      throw new NotFoundException('Bạn chưa tạo hồ sơ CV');
    }

    const html = this.renderHtml(profile);
    const baseDir = path.join(process.cwd(), 'public', 'images', 'pdf');
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    const fileName = `profile-${user._id}-${Date.now()}.html`;
    const filePath = path.join(baseDir, fileName);
    fs.writeFileSync(filePath, html, 'utf8');
    return `images/pdf/${fileName}`;
  }

  private esc(s: unknown): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private fmtDate(d: unknown): string {
    if (!d) return '';
    const dt = new Date(d as string);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString('vi-VN', {
      month: '2-digit',
      year: 'numeric',
    });
  }

  private renderHtml(profile: UserProfile): string {
    const p = profile.personalInfo || ({} as UserProfile['personalInfo']);
    const exp = (profile.experiences || [])
      .map(
        (e) => `
        <div class="item">
          <h4>${this.esc(e.position)} — ${this.esc(e.company)}</h4>
          <div class="meta">${this.fmtDate(e.startDate)} - ${
            e.isCurrent ? 'Hiện tại' : this.fmtDate(e.endDate)
          }</div>
          <p>${this.esc(e.description)}</p>
        </div>`,
      )
      .join('');

    const edu = (profile.education || [])
      .map(
        (e) => `
        <div class="item">
          <h4>${this.esc(e.degree)} - ${this.esc(e.field)}</h4>
          <div class="meta">${this.esc(e.school)} | ${this.fmtDate(
            e.startDate,
          )} - ${this.fmtDate(e.endDate)}</div>
          <p>${this.esc(e.description)}</p>
        </div>`,
      )
      .join('');

    const skills = (profile.skills || [])
      .map(
        (s) =>
          `<span class="chip">${this.esc(s.name)}${
            s.level ? ` (${this.esc(s.level)})` : ''
          }</span>`,
      )
      .join(' ');

    const projects = (profile.projects || [])
      .map(
        (pr) => `
        <div class="item">
          <h4>${this.esc(pr.name)}${pr.role ? ` — ${this.esc(pr.role)}` : ''}</h4>
          <div class="meta">${(pr.techStack || []).map((t) => this.esc(t)).join(', ')}</div>
          <p>${this.esc(pr.description)}</p>
          ${pr.url ? `<a href="${this.esc(pr.url)}">${this.esc(pr.url)}</a>` : ''}
        </div>`,
      )
      .join('');

    const certs = (profile.certifications || [])
      .map(
        (c) =>
          `<li>${this.esc(c.name)} — ${this.esc(c.issuer)} (${this.fmtDate(c.date)})</li>`,
      )
      .join('');

    const langs = (profile.languages || [])
      .map((l) => `<li>${this.esc(l.name)}: ${this.esc(l.proficiency)}</li>`)
      .join('');

    return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<title>${this.esc(p.fullName || profile.title || 'CV')}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; color:#222; max-width:800px; margin:24px auto; padding:24px; }
  h1 { margin:0; font-size:28px; }
  h2 { border-bottom:2px solid #2563eb; padding-bottom:4px; margin-top:24px; color:#2563eb; }
  h4 { margin:8px 0 4px; }
  .meta { color:#666; font-size:13px; }
  .chip { display:inline-block; background:#eef2ff; color:#3730a3; padding:3px 8px; border-radius:6px; font-size:13px; margin:2px; }
  .item { margin-bottom:12px; }
  .header { border-bottom:1px solid #e5e7eb; padding-bottom:12px; }
  .contact { color:#555; font-size:14px; }
  @media print { body { margin:0; } }
</style>
<script>
  // Auto-open the browser's print/Save-as-PDF dialog when the user opens this file.
  window.addEventListener('load', function () {
    setTimeout(function () { try { window.focus(); window.print(); } catch (e) {} }, 250);
  });
</script>
</head>
<body>
  <div class="header">
    <h1>${this.esc(p.fullName || profile.title)}</h1>
    <div class="contact">
      ${p.email ? this.esc(p.email) : ''}
      ${p.phone ? ' | ' + this.esc(p.phone) : ''}
      ${p.address ? ' | ' + this.esc(p.address) : ''}
    </div>
    <div class="contact">
      ${p.github ? `<a href="${this.esc(p.github)}">GitHub</a>` : ''}
      ${p.linkedin ? ` <a href="${this.esc(p.linkedin)}">LinkedIn</a>` : ''}
      ${p.portfolio ? ` <a href="${this.esc(p.portfolio)}">Portfolio</a>` : ''}
    </div>
  </div>

  ${profile.summary ? `<h2>Giới thiệu</h2><p>${this.esc(profile.summary)}</p>` : ''}
  ${exp ? `<h2>Kinh nghiệm</h2>${exp}` : ''}
  ${edu ? `<h2>Học vấn</h2>${edu}` : ''}
  ${skills ? `<h2>Kỹ năng</h2><div>${skills}</div>` : ''}
  ${projects ? `<h2>Dự án</h2>${projects}` : ''}
  ${certs ? `<h2>Chứng chỉ</h2><ul>${certs}</ul>` : ''}
  ${langs ? `<h2>Ngôn ngữ</h2><ul>${langs}</ul>` : ''}
</body>
</html>`;
  }
}
