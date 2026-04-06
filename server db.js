const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect('mongodb://localhost:27017/focusroom', {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (err) {
        console.error(`Error: ${err.message}`);
        // Exit process with failure
        // process.exit(1); 
    }
};

// User Schema
const UserSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    phone: { type: String },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Ideally hashed
    points: { type: Number, default: 0 },
    totalFocusTime: { type: Number, default: 0 }, // in seconds
    dailyStats: [{
        date: { type: String, required: true }, // Format: YYYY-MM-DD
        focusTime: { type: Number, default: 0 },
        points: { type: Number, default: 0 }
    }],
    lastActive: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);

module.exports = { connectDB, User };
