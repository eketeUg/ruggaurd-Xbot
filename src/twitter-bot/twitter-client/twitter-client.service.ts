import { Injectable, Logger } from '@nestjs/common';

import { TwitterClientBase } from './base.provider';
import { TwitterClientInteractions } from './twitter-interaction.provider';

@Injectable()
export class TwitterClientService {
  private readonly logger = new Logger(TwitterClientService.name);

  constructor(
    private readonly twitterClientBase: TwitterClientBase,
    private readonly twitterClientInteractions: TwitterClientInteractions,
  ) {
    this.twitterClientBase
      .init()
      .then(() => {
        this.logger.log('Twitter client initialized');
      })
      .catch((error) => {
        this.logger.error('Error initializing Twitter client:', error);
      });
    this.twitterClientInteractions.start();
  }
}
