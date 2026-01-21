# WoW Backend Services

Backend services for the WoW (Descubre y Vive Eventos) application.

## Services

### Event Analyzer API

AI-powered event management and image analysis service.

- **Location**: `/event-analyzer`
- **Technology**: Node.js, Express, OpenAI Vision API, Supabase
- **Port**: 3001

## API Endpoints

### Events
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/events` | List events (with category filter) |
| `GET` | `/api/events/:id` | Get single event |
| `POST` | `/api/events` | Create new event |
| `POST` | `/api/events/analyze-image` | Analyze event flyer with AI |

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/validate-code` | Validate invitation code |
| `POST` | `/api/auth/register` | Create user profile after OAuth |
| `GET` | `/api/auth/me` | Get current user profile |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Service health check |

## Quick Start

```bash
cd event-analyzer
cp .env.example .env
# Edit .env with your credentials
docker-compose up --build
```

## Repository Structure

```
WoWBack/
├── event-analyzer/
│   ├── server/
│   │   ├── index.js           # Express app
│   │   ├── routes/
│   │   │   ├── events.js      # Event CRUD
│   │   │   ├── auth.js        # Authentication
│   │   │   └── imageAnalysis.js
│   │   └── utils/
│   │       └── supabase.js    # Supabase client
│   ├── Dockerfile
│   └── docker-compose.yml
├── CHANGELOG.md
└── README.md
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3001) |
| `OPENAI_API_KEY` | OpenAI API key for image analysis |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |

## Database (Supabase)

### Tables
- `events` - Event data
- `profiles` - User profiles and roles
- `invitation_codes` - Access codes for registration

## Deployment

Services run in Docker containers. Use `docker-compose` for local development and VPS deployment.

```bash
docker-compose up -d
```

## License

MIT
