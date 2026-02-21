# Changelog

All notable changes to the WoW Backend will be documented in this file.

## [1.0.15] - 2026-02-21

### Added - Image Storage Service (Supabase Storage)

#### New Route: `routes/imageStorage.js`
- **POST /api/storage/upload-image-url** — Descarga una imagen desde una URL externa y la sube al bucket `event-images` de Supabase Storage. Retorna una URL pública permanente que nunca expira. Si se proporciona `event_id`, actualiza automáticamente el campo `image` del evento en la base de datos.
- **POST /api/storage/upload-image-base64** — Sube una imagen en formato base64 (data URI o raw) directamente a Supabase Storage. Mismo comportamiento con `event_id` opcional.
- **POST /api/storage/migrate-event-images** — Migración masiva: itera todos los eventos que aún tienen URLs externas (que no son de Supabase Storage), descarga y re-sube cada imagen, y actualiza el registro del evento. Acepta parámetro `limit` (default 50) para controlar el lote.

#### Características
- Crea el bucket `event-images` automáticamente si no existe (público, max 10 MB)
- Archivos organizados bajo `events/{filename}.{ext}`
- Delay de 300ms entre migraciones para respetar rate limits
- Manejo de errores por imagen: si una falla, el proceso continúa con las demás

#### Registro en `index.js`
- Nueva ruta montada en `/api/storage`
- Documentación del endpoint actualizada en la respuesta raíz `/`

### Frontend (`frontend/src/services/api.ts`)
- **`uploadImageFromUrl(url, eventId?, filename?)`** — Helper TypeScript para `POST /api/storage/upload-image-url`
- **`uploadImageBase64(base64, eventId?, filename?)`** — Helper TypeScript para `POST /api/storage/upload-image-base64`
- **`migrateEventImages(limit?)`** — Helper TypeScript para `POST /api/storage/migrate-event-images`
- Interfaz `StorageUploadResult` exportada

### Motivation
Las URLs generadas por herramientas de extracción de Instagram/AI tienen TTL corto y expiran a las pocas horas. Esta solución persiste las imágenes en Supabase Storage para que sean permanentes.

### Endpoints Summary
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/storage/upload-image-url` | Subir imagen desde URL externa |
| POST | `/api/storage/upload-image-base64` | Subir imagen en base64 |
| POST | `/api/storage/migrate-event-images` | Migración masiva de imágenes existentes |

---

## [1.0.14] - 2026-02-11

### Added - Event Fields & Recurring Date Expiration

#### New Event Fields (`routes/events.js`)
- **POST /api/events** ahora acepta:
  - `end_time` - Hora de finalización del evento
  - `organizer` - Nombre del organizador
  - `is_recurring` - Boolean para eventos recurrentes
  - `recurring_dates` - Array de fechas adicionales (TEXT[])
  - `target_audience` - Array de audiencia objetivo (TEXT[])

#### Filtro de Eventos Expirados - Eventos Recurrentes
- **Nueva lógica de expiración**: Para eventos recurrentes, usa la **ÚLTIMA fecha** para determinar si expiró
- Un evento recurrente **NO desaparece** hasta que **TODAS** sus fechas hayan pasado
- Ejemplo: Evento con fechas [10, 15, 20] → visible hasta después del día 20

### Technical Details
```javascript
// Nueva función helper para calcular fecha de expiración efectiva
const getEffectiveExpirationDate = (event) => {
    if (!event.date) return null;

    // Si no es recurrente, usar fecha principal
    if (!event.is_recurring || !event.recurring_dates?.length) {
        return event.date;
    }

    // Combinar fecha principal + recurrentes y obtener la última
    const allDates = [event.date, ...event.recurring_dates]
        .filter(d => d)
        .sort((a, b) => a.localeCompare(b));

    return allDates[allDates.length - 1] || event.date;
};

// Filtro actualizado
const filteredData = data.filter(event => {
    const expirationDate = getEffectiveExpirationDate(event);
    if (!expirationDate) return true;
    return expirationDate >= todayStr;
});
```

### Database Fields
```sql
-- Campos soportados en POST /api/events
end_time        TIME          -- Hora de finalización
organizer       TEXT          -- Nombre del organizador
is_recurring    BOOLEAN       -- Si es evento recurrente
recurring_dates TEXT[]        -- Fechas adicionales (YYYY-MM-DD)
target_audience TEXT[]        -- Audiencia objetivo
```

---

## [1.0.13] - 2026-02-10

### Added
- 📝 **Event Drafts Database Table**: New Supabase table for storing event drafts before publishing
  - `event_drafts` table with full event fields + metadata
  - RLS policies for user-specific access (view, insert, update, delete)
  - Indexes on `user_id`, `extraction_job_id`, and `created_at`
  - Auto-updating `updated_at` trigger

### Database Schema
```sql
CREATE TABLE event_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  extraction_job_id UUID REFERENCES extraction_jobs(id) ON DELETE SET NULL,

  -- Event data (same fields as events table)
  title TEXT NOT NULL,
  description TEXT,
  category VARCHAR(50) DEFAULT 'general',
  image TEXT,
  date DATE,
  time TIME,
  location TEXT,
  organizer TEXT,

  -- Payment/registration fields
  price DECIMAL(10,2),
  registration_form_url TEXT,
  bank_name TEXT,
  bank_account_number TEXT,

  -- Metadata
  source_image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### RLS Policies
