const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const allowedSessions = [
    "Wellbeing Talk",
    "Project Session",
    "General Support"
];

const allowedTimes = [
    "08:00",
    "08:30",
    "09:00",
    "09:30",
    "10:00",
    "10:30",
    "11:00",
    "11:30",
    "12:00",
    "12:30",
    "13:00",
    "13:30",
    "14:00",
    "14:30",
    "15:00",
    "15:30"
];

function generateBookingCode() {
    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "MAC-";

    for (let i = 0; i < 10; i++) {
        result += characters[Math.floor(Math.random() * characters.length)];
    }

    return result;
}

function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validName(value) {
    return typeof value === "string" && value.length >= 1 && value.length <= 100;
}

function validClass(value) {
    return typeof value === "string" && value.length >= 1 && value.length <= 50;
}

function validMessage(value) {
    return typeof value === "string" && value.length <= 500;
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed."
        });
    }

    try {
        const {
            student_name,
            student_class,
            session_type,
            booking_date,
            booking_time,
            student_message
        } = req.body || {};

        if (!validName(student_name)) {
            return res.status(400).json({
                error: "Please enter a valid name."
            });
        }

        if (!validClass(student_class)) {
            return res.status(400).json({
                error: "Please enter a valid class."
            });
        }

        if (!allowedSessions.includes(session_type)) {
            return res.status(400).json({
                error: "Invalid session type."
            });
        }

        if (!validDate(booking_date)) {
            return res.status(400).json({
                error: "Invalid date."
            });
        }

        if (!allowedTimes.includes(booking_time)) {
            return res.status(400).json({
                error: "Invalid time."
            });
        }

        if (student_message !== undefined && !validMessage(student_message)) {
            return res.status(400).json({
                error: "The note is too long."
            });
        }

        const requestedDate = new Date(booking_date + "T12:00:00");
        const today = new Date();

        today.setHours(0, 0, 0, 0);

        if (Number.isNaN(requestedDate.getTime()) || requestedDate < today) {
            return res.status(400).json({
                error: "Please choose a future date."
            });
        }

        const dayNumber = requestedDate.getDay();

        const { data: availability, error: availabilityError } =
            await supabase
                .from("availability")
                .select("is_closed")
                .eq("day_number", dayNumber)
                .single();

        if (availabilityError) {
            return res.status(500).json({
                error: "Unable to check availability."
            });
        }

        if (availability.is_closed) {
            return res.status(400).json({
                error: "Bookings are closed on this day."
            });
        }

        const { data: existingBooking, error: existingError } =
            await supabase
                .from("bookings")
                .select("id")
                .eq("booking_date", booking_date)
                .eq("booking_time", booking_time)
                .in("status", ["Pending", "Approved"])
                .maybeSingle();

        if (existingError) {
            return res.status(500).json({
                error: "Unable to check the selected time."
            });
        }

        if (existingBooking) {
            return res.status(409).json({
                error: "That time has already been booked."
            });
        }

        let bookingCode = "";
        let inserted = false;
        let bookingError = null;

        for (let attempt = 0; attempt < 5; attempt++) {
            bookingCode = generateBookingCode();

            const result = await supabase
                .from("bookings")
                .insert({
                    booking_code: bookingCode,
                    student_name,
                    student_class,
                    session_type,
                    booking_date,
                    booking_time,
                    student_message: student_message || null,
                    status: "Pending"
                });

            if (!result.error) {
                inserted = true;
                break;
            }

            bookingError = result.error;
        }

        if (!inserted) {
            if (
                bookingError &&
                bookingError.code === "23505"
            ) {
                return res.status(409).json({
                    error: "That time has just been booked. Please choose another time."
                });
            }

            return res.status(500).json({
                error: "Unable to create booking."
            });
        }

        return res.status(201).json({
            booking_code: bookingCode
        });
    } catch (error) {
        return res.status(500).json({
            error: "Server error."
        });
    }
};