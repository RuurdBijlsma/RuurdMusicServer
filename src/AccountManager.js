const bcrypt = require('bcrypt');

class AccountManager {
    setDatabase(db) {
        this.db = db;
    }

    async register(username, password) {
        try{
            let hash = await this.hash(password);
            await this.db.none("insert into users(name, password) values ($1,$2)", [username, hash]);
            return true;
        }catch(e){
            return false;
        }
    }

    async login(username, password) {
        try {
            let hash = await this.getUserHashedPassword(username);
            let success = await this.passwordMatchesHash(password, hash.password);
            if (!success)
                return false;

            return this.db.one('select id from users where "name" = $1', username);
        } catch (e) {
            return false;
        }
    }

    async getUserHashedPassword(username) {
        return await this.db.one('SELECT password FROM users WHERE "name" = $1', username);
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