| Policy | Operation | Rule |
|--------|-----------|------|
| Users can view own drafts | SELECT | `auth.uid() = user_id` |
| Users can insert own drafts | INSERT | `auth.uid() = user_id` |
| Users can update own drafts | UPDATE | `auth.uid() = user_id` |
| Users can delete own drafts | DELETE | `auth.uid() = user_id` |

### Migration Applied
- `create_event_drafts_table` - Full migration with table, indexes, RLS, and trigger

### Integration
- Drafts are managed directly via Supabase client from frontend
- No API endpoints needed - all CRUD operations use Supabase SDK
- Publishing a draft creates an event in `events` table and deletes the draft

---

## [1.0.12] - 2026-02-09

### Added
- **Background Extraction Jobs System**: New async extraction architecture for reliable background processing
  - `POST /api/extraction-jobs/process/:id` - Trigger image extraction (fire-and-forget)
  - `POST /api/extraction-jobs/analyze/:id` - Trigger image analysis (fire-and-forget)
  - `GET /api/extraction-jobs/pending` - List pending jobs (internal use)
  - Jobs persist in Supabase `extraction_jobs` table with RLS policies
  - Works reliably when app goes to background or is closed

### New Endpoints
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/extraction-jobs/process/:id` | Trigger extraction for a job (async, returns immediately) |
| POST | `/api/extraction-jobs/analyze/:id` | Trigger analysis for selected image (async) |
| GET | `/api/extraction-jobs/pending` | Get pending jobs for worker polling |

### Architecture
```
Frontend                  Supabase                 WoWBack
   │                         │                        │
   │ 1. Insert job           │                        │
   │ ─────────────────────► │                        │
   │                         │                        │
   │ 2. Fire-and-forget      │                        │
   │ ─────────────────────────────────────────────► │
   │                         │                        │
   │                         │ 3. Update status/data │
   │                         │ ◄───────────────────── │
   │                         │                        │
   │ 4. Poll for updates     │                        │
   │ ◄───────────────────── │                        │
```

### Technical Details
- Fire-and-forget pattern: API responds immediately, processing continues async
- Status updates written directly to Supabase by backend
- Frontend polls Supabase for status changes (not API)
- Survives app backgrounding, closing, and network interruptions

### Files Added
- `routes/extractionJobs.js` - New route module for extraction jobs

---

## [1.0.11] - 2026-02-09

### Changed
- **URL Extraction: Two-Step Flow** — Split `POST /analyze-url` into extraction + on-demand analysis
  - `/analyze-url` now returns extracted images immediately (no Vision API call)
  - New `POST /analyze-extracted-image` endpoint analyzes a single image on demand
  - Saves ~150s and ~360k tokens on carousel posts (15 images no longer auto-analyzed)
  - User picks which image to analyze before spending tokens

### Fixed
- **WhatsApp Webhook Verification** — Hardened `GET /api/whatsapp/webhook`
  - Returns 400 if `hub.mode`, `hub.verify_token`, or `hub.challenge` are missing
  - Sends challenge as `text/plain` with explicit `String()` cast
  - Masks token in logs to avoid leaking secrets

### New Endpoints
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/events/analyze-extracted-image` | Analyze a single image URL with Vision API |

### Response Format Changes
```javascript
// POST /analyze-url — now returns images only (no analysis)
{
  success: true,
  source_url: "https://instagram.com/p/...",
  platform: "instagram",
  extracted_images: ["https://...", ...],
  is_reel: false,
  post_metadata: { author, description }
}

// POST /analyze-extracted-image — on-demand analysis
// Body: { image_url: "https://...", title: "optional context" }
{
  success: true,
  analysis: { event_name, date, time, location, ... },
  metadata: { model, tokens_used, ... }
}
```

---

## [1.0.10] - 2026-02-09

### Added
- 🖼️ **Carousel Image Support**: URL extraction now returns all images from Instagram carousels
  - New `extracted_images` array in response (only present when carousel has 2+ images)
  - Frontend can display image selector for user choice
  - Falls back to returning images even if no event analysis detected
  - Added `is_reel` flag to indicate if content is a reel

