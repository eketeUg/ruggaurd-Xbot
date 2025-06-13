import { Module } from '@nestjs/common';
import { XprofileInsightService } from './xprofile-insight.service';

@Module({
  providers: [XprofileInsightService]
})
export class XprofileInsightModule {}
