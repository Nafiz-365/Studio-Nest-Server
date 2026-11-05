import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import "dotenv/config";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { initialStudios } from "./seedData.js";

const app = express();
const PORT = process.env.PORT || 8000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const ALLOW_DEV_AUTH_FALLBACK =
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_DEV_AUTH_FALLBACK === "true";

// Middleware
app.use(
    cors({
        origin: ["http://localhost:3000", CLIENT_URL],
        credentials: true,
    }),
);
app.use(express.json({ limit: "10mb" }));

const MAX_STUDIO_IMAGES = 6;
const MAX_DATA_IMAGE_LENGTH = 1_250_000;

function isValidStudioImages(images) {
    return (
        Array.isArray(images) &&
        images.length > 0 &&
        images.length <= MAX_STUDIO_IMAGES &&
        images.every((image) => {
            if (typeof image !== "string") return false;
            if (/^data:image\/(?:jpeg|png|webp);base64,/i.test(image)) {
                return image.length <= MAX_DATA_IMAGE_LENGTH;
            }
            if (image.length > 2048) return false;
            try {
                return ["http:", "https:"].includes(new URL(image).protocol);
            } catch {
                return false;
            }
        })
    );
}

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

const studiosCollection = db.collection("studios");
const bookingsCollection = db.collection("bookings");
const wishlistCollection = db.collection("wishlists");

const sendServerError = (res, message, error) => {
    console.error(message, error);
    return res.status(500).json({
        error: message,
        details:
            process.env.NODE_ENV === "production"
                ? "Internal server error"
                : error instanceof Error
                  ? error.message
                  : String(error),
    });
};

await Promise.all([
    studiosCollection.createIndex({ ownerEmail: 1 }),
    studiosCollection.createIndex({ category: 1, rate: 1 }),
    bookingsCollection.createIndex({ studioId: 1, date: 1, status: 1 }),
    bookingsCollection.createIndex({ userEmail: 1, createdAt: -1 }),
    wishlistCollection.createIndex({ email: 1 }, { unique: true }),
]);

// Automatically seed initial studios if empty on startup
(async () => {
    try {
        const count = await studiosCollection.countDocuments();
        if (count === 0) {
            console.log(
                "Empty database detected. Seeding 6 production studios...",
            );
            await studiosCollection.insertMany(initialStudios);
            console.log("StudioNest seed completed successfully!");
        }
    } catch (err) {
        console.warn("Auto-seed notice:", err.message);
    }
})();

// JWT Authentication Verification Middleware (matches b14-wanderlust-server pattern)
export const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res
            .status(401)
            .json({ msg: "Unauthorized: Missing authorization header!" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
        return res.status(401).json({ msg: "Unauthorized: Token missing!" });
    }

    try {
        const JWKS = createRemoteJWKSet(new URL(`${CLIENT_URL}/api/auth/jwks`));
        const { payload } = await jwtVerify(token, JWKS);
        if (typeof payload.email !== "string" || !payload.email.trim()) {
            return res
                .status(401)
                .json({ msg: "Unauthorized: Token has no valid user email." });
        }
        req.user = payload;
        next();
    } catch (error) {
        // Keep the fallback disabled unless it is explicitly enabled for local development.
        const devFallbackEmail = req.headers["x-user-email"];
        if (
            ALLOW_DEV_AUTH_FALLBACK &&
            (devFallbackEmail || token === "demo-token")
        ) {
            req.user = {
                email: devFallbackEmail || "demo@studionest.co",
                name: "Demo Creator",
            };
            return next();
        }
        return res
            .status(401)
            .json({ msg: "Unauthorized: Invalid or expired token!" });
    }
};

// Root Health Check
app.get("/", (req, res) => {
    res.json({
        name: "StudioNest API Server",
        status: "online",
        message: "Server is running fine!",
        timestamp: new Date().toISOString(),
    });
});

// Seed endpoint for manual triggers
app.post("/seed-studios", async (req, res) => {
    try {
        const count = await studiosCollection.countDocuments();
        if (count === 0) {
            const result = await studiosCollection.insertMany(initialStudios);
            return res.json({
                message: "Seeded initial studios successfully!",
                insertedCount: result.insertedCount,
            });
        }
        res.json({ message: "Database already contains studios.", count });
    } catch (err) {
        res.status(500).json({
            error: "Failed to seed studios",
            details:
                process.env.NODE_ENV === "production"
                    ? "Internal server error"
                    : err.message,
        });
    }
});

