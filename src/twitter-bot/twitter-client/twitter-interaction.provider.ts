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

    const userTweets = await this.fetcthUserTimeline(
      parentTweet.userId,
      20, // number of tweets to pull
    );
    const userFollowers = await this.fetchUserFollowers(
      parentTweet.userId,
      1000, // max results
    );
    this.logger.log(
      `Fetched ${userTweets.length} tweets and ${userFollowers.length} followers for user ${parentTweet.username}`,
    );

    const profileAnalysis = await this.profileAnalysis.AnalyzeProfile(
      parentTweet.username,
      userTweets,
      userFollowers,
    );
    if (!profileAnalysis) {
      return;
    }

    console.log('this is response :', profileAnalysis);
    const tweetText = this.profileAnalysis.formatAnalysis(profileAnalysis);

    const response: Content = {
      text: tweetText,
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
    const maxLength = MAX_TWEET_LENGTH - 3; // Reserve 3 chars for "..."
    // Split by newlines, preserving empty lines for formatting
    const lines = content.split('\n').map((line) => line.trim());
    const tweets: string[] = [];
    let currentTweet = '';
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const isLastLine = i === lines.length - 1;
      const isHeader = this.isHeader(line);
      const separator = currentTweet && !isLastLine && line ? '\n' : '';

      // Try adding the line to the current tweet
      if ((currentTweet + separator + line).length <= maxLength) {
        currentTweet += separator + line;
        i++;
        // If last line or next line doesn't fit (and isn't a sub-item), push tweet
        if (
          isLastLine ||
          (i < lines.length &&
            (currentTweet + '\n' + lines[i]).length > maxLength &&
            !this.isSubItem(lines[i], i > 0 ? lines[i - 1] : null))
        ) {
          tweets.push(currentTweet + (isLastLine ? '' : ' ...'));
          currentTweet = '';
        }
      } else {
        // Line doesn't fit
        if (currentTweet) {
          tweets.push(currentTweet + '  ...');
          currentTweet = '';
        }

        if (isHeader || line.length <= maxLength) {
          // Headers or short lines start a new tweet
          currentTweet = line;
          i++;
        } else {
          // Split long non-header line (e.g., long topics list)
          const chunks = this.splitLongLine(line, maxLength);
          for (let j = 0; j < chunks.length; j++) {
            const chunk = chunks[j];
            const isLastChunk = j === chunks.length - 1 && isLastLine;
            if (
              currentTweet &&
              (currentTweet + '\n' + chunk).length > maxLength
            ) {
              tweets.push(currentTweet + '...');
              currentTweet = chunk;
            } else {
              currentTweet += (currentTweet ? '\n' : '') + chunk;
            }
            if (
              isLastChunk ||
              (currentTweet.length > maxLength - 50 &&
                (j < chunks.length - 1 || !isLastLine))
            ) {
              tweets.push(currentTweet + (isLastChunk ? '' : '...'));
              currentTweet = '';
            }
          }
          i++;
        }
      }
    }

    if (currentTweet) {
      tweets.push(currentTweet);
    }

    return tweets.map((tweet) => tweet.trim());
  }

  splitLongLine(line: string, maxLength: number): string[] {
    // Split into sentences (including trailing punctuation or incomplete sentences)
    const sentences = line.match(/[^.!?]+[.!?]*|[^.!?]+$/g) || [line];
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + ' ' + sentence).trim().length <= maxLength) {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        if (sentence.length <= maxLength) {
          currentChunk = sentence;
        } else {
          // Split long sentence into words
          const words = sentence.split(/\s+/);
          for (const word of words) {
            if ((currentChunk + ' ' + word).trim().length <= maxLength) {
              currentChunk += (currentChunk ? ' ' : '') + word;
            } else {
              if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
              }
              if (word.length <= maxLength) {
                currentChunk = word;
              } else {
                // Split very long word (e.g., URL)
                let start = 0;
                while (start < word.length) {
                  const slice = word.slice(start, start + maxLength);
                  chunks.push(slice);
                  start += maxLength;
                }
                currentChunk = '';
              }
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

  private isHeader(line: string): boolean {
    return /^[\p{Emoji_Presentation}\p{Emoji}\u200D]+.*:$/u.test(line);
  }

  private isSubItem(line: string, prevLine: string | null): boolean {
    return (
      line.startsWith('- ') ||
      (prevLine && this.isHeader(prevLine) && !this.isHeader(line))
    );
  }

  fetcthUserTimeline = async (userId: string, tweetCount: number) => {
    const userTimeline = await this.twitterClientBase.fetchHomeTimeline(
      userId,
      tweetCount, // number of tweets to pull
    );
    return userTimeline;
  };

  fetchUserFollowers = async (
    userId: string,
    maxResults: number = 100,
  ): Promise<string[]> => {
    const followers = await this.twitterClientBase.fetchUsersFollowers(
      userId,
      maxResults,
    );

    return followers.map((follower) => follower.username);
  };
}
