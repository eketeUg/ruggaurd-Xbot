import { Injectable, Logger } from '@nestjs/common';
import { Profile, Scraper, Tweet } from 'agent-twitter-client';
import { ProfileAnalysis } from './interfaces/profileAnalysis.interface';
import TRUSTED_ACCOUNTS from 'src/common/utils/trustedAccount.util';

@Injectable()
export class XprofileInsightService {
  private readonly logger = new Logger(XprofileInsightService.name);
  readonly twitterClient: Scraper;

  constructor() {
    this.twitterClient = new Scraper();
  }

  async AnalyzeProfile(
    username: string,
    tweets: Tweet[],
    follower?: string[],
  ): Promise<ProfileAnalysis> {
    try {
      this.logger.log(`Analyzing profile for username: ${username}`);
      const profileData: Profile =
        await this.twitterClient.getProfile(username);
      this.logger.log(`Profile data retrieved: ${JSON.stringify(profileData)}`);

      console.log(tweets[0].text);

      const engagement = this.analyzeEngagement(
        tweets,
        profileData.followersCount || 0,
      );

      const trustedFollowerCount = this.countTrustedFollowers(follower || []);
      const writeup = TRUSTED_ACCOUNTS.includes(username.toLowerCase())
        ? 'This user is a trusted account.'
        : '';

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
        posting: this.analyzePosting(tweets, profileData.statusesCount || 0),
        content: this.analyzeContent(tweets),
        visibility: {
          listedCount: profileData.listedCount || 0,
        },
        influenceScore: this.calculateInfluenceScore(
          profileData.followersCount || 0,
          engagement,
          profileData.listedCount || 0,
        ),
        trustedFollowerCount,
        writeup,
      };
    } catch (error) {
      this.logger.error(
        `Error analyzing profile for username ${username}:`,
        error,
      );
      throw new Error(`Unable to analyze @${username}: ${error.message}`);
    }
  }

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

  private checkTrustedFollowers(followers: string[]): string[] {
    return followers
      .filter((f) => f && TRUSTED_ACCOUNTS.includes(f.toLowerCase()))
      .map((f) => f.toLowerCase());
  }

  private countTrustedFollowers(followers: string[]): number {
    return followers.filter(
      (f) => f && TRUSTED_ACCOUNTS.includes(f.toLowerCase()),
    ).length;
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
      content: bio,
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
      replyFrequency: tweetCount ? (totalReplies / tweetCount).toFixed(2) : '0',
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

  private analyzeContent(tweets: any[]) {
    const sentiments: { [key: string]: number } = {
      Positive: 0,
      Neutral: 0,
      Negative: 0,
    };
    const topics: string[] = [];

    for (const tweet of tweets || []) {
      if (tweet.text) {
        // Simple sentiment heuristic
        const text = tweet.text.toLowerCase();
        let sentiment = 'Neutral';
        if (
          text.includes('great') ||
          text.includes('awesome') ||
          text.includes('happy')
        ) {
          sentiment = 'Positive';
        } else if (
          text.includes('bad') ||
          text.includes('sad') ||
          text.includes('problem')
        ) {
          sentiment = 'Negative';
        }
        sentiments[sentiment]++;
        topics.push(...this.extractKeywords(tweet.text));
      }
    }

    const sentimentSummary = Object.entries(sentiments)
      .map(([label, count]) => `${label}: ${count}`)
      .join(', ');

    return {
      sentiment: sentimentSummary,
      topics: [...new Set(topics)].slice(0, 5),
    };
  }

  private calculateInfluenceScore(
    followers: number,
    engagement: any,
    listedCount: number,
  ): string {
    const likes = Number(engagement.avgLikes) || 0;
    const retweets = Number(engagement.avgRetweets) || 0;
    const engagementRate =
      Number(engagement.engagementRate.replace('%', '')) || 0;
    const listed = listedCount / 1000; // Normalize listedCount
    return (
      Math.min(
        followers / 100000 +
          likes / 100 +
          retweets / 50 +
          engagementRate / 2 +
          listed,
        100,
      ).toFixed(1) + '%'
    );
  }

  formatAnalysis(analysis: ProfileAnalysis): string {
    const writeupSection = analysis.writeup
      ? `\n🛡️ Status: ${analysis.writeup}`
      : '';

    return `
      🌟 @${analysis.username} Profile Insights:
      📅 Account Age: ${analysis.accountAge}
      ✅ Verification: ${analysis.verificationStatus}
      👥 F-F Ratio: ${analysis.followerFollowingRatio}
      📝 Bio:
        - Comprehensibility: ${analysis.bio.comprehensibility}
      📊 Engagement:
        - Avg Likes: ${analysis.engagement.avgLikes} ❤️
        - Avg Retweets: ${analysis.engagement.avgRetweets} 🔄
        - Reply Freq: ${analysis.engagement.replyFrequency} 💬
        - Engagement Rate: ${analysis.engagement.engagementRate}
      📬 Posting Activity:
        - Frequency: ${analysis.posting.frequency}
        - Top Hashtags: ${analysis.posting.hashtagUsage.join(', ') || 'None'}
        - Media Usage: ${analysis.posting.mediaUsage}
        - Total Tweets: ${analysis.posting.totalTweets}
      🧠 Content Analysis:
        - Sentiment: ${analysis.content.sentiment}
        - Topics: ${analysis.content.topics.join(', ') || 'None'}
      👀 Visibility:
        - Listed in: ${analysis.visibility.listedCount} public lists
      🔒 Trusted Followers: ${analysis.trustedFollowerCount}
      🏆 Influence Score: ${analysis.influenceScore}${writeupSection}
      `.trim();
  }
}
