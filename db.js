import mongoose from "mongoose";
import dotenv from 'dotenv';
dotenv.config();
mongoose.connect(process.env.MONGO_URI).then(() => {
    console.log('Connected to MongoDB');
})

const userSchema = new mongoose.Schema({
    name: String,
    email: String,
    slackId: String,
    slackName: String,
});

const oooSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    startDate: Date,
    endDate: Date,
    reason: String,
});

export const OOO = mongoose.model('OOO', oooSchema);
export const User = mongoose.model('User', userSchema);
