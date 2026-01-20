# Event Analyzer API

Backend service for analyzing event images using OpenAI Vision API (gpt-4o-mini). Extracts event name, date, time, description, and location from uploaded images.

## Features

- **Image Analysis**: Extracts structured event data from images using AI
- **OpenAI Vision**: Powered by gpt-4o-mini for cost-effective analysis
- **MongoDB Storage**: Saves analysis results for future reference
- **Docker Support**: Containerized deployment with docker-compose
- **Health Checks**: Built-in health monitoring endpoints

## Tech Stack

- **Runtime**: Node.js 20 (Alpine)
- **Framework**: Express 4.x
- **AI**: OpenAI SDK 4.x (gpt-4o-mini Vision)
- **Database**: MongoDB
- **Container**: Docker + docker-compose

## API Endpoints

### POST /api/events/analyze-image

Analyze an event image and extract structured data.

**Request:**
```json
{
  "image": "https://example.com/event.jpg" or "data:image/jpeg;base64,...",
  "title": "Optional event title"
}
```

**Response:**
```json
{
  "success": true,
  "analysis": {
    "event_name": "Festival de Música 2025",
    "date": "2025-08-15",
    "time": "20:00",
    "description": "Concierto al aire libre con bandas locales",
    "location": "Parque Central, Ciudad",
    "confidence": "high",
    "extracted_text": "..."
  },
  "metadata": {
    "analyzed_at": "2025-01-20T10:30:00Z",
    "model": "gpt-4o-mini",
    "tokens_used": 1250
  }
}
```

### GET /api/health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "service": "event-analyzer",
  "mongodb": "connected",
  "openai": "configured",
  "timestamp": "2025-01-20T10:30:00Z",
  "uptime": 3600
}
```

## Installation

### Local Development

1. **Clone and navigate:**
   ```bash
   cd event-analyzer
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Start server:**
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

### Docker Deployment

1. **Build and start:**
   ```bash
   docker-compose up -d --build
   ```

2. **View logs:**
   ```bash
   docker-compose logs -f
   ```

3. **Stop service:**
   ```bash
   docker-compose down
   ```

## Environment Variables

Create a `.env` file with the following variables:

```bash
# Server
NODE_ENV=production
PORT=3001
DOCKER_ENV=true

# OpenAI
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_ORG_ID=org-your-org-id (optional)

# MongoDB
MONGO_URL=mongodb+srv://username:password@cluster.mongodb.net/
DB_NAME=wow_events

# CORS
ALLOWED_ORIGINS=*
```

## VPS Deployment

### Nginx Configuration

Add this to your nginx configuration:

```nginx
# Event Analyzer (Node.js) - puerto 3001
location /api/events/analyze-image {
    proxy_pass http://localhost:3001/api/events/analyze-image;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 50M;
}

location /api/events/health {
    proxy_pass http://localhost:3001/api/health;
}
```

### Deployment Steps

1. **Upload to VPS:**
   ```bash
   git add event-analyzer/
   git commit -m "Add event analyzer service"
   git push origin main
   ```

2. **On VPS:**
   ```bash
   cd /path/to/wow
   git pull origin main
   cd event-analyzer
   cp .env.example .env
   # Edit .env with production credentials
   docker-compose up -d --build
   ```

3. **Verify:**
   ```bash
   curl http://localhost:3001/api/health
   ```

## Testing

### Local Test
```bash
curl -X POST http://localhost:3001/api/events/analyze-image \
  -H "Content-Type: application/json" \
  -d '{
    "image": "https://example.com/event-poster.jpg",
    "title": "Test Event"
  }'
```

### Production Test
```bash
curl -X POST https://your-domain.com/api/events/analyze-image \
  -H "Content-Type: application/json" \
  -d '{
    "image": "https://example.com/event-poster.jpg",
    "title": "Test Event"
  }'
```

## Frontend Integration

### TypeScript Example

```typescript
import axios from 'axios';

interface EventAnalysis {
  event_name: string;
  date: string;
  time: string;
  description: string;
  location: string;
  confidence: 'high' | 'medium' | 'low';
}

async function analyzeEventImage(imageUri: string): Promise<EventAnalysis> {
  const response = await axios.post(
    'https://your-api.com/api/events/analyze-image',
    {
      image: imageUri,
      title: 'Event'
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    }
  );

  return response.data.analysis;
}
```

## Architecture

```
event-analyzer/
├── server/
│   ├── index.js              # Express app
│   ├── routes/
│   │   └── imageAnalysis.js  # API endpoints
│   ├── services/
│   │   └── eventVision.js    # OpenAI Vision service
│   └── utils/
│       └── mongodb.js        # MongoDB client
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Database Schema

### Collection: `event_analyses`

```javascript
{
  _id: ObjectId,
  image_url: String,
  analysis: {
    event_name: String,
    date: String,
    time: String,
    description: String,
    location: String,
    confidence: String,
    extracted_text: String
  },
  metadata: {
    analyzed_at: Date,
    model: String,
    tokens_used: Number
  },
  created_at: Date
}
```

## Security

- API keys stored in `.env` (never committed to git)
- Base64 image limit: 50MB
- CORS configured via environment variables
- Non-root user in Docker container
- Input validation on all endpoints

## Troubleshooting

### Container won't start
```bash
docker-compose logs event-analyzer
```

### MongoDB connection issues
- Verify `MONGO_URL` in `.env`
- Check network connectivity
- Ensure IP whitelist in MongoDB Atlas

### OpenAI API errors
- Verify `OPENAI_API_KEY` is valid
- Check API quota/billing
- Review rate limits

## License

MIT
