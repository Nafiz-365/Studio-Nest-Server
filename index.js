import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
    process.env.CLIENT_URL || "http://localhost:3000"
  ],
  credentials: true
}));
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("Connected to StudioNest MongoDB Atlas successfully!");
    return client;
  } catch (err) {
    console.error("MongoDB Atlas connection error:", err);
    throw err;
  }
}

const mongoClient = await connectToMongoDB();
const db = mongoClient.db("studionest");

// Root Health Check
app.get("/", (req, res) => {
  res.json({
    name: "StudioNest API Server",
    status: "online",
    message: "Server is running fine!",
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`StudioNest Server running on port ${PORT}`);
});

export default app;
