import { Controller, Get, Inject } from '@nestjs/common';
import { Public, ResponseMessage } from 'src/decorators/customize';
import { MailerService } from '@nestjs-modules/mailer';
import type { SoftDeleteModel } from 'mongoose-delete';
import { Subscriber } from 'src/subscribers/schemas/subscriber.schema';
import type { SubscriberDocument } from 'src/subscribers/schemas/subscriber.schema';
import { Job } from 'src/jobs/schemas/job.schema';
import type { JobDocument, JobSalary } from 'src/jobs/schemas/job.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';

/**
 * Format a job's salary block for display in an email.
 *  - Negotiable → "Thỏa thuận".
 *  - Range with both min and max → "10,000,000 - 20,000,000 VND".
 *  - Only min → "Từ 10,000,000 VND". Only max → "Tối đa 20,000,000 VND".
 */
function formatSalary(salary?: JobSalary): string {
  if (!salary || salary.isNegotiable) return 'Thỏa thuận';
  const currency = salary.currency || 'VND';
  const fmt = (n: number) =>
    `${n}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' ' + currency;
  if (typeof salary.min === 'number' && typeof salary.max === 'number') {
    return `${fmt(salary.min)} - ${fmt(salary.max)}`;
  }
  if (typeof salary.min === 'number') return `Từ ${fmt(salary.min)}`;
  if (typeof salary.max === 'number') return `Tối đa ${fmt(salary.max)}`;
  return 'Thỏa thuận';
}

@Controller('mail')
export class MailController {
  constructor(
    @Inject(MailerService)
    private mailerService: MailerService,
    @InjectModel(Subscriber.name)
    private subscriberModel: SoftDeleteModel<SubscriberDocument>,
    @InjectModel(Job.name) private jobModel: SoftDeleteModel<JobDocument>,
  ) {}

  @Get()
  @Public()
  @ResponseMessage('Test email')
  @Cron('0 0 0 * * 0')
  async handleTestEmail() {
    const now = new Date();
    const subscribers = await this.subscriberModel.find({});
    for (const subs of subscribers) {
      const subsSkills = subs.skills;
      const jobWithMatchingSkills = await this.jobModel.find({
        skills: { $in: subsSkills },
        isActive: true,
        endDate: { $gte: now },
      });
      if (jobWithMatchingSkills?.length) {
        const jobs = jobWithMatchingSkills.map((item) => {
          return {
            name: item.name,
            company: item.company?.name,
            salary: formatSalary(item.salary),
            skills: item.skills,
          };
        });
        await this.mailerService.sendMail({
          to: subs.email,
          from: '"Support Team" <support@example.com>', // override default from
          subject: 'Gợi ý việc làm mới cho bạn',
          template: 'new-job',
          context: {
            receiver: subs.name,
            jobs: jobs,
          },
        });
      }
    }
  }
}