// GET /studios - Multi-param filtered studio discovery
app.get("/studios", async (req, res) => {
    try {
        const { category, search, minPrice, maxPrice, sort } = req.query;
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const requestedLimit = Number.parseInt(req.query.limit, 10);
        const hasPagination = Number.isFinite(requestedLimit);
        const limit = Math.min(100, Math.max(1, requestedLimit || 24));
        const query = {};

        if (category && category !== "All") {
            query.category = category;
        }

        const searchTerm =
            typeof search === "string" ? search.trim().slice(0, 100) : "";
        if (searchTerm) {
            const escapedSearch = searchTerm.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&",
            );
            query.$or = [
                { title: { $regex: escapedSearch, $options: "i" } },
                { location: { $regex: escapedSearch, $options: "i" } },
                { city: { $regex: escapedSearch, $options: "i" } },
                { description: { $regex: escapedSearch, $options: "i" } },
                { amenities: { $regex: escapedSearch, $options: "i" } },
            ];
        }

        if (minPrice || maxPrice) {
            query.rate = {};
            if (minPrice) query.rate.$gte = Number(minPrice);
            if (maxPrice) query.rate.$lte = Number(maxPrice);
        }

        let sortOption = { createdAt: -1 };
        if (sort === "price_asc") sortOption = { rate: 1 };
        else if (sort === "price_desc") sortOption = { rate: -1 };
        else if (sort === "rating_desc") sortOption = { rating: -1 };
        else if (sort === "newest") sortOption = { createdAt: -1 };

        const cursor = studiosCollection.find(query).sort(sortOption);
        if (hasPagination) cursor.skip((page - 1) * limit).limit(limit);
        const studios = await cursor.toArray();
        if (!hasPagination) return res.json(studios);
        const total = await studiosCollection.countDocuments(query);
        res.json({
            data: studios,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        return sendServerError(res, "Failed to fetch studios", err);
    }
});

// GET /featured-studios - Top 6 rated studios using .limit(6)
app.get("/featured-studios", async (req, res) => {
    try {
        const featured = await studiosCollection
            .find()
            .sort({ rating: -1, createdAt: -1 })
            .limit(6)
            .toArray();
        res.json(featured);
    } catch (err) {
        res.status(500).json({
            error: "Failed to fetch featured studios",
            details:
                process.env.NODE_ENV === "production"
                    ? "Internal server error"
                    : err.message,
        });
    }
});

// GET /studio/:id - Single studio details
app.get("/studio/:id", async (req, res) => {
    try {
        const { id } = req.params;
        let studio = null;

        if (ObjectId.isValid(id)) {
            studio = await studiosCollection.findOne({ _id: new ObjectId(id) });
        }
        if (!studio) {
            studio = await studiosCollection.findOne({ id: id });
        }

        if (!studio) {
            return res.status(404).json({ error: "Studio not found" });
        }
        res.json(studio);
    } catch (err) {
        res.status(500).json({
            error: "Failed to fetch studio details",
            details:
                process.env.NODE_ENV === "production"
                    ? "Internal server error"
                    : err.message,
        });
    }
});

// GET /my-studios/:email - Studios listed by a specific host
app.get("/my-studios/:email", verifyToken, async (req, res) => {
    try {
        const { email } = req.params;
        if (
            !req.user?.email ||
            req.user.email.toLowerCase() !== email.toLowerCase()
        ) {
            return res
                .status(403)
                .json({ error: "You can only view your own studio listings." });
        }
        const studios = await studiosCollection
            .find({
                ownerEmail: email.toLowerCase(),
            })
            .sort({ createdAt: -1 })
            .toArray();
        res.json(studios);
    } catch (err) {
        res.status(500).json({
            error: "Failed to fetch host listings",
            details:
                process.env.NODE_ENV === "production"
                    ? "Internal server error"
                    : err.message,
        });
    }
});

// GET /host-bookings - Requests for studios owned by the authenticated host
app.get("/host-bookings", verifyToken, async (req, res) => {
    try {
        const ownedStudios = await studiosCollection
            .find(
                { ownerEmail: req.user.email.toLowerCase() },
                { projection: { _id: 1, id: 1 } },
            )
            .toArray();
        const studioIds = ownedStudios.flatMap((studio) =>
            [studio.id, studio._id?.toString()].filter(
                (id) => typeof id === "string" && id.length > 0,
            ),
        );
        if (!studioIds.length) return res.json([]);

        const requests = await bookingsCollection
            .find({ studioId: { $in: studioIds } })
            .sort({ createdAt: -1 })
            .toArray();
        res.json(requests);
    } catch (err) {
        return sendServerError(
            res,
            "Failed to fetch host booking requests",
            err,
        );
    }
});

// POST /add-studio - Create new creative studio listing (Protected)
app.post("/add-studio", verifyToken, async (req, res) => {
    try {
        const data = req.body;
        if (!isValidStudioImages(data.images)) {
            return res.status(400).json({
                error: `Add between 1 and ${MAX_STUDIO_IMAGES} valid studio images.`,
            });
        }
        const userEmail = req.user.email.toLowerCase();
        const userName = req.user?.name || data.ownerName;

        const newStudio = {
            ...data,
            ownerEmail: userEmail,
            ownerName: userName,
            rating: 0,
            reviewsCount: 0,
            reviews: [],
            createdAt: new Date().toISOString(),
        };

        const result = await studiosCollection.insertOne(newStudio);
        res.status(201).json({
            message: "Studio listing created successfully!",
            insertedId: result.insertedId,
            studio: { ...newStudio, _id: result.insertedId },
        });
    } catch (err) {
        res.status(500).json({
            error: "Failed to create studio listing",
            details:
                process.env.NODE_ENV === "production"
                    ? "Internal server error"
                    : err.message,
        });
    }
});

// PATCH /studio/:id - Update studio listing (Protected)
app.patch("/studio/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const editableFields = [
            "title",
            "category",
            "rate",
            "deposit",
            "capacity",
            "location",
            "address",
            "images",
            "amenities",
            "overview",
            "size",
            "rules",
        ];
        const updateData = Object.fromEntries(
            editableFields
                .filter((field) => Object.hasOwn(req.body, field))
                .map((field) => [field, req.body[field]]),
        );
        if (
            Object.hasOwn(updateData, "images") &&
            !isValidStudioImages(updateData.images)
        ) {
            return res.status(400).json({
                error: `Add between 1 and ${MAX_STUDIO_IMAGES} valid studio images.`,
            });
        }
        if (!Object.keys(updateData).length) {
            return res.status(400).json({
                error: "No editable studio fields were provided.",
            });
        }

        let filter = null;
        if (ObjectId.isValid(id)) {
            filter = { _id: new ObjectId(id) };
        } else {
            filter = { id: id };
        }

        const existing = await studiosCollection.findOne(filter);
        if (!existing) {
            return res.status(404).json({ error: "Studio not found" });
        }

        if (
            typeof req.user?.email !== "string" ||
            !req.user.email.trim() ||
            typeof existing.ownerEmail !== "string" ||
            !existing.ownerEmail.trim() ||
            existing.ownerEmail.toLowerCase() !== req.user.email.toLowerCase()
        ) {
            return res.status(403).json({
                error: "Unauthorized: You can only edit your own studio listings.",
            });
        }

        updateData.updatedAt = new Date().toISOString();
        const result = await studiosCollection.updateOne(filter, {
            $set: updateData,
        });

        res.json({
            message: "Studio details updated successfully!",
            modifiedCount: result.modifiedCount,
        });
    } catch (err) {
        res.status(500).json({
            error: "Failed to update studio listing",
            details:
                process.env.NODE_ENV === "production"
                    ? "Internal server error"
                    : err.message,
        });
    }
});