### Changed
- 📊 **Simplified Response Format**: Streamlined `/api/events/analyze-url` response
  - Now returns single flat structure instead of nested `events` array
  - Compatible with existing frontend expectations
  - Includes `extracted_image_url` (best/first image) + `extracted_images` (all images)

### Technical Details
```javascript
// New response format:
{
  success: true,
  source_url: "https://instagram.com/p/...",
  platform: "instagram",
  extracted_image_url: "https://...",      // First/best image
  extracted_images: ["https://...", ...],  // All images (if carousel)
  is_reel: false,
  analysis: { event_name, date, time, ... },
  post_metadata: { author, description }
}
```

---

## [1.0.9] - 2026-01-30

### Added
- 📱 **WhatsApp Flyers Webhook**: Complete integration to receive and store flyers from WhatsApp Business
  - `POST /api/whatsapp/webhook` - Receives messages from WhatsApp Business API
  - `GET /api/whatsapp/webhook` - Webhook verification endpoint (required by Meta)
  - `GET /api/whatsapp/flyers/pending` - Get list of pending flyers to process
  - `PATCH /api/whatsapp/flyers/:id` - Update flyer status (processed, saved)
  - Added `routes/whatsappFlyers.js` - New route module for WhatsApp integration

### Features
- **Automatic Image Processing**:
  - Filters messages to only process `type: "image"`
  - Downloads images from WhatsApp CDN with authentication
  - Uploads to Supabase Storage bucket `whatsapp-flyers`
  - Organizes by date: `whatsapp-flyers/YYYY-MM-DD/message-id.jpg`
  - Creates database record with status `pending` and `saved: false`

- **Webhook Validation**:
  - GET endpoint for Meta webhook verification
  - Configurable verify token via `WHATSAPP_VERIFY_TOKEN` env var
  - Returns challenge for successful verification

- **Flyer Management**:
  - Query pending flyers ready for AI analysis
  - Update status after processing (pending → processed)
  - Mark as saved when event is created
  - Track original sender and message metadata

### Technical Details
```javascript
// WhatsApp Webhook Flow:
1. Receive POST from WhatsApp Business API
2. Validate payload structure
3. Filter only image messages
4. Download image with WhatsApp Access Token
5. Upload to Supabase Storage (whatsapp-flyers bucket)
6. Insert record in whatsapp_flyers table:
   - flyer: public URL
   - status: "pending"
   - saved: false
7. Return success with flyer details
```

### Environment Variables
```bash
WHATSAPP_ACCESS_TOKEN=EAAxxxxx  # From Meta Developer Console
WHATSAPP_VERIFY_TOKEN=wow_flyers_2026  # Custom verification token
```

### Database Schema
```sql
-- whatsapp_flyers table
id          UUID         -- Auto-generated
flyer       TEXT         -- Public URL of uploaded image
status      VARCHAR(20)  -- 'pending', 'processed', 'failed'
saved       BOOLEAN      -- If event was created from this flyer
created_at  TIMESTAMPTZ  -- Automatic timestamp
```

### Integration
- Works with existing Supabase Storage and Database
- Compatible with Vision AI analysis pipeline
- Designed for future Flyer Analyzer service integration
- No N8N dependency required - all logic in WoWBack

### Error Handling
| Scenario | Response |
|----------|----------|
| Non-image message | 200 - "Not an image" (ignored) |
| Invalid payload | 200 - "Ignored" (WhatsApp requires 200) |
| Missing token | 500 - "WHATSAPP_ACCESS_TOKEN not configured" |
| Download failed | 500 - Error details |
| Upload failed | 500 - Error details with Supabase message |
| DB insert failed | 500 - Error details |

### Deployment
```bash
# 1. Configure environment variables
WHATSAPP_ACCESS_TOKEN=your_token
WHATSAPP_VERIFY_TOKEN=wow_flyers_2026

# 2. Start server
npm run dev  # or use PM2 for production

# 3. Configure Meta Developer Console
Callback URL: https://api.standatpd.com/api/whatsapp/webhook
Verify Token: wow_flyers_2026
Subscribe to: messages
```

