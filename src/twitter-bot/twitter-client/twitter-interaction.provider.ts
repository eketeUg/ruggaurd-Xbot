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

  /**
   * Starts the Twitter interactions loop.
   * This method sets up a loop that checks for Twitter interactions at a specified interval.
   * It uses the TwitterClientBase to fetch tweets and process them.
   * The loop runs indefinitely, checking for new interactions every 30 seconds by default.
   * @returns {Promise<void>} A promise that resolves when the loop is started.
   */
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

  /**
   * Handles Twitter interactions by checking for new tweets that mention the bot.
   * It processes each tweet, analyzes the user's profile, and sends a response if necessary.
   * The method also manages the last checked tweet ID to avoid processing the same tweet multiple times.
   * @returns {Promise<void>} A promise that resolves when the interactions are handled.
   */
  async handleTwitterInteractions() {
    this.logger.log('Checking Twitter interactions');

    const twitterUsername = 'Projectrugguard';

    const searchQuery = `@${twitterUsername} riddle me this`;
    try {
      // Check for mentions
      const tweetCandidates = (
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

  /**
   * Handles a single tweet by processing its content, checking if it exists in the database,
   * and sending a response if necessary.
   * @param {Object} params - The parameters for handling the tweet.
   * @param {Tweet} params.tweet - The tweet object to process.
   * @param {IMemory} params.message - The message object containing the tweet content.
   * @returns {Promise<void>} A promise that resolves when the tweet is processed.
   */
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

    await this.sendTweet(
      this.twitterClientBase,
      response,
      twitterConfig.TWITTER_USERNAME,
      tweet.id,
    );
  }

  /**
   * Generates a unique tweet ID based on the tweet's ID.
   * This is used to ensure that each tweet can be uniquely identified in the database.
   * @param {string} tweetId - The ID of the tweet.
   * @returns {string} The formatted tweet ID.
   */
  private getTweetId(tweetId: string): string {
    return `${tweetId}`;
  }

  /**
   * Waits for a random amount of time between minTime and maxTime milliseconds.
   * This is used to avoid rate limiting issues when sending multiple tweets in quick succession.
   * @param {number} minTime - The minimum wait time in milliseconds (default: 1000).
   * @param {number} maxTime - The maximum wait time in milliseconds (default: 3000).
   * @returns {Promise<void>} A promise that resolves after the wait time.
   */
  private wait = (minTime: number = 1000, maxTime: number = 3000) => {
    const waitTime =
      Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
    return new Promise((resolve) => setTimeout(resolve, waitTime));
  };

  /**
   * Sends a tweet with the given content and in reply to a specific tweet.
   * This method splits the content into chunks if it exceeds the maximum tweet length,
   * and sends each chunk as a separate tweet in a thread.
   * @param {TwitterClientBase} client - The Twitter client to use for sending the tweet.
   * @param {Content} content - The content of the tweet to send.
   * @param {string} twitterUsername - The username of the Twitter account sending the tweet.
   * @param {string} inReplyTo - The ID of the tweet to reply to.
   * @returns {Promise<IMemory[]>} A promise that resolves to an array of memories representing the sent tweets.
   */
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

  /**
   * Splits the content of a tweet into multiple tweets if it exceeds the maximum tweet length.
   * It handles headers, sub-items, and long lines to ensure that the content is split appropriately.
   * @param {string} content - The content of the tweet to split.
   * @returns {string[]} An array of strings, each representing a tweet.
   */
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

  /**
   * Splits a long line into smaller chunks that fit within the specified maximum length.
   * It handles sentences, words, and very long words (like URLs) to ensure that each chunk is within the limit.
   * @param {string} line - The line to split.
   * @param {number} maxLength - The maximum length for each chunk.
   * @returns {string[]} An array of strings, each representing a chunk of the original line.
   */
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

  /**
   * Checks if a line is a header based on specific criteria.
   * A header is defined as a line that starts with an emoji or special character and ends with a colon.
   * @param {string} line - The line to check.
   * @returns {boolean} True if the line is a header, false otherwise.
   */
  private isHeader(line: string): boolean {
    return /^[\p{Emoji_Presentation}\p{Emoji}\u200D]+.*:$/u.test(line);
  }

  /**
   * Checks if a line is a sub-item based on specific criteria.
   * A sub-item is defined as a line that starts with a hyphen or dash followed by a space,
   * or a line that is not a header and follows a header line.
   * @param {string} line - The line to check.
   * @param {string | null} prevLine - The previous line, used to determine if the current line is a sub-item.
   * @returns {boolean} True if the line is a sub-item, false otherwise.
   */
  private isSubItem(line: string, prevLine: string | null): boolean {
    return (
      line.startsWith('- ') ||
      (prevLine && this.isHeader(prevLine) && !this.isHeader(line))
    );
  }

  /**
   * Fetches the user timeline for a specific user.
   * This method retrieves the most recent tweets from the user's timeline.
   * @param {string} userId - The ID of the user whose timeline to fetch.
   * @param {number} tweetCount - The number of tweets to pull from the timeline.
   * @returns {Promise<Tweet[]>} A promise that resolves to an array of tweets from the user's timeline.
   */
  fetcthUserTimeline = async (userId: string, tweetCount: number) => {
    const userTimeline = await this.twitterClientBase.fetchHomeTimeline(
      userId,
      tweetCount, // number of tweets to pull
    );
    return userTimeline;
  };

  /**
   * Fetches the followers of a specific user.
   * This method retrieves the usernames of the user's followers.
   * @param {string} userId - The ID of the user whose followers to fetch.
   * @param {number} maxResults - The maximum number of followers to retrieve (default: 100).
   * @returns {Promise<string[]>} A promise that resolves to an array of usernames of the user's followers.
   */
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
