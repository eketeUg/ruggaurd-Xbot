export interface ProfileAnalysis {
  username: string;
  accountAge: string;
  verificationStatus: string;
  followerFollowingRatio: string;
  bio: {
    comprehensibility: string;
  };
  engagement: {
    avgLikes: string;
    avgRetweets: string;
    avgReplies: string;
    engagementRate: string;
  };
  posting: {
    frequency: string;
    hashtagUsage: string[];
    mediaUsage: string;
    totalTweets: number;
  };
  influenceScore: string;
}