// DELETE /studio/:id - Remove studio listing (Protected)
app.delete("/studio/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        let filter = null;
        if (ObjectId.isValid(id)) {
            filter = { _id: new ObjectId(id) };
        } else {
            filter = { id: id };
        }

        const existing = await studiosCollection.findOne(filter);
        if (!existing) {
            return res
                .status(404)
                .json({ error: "Studio already removed or not found" });
        }

        if (
            typeof req.user?.email !== "string" ||
            !req.user.email.trim() ||
            typeof existing.ownerEmail !== "string" ||
            !existing.ownerEmail.trim() ||
            existing.ownerEmail.toLowerCase() !== req.user.email.toLowerCase()
        ) {
            return res.status(403).json({
                error: "Unauthorized: You can only delete your own studio listings.",
            });
        }

        const deletionSession = client.startSession();
        let deletedCount = 0;
        try {
            await deletionSession.withTransaction(async () => {
                const result = await studiosCollection.deleteOne(filter, {
                    session: deletionSession,
                });
                deletedCount = result.deletedCount;
                if (deletedCount) {
                    await bookingsCollection.updateMany(
                        { studioId: id, status: "Pending" },
                        {
                            $set: {
                                status: "Cancelled",
                                cancelledAt: new Date().toISOString(),
                                cancellationReason: "Studio listing removed",
                            },
                        },
                        { session: deletionSession },
                    );
                }
            });
        } finally {
            await deletionSession.endSession();
        }

        if (!deletedCount) {
            return res.status(404).json({ error: "Studio not found" });
        }

        res.json({
            message: `${existing.title} removed successfully!`,
            deletedCount,
        });
    } catch (err) {
        res.status(500).json({
            error: "Failed to delete studio",
            details:
                process.env.NODE_ENV === "production"
                    ? "Internal server error"
                    : err.message,
        });
    }
});

