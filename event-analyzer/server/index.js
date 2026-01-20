require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectToDatabase, isConnected } = require('./utils/mongodb');
const imageAnalysisRoutes = require('./routes/imageAnalysis');

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
  const mongoConnected = await isConnected();

  const health = {
    status: 'healthy',
    service: 'event-analyzer',
    mongodb: mongoConnected ? 'connected' : 'disconnected',
    openai: process.env.OPENAI_API_KEY ? 'configured' : 'not configured',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  };

  const statusCode = mongoConnected && process.env.OPENAI_API_KEY ? 200 : 503;

  res.status(statusCode).json(health);
});

// API Routes
app.use('/api/events', imageAnalysisRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Event Analyzer API',
    version: '1.0.0',
    description: 'Image analysis service for event extraction using OpenAI Vision',
    endpoints: {
      health: 'GET /api/health',
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

// Initialize database and start server
async function startServer() {
  try {
    console.log('==========================================');
    console.log('🚀 Event Analyzer API Starting...');
    console.log('==========================================');

    // Connect to MongoDB
    await connectToDatabase();

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
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  const { closeConnection } = require('./utils/mongodb');
  await closeConnection();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server');
  const { closeConnection } = require('./utils/mongodb');
  await closeConnection();
  process.exit(0);
});

// Start the server
startServer();
