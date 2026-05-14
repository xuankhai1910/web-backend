import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserProfilesController } from './user-profiles.controller';
import { UserProfilesService } from './user-profiles.service';
import { UserProfile, UserProfileSchema } from './schemas/user-profile.schema';
import { User, UserSchema } from 'src/users/schemas/user.schema';
import { ProfileEmbeddingService } from './profile-embedding.service';
import { CvAnalysisModule } from 'src/cv-analysis/cv-analysis.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserProfile.name, schema: UserProfileSchema },
      { name: User.name, schema: UserSchema },
    ]),
    CvAnalysisModule,
  ],
  controllers: [UserProfilesController],
  providers: [UserProfilesService, ProfileEmbeddingService],
  exports: [UserProfilesService, ProfileEmbeddingService, MongooseModule],
})
export class UserProfilesModule {}
