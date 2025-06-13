import { Injectable, Logger } from '@nestjs/common';
import { Profile, Scraper } from 'agent-twitter-client';
import { ProfileAnalysis } from './interfaces/profileAnalysis.interface';

@Injectable()
export class XprofileInsightService {
  private readonly logger = new Logger(XprofileInsightService.name);
  readonly twitterClient: Scraper;

  constructor() {
    this.twitterClient = new Scraper();
  }

  async AnalyzeProfile(username: string): Promise<ProfileAnalysis> {
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

      console.log(tweetsAsyncGen);
      console.log(`Fetched ${tweetsArray} tweets for username: ${username}`);

      const engagement = this.analyzeEngagement(
        tweetsArray,
        profileData.followersCount || 0,
      );

      return {
        username: profileData.username || username,
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
        engagement,
        posting: this.analyzePosting(
          tweetsArray,
          profileData.statusesCount || 0,
        ),
        influenceScore: this.calculateInfluenceScore(
          profileData.followersCount || 0,
          engagement,
        ),
      };
    } catch (error) {
      this.logger.error(
        `Error analyzing profile for username ${username}:`,
        error,
      );
      throw new Error(`Unable to analyze @${username}: ${error.message}`);
    }
  }

  private async fetchTweets(userId: string | undefined) {
    if (!userId) throw new Error('Invalid user ID');
    return this.twitterClient.getTweetsByUserId(userId, 50);
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
    const wordCount = bio.trim().split(/\s+/).length;
    const hasEmojis = /[\u{1F300}-\u{1F9FF}]/u.test(bio);
    let comprehensibility = 'Clear';
    if (wordCount > 20 || bio.length > 160) {
      comprehensibility = 'Complex';
    } else if (wordCount < 5 || hasEmojis) {
      comprehensibility = 'Simple';
    }
    return {
      comprehensibility,
    };
  }

  private analyzeEngagement(tweets: any[], followers: number) {
    let totalLikes = 0;
    let totalRetweets = 0;
    let totalReplies = 0;
    let tweetCount = 0;

    for (const tweet of tweets || []) {
      if (tweet.public_metrics) {
        tweetCount++;
        totalLikes += tweet.public_metrics.like_count || 0;
        totalRetweets += tweet.public_metrics.retweet_count || 0;
        totalReplies += tweet.public_metrics.reply_count || 0;
      }
    }

    return {
      avgLikes: tweetCount ? (totalLikes / tweetCount).toFixed(2) : '0',
      avgRetweets: tweetCount ? (totalRetweets / tweetCount).toFixed(2) : '0',
      avgReplies: tweetCount ? (totalReplies / tweetCount).toFixed(2) : '0',
      engagementRate:
        tweetCount && followers
          ? (
              ((totalLikes + totalRetweets + totalReplies) /
                (tweetCount * followers)) *
              100
            ).toFixed(2) + '%'
          : '0%',
    };
  }

  private analyzePosting(tweets: any[], totalTweets: number) {
    let tweetCount = 0;
    let mediaCount = 0;
    const hashtags: string[] = [];
    const firstTweetDate = tweets?.[0]?.created_at
      ? new Date(tweets[0].created_at)
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

    for (const tweet of tweets || []) {
      tweetCount++;
      if (tweet.attachments?.media_keys?.length) mediaCount++;
      hashtags.push(...(tweet.text?.match(/#\w+/g) || []));
    }

    return {
      frequency: tweetCount
        ? (tweetCount / daysActive).toFixed(2) + ' tweets/day'
        : '0 tweets/day',
      hashtagUsage: [...new Set(hashtags)].slice(0, 5),
      mediaUsage: tweetCount
        ? ((mediaCount / tweetCount) * 100).toFixed(1) + '%'
        : '0%',
      totalTweets,
    };
  }

  private calculateInfluenceScore(followers: number, engagement: any): string {
    const likes = Number(engagement.avgLikes) || 0;
    const retweets = Number(engagement.avgRetweets) || 0;
    const engagementRate =
      Number(engagement.engagementRate.replace('%', '')) || 0;
    return (
      Math.min(
        followers / 100000 + likes / 100 + retweets / 50 + engagementRate / 2,
        100,
      ).toFixed(1) + '%'
    );
  }
}
