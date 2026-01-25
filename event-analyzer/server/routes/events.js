const express = require('express');
const router = express.Router();
const { getSupabase, isConfigured } = require('../utils/supabase');

/**
 * POST /api/events
 * Create a new event
 */
router.post('/', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { 
            title, description, category, image, date, time, location, user_id,
            price, registration_form_url, bank_account_number, bank_name 
        } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Title is required'
            });
        }

        // Validar que si hay precio, debe haber información bancaria
        if (price && price > 0) {
            if (!bank_account_number || !bank_name) {
                return res.status(400).json({
                    success: false,
                    error: 'Bank account information is required for paid events'
                });
            }
        }

        const supabase = getSupabase();

        const eventData = {
            title: title.trim(),
            description: description?.trim() || null,
            category: category || 'general',
            image: image || null,
            date: date || null,
            time: time || null,
            location: location?.trim() || null,
            user_id: user_id || null,
            price: price || null,
            registration_form_url: registration_form_url?.trim() || null,
            bank_account_number: bank_account_number?.trim() || null,
            bank_name: bank_name?.trim() || null
        };

        console.log('[EVENTS] Creating event:', eventData.title);

        const { data, error } = await supabase
            .from('events')
            .insert([eventData])
            .select()
            .single();

        if (error) {
            console.error('[EVENTS] ❌ Insert error:', error.message);
            throw error;
        }

        console.log('[EVENTS] ✅ Event created:', data.id);

        res.status(201).json({
            success: true,
            event: data
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to create event',
            message: error.message
        });
    }
});

/**
 * GET /api/events
 * List all events with optional category filter
 */
router.get('/', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { category } = req.query;
        const supabase = getSupabase();

        let query = supabase
            .from('events')
            .select('*')
            .order('created_at', { ascending: false });

        if (category && category !== 'all') {
            query = query.eq('category', category);
        }

        const { data, error } = await query;

        if (error) {
            console.error('[EVENTS] ❌ Query error:', error.message);
            throw error;
        }

        res.json({
            success: true,
            events: data
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch events',
            message: error.message
        });
    }
});

/**
 * GET /api/events/hosted/:userId
 * List events hosted by a specific user with attendee counts
 */
router.get('/hosted/:userId', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { userId } = req.params;
        const supabase = getSupabase();

        // Get events where user_id matches
        const { data: events, error } = await supabase
            .from('events')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        // For each event, get the attendee count from saved_events
        const eventsWithAttendees = await Promise.all(
            events.map(async (event) => {
                const { count } = await supabase
                    .from('saved_events')
                    .select('*', { count: 'exact', head: true })
                    .eq('event_id', event.id);

                return { ...event, attendee_count: count || 0 };
            })
        );

        res.json({ success: true, events: eventsWithAttendees });

    } catch (error) {
        console.error('[EVENTS] ❌ Hosted events error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch hosted events'
        });
    }
});

/**
 * GET /api/events/:eventId/attendees
 * List users who saved a specific event
 */
router.get('/:eventId/attendees', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { eventId } = req.params;
        const supabase = getSupabase();

        // First, get all saved_events for this event
        const { data: savedEvents, error: savedError } = await supabase
            .from('saved_events')
            .select('id, saved_at, user_id')
            .eq('event_id', eventId)
            .order('saved_at', { ascending: false });

        if (savedError) {
            console.error('[EVENTS] ❌ Saved events query error:', savedError.message);
            throw savedError;
        }

        // If no saved events, return empty array
        if (!savedEvents || savedEvents.length === 0) {
            return res.json({ success: true, attendees: [] });
        }

        // Get user IDs
        const userIds = savedEvents.map(se => se.user_id);

        // Fetch profiles for these users
        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, full_name, email, avatar_url')
            .in('id', userIds);

        if (profilesError) {
            console.error('[EVENTS] ❌ Profiles query error:', profilesError.message);
            throw profilesError;
        }

        // Combine the data
        const attendees = savedEvents.map(savedEvent => {
            const profile = profiles?.find(p => p.id === savedEvent.user_id);
            return {
                id: savedEvent.id,
                saved_at: savedEvent.saved_at,
                profiles: profile || null
            };
        });

        res.json({ success: true, attendees });

    } catch (error) {
        console.error('[EVENTS] ❌ Attendees error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch attendees',
            message: error.message
        });
    }
});

/**
 * GET /api/events/:id
 * Get single event by ID
 */
router.get('/:id', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { id } = req.params;
        const supabase = getSupabase();

        const { data, error } = await supabase
            .from('events')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    error: 'Event not found'
                });
            }
            throw error;
        }

        res.json({
            success: true,
            event: data
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch event',
            message: error.message
        });
    }
});



/**
 * POST /api/events/:eventId/register
 * Create a registration request for an event
 */
