const fs = require('fs');
const https = require('https');
const Vibrant = require('node-vibrant');
const path = require('path');
const searcher = require('./YoutubeSearch.js');
const mp3Path = 'files';
const secrets = require('../res/secrets.json');
const accountManager = require('./AccountManager');
const onlyUserId = 1;

// Express
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();
const port = 3000;
app.use(cors());
app.use(bodyParser.json());

const Song = require('./Song');

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

function postRequestParam(req, param) {
    if (!req.body.hasOwnProperty(param)) {
        console.warn("Invalid request param supplied");
        return false;
    }
    let value = req.body[param];
    if (value === "undefined" || value === undefined) {
        console.log("Invalid parameter provided: \"" + param + "\", value is", value);
        return false;
    }
    return value;
}

function getRequestParam(req, param = 'id') {
    if (!req.params.hasOwnProperty(param)) {
        console.warn("Invalid request param supplied");
        return false;
    }
    let value = req.params[param];
    if (value === "undefined" || value === undefined) {
        console.log("Invalid parameter provided: \"" + param + "\", value is", value);
        return false;
    }
    return value;
}

async function getLoggedUserByRequest(req) {
    let username = postRequestParam(req, 'user');
    let password = postRequestParam(req, 'password');
    return await accountManager.login(username, password);
}

function createApi() {
    api.post('/register/', async (req, res) => {
        let username = postRequestParam(req, 'user');
        let password = postRequestParam(req, 'password');
        return await accountManager.register(username, password);
    });
    app.post('/search/:query', async (req, res) => {
        let user = await getLoggedUserByRequest(req);
        if (!user) return res.send('Not logged in');

        let query = getRequestParam(req, 'query');
        if (!query) return;

        console.log("[API] search: query", query);
        let data = await searcher.search(query);

        let tasks = [];
        for (let song of data) {
            let task = new Promise(async resolve => {
                song.color = await getVibrantThumbnailColor(song.thumbnail);
                resolve();
            });
            tasks.push(task);
        }

        await Promise.all(tasks);

        res.send(data.map(d => Song.fromSearchObject(d)));
    });
    app.post('/songs/', async (req, res) => {
        let user = await getLoggedUserByRequest(req);
        if (!user) return res.send('Not logged in');

        console.log("[API] request songs, user:", user);
        let data;
        try {
            data = await db.any('select ytid, title, artist, duration, viewcount, thumbnail, color from songs inner join usersongs on usersongs.songid = songs.ytid where userid = $1 order by added desc', user);
        } catch (e) {
            console.log("PG ERROR", e)
        }

        res.send(data.map(d => Song.fromObject(d)));
    });
    app.post('/save/:id', async (req, res) => {
        let user = await getLoggedUserByRequest(req);
        if (!user) return res.send('Not logged in');

        let ytId = getRequestParam(req);
        if (!ytId) return;
        console.log("[API] save song, id:", ytId);

        await cacheSongIfNeeded(ytId);

        let date = new Date();
        await db.none('INSERT INTO usersongs(userid, songid, added) VALUES ($1, $2, $3)', [user, ytId, date]);

        res.send({success: true});
    });
    app.post('/remove/:id', async (req, res) => {
        let user = await getLoggedUserByRequest(req);
        if (!user) return res.send('Not logged in');

        let ytId = getRequestParam(req);
        if (!ytId) return;
        console.log("[API] remove song, id:", ytId);

        await db.none('delete from usersongs where userid=$1 and songid = $2', [user, ytId]);

        res.send({success: true});
    });
    app.post('/await/:id', async (req, res) => {
        let user = await getLoggedUserByRequest(req);
        if (!user) return res.send('Not logged in');

        let ytId = getRequestParam(req);
        if (!ytId) return;
        console.log("[API] await song, id:", ytId);

        await cacheSongIfNeeded(ytId);
        console.log("AWAIT DONE");
        res.send({loaded: ytId});
    });
    app.post('/stream/:id', async (req, res) => {
        let user = await getLoggedUserByRequest(req);
        if (!user) return res.send('Not logged in');

        let ytId = getRequestParam(req);
        if (!ytId) return;
        console.log("[API] stream song, id:", ytId);

        if (await isSongCached(ytId)) {
            let fileName = path.resolve(mp3Path + '/' + ytId + '.mp3');
            res.sendFile(fileName);
        } else {
            if (!currentlyConverting.includes(ytId))
                cacheSongIfNeeded(ytId);
            await streamSong(ytId, res);
        }
    });
    app.post('/download/:id', async (req, res) => {
        let user = await getLoggedUserByRequest(req);
        if (!user) return res.send('Not logged in');

        let ytId = getRequestParam(req);
        if (!ytId) return;
        console.log("[API] download song, id:", ytId);

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

async function getVibrantThumbnailColor(thumbnailUrl) {
    let palette = await Vibrant.from(thumbnailUrl).getPalette();
    if (palette.Vibrant) {
        return palette.Vibrant.getHex();
    } else {
        for (let prop in palette)
            if (palette[prop] !== null)
                return palette[prop].getHex();
        return '#2b19ff';
    }
}

async function addSongToDatabase(ytId, title, artist, viewCount, duration, thumbnail) {
    let color = await getVibrantThumbnailColor(thumbnail);
    try {
        await db.one('select * from songs where "ytid" = $1', ytId);
    } catch (e) {
        try {
            await db.none('INSERT INTO songs("ytid", "title", "artist", "thumbnail", "duration", "viewcount", "color") VALUES($1, $2, $3, $4, $5, $6, $7)', [ytId, title, artist, thumbnail, duration, viewCount, color]);
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
    if (currentlyConverting.includes(ytId))
        return await waitUntilSongIsConvertedIfNeeded(ytId);

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

