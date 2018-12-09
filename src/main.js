const fs = require('fs');
const https = require('https');
const path = require('path');
const searcher = require('./YoutubeSearch.js');
const mp3Path = 'files';
const secrets = require('../res/secrets.json');
const onlyUserId = 1;

// Express
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();
const port = 3000;
app.use(cors());
app.use(bodyParser.json());

// Postgres
const pgp = require('pg-promise')(/*options*/);
const db = pgp(secrets.connectionString);

// Youtube 2 Mp3
const YoutubeMp3Downloader = require("./YoutubeMp3Downloader.js");
const YD = new YoutubeMp3Downloader({
    "outputPath": mp3Path,                 // Where should the downloaded and encoded files be stored?
    "youtubeVideoQuality": "highest",       // What video quality should be used?
    "queueParallelism": 3,                  // How many parallel downloads/encodes should be started?
    "progressTimeout": 2000                 // How long should be the interval of the progress reports
});

createMp3FolderIfNeeded();
createApi();

function createApi() {
    app.get('/search/:query', async (req, res) => {
        if (!req.params.hasOwnProperty("query"))
            res.send({error: "No query provided"});
        let query = req.params.query;

        console.log("search query", query);
        let data = await searcher.search(query);
        res.send(data);
    });
    app.get('/songs/:user', async (req, res) => {
        if (!req.params.hasOwnProperty("user"))
            res.send({error: "No user provided"});
        let user = +req.params.user;

        let data;
        try {
            data = await db.any('select ytid, title, artist, duration, viewcount, thumbnail from songs inner join usersongs on usersongs.songid = songs.ytid where userid = $1 order by added desc', user);
        } catch (e) {
            console.log("PG ERROR", e)
        }

        res.send(data);
    });
    app.post('/save/:id', async (req, res) => {
        if (!req.params.hasOwnProperty("id"))
            res.send({error: "No song id provided, example /stream/pbMwTqkKSps.mp3"});
        let ytId = req.params.id;

        await cacheSongIfNeeded(ytId);

        let date = new Date();
        await db.none('INSERT INTO usersongs(userid, songid, added) VALUES ($1, $2, $3)', [onlyUserId, ytId, date]);

        res.send({success: true});
    });
    app.post('/remove/:id', async (req, res) => {
        if (!req.params.hasOwnProperty("id"))
            res.send({error: "No song id provided, example /stream/pbMwTqkKSps.mp3"});
        let ytId = req.params.id;

        await db.none('delete from usersongs where userid=$1 and songid = $2', [onlyUserId, ytId]);

        res.send({success: true});
    });
    app.get('/stream/:id', async (req, res) => {
        console.log("INCOMING STREAM REQUEST");

        if (!req.params.hasOwnProperty("id"))
            res.send({error: "No song id provided, example /stream/pbMwTqkKSps.mp3"});
        let ytId = req.params.id;

        if (await isSongCached(ytId)) {
            let fileName = path.resolve(mp3Path + '/' + ytId + '.mp3');
            res.sendFile(fileName);
        } else {
            if (!currentlyConverting.includes(ytId))
                cacheSongIfNeeded(ytId);
            await streamSong(ytId, res);
        }
    });
    app.get('/download/:id', async (req, res) => {
        console.log("INCOMING DOWNLOAD REQUEST");

        if (!req.params.hasOwnProperty("id"))
            res.send({error: "No song id provided, example /stream/pbMwTqkKSps.mp3"});
        let ytId = req.params.id;

        await cacheSongIfNeeded(ytId);

        let fileName = path.resolve(mp3Path + '/' + ytId + '.mp3');
        res.sendFile(fileName);
    });

    let credentials = getHttpsCredentials();
    if (credentials) {
        const httpsServer = https.createServer(credentials, app);
        httpsServer.listen(port, () => console.log(`HTTPS app listening on port ${port}!`));
    } else {
        console.warn("Could not get HTTPS credentials, switching to HTTP");
        app.listen(port, () => console.log(`HTTP app listening on port ${port}!`));
    }
}

async function waitUntilSongIsConvertedIfNeeded(ytId) {
    return new Promise(async resolve => {
        if (currentlyConverting.includes(ytId)) {
            YD.on("finished", async (err, data) => {
                if (data.videoId === ytId)
                    resolve();
            });
        } else
            resolve();
    })
}

function getHttpsCredentials() {
    try {
        return {
            key: fs.readFileSync('/etc/letsencrypt/live/rtc.ruurdbijlsma.com/privkey.pem'),
            cert: fs.readFileSync('/etc/letsencrypt/live/rtc.ruurdbijlsma.com/fullchain.pem'),
        }
    } catch (e) {
        return false;
    }
}

function createMp3FolderIfNeeded() {
    fs.access(mp3Path, fs.constants.F_OK, err => {
        if (err)
            fs.mkdir(mp3Path, 777, () => console.log("Created mp3 storage directory"));
    });
}

async function cacheSongIfNeeded(ytId) {
    await waitUntilSongIsConvertedIfNeeded(ytId);
    if (!await isSongCached(ytId)) {
        console.log("Song is not ready, caching now");
        await cacheSong(ytId);
    }
}

async function isSongCached(ytId) {
    if (ytId === false) return false;

    return new Promise(resolve => {
        fs.access(`${mp3Path}/${ytId}.mp3`, fs.constants.F_OK, async err => {
            let isFileAvailable = !err;
            let isDbInfoAvailable = await getSongInfo(ytId);
            resolve(isFileAvailable && isDbInfoAvailable);
        });
    });
}

async function getSongInfo(ytId) {
    try {
        return await db.one('SELECT * FROM songs WHERE "ytid" = $1', ytId);
    } catch (e) {
        return false;
    }
}

async function addSongToDatabase(ytId, title, artist, viewCount, duration, thumbnail) {
    try {
        await db.one('select * from songs where "ytid" = $1', ytId);
    } catch (e) {
        try {
            await db.none('INSERT INTO songs("ytid", "title", "artist", "thumbnail", "duration", "viewcount") VALUES($1, $2, $3, $4, $5, $6)', [ytId, title, artist, thumbnail, duration, viewCount]);
        } catch (e) {
            console.log("PG ERROR: " + e);
        }
    }
}

async function streamSong(ytId, responseStream) {
    YD.stream(ytId, responseStream);
}

const currentlyConverting = [];

async function cacheSong(ytId) {
    currentlyConverting.push(ytId);
    console.log("Running 'cacheSong' on id: ", ytId);
    return new Promise((resolve, error) => {
        YD.download(ytId, `${mp3Path}/${ytId}.mp3`);

        YD.on("finished", async (err, data) => {
            if (data.videoId === ytId) {
                await addSongToDatabase(data.videoId, data.title, data.artist, data.viewCount, data.duration, data.thumbnail);
                currentlyConverting.splice(currentlyConverting.indexOf(ytId), 1);
                resolve(data);
            }
        });

        YD.on("error", e => {
            error(e)
        });

        YD.on("progress", progress => {
            if (progress.videoId === ytId)
                console.log("Downloading and converting " + ytId, Math.round(progress.progress.percentage * 10) / 10 + '%');
        });
    });
}

