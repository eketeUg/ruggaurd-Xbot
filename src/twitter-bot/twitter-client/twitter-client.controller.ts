import { Body, Controller, Post } from '@nestjs/common';
import { ParseCommandService } from './parse-command';

@Controller('twitter-client')
export class TwitterClientController {
  constructor(private readonly handleDefiService: ParseCommandService) {}
  @Post()
  quote(@Body() payload: { prompt: string }) {
    console.log(payload.prompt);
    return this.handleDefiService.handleTweetCommand(
      payload.prompt,
      '1881784875478630400',
    );
  }
}
