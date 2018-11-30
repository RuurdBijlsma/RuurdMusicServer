const fs = require('fs');
const path = require('path');
const searcher = require('./Youtube.js');
const mp3Path = 'files';
const secrets = require('./res/secrets.json');
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
    "ffmpegPath": "lib/ffmpeg.exe",         // Where is the FFmpeg binary located?
    "outputPath": mp3Path,                 // Where should the downloaded and encoded files be stored?
    "youtubeVideoQuality": "highest",       // What video quality should be used?
    "queueParallelism": 2,                  // How many parallel downloads/encodes should be started?
    "progressTimeout": 2000                 // How long should be the interval of the progress reports
});

createApi();

function createApi() {
    app.get('/search/:query', async (req, res) => {
        if (!req.params.hasOwnProperty("query"))
            res.send("No query provided");
        let query = req.params.query;

        console.log("search query", query);
        let data = await searcher.search(query);
        res.send(data);
    });
    app.get('/songs/:user', async (req, res) => {
        if (!req.params.hasOwnProperty("user"))
            res.send("No user provided");
        let user = +req.params.user;

        let data;
        try {
            data = await db.any('select "ytId", title, artist from songs inner join usersongs on usersongs.songid = songs."ytId" where userid = 1 order by added desc', user);
        } catch (e) {
            console.log("PG ERROR", e)
        }

        res.send(data);
    });
    app.post('/save/:id', async (req, res) => {
        if (!req.params.hasOwnProperty("id"))
            res.send("No song id provided, example /stream/pbMwTqkKSps.mp3");
        let ytId = req.params.id;

        await cacheSongIfNeeded(ytId);
        let date = new Date();
        await db.none('INSERT INTO usersongs(userid, songid, added) VALUES ($1, $2, $3)', [onlyUserId, ytId, date]);

        res.send('success');
    });
    app.post('/remove/:id', async (req, res) => {
        if (!req.params.hasOwnProperty("id"))
            res.send("No song id provided, example /stream/pbMwTqkKSps.mp3");
        let ytId = req.params.id;

        await db.none('delete from usersongs where userid=$1 and songid = $2', [onlyUserId, ytId]);

        res.send('success');
    });
    app.get('/stream/:id', async (req, res) => {
        if (!req.params.hasOwnProperty("id"))
            res.send("No song id provided, example /stream/pbMwTqkKSps.mp3");
        let ytId = req.params.id;

        await cacheSongIfNeeded(ytId);

        let fileName = path.resolve(mp3Path + '/' + ytId + '.mp3');
        res.sendFile(fileName);
    });

    app.listen(port, () => console.log(`Example app listening on port ${port}!`));
}

async function cacheSongIfNeeded(ytId) {
    if (!await isSongCached(ytId)) {
        console.log("Song is not ready, caching now");
        await cacheSong(ytId);
    }
}

async function isSongCached(ytId) {
    if (ytId === false) return false;

    return new Promise(resolve => {
        fs.access(`${mp3Path}/${ytId}.mp3`, fs.constants.F_OK, err => {
            resolve(!err);
        });
    });
}

async function getSongInfo(ytId) {
    try {
        return await db.one('SELECT * FROM songs WHERE "ytId" = $1', ytId);
    } catch (e) {
        return false;
    }
}

async function addSongToDatabase(ytId, title, artist) {
    try {
        await db.one('select * from songs where "ytId" = $1', ytId);
    } catch (e) {
        try {
            await db.none('INSERT INTO songs("ytId", "title", "artist") VALUES($1, $2, $3)', [ytId, title, artist]);
        } catch (e) {
            console.log("PG ERROR: " + e);
        }
    }
}

async function cacheSong(ytId) {
    console.log("Running 'cacheSong' on id: ", ytId);
    return new Promise((resolve, error) => {
        YD.download(ytId, `${ytId}.mp3`);

        YD.on("finished", async (err, data) => {
            await addSongToDatabase(data.videoId, data.title, data.artist);
            resolve(data);
        });

        YD.on("error", e => {
            error(e)
        });

        YD.on("progress", progress => {
            console.log("Downloading and converting " + ytId, Math.round(progress.progress.percentage * 10) / 10 + '%');
        });
    });
}

