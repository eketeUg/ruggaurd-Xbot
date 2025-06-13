import { Injectable, Logger } from '@nestjs/common';
import { Profile, Scraper } from 'agent-twitter-client';

@Injectable()
export class XprofileInsightService {
  private readonly logger = new Logger(XprofileInsightService.name);
  readonly twitterClient: Scraper;

  constructor() {
    this.twitterClient = new Scraper();
  }

  async AnalyzeProfile(username: string) {
    try {
      this.logger.log(`Analyzing profile for username: ${username}`);
      const profileData: Profile =
        await this.twitterClient.getProfile(username);
      this.logger.log(`Profile data retrieved: ${JSON.stringify(profileData)}`);

      const tweetsAsyncGen = await this.fetchTweets(profileData.userId);
      const tweetsArray = [];
      for await (const tweet of tweetsAsyncGen) {
        tweetsArray.push(tweet);
      }

      return {
        username: profileData.username,
        accountAge: this.getAccountAge(profileData.joined),
        verificationStatus: this.getVerificationStatus(
          profileData.isVerified,
          profileData.isBlueVerified,
        ),
        followerFollowingRatio: this.getFollowerFollowingRatio(
          profileData.followersCount,
          profileData.followingCount,
        ),
        bio: this.analyzeBio(profileData.biography || ''),
        engagement: this.analyzeEngagement(
          tweetsArray,
          profileData.followersCount || 0,
        ),
        posting: this.analyzePosting(tweetsArray),
        influenceScore: this.calculateInfluenceScore(
          profileData.followersCount || 0,
          this.analyzeEngagement(tweetsArray, profileData.followersCount || 0),
        ),
      };
    } catch (error) {
      this.logger.error(
        `Error analyzing profile for username ${username}:`,
        error,
      );
      throw error;
    }
  }

  //utility function to get the profile data

  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(
        (word) =>
          word.length > 3 &&
          !word.startsWith('http') &&
          !word.startsWith('https') &&
          !word.startsWith('@') &&
          !word.startsWith('#'),
      )
      .slice(0, 5);
  }

  private async fetchTweets(userId: string) {
    return this.twitterClient.getTweets(userId, 50);
  }

  private getAccountAge(joined?: Date): string {
    if (!joined) return 'Unknown';
    const createdDate = new Date(joined);
    const now = new Date();
    const diffMs = now.getTime() - createdDate.getTime();
    const diffYears = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365.25));
    const diffMonths = Math.floor(
      (diffMs % (1000 * 60 * 60 * 24 * 365.25)) / (1000 * 60 * 60 * 24 * 30.42),
    );
    return `${diffYears}y ${diffMonths}m`;
  }

  private getVerificationStatus(
    isVerified?: boolean,
    isBlueVerified?: boolean,
  ): string {
    if (isBlueVerified) return '✅ Blue Verified';
    if (isVerified) return '✅ Verified';
    return '❌ Not Verified';
  }

  private getFollowerFollowingRatio(
    followersCount?: number,
    followingCount?: number,
  ): string {
    const followers = followersCount || 0;
    const following = followingCount || 0;
    const ratio = (followers / Math.max(following, 1)).toFixed(2);
    const context =
      followers > 10000 && Number(ratio) > 10
        ? '📈 Influencer-like'
        : '⚖️ Balanced';
    return `${ratio} (${context})`;
  }

  private analyzeBio(bio: string) {
    return {
      content: bio,
      length: bio.length,
      keywords: this.extractKeywords(bio),
    };
  }

  private analyzeEngagement(tweets: any, followers: number) {
    let totalLikes = 0;
    let totalRetweets = 0;
    let totalReplies = 0;
    let tweetCount = 0;

    for (const tweet of tweets.data || []) {
      tweetCount++;
      totalLikes += tweet.public_metrics.like_count;
      totalRetweets += tweet.public_metrics.retweet_count;
      totalReplies += tweet.public_metrics.reply_count;
    }

    return {
      avgLikes: tweetCount ? (totalLikes / tweetCount).toFixed(2) : '0',
      avgRetweets: tweetCount ? (totalRetweets / tweetCount).toFixed(2) : '0',
      avgReplies: tweetCount ? (totalReplies / tweetCount).toFixed(2) : '0',
      engagementRate: followers
        ? (
            ((totalLikes + totalRetweets + totalReplies) /
              (tweetCount * followers)) *
            100
          ).toFixed(2) + '%'
        : '0%',
    };
  }

  private analyzePosting(tweets: any) {
    let tweetCount = 0;
    let mediaCount = 0;
    const hashtags: string[] = [];
    const firstTweetDate = tweets.data?.[0]?.created_at
      ? new Date(tweets.data[0].created_at)
      : null;
    const daysActive = firstTweetDate
      ? Math.max(
          Math.floor(
            (new Date().getTime() - firstTweetDate.getTime()) /
              (1000 * 60 * 60 * 24),
          ),
          1,
        )
      : 1;

    for (const tweet of tweets.data || []) {
      tweetCount++;
      if (tweet.attachments?.media_keys?.length) mediaCount++;
      hashtags.push(...(tweet.text.match(/#\w+/g) || []));
    }

    return {
      frequency: tweetCount
        ? (tweetCount / daysActive).toFixed(2) + ' tweets/day'
        : '0 tweets/day',
      hashtagUsage: [...new Set(hashtags)].slice(0, 5),
      mediaUsage: tweetCount
        ? ((mediaCount / tweetCount) * 100).toFixed(1) + '%'
        : '0%',
    };
  }

  private calculateInfluenceScore(followers: number, engagement: any): string {
    return (
      Math.min(
        followers / 100000 +
          Number(engagement.avgLikes) / 100 +
          Number(engagement.avgRetweets) / 50 +
          Number(engagement.engagementRate.replace('%', '')) / 2,
        100,
      ).toFixed(1) + '%'
    );
  }
}
