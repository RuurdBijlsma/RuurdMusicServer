const youtubeSearch = require('youtube-search');
const secrets = require('../res/secrets.json');

class YoutubeSearch {
    async search(query, category, maxResults = 20) {
        const key = secrets.apiKey;

        return new Promise((resolve, error) => {
            const opts = {
                maxResults: maxResults,
                key: key,
                type: 'video'
            };
            if (category !== undefined)
                opts.videoCategoryId = category;

            youtubeSearch(query, opts, (err, results) => {
                if (err) error(err);

                if (results) {
                    let resultSongs = results.map(song => {
                        let artist = "Unknown";
                        let title = song.title;

                        if (title.indexOf("-") > -1) {
                            const temp = title.split("-");
                            if (temp.length >= 2) {
                                artist = temp.splice(0, 1)[0].trim();
                                title = temp.join('-').trim();
                            }
                        }
                        return {
                            ytid: song.id,
                            title: title,
                            artist: artist,
                            thumbnail: song.thumbnails.high.url
                        }
                    });

                    resolve(resultSongs);
                }
            });
        });
    }
}


module.exports = new YoutubeSearch();