router.post('/:eventId/register', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { eventId } = req.params;
        const { user_id, payment_receipt_url, registration_form_completed } = req.body;

        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'User ID is required'
            });
        }

        const supabase = getSupabase();

        // Check if registration already exists
        const { data: existing } = await supabase
            .from('event_registrations')
            .select('*')
            .eq('event_id', eventId)
            .eq('user_id', user_id)
            .single();

        if (existing) {
            return res.status(400).json({
                success: false,
                error: 'Registration already exists for this event'
            });
        }

        const registrationData = {
            event_id: eventId,
            user_id: user_id,
            status: 'pending',
            payment_receipt_url: payment_receipt_url || null,
            registration_form_completed: registration_form_completed || false
        };

        console.log('[EVENTS] Creating registration for event:', eventId);

        const { data, error } = await supabase
            .from('event_registrations')
            .insert([registrationData])
            .select()
            .single();

        if (error) {
            console.error('[EVENTS] ❌ Registration error:', error.message);
            throw error;
        }

        console.log('[EVENTS] ✅ Registration created:', data.id);

        res.status(201).json({
            success: true,
            registration: data
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to create registration',
            message: error.message
        });
    }
});

/**
 * GET /api/events/:eventId/registrations
 * List all registrations for an event (host only)
 */
router.get('/:eventId/registrations', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { eventId } = req.params;
        const supabase = getSupabase();

        // Get all registrations for this event
        const { data: registrations, error } = await supabase
            .from('event_registrations')
            .select('*')
            .eq('event_id', eventId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[EVENTS] ❌ Registrations query error:', error.message);
            throw error;
        }

        if (!registrations || registrations.length === 0) {
            return res.json({ success: true, registrations: [] });
        }

        // Get user profiles for each registration
        const userIds = registrations.map(r => r.user_id);
        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, full_name, email, avatar_url')
            .in('id', userIds);

        if (profilesError) {
            console.error('[EVENTS] ❌ Profiles query error:', profilesError.message);
            throw profilesError;
        }

        // Combine registration data with user profiles
        const registrationsWithProfiles = registrations.map(reg => {
            const profile = profiles?.find(p => p.id === reg.user_id);
            return {
                ...reg,
                user: profile || null
            };
        });

        res.json({
            success: true,
            registrations: registrationsWithProfiles
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch registrations',
            message: error.message
        });
    }
});

/**
 * PATCH /api/events/registrations/:registrationId/approve
 * Approve a registration request
 */
router.patch('/registrations/:registrationId/approve', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { registrationId } = req.params;
        const supabase = getSupabase();

        // Get the registration
        const { data: registration, error: fetchError } = await supabase
            .from('event_registrations')
            .select('*')
            .eq('id', registrationId)
            .single();

        if (fetchError || !registration) {
            return res.status(404).json({
                success: false,
                error: 'Registration not found'
            });
        }

        // Update status to approved
        const { data, error } = await supabase
            .from('event_registrations')
            .update({ status: 'approved' })
            .eq('id', registrationId)
            .select()
            .single();

        if (error) {
            console.error('[EVENTS] ❌ Approve error:', error.message);
            throw error;
        }

        // Add to saved_events if approved
        const { error: savedError } = await supabase
            .from('saved_events')
            .insert([{
                user_id: registration.user_id,
                event_id: registration.event_id
            }]);

        if (savedError && savedError.code !== '23505') { // Ignore duplicate errors
            console.error('[EVENTS] ❌ Saved events error:', savedError.message);
        }

        console.log('[EVENTS] ✅ Registration approved:', registrationId);

        res.json({
            success: true,
            registration: data
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to approve registration',
            message: error.message
        });
    }
});

/**
 * PATCH /api/events/registrations/:registrationId/reject
 * Reject a registration request with optional reason
 */
router.patch('/registrations/:registrationId/reject', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { registrationId } = req.params;
        const { rejection_reason } = req.body;
        const supabase = getSupabase();

        const updateData = {
            status: 'rejected',
            rejection_reason: rejection_reason?.trim() || null
        };

        const { data, error } = await supabase
            .from('event_registrations')
            .update(updateData)
            .eq('id', registrationId)
            .select()
            .single();

        if (error) {
            console.error('[EVENTS] ❌ Reject error:', error.message);
            throw error;
        }

        console.log('[EVENTS] ✅ Registration rejected:', registrationId);

        res.json({
            success: true,
            registration: data
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to reject registration',
            message: error.message
        });
    }
});

/**
 * GET /api/events/registrations/user/:userId
 * Get all registrations for a specific user
 */
router.get('/registrations/user/:userId', async (req, res) => {
    try {
        if (!isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Database not configured'
            });
        }

        const { userId } = req.params;
        const supabase = getSupabase();

        const { data: registrations, error } = await supabase
            .from('event_registrations')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[EVENTS] ❌ User registrations error:', error.message);
            throw error;
        }

        res.json({
            success: true,
            registrations: registrations || []
        });

    } catch (error) {
        console.error('[EVENTS] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch user registrations',
            message: error.message
        });
    }
});

module.exports = router;
