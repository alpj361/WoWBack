# Changelog

All notable changes to the WoW Backend will be documented in this file.

## [1.2.1] - 2026-01-21

### Fixed
- 🐛 **Register Endpoint**: Fixed undefined `supabase` reference in auth.js causing 500 error
- 🔢 **Code Usage Counter**: Now properly increments `current_uses` field

## [1.2.0] - 2026-01-21

### Added
- `POST /api/auth/validate-code` - Validate invitation codes
- `POST /api/auth/register` - Create user profile after OAuth
- `GET /api/auth/me` - Get current user profile
- `auth.js` routes module

## [1.1.0] - 2026-01-20

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
