import mongoose from "mongoose";
mongoose.connect('mongodb://127.0.0.1/outofoffice').then(() => {
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