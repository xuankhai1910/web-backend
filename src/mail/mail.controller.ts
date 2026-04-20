import { Controller, Get, Inject } from '@nestjs/common';
import { Public, ResponseMessage } from 'src/decorators/customize';
import { MailerService } from '@nestjs-modules/mailer';
import type { SoftDeleteModel } from 'mongoose-delete';
import { Subscriber } from 'src/subscribers/schemas/subscriber.schema';
import type { SubscriberDocument } from 'src/subscribers/schemas/subscriber.schema';
import { Job } from 'src/jobs/schemas/job.schema';
import type { JobDocument } from 'src/jobs/schemas/job.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';

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
            salary:
              `${item.salary}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' đ',
            skills: item.skills,
          };
        });
        await this.mailerService.sendMail({
          to: 'xuankhai19102004@gmail.com',
          from: '"Support Team" <support@example.com>', // override default from
          subject: 'Welcome to Nice App! Confirm your Email',
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
