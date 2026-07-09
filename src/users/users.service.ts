import {
  BadRequestException,
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { CreateUserDto, RegisterUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from './schemas/user.schema';
import mongoose, { Model } from 'mongoose';
import bcrypt, { compareSync } from 'node_modules/bcryptjs';
import type { SoftDeleteModel } from 'mongoose-delete';
import aqp from 'api-query-params';
import type { IUser } from './users.interface';
import { User as UserDecorator } from 'src/decorators/customize';
import { USER_ROLE } from 'src/databases/sample';
import { Role, RoleDocument } from 'src/roles/schemas/role.schema';
import { CvAnalysisService } from 'src/cv-analysis/cv-analysis.service';
import { SetRecommendationCvDto } from './dto/recommendation-cv.dto';
import { UpdateJobSeekingDto } from './dto/job-seeking.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: SoftDeleteModel<UserDocument>,
    @InjectModel(Role.name) private roleModel: SoftDeleteModel<RoleDocument>,
    @Inject(forwardRef(() => CvAnalysisService))
    private cvAnalysisService: CvAnalysisService,
  ) {}

  getHashPassword = (password: string) => {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    return hash;
  };
  async create(createUserDto: CreateUserDto, @UserDecorator() User: IUser) {
    const isExist = await this.userModel.findOne({
      email: createUserDto.email,
    });
    if (isExist) {
      throw new BadRequestException(
        `Email: ${createUserDto.email} already exists`,
      );
    }
    const hashPassword = this.getHashPassword(createUserDto.password);
    const user = await this.userModel.create({
      ...createUserDto,
      password: hashPassword,
      createdBy: { _id: User._id, email: User.email },
    });
    return { _id: user._id, createdAt: user.createdAt };
  }

  async register(registerUserDto: RegisterUserDto) {
    const isExist = await this.userModel.findOne({
      email: registerUserDto.email,
    });
    if (isExist) {
      throw new BadRequestException(
        `Email: ${registerUserDto.email} already exists`,
      );
    }

    const hashPassword = this.getHashPassword(registerUserDto.password);
    const user = await this.userModel.create({
      ...registerUserDto,
      password: hashPassword,
    } as any);
    return { _id: user._id, createdAt: user.createdAt };
  }

  // Tìm hoặc tạo user khi đăng nhập bằng Google.
  // - Email chưa tồn tại  -> tạo user mới (provider='google', role mặc định NORMAL_USER).
  // - Email đã tồn tại     -> liên kết googleId vào tài khoản đó (giữ nguyên role).
  // Trả về user kèm permissions để truyền thẳng vào AuthService.login.
  async findOrCreateGoogleUser(profile: {
    email: string;
    name: string;
    googleId: string;
    avatar?: string;
  }) {
    let user = await this.userModel.findOne({ email: profile.email });

    if (!user) {
      const userRole = await this.roleModel.findOne({ name: USER_ROLE });
      if (!userRole) {
        throw new BadRequestException(
          'Vai trò người dùng mặc định chưa được khởi tạo',
        );
      }
      user = await this.userModel.create({
        email: profile.email,
        name: profile.name,
        avatar: profile.avatar,
        provider: 'google',
        googleId: profile.googleId,
        role: userRole._id,
      } as any);
    } else if (!user.googleId) {
      // Liên kết tài khoản local hiện có với Google
      user.googleId = profile.googleId;
      user.provider = 'google';
      if (!user.avatar && profile.avatar) {
        user.avatar = profile.avatar;
      }
      await user.save();
    }

    const roleWithPermissions = await this.roleModel
      .findById(user.role)
      .populate({ path: 'permissions' });

    return {
      ...user.toObject(),
      role: {
        _id: roleWithPermissions?._id,
        name: (roleWithPermissions as any)?.name,
      },
      permissions: (roleWithPermissions as any)?.permissions ?? [],
    };
  }

  async findAll(currentPage: number, limit: number, qs: string) {
    const { filter, sort, projection, population } = aqp(qs);
    delete filter.current;
    delete filter.pageSize;
    const offset = (+currentPage - 1) * +limit;
    const defaultLimit = Math.min(+limit ? +limit : 10, 100);
    const stableSort =
      sort && Object.keys(sort).length > 0 ? { ...(sort as any) } : {};
    if (!stableSort._id) {
      const firstDirection =
        Object.values(stableSort).find(
          (value) => value === 1 || value === -1,
        ) ?? -1;
      stableSort._id = firstDirection;
    }

    const collation = { locale: 'vi', strength: 1 };

    const totalItems = await this.userModel
      .countDocuments(filter)
      .collation(collation);
    const totalPages = Math.ceil(totalItems / defaultLimit);

    const result = await this.userModel
      .find(filter)
      .collation(collation)
      .skip(offset)
      .limit(defaultLimit)
      .sort(stableSort)
      .select(
        '-password -refreshToken -passwordResetToken -passwordResetExpires',
      )
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

  findOne(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return new Error('Invalid user ID');
    }
    return this.userModel
      .findOne({
        _id: id,
      })
      .select(
        '-password -refreshToken -passwordResetToken -passwordResetExpires',
      )
      .populate({ path: 'role', select: { name: 1, _id: 1 } });
  }

  findOneByUsername(username: string) {
    return this.userModel
      .findOne({
        email: username,
      })
      .select('-refreshToken -passwordResetToken -passwordResetExpires')
      .populate({ path: 'role', select: { name: 1 } });
  }

  findOneByEmail(email: string) {
    return this.userModel.findOne({ email });
  }

  findByIdWithPassword(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user id');
    }
    return this.userModel.findById(id);
  }

  isValidPassword(password: string, hash: string) {
    return compareSync(password, hash);
  }

  setPasswordResetToken = async (
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ) => {
    return this.userModel.updateOne(
      { _id: userId },
      {
        passwordResetToken: tokenHash,
        passwordResetExpires: expiresAt,
      },
    );
  };

  findUserByPasswordResetToken = async (tokenHash: string) => {
    return this.userModel
      .findOne({
        passwordResetToken: tokenHash,
        passwordResetExpires: { $gt: new Date() },
      })
      .select('+passwordResetToken +passwordResetExpires');
  };

  updatePassword = async (
    userId: string,
    password: string,
    options?: { clearRefreshToken?: boolean },
  ) => {
    const hashPassword = this.getHashPassword(password);
    const update: Record<string, unknown> = {
      password: hashPassword,
    };

    if (options?.clearRefreshToken) {
      update.refreshToken = '';
    }

    return this.userModel.updateOne(
      { _id: userId },
      {
        $set: update,
        $unset: {
          passwordResetToken: '',
          passwordResetExpires: '',
        },
      },
    );
  };

  async update(
    updateUserDto: UpdateUserDto,
    @UserDecorator() user: IUser,
    _id: string,
  ) {
    if (!mongoose.Types.ObjectId.isValid(_id)) {
      return new BadRequestException(`Invalid user ID : ${_id}`);
    }
    return this.userModel.updateOne(
      {
        _id: _id,
      },
      {
        ...updateUserDto,
        updatedBy: { _id: user._id, email: user.email },
      },
    );
  }

  async remove(id: string, user: IUser) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user id');
    }
    const foundUser = await this.userModel.findById(id);
    if (foundUser && foundUser?.email === 'admin@gmail.com') {
      throw new BadRequestException('Cannot delete admin email');
    }
    await this.userModel.updateOne(
      { _id: id },
      { deletedBy: { _id: user._id, email: user.email } },
    );
    return this.userModel.delete({ _id: id });
  }

  updateUserToken = async (refreshToken: string, _id: string) => {
    return await this.userModel.updateOne({ _id }, { refreshToken });
  };

  findUserByToken = async (refreshToken: string) => {
    return await this.userModel.findOne({ refreshToken }).populate({
      path: 'role',
      select: { name: 1 },
    });
  };

  // ─── JOB SEEKING ────────────────────────────────────────

  async updateJobSeeking(dto: UpdateJobSeekingDto, user: IUser) {
    await this.userModel.updateOne(
      { _id: user._id },
      {
        isJobSeeking: dto.isJobSeeking,
        updatedBy: { _id: user._id, email: user.email },
      },
    );
    return { isJobSeeking: dto.isJobSeeking };
  }

  // ─── RECOMMENDATION CV ──────────────────────────────────

  /**
   * Set (or update) the user's recommendation CV. Accepts a URL from either
   * a newly uploaded file or an existing resume. Triggers CV analysis.
   */
  async setRecommendationCv(dto: SetRecommendationCvDto, user: IUser) {
    const { url, source = 'upload' } = dto;

    // Analyze the CV (uses cache by file hash, so safe to re-call)
    const analysis = await this.cvAnalysisService.analyzeCv(url, user);

    const recommendationCv = {
      resumeUrl: url,
      analysisId: analysis._id,
      source,
      updatedAt: new Date(),
    };

    await this.userModel.updateOne(
      { _id: user._id },
      {
        recommendationCv,
        updatedBy: { _id: user._id, email: user.email },
      },
    );

    return {
      recommendationCv,
      analysis,
    };
  }

  /**
   * Get the current recommendation CV for the user (with its analysis).
   */
  async getRecommendationCv(user: IUser) {
    const foundUser = await this.userModel
      .findById(user._id)
      .select('recommendationCv')
      .lean();

    if (!foundUser?.recommendationCv?.analysisId) {
      return { recommendationCv: null, analysis: null };
    }

    const analysis = await this.cvAnalysisService.findById(
      foundUser.recommendationCv.analysisId.toString(),
    );

    return {
      recommendationCv: foundUser.recommendationCv,
      analysis,
    };
  }

  /**
   * Clear the user's recommendation CV.
   */
  async removeRecommendationCv(user: IUser) {
    await this.userModel.updateOne(
      { _id: user._id },
      { $unset: { recommendationCv: '' } },
    );
    return { deleted: true };
  }
}
