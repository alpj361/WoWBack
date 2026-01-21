require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initSupabase, isConfigured } = require('./utils/supabase');
const imageAnalysisRoutes = require('./routes/imageAnalysis');
const eventsRoutes = require('./routes/events');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS || '*',
  credentials: true
}));

app.use(express.json({ limit: '50mb' })); // Support large base64 images
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'healthy',
    service: 'event-analyzer',
    supabase: isConfigured() ? 'configured' : 'not configured',
    openai: process.env.OPENAI_API_KEY ? 'configured' : 'not configured',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  };

  const statusCode = isConfigured() && process.env.OPENAI_API_KEY ? 200 : 503;

  res.status(statusCode).json(health);
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/events', imageAnalysisRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Event Analyzer API',
    version: '1.1.0',
    description: 'Event management and image analysis service',
    endpoints: {
      health: 'GET /api/health',
      createEvent: 'POST /api/events',
      listEvents: 'GET /api/events',
      getEvent: 'GET /api/events/:id',
      analyzeImage: 'POST /api/events/analyze-image'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Initialize and start server
async function startServer() {
  try {
    console.log('==========================================');
    console.log('🚀 Event Analyzer API Starting...');
    console.log('==========================================');

    // Initialize Supabase
    initSupabase();

    // Start Express server
    app.listen(PORT, '0.0.0.0', () => {
      console.log('==========================================');
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
      console.log('==========================================');
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  process.exit(0);
});

// Start the server
startServer();
