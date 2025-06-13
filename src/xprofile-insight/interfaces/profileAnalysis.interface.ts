export interface ProfileAnalysis {
  username: string;
  accountAge: string;
  verificationStatus: string;
  followerFollowingRatio: string;
  bio: {
    content: string;
    length: number;
    keywords: string[];
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
  };
  content: {
    topics: string[];
  };
  network: {
    sampledFollowers: string[];
    followerEngagement: string;
  };
  profile: {
    location: string;
    language: string;
    customization: string;
  };
  influenceScore: string;
}
