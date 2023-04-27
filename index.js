import * as db from './db.js';
import express from 'express';
import dotenv from 'dotenv';
import cron from 'node-cron';
dotenv.config();

const app = express();
import {WebClient} from '@slack/web-api';
import {OOO, User} from "./db.js";
const token = process.env.SLACK_BOT_TOKEN;
const web = new WebClient(token);

import { format } from 'date-fns'

app.use(express.urlencoded({extended: true}));

app.get('/', (req, res) => {
    console.log('alive');
    res.sendStatus(200);
});
app.get('/health', (req, res) => {
    res.sendStatus(200);
});

const composeMessage = (oooRecords) => {
    const splitInTeams = oooRecords.reduce((acc, record) => {
        const team = record.user[0].team;
        if (!team) {
            if (!acc['Other']) {
                acc['Other'] = []
            }
            acc['Other'].push(record);
            return acc;
        }
        if (!acc[team]) {
            acc[team] = [];
        }
        acc[team].push(record);
        return acc;
    }, {})
    return Object.keys(splitInTeams).reduce((acc, team) => {
        acc += `*Team ${team}:*\n`;
        acc += splitInTeams[team].reduce((acc, record) => {
            acc += `${record.user[0].name} is out of office today. Reason: ${record.reason}\n`;
            return acc;
        }, '')
        return acc;
    }, '');
}

cron.schedule('0 9 * * 1-5', async () => {
    console.log('Cronjob created. Every day at 11:00 AM.')
    let greeting = `Good morning good people of ${process.env.COMPANY_NAME}! \nHere are the people out of office today: \n \n`;
    let message;
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
                startDate: {$lte: today},
                endDate: {$gte: today}
            }
        }
    ]);
    if (oooRecords.length === 0) {
        message = 'No one is out of office today :ok_hand:';
    } else {
        message = composeMessage(oooRecords);
    }
    const text = greeting + message;
    await web.chat.postMessage({
        channel: process.env.CHANNEL_ID,
        text,
    })
}, {
    timezone: 'Europe/Paris'
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
    res.status(200).send(`Successfully added yourself as Out Of Office from ${format(sDate, 'dd/MMM/yyyy')} to ${format(eDate, 'dd/MMM/yyyy')}`);
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
})
app.post('/checkDate', async (req, res) => {
    if (!req.body.text) {
        res.send('Please enter the date in the format "dd/mm/yyyy"');
        return;
    }
    const dateParam = req.body.text;
    const [day, month, year] = dateParam.split('/');
    const date = new Date(year, month - 1, day);
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
                startDate: {$lte: date},
                endDate: {$gte: date}
            }
        }
    ]);
    if (oooRecords.length === 0) {
        res.send('No one is out of office on this date');
        return;
    } else {
        const message = composeMessage(oooRecords);
        res.send(message);
        return;
    }

});

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
    res.status(200).send(oooRecordsString);
});

app.post('/setTeam', async (req, res) => {
    if (!req.body.text) {
        res.send('Team name can be one of: PLT, CON, BUS, MNG');
        return;
    }
    if (!['PLT', 'CON', 'BUS', 'MNG'].includes(req.body.text)) {
        res.send('Team name can be one of: PLT, CON, BUS, MNG');
        return;
    }
    res.status(200).send(`Successfully added you in the team ${req.body.text}`);
    const userId = req.body.user_id;
    const found = await User.findOne({slackId: userId});
    if (found) {
        found.team = req.body.text;
        await found.save();
        return;
    }
    const userInfo = await web.users.info({user: userId, include_locale: true});
    await User.findOneAndUpdate(
        {
            email: userInfo.user.profile.email
        },
        {
            email: userInfo.user.profile.email,
            name: userInfo.user.profile.real_name,
            slackId: userId,
            slackName: userInfo.user.profile.display_name,
            team: req.body.text
        },
        {
            upsert: true, new: true, setDefaultsOnInsert: true
        })
        .lean()


})

app.listen(process.env.PORT, '0.0.0.0', () => {
    console.log('Server listening on port ' + process.env.PORT);
});


