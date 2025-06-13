# RugGuard XBot

A modular, scalable Twitter/X bot built with NestJS, Mongoose, and custom analytics for profile insights.

## Features

- Automated tweet fetching, posting, and interaction
- Profile analysis and insights (engagement, posting, content, influence)
- Trusted account detection
- Modular service architecture
- MongoDB-based memory storage

## Project Structure

```
src/
  app.controller.ts
  app.module.ts
  app.service.ts
  main.ts
  common/
    config/
      twitter.config.ts
    utils/
      logger.util.ts
      requestQueue.util.ts
      trustedAccount.util.ts
  database/
    database.module.ts
    schemas/
      memory.schema.ts
  twitter-bot/
    twitter-client/
      base.provider.ts
      twitter-client.controller.ts
      twitter-client.module.ts
      twitter-client.service.ts
      twitter-interaction.provider.ts
      interfaces/
        client.interface.ts
  xprofile-insight/
    xprofile-insight.module.ts
    xprofile-insight.service.ts
    interfaces/
      profileAnalysis.interface.ts
```

## Setup

1. **Clone the repository**
2. **Install dependencies**
   ```bash
   npm install
   ```
3. **Configure environment variables**
   - Copy `example.env` to `.env` and fill in your credentials.
4. **Run MongoDB** (or use a cloud instance)
5. **Start the server**
   ```bash
   npm run start
   ```

## Environment Variables

See `example.env` for all required and optional variables.

## Development

- **Code style:** Follows standard NestJS and TypeScript conventions.
- **Modularity:** Each service/provider is responsible for a single concern.
- **Testing:** Add unit tests in the `__tests__` folder or alongside modules.

## Contributing

1. Fork the repo
2. Create a feature branch
3. Submit a PR

---

## License

MIT
