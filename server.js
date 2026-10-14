
const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

// MySQL Configuration
const pool = mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password:
        process.env.DB_PASSWORD !== undefined
            ? process.env.DB_PASSWORD
            : "root",
    database: process.env.DB_NAME || "collegeeventmanagement",
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Validate event details
function validateEvent(body) {
    const event_name = String(body.event_name || "").trim();
    const event_type = String(body.event_type || "").trim();
    const event_date = String(body.event_date || "").trim();
    const venue = String(body.venue || "").trim();
    const description = String(body.description || "").trim();

    if (!event_name || !event_type || !event_date || !venue) {
        return {
            error: "Event name, event type, date, and venue are required."
        };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
        return {
            error: "Please provide the date in YYYY-MM-DD format."
        };
    }

    const parsed = new Date(event_date + "T00:00:00Z");

    if (
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== event_date
    ) {
        return {
            error: "Please enter a valid calendar date."
        };
    }

    return {
        value: {
            event_name,
            event_type,
            event_date,
            venue,
            description
        }
    };
}

// Check MySQL connection
app.get("/api/health", async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT DATABASE() AS database_name"
        );

        res.json({
            status: "OK",
            message: "MySQL connected successfully!",
            database: rows[0].database_name
        });
    } catch (err) {
        console.error("MySQL connection error:", err.code, err.message);

        res.status(500).json({
            status: "ERROR",
            error: err.code || "MYSQL_ERROR",
            message: err.message
        });
    }
});

// List and search events
app.get("/api/events", async (req, res) => {
    try {
        const q = String(req.query.q || "").trim();

        if (q) {
            const like = "%" + q + "%";

            const [rows] = await pool.execute(
                `SELECT event_id, event_name, event_type,
                        event_date, venue, description
                 FROM events
                 WHERE CAST(event_id AS CHAR) LIKE ?
                    OR event_name LIKE ?
                    OR event_type LIKE ?
                    OR venue LIKE ?
                    OR description LIKE ?
                 ORDER BY event_date ASC, event_id ASC`,
                [like, like, like, like, like]
            );

            return res.json(rows);
        }

        const [rows] = await pool.query(
            `SELECT event_id, event_name, event_type,
                    event_date, venue, description
             FROM events
             ORDER BY event_date ASC, event_id ASC`
        );

        res.json(rows);
    } catch (err) {
        console.error("Fetch events error:", err);

        res.status(500).json({
            error: "Could not fetch events.",
            details: err.message
        });
    }
});

// Get one event by ID
app.get("/api/events/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({
                error: "Invalid event ID."
            });
        }

        const [rows] = await pool.execute(
            `SELECT event_id, event_name, event_type,
                    event_date, venue, description
             FROM events
             WHERE event_id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                error: "Event not found."
            });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error("Fetch event error:", err);

        res.status(500).json({
            error: "Could not fetch this event.",
            details: err.message
        });
    }
});

// Insert event
app.post("/api/events", async (req, res) => {
    const checked = validateEvent(req.body);

    if (checked.error) {
        return res.status(400).json({
            error: checked.error
        });
    }

    try {
        const e = checked.value;

        const [result] = await pool.execute(
            `INSERT INTO events
                (event_name, event_type, event_date, venue, description)
             VALUES (?, ?, ?, ?, ?)`,
            [
                e.event_name,
                e.event_type,
                e.event_date,
                e.venue,
                e.description
            ]
        );

        res.status(201).json({
            message: "Event inserted successfully.",
            event_id: result.insertId
        });
    } catch (err) {
        console.error("Insert event error:", err);

        res.status(500).json({
            error: "Insert failed.",
            details: err.message
        });
    }
});

// Update event
app.put("/api/events/:id", async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({
            error: "Invalid event ID."
        });
    }

    const checked = validateEvent(req.body);

    if (checked.error) {
        return res.status(400).json({
            error: checked.error
        });
    }

    try {
        const e = checked.value;

        const [result] = await pool.execute(
            `UPDATE events
             SET event_name = ?,
                 event_type = ?,
                 event_date = ?,
                 venue = ?,
                 description = ?
             WHERE event_id = ?`,
            [
                e.event_name,
                e.event_type,
                e.event_date,
                e.venue,
                e.description,
                id
            ]
        );

        if (result.affectedRows === 0) {
            const [rows] = await pool.execute(
                "SELECT event_id FROM events WHERE event_id = ?",
                [id]
            );

            if (rows.length === 0) {
                return res.status(404).json({
                    error: "Event not found."
                });
            }
        }

        res.json({
            message: "Event updated successfully."
        });
    } catch (err) {
        console.error("Update event error:", err);

        res.status(500).json({
            error: "Update failed.",
            details: err.message
        });
    }
});

// Delete event
app.delete("/api/events/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({
                error: "Invalid event ID."
            });
        }

        const [result] = await pool.execute(
            "DELETE FROM events WHERE event_id = ?",
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: "Event not found."
            });
        }

        res.json({
            message: "Event deleted successfully."
        });
    } catch (err) {
        console.error("Delete event error:", err);

        res.status(500).json({
            error: "Delete failed.",
            details: err.message
        });
    }
});

// Home page
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server after checking MySQL
async function startServer() {
    try {
        const connection = await pool.getConnection();

        const [rows] = await connection.query(
            "SELECT DATABASE() AS database_name"
        );

        console.log("MySQL connected successfully!");
        console.log("Database:", rows[0].database_name);

        connection.release();

        app.listen(PORT, () => {
            console.log(
                "Jaya's College Event Management running at " +
                "http://localhost:" + PORT
            );
        });
    } catch (err) {
        console.error("MySQL connection failed!");
        console.error("Error code:", err.code);
        console.error("Error message:", err.message);

        console.error(
            "Check MySQL Server, port, password, database and table."
        );

        await pool.end();
        process.exitCode = 1;
    }
}

startServer();
