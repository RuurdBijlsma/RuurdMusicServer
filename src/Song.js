class Song {
    constructor(id, title, artist, thumbnail, color, duration, viewCount) {
        this.id = id;
        this.title = title;
        this.artist = artist;
        this.thumbnail = thumbnail;
        this.duration = duration;
        this.viewCount = viewCount;
        this.color = color;
    }

    static fromObject(data) {
        //db data: ytid, title, artist, duration, viewcount, thumbnail, color
        return new Song(data.ytid, data.title, data.artist, data.thumbnail, data.color, data.duration, data.viewcount);
    }

    static fromSearchObject(data) {
        //search data: ytid, title, artist, thumbnail, color
        return new Song(data.ytid, data.title, data.artist, data.thumbnail, data.color);
    }
}

module.exports = Song;