# Pending Configuration

This document tracks pending configuration items that require manual setup.

## 1. Google OAuth Setup

### Google Cloud Console
1. Go to: https://console.cloud.google.com/apis/credentials
2. Create OAuth 2.0 Client ID
3. Application type: **Web application**
4. Authorized redirect URIs:
   - `https://dyvchjqtwhadgybwmbjl.supabase.co/auth/v1/callback`

### Supabase Dashboard
1. Go to: https://supabase.com/dashboard/project/dyvchjqtwhadgybwmbjl/auth/providers
2. Find **Google** provider → Enable
3. Enter:
   - Client ID (from Google)
   - Client Secret (from Google)

---

## 2. Environment Variables

### Frontend (.env)
```bash
EXPO_PUBLIC_API_URL=https://api.standatpd.com/api
EXPO_PUBLIC_SUPABASE_URL=https://dyvchjqtwhadgybwmbjl.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<get from Supabase Dashboard>
```

Get anon key from: https://supabase.com/dashboard/project/dyvchjqtwhadgybwmbjl/settings/api

### Backend (.env)
Already configured with:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `OPENAI_API_KEY`

---

## 3. Create Invitation Codes

Run this SQL in Supabase SQL Editor:
```sql
INSERT INTO invitation_codes (code, description, user_type, credits, max_uses)
VALUES 
  ('WOWBETA2024', 'Beta testers', 'Beta', 100, 50),
  ('WOWVIP2024', 'VIP access', 'VIP', 500, 10);
```

---

## 4. VPS Deployment

- [ ] Deploy backend with Docker
- [ ] Configure Supabase env vars on VPS
- [ ] Set up SSL for api.standatpd.com
- [ ] Test OAuth redirect on production

---

## Status

| Item | Status |
|------|--------|
| Google OAuth credentials | ⏳ Pending |
| Supabase Google provider | ⏳ Pending |
| Frontend Supabase anon key | ⏳ Pending |
| Invitation codes | ⏳ Pending |
| VPS deployment | ⏳ Pending |
