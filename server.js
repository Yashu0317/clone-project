const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2/promise");
const { Server } = require("socket.io");
const multer = require("multer");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 5000;
const RECORDINGS_DIR = path.join(__dirname, "recordings");

if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

app.use(express.json());
app.use(express.static(__dirname));

const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "Yashu1723",
    database: process.env.DB_NAME || "live_audio",
    waitForConnections: true,
    connectionLimit: 10
});

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, RECORDINGS_DIR),
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname) || ".webm";
            cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
        }
    }),
    limits: {
        fileSize: 50 * 1024 * 1024
    }
});

async function testDatabase() {
    try {
        const conn = await pool.getConnection();
        await conn.query(`
            CREATE TABLE IF NOT EXISTS recordings (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                room_id VARCHAR(100) NOT NULL,
                segment_number INT NOT NULL,
                started_at DATETIME(3) NOT NULL,
                ended_at DATETIME(3) NULL,
                duration_seconds INT NULL,
                original_name VARCHAR(255) NULL,
                stored_name VARCHAR(255) NOT NULL,
                mime_type VARCHAR(100) NOT NULL,
                file_size BIGINT UNSIGNED NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                INDEX idx_room_created (room_id, created_at)
            ) ENGINE=InnoDB;
        `);
        conn.release();
        console.log("MySQL connected.");
    } catch (err) {
        console.error("MySQL connection/table error:", err.message);
    }
}

testDatabase();

app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "comms-hub-5.html"));
});

app.get("/api/recordings/:roomId", async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, room_id, segment_number, started_at, ended_at,
                    duration_seconds, original_name, mime_type, file_size, created_at
             FROM recordings
             WHERE room_id = ?
             ORDER BY started_at DESC`,
            [req.params.roomId]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not load recordings." });
    }
});

app.get("/api/recordings/:id/download", async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT stored_name, original_name, mime_type
             FROM recordings WHERE id = ? LIMIT 1`,
            [req.params.id]
        );

        if (!rows.length) {
            return res.status(404).send("Recording not found.");
        }

        const row = rows[0];
        const filePath = path.join(RECORDINGS_DIR, row.stored_name);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send("Recording file is missing.");
        }

        res.setHeader("Content-Type", row.mime_type);
        res.download(filePath, row.original_name || row.stored_name);
    } catch (err) {
        console.error(err);
        res.status(500).send("Download failed.");
    }
});

app.get("/api/recordings/:id/play", async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT stored_name, mime_type
             FROM recordings WHERE id = ? LIMIT 1`,
            [req.params.id]
        );

        if (!rows.length) return res.status(404).send("Recording not found.");

        const filePath = path.join(RECORDINGS_DIR, rows[0].stored_name);
        if (!fs.existsSync(filePath)) return res.status(404).send("File missing.");

        res.setHeader("Content-Type", rows[0].mime_type);
        res.sendFile(filePath);
    } catch (err) {
        console.error(err);
        res.status(500).send("Playback failed.");
    }
});

app.post("/api/recordings", upload.single("audio"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No audio file received." });
        }

        const roomId = String(req.body.roomId || "").trim();
        const segmentNumber = Number(req.body.segmentNumber || 1);
        const startedAt = req.body.startedAt
            ? new Date(req.body.startedAt)
            : new Date();
        const endedAt = req.body.endedAt
            ? new Date(req.body.endedAt)
            : new Date();

        if (!roomId) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: "roomId is required." });
        }

        const durationSeconds = Math.max(
            0,
            Math.round((endedAt - startedAt) / 1000)
        );

        await pool.query(
            `INSERT INTO recordings
             (room_id, segment_number, started_at, ended_at,
              duration_seconds, original_name, stored_name,
              mime_type, file_size)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                roomId,
                segmentNumber,
                startedAt,
                endedAt,
                durationSeconds,
                req.file.originalname,
                req.file.filename,
                req.file.mimetype || "audio/webm",
                req.file.size
            ]
        );

        res.json({
            ok: true,
            message: "Recording saved.",
            segmentNumber
        });
    } catch (err) {
        console.error("Recording save error:", err);

        if (req.file?.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({ error: "Could not save recording." });
    }
});

const rooms = new Map();

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            child: null,
            parent: null,
            childLive: false
        });
    }
    return rooms.get(roomId);
}

io.on("connection", socket => {
    console.log("Connected:", socket.id);

    socket.on("join-room", ({ roomId, role }) => {
        if (!roomId || !role) return;

        const room = getRoom(roomId);
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.role = role;

        if (role === "child") {
            room.child = socket.id;
            socket.to(roomId).emit("child-online");

            if (room.childLive) {
                socket.emit("audio-started");
            }
        }

        if (role === "parent") {
            room.parent = socket.id;

            if (room.child) {
                io.to(room.parent).emit("child-online");
            }

            if (room.childLive) {
                io.to(room.parent).emit("audio-started");
            }
        }

        socket.emit("room-joined", { roomId, role });

        console.log(
            `Room ${roomId}: child=${room.child}, parent=${room.parent}`
        );
    });

    socket.on("audio-started", () => {
        const roomId = socket.data.roomId;
        const room = roomId ? rooms.get(roomId) : null;
        if (!room || socket.data.role !== "child") return;

        room.childLive = true;
        socket.to(roomId).emit("audio-started");
    });

    socket.on("audio-stopped", () => {
        const roomId = socket.data.roomId;
        const room = roomId ? rooms.get(roomId) : null;
        if (!room || socket.data.role !== "child") return;

        room.childLive = false;
        socket.to(roomId).emit("audio-stopped");
    });

    socket.on("webrtc-offer", ({ roomId, offer }) => {
        if (roomId && offer) {
            socket.to(roomId).emit("webrtc-offer", { offer });
        }
    });

    socket.on("webrtc-answer", ({ roomId, answer }) => {
        if (roomId && answer) {
            socket.to(roomId).emit("webrtc-answer", { answer });
        }
    });

    socket.on("ice-candidate", ({ roomId, candidate }) => {
        if (roomId && candidate) {
            socket.to(roomId).emit("ice-candidate", { candidate });
        }
    });

    socket.on("disconnect", () => {
        const roomId = socket.data.roomId;
        const role = socket.data.role;
        if (!roomId) return;

        const room = rooms.get(roomId);
        if (!room) return;

        if (role === "child" && room.child === socket.id) {
            room.child = null;
            room.childLive = false;
            socket.to(roomId).emit("child-offline");
        }

        if (role === "parent" && room.parent === socket.id) {
            room.parent = null;
        }

        if (!room.child && !room.parent) {
            rooms.delete(roomId);
        }
    });
});

server.listen(PORT, () => {
    console.log("");
    console.log("====================================");
    console.log(`Parent: http://localhost:${PORT}/comms-hub-5.html`);
    console.log(`Child : http://localhost:${PORT}/child.html`);
    console.log("====================================");
});
