// export interface ProfileAnalysis {
//   username: string;
//   accountAge: string;
//   verificationStatus: string;
//   followerFollowingRatio: string;
//   bio: {
//     comprehensibility: string;
//   };
//   engagement: {
//     avgLikes: string;
//     avgRetweets: string;
//     avgReplies: string;
//     engagementRate: string;
//   };
//   posting: {
//     frequency: string;
//     hashtagUsage: string[];
//     mediaUsage: string;
//     totalTweets: number;
//   };
//   influenceScore: string;
// }

// export interface ProfileAnalysis {
//   username: string;
//   accountAge: string;
//   verificationStatus: string;
//   followerFollowingRatio: string;
//   bio: {
//     content: string;
//     comprehensibility: string;
//   };
//   engagement: {
//     avgLikes: string;
//     avgRetweets: string;
//     replyFrequency: string; // Replies per tweet
//     engagementRate: string;
//   };
//   posting: {
//     frequency: string;
//     hashtagUsage: string[];
//     mediaUsage: string;
//     totalTweets: number;
//   };
//   content: {
//     sentiment: string; // Summary of positive, neutral, negative
//     topics: string[];
//   };
//   visibility: {
//     listedCount: number;
//   };
//   influenceScore: string;
// }

// export interface ProfileAnalysis {
//   username: string;
//   accountAge: string;
//   verificationStatus: string;
//   followerFollowingRatio: string;
//   bio: {
//     content: string;
//     comprehensibility: string;
//   };
//   engagement: {
//     avgLikes: string;
//     avgRetweets: string;
//     replyFrequency: string;
//     engagementRate: string;
//   };
//   posting: {
//     frequency: string;
//     hashtagUsage: string[];
//     mediaUsage: string;
//     totalTweets: number;
//   };
//   content: {
//     sentiment: string;
//     topics: string[];
//   };
//   visibility: {
//     listedCount: number;
//   };
//   influenceScore: string;
//   isReliable: boolean; // At least 2 trusted accounts in followers
//   isTrustedAccount: boolean; // Username is in TRUSTED_ACCOUNTS
// }

export interface ProfileAnalysis {
  username: string;
  accountAge: string;
  verificationStatus: string;
  followerFollowingRatio: string;
  bio: {
    content: string;
    comprehensibility: string;
  };
  engagement: {
    avgLikes: string;
    avgRetweets: string;
    replyFrequency: string;
    engagementRate: string;
  };
  posting: {
    frequency: string;
    hashtagUsage: string[];
    mediaUsage: string;
    totalTweets: number;
  };
  content: {
    sentiment: string;
    topics: string[];
  };
  visibility: {
    listedCount: number;
  };
  influenceScore: string;
  trustedFollowerCount: number; // Number of trusted accounts in followers
  writeup: string; // Message if user is trusted, else empty
}
