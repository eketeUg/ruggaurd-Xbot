import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { XprofileInsightModule } from './xprofile-insight/xprofile-insight.module';
import { DatabaseModule } from './database/database.module';
import { TwitterClientModule } from './twitter-bot/twitter-client/twitter-client.module';

@Module({
  imports: [TwitterClientModule, , XprofileInsightModule, DatabaseModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
