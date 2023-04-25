import * as db from './db.js';
import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
import {WebClient} from '@slack/web-api';
import {OOO, User} from "./db.js";
const token = process.env.SLACK_BOT_TOKEN;
const web = new WebClient(token);

import { format } from 'date-fns'

app.use(express.urlencoded({extended: true}));

app.get('/', (req, res) => {
    res.send('omnia paratus');
});
app.get('/health', (req, res) => {
    res.status(200);
});

app.post('/ooo', async (req, res) => {
    if (!req.body.text) {
        res.send('Please enter the date in the format "dd/mm/yyyy dd/mm/yyyy reason"');
        return;
    }
    const userId = req.body.user_id;
    const userInfo = await web.users.info({user: userId, include_locale: true});
    const startDate = req.body.text.split(' ')[0];
    const [sDay, sMonth, sYear] = startDate.split('/');
    const sDate = new Date(sYear, sMonth - 1, sDay);

    const nextParam = req.body.text.split(' ')[1];
    const endDate = req.body.text.split(' ')[1];
    const [eDay, eMonth, eYear] = endDate?.length ? endDate.split('/') : [sDay, sMonth, sYear];
    const eDate = nextParam?.split('/').length === 3 ? new Date(eYear, eMonth - 1, eDay) : sDate;

    const reason = eDate === sDate ? req.body.text.split(' ').slice(1).join(' ') : req.body.text.split(' ').slice(2).join(' ');
    const user = await User.findOneAndUpdate(
        {
            email: userInfo.user.profile.email
        },
        {
            email: userInfo.user.profile.email,
            name: userInfo.user.profile.real_name,
            slackId: userId,
            slackName: userInfo.user.profile.display_name,
        },
        {
            upsert: true, new: true, setDefaultsOnInsert: true
        })
        .lean()

    await OOO.create({
        userId: user._id,
        startDate: sDate,
        endDate: eDate,
        reason: reason || 'Out of Office',
    })
    const message = sDate === eDate ? `<@${userId}> is out of office on ${format(sDate, 'dd/MMM/yyyy')}. Reason: ${reason || 'not provided.'}` : `<@${userId}> is out of office from ${format(sDate, 'dd/MMM/yyyy')} to ${format(eDate, 'dd/MMM/yyyy')}. Reason: ${reason || 'not provided.'}`
    await web.chat.postMessage({
        channel: process.env.CHANNEL_ID,
        text: message,
        user: userId
    })
    res.send(`Successfully added yourself as Out Of Office from ${format(sDate, 'dd/MMM/yyyy')} to ${format(eDate, 'dd/MMM/yyyy')}`);
})
app.post('/getAll', async (req, res) => {
    let user = null;
    if (req.body.text) {
        user = req.body.text;
    }
    const today = new Date();
    const oooRecords = await OOO.aggregate([
        {
            $lookup: {
                from: 'users',
                localField: 'userId',
                foreignField: '_id',
                as: 'user'
            }
        },
        {
            $match: {
                ...(user && { 'user.name': new RegExp(user, 'i')}),
                startDate: {$lte: today},
                endDate: {$gte: today}
            }
        }
    ])
    if (oooRecords.length === 0) {
        const message = user ? `No one named ${user} is out of office today` : 'No one is out of office';
        res.send(message);
        return;
    }
    const oooRecordsString = oooRecords.map(record => {
        return `${record.user[0].name} is out of office from ${format(record.startDate, 'dd/MMM/yyyy')} to ${format(record.endDate, 'dd/MMM/yyyy')}, reason: "${record.reason}"`
    }).join('\n');
    res.send(oooRecordsString);
})

app.listen(process.env.PORT, '0.0.0.0', () => {
    console.log('Server listening on port 3000');
});


