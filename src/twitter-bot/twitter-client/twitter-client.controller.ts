import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { TwitterClientBase } from './base.provider';

@Controller('twitter-client')
export class TwitterClientController {
  constructor(private readonly twitterService: TwitterClientBase) {}

  @Get()
  async getFollowings(
    @Query('username') username: string,
    @Query('count') count: number,
  ) {
    if (!username || !count) {
      throw new BadRequestException('Username and count are required');
    }

    const result = await this.twitterService.fetchFollowings(
      username,
      Number(count),
    );

    return {
      message: `Fetched followings for ${username}`,
      data: result,
    };
  }
}
