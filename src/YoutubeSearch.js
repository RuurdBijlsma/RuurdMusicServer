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

                resolve(results);
            });
        });
    }
}


module.exports = new YoutubeSearch();