const bcrypt = require('bcrypt');
const pgp = require('pg-promise')(/*options*/);
const secrets = require('../res/secrets.json');
const db = pgp(secrets.connectionString);

class AccountManager {
    async register(username, password) {
        let hash = await this.hash(password);
        await db.none("insert into users(name, password) values ($1,$2)", [username, hash]);
        return true;
    }

    async login(username, password) {
        let hash = await this.getUserHashedPassword(username);
        let success = await this.passwordMatchesHash(password, hash);
        if(!success)
            return false;

        return db.one('select id from users where "name" = $1', username);
    }

    async getUserHashedPassword(username) {
        return await db.one('SELECT password FROM users WHERE "name" = $1', username);
    }

    async passwordMatchesHash(password, hash) {
        return new Promise((resolve, error) => {
            bcrypt.compare(password, hash, (err, res) => {
                if (err)
                    error(err);
                resolve(!!res);
            })
        })
    }

    hash(password) {
        return new Promise((resolve, error) => {
            bcrypt.hash(password, 10, (err, hash) => {
                if (err)
                    error(err);
                resolve(hash);
            })
        })
    }
}

module.exports = new AccountManager();