# Changelog

All notable changes to the WoW Backend will be documented in this file.

## [1.0.5] - 2026-01-24

### Added
- 🎸 **Host Feature API**: Endpoints to support event hosting
  - `GET /api/events/hosted/:userId` - Get events hosted by user with attendee count
  - `GET /api/events/:eventId/attendees` - Get list of users who saved an event
- 🔄 **Version Synchronization**: Synced version number with Frontend (Wow)

### Fixed
- 🐛 **Route Order**: Moved specific routes (`/hosted/...`) before generic `/:id` route to prevent 404 shadowing

## [1.0.4] - 2026-01-23

### Added
- 🔗 **URL Extraction Endpoint**: `POST /api/events/analyze-url`
  - Accepts Instagram post URLs
  - Extracts images via ExtractorT (`/instagram/simple`)
  - Analyzes extracted image with OpenAI Vision API
  - Returns event details (name, date, time, location, description)
- 📁 `routes/urlExtraction.js` - New route module for URL-based extraction

### Technical Details
- Uses ExtractorT at `https://api.standatpd.com` for Instagram scraping
- 120s timeout for extraction (Instagram can be slow)
- Validates Instagram URLs before processing
- Returns `extracted_image_url` for frontend display

### Error Handling
| Scenario | Response |
|----------|----------|
| No URL | 400 - "URL is required" |
| Non-Instagram URL | 400 - "URL no soportada. Por ahora solo aceptamos Instagram." |
| No image in post | 400 - "No se encontró imagen en el post de Instagram." |
| Timeout | 504 - "Tiempo de espera agotado. Intenta de nuevo." |

## [1.0.3] - 2026-01-21

### Fixed
- 🐛 **Register Endpoint**: Fixed undefined `supabase` reference in auth.js causing 500 error
- 🔢 **Code Usage Counter**: Now properly increments `current_uses` field

## [1.0.2] - 2026-01-21

### Added
- `POST /api/auth/validate-code` - Validate invitation codes
- `POST /api/auth/register` - Create user profile after OAuth
- `GET /api/auth/me` - Get current user profile
- `auth.js` routes module

## [1.0.1] - 2026-01-20

### Added
- Supabase integration for event storage
- `POST /api/events` - Create events
- `GET /api/events` - List events with category filter
- `GET /api/events/:id` - Get single event
- `supabase.js` client utility

### Changed
- Replaced MongoDB with Supabase as primary database
- Updated `index.js` to use Supabase

### Removed
- MongoDB dependency (commented out, can be re-enabled)

## [1.0.0] - 2026-01-20

### Added
- Initial release
- OpenAI Vision image analysis (`POST /api/events/analyze-image`)
- Docker support with docker-compose
- Health check endpoint