// Helper: Calculate session hours
function calculateHours(startTime, endTime) {
    const [startH, startM] = startTime.split(":").map(Number);
    const [endH, endM] = endTime.split(":").map(Number);
    const diffInMinutes = endH * 60 + endM - (startH * 60 + startM);
    return diffInMinutes / 60;
}

// POST /booking - Smart reservation with double-booking collision prevention
app.post("/booking", verifyToken, async (req, res) => {
    try {
        const data = {
            ...req.body,
            userEmail: req.user.email.toLowerCase(),
            userName: req.user?.name || req.body.userName,
        };
        const { studioId, date, startTime, endTime } = data;

        if (!studioId || !date || !startTime || !endTime) {
            return res.status(400).json({
                error: "Missing required booking details (studioId, date, startTime, endTime).",
            });
        }

        const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            !timePattern.test(startTime) ||
            !timePattern.test(endTime)
        ) {
            return res.status(400).json({
                error: "Invalid booking date or time format.",
            });
        }

        const [year, month, day] = date.split("-").map(Number);
        const calendarDate = new Date(Date.UTC(year, month - 1, day));
        const validCalendarDate =
            calendarDate.getUTCFullYear() === year &&
            calendarDate.getUTCMonth() === month - 1 &&
            calendarDate.getUTCDate() === day;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayString = [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, "0"),
            String(today.getDate()).padStart(2, "0"),
        ].join("-");
        const reqStart = new Date(`${date}T${startTime}:00`).getTime();
        const reqEnd = new Date(`${date}T${endTime}:00`).getTime();
        if (
            !validCalendarDate ||
            date < todayString ||
            !Number.isFinite(reqStart) ||
            !Number.isFinite(reqEnd) ||
            reqEnd <= reqStart ||
            reqEnd - reqStart < 60 * 60 * 1000
        ) {
            return res.status(400).json({
                error: "Choose a future date and a session of at least one hour.",
            });
        }

        const studioFilter = ObjectId.isValid(studioId)
            ? { _id: new ObjectId(studioId) }
            : { id: studioId };
        const studio = await studiosCollection.findOne(studioFilter);
        if (!studio) {
            return res.status(404).json({ error: "Studio not found" });
        }
        if (!Number.isInteger(data.guests) || data.guests < 1) {
            return res.status(400).json({
                error: "Guest count must be at least one.",
            });
        }

        const bookingSession = client.startSession();
        let bookingResult = null;
        let collisionMessage = null;
        let guestCapacity = null;
        let studioMissing = false;
        try {
            await bookingSession.withTransaction(async () => {
                bookingResult = null;
                collisionMessage = null;
                guestCapacity = null;
                studioMissing = false;

                // This write serializes transactions for the same studio.
                const lockResult = await studiosCollection.updateOne(
                    studioFilter,
                    { $inc: { _bookingLockVersion: 1 } },
                    { session: bookingSession },
                );
                if (!lockResult.matchedCount) {
                    studioMissing = true;
                    return;
                }

                const currentStudio = await studiosCollection.findOne(
                    studioFilter,
                    { session: bookingSession },
                );
                if (!currentStudio) {
                    studioMissing = true;
                    return;
                }
                if (data.guests > currentStudio.capacity) {
                    guestCapacity = currentStudio.capacity;
                    return;
                }

                const overlappingBookings = await bookingsCollection
                    .find(
                        {
                            studioId,
                            date,
                            status: { $in: ["Confirmed", "Pending"] },
                        },
                        { session: bookingSession },
                    )
                    .toArray();

                const collision = overlappingBookings.find((booking) => {
                    const bookingStart = new Date(
                        `${booking.date}T${booking.startTime}:00`,
                    ).getTime();
                    const bookingEnd = new Date(
                        `${booking.date}T${booking.endTime}:00`,
                    ).getTime();
                    return reqStart < bookingEnd && reqEnd > bookingStart;
                });

                if (collision) {
                    collisionMessage = `This workspace is already reserved from ${collision.startTime} to ${collision.endTime} on ${date}. Please choose another time slot.`;
                    return;
                }

                const hours = calculateHours(startTime, endTime);
                const rate = currentStudio.rate;
                const deposit = currentStudio.deposit;
                const subtotal = hours * rate;
                const serviceFee = Math.round(subtotal * 0.08);
                const total = subtotal + serviceFee + deposit;
                const newBooking = {
                    ...data,
                    hours,
                    rate,
                    subtotal,
                    serviceFee,
                    deposit,
                    total,
                    status: "Pending",
                    createdAt: new Date().toISOString(),
                };
                const result = await bookingsCollection.insertOne(newBooking, {
                    session: bookingSession,
                });
                bookingResult = {
                    insertedId: result.insertedId,
                    booking: newBooking,
                };
            });
        } finally {
            await bookingSession.endSession();
        }

        if (studioMissing) {
            return res.status(404).json({ error: "Studio not found" });
        }
        if (guestCapacity !== null) {
            return res.status(400).json({
                error: `Guest count must be between 1 and ${guestCapacity}.`,
            });
        }
        if (collisionMessage) {
            return res.status(409).json({
                error: "Double booking collision detected",
                message: collisionMessage,
            });
        }
        if (!bookingResult) {
            throw new Error("Booking transaction completed without a result.");
        }

        res.status(201).json({
            message: "Studio reserved successfully! Confirmation generated.",
            insertedId: bookingResult.insertedId,
            booking: {
                ...bookingResult.booking,
                _id: bookingResult.insertedId,
            },
        });
    } catch (err) {
        res.status(500).json({
            error: "Failed to create booking reservation",
            details:
                process.env.NODE_ENV === "production"
                    ? "Internal server error"
                    : err.message,
        });
    }
});

