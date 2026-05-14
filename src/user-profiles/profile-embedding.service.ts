import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { SoftDeleteModel } from 'mongoose-delete';
import { CvEmbeddingService } from 'src/cv-analysis/cv-embedding.service';
import {
  UserProfile,
  UserProfileDocument,
} from './schemas/user-profile.schema';

/**
 * Builds a normalized text representation of a user profile and manages
 * its semantic embedding (cached on the document, re-generated only when
 * the source text actually changes).
 */
@Injectable()
export class ProfileEmbeddingService {
  private readonly logger = new Logger(ProfileEmbeddingService.name);

  constructor(
    @InjectModel(UserProfile.name)
    private profileModel: SoftDeleteModel<UserProfileDocument>,
    private readonly embedding: CvEmbeddingService,
  ) {}

  /**
   * Concatenate the searchable fields of a profile into a single string
   * suitable for embedding. Mirrors `CvEmbeddingService.buildCvText`.
   */
  buildProfileText(profile: Partial<UserProfile>): string {
    const skills = (profile.skills || [])
      .map((s) => s?.name)
      .filter(Boolean)
      .join(', ');

    const positions = (profile.experiences || [])
      .map((e) => e?.position)
      .filter(Boolean)
      .join(', ');

    const experienceText = (profile.experiences || [])
      .map((e) => e?.description)
      .filter(Boolean)
      .join('. ');

    const techStacks = Array.from(
      new Set(
        (profile.projects || [])
          .flatMap((p) => p?.techStack || [])
          .filter(Boolean),
      ),
    ).join(', ');

    const fields = (profile.education || [])
      .map((e) => e?.field)
      .filter(Boolean)
      .join(', ');

    const certifications = (profile.certifications || [])
      .map((c) => c?.name)
      .filter(Boolean)
      .join(', ');

    const parts = [
      profile.summary || '',
      skills ? `Skills: ${skills}` : '',
      positions ? `Positions: ${positions}` : '',
      techStacks ? `Tech stack: ${techStacks}` : '',
      fields ? `Education fields: ${fields}` : '',
      certifications ? `Certifications: ${certifications}` : '',
      experienceText,
    ];

    return parts
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join('. ');
  }

  /**
   * Regenerate the embedding for the given profile if and only if its
   * source text has changed since the last embed. Best-effort: errors
   * are logged but never re-thrown (graceful degrade).
   */
  async refreshEmbedding(profileId: unknown): Promise<void> {
    try {
      const profile = await this.profileModel.findById(profileId as never);
      if (!profile) return;

      const text = this.buildProfileText(profile.toObject());
      if (!text) return;

      const hash = this.embedding.computeTextHash(text);
      if (
        hash === profile.embeddingHash &&
        profile.embedding &&
        profile.embedding.length > 0
      ) {
        return; // unchanged — nothing to do
      }

      if (!this.embedding.isAvailable()) {
        this.logger.debug('Embedding API unavailable — skipping profile embed');
        return;
      }

      const vector = await this.embedding.embed(text);
      if (!vector.length) return;

      await this.profileModel.updateOne(
        { _id: profile._id },
        { embedding: vector, embeddingHash: hash },
      );
      this.logger.debug(`Refreshed embedding for profile ${profile._id}`);
    } catch (err) {
      this.logger.warn(
        `Failed to refresh profile embedding: ${(err as Error)?.message}`,
      );
    }
  }
}
