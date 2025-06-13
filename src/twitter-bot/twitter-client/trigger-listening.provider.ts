import { Inject, Injectable, Logger } from '@nestjs/common';
// import { twitterLogger } from './utils/logger.util';

import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Memory } from 'src/database/schemas/memory.schema';
import { TwitterClientBase } from './base.provider';
import { twitterConfig } from 'src/common/config/twitter.config';
import { SearchMode, Tweet } from 'agent-twitter-client';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Content, IMemory } from './interfaces/client.interface';
import { XprofileInsightService } from 'src/xprofile-insight/xprofile-insight.service';

const MAX_TWEET_LENGTH = 280;

@Injectable()
export class TwitterClientInteractions {
  private readonly logger = new Logger(TwitterClientInteractions.name);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly twitterClientBase: TwitterClientBase,
    private readonly profileAnalysis: XprofileInsightService,
    @InjectModel(Memory.name) private readonly memoryModel: Model<Memory>,
  ) {}

  async start() {
    const handleTwitterInteractionsLoop = () => {
      this.handleTwitterInteractions();
      setTimeout(
        handleTwitterInteractionsLoop,
        Number(twitterConfig.TWITTER_POLL_INTERVAL || 30) * 1000, // Default to 2 minutes
      );
    };
    handleTwitterInteractionsLoop();
  }

  async handleTwitterInteractions() {
    this.logger.log('Checking Twitter interactions');

    const twitterUsername = twitterConfig.TWITTER_USERNAME;
    const searchQuery = `@${twitterUsername} riddle me this`;
    try {
      // Check for mentions
      const tweetCandidates = //TODO:remove bot username from search query
        (
          await this.twitterClientBase.fetchSearchTweets(
            `${searchQuery}`,
            20, //number of tweets to pull
            SearchMode.Latest,
          )
        ).tweets;

      // de-duplicate tweetCandidates with a set
      const uniqueTweetCandidates = [...new Set(tweetCandidates)];

      // Sort tweet candidates by ID in ascending order
      uniqueTweetCandidates
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((tweet) => tweet.userId !== twitterConfig.TWITTER_USERNAME);
      // console.log('tweets \n :', uniqueTweetCandidates);

      // for each tweet candidate, handle the tweet
      for (const tweet of uniqueTweetCandidates) {
        if (
          !this.twitterClientBase.lastCheckedTweetId ||
          BigInt(tweet.id) > this.twitterClientBase.lastCheckedTweetId
        ) {
          // Generate the tweetId UUID the same way it's done in handleTweet
          const tweetId = this.getTweetId(tweet.id);
          // Check if we've already processed this tweet
          const existingResponse = await this.memoryModel
            .findOne({
              id: tweetId,
            })
            .exec();

          if (existingResponse) {
            this.logger.log(`Already responded to tweet ${tweet.id}, skipping`);
            continue;
          }
          this.logger.log('New Tweet found', tweet.permanentUrl);

          // this.logger.log(tweet);
          this.logger.log(`this is the user tweet  :, ${tweet.text}`);

          const message = {
            content: { text: tweet.text },
          };

          await this.handleTweet({
            tweet,
            message,
          });

          // Update the last checked tweet ID after processing each tweet
          this.twitterClientBase.lastCheckedTweetId = BigInt(tweet.id);
        }
      }

      // Save the latest checked tweet ID to the file
      await this.twitterClientBase.cacheLatestCheckedTweetId();

      this.logger.log('Finished checking Twitter interactions');
    } catch (error) {
      this.logger.error('Error handling Twitter interactions:', error);
    }
  }

  private async handleTweet({
    tweet,
    message,
  }: {
    tweet: Tweet;
    message: IMemory;
  }) {
    if (tweet.userId === process.env.TWITTER_ID) {
      this.logger.log('skipping tweet from bot itself', tweet.id);
      // Skip processing if the tweet is from the bot itself
      return;
    }

    if (!message.content.text) {
      this.logger.log(`Skipping Tweet with no text, ${tweet.id}`);
      return { text: '', action: 'IGNORE' };
    }

    this.logger.log(`Processing Tweet: , ${tweet.id}`);
    //   const formatTweet = (tweet: Tweet) => {
    //     return `  ID: ${tweet.id}
    // From: ${tweet.name} (@${tweet.username})
    // Text: ${tweet.text}`;
    //   };
    // const currentPost = formatTweet(tweet);

    // check if the tweet exists, save if it doesn't
    const tweetId = this.getTweetId(tweet.id);
    const tweetExists = await this.memoryModel
      .findOne({
        id: tweetId,
      })
      .exec();

    if (!tweetExists) {
      this.logger.log('tweet does not exist, saving');

      const message = {
        id: tweetId,
        content: tweet.text,
        createdAt: tweet.timestamp * 1000,
      };
      this.twitterClientBase.saveRequestMessage(message);
    }
    const parentTweet = await this.twitterClientBase.getTweet(
      tweet.inReplyToStatusId,
    );
    this.logger.log(`Parent Tweet Username: ${parentTweet.username}`);

    const profileDetails = await this.profileAnalysis.AnalyzeProfile(
      parentTweet.username,
    );
    if (!profileDetails) {
      return;
    }

    console.log('this is response :', profileDetails);

    const response: Content = {
      text: 'TEXT',
      url: tweet.permanentUrl,
      inReplyTo: tweet.inReplyToStatusId
        ? this.getTweetId(tweet.inReplyToStatusId)
        : undefined,
    };

    const stringId = this.getTweetId(tweet.id);

    response.inReplyTo = stringId;
    response.action = 'REPLY';

    if (response.text) {
      try {
        const callback: any = async (response: Content) => {
          const memories = await this.sendTweet(
            this.twitterClientBase,
            response,
            twitterConfig.TWITTER_USERNAME,
            tweet.id,
          );
          return memories;
        };

        const responseMessages = await callback(response);

        for (const responseMessage of responseMessages) {
          if (
            responseMessage === responseMessages[responseMessages.length - 1]
          ) {
            responseMessage.content.action = response.action;
          } else {
            responseMessage.content.action = 'CONTINUE';
          }
          await new this.memoryModel({
            id: responseMessage.id,
            roomId: responseMessage.roomId,
            content: responseMessage.text,
            createdAt: responseMessage.createdAt,
          }).save();
        }

        const responseInfo = `Selected Post: ${tweet.id} - ${tweet.username}: ${tweet.text}\nAgent's Output:\n${response.text}`;

        await this.cacheManager.set(
          `twitter/tweet_generation_${tweet.id}.txt`,
          responseInfo,
        );
        await this.wait();
      } catch (error) {
        console.log(error);
        this.logger.error(`Error sending response tweet: ${error}`);
      }
    }
  }

  private getTweetId(tweetId: string): string {
    return `${tweetId}`;
  }

  wait = (minTime: number = 1000, maxTime: number = 3000) => {
    const waitTime =
      Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
    return new Promise((resolve) => setTimeout(resolve, waitTime));
  };

  async sendTweet(
    client: TwitterClientBase,
    content: Content,
    twitterUsername: string,
    inReplyTo: string,
  ): Promise<IMemory[]> {
    const tweetChunks = this.splitTweetContent(content.text);
    const sentTweets: Tweet[] = [];
    let previousTweetId = inReplyTo;

    for (const chunk of tweetChunks) {
      const result = await client.requestQueue.add(
        async () =>
          await client.twitterClient.sendTweet(chunk.trim(), previousTweetId),
      );
      const body = await result.json();

      // if we have a response
      if (body?.data?.create_tweet?.tweet_results?.result) {
        // Parse the response
        const tweetResult = body.data.create_tweet.tweet_results.result;
        const finalTweet: Tweet = {
          id: tweetResult.rest_id,
          text: tweetResult.legacy.full_text,
          conversationId: tweetResult.legacy.conversation_id_str,
          timestamp: new Date(tweetResult.legacy.created_at).getTime() / 1000,
          userId: tweetResult.legacy.user_id_str,
          inReplyToStatusId: tweetResult.legacy.in_reply_to_status_id_str,
          permanentUrl: `https://twitter.com/${twitterUsername}/status/${tweetResult.rest_id}`,
          hashtags: [],
          mentions: [],
          photos: [],
          thread: [],
          urls: [],
          videos: [],
        };
        sentTweets.push(finalTweet);
        previousTweetId = finalTweet.id;
      } else {
        console.error('Error sending chunk', chunk, 'repsonse:', body);
      }

      // Wait a bit between tweets to avoid rate limiting issues
      await this.wait(1000, 2000);
    }

    const memories: IMemory[] = sentTweets.map((tweet) => ({
      id: this.getTweetId(tweet.id),
      content: {
        text: tweet.text,
        source: 'twitter',
        url: tweet.permanentUrl,
        inReplyTo: tweet.inReplyToStatusId
          ? this.getTweetId(tweet.inReplyToStatusId)
          : undefined,
      },
      createdAt: tweet.timestamp * 1000,
    }));

    return memories;
  }

  splitTweetContent(content: string): string[] {
    const maxLength = MAX_TWEET_LENGTH;
    const paragraphs = content.split('\n\n').map((p) => p.trim());
    const tweets: string[] = [];
    let currentTweet = '';

    for (const paragraph of paragraphs) {
      if (!paragraph) continue;

      if ((currentTweet + '\n\n' + paragraph).trim().length <= maxLength) {
        if (currentTweet) {
          currentTweet += '\n\n' + paragraph;
        } else {
          currentTweet = paragraph;
        }
      } else {
        if (currentTweet) {
          tweets.push(currentTweet.trim());
        }
        if (paragraph.length <= maxLength) {
          currentTweet = paragraph;
        } else {
          // Split long paragraph into smaller chunks
          const chunks = this.splitParagraph(paragraph, maxLength);
          tweets.push(...chunks.slice(0, -1));
          currentTweet = chunks[chunks.length - 1];
        }
      }
    }

    if (currentTweet) {
      tweets.push(currentTweet.trim());
    }

    return tweets;
  }

  splitParagraph(paragraph: string, maxLength: number): string[] {
    // eslint-disable-next-line
    const sentences = paragraph.match(/[^\.!\?]+[\.!\?]+|[^\.!\?]+$/g) || [
      paragraph,
    ];
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + ' ' + sentence).trim().length <= maxLength) {
        if (currentChunk) {
          currentChunk += ' ' + sentence;
        } else {
          currentChunk = sentence;
        }
      } else {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        if (sentence.length <= maxLength) {
          currentChunk = sentence;
        } else {
          // Split long sentence into smaller pieces
          const words = sentence.split(' ');
          currentChunk = '';
          for (const word of words) {
            if ((currentChunk + ' ' + word).trim().length <= maxLength) {
              if (currentChunk) {
                currentChunk += ' ' + word;
              } else {
                currentChunk = word;
              }
            } else {
              if (currentChunk) {
                chunks.push(currentChunk.trim());
              }
              currentChunk = word;
            }
          }
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }
}
