import { Inject, Injectable, Logger } from '@nestjs/common';
import { RequestQueue } from '../../common/utils/requestQueue.util';
import {
  QueryTweetsResponse,
  Scraper,
  SearchMode,
  Tweet,
  Profile,
} from 'agent-twitter-client';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectModel } from '@nestjs/mongoose';
import { Memory } from 'src/database/schemas/memory.schema';
import { Model } from 'mongoose';
import { twitterConfig } from 'src/common/config/twitter.config';

type TwitterProfile = {
  id: string;
  username: string;
  screenName: string;
  bio: string;
};

@Injectable()
export class TwitterClientBase {
  readonly logger = new Logger(TwitterClientBase.name);
  readonly twitterClient: Scraper;
  readonly requestQueue: RequestQueue;
  profile: TwitterProfile;
  lastCheckedTweetId: bigint | null = null;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectModel(Memory.name) readonly memoryModel: Model<Memory>,
  ) {
    this.twitterClient = new Scraper();
    this.requestQueue = new RequestQueue();
  }

  /**
   * Initializes the Twitter client, logs in, and fetches the user's profile.
   * Sets cookies if available and caches them.
   * @throws {Error} If Twitter username is not configured or profile loading fails.
   */
  async init() {
    const username = twitterConfig.TWITTER_USERNAME;

    if (!username) {
      throw new Error('Twitter username not configured');
    }

    if (twitterConfig.TWITTER_COOKIES) {
      const cookiesArray = JSON.parse(twitterConfig.TWITTER_COOKIES);
      await this.setCookiesFromArray(cookiesArray);
    } else {
      const cachedCookies = await this.getCachedCookies(process.env.TWITTER_ID);
      if (cachedCookies) {
        await this.setCookiesFromArray(cachedCookies.cookies);
      }
    }

    this.logger.log('Waiting for Twitter login...');
    await this.twitterClient.login(
      username,
      twitterConfig.TWITTER_PASSWORD,
      twitterConfig.TWITTER_EMAIL,
      twitterConfig.TWITTER_2FA_SECRET || undefined,
    );

    if (await this.twitterClient.isLoggedIn()) {
      const cookies = await this.twitterClient.getCookies();
      await this.cacheCookies(process.env.TWITTER_ID, cookies);
      this.logger.log('Successfully logged in to Twitter.');
    }

    // Initialize Twitter profile
    this.profile = await this.fetchProfile(username);

    if (this.profile) {
      this.logger.log('Twitter user ID:', this.profile.id);
      this.logger.log(
        'Twitter loaded:',
        JSON.stringify(this.profile, null, 10),
      );
    } else {
      throw new Error('Failed to load profile');
    }

    await this.loadLatestCheckedTweetId();
    await this.populateTimeline();
  }

  /**
   * Sets cookies for the Twitter client from an array of cookie objects.
   * @param {Array} cookiesArray - Array of cookie objects with properties: key, value, domain, path, secure, httpOnly, sameSite.
   */
  async setCookiesFromArray(cookiesArray: any[]) {
    const cookieStrings = cookiesArray.map(
      (cookie) =>
        `${cookie.key}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}; ${
          cookie.secure ? 'Secure' : ''
        }; ${cookie.httpOnly ? 'HttpOnly' : ''}; SameSite=${
          cookie.sameSite || 'Lax'
        }`,
    );
    await this.twitterClient.setCookies(cookieStrings);
  }

  /**
   * Fetches the Twitter profile for the given username.
   * Caches the profile and returns it.
   * @param {string} username - The Twitter username to fetch the profile for.
   * @returns {Promise<TwitterProfile | undefined>} The Twitter profile or undefined if not found.
   */
  async fetchProfile(username: string): Promise<TwitterProfile> {
    const cached = await this.getCachedProfile(username);

    if (cached) return cached;

    try {
      const profile = await this.requestQueue.add(async () => {
        const profile = await this.twitterClient.getProfile(username);
        console.log({ profile });
        return {
          id: profile.userId,
          username,
          screenName: profile.name,
          bio: profile.biography || '',
        } satisfies TwitterProfile;
      });

      this.cacheProfile(profile);

      return profile;
    } catch (error) {
      console.error('Error fetching Twitter profile:', error);

      return undefined;
    }
  }

  /**
   * Caches a tweet object by its ID.
   * @param {Tweet} tweet - The tweet object to cache.
   */
  async cacheTweet(tweet: Tweet): Promise<void> {
    if (!tweet) {
      this.logger.log('Tweet is undefined, skipping cache');
      return;
    }

    this.cacheManager.set(`twitter/tweets/${tweet.id}`, tweet);
  }

  /**
   * Retrieves a cached tweet by its ID.
   * @param {string} tweetId - The ID of the tweet to retrieve from cache.
   * @returns {Promise<Tweet | undefined>} The cached tweet or undefined if not found.
   */
  async getCachedTweet(tweetId: string): Promise<Tweet | undefined> {
    const cached = await this.cacheManager.get<Tweet>(
      `twitter/tweets/${tweetId}`,
    );

    return cached;
  }

  /**
   * Retrieves a tweet by its ID, either from cache or by making a request.
   * @param {string} tweetId - The ID of the tweet to retrieve.
   * @returns {Promise<Tweet>} The tweet object.
   */
  async getTweet(tweetId: string): Promise<Tweet> {
    const cachedTweet = await this.getCachedTweet(tweetId);

    if (cachedTweet) {
      return cachedTweet;
    }

    const tweet = await this.requestQueue.add(() =>
      this.twitterClient.getTweet(tweetId),
    );

    await this.cacheTweet(tweet);
    return tweet;
  }

  /**
   * Loads the latest checked tweet ID from cache.
   * If not found, initializes it to null.
   */
  async loadLatestCheckedTweetId(): Promise<void> {
    const latestCheckedTweetId = await this.cacheManager.get<string>(
      `twitter/${this.profile.username}/latest_checked_tweet_id`,
    );

    if (latestCheckedTweetId) {
      this.lastCheckedTweetId = BigInt(latestCheckedTweetId);
    }
  }

  /**
   * Caches the latest checked tweet ID.
   * If lastCheckedTweetId is null, it will not cache anything.
   */
  async cacheLatestCheckedTweetId() {
    if (this.lastCheckedTweetId) {
      await this.cacheManager.set(
        `twitter/${this.profile.username}/latest_checked_tweet_id`,
        this.lastCheckedTweetId.toString(),
      );
    }
  }

  /**
   * Retrieves the cached timeline for the user's profile.
   * @returns {Promise<Tweet[] | undefined>} The cached timeline or undefined if not found.
   */
  async getCachedTimeline(): Promise<Tweet[] | undefined> {
    return await this.cacheManager.get<Tweet[]>(
      `twitter/${this.profile.username}/timeline`,
    );
  }

  /**
   * Caches the user's timeline tweets.
   * @param {Tweet[]} tweets - Array of tweet objects to cache.
   */
  async cacheMentions(mentions: Tweet[]) {
    await this.cacheManager.set(
      `twitter/${this.profile.username}/mentions`,
      mentions,
      10 * 1000,
    );
  }

  /**
   * Caches the user's timeline tweets.
   * @param {Tweet[]} tweets - Array of tweet objects to cache.
   */
  async getCachedCookies(userId: string) {
    return await this.cacheManager.get<{ cookies: any[] }>(
      `twitter/${userId}/cookies`,
    );
  }
  /**
   * Caches the user's cookies.
   * @param {string} userId - The user ID to cache cookies for.
   * @param {any[]} cookies - Array of cookie objects to cache.
   */
  async cacheCookies(userId: string, cookies: any[]) {
    await this.cacheManager.set(
      `twitter/${userId}/cookies`,
      cookies,
      10 * 60 * 1000,
    );
  }

  /**
   * Retrieves the cached profile for the given username.
   * @param {string} username - The Twitter username to retrieve the profile for.
   * @returns {Promise<TwitterProfile | undefined>} The cached profile or undefined if not found.
   */
  async getCachedProfile(username: string) {
    return await this.cacheManager.get<TwitterProfile>(
      `twitter/${username}/profile`,
    );
  }

  /**
   * Caches the Twitter profile for the given username.
   * @param {TwitterProfile} profile - The Twitter profile to cache.
   */
  async cacheProfile(profile: TwitterProfile) {
    await this.cacheManager.set(`twitter/${profile.username}/profile`, profile);
  }

  async fetchHomeTimeline(userId: string, count: number): Promise<Tweet[]> {
    this.logger.debug('fetching home timeline');
    const homeTimeline = await this.twitterClient.getUserTweets(userId, count);

    return homeTimeline.tweets;
  }

  /**
   * Fetches the followers of a user by their user ID.
   * Uses a request queue to manage requests and handles rate limiting.
   * @param {string} userId - The user ID to fetch followers for.
   * @param {number} followersCount - The maximum number of followers to fetch.
   * @returns {Promise<Profile[]>} An array of profiles representing the followers.
   */
  async fetchUsersFollowers(
    userId: string,
    followersCount: number,
  ): Promise<Profile[]> {
    try {
      this.logger.debug('fetching user followers');
      const followersAsync = await this.twitterClient.getFollowers(
        userId,
        followersCount,
      );
      console.log('followersAsync', followersAsync.next);

      const followers: Profile[] = [];

      let i = 0;

      for await (const follower of followersAsync) {
        followers.push(follower);
        i++;
        if (i % 100 === 0) {
          this.logger.debug(`Fetched ${i} followers...`);
        }
      }
      this.logger.debug(`Total followers fetched: ${i}`);

      return followers;
    } catch (error) {
      this.logger.error(`Error fetching followers for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Fetches the followings of a user by their username.
   * @param {string} username - The Twitter username to fetch followings for.
   * @param {number} count - The maximum number of followings to fetch.
   */
  async fetchFollowings(username, count: number) {
    console.log('hereeee');
    const user = await this.twitterClient.getProfile(username);
    if (!user) {
      this.logger.error(`User  not found for username: ${username}`);
      return [];
    }
    const userFollowers = await this.fetchUsersFollowers(
      user.userId,
      count, // max results
    );
    this.logger.log(
      `Fetched ${userFollowers.length} followers for user ${user.username}`,
    );
  }

  /**
   * Fetches tweets based on a search query.
   * Uses a request queue to manage requests and handles rate limiting.
   * @param {string} query - The search query to use for fetching tweets.
   * @param {number} maxTweets - The maximum number of tweets to fetch.
   * @param {SearchMode} searchMode - The mode of search (e.g., Latest, Popular).
   * @param {string} [cursor] - Optional cursor for pagination.
   * @returns {Promise<QueryTweetsResponse>} The response containing the fetched tweets.
   */
  async fetchSearchTweets(
    query: string,
    maxTweets: number,
    searchMode: SearchMode,
    cursor?: string,
  ): Promise<QueryTweetsResponse> {
    try {
      // Sometimes this fails because we are rate limited. in this case, we just need to return an empty array
      // if we dont get a response in 5 seconds, something is wrong
      const timeoutPromise = new Promise((resolve) =>
        setTimeout(() => resolve({ tweets: [] }), 10000),
      );

      try {
        const result = await this.requestQueue.add(
          async () =>
            await Promise.race([
              this.twitterClient.fetchSearchTweets(
                query,
                maxTweets,
                searchMode,
                cursor,
              ),
              timeoutPromise,
            ]),
        );
        return (result ?? { tweets: [] }) as QueryTweetsResponse;
      } catch (error) {
        this.logger.error('Error fetching search tweets:', error);
        return { tweets: [] };
      }
    } catch (error) {
      this.logger.error('Error fetching search tweets:', error);
      return { tweets: [] };
    }
  }

  /**
   * Populates the timeline by fetching tweets and saving them as memories.
   * It checks for cached tweets and saves new ones that are not already in the memory model.
   * If no cached tweets are found, it fetches the latest mentions and interactions.
   * @returns {Promise<void>}
   */
  private async populateTimeline(): Promise<void> {
    this.logger.debug('Populating timeline...');

    const cachedTweets = await this.getCachedTimeline();
    console.log('cachedTweets', cachedTweets);

    let tweetsToProcess: Tweet[] = [];

    if (cachedTweets && cachedTweets.length) {
      const existingMemories = await this.memoryModel
        .find({
          Id: {
            $in: cachedTweets.map((tweet) => tweet.id),
          },
        })
        .exec();

      const existingMemoryIds = new Set(
        existingMemories.map((memory) => memory.id),
      );

      tweetsToProcess = cachedTweets.filter(
        (tweet) => !existingMemoryIds.has(this.getTweetId(tweet.id)),
      );

      if (tweetsToProcess.length === 0) {
        this.logger.log('No new tweets to store from cache.');
        return;
      }
    } else {
      // Get the most recent 20 mentions and interactions
      const mentionsAndInteractions = await this.fetchSearchTweets(
        `@Projectrugguard`,
        20,
        SearchMode.Latest,
      );

      // Combine the timeline tweets and mentions/interactions
      const allTweets = [...mentionsAndInteractions.tweets];

      const existingMemories = await this.memoryModel
        .find({
          id: {
            $in: allTweets.map((tweet) => tweet.id),
          },
        })
        .exec();

      const existingMemoryIds = new Set(
        existingMemories.map((memory) => memory.id),
      );

      tweetsToProcess = allTweets.filter(
        (tweet) => !existingMemoryIds.has(this.getTweetId(tweet.id)),
      );

      await this.cacheMentions(mentionsAndInteractions.tweets);
    }

    this.logger.debug(
      `Saving ${tweetsToProcess.length} new tweets as memories...`,
    );

    for (const tweet of tweetsToProcess) {
      const memory = new this.memoryModel({
        id: this.getTweetId(tweet.id),
        content: tweet.text,
        createdAt: new Date(tweet.timestamp * 1000),
      });

      await memory.save();
      await this.cacheTweet(tweet);
    }

    this.logger.log(`Finished saving ${tweetsToProcess.length} tweets.`);
  }

  /**
   * Converts a tweet ID to a string format.
   * @param {string} tweetId - The tweet ID to convert.
   * @returns {string} The tweet ID as a string.
   */
  getTweetId(tweetId: string): string {
    return `${tweetId}`;
  }

  /**
   * Saves a request message to the memory model if it contains text content.
   * Checks if the message is a duplicate of the most recent message in the same room.
   * If it is a duplicate, it does not save it again.
   * @param {Object} message - The message object to save.
   * @param {string} message.id - The unique identifier for the message.
   * @param {string} message.roomId - The ID of the room where the message was sent.
   * @param {Object} message.content - The content of the message.
   * @param {string} message.content.text - The text content of the message.
   * @param {Date} message.createdAt - The timestamp when the message was created.
   */
  async saveRequestMessage(message) {
    if (message.content.text) {
      const recentMessage = await this.memoryModel
        .find({ roomId: message.roomId })
        .sort({ createdAt: -1 }) // Most recent first
        .exec();

      if (
        recentMessage.length > 0 &&
        recentMessage[0].content === message.content.text
      ) {
        this.logger.debug('Message already saved', recentMessage[0].id);
      } else {
        await new this.memoryModel({
          id: message.id,
          content: message.text,
          createdAt: message.createdAt,
        }).save();
      }
      return;
    }
    return;
  }
}
