# RugGuard XBot

A modular, scalable Twitter/X bot built with NestJS, Mongoose, and custom analytics for profile insights.

---

## Features

- Automated tweet fetching, posting, and interaction
- Profile analysis and insights (engagement, posting, content, influence)
- Trusted account detection
- Modular service architecture
- MongoDB-based memory storage

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/ruggaurd-xbot.git
cd ruggaurd-xbot
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure Environment Variables

- Copy `.env.example` to `.env`:
  ```bash
  cp .env.example .env
  ```
- Fill in the required values in `.env` (see comments in the file for guidance).

### 4. Run the Project

#### Development Mode (with hot reload)

```bash
pnpm run start:dev
```

#### Production Mode

```bash
pnpm run build
pnpm run start:prod
```

---

## About `.env.example`

- `.env.example` provides a template for all required environment variables.
- Copy it to `.env` and fill in your actual credentials and configuration.
- **Never commit your real `.env` file to version control.**

---

## Project Structure

```
src/
  app.controller.ts           # Main application controller
  app.module.ts               # Root module that imports all other modules
  app.service.ts              # Main application service
  main.ts                     # Entry point for the NestJS application

  common/
    config/
      twitter.config.ts       # Twitter/X configuration utilities
    utils/
      logger.util.ts          # Custom logger utility
      requestQueue.util.ts    # Request queue utility for rate limiting
      trustedAccount.util.ts  # Trusted account logic

  database/
    database.module.ts        # Database connection module
    schemas/
      memory.schema.ts        # Mongoose schema for memory storage

  twitter-bot/
    twitter-client/
      base.provider.ts        # Abstract base provider for Twitter clients
      twitter-client.controller.ts # Controller for Twitter client endpoints
      twitter-client.module.ts     # Twitter client module
      twitter-client.service.ts    # Service for Twitter client logic
      twitter-interaction.provider.ts # Provider for Twitter interactions
      interfaces/
        client.interface.ts   # TypeScript interfaces for Twitter client

  xprofile-insight/
    xprofile-insight.module.ts     # Module for profile insights
    xprofile-insight.service.ts    # Service for analyzing Twitter profiles
    interfaces/
      profileAnalysis.interface.ts # Interfaces for profile analysis results
```

---

## File Descriptions

- **app.controller.ts / app.service.ts / app.module.ts**: Main entry points for the NestJS app.
- **main.ts**: Bootstraps the NestJS application.
- **common/config/**: Configuration files and helpers (e.g., Twitter API config).
- **common/utils/**: Utility functions (logging, request queue, trusted account checks).
- **database/**: MongoDB connection and schemas.
- **twitter-bot/twitter-client/**: All logic for interacting with Twitter/X, including base providers, controllers, and interfaces.
- **xprofile-insight/**: Services and interfaces for analyzing Twitter/X profiles.

---

## Contributing

1. Fork the repo
2. Create a feature branch
3. Submit a PR

---

## License

MIT
