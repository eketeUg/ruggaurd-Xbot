import { Module } from '@nestjs/common';
import { TwitterClientService } from './twitter-client.service';
import { TwitterClientController } from './twitter-client.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Memory, MemorySchema } from 'src/database/schemas/memory.schema';
import { TwitterClientBase } from './base.provider';
import { TwitterClientInteractions } from './trigger-listening.provider';
import { XprofileInsightModule } from 'src/xprofile-insight/xprofile-insight.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Memory.name, schema: MemorySchema }]),
    XprofileInsightModule,
  ],
  providers: [
    TwitterClientService,
    TwitterClientBase,
    TwitterClientInteractions,
  ],
  controllers: [TwitterClientController],
})
export class TwitterClientModule {}
