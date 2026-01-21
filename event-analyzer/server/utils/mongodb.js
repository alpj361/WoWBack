const { MongoClient } = require('mongodb');

let db = null;
let client = null;

/**
 * Connect to MongoDB
 * @returns {Promise<Object>} MongoDB database instance
 */
async function connectToDatabase() {
  if (db) {
    return db;
  }

  const mongoUrl = process.env.MONGO_URL;
  const dbName = process.env.DB_NAME;

  if (!mongoUrl || !dbName) {
    console.log('[MONGODB] ⚠️ MongoDB not configured (MONGO_URL/DB_NAME missing) - running without database');
    return null;
  }

  try {
    console.log('[MONGODB] Connecting to MongoDB...');

    client = new MongoClient(mongoUrl, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
    });

    await client.connect();

    db = client.db(dbName);

    console.log(`[MONGODB] ✅ Connected to database: ${dbName}`);

    return db;
  } catch (error) {
    console.error('[MONGODB] ❌ Connection error:', error.message);
    console.log('[MONGODB] ⚠️ Continuing without database...');
    return null;
  }
}

/**
 * Get MongoDB database instance
 * @returns {Object} MongoDB database instance
 */
function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call connectToDatabase() first.');
  }
  return db;
}

/**
 * Close MongoDB connection
 */
async function closeConnection() {
  if (client) {
    await client.close();
    db = null;
    client = null;
    console.log('[MONGODB] Connection closed');
  }
}

/**
 * Check MongoDB connection status
 * @returns {Promise<boolean>} True if connected, false otherwise
 */
async function isConnected() {
  if (!client) return false;

  try {
    await client.db('admin').command({ ping: 1 });
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  connectToDatabase,
  getDatabase,
  closeConnection,
  isConnected
};
