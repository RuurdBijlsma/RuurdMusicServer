## How to set up:
### Requirements
* Postgres database
    * connection string should be set in res/secrets.json
    * to create the required tables, run database.sql
* Api key for YoutubeSearch Data API V3
    * set in res/secrets.json
* Nodejs & npm
* Ffmpeg

### Setup
* Before first run, execute `npm install` in the main directory to install the required packages
* To run the server, execute `node main.js`
* Point the client to the ip/domain of the server
* Make sure ffmpeg is in path
* To create the default user, send a POST request to host:3000/register with the following body:
```
{
 	"user":"defaultuser",
 	"password":"examplepassword"
 }
 ```