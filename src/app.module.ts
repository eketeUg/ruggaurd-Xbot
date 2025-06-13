import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { XprofileInsightModule } from './xprofile-insight/xprofile-insight.module';
import { DatabaseModule } from './database/database.module';
import { TwitterClientModule } from './twitter-bot/twitter-client/twitter-client.module';
import { CacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
    CacheModule.register({ isGlobal: true }),
    TwitterClientModule,
    XprofileInsightModule,
    DatabaseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
