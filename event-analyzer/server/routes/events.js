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

        const { title, description, category, image, date, time, location, user_id } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Title is required'
            });
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
            user_id: user_id || null
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

        const { data, error } = await supabase
            .from('saved_events')
            .select(`
                id,
                saved_at,
                profiles:user_id (
                    id,
                    full_name,
                    email,
                    avatar_url
                )
            `)
            .eq('event_id', eventId)
            .order('saved_at', { ascending: false });

        if (error) {
            throw error;
        }

        res.json({ success: true, attendees: data });

    } catch (error) {
        console.error('[EVENTS] ❌ Attendees error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch attendees'
        });
    }
});

module.exports = router;