// GET /my-bookings/:email - User bookings retrieval (Protected)
app.get("/my-bookings/:email", verifyToken, async (req, res) => {
    try {
        const { email } = req.params;
        if (
            !req.user?.email ||
            req.user.email.toLowerCase() !== email.toLowerCase()
        ) {
            return res
                .status(403)
                .json({ error: "You can only view your own bookings." });
        }
        const bookings = await bookingsCollection
            .find({ userEmail: email.toLowerCase() })
            .sort({ createdAt: -1 })
            .toArray();

        res.json(bookings);
    } catch (err) {
        res.status(500).json({
            error: "Failed to fetch user bookings",
            details:
                process.env.NODE_ENV === "production"
                    ? "Internal server error"
                    : err.message,
        });
    }
});

// PATCH /booking/:id/cancel - Cancel pending booking
app.patch("/booking/:id/cancel", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        let filter = ObjectId.isValid(id)
            ? { _id: new ObjectId(id) }
            : { id: id };

        const booking = await bookingsCollection.findOne(filter);
        if (!booking) {
            return res.status(404).json({ error: "Reservation not found" });
        }
        if (
            !req.user?.email ||
            booking.userEmail?.toLowerCase() !== req.user.email.toLowerCase()
        ) {
            return res
                .status(403)
                .json({ error: "You can only cancel your own bookings." });
        }

        if (booking.status !== "Pending") {
            return res.status(400).json({
                error: "Only Pending reservations can be cancelled directly.",
            });
        }

        const result = await bookingsCollection.updateOne(
            { ...filter, status: "Pending" },
            {
                $set: {
                    status: "Cancelled",
                    cancelledAt: new Date().toISOString(),
                },
            },
        );
        if (result.modifiedCount === 0) {
            return res.status(409).json({
                error: "This reservation is no longer pending and cannot be cancelled.",
            });
        }

        res.json({
            message: "Reservation successfully cancelled.",
            modifiedCount: result.modifiedCount,
        });
    } catch (err) {
        res.status(500).json({
            error: "Failed to cancel reservation",
            details:
                process.env.NODE_ENV === "production"
                    ? "Internal server error"
                    : err.message,
        });
    }
});