### Nginx Configuration (if needed)
```nginx
location /api/whatsapp/ {
    proxy_pass http://localhost:3001/api/whatsapp/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

## [1.0.8] - 2026-01-29

### Fixed
- 🐛 **URL Extraction - Instagram CDN Access**: Fixed OpenAI Vision API unable to download Instagram images
  - **Issue**: OpenAI cannot directly access `scontent.cdninstagram.com` URLs (returns 400 error)
  - **Solution**: Download image in backend and convert to base64 before sending to Vision API
  - Added axios download with browser-like headers to bypass Instagram CDN restrictions
  - Converts image to base64 data URL (same as `/analyze-image` endpoint)
  - Now uses identical flow for both image upload and URL extraction

### Technical Details
```javascript
// Download flow:
1. ExtractorT provides Instagram image URL
2. Backend downloads with axios + browser headers
3. Converts arraybuffer to base64
4. Creates data URL: data:image/jpeg;base64,{base64}
5. Sends data URL to OpenAI Vision API
6. Returns structured event data + metadata
```

### Changed
- Updated `urlExtraction.js` to download and convert images to base64
- Response format now matches `/analyze-image` endpoint:
  ```json
  {
    "success": true,
    "analysis": { event_name, date, time, location, ... },
    "metadata": {
      "model": "gpt-4o-mini",
      "tokens_used": 1500,
      "source_url": "https://www.instagram.com/...",
      "platform": "instagram",
      "extracted_image_url": "https://scontent.cdninstagram.com/...",
      "post_metadata": { author, description }
    }
  }
  ```

## [1.0.7] - 2026-01-27

### Added
- 🎯 **Attendance Tracking System**: Complete QR-based attendance tracking for events
  - `POST /api/events/:eventId/scan-attendance` - Scan user QR code to mark attendance
  - `GET /api/events/:eventId/attendance-list` - Get attendance list with status for all confirmed users
  - `PATCH /api/events/:eventId/attendance-requirement` - Toggle attendance tracking for events
  - Added `requires_attendance_check` field to event creation endpoint

### Features
- **QR Scan Validation**: 
  - Verifies host ownership before allowing scans
  - Ensures event has attendance tracking enabled
  - Confirms user is registered/approved for event
  - Prevents duplicate attendance (updates existing records)
  
- **Attendance List**:
  - Shows all confirmed users (saved + approved registrations)
  - Includes attendance status (attended, scanned_by_host, scanned_at)
  - Returns user profile data (name, email, avatar)
  - Displays registration status for each user

- **Security**:
  - Host-only access validation for all attendance endpoints
  - Event ownership verification before scans
  - Confirmation status checks (saved_events + approved registrations)

### Technical Details
```javascript
// Scan Attendance Flow:
1. Verify host owns event
2. Check event requires_attendance_check = true
3. Confirm user is saved/approved
4. Create or update attendance record with:
   - scanned_by_host: true
   - scanned_at: timestamp
   - scanned_by_user_id: host's UUID
```

### Database Changes
- Utilizes new `user_qr_codes` table for QR code data
- Updates `attended_events` with scan tracking fields:
  - `scanned_by_host` (boolean)
  - `scanned_at` (timestamptz)
  - `scanned_by_user_id` (uuid reference)

### Documentation
- Added `/docs/API_ATTENDANCE_ENDPOINTS.md` with complete API reference
- Includes request/response examples, error codes, and integration flow
- See `/docs/PLAN_ATTENDANCE_TRACKING.md` for architecture details

### Error Handling
| Scenario | Response |
|----------|----------|
| Not event host | 403 - "Only the event host can scan attendance" |
| No attendance tracking | 400 - "This event does not require attendance tracking" |
| User not confirmed | 400 - "User is not confirmed for this event" |
| Event not found | 404 - "Event not found" |
| Missing parameters | 400 - Parameter-specific error message |

## [1.0.6] - 2026-01-24

### Fixed
- 🐛 **Attendees Endpoint**: Fixed 500 Internal Server Error in `GET /api/events/:eventId/attendees`
  - **Issue**: Incorrect Supabase query syntax was causing database errors
  - **Solution**: Rewrote endpoint to use two separate queries:
    1. First query: Fetch `saved_events` for the specific event
    2. Second query: Fetch `profiles` for the user IDs from saved_events
    3. Combine the data before returning
  - Added comprehensive error handling and logging
  - Fixed response format to properly include profile information

### Technical Details
```javascript
// Before (incorrect - caused 500 error):
.select('id, saved_at, profiles:user_id (...)')

// After (correct):
// Query 1: Get saved events
const { data: savedEvents } = await supabase
  .from('saved_events')
  .select('id, saved_at, user_id')
  .eq('event_id', eventId);

// Query 2: Get profiles for those users
const { data: profiles } = await supabase
  .from('profiles')
  .select('id, full_name, email, avatar_url')
  .in('id', userIds);

// Query 3: Combine the data
```

### Error Handling
| Scenario | Response |
|----------|----------|
| No attendees | 200 - Empty array `[]` |
| Invalid event ID | 200 - Empty array `[]` |
| Database error | 500 - Error details in logs |

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
