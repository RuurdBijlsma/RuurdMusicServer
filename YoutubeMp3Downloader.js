"use strict";
const os = require("os");
const util = require("util");
const EventEmitter = require("events").EventEmitter;
const ffmpeg = require("fluent-ffmpeg");
const ytdl = require("ytdl-core");
const async = require("async");
const progress = require("progress-stream");

function YoutubeMp3Downloader(options) {

    const self = this;

    self.youtubeBaseUrl = "http://www.youtube.com/watch?v=";
    self.youtubeVideoQuality = (options && options.youtubeVideoQuality ? options.youtubeVideoQuality : "highest");
    self.outputPath = (options && options.outputPath ? options.outputPath : (os.platform() === "win32" ? "C:/Windows/Temp" : "/tmp"));
    self.queueParallelism = (options && options.queueParallelism ? options.queueParallelism : 1);
    self.progressTimeout = (options && options.progressTimeout ? options.progressTimeout : 1000);
    self.fileNameReplacements = [[/"/g, ""], [/'/g, ""], [/\//g, ""], [/\?/g, ""], [/:/g, ""], [/;/g, ""], [/\|/g, ""]];
    self.requestOptions = (options && options.requestOptions ? options.requestOptions : {maxRedirects: 5});

    if (options && options.ffmpegPath) {
        ffmpeg.setFfmpegPath(options.ffmpegPath);
    }

    //Async download/transcode queue
    self.downloadQueue = async.queue(function (task, callback) {

        self.emit("queueSize", self.downloadQueue.running() + self.downloadQueue.length());

        self.performDownload(task, function (err, result) {
            callback(err, result);
        });

    }, self.queueParallelism);

}

util.inherits(YoutubeMp3Downloader, EventEmitter);

YoutubeMp3Downloader.prototype.cleanFileName = function (fileName) {
    const self = this;

    self.fileNameReplacements.forEach(function (replacement) {
        fileName = fileName.replace(replacement[0], replacement[1]);
    });

    return fileName;
};

YoutubeMp3Downloader.prototype.download = function (videoId, fileName) {

    const self = this;
    const task = {
        videoId: videoId,
        fileName: fileName
    };

    self.downloadQueue.push(task, function (err, data) {

        self.emit("queueSize", self.downloadQueue.running() + self.downloadQueue.length());

        if (err) {
            self.emit("error", err, data);
        } else {
            self.emit("finished", err, data);
        }
    });

};

YoutubeMp3Downloader.prototype.performDownload = function (task, callback) {

    const self = this;
    const videoUrl = self.youtubeBaseUrl + task.videoId;
    const resultObj = {
        videoId: task.videoId
    };

    ytdl.getInfo(videoUrl, function (err, info) {

        if (err) {
            callback(err.message, resultObj);
        } else {
            const videoTitle = self.cleanFileName(info.title);
            let artist = "Unknown";
            let title = videoTitle;
            const thumbnail = info.iurlhq || null;

            if (videoTitle.indexOf("-") > -1) {
                const temp = videoTitle.split("-");
                if (temp.length >= 2) {
                    artist = temp.splice(0, 1)[0].trim();
                    title = temp.join('-').trim();
                }
            } else {
                title = videoTitle;
            }

            //Derive file name, if given, use it, if not, from video title
            const fileName = (task.fileName ? self.outputPath + "/" + task.fileName : self.outputPath + "/" + videoTitle + ".mp3");

            ytdl.getInfo(videoUrl, {quality: self.youtubeVideoQuality}, function (err, info) {

                //Stream setup
                const stream = ytdl.downloadFromInfo(info, {
                    quality: self.youtubeVideoQuality,
                    requestOptions: self.requestOptions
                });

                stream.on("response", function (httpResponse) {

                    //Setup of progress module
                    const str = progress({
                        length: parseInt(httpResponse.headers["content-length"]),
                        time: self.progressTimeout
                    });

                    //Add progress event listener
                    str.on("progress", function (progress) {
                        if (progress.percentage === 100) {
                            resultObj.stats = {
                                transferredBytes: progress.transferred,
                                runtime: progress.runtime,
                                averageSpeed: parseFloat(progress.speed.toFixed(2))
                            }
                        }
                        self.emit("progress", {videoId: task.videoId, progress: progress})
                    });

                    //Start encoding
                    const proc = new ffmpeg({
                        source: stream.pipe(str)
                    })
                        .audioBitrate(info.formats[0].audioBitrate)
                        .withAudioCodec("libmp3lame")
                        .toFormat("mp3")
                        .outputOptions("-id3v2_version", "4")
                        .outputOptions("-metadata", "title=" + title)
                        .outputOptions("-metadata", "artist=" + artist)
                        .on("error", function (err) {
                            callback(err.message, null);
                        })
                        .on("end", function () {
                            resultObj.file = fileName;
                            resultObj.youtubeUrl = videoUrl;
                            resultObj.videoTitle = videoTitle;
                            resultObj.artist = artist;
                            resultObj.title = title;
                            resultObj.thumbnail = thumbnail;
                            callback(null, resultObj);
                        })
                        // .writeToStream(task.responseStream, (retcode, error) => {
                        //     console.log(retcode, error, "STREAAAMMINNNG");
                        // });
                        .saveToFile(fileName);

                });

            });
        }

    });

};

module.exports = YoutubeMp3Downloader;
