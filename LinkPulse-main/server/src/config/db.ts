import 'dotenv/config';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';

let mongoMemoryServer: MongoMemoryServer | null = null;
let isConnected = false;

export async function connectDB(): Promise<typeof mongoose> {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose;
  }

  const explicitUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/linkpulse';

  if (explicitUri) {
    try {
      console.log(`Connecting to MongoDB database at ${explicitUri}...`);
      await mongoose.connect(explicitUri, {
        serverSelectionTimeoutMS: 5000,
      });
      isConnected = true;
      console.log(`✅ Connected to MongoDB database: ${mongoose.connection.host}:${mongoose.connection.port || 27017} (${mongoose.connection.name})`);
      return mongoose;
    } catch (err: any) {
      console.warn(`⚠️ Failed to connect to ${explicitUri}: ${err.message}. Initializing embedded MongoDB engine...`);
    }
  }

  // Fallback to high-performance embedded MongoMemoryServer
  if (!mongoMemoryServer) {
    console.log('⚡ Starting high-performance embedded MongoDB server...');
    const { MongoMemoryServer: MMS } = await import('mongodb-memory-server');
    mongoMemoryServer = await MMS.create({
      instance: {
        dbName: 'linkpulse',
      },
    });
  }

  const uri = mongoMemoryServer.getUri();
  await mongoose.connect(uri);
  isConnected = true;
  console.log(`✅ Embedded MongoDB cluster active at ${uri} (db: linkpulse)`);

  return mongoose;
}

export async function disconnectDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoMemoryServer) {
    await mongoMemoryServer.stop();
    mongoMemoryServer = null;
  }
  isConnected = false;
}

export function getDbStatus() {
  const stateMap: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  return {
    status: isConnected ? 'healthy' : 'degraded',
    state: stateMap[mongoose.connection.readyState] || 'unknown',
    host: mongoose.connection.host || 'embedded-memory-server',
    port: mongoose.connection.port || 27017,
    name: mongoose.connection.name || 'linkpulse',
    isEmbedded: Boolean(mongoMemoryServer),
  };
}