// PATCH /booking/:id/host-decision - Confirm or decline a pending request
app.patch("/booking/:id/host-decision", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { decision } = req.body;
        if (!["confirm", "decline"].includes(decision)) {
            return res.status(400).json({
                error: "Decision must be either confirm or decline.",
            });
        }

        const bookingFilter = ObjectId.isValid(id)
            ? { _id: new ObjectId(id) }
            : { id };
        const decisionSession = client.startSession();
        let resultState = "not-found";
        let conflict = null;
        try {
            await decisionSession.withTransaction(async () => {
                resultState = "not-found";
                conflict = null;
                const booking = await bookingsCollection.findOne(
                    bookingFilter,
                    { session: decisionSession },
                );
                if (!booking) return;

                const studioFilter = ObjectId.isValid(booking.studioId)
                    ? { _id: new ObjectId(booking.studioId) }
                    : { id: booking.studioId };
                const studio = await studiosCollection.findOne(studioFilter, {
                    session: decisionSession,
                });
                if (
                    !studio ||
                    typeof studio.ownerEmail !== "string" ||
                    studio.ownerEmail.toLowerCase() !==
                        req.user.email.toLowerCase()
                ) {
                    resultState = "forbidden";
                    return;
                }
                if (booking.status !== "Pending") {
                    resultState = "not-pending";
                    return;
                }

                if (decision === "confirm") {
                    const lockResult = await studiosCollection.updateOne(
                        studioFilter,
                        { $inc: { _bookingLockVersion: 1 } },
                        { session: decisionSession },
                    );
                    if (!lockResult.matchedCount) {
                        resultState = "studio-missing";
                        return;
                    }

                    const pendingRequests = await bookingsCollection
                        .find(
                            {
                                studioId: booking.studioId,
                                date: booking.date,
                                status: { $in: ["Confirmed", "Pending"] },
                                _id: { $ne: booking._id },
                            },
                            { session: decisionSession },
                        )
                        .toArray();
                    const collision = pendingRequests.find((other) => {
                        const otherStart = new Date(
                            `${other.date}T${other.startTime}:00`,
                        ).getTime();
                        const otherEnd = new Date(
                            `${other.date}T${other.endTime}:00`,
                        ).getTime();
                        const requestedStart = new Date(
                            `${booking.date}T${booking.startTime}:00`,
                        ).getTime();
                        const requestedEnd = new Date(
                            `${booking.date}T${booking.endTime}:00`,
                        ).getTime();
                        return (
                            requestedStart < otherEnd &&
                            requestedEnd > otherStart
                        );
                    });
                    if (collision) {
                        conflict = `This request overlaps another ${collision.status.toLowerCase()} booking from ${collision.startTime} to ${collision.endTime}.`;
                        resultState = "conflict";
                        return;
                    }
                }

                const isConfirming = decision === "confirm";
                const update = await bookingsCollection.updateOne(
                    { ...bookingFilter, status: "Pending" },
                    {
                        $set: isConfirming
                            ? {
                                  status: "Confirmed",
                                  confirmedAt: new Date().toISOString(),
                              }
                            : {
                                  status: "Declined",
                                  declinedAt: new Date().toISOString(),
                              },
                    },
                    { session: decisionSession },
                );
                resultState =
                    update.modifiedCount === 1 ? "updated" : "not-pending";
            });
        } finally {
            await decisionSession.endSession();
        }

        if (resultState === "not-found") {
            return res
                .status(404)
                .json({ error: "Booking request not found." });
        }
        if (resultState === "forbidden") {
            return res.status(403).json({
                error: "You can only manage requests for your own studios.",
            });
        }
        if (resultState === "studio-missing") {
            return res.status(404).json({ error: "Studio not found." });
        }
        if (resultState === "not-pending") {
            return res.status(409).json({
                error: "This booking request is no longer pending.",
            });
        }
        if (resultState === "conflict") {
            return res.status(409).json({
                error:
                    conflict ||
                    "This booking request conflicts with another booking.",
            });
        }

        return res.json({
            message:
                decision === "confirm"
                    ? "Booking request confirmed."
                    : "Booking request declined.",
            status: decision === "confirm" ? "Confirmed" : "Declined",
        });
    } catch (err) {
        return sendServerError(res, "Failed to update booking request", err);
    }
});

