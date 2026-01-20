# WoW Backend Services

Backend services for the WoW (Descubre y Vive Eventos) application.

## Services

### Event Analyzer
AI-powered image analysis service for extracting event information from images.

- **Location**: `/event-analyzer`
- **Technology**: Node.js, Express, OpenAI Vision API (gpt-4o-mini)
- **Port**: 3001
- **Features**: Event name, date, time, location, and description extraction

See [event-analyzer/README.md](./event-analyzer/README.md) for detailed documentation.

## Quick Start

### Event Analyzer Service

```bash
cd event-analyzer
cp .env.example .env
# Edit .env with your credentials
docker-compose up --build
```

## Repository Structure

```
WoWBack/
└── event-analyzer/    # Event image analysis service
    ├── server/        # Express application
    ├── Dockerfile     # Docker configuration
    └── README.md      # Service documentation
```

## Environment Setup

Each service has its own `.env` file. Copy `.env.example` to `.env` and configure:

- OpenAI API credentials
- MongoDB connection string
- Service-specific settings

## Deployment

Services are designed to run in Docker containers. Use `docker-compose` for local development and VPS deployment.

## License

MIT