// DELETE /my-bookings/:id - Remove booking entry
app.delete("/my-bookings/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        let filter = ObjectId.isValid(id)
            ? { _id: new ObjectId(id) }
            : { id: id };

        const booking = await bookingsCollection.findOne(filter);
        if (
            !booking ||
            !req.user?.email ||
            booking.userEmail?.toLowerCase() !== req.user.email.toLowerCase()
        ) {
            return res
                .status(403)
                .json({ error: "You can only remove your own bookings." });
        }

        const result = await bookingsCollection.deleteOne(filter);
        if (result.deletedCount === 0) {
            return res
                .status(404)
                .json({ error: "Booking not found or already deleted" });
        }

        res.json({
            message: "Booking removed successfully",
            deletedCount: result.deletedCount,
        });
    } catch (err) {
        res.status(500).json({
            error: "Failed to delete booking",
            details:
                process.env.NODE_ENV === "production"
                    ? "Internal server error"
                    : err.message,
        });
    }
});

// GET /wishlist/:email - Retrieve user saved studio IDs
app.get("/wishlist/:email", verifyToken, async (req, res) => {
    try {
        const { email } = req.params;
        if (
            !req.user?.email ||
            req.user.email.toLowerCase() !== email.toLowerCase()
        ) {
            return res
                .status(403)
                .json({ error: "You can only view your own wishlist." });
        }
        const entry = await wishlistCollection.findOne({
            email: email.toLowerCase(),
        });
        res.json({ wishlist: entry?.studioIds || [] });
    } catch (err) {
        res.status(500).json({
            error: "Failed to fetch wishlist",
            details:
                process.env.NODE_ENV === "production"
                    ? "Internal server error"
                    : err.message,
        });
    }
});

// POST /wishlist - Toggle studio saved state
app.post("/wishlist", verifyToken, async (req, res) => {
    try {
        const { email, studioId, saved } = req.body;
        if (
            typeof email !== "string" ||
            !email.trim() ||
            typeof studioId !== "string" ||
            !studioId.trim() ||
            typeof saved !== "boolean"
        ) {
            return res.status(400).json({
                error: "Email, studioId, and a boolean saved value are required.",
            });
        }
        if (
            !req.user?.email ||
            req.user.email.toLowerCase() !== email.toLowerCase()
        ) {
            return res
                .status(403)
                .json({ error: "You can only update your own wishlist." });
        }

        const normEmail = email.toLowerCase();
        if (saved) {
            await wishlistCollection.updateOne(
                { email: normEmail },
                {
                    $addToSet: { studioIds: studioId },
                    $set: { updatedAt: new Date().toISOString() },
                },
                { upsert: true },
            );
        } else {
            await wishlistCollection.updateOne(
                { email: normEmail },
                {
                    $pull: { studioIds: studioId },
                    $set: { updatedAt: new Date().toISOString() },
                },
            );
        }

        const entry = await wishlistCollection.findOne({ email: normEmail });
        const studioIds = entry?.studioIds || [];
        const isSaved = studioIds.includes(studioId);

        res.json({
            message: isSaved
                ? "Saved to creative wishlist."
                : "Removed from saved studios.",
            saved: isSaved,
            wishlist: studioIds,
        });
    } catch (err) {
        res.status(500).json({
            error: "Failed to update wishlist",
            details:
                process.env.NODE_ENV === "production"
                    ? "Internal server error"
                    : err.message,
        });
    }
});

app.listen(PORT, () => {
    console.log(`StudioNest Server running on port ${PORT}`);
});

export default app